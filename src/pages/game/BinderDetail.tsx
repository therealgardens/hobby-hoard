import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardSearch } from "@/components/CardSearch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Trash2, LayoutGrid, List } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  const [view, setView] = useState<"grid" | "list">("grid");

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
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="text-4xl font-display mb-1">{binder.name}</h2>
          <p className="text-muted-foreground">{binder.cols}×{binder.rows} · click any slot to add a card</p>
        </div>
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as any)}>
          <ToggleGroupItem value="grid" aria-label="Grid view"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view"><List className="h-4 w-4" /></ToggleGroupItem>
        </ToggleGroup>
      </div>

      {view === "grid" ? (
        <Card className="p-4 bg-gradient-card shadow-card max-w-3xl mx-auto">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${binder.cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: total }).map((_, i) => {
              const slot = slotMap.get(i);
              return (
                <div
                  key={i}
                  onClick={() => !slot && setPickingPos(i)}
                  className={cn(
                    "card-aspect rounded-lg border-2 border-dashed border-border bg-[hsl(var(--binder-empty))] flex items-center justify-center text-muted-foreground text-xs relative overflow-hidden group",
                    !slot && "cursor-pointer hover:border-primary hover:bg-muted",
                  )}
                >
                  {(() => { const img = cardImage(slot?.card?.game, slot?.card?.code, slot?.card?.image_small); return img ? (
                    <>
                      <img
                        src={img}
                        alt={slot?.card?.name}
                        onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                        className={cn("w-full h-full object-cover", slot?.is_wanted && "opacity-40")}
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
                  ); })()}
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card className="bg-gradient-card shadow-card divide-y divide-border">
          {Array.from({ length: total }).map((_, i) => {
            const slot = slotMap.get(i);
            const img = cardImage(slot?.card?.game, slot?.card?.code, slot?.card?.image_small);
            return (
              <div
                key={i}
                onClick={() => !slot && setPickingPos(i)}
                className={cn(
                  "flex items-center gap-3 p-2 px-4",
                  !slot && "cursor-pointer hover:bg-muted",
                )}
              >
                <span className="text-xs text-muted-foreground w-8 tabular-nums">#{i + 1}</span>
                <div className="w-10 h-14 rounded-md overflow-hidden bg-[hsl(var(--binder-empty))] flex items-center justify-center shrink-0">
                  {img ? (
                    <img
                      src={img}
                      alt={slot?.card?.name}
                      onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                      className={cn("w-full h-full object-cover", slot?.is_wanted && "opacity-40")}
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs">+</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{slot?.card?.name ?? <span className="text-muted-foreground italic">empty slot</span>}</div>
                  {slot?.card && (
                    <div className="text-xs text-muted-foreground truncate">
                      {slot.card.code}{slot.card.set_name ? ` · ${slot.card.set_name}` : ""}
                      {slot.is_wanted && <span className="ml-2 text-accent">· wanted</span>}
                    </div>
                  )}
                </div>
                {slot && (
                  <button
                    onClick={(e) => { e.stopPropagation(); clear(slot.id); }}
                    className="p-2 rounded-full hover:bg-background/80"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </Card>
      )}

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
