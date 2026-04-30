import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Search, Plus, Loader2, Heart, Check } from "lucide-react";
import { toast } from "sonner";
import { cardImageCandidates, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { withDbRetry } from "@/lib/supabaseRetry";
import { addWishlist, removeWishlistByCard, wishlistStatus } from "@/lib/wishlist";
import { emitCollectionChanged } from "@/lib/collectionEvents";

type CardRow = Tables<"cards">;

interface Props {
  game: Game;
  onPick?: (card: CardRow) => void;
  pickLabel?: string;
  autoLoad?: boolean;
  ownedOnly?: boolean;
  ownedCardIds?: Set<string>;
}

export function CardSearch({
  game,
  onPick,
  pickLabel = "Add",
  autoLoad = false,
  ownedOnly = false,
  ownedCardIds,
}: Props) {
  const { user, loading: authLoading } = useAuth();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CardRow[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [wantedIds, setWantedIds] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const reqIdRef = useRef(0);

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => { const n = new Set(prev); busy ? n.add(id) : n.delete(id); return n; });

  const applyOwnedFilter = (cards: CardRow[]): CardRow[] => {
    if (!ownedOnly || !ownedCardIds) return cards;
    return cards.filter((c) => ownedCardIds.has(c.id));
  };

  const refreshStatus = async (cards: CardRow[]) => {
    if (!user || cards.length === 0) return;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = cards.map((c) => c.id).filter((id) => uuidRe.test(id));
    if (ids.length === 0) return;
    const [{ data: owned, error: ownedError }, wanted] = await Promise.all([
      withDbRetry(() =>
        supabase.from("collection_entries").select("card_id").eq("user_id", user.id).in("card_id", ids)
      ),
      wishlistStatus(ids).catch(() => null),
    ]);
    if (!ownedError) setOwnedIds(new Set((owned ?? []).map((r: any) => r.card_id)));
    if (wanted) setWantedIds(wanted);
  };

  const runSearch = async (term: string) => {
    const id = ++reqIdRef.current;
    setLoading(true);

    if (ownedOnly && ownedCardIds && ownedCardIds.size > 0) {
      const { data: local } = await supabase
        .from("cards")
        .select("*")
        .eq("game", game)
        .in("id", Array.from(ownedCardIds))
        .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
        .limit(40);
      if (id !== reqIdRef.current) return;
      setLoading(false);
      const filtered = local ?? [];
      setResults(filtered);
      if (filtered.length > 0) refreshStatus(filtered);
      else toast.info("No owned cards match your search");
      return;
    }

    const { data: local } = await supabase
      .from("cards")
      .select("*")
      .eq("game", game)
      .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
      .limit(40);
    if (id !== reqIdRef.current) return;

    const localFiltered = applyOwnedFilter(local ?? []);

    if (localFiltered.length >= 10) {
      setLoading(false);
      setResults(localFiltered);
      refreshStatus(localFiltered);
      return;
    }

    const { data, error } = await supabase.functions.invoke("card-search", {
      body: { game, query: term },
    });
    if (id !== reqIdRef.current) return;
    setLoading(false);
    if (error) { toast.error(error.message); return; }

    const remoteCards = applyOwnedFilter((data?.cards as CardRow[]) ?? []);
    if (remoteCards.length) {
      setResults(remoteCards);
      refreshStatus(remoteCards);
    } else if (localFiltered.length) {
      setResults(localFiltered);
      refreshStatus(localFiltered);
    } else {
      setResults([]);
      toast.info("No cards found");
    }
  };

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      if (onPick && autoLoad) {
        (async () => {
          setLoading(true);
          if (ownedOnly && ownedCardIds && ownedCardIds.size > 0) {
            const { data } = await supabase
              .from("cards")
              .select("*")
              .eq("game", game)
              .in("id", Array.from(ownedCardIds))
              .order("name", { ascending: true })
              .limit(80);
            setLoading(false);
            if (data) { setResults(data); refreshStatus(data); }
            return;
          }
          const { data } = await supabase
            .from("cards").select("*").eq("game", game)
            .order("name", { ascending: true }).limit(40);
          setLoading(false);
          if (data) {
            const filtered = applyOwnedFilter(data);
            setResults(filtered);
            refreshStatus(filtered);
          }
        })();
      } else {
        setResults([]);
        setLoading(false);
      }
      return;
    }
    const t = setTimeout(() => runSearch(term), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, game, onPick, ownedOnly, ownedCardIds]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term.length >= 2) runSearch(term);
  };

  const addToCollection = async (c: CardRow) => {
    if (!user) return toast.error("Not signed in");
    if (busyIds.has(c.id)) return;
    const quantity = Math.max(1, qty[c.id] ?? 1);
    setBusy(c.id, true);
    setOwnedIds((prev) => new Set(prev).add(c.id));
    try {
      const { data: existing } = await supabase
        .from("collection_entries").select("id, quantity")
        .eq("user_id", user.id).eq("card_id", c.id).maybeSingle();
      let error;
      if (existing) {
        ({ error } = await withDbRetry(() =>
          supabase.from("collection_entries").update({ quantity: existing.quantity + quantity }).eq("id", existing.id)
        ));
      } else {
        ({ error } = await withDbRetry(() =>
          supabase.from("collection_entries").insert({
            user_id: user.id, card_id: c.id, game,
            rarity: c.rarity ?? null, language: "EN", quantity,
          })
        ));
      }
      if (error) {
        setOwnedIds((prev) => { const n = new Set(prev); n.delete(c.id); return n; });
        return toast.error(error.message);
      }
      toast.success(`Added ${c.name} ×${quantity}`);
      // ← Passa la carta nell'evento per aggiornamento ottimistico in MasterSets
      emitCollectionChanged({
        game,
        cardId: c.id,
        card: {
          set_id: c.set_id ?? null,
          set_name: c.set_name ?? null,
          code: c.code ?? null,
        },
      });
    } finally {
      setBusy(c.id, false);
    }
  };

  const toggleWanted = async (c: CardRow) => {
    if (!user) return;
    const wasWanted = wantedIds.has(c.id);
    setWantedIds((prev) => { const n = new Set(prev); wasWanted ? n.delete(c.id) : n.add(c.id); return n; });
    try {
      if (wasWanted) { await removeWishlistByCard(c.id, game); toast.success("Removed from wishlist"); }
      else { await addWishlist(c, game); toast.success("Added to wishlist"); }
    } catch {
      setWantedIds((prev) => { const n = new Set(prev); wasWanted ? n.add(c.id) : n.delete(c.id); return n; });
    }
  };

  if (authLoading) return null;

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or code…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={loading || q.trim().length < 2}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
      </form>

      {results.length === 0 && !loading && (
        <p className="text-muted-foreground text-sm text-center py-8">
          {q.trim().length < 2 ? "Type at least 2 characters to search." : "No results."}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {results.map((c) => {
          const owned = ownedIds.has(c.id);
          const wanted = wantedIds.has(c.id);
          const busy = busyIds.has(c.id);
          const candidates = cardImageCandidates(c.game, c.code, c.image_small ?? c.image_large);
          return (
            <Card key={c.id} className="overflow-hidden bg-gradient-card group relative">
              <button
                type="button"
                onClick={() => toggleWanted(c)}
                className="absolute top-2 left-2 z-10 p-1.5 rounded-full bg-background/90 shadow hover:bg-background transition-colors"
                title={wanted ? "Remove from wishlist" : "Add to wishlist"}
              >
                <Heart className={`h-4 w-4 ${wanted ? "fill-red-500 text-red-500" : "text-muted-foreground"}`} />
              </button>

              {onPick ? (
                <button type="button" className="w-full text-left" onClick={() => onPick(c)}>
                  <CardImage candidates={candidates} name={c.name} owned={owned} />
                </button>
              ) : (
                <CardImage candidates={candidates} name={c.name} owned={owned} />
              )}

              <div className="p-2 space-y-2">
                <div>
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.code}{c.rarity ? ` · ${c.rarity}` : ""}</p>
                </div>

                {onPick ? (
                  <Button size="sm" className="w-full h-7 text-xs" onClick={() => onPick(c)}>
                    {pickLabel}
                  </Button>
                ) : (
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min={1} value={qty[c.id] ?? 1}
                      onChange={(e) => setQty((p) => ({ ...p, [c.id]: parseInt(e.target.value) || 1 }))}
                      className="w-12 h-7 text-xs text-center border rounded bg-background"
                    />
                    <Button
                      size="sm" className="flex-1 h-7 text-xs" disabled={busy}
                      onClick={() => addToCollection(c)}
                      variant={owned ? "secondary" : "default"}
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" />
                        : owned ? <><Check className="h-3 w-3 mr-1" />Add more</>
                        : <><Plus className="h-3 w-3 mr-1" />Add</>}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CardImage({ candidates, name, owned }: { candidates: string[]; name: string; owned: boolean }) {
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];
  if (!src) return <div className="w-full card-aspect bg-muted flex items-center justify-center text-muted-foreground text-xs">No image</div>;
  return (
    <img
      src={src} alt={name} loading="lazy"
      className={`w-full card-aspect object-cover transition-all ${owned ? "" : "opacity-60 grayscale"}`}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
