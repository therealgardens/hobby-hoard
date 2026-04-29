import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Search, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cardImageCandidates, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";

type CardRow = Tables<"cards">;

interface Props {
  game: Game;
  onPick?: (card: CardRow) => void;
  pickLabel?: string;
}

export function CardSearch({ game, onPick, pickLabel = "Add" }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CardRow[]>([]);
  const reqIdRef = useRef(0);

  const runSearch = async (term: string) => {
    const id = ++reqIdRef.current;
    setLoading(true);
    const { data: local } = await supabase
      .from("cards")
      .select("*")
      .eq("game", game)
      .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
      .limit(40);
    if (id !== reqIdRef.current) return; // stale
    if (local && local.length) setResults(local);

    const { data, error } = await supabase.functions.invoke("card-search", {
      body: { game, query: term },
    });
    if (id !== reqIdRef.current) return; // stale
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const cards = (data?.cards as CardRow[]) ?? [];
    if (cards.length) setResults(cards);
    else if (!local?.length) {
      setResults([]);
      toast.info("No cards found");
    }
  };

  // Debounced auto-search
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
            return (
            <Card key={c.id} className="overflow-hidden bg-gradient-card shadow-soft hover:shadow-card transition-shadow">
              <CardImg card={c} />
              <div className="p-2">
                <p className="text-sm font-semibold truncate">{c.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {c.code} {c.rarity && `· ${c.rarity}`}
                </p>
                {onPick && (
                  <Button size="sm" variant="secondary" className="w-full mt-2" onClick={() => onPick(c)}>
                    <Plus className="h-3 w-3 mr-1" /> {pickLabel}
                  </Button>
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
