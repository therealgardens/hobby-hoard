import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Search, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cardImage, type Game } from "@/lib/game";
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

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    // 1) Local cache lookup first
    const { data: local } = await supabase
      .from("cards")
      .select("*")
      .eq("game", game)
      .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
      .limit(40);
    if (local && local.length) setResults(local);
    // 2) Always also hit the live API to enrich cache
    const { data, error } = await supabase.functions.invoke("card-search", {
      body: { game, query: q.trim() },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const cards = (data?.cards as CardRow[]) ?? [];
    if (cards.length) setResults(cards);
    else if (!local?.length) toast.info("No cards found");
  };

  return (
    <div>
      <form onSubmit={search} className="flex gap-2 mb-6">
        <Input
          placeholder={`Search by name or code (e.g. ${game === "pokemon" ? "Pikachu or sv1-25" : "Luffy or OP01-001"})`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </form>
      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {results.map((c) => (
            <Card key={c.id} className="overflow-hidden bg-gradient-card shadow-soft hover:shadow-card transition-shadow">
              {c.image_small ? (
                <img src={c.image_small} alt={c.name} loading="lazy" className="w-full card-aspect object-cover" />
              ) : (
                <div className="w-full card-aspect bg-muted flex items-center justify-center text-muted-foreground text-xs">
                  No image
                </div>
              )}
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
          ))}
        </div>
      )}
    </div>
  );
}
