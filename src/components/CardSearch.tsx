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
  /** Se true, mostra solo le carte presenti in ownedCardIds */
  ownedOnly?: boolean;
  /** Set di card ID posseduti — passato da BinderDetail */
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

  /** Filtra i risultati se ownedOnly è attivo */
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

    // Se ownedOnly, cerca direttamente tra le carte possedute senza chiamare la edge function
    if (ownedOnly && ownedCardIds && ownedCardIds.size > 0) {
      const ownedArr = Array.from(ownedCardIds);
      const { data: local } = await supabase
        .from("cards")
        .select("*")
        .eq("game", game)
        .in("id", ownedArr)
        .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
        .limit(40);
      if (id !== reqIdRef.current) return;
      setLoading(false);
      const filtered = local ?? [];
      setResults(filtered);
      if (filtered.length === 0) toast.info("No owned cards match your search");
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
    if (localFiltered.length) { setResults(localFiltered); refreshStatus(localFiltered); }

    const { data, error } = await supabase.functions.invoke("card-search", {
      body: { game, query: term },
    });
    if (id !== reqIdRef.current) return;
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    const cards = applyOwnedFilter((data?.cards as CardRow[]) ?? []);
    if (cards.length) { setResults(cards); refreshStatus(cards); }
    else if (!localFiltered.length) { setResults([]); toast.info("No cards found"); }
  };

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      if (onPick && autoLoad) {
        (async () => {
          setLoading(true);

          // Se ownedOnly, carica direttamente le carte possedute (senza alfabetico globale)
          if (ownedOnly && ownedCardIds && ownedCardIds.size > 0) {
            const ownedArr = Array.from(ownedCardIds);
            const { data } = await supabase
              .from("cards")
              .select("*")
              .eq("game", game)
              .in("id", ownedArr)
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
        .from("collection_entries")
        .select("id, quantity")
        .eq("user_id", user.id)
        .eq("card_id", c.id)
        .maybeSingle();
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
      emitCollectionChanged({ game, cardId: c.id });
    } finally {
      setBusy(c.id, false);
    }
  };

  const toggleWanted = async (c: CardRow) => {
    if (authLoading) return toast.info("Signing you in…");
    if (!user) return toast.error("Not signed in");
    if (busyIds.has(c.id)) return;
    const wasWanted = wantedIds.has(c.id);
    setBusy(c.id, true);
    setWantedIds((prev) => { const n = new Set(prev); wasWanted ? n.delete(c.id) : n.add(c.id); return n; });
    try {
      if (wasWanted) { await removeWishlistByCard(c.id, game); toast.success("Removed from wishlist"); }
      else { await addWishlist(c, game); toast.success("Added to wishlist"); }
    } catch (error) {
      setWantedIds((prev) => { const n = new Set(prev); wasWanted ? n.add(c.id) : n.delete(c.id); return n; });
      toast.error(error instanceof Error ? error.message : "Could not update wishlist");
    } finally {
      setBusy(c.id, false);
    }
  };

  return (
    <div>
      <form onSubmit={onSubmit} className="flex gap-2 mb-6">
        <Input
          placeholder={
            ownedOnly
              ? `Cerca tra le tue carte (es. ${game === "pokemon" ? "Pikachu" : game === "yugioh" ? "Dark Magician" : "Luffy"})`
              : `Search by name or code (e.g. ${game === "pokemon" ? "Pikachu or sv1-25" : game === "yugioh" ? "Dark Magician or LOB-005" : "Luffy or OP01-001"})`
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" disabled={loading} variant="secondary">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </form>
      {ownedOnly && results.length === 0 && !loading && q.length < 2 && (
        <p className="text-muted-foreground text-sm text-center py-8">
          Digita il nome di una carta che possiedi per aggiungerla allo slot.
        </p>
      )}
      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {results.map((c) => {
            const isOwned = ownedIds.has(c.id);
            const isWanted = wantedIds.has(c.id);
            const isBusy = busyIds.has(c.id);
            return (
              <Card key={c.id} className="overflow-hidden bg-gradient-card shadow-soft hover:shadow-card transition-shadow relative">
                {!onPick && (
                  <button
                    type="button"
                    onClick={() => toggleWanted(c)}
                    disabled={isBusy}
                    className="absolute top-2 left-2 z-10 p-1.5 rounded-full bg-background/90 shadow hover:bg-background transition-colors disabled:opacity-50"
                    title={isWanted ? "Remove from wishlist" : "Add to wishlist"}
                  >
                    <Heart className={`h-4 w-4 ${isWanted ? "fill-red-500 text-red-500" : "text-muted-foreground"}`} />
                  </button>
                )}
                <CardImg card={c} />
                <div className="p-2">
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.code} {c.rarity && `· ${c.rarity}`}
                  </p>
                  {onPick ? (
                    <Button size="sm" variant="secondary" className="w-full mt-2" onClick={() => onPick(c)}>
                      <Plus className="h-3 w-3 mr-1" /> {pickLabel}
                    </Button>
                  ) : (
                    <div className="flex gap-1 mt-2">
                      <Input
                        type="number"
                        min={1}
                        value={qty[c.id] ?? 1}
                        onChange={(e) =>
                          setQty((prev) => ({ ...prev, [c.id]: Math.max(1, parseInt(e.target.value) || 1) }))
                        }
                        className="h-8 w-14 px-2 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Button
                        size="sm"
                        variant={isOwned ? "outline" : "secondary"}
                        className="flex-1 h-8"
                        onClick={() => addToCollection(c)}
                        disabled={isBusy}
                        title={isOwned ? "Already in collection — add more" : "Add to collection"}
                      >
                        {isBusy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : isOwned ? (
                          <><Check className="h-3 w-3 mr-1" /> Owned</>
                        ) : (
                          <><Plus className="h-3 w-3 mr-1" /> Add</>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CardImg({ card }: { card: CardRow }) {
  const candidates = cardImageCandidates(card.game, card.code, card.image_small ?? card.image_large);
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];
  if (!src) {
    return (
      <div className="w-full card-aspect bg-muted flex items-center justify-center text-muted-foreground text-xs">
        No image
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={card.name}
      loading="lazy"
      className="w-full card-aspect object-cover"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
