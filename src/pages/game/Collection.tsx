import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
import { cardImageCandidates, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

type CardRow = Tables<"cards">;
type Entry = {
  id: string;
  card_id: string;
  language: string;
  quantity: number;
  rarity: string | null;
  created_at: string;
  card: CardRow | null;
};

export default function Collection() {
  const { game } = useParams<{ game: Game }>();
  const { user, loading: authLoading } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!game || authLoading) return;
    if (!user) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const { data: rows, error } = await supabase
        .from("collection_entries")
        .select("id, card_id, language, quantity, rarity, created_at")
        .eq("user_id", user.id)
        .eq("game", game)
        .order("created_at", { ascending: true });
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      const ids = Array.from(new Set((rows ?? []).map((r) => r.card_id)));
      let byId = new Map<string, CardRow>();
      if (ids.length) {
        const { data: cards } = await supabase.from("cards").select("*").in("id", ids);
        byId = new Map((cards ?? []).map((c) => [c.id, c as CardRow]));
      }
      setEntries(
        (rows ?? []).map((r) => ({ ...r, card: byId.get(r.card_id) ?? null })),
      );
      setLoading(false);
    })();
  }, [game, user?.id, authLoading]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((e) => {
      const c = e.card;
      if (!c) return false;
      return (
        c.name.toLowerCase().includes(term) ||
        (c.code ?? "").toLowerCase().includes(term) ||
        (c.set_name ?? "").toLowerCase().includes(term)
      );
    });
  }, [entries, q]);

  if (!game) return null;

  return (
    <div>
      <h2 className="text-4xl font-display mb-2">My Collection</h2>
      <p className="text-muted-foreground mb-6">
        Every card you own, in the order you added them.
      </p>

      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, code or set"
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Card key={i} className="overflow-hidden bg-gradient-card">
              <Skeleton className="w-full card-aspect" />
              <div className="p-2 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">
          {entries.length === 0
            ? "Your collection is empty. Add cards from Master Sets or Search."
            : "No cards match your search."}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map((e) => (
            <Card key={e.id} className="overflow-hidden bg-gradient-card relative">
              {e.card ? (
                <CardImg card={e.card} />
              ) : (
                <div className="w-full card-aspect bg-muted flex items-center justify-center text-muted-foreground text-xs">
                  Unknown card
                </div>
              )}
              {e.quantity > 1 && (
                <Badge className="absolute top-2 right-2">×{e.quantity}</Badge>
              )}
              <div className="p-2">
                <p className="text-sm font-semibold truncate">
                  {e.card?.name ?? "Unknown"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {e.card?.code ?? "—"}
                  {e.rarity ? ` · ${e.rarity}` : ""}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CardImg({ card }: { card: CardRow }) {
  const candidates = useMemo(
    () => cardImageCandidates(card.game, card.code, card.image_small ?? card.image_large),
    [card.game, card.code, card.image_small, card.image_large],
  );
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
