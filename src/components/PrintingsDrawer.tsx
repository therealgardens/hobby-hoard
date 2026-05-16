import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Minus, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { addOwnership, removeOwnership } from "@/lib/ownership";
import { emitCollectionChanged } from "@/lib/collectionEvents";
import type { Tables } from "@/integrations/supabase/types";

type CardRow = Tables<"cards">;

interface Printing {
  id: string;
  printing_code: string;
  variant_type: string;
  rarity: string | null;
  finish: string | null;
  language: string;
  image_small: string | null;
  image_large: string | null;
  source: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  card: CardRow | null;
  /** Optional callback when user picks a printing (used by CardSearch for "add to binder" flow). */
  onPick?: (p: Printing) => void;
  pickLabel?: string;
  /** When false, hides the +/− ownership buttons (pure picker mode). */
  showOwnershipControls?: boolean;
}

const VARIANT_LABEL: Record<string, string> = {
  base: "Base",
  alt_art: "Alt Art",
  parallel: "Parallel",
  promo: "Promo",
  reverse_holo: "Reverse Holo",
  full_art: "Full Art",
  secret: "Secret",
  manga: "Manga",
};

const VARIANT_TONE: Record<string, string> = {
  base: "bg-muted text-muted-foreground",
  alt_art: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
  parallel: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  promo: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  reverse_holo: "bg-teal-500/15 text-teal-600 dark:text-teal-300",
  full_art: "bg-pink-500/15 text-pink-600 dark:text-pink-300",
  secret: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  manga: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
};

export function PrintingsDrawer({ open, onOpenChange, card, onPick, pickLabel = "Seleziona", showOwnershipControls = true }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [printings, setPrintings] = useState<Printing[]>([]);
  const [owned, setOwned] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !card) return;
    setLoading(true);
    (async () => {
      const { data, error } = await (supabase as any)
        .from("card_printings")
        .select("id, printing_code, variant_type, rarity, finish, language, image_small, image_large, source")
        .eq("card_id", card.id)
        .order("variant_type", { ascending: true })
        .order("printing_code", { ascending: true });
      if (error) toast.error(error.message);
      setPrintings((data as Printing[]) ?? []);

      if (user && data?.length && showOwnershipControls) {
        const ids = data.map((p: any) => p.id);
        const { data: own } = await (supabase as any)
          .from("ownership")
          .select("printing_id, quantity")
          .eq("user_id", user.id)
          .in("printing_id", ids);
        const m = new Map<string, number>();
        for (const r of own ?? []) m.set(r.printing_id, (m.get(r.printing_id) ?? 0) + r.quantity);
        setOwned(m);
      } else {
        setOwned(new Map());
      }
      setLoading(false);
    })();
  }, [open, card?.id, user?.id, showOwnershipControls]);

  const flip = (id: string, on: boolean) =>
    setBusy((prev) => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });

  const onAdd = async (p: Printing) => {
    if (!user || !card) return;
    flip(p.id, true);
    try {
      const { error } = (await addOwnership(user.id, p.id, { language: p.language })) as any;
      if (error) throw error;
      setOwned((prev) => new Map(prev).set(p.id, (prev.get(p.id) ?? 0) + 1));
      toast.success(`Aggiunto ${card.name} · ${VARIANT_LABEL[p.variant_type] ?? p.variant_type}`);
      emitCollectionChanged({
        game: card.game as any,
        cardId: card.id,
        card: { set_id: card.set_id ?? null, set_name: card.set_name ?? null, code: card.code ?? null },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Errore");
    } finally {
      flip(p.id, false);
    }
  };

  const onRemove = async (p: Printing) => {
    if (!user || !card) return;
    flip(p.id, true);
    try {
      const { error } = (await removeOwnership(user.id, p.id, { language: p.language })) as any;
      if (error) throw error;
      setOwned((prev) => {
        const cur = prev.get(p.id) ?? 0;
        const next = Math.max(0, cur - 1);
        const n = new Map(prev);
        if (next === 0) n.delete(p.id); else n.set(p.id, next);
        return n;
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Errore");
    } finally {
      flip(p.id, false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="truncate">{card?.name ?? "Carta"}</SheetTitle>
          <SheetDescription>
            {card?.code ?? ""} · {printings.length} {printings.length === 1 ? "stampa" : "stampe"} disponibili
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && printings.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nessuna stampa indicizzata. Avvia il sync del catalogo per popolare le varianti.
            </p>
          )}
          {!loading && printings.map((p) => {
            const have = owned.get(p.id) ?? 0;
            const isBusy = busy.has(p.id);
            const tone = VARIANT_TONE[p.variant_type] ?? VARIANT_TONE.base;
            const label = VARIANT_LABEL[p.variant_type] ?? p.variant_type;
            return (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border p-2.5 bg-card">
                {p.image_small ? (
                  <img src={p.image_small} alt="" className="h-14 w-10 object-cover rounded shrink-0" loading="lazy" />
                ) : (
                  <div className="h-14 w-10 rounded bg-muted shrink-0" />
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tone}`}>{label}</span>
                    {p.rarity && <Badge variant="outline" className="text-[10px] px-1 py-0">{p.rarity}</Badge>}
                    {p.finish && <Badge variant="outline" className="text-[10px] px-1 py-0">{p.finish}</Badge>}
                  </div>
                  <p className="text-xs font-mono truncate text-muted-foreground">{p.printing_code} · {p.language}</p>
                </div>
                {onPick ? (
                  <Button size="sm" onClick={() => { onPick(p); onOpenChange(false); }}>
                    {pickLabel}
                  </Button>
                ) : showOwnershipControls ? (
                  <div className="flex items-center gap-1 shrink-0">
                    {have > 0 && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isBusy} onClick={() => onRemove(p)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                    )}
                    {have > 0 && <span className="text-xs font-mono tabular-nums w-5 text-center">{have}</span>}
                    <Button size="icon" variant={have > 0 ? "secondary" : "default"} className="h-7 w-7" disabled={isBusy} onClick={() => onAdd(p)}>
                      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : have > 0 ? <Plus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    </Button>
                  </div>
                ) : have > 0 ? (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                ) : null}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
