import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Download, Copy } from "lucide-react";
import { CardSearch } from "@/components/CardSearch";
import { toast } from "sonner";
import { cardImage, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { withDbRetry } from "@/lib/supabaseRetry";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type Wanted = Tables<"wanted_cards"> & { card: Tables<"cards"> | null };

export default function Wanted() {
  const { game } = useParams<{ game: Game }>();
  const { user, loading } = useAuth();
  const [items, setItems] = useState<Wanted[]>([]);
  const [editing, setEditing] = useState<Wanted | null>(null);
  const [editQty, setEditQty] = useState(1);

  const load = async () => {
    if (!game || loading) return;
    if (!user) {
      setItems([]);
      return;
    }
    const { data: wantedRows, error } = await withDbRetry(() =>
      supabase
        .from("wanted_cards")
        .select("*")
        .eq("game", game)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    );
    if (error) return toast.error(error.message);
    const rows = (wantedRows ?? []) as Tables<"wanted_cards">[];
    const cardIds = [...new Set(rows.map((row) => row.card_id))];
    const { data: cards, error: cardsError } = cardIds.length
      ? await withDbRetry(() => supabase.from("cards").select("*").in("id", cardIds))
      : { data: [], error: null };
    if (cardsError) return toast.error(cardsError.message);
    const cardsById = new Map(((cards ?? []) as Tables<"cards">[]).map((card) => [card.id, card]));
    setItems(rows.map((row) => ({ ...row, card: cardsById.get(row.card_id) ?? null })));
  };
  useEffect(() => { load(); }, [game, user?.id, loading]);

  const add = async (card: Tables<"cards">) => {
    if (!user) return toast.error("Not signed in");
    if (!game) return;
    const { error } = await withDbRetry(() =>
      supabase.from("wanted_cards").insert({
        user_id: user.id, card_id: card.id, game,
      }),
    );
    if (error) return toast.error(error.message);
    toast.success("Added to wishlist");
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("wanted_cards").delete().eq("id", id);
    setEditing(null);
    load();
  };

  const openEdit = (w: Wanted) => {
    setEditing(w);
    setEditQty(w.quantity ?? 1);
  };

  const saveQty = async () => {
    if (!editing) return;
    const q = Math.max(1, editQty);
    const { error } = await supabase
      .from("wanted_cards")
      .update({ quantity: q })
      .eq("id", editing.id);
    if (error) return toast.error(error.message);
    toast.success("Updated");
    setEditing(null);
    load();
  };

  const buildRows = () =>
    items.map((w) => ({
      quantity: w.quantity ?? 1,
      code: w.card?.code ?? "",
      name: w.card?.name ?? "",
      set: w.card?.set_name ?? "",
      rarity: w.rarity ?? w.card?.rarity ?? "",
      language: w.language ?? "EN",
    }));

  const exportCsv = () => {
    if (!items.length) return toast.error("Wishlist is empty");
    const rows = buildRows();
    const header = ["quantity", "code", "name", "set", "rarity", "language"];
    const escape = (v: any) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header.join(","), ...rows.map((r) => header.map((h) => escape((r as any)[h])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wishlist-${game}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  const copyText = async () => {
    if (!items.length) return toast.error("Wishlist is empty");
    const text = buildRows()
      .map((r) => `${r.quantity}x ${r.code}${r.name ? ` — ${r.name}` : ""}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy");
    }
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
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h3 className="font-display text-2xl">Your wishlist ({items.length})</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyText}>
                <Copy className="h-4 w-4 mr-2" /> Copy as text
              </Button>
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-2" /> Export CSV
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {items.map(w => {
              const img = cardImage(w.card?.game, w.card?.code, w.card?.image_small);
              return (
              <Card
                key={w.id}
                className="overflow-hidden bg-gradient-card relative group cursor-pointer hover:shadow-card transition-shadow"
                onClick={() => openEdit(w)}
              >
                {img && <img src={img} alt={w.card?.name} className="w-full card-aspect object-cover opacity-70" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />}
                <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-background/90 text-[11px] font-bold shadow">
                  ×{w.quantity ?? 1}
                </div>
                <div className="p-2">
                  <p className="text-xs font-semibold truncate">{w.card?.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{w.card?.code}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); remove(w.id); }}
                  className="absolute top-1 right-1 p-1 rounded-full bg-background/80 opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </Card>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="truncate">{editing?.card?.name ?? "Card"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{editing?.card?.code}</p>
            <label className="text-sm font-medium block">Quantity wanted</label>
            <Input
              type="number"
              min={1}
              value={editQty}
              onChange={(e) => setEditQty(Math.max(1, parseInt(e.target.value) || 1))}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="destructive" onClick={() => editing && remove(editing.id)}>
              <Trash2 className="h-4 w-4 mr-2" /> Remove
            </Button>
            <Button onClick={saveQty}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
