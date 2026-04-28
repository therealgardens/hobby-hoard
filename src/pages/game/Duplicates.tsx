import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { cardImage, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";

type Entry = Tables<"collection_entries"> & { card: Tables<"cards"> | null };

export default function Duplicates() {
  const { game } = useParams<{ game: Game }>();
  const [dupes, setDupes] = useState<Entry[]>([]);

  useEffect(() => {
    if (!game) return;
    (async () => {
      const { data } = await supabase
        .from("collection_entries").select("*, card:cards(*)").eq("game", game);
      const filtered = ((data as any) as Entry[] ?? []).filter(e => (e.quantity ?? 0) > 1);
      setDupes(filtered);
    })();
  }, [game]);

  const totalExtras = dupes.reduce((s, e) => s + (e.quantity - 1), 0);

  return (
    <div>
      <h2 className="text-4xl font-display">Duplicates</h2>
      <p className="text-muted-foreground mb-6">Every copy past the first — perfect for trades. <span className="font-semibold">Total extras: {totalExtras}</span></p>
      {dupes.length === 0 ? (
        <Card className="p-12 text-center bg-gradient-card text-muted-foreground">No duplicates yet.</Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {dupes.map(d => (
            <Card key={d.id} className="overflow-hidden bg-gradient-card">
              {d.card?.image_small && <img src={d.card.image_small} alt={d.card.name} className="w-full card-aspect object-cover" />}
              <div className="p-2">
                <p className="text-sm font-semibold truncate">{d.card?.name}</p>
                <p className="text-xs text-muted-foreground">×{d.quantity - 1} extra · {d.language}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
