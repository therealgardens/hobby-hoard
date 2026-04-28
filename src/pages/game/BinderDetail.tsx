import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardSearch } from "@/components/CardSearch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { cardImage, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";

type Binder = Tables<"binders">;
type Slot = Tables<"binder_slots"> & { card: Tables<"cards"> | null };

export default function BinderDetail() {
  const { game, binderId } = useParams<{ game: Game; binderId: string }>();
  const nav = useNavigate();
  const [binder, setBinder] = useState<Binder | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [pickingPos, setPickingPos] = useState<number | null>(null);
  const [isWanted, setIsWanted] = useState(false);

  const load = async () => {
    if (!binderId) return;
    const { data: b } = await supabase.from("binders").select("*").eq("id", binderId).maybeSingle();
    setBinder(b);
    const { data: s } = await supabase
      .from("binder_slots")
      .select("*, card:cards(*)")
      .eq("binder_id", binderId)
      .order("position");
    setSlots((s as any) ?? []);
  };
  useEffect(() => { load(); }, [binderId]);

  if (!binder) return <div className="text-muted-foreground">Loading…</div>;

  const total = binder.cols * binder.rows;
  const slotMap = new Map(slots.map(s => [s.position, s]));

  const place = async (card: Tables<"cards">) => {
    if (pickingPos === null || !binderId) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    // upsert
    const existing = slotMap.get(pickingPos);
    if (existing) {
      await supabase.from("binder_slots").update({ card_id: card.id, is_wanted: isWanted }).eq("id", existing.id);
    } else {
      await supabase.from("binder_slots").insert({
        binder_id: binderId, user_id: u.user.id, position: pickingPos, card_id: card.id, is_wanted: isWanted,
      });
    }
    if (isWanted) {
      await supabase.from("wanted_cards").insert({
        user_id: u.user.id, card_id: card.id, game: game!, binder_id: binderId, quantity: 1,
      });
    }
    setPickingPos(null);
    load();
  };

  const clear = async (slotId: string) => {
    await supabase.from("binder_slots").delete().eq("id", slotId);
    load();
  };

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => nav(`/${game}/binders`)} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> All binders
      </Button>
      <h2 className="text-4xl font-display mb-1">{binder.name}</h2>
      <p className="text-muted-foreground mb-6">{binder.cols}×{binder.rows} · click any slot to add a card</p>

      <Card className="p-6 bg-gradient-card shadow-card">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${binder.cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: total }).map((_, i) => {
            const slot = slotMap.get(i);
            return (
              <div
                key={i}
                onClick={() => !slot && setPickingPos(i)}
                className={cn(
                  "card-aspect rounded-xl border-2 border-dashed border-border bg-[hsl(var(--binder-empty))] flex items-center justify-center text-muted-foreground text-sm relative overflow-hidden group",
                  !slot && "cursor-pointer hover:border-primary hover:bg-muted",
                )}
              >
                {slot?.card?.image_small ? (
                  <>
                    <img
                      src={slot.card.image_small}
                      alt={slot.card.name}
                      className={cn("w-full h-full object-cover", slot.is_wanted && "opacity-40")}
                    />
                    {slot.is_wanted && (
                      <span className="absolute top-1 left-1 text-[10px] bg-accent text-accent-foreground px-1.5 py-0.5 rounded-full">
                        wanted
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); clear(slot.id); }}
                      className="absolute top-1 right-1 p-1 rounded-full bg-background/80 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <span>+ {i + 1}</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Dialog open={pickingPos !== null} onOpenChange={(o) => !o && setPickingPos(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Pick a card for slot {pickingPos !== null && pickingPos + 1}</DialogTitle></DialogHeader>
          <div className="flex items-center gap-2 mb-3">
            <Switch id="w" checked={isWanted} onCheckedChange={setIsWanted} />
            <Label htmlFor="w">Mark as wanted (transparent placeholder)</Label>
          </div>
          {game && <CardSearch game={game} onPick={place} pickLabel="Place" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
