import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Trash2, LayoutGrid, List, Plus, ChevronLeft, ChevronRight, Search, Loader2 } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { cardImage, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { addWishlist } from "@/lib/wishlist";
import { withDbRetry } from "@/lib/supabaseRetry";
import { useAuth } from "@/hooks/useAuth";

type Binder = Tables<"binders">;
type Slot = Tables<"binder_slots"> & { card: Tables<"cards"> | null };
type CardRow = Tables<"cards">;

const _ownedCache = new Map<string, Set<string>>();
const ownedCacheKey = (game: string, userId: string) => `${game}:${userId}`;
const binderCacheKey = (game: string, userId: string) => `tcg.binders.${game}.${userId}.v1`;

export default function BinderDetail() {
  const { game, binderId } = useParams<{ game: Game; binderId: string }>();
  const nav = useNavigate();
  const { user } = useAuth();
  const location = useLocation();

  const routeBinder = (location.state as { binder?: Binder } | null)?.binder ?? null;
  const cachedBinder = useMemo(() => {
    if (!game || !user || !binderId) return null;
    try {
      const rows = JSON.parse(
        sessionStorage.getItem(binderCacheKey(game, user.id)) ?? "[]",
      ) as Binder[];
      return rows.find((row) => row.id === binderId) ?? null;
    } catch { return null; }
  }, [game, user?.id, binderId]);

  const [binder, setBinder] = useState<Binder | null>(routeBinder ?? cachedBinder);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [pickingPos, setPickingPos] = useState<number | null>(null);
  const [isWanted, setIsWanted] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [pageIdx, setPageIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmRemovePage, setConfirmRemovePage] = useState(false);

  const load = useCallback(async () => {
    if (!binderId || !user) return;
    setLoading(!binder);
    setLoadError(null);

    const { data: b, error: bErr } = await withDbRetry(() =>
      supabase.from("binders").select("*")
        .eq("id", binderId).eq("user_id", user.id).maybeSingle(),
    );
    if (bErr) { setLoading(false); setLoadError(bErr.message || "Could not load binder"); return; }
    if (!b) { setLoading(false); if (!binder) setLoadError("Binder not found"); return; }
    setBinder(b);

    const { data: s, error: sErr } = await withDbRetry(() =>
      supabase.from("binder_slots").select("*")
        .eq("binder_id", binderId).eq("user_id", user.id).order("position"),
    );
    if (sErr) { toast.error("Could not load slots"); setSlots([]); setLoading(false); return; }

    const slotRows = (s ?? []) as Tables<"binder_slots">[];
    const cardIds = Array.from(new Set(slotRows.map((r) => r.card_id).filter(Boolean) as string[]));
    let cardsById = new Map<string, Tables<"cards">>();
    if (cardIds.length) {
      const { data: cards } = await withDbRetry(() =>
        supabase.from("cards").select("*").in("id", cardIds),
      );
      cardsById = new Map((cards ?? []).map((c: any) => [c.id, c]));
    }
    setSlots(slotRows.map((row) => ({
      ...row,
      card: row.card_id ? (cardsById.get(row.card_id) ?? null) : null,
    })));
    setLoading(false);
  }, [binderId, user?.id]);

  useEffect(() => {
    setBinder((current) => routeBinder ?? cachedBinder ?? current);
    load();
  }, [load]);

  const perPage = useMemo(() => (binder ? binder.cols * binder.rows : 0), [binder]);
  const pages = useMemo(() => Math.max(1, (binder as any)?.pages ?? 1), [binder]);
  const safePageIdx = useMemo(() => Math.min(pageIdx, pages - 1), [pageIdx, pages]);
  const pageStart = useMemo(() => safePageIdx * perPage, [safePageIdx, perPage]);
  const slotMap = useMemo(() => new Map(slots.map((s) => [s.position, s])), [slots]);

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

  const addPage = async () => {
    if (!binderId) return;
    const newPages = pages + 1;
    setBinder((prev) => prev ? { ...prev, pages: newPages } as any : prev);
    setPageIdx(newPages - 1);
    const { error } = await supabase.from("binders").update({ pages: newPages } as any).eq("id", binderId);
    if (error) {
      setBinder((prev) => prev ? { ...prev, pages } as any : prev);
      setPageIdx(safePageIdx);
      toast.error(error.message);
    }
  };

  const removePage = async () => {
    if (!binderId || pages <= 1) return;
    const start = (pages - 1) * perPage;
    const end = pages * perPage - 1;
    const newPages = pages - 1;
    const newPageIdx = Math.max(0, safePageIdx - (safePageIdx === pages - 1 ? 1 : 0));
    setBinder((prev) => prev ? { ...prev, pages: newPages } as any : prev);
    setPageIdx(newPageIdx);
    setSlots((prev) => prev.filter((s) => s.position < start || s.position > end));
    setConfirmRemovePage(false);
    const [{ error: delErr }, { error: updErr }] = await Promise.all([
      supabase.from("binder_slots").delete().eq("binder_id", binderId).gte("position", start).lte("position", end),
      supabase.from("binders").update({ pages: newPages } as any).eq("id", binderId),
    ]);
    if (delErr || updErr) {
      toast.error((delErr ?? updErr)?.message ?? "Could not remove page");
      load();
    }
  };

  const place = async (card: CardRow) => {
    if (pickingPos === null || !binderId || !user) return;
    const pos = pickingPos;
    const wanted = isWanted;

    const optimisticSlot: Slot = {
      id: `optimistic-${pos}`,
      binder_id: binderId,
      user_id: user.id,
      position: pos,
      card_id: card.id,
      is_wanted: wanted,
      created_at: new Date().toISOString(),
      card,
    } as Slot;

    setSlots((prev) => [...prev.filter((s) => s.position !== pos), optimisticSlot]);
    setPickingPos(null);
    setIsWanted(false);

    // Fix: .maybeSingle() invece di .single() per evitare PGRST116
    const { data: upserted, error } = await withDbRetry(() =>
      supabase.from("binder_slots").upsert(
        { binder_id: binderId, user_id: user.id, position: pos, card_id: card.id, is_wanted: wanted },
        { onConflict: "binder_id,position" },
      ).select().maybeSingle(),
    );
    if (error) {
      setSlots((prev) => prev.filter((s) => s.id !== `optimistic-${pos}`));
      return toast.error(error.message || "Could not place card");
    }
    if (upserted) {
      setSlots((prev) => [
        ...prev.filter((s) => s.position !== pos),
        { ...(upserted as Tables<"binder_slots">), card },
      ]);
    }
    if (wanted) {
      try { await addWishlist(card, game!, { binder_id: binderId, quantity: 1 }); }
      catch (err) { toast.error(err instanceof Error ? err.message : "Could not add to wishlist"); }
    }
    toast.success(`Placed ${card.name}`);
  };

  const clear = async (slotId: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== slotId));
    const { error } = await withDbRetry(() =>
      supabase.from("binder_slots").delete().eq("id", slotId),
    );
    if (error) {
      toast.error(error.message || "Could not clear slot");
      load();
    }
  };

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => nav(`/${game}/binders`)} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> All binders
      </Button>

      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="text-4xl font-display mb-1">{binder.name}</h2>
          <p className="text-muted-foreground">
            {binder.cols}×{binder.rows} · {pages} page{pages > 1 ? "s" : ""} · click any slot to add a card
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 mr-2">
            <Button variant="outline" size="icon" disabled={safePageIdx === 0} onClick={() => setPageIdx((i) => Math.max(0, i - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm tabular-nums w-16 text-center">
              Page {safePageIdx + 1}/{pages}
            </span>
            <Button variant="outline" size="icon" disabled={safePageIdx >= pages - 1} onClick={() => setPageIdx((i) => Math.min(pages - 1, i + 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={addPage}>
            <Plus className="h-4 w-4 mr-1" /> Page
          </Button>
          {pages > 1 && safePageIdx === pages - 1 && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemovePage(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as any)}>
            <ToggleGroupItem value="grid" aria-label="Grid view"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view"><List className="h-4 w-4" /></ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {loading ? (
        <Card className="p-4 bg-gradient-card shadow-card max-w-3xl mx-auto">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${binder.cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: perPage }).map((_, i) => (
              <Skeleton key={i} className="w-full card-aspect rounded-lg" />
            ))}
          </div>
        </Card>
      ) : view === "grid" ? (
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
                  {slot ? (() => {
                    const img = cardImage(slot.card?.game, slot.card?.code, slot.card?.image_small);
                    return (
                      <>
                        {img ? (
                          <img src={img} alt={slot.card?.name ?? ""} loading="lazy"
                            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                            className={cn("w-full h-full object-cover", slot.is_wanted && "opacity-40")} />
                        ) : (
                          <div className={cn("w-full h-full flex items-center justify-center p-1 text-center text-[11px] font-medium text-foreground bg-muted", slot.is_wanted && "opacity-40")}>
                            <span className="line-clamp-3">{slot.card?.name ?? slot.card?.code ?? "Card"}</span>
                          </div>
                        )}
                        {slot.is_wanted && (
                          <span className="absolute top-1 left-1 text-[10px] bg-accent text-accent-foreground px-1.5 py-0.5 rounded-full">wanted</span>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); clear(slot.id); }}
                          className="absolute top-1 right-1 p-1 rounded-full bg-background/80 opacity-0 group-hover:opacity-100">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </>
                    );
                  })() : <span>+ {pos + 1}</span>}
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
              <div key={pos} onClick={() => !slot && setPickingPos(pos)}
                className={cn("flex items-center gap-3 p-2 px-4", !slot && "cursor-pointer hover:bg-muted")}>
                <span className="text-xs text-muted-foreground w-10 tabular-nums">#{pos + 1}</span>
                <div className="w-10 h-14 rounded-md overflow-hidden bg-[hsl(var(--binder-empty))] flex items-center justify-center shrink-0">
                  {img
                    ? <img src={img} alt={slot?.card?.name} loading="lazy"
                        onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                        className={cn("w-full h-full object-cover", slot?.is_wanted && "opacity-40")} />
                    : <span className="text-muted-foreground text-xs">+</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {slot?.card?.name ?? <span className="text-muted-foreground italic">empty slot</span>}
                  </div>
                  {slot?.card && (
                    <div className="text-xs text-muted-foreground truncate">
                      {slot.card.code}{slot.card.set_name ? ` · ${slot.card.set_name}` : ""}
                      {slot.is_wanted && <span className="ml-2 text-accent">· wanted</span>}
                    </div>
                  )}
                </div>
                {slot && (
                  <button onClick={(e) => { e.stopPropagation(); clear(slot.id); }}
                    className="p-2 rounded-full hover:bg-background/80">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {/* Dialog posizionamento carta — ricerca semplice e veloce */}
      <Dialog open={pickingPos !== null} onOpenChange={(o) => !o && setPickingPos(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isWanted ? "Qualsiasi carta" : "Cerca carta"} — slot {pickingPos !== null && pickingPos + 1}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 mb-3">
            <Switch id="w" checked={isWanted} onCheckedChange={setIsWanted} />
            <Label htmlFor="w">Marca come wanted</Label>
          </div>
          {game && <BinderCardPicker game={game} onPick={place} />}
        </DialogContent>
      </Dialog>

      {/* Dialog conferma rimozione pagina */}
      <Dialog open={confirmRemovePage} onOpenChange={setConfirmRemovePage}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rimuovere pagina {pages}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tutte le carte su questa pagina verranno eliminate. L'operazione non è reversibile.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirmRemovePage(false)}>Annulla</Button>
            <Button variant="destructive" onClick={removePage}>
              <Trash2 className="h-4 w-4 mr-2" /> Rimuovi pagina
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Ricerca semplice per binder — solo DB locale, niente edge function ───────

function BinderCardPicker({ game, onPick }: { game: Game; onPick: (card: CardRow) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase
        .from("cards")
        .select("*")
        .eq("game", game)
        .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
        .limit(30);
      setLoading(false);
      setResults(data ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q, game]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          autoFocus
          placeholder="Cerca per nome o codice…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>
      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {!loading && q.trim().length < 2 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          Digita almeno 2 caratteri per cercare.
        </p>
      )}
      {!loading && q.trim().length >= 2 && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">Nessuna carta trovata.</p>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
        {results.map((c) => {
          const img = cardImage(c.game, c.code, c.image_small);
          return (
            <button key={c.id} type="button" onClick={() => onPick(c)} className="text-left group">
              <Card className="overflow-hidden bg-gradient-card hover:shadow-card transition-shadow">
                {img ? (
                  <img src={img} alt={c.name} loading="lazy"
                    onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                    className="w-full card-aspect object-cover" />
                ) : (
                  <div className="w-full card-aspect bg-muted flex items-center justify-center text-xs text-muted-foreground p-1 text-center">
                    {c.name}
                  </div>
                )}
                <div className="p-1.5">
                  <p className="text-xs font-medium truncate">{c.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{c.code}</p>
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
