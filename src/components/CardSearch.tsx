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

type CardRow = Tables<"cards">;

interface Props {
  game: Game;
  /** When provided, replaces the built-in collection/wanted actions with a single pick button. */
  onPick?: (card: CardRow) => void;
  pickLabel?: string;
}

export function CardSearch({ game, onPick, pickLabel = "Add" }: Props) {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CardRow[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [wantedIds, setWantedIds] = useState<Set<string>>(new Set());
  const reqIdRef = useRef(0);

  const refreshStatus = async (cards: CardRow[]) => {
    if (!user || cards.length === 0) return;
    // Guard against non-UUID ids (e.g. if an upstream proxy ever returns
    // synthesized cards) — Postgres rejects the whole IN() with 22P02 otherwise.
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = cards.map((c) => c.id).filter((id) => uuidRe.test(id));
    if (ids.length === 0) return;
    const [{ data: owned }, { data: wanted }] = await Promise.all([
      supabase.from("collection_entries").select("card_id").eq("user_id", user.id).in("card_id", ids),
      supabase.from("wanted_cards").select("card_id").eq("user_id", user.id).in("card_id", ids),
    ]);
    setOwnedIds(new Set((owned ?? []).map((r: any) => r.card_id)));
    setWantedIds(new Set((wanted ?? []).map((r: any) => r.card_id)));
  };

  const runSearch = async (term: string) => {
    const id = ++reqIdRef.current;
    setLoading(true);
    const { data: local } = await supabase
      .from("cards")
      .select("*")
      .eq("game", game)
      .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
      .limit(40);
    if (id !== reqIdRef.current) return;
    if (local && local.length) {
      setResults(local);
      refreshStatus(local);
    }

    const { data, error } = await supabase.functions.invoke("card-search", {
      body: { game, query: term },
    });
    if (id !== reqIdRef.current) return;
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const cards = (data?.cards as CardRow[]) ?? [];
    if (cards.length) {
      setResults(cards);
      refreshStatus(cards);
    } else if (!local?.length) {
      setResults([]);
      toast.info("No cards found");
    }
  };

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const t = setTimeout(() => runSearch(term), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, game]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term.length >= 2) runSearch(term);
  };

  const addToCollection = async (c: CardRow) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return toast.error("Not signed in");
    const quantity = Math.max(1, qty[c.id] ?? 1);
    const { error } = await supabase.from("collection_entries").insert({
      user_id: u.user.id,
      card_id: c.id,
      game,
      rarity: c.rarity ?? null,
      language: "EN",
      quantity,
    });
    if (error) return toast.error(error.message);
    toast.success(`Added ${c.name} ×${quantity}`);
    setOwnedIds((prev) => new Set(prev).add(c.id));
  };

  const toggleWanted = async (c: CardRow) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return toast.error("Not signed in");
    if (wantedIds.has(c.id)) {
      const { error } = await supabase
        .from("wanted_cards")
        .delete()
        .eq("user_id", u.user.id)
        .eq("card_id", c.id);
      if (error) return toast.error(error.message);
      setWantedIds((prev) => {
        const n = new Set(prev);
        n.delete(c.id);
        return n;
      });
      toast.success("Removed from wishlist");
    } else {
      const { error } = await supabase.from("wanted_cards").insert({
        user_id: u.user.id,
        card_id: c.id,
        game,
      });
      if (error) return toast.error(error.message);
      setWantedIds((prev) => new Set(prev).add(c.id));
      toast.success("Added to wishlist");
    }
  };

  return (
    <div>
      <form onSubmit={onSubmit} className="flex gap-2 mb-6">
        <Input
          placeholder={`Search by name or code (e.g. ${game === "pokemon" ? "Pikachu or sv1-25" : game === "yugioh" ? "Dark Magician or LOB-005" : "Luffy or OP01-001"})`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" disabled={loading} variant="secondary">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </form>
      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {results.map((c) => {
            const isOwned = ownedIds.has(c.id);
            const isWanted = wantedIds.has(c.id);
            return (
              <Card key={c.id} className="overflow-hidden bg-gradient-card shadow-soft hover:shadow-card transition-shadow relative">
                {!onPick && (
                  <button
                    type="button"
                    onClick={() => toggleWanted(c)}
                    className="absolute top-2 left-2 z-10 p-1.5 rounded-full bg-background/90 shadow hover:bg-background transition-colors"
                    title={isWanted ? "Remove from wishlist" : "Add to wishlist"}
                  >
                    <Heart
                      className={`h-4 w-4 ${isWanted ? "fill-red-500 text-red-500" : "text-muted-foreground"}`}
                    />
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
                        title={isOwned ? "Already in collection — add more" : "Add to collection"}
                      >
                        {isOwned ? <Check className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                        {isOwned ? "Owned" : "Add"}
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
