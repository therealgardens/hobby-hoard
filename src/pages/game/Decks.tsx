import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Swords, Check, X, Minus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { cardImage, type Game } from "@/lib/game";
import { withDbRetry } from "@/lib/supabaseRetry";

type Deck = Tables<"decks">;

// Card code patterns:
//   One Piece: OP01-001, ST15-002 (and variants like _p1)
//   Yu-Gi-Oh!: LOB-005, MRD-EN001, BLAR-EN045, or 8-digit passcode like 46986414
const OP_CODE_RE = /\b([A-Z]{2,4}-(?:[A-Z]{2,3})?\d{2,4}[A-Za-z0-9_]*)\b/i;
const YGO_CODE_RE = /\b([A-Z]{2,5}-(?:[A-Z]{2,3})?\d{2,4}|\d{8})\b/i;

// Section headers like "Leader", "Character (26)", "Event (24)", "Main Deck", "Side Deck",
// "Extra Deck", "Stage", "Don!!", "Spell", "Trap", "Monster".
const SECTION_RE = /^(leader|characters?|events?|stages?|don!?!?|main\s*deck|side\s*deck|extra\s*deck|monsters?|spells?|traps?|extra|side)\b/i;

type ParsedEntry = { code: string | null; name: string | null; copies: number };

function parseDeckList(raw: string, game: Game): ParsedEntry[] {
  const codeRe = game === "yugioh" ? YGO_CODE_RE : OP_CODE_RE;
  const out: ParsedEntry[] = [];
  for (const lineRaw of raw.split("\n")) {
    const line = lineRaw.trim();
    if (!line) continue;
    const t = line.replace(/^[-•*]\s*/, "");

    // Quantity at start: "4 ", "4x ", "x4 "
    const qtyMatch = t.match(/^(?:x\s*)?(\d+)\s*[xX]?\s+/);
    const hasLeadingQty = !!qtyMatch;
    const copies = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1;
    const rest = (qtyMatch ? t.slice(qtyMatch[0].length) : t).trim();

    const codeMatch = rest.match(codeRe);
    const code = codeMatch ? codeMatch[1].toUpperCase() : null;

    let name: string | null = null;
    if (code) {
      const idx = rest.toUpperCase().indexOf(code);
      const before = rest.slice(0, idx).replace(/[\(\[]\s*$/, "").trim();
      const after = rest.slice(idx + code.length).replace(/^\s*[\)\]]/, "").trim();
      name = [before, after].filter(Boolean).join(" ").trim() || null;
    } else {
      name = rest || null;
    }

    // Skip section headers
    if (!hasLeadingQty && !code && name && SECTION_RE.test(name)) continue;
    if (!hasLeadingQty && !code && (!name || name.length < 2)) continue;
    if (!code && !name) continue;
    out.push({ code, name, copies });
  }
  return out;
}

const PLACEHOLDERS: Record<string, string> = {
  onepiece: "Leader\n1 Lucy (OP15-002)\n\nCharacter (26)\n4 Viola (OP15-040)\n4 Leo (OP15-052)",
  yugioh: "Main Deck\n3 Dark Magician (LOB-005)\n3 Pot of Greed\n2 46986414",
};

export default function Decks() {
  const { game } = useParams<{ game: Game }>();
  const currentGame: Game = (game === "yugioh" ? "yugioh" : "onepiece");

  const [decks, setDecks] = useState<Deck[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const [active, setActive] = useState<Deck | null>(null);
  type AnalysisRow = {
    key: string;
    code: string | null;
    queryName: string | null;
    needed: number;
    have: number;
    cardId?: string;
    name?: string;
    imageSmall?: string;
  };
  const [analysis, setAnalysis] = useState<AnalysisRow[]>([]);
  const [toDelete, setToDelete] = useState<Deck | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    const { data, error } = await withDbRetry(() =>
      supabase.from("decks").select("*").eq("game", currentGame).order("created_at"),
    );
    if (error) return toast.error(error.message);
    setDecks(data ?? []);
  };
  useEffect(() => { load(); }, [currentGame]);

  const create = async () => {
    if (!name.trim() || !raw.trim()) return;
    const parsed = parseDeckList(raw, currentGame);
    if (!parsed.length) return toast.error("Couldn't parse any cards");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: deck, error } = await supabase.from("decks").insert({
      user_id: u.user.id, name: name.trim(), raw_list: raw, game: currentGame,
    }).select().single();
    if (error || !deck) return toast.error(error?.message ?? "Failed");
    await supabase.from("deck_cards").insert(
      parsed.map(p => ({
        deck_id: deck.id,
        user_id: u.user!.id,
        code: p.code,
        name: p.name,
        copies: p.copies,
      })),
    );
    setName(""); setRaw(""); setOpen(false); load();
    toast.success(`Imported ${parsed.length} entries`);
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const id = toDelete.id;
    await supabase.from("deck_cards").delete().eq("deck_id", id);
    const { error } = await supabase.from("decks").delete().eq("id", id);
    setDeleting(false);
    setToDelete(null);
    if (error) return toast.error(error.message);
    setDecks(prev => prev.filter(d => d.id !== id));
    toast.success("Deck deleted");
  };

  const analyze = async (deck: Deck) => {
    setActive(deck);
    setAnalysis([]);
    const { data: dcards } = await supabase
      .from("deck_cards")
      .select("id, code, name, copies")
      .eq("deck_id", deck.id);
    if (!dcards) return;

    const codes = Array.from(new Set(dcards.map(d => d.code).filter((c): c is string => !!c)));
    const names = Array.from(new Set(dcards.map(d => (d as any).name).filter((n): n is string => !!n)));

    // Fetch by code
    let cardByCode = new Map<string, any>();
    let cardByName = new Map<string, any>();

    if (codes.length) {
      const { data: cards } = await supabase.from("cards").select("*").eq("game", currentGame).in("code", codes);
      cardByCode = new Map((cards ?? []).map(c => [c.code as string, c]));
      const missing = codes.filter(c => !cardByCode.has(c));
      if (missing.length) {
        await Promise.all(missing.map(code =>
          supabase.functions.invoke("card-search", { body: { game: currentGame, query: code } })
        ));
        const { data: refreshed } = await supabase.from("cards").select("*").eq("game", currentGame).in("code", codes);
        cardByCode = new Map((refreshed ?? []).map(c => [c.code as string, c]));
      }
    }

    // For name-only entries, search by exact name (case-insensitive)
    const nameOnlyEntries = dcards.filter(d => !d.code && (d as any).name);
    for (const e of nameOnlyEntries) {
      const n = ((e as any).name as string).trim();
      const key = n.toLowerCase();
      if (cardByName.has(key)) continue;
      let { data: hit } = await supabase
        .from("cards").select("*").eq("game", currentGame).ilike("name", n).limit(1).maybeSingle();
      if (!hit) {
        await supabase.functions.invoke("card-search", { body: { game: currentGame, query: n } });
        const { data: refreshed } = await supabase
          .from("cards").select("*").eq("game", currentGame).ilike("name", n).limit(1).maybeSingle();
        hit = refreshed ?? null;
      }
      if (hit) cardByName.set(key, hit);
    }

    const allCards = [...cardByCode.values(), ...cardByName.values()];
    const cardIds = Array.from(new Set(allCards.map(c => c.id)));
    const haveByCard = new Map<string, number>();
    if (cardIds.length) {
      const { data: entries } = await supabase
        .from("collection_entries").select("card_id,quantity").in("card_id", cardIds);
      (entries ?? []).forEach(e => haveByCard.set(e.card_id, (haveByCard.get(e.card_id) ?? 0) + (e.quantity ?? 0)));
    }

    setAnalysis(dcards.map(d => {
      const dn = (d as any).name as string | null;
      const c = d.code ? cardByCode.get(d.code) : (dn ? cardByName.get(dn.toLowerCase()) : undefined);
      return {
        key: d.id,
        code: d.code,
        queryName: dn,
        needed: d.copies,
        have: c ? (haveByCard.get(c.id) ?? 0) : 0,
        cardId: c?.id,
        name: c?.name ?? dn ?? d.code ?? "Unknown",
        imageSmall: c?.image_small ?? undefined,
      };
    }));
  };

  const ensureCardId = async (a: AnalysisRow): Promise<string | null> => {
    if (a.cardId) return a.cardId;
    if (a.code) {
      const { data: existing } = await supabase
        .from("cards").select("id").eq("game", currentGame).eq("code", a.code).maybeSingle();
      if (existing?.id) return existing.id;
      await supabase.functions.invoke("card-search", { body: { game: currentGame, query: a.code } });
      const { data: refreshed } = await supabase
        .from("cards").select("id").eq("game", currentGame).eq("code", a.code).maybeSingle();
      return refreshed?.id ?? null;
    }
    if (a.queryName) {
      const { data: existing } = await supabase
        .from("cards").select("id").eq("game", currentGame).ilike("name", a.queryName).limit(1).maybeSingle();
      if (existing?.id) return existing.id;
      await supabase.functions.invoke("card-search", { body: { game: currentGame, query: a.queryName } });
      const { data: refreshed } = await supabase
        .from("cards").select("id").eq("game", currentGame).ilike("name", a.queryName).limit(1).maybeSingle();
      return refreshed?.id ?? null;
    }
    return null;
  };

  const addOne = async (a: typeof analysis[number]) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const cardId = a.cardId ?? await ensureCardId(a.code);
    if (!cardId) return toast.error(`Card ${a.code} not found in catalog`);
    const { error } = await supabase.from("collection_entries").insert({
      user_id: u.user.id, card_id: cardId, game: currentGame,
      rarity: null, language: "EN", quantity: 1,
    });
    if (error) return toast.error(error.message);
    setAnalysis(prev => prev.map(p => p.code === a.code ? { ...p, have: p.have + 1, cardId } : p));
    toast.success(`Added ${a.name ?? a.code}`);
  };

  const removeOne = async (a: typeof analysis[number]) => {
    if (a.have <= 0) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const cardId = a.cardId ?? await ensureCardId(a.code);
    if (!cardId) return;
    const { data: rows } = await supabase
      .from("collection_entries")
      .select("id")
      .eq("user_id", u.user.id)
      .eq("card_id", cardId)
      .order("created_at", { ascending: false })
      .limit(1);
    const target = rows?.[0]?.id;
    if (!target) return;
    const { error } = await supabase.from("collection_entries").delete().eq("id", target);
    if (error) return toast.error(error.message);
    setAnalysis(prev => prev.map(p => p.code === a.code ? { ...p, have: Math.max(0, p.have - 1), cardId } : p));
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-4xl font-display">Decks</h2>
          <p className="text-muted-foreground">Import a deck list, see what you have vs. need.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Import deck</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Import deck list</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder={currentGame === "yugioh" ? "Blue-Eyes Control" : "Red Aggro"} /></div>
              <div>
                <Label>List</Label>
                <Textarea
                  rows={10}
                  value={raw}
                  onChange={e => setRaw(e.target.value)}
                  placeholder={PLACEHOLDERS[currentGame]}
                />
              </div>
              <Button className="w-full" onClick={create}>Import</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {decks.length === 0 ? (
        <Card className="p-12 text-center bg-gradient-card">
          <Swords className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">No decks yet — import your first one above.</p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {decks.map(d => (
            <Card key={d.id} className="p-5 bg-gradient-card cursor-pointer hover:shadow-pop transition-all" onClick={() => analyze(d)}>
              <Swords className="h-5 w-5 text-primary mb-2" />
              <h3 className="text-2xl font-display">{d.name}</h3>
              <p className="text-xs text-muted-foreground">Tap to check what you need</p>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{active?.name}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {analysis.map(a => {
              const ok = a.have >= a.needed;
              const owned = a.have > 0;
              const imgSrc = cardImage(currentGame, a.code, a.imageSmall);
              return (
                <div key={a.code} className="relative rounded-lg overflow-hidden bg-muted shadow-soft">
                  <img
                    src={imgSrc}
                    alt={a.name ?? a.code}
                    loading="lazy"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }}
                    className={`w-full card-aspect object-cover ${owned ? "" : "opacity-40 grayscale"}`}
                  />
                  {!owned && (
                    <div className="absolute inset-0 bg-background/40 pointer-events-none" />
                  )}
                  <div className="absolute top-1 right-1 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-background/90 shadow">
                    {ok ? <Check className="h-3 w-3 text-green-600" /> : <X className="h-3 w-3 text-destructive" />}
                    {a.have}/{a.needed}
                  </div>
                  <div className="p-2 bg-card space-y-1">
                    <p className="text-xs font-semibold truncate">{a.name ?? a.code}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{a.code}</p>
                    <div className="flex items-center justify-between gap-1 pt-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-6 w-6"
                        disabled={a.have <= 0}
                        onClick={() => removeOne(a)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="text-xs font-semibold tabular-nums">{a.have}</span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-6 w-6"
                        disabled={false}
                        onClick={() => addOne(a)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {analysis.some(a => a.have > 0 && a.have < a.needed) && (
            <p className="text-xs text-muted-foreground pt-2">
              💡 Faded cards are ones you don't own yet.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
