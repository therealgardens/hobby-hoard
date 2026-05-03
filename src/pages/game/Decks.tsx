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
//   Yu-Gi-Oh!: LOB-005, MRD-EN001, BLAR-EN045
const CODE_RE = /([A-Z]{2,4}-(?:[A-Z]{2,3})?\d{2,4})/i;

function parseDeckList(raw: string): { code: string; copies: number }[] {
  const out: { code: string; copies: number }[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const codeMatch = t.match(CODE_RE);
    if (!codeMatch) continue;
    const code = codeMatch[1].toUpperCase();
    let copies = 1;
    const before = t.slice(0, codeMatch.index ?? 0);
    const after = t.slice((codeMatch.index ?? 0) + codeMatch[1].length);
    const mBefore = before.match(/(\d+)\s*[xX]?\s*$/) || before.match(/^\s*(\d+)\b/);
    const mAfter = after.match(/^\s*[xX]?\s*(\d+)/);
    if (mBefore) copies = parseInt(mBefore[1], 10);
    else if (mAfter) copies = parseInt(mAfter[1], 10);
    if (!copies || copies < 1) copies = 1;
    out.push({ code, copies });
  }
  return out;
}

const PLACEHOLDERS: Record<string, string> = {
  onepiece: "Leader\n1 Lucy (OP15-002)\n\nCharacter (26)\n4 Viola (OP15-040)\n4 Leo (OP15-052)",
  yugioh: "Main Deck\n3 Dark Magician (LOB-005)\n3 Pot of Greed (LOB-119)\n2 Mirror Force (MRD-138)",
};

export default function Decks() {
  const { game } = useParams<{ game: Game }>();
  const currentGame: Game = (game === "yugioh" ? "yugioh" : "onepiece");

  const [decks, setDecks] = useState<Deck[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const [active, setActive] = useState<Deck | null>(null);
  const [analysis, setAnalysis] = useState<{ code: string; needed: number; have: number; cardId?: string; name?: string; imageSmall?: string }[]>([]);

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
    const parsed = parseDeckList(raw);
    if (!parsed.length) return toast.error("Couldn't parse any cards");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: deck, error } = await supabase.from("decks").insert({
      user_id: u.user.id, name: name.trim(), raw_list: raw, game: currentGame,
    }).select().single();
    if (error || !deck) return toast.error(error?.message ?? "Failed");
    await supabase.from("deck_cards").insert(
      parsed.map(p => ({ deck_id: deck.id, user_id: u.user!.id, code: p.code, copies: p.copies })),
    );
    setName(""); setRaw(""); setOpen(false); load();
    toast.success(`Imported ${parsed.length} entries`);
  };

  const analyze = async (deck: Deck) => {
    setActive(deck);
    setAnalysis([]);
    const { data: dcards } = await supabase.from("deck_cards").select("*").eq("deck_id", deck.id);
    if (!dcards) return;
    const codes = dcards.map(d => d.code);
    let { data: cards } = await supabase.from("cards").select("*").eq("game", currentGame).in("code", codes);
    let cardByCode = new Map((cards ?? []).map(c => [c.code, c]));

    const missing = codes.filter(c => !cardByCode.has(c));
    if (missing.length) {
      await Promise.all(missing.map(code =>
        supabase.functions.invoke("card-search", { body: { game: currentGame, query: code } })
      ));
      const { data: refreshed } = await supabase.from("cards").select("*").eq("game", currentGame).in("code", codes);
      cards = refreshed ?? cards;
      cardByCode = new Map((cards ?? []).map(c => [c.code, c]));
    }

    const cardIds = (cards ?? []).map(c => c.id);
    const { data: entries } = await supabase.from("collection_entries").select("card_id,quantity").in("card_id", cardIds);
    const haveByCard = new Map<string, number>();
    (entries ?? []).forEach(e => haveByCard.set(e.card_id, (haveByCard.get(e.card_id) ?? 0) + (e.quantity ?? 0)));

    setAnalysis(dcards.map(d => {
      const c = cardByCode.get(d.code);
      return {
        code: d.code,
        needed: d.copies,
        have: c ? (haveByCard.get(c.id) ?? 0) : 0,
        cardId: c?.id,
        name: c?.name,
        imageSmall: c?.image_small ?? undefined,
      };
    }));
  };

  const ensureCardId = async (code: string): Promise<string | null> => {
    const { data: existing } = await supabase
      .from("cards").select("id").eq("game", currentGame).eq("code", code).maybeSingle();
    if (existing?.id) return existing.id;
    await supabase.functions.invoke("card-search", { body: { game: currentGame, query: code } });
    const { data: refreshed } = await supabase
      .from("cards").select("id").eq("game", currentGame).eq("code", code).maybeSingle();
    return refreshed?.id ?? null;
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
