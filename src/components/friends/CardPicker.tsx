import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { cardImage, type Game } from "@/lib/game";
import { ScrollArea } from "@/components/ui/scroll-area";

export type PickerCard = {
  id: string;
  name: string;
  code: string | null;
  image_small: string | null;
  game: string;
};

interface Props {
  game: Game;
  selectedId: string | null;
  onSelect: (card: PickerCard | null) => void;
}

/**
 * Inline grid of the current user's collection for a given game,
 * filterable by name/code, used to pick a card to offer in a trade.
 */
export function CardPicker({ game, selectedId, onSelect }: Props) {
  const { user } = useAuth();
  const [cards, setCards] = useState<PickerCard[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("collection_entries")
        .select("card:cards(id, name, code, image_small, game)")
        .eq("user_id", user.id)
        .eq("game", game)
        .limit(500);
      const list = (data ?? [])
        .map((r: any) => r.card as PickerCard)
        .filter(Boolean);
      // de-dupe by card id
      const seen = new Set<string>();
      const unique = list.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
      setCards(unique);
      setLoading(false);
    })();
  }, [user, game]);

  const term = q.trim().toLowerCase();
  const filtered = term
    ? cards.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          (c.code ?? "").toLowerCase().includes(term),
      )
    : cards;

  return (
    <div className="space-y-2">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your collection…"
      />
      <ScrollArea className="h-56 rounded border">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {cards.length === 0 ? "Your collection for this game is empty." : "No matches."}
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-2">
            {filtered.map((c) => {
              const img = cardImage(c.game, c.code, c.image_small);
              const selected = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(selected ? null : c)}
                  className={`text-left rounded-md border p-1 transition-colors ${
                    selected ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/50"
                  }`}
                >
                  {img ? (
                    <img src={img} alt={c.name} className="w-full aspect-[3/4] object-cover rounded" loading="lazy" />
                  ) : (
                    <div className="w-full aspect-[3/4] bg-muted rounded" />
                  )}
                  <p className="text-[11px] font-medium truncate mt-1">{c.name}</p>
                  {c.code && <p className="text-[10px] text-muted-foreground truncate">{c.code}</p>}
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
