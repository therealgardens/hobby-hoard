import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Swords, Check, X } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Deck = Tables<"decks">;

// Parse formats like:
// 4 OP01-001
// OP01-001 x4
// 4xOP01-001
// 1 Lucy (OP15-002)
// 4 Viola (OP15-040)
// Section headers ("Leader", "Character (26)", "Event (24)") are ignored.
const CODE_RE = /([A-Z]{2,3}\d{2,3}[A-Z]?-\d{2,4})/i;
function parseDeckList(raw: string): { code: string; copies: number }[] {
  const out: { code: string; copies: number }[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const codeMatch = t.match(CODE_RE);
    if (!codeMatch) continue; // skip section headers / blank lines
    const code = codeMatch[1].toUpperCase();
    // Try several count patterns, in priority order:
    // 1) "<n> ... <code>"  (e.g. "4 Viola (OP15-040)" or "4 OP15-040")
    // 2) "<code> x<n>" or "<code> <n>"
    // 3) "<n>x<code>"
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

export default function Decks() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const [active, setActive] = useState<Deck | null>(null);
  const [analysis, setAnalysis] = useState<{ code: string; needed: number; have: number; cardId?: string }[]>([]);

  const load = async () => {
    const { data } = await supabase.from("decks").select("*").order("created_at");
    setDecks(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim() || !raw.trim()) return;
    const parsed = parseDeckList(raw);
    if (!parsed.length) return toast.error("Couldn't parse any cards");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: deck, error } = await supabase.from("decks").insert({
      user_id: u.user.id, name: name.trim(), raw_list: raw,
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
    const { data: dcards } = await supabase.from("deck_cards").select("*").eq("deck_id", deck.id);
    if (!dcards) return;
    const codes = dcards.map(d => d.code);
    const { data: cards } = await supabase.from("cards").select("*").eq("game", "onepiece").in("code", codes);
    const cardByCode = new Map((cards ?? []).map(c => [c.code, c]));
    // For have: look up collection_entries by card_id
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
      };
    }));
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
              <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Red Aggro" /></div>
              <div>
                <Label>List</Label>
                <Textarea
                  rows={10}
                  value={raw}
                  onChange={e => setRaw(e.target.value)}
                  placeholder={"Leader\n1 Lucy (OP15-002)\n\nCharacter (26)\n4 Viola (OP15-040)\n4 Leo (OP15-052)"}
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
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{active?.name}</DialogTitle></DialogHeader>
          <div className="space-y-1">
            {analysis.map(a => {
              const ok = a.have >= a.needed;
              return (
                <div key={a.code} className="flex items-center gap-3 p-2 rounded-lg bg-muted/40">
                  {ok ? <Check className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4 text-destructive" />}
                  <span className="font-mono text-sm">{a.code}</span>
                  <span className="ml-auto text-sm">{a.have} / {a.needed}</span>
                </div>
              );
            })}
            {analysis.some(a => a.have > 0 && a.have < a.needed) && (
              <p className="text-xs text-muted-foreground pt-2">
                💡 You already own some copies — make sure you didn't forget them when building.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
