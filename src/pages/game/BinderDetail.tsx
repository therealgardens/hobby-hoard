import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardSearch } from "@/components/CardSearch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Trash2, LayoutGrid, List, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { cardImage, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { addWishlist } from "@/lib/wishlist";
import { withDbRetry } from "@/lib/supabaseRetry";

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
  const [pageIdx, setPageIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    if (!binderId) return;
    setLoading(true);
    setLoadError(null);
    const { data: b, error: bErr } = await withDbRetry(() =>
      supabase.from("binders").select("*").eq("id", binderId).maybeSingle(),
    );
    if (bErr) {
      setLoading(false);
      setLoadError(bErr.message || "Could not load binder");
      return;
    }
    if (!b) {
      setLoading(false);
      setLoadError("Binder not found");
      return;
    }
    setBinder(b);
    const { data: s, error: sErr } = await withDbRetry(() =>
      supabase
        .from("binder_slots")
        .select("*")
        .eq("binder_id", binderId)
        .order("position"),
    );
    if (sErr) {
      // Don't block the page — show binder with empty slots
      toast.error("Could not load slots — showing empty grid");
      setSlots([]);
      setLoading(false);
      return;
    }
    const slotRows = (s ?? []) as Tables<"binder_slots">[];
    const cardIds = Array.from(
      new Set(slotRows.map((row) => row.card_id).filter(Boolean) as string[]),
    );
    let cardsById = new Map<string, Tables<"cards">>();
    if (cardIds.length) {
      const { data: cards } = await withDbRetry(() =>
        supabase.from("cards").select("*").in("id", cardIds),
      );
      cardsById = new Map((cards ?? []).map((c: any) => [c.id, c]));
    }
    setSlots(slotRows.map((row) => ({ ...row, card: row.card_id ? cardsById.get(row.card_id) ?? null : null })));
    setLoading(false);
  };
  useEffect(() => { load(); }, [binderId]);

  if (loadError && !binder) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => nav(`/${game}/binders`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> All binders
        </Button>
        <p className="text-destructive">{loadError}</p>
        <Button onClick={load}>Retry</Button>
      </div>
    );
  }
  if (!binder) return <div className="text-muted-foreground">Loading…</div>;

  const perPage = binder.cols * binder.rows;
  const pages = Math.max(1, (binder as any).pages ?? 1);
  const safePageIdx = Math.min(pageIdx, pages - 1);
  const pageStart = safePageIdx * perPage;
  const slotMap = new Map(slots.map(s => [s.position, s]));

  const addPage = async () => {
    if (!binderId) return;
    const { error } = await supabase.from("binders").update({ pages: pages + 1 } as any).eq("id", binderId);
    if (error) return toast.error(error.message);
    setPageIdx(pages); // jump to the newly added page
    load();
  };
  const removePage = async () => {
    if (!binderId || pages <= 1) return;
    if (!confirm(`Remove page ${pages}? Cards on this page will be deleted.`)) return;
    const start = (pages - 1) * perPage;
    const end = pages * perPage - 1;
    await supabase.from("binder_slots").delete().eq("binder_id", binderId).gte("position", start).lte("position", end);
    await supabase.from("binders").update({ pages: pages - 1 } as any).eq("id", binderId);
    setPageIdx(Math.max(0, safePageIdx - (safePageIdx === pages - 1 ? 1 : 0)));
    load();
  };

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
      try {
        await addWishlist(card, game!, { binder_id: binderId, quantity: 1 });
      } catch (error) {
        return toast.error(error instanceof Error ? error.message : "Could not add to wishlist");
      }
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
          <p className="text-muted-foreground">{binder.cols}×{binder.rows} · {pages} page{pages > 1 ? "s" : ""} · click any slot to add a card</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 mr-2">
            <Button variant="outline" size="icon" disabled={safePageIdx === 0} onClick={() => setPageIdx(i => Math.max(0, i - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm tabular-nums w-16 text-center">Page {safePageIdx + 1}/{pages}</span>
            <Button variant="outline" size="icon" disabled={safePageIdx >= pages - 1} onClick={() => setPageIdx(i => Math.min(pages - 1, i + 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={addPage}><Plus className="h-4 w-4 mr-1" />Page</Button>
          {pages > 1 && safePageIdx === pages - 1 && (
            <Button variant="ghost" size="sm" onClick={removePage}><Trash2 className="h-4 w-4" /></Button>
          )}
          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as any)}>
            <ToggleGroupItem value="grid" aria-label="Grid view"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view"><List className="h-4 w-4" /></ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {view === "grid" ? (
        <Card className="p-4 bg-gradient-card shadow-card max-w-3xl mx-auto">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${binder.cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: perPage }).map((_, i) => {
              const pos = pageStart + i;
              const slot = slotMap.get(pos);
              return (
                <div
                  key={pos}
                  onClick={() => !slot && setPickingPos(pos)}
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
                    <span>+ {pos + 1}</span>
                  ); })()}
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card className="bg-gradient-card shadow-card divide-y divide-border">
          {Array.from({ length: perPage }).map((_, i) => {
            const pos = pageStart + i;
            const slot = slotMap.get(pos);
            const img = cardImage(slot?.card?.game, slot?.card?.code, slot?.card?.image_small);
            return (
              <div
                key={pos}
                onClick={() => !slot && setPickingPos(pos)}
                className={cn(
                  "flex items-center gap-3 p-2 px-4",
                  !slot && "cursor-pointer hover:bg-muted",
                )}
              >
                <span className="text-xs text-muted-foreground w-10 tabular-nums">#{pos + 1}</span>
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
