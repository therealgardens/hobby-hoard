import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Heart, Plus, Loader2, Check } from "lucide-react";
import { cardImageCandidates } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";

type CardRow = Tables<"cards">;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Tutte le varianti (inclusa la base) per la stessa carta canonica. */
  variants: CardRow[];
  ownedCardIds: Set<string>;
  wantedCardIds: Set<string>;
  busyIds?: Set<string>;
  onAdd: (c: CardRow) => void | Promise<void>;
  onToggleWanted?: (c: CardRow) => void | Promise<void>;
  /** Etichetta opzionale per il bottone primario. Default "Aggiungi". */
  addLabel?: string;
}

function variantLabel(c: CardRow): string {
  const ext = (c.external_id ?? "").toLowerCase();
  const m = ext.match(/_p(\d+)$/);
  if (m) return `Parallel p${m[1]}`;
  if (/_aa$/.test(ext) || (c.rarity ?? "").toUpperCase() === "AA") return "Alt Art";
  if ((c.rarity ?? "").toUpperCase().includes("SP")) return "Special";
  if ((c.rarity ?? "").toUpperCase().includes("SEC")) return "Secret";
  return "Base";
}

export function VariantsDialog({
  open, onOpenChange, variants, ownedCardIds, wantedCardIds, busyIds,
  onAdd, onToggleWanted, addLabel = "Aggiungi",
}: Props) {
  const title = variants[0]?.name ?? "Varianti";
  const code = variants[0]?.code ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate">{title}</DialogTitle>
          <DialogDescription>
            {code} · {variants.length} {variants.length === 1 ? "versione" : "versioni"} disponibili
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
          {variants.map((c) => {
            const owned = ownedCardIds.has(c.id);
            const wanted = wantedCardIds.has(c.id);
            const busy = busyIds?.has(c.id) ?? false;
            return (
              <div key={c.id} className={`rounded-lg border overflow-hidden bg-card ${owned ? "ring-2 ring-primary/60" : ""}`}>
                <div className="relative">
                  <VImg card={c} />
                  {owned && (
                    <Badge className="absolute top-1 right-1 text-[10px] px-1 py-0">
                      <Check className="h-3 w-3" />
                    </Badge>
                  )}
                  <Badge variant="outline" className="absolute top-1 left-1 text-[10px] px-1 py-0 bg-background/80">
                    {variantLabel(c)}
                  </Badge>
                </div>
                <div className="p-2 space-y-1.5">
                  <p className="text-[10px] font-mono text-muted-foreground truncate">
                    {c.external_id ?? c.code}{c.rarity ? ` · ${c.rarity}` : ""}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      size="sm" className="flex-1 h-7 text-xs"
                      variant={owned ? "secondary" : "default"}
                      disabled={busy}
                      onClick={() => onAdd(c)}
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <><Plus className="h-3 w-3 mr-1" />{owned ? "+1" : addLabel}</>}
                    </Button>
                    {onToggleWanted && (
                      <Button
                        size="icon" variant="ghost"
                        className={`h-7 w-7 ${wanted ? "text-yellow-500" : "hover:text-yellow-500"}`}
                        onClick={() => onToggleWanted(c)}
                        title={wanted ? "Rimuovi dalla wishlist" : "Aggiungi alla wishlist"}
                      >
                        <Heart className="h-3 w-3" fill={wanted ? "currentColor" : "none"} />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VImg({ card }: { card: CardRow }) {
  const candidates = useMemo(
    () => cardImageCandidates(card.game, card.code, card.image_small ?? card.image_large),
    [card.game, card.code, card.image_small, card.image_large]
  );
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];
  if (!src) return <div className="w-full card-aspect bg-muted flex items-center justify-center text-[10px] text-muted-foreground">No image</div>;
  return <img src={src} alt={card.name} loading="lazy" className="w-full card-aspect object-cover" onError={() => setIdx((i) => i + 1)} />;
}

/** Raggruppa carte per codice canonico. Restituisce { base, variants } per ciascun gruppo. */
export function groupCardsByCanonical(cards: CardRow[]): { base: CardRow; variants: CardRow[] }[] {
  const groups = new Map<string, CardRow[]>();
  for (const c of cards) {
    const key = (c.code ?? c.id).toUpperCase();
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  return Array.from(groups.values()).map((arr) => {
    const base =
      arr.find((c) => {
        const ext = (c.external_id ?? "").toLowerCase();
        return !/_p\d+$/.test(ext) && !/_aa$/.test(ext);
      }) ?? arr[0];
    // base prima, poi le altre ordinate per external_id per stabilità
    const rest = arr.filter((c) => c.id !== base.id)
      .sort((a, b) => (a.external_id ?? "").localeCompare(b.external_id ?? ""));
    return { base, variants: [base, ...rest] };
  });
}

/** Filtra le carte non valide (senza immagine o residui legacy tcgdex). */
export function isValidCard(c: { image_small?: string | null; image_large?: string | null; external_id?: string | null }): boolean {
  if ((c.external_id ?? "").toLowerCase().startsWith("tcgdex-")) return false;
  return !!(c.image_small || c.image_large);
}
