import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cardImage, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { withDbRetry } from "@/lib/supabaseRetry";

type Entry = Tables<"collection_entries"> & { card: Tables<"cards"> | null };

export default function Duplicates() {
  const { game } = useParams<{ game: Game }>();
  const { user, loading: authLoading } = useAuth();
  const [dupes, setDupes] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!game || authLoading) return;
    if (!user) { setDupes([]); setLoading(false); return; }

    setLoading(true);
    (async () => {
      const { data: entries } = await withDbRetry(() =>
        supabase
          .from("collection_entries")
          .select("*")
          .eq("game", game)
          .eq("user_id", user.id),
      );

      const filtered = (entries ?? []).filter((e: any) => (e.quantity ?? 0) > 1);

      const cardIds = Array.from(
        new Set(filtered.map((e: any) => e.card_id).filter(Boolean)),
      ) as string[];

      let cardsById = new Map<string, Tables<"cards">>();
      if (cardIds.length) {
        const { data: cards } = await withDbRetry(() =>
          supabase.from("cards").select("*").in("id", cardIds),
        );
        cardsById = new Map((cards ?? []).map((c: any) => [c.id, c]));
      }

      setDupes(
        filtered.map((e: any) => ({ ...e, card: cardsById.get(e.card_id) ?? null })),
      );
      setLoading(false);
    })();
  }, [game, user?.id, authLoading]);

  const totalExtras = dupes.reduce((s, e) => s + (e.quantity - 1), 0);

  return (
    <div>
      <h2 className="text-4xl font-display">Duplicates</h2>
      <p className="text-muted-foreground mb-6">
        Every copy past the first — perfect for trades.{" "}
        {!loading && <span className="font-semibold">Total extras: {totalExtras}</span>}
      </p>

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
      ) : dupes.length === 0 ? (
        <Card className="p-12 text-center bg-gradient-card text-muted-foreground">
          No duplicates yet.
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {dupes.map((d) => {
            const img = cardImage(d.card?.game, d.card?.code, d.card?.image_small);
            return (
              <Card key={d.id} className="overflow-hidden bg-gradient-card">
                {img && (
                  <img
                    src={img}
                    alt={d.card?.name}
                    loading="lazy"
                    className="w-full card-aspect object-cover"
                    onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                  />
                )}
                <div className="p-2">
                  <p className="text-sm font-semibold truncate">{d.card?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    ×{d.quantity - 1} extra · {d.language}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
