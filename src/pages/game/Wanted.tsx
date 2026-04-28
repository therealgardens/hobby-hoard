import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { CardSearch } from "@/components/CardSearch";
import { toast } from "sonner";
import type { Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";

type Wanted = Tables<"wanted_cards"> & { card: Tables<"cards"> | null };

export default function Wanted() {
  const { game } = useParams<{ game: Game }>();
  const [items, setItems] = useState<Wanted[]>([]);

  const load = async () => {
    if (!game) return;
    const { data } = await supabase
      .from("wanted_cards").select("*, card:cards(*)").eq("game", game).order("created_at", { ascending: false });
    setItems((data as any) ?? []);
  };
  useEffect(() => { load(); }, [game]);

  const add = async (card: Tables<"cards">) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user || !game) return;
    const { error } = await supabase.from("wanted_cards").insert({
      user_id: u.user.id, card_id: card.id, game,
    });
    if (error) return toast.error(error.message);
    toast.success("Added to wishlist");
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("wanted_cards").delete().eq("id", id);
    load();
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-4xl font-display">Wanted</h2>
        <p className="text-muted-foreground">Cards you're chasing — show up transparent in binders.</p>
      </div>

      <Card className="p-4 bg-gradient-card">
        <h3 className="font-display text-2xl mb-3">Add to wishlist</h3>
        {game && <CardSearch game={game} onPick={add} pickLabel="Want" />}
      </Card>

      {items.length > 0 && (
        <div>
          <h3 className="font-display text-2xl mb-3">Your wishlist ({items.length})</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {items.map(w => (
              <Card key={w.id} className="overflow-hidden bg-gradient-card relative group">
                {w.card?.image_small && <img src={w.card.image_small} alt={w.card.name} className="w-full card-aspect object-cover opacity-70" />}
                <div className="p-2">
                  <p className="text-xs font-semibold truncate">{w.card?.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{w.card?.code}</p>
                </div>
                <button onClick={() => remove(w.id)} className="absolute top-1 right-1 p-1 rounded-full bg-background/80 opacity-0 group-hover:opacity-100">
                  <Trash2 className="h-3 w-3" />
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
