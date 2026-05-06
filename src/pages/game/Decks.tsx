import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Swords, Check, X, Minus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { cardImage, type Game } from "@/lib/game";
import { withDbRetry } from "@/lib/supabaseRetry";

type Deck = Tables<"decks">;

type ParsedDeckEntry = {
  copies: number;
  code?: string;
  name?: string;
};

function parseDeckList(raw: string, game: Game): ParsedDeckEntry[] {
  const results: ParsedDeckEntry[] = [];
  const CODE_RE = /\b([A-Z]{2,5}\d{0,2}-(?:[A-Z]{0,3})?\d{2,4}[A-Za-z0-9_-]*)\b/i;

  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;

    if (
      t.startsWith("//") ||
      /^==.*==$/i.test(t) ||
      /^(monster cards|spell cards|trap cards|extra deck)\b/i.test(t)
    ) {
      continue;
    }

    // Supporta One Piece / Yu-Gi-Oh codice:
    // 1 Boa Hancock (OP14-041)
    // 4 Nami (EB03-053)
    // 1xOP15-002
    // 4xOP15-053
    // 3 Gandora (LEDE-EN001)
    const compactCode = t.match(/^(\d+)\s*[xX]\s*([A-Z]{2,5}\d{0,2}-(?:[A-Z]{0,3})?\d{2,4}[A-Za-z0-9_-]*)$/i);
    if (compactCode) {
      results.push({
        copies: Math.max(1, parseInt(compactCode[1], 10)),
        code: compactCode[2].toUpperCase(),
      });
      continue;
    }

    const codeMatch = t.match(CODE_RE);
    if (codeMatch) {
      const code = codeMatch[1].toUpperCase();
      let copies = 1;

      const qtyPatterns = [
        /^(\d+)\s*[xX]?\s*/,
        /(?:^|[\s(])(\d+)(?:[xX\)\s]|$)/,
        /[xX](\d+)/,
      ];

      for (const pattern of qtyPatterns) {
        const m = t.match(pattern);
        if (m) {
          copies = Math.max(1, parseInt(m[1], 10));
          break;
        }
      }

      results.push({ copies, code });
      continue;
    }

    // Yu-Gi-Oh per nome: "3 Crystal Bond"
    if (game === "yugioh") {
      const byName = t.match(/^(\d+)\s+(.+)$/);
      if (byName) {
        const copies = Math.max(1, parseInt(byName[1], 10));
        const name = byName[2].trim();
        if (name) results.push({ copies, name });
      }
    }
  }

  return results;
}

type DeckCard = {
  key: string;
  code: string;
  copies: number;
  have: number;
  cardId?: string;
  name?: string;
  imageSmall?: string | null;
  game?: string;
};

export default function Decks() {
  const { game } = useParams<{ game: Game }>();
  const currentGame: Game = game === "yugioh" ? "yugioh" : "onepiece";

  const [decks, setDecks] = useState<Deck[]>([]);
  const [open, setOpen] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [raw, setRaw] = useState("");
  const [active, setActive] = useState<Deck | null>(null);
  const [cards, setCards] = useState<DeckCard[]>([]);
  const [toDelete, setToDelete] = useState<Deck | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    const { data, error } = await withDbRetry(() =>
      supabase.from("decks").select("*").eq("game", currentGame).order("created_at")
    );
    if (error) return toast.error(error.message);
    setDecks(data ?? []);
  };

  useEffect(() => {
    load();
  }, [currentGame]);

  const create = async () => {
    if (!deckName.trim() || !raw.trim()) return;

    const parsed = parseDeckList(raw, currentGame);
    if (!parsed.length) return toast.error("Nessuna carta trovata nel testo");

    const {  u } = await supabase.auth.getUser();
    if (!u.user) return;

    const {  deck, error } = await supabase
      .from("decks")
      .insert({
        user_id: u.user.id,
        name: deckName.trim(),
        raw_list: raw,
        game: currentGame,
      })
      .select()
      .single();

    if (error || !deck) return toast.error(error?.message ?? "Failed");

    const rows = parsed.map((p) => ({
      deck_id: deck.id,
      user_id: u.user!.id,
      code: p.code ?? null,
      name: p.name ?? null,
      copies: p.copies,
    }));

    const { error: deckCardsError } = await supabase.from("deck_cards").insert(rows);
    if (deckCardsError) return toast.error(deckCardsError.message);

    setDeckName("");
    setRaw("");
    setOpen(false);
    await load();
    analyze(deck);
    toast.success(`Importate ${parsed.length} carte`);
  };

  const analyze = async (deck: Deck) => {
    setActive(deck);
    setCards([]);

    const {  dcards } = await supabase
      .from("deck_cards")
      .select("id, code, name, copies")
      .eq("deck_id", deck.id);

    if (!dcards?.length) return;

    const entries = dcards.map((d) => {
      let code = d.code?.toUpperCase() ?? null;

      if (!code && d.name) {
        const m = d.name.match(/\b([A-Z]{2,5}\d{0,2}-(?:[A-Z]{0,3})?\d{2,4}[A-Za-z0-9_-]*)\b/i);
        if (m) code = m[1].toUpperCase();
      }

      return {
        key: d.id,
        code,
        name: d.name ?? null,
        copies: d.copies,
      };
    });

    const codeEntries = entries.filter((e) => !!e.code) as {
      key: string;
      code: string;
      name: string | null;
      copies: number;
    }[];

    const nameEntries = entries.filter((e) => !e.code && !!e.name) as {
      key: string;
      code: null;
      name: string;
      copies: number;
    }[];

    const codeMap = new Map<string, any>();
    if (codeEntries.length) {
      const codes = Array.from(new Set(codeEntries.map((e) => e.code)));
      const {  dbCardsByCode } = await supabase
        .from("cards")
        .select("id, code, name, image_small, game")
        .eq("game", currentGame)
        .in("code", [...codes, ...codes.map((c) => c.toLowerCase())]);

      for (const c of dbCardsByCode ?? []) {
        codeMap.set(c.code?.toUpperCase(), c);
      }
    }

    const nameMap = new Map<string, any>();
    for (const entry of nameEntries) {
      const { data } = await supabase
        .from("cards")
        .select("id, code, name, image_small, game")
        .eq("game", currentGame)
        .ilike("name", entry.name)
        .maybeSingle();

      if (data) nameMap.set(entry.name.toLowerCase(), data);
    }

    const allMatchedCards = [
      ...Array.from(codeMap.values()),
      ...Array.from(nameMap.values()),
    ];

    const cardIds = Array.from(new Set(allMatchedCards.map((c) => c.id)));
    const haveMap = new Map<string, number>();

    if (cardIds.length) {
      const {  entries2 } = await supabase
        .from("collection_entries")
        .select("card_id, quantity")
        .in("card_id", cardIds);

      for (const e of entries2 ?? []) {
        haveMap.set(e.card_id, (haveMap.get(e.card_id) ?? 0) + (e.quantity ?? 0));
      }
    }

    const finalCards: DeckCard[] = entries.map((e) => {
      const c = e.code ? codeMap.get(e.code) : nameMap.get((e.name ?? "").toLowerCase());

      return {
        key: e.key,
        code: c?.code ?? e.code ?? "UNKNOWN",
        copies: e.copies,
        have: c ? (haveMap.get(c.id) ?? 0) : 0,
        cardId: c?.id,
        name: c?.name ?? e.name ?? e.code ?? "Carta",
        imageSmall: c?.image_small ?? null,
        game: c?.game ?? currentGame,
      };
    });

    setCards(finalCards);
  };

  const addOne = async (card: DeckCard) => {
    const {  u } = await supabase.auth.getUser();
    if (!u.user) return;

    let cardId = card.cardId;

    if (!cardId) {
      if (card.code && card.code !== "UNKNOWN") {
        const { data } = await supabase
          .from("cards")
          .select("id")
          .eq("game", currentGame)
          .ilike("code", card.code)
          .maybeSingle();
        cardId = data?.id;
      } else if (card.name) {
        const { data } = await supabase
          .from("cards")
          .select("id")
          .eq("game", currentGame)
          .ilike("name", card.name)
          .maybeSingle();
        cardId = data?.id;
      }
    }

    if (!cardId) return toast.error(`${card.name ?? card.code} non trovata nel catalogo`);

    await supabase.from("collection_entries").insert({
      user_id: u.user.id,
      card_id: cardId,
      game: currentGame,
      rarity: null,
      language: "EN",
      quantity: 1,
    });

    setCards((prev) =>
      prev.map((p) => (p.key === card.key ? { ...p, have: p.have + 1, cardId } : p))
    );

    toast.success(`Aggiunta ${card.name ?? card.code}`);
  };

  const removeOne = async (card: DeckCard) => {
    if (card.have <= 0 || !card.cardId) return;

    const {  u } = await supabase.auth.getUser();
    if (!u.user) return;

    const {  rows } = await supabase
      .from("collection_entries")
      .select("id")
      .eq("user_id", u.user.id)
      .eq("card_id", card.cardId)
      .order("created_at", { ascending: false })
      .limit(1);

    const id = rows?.[0]?.id;
    if (!id) return;

    await supabase.from("collection_entries").delete().eq("id", id);

    setCards((prev) =>
      prev.map((p) => (p.key === card.key ? { ...p, have: Math.max(0, p.have - 1) } : p))
    );
  };

  const confirmDelete = async () => {
    if (!toDelete) return;

    setDeleting(true);
    await supabase.from("deck_cards").delete().eq("deck_id", toDelete.id);
    const { error } = await supabase.from("decks").delete().eq("id", toDelete.id);
    setDeleting(false);
    setToDelete(null);

    if (error) return toast.error(error.message);

    setDecks((prev) => prev.filter((d) => d.id !== toDelete.id));
    toast.success("Deck eliminato");
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-4xl font-display">Decks</h2>
          <p className="text-muted-foreground">Importa una lista e vedi cosa ti manca.</p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-1" /> Importa deck
            </Button>
          </DialogTrigger>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>Importa deck</DialogTitle>
            </DialogHeader>

            <div className="space-y-3">
              <div>
                <Label>Nome</Label>
                <Input
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  placeholder="Es. Boa Hancock Aggro"
                />
              </div>

              <div>
                <Label>Lista carte</Label>
                <Textarea
                  rows={12}
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder={
                    "One Piece:\n1xOP15-002\n4xOP15-053\n\noppure:\n1 Boa Hancock (OP14-041)\n\nYu-Gi-Oh:\n3 Crystal Bond\n2 Rainbow Dragon\n\noppure:\n3 Gandora (LEDE-EN001)"
                  }
                />
              </div>

              <Button className="w-full" onClick={create}>
                Importa
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {decks.length === 0 ? (
        <Card className="p-12 text-center bg-gradient-card">
          <Swords className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">Nessun deck — importa il primo.</p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {decks.map((d) => (
            <div key={d.id} className="relative group">
              <Card
                className="p-5 bg-gradient-card cursor-pointer hover:shadow-pop transition-all"
                onClick={() => analyze(d)}
              >
                <Swords className="h-5 w-5 text-primary mb-2" />
                <h3 className="text-2xl font-display pr-8">{d.name}</h3>
                <p className="text-xs text-muted-foreground">
                  Tocca per controllare cosa ti manca
                </p>
              </Card>

              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2 h-8 w-8 opacity-70 hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  setToDelete(d);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare il deck?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.name}" verrà eliminato definitivamente.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Eliminando…" : "Elimina"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{active?.name}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {cards.map((card) => {
              const ok = card.have >= card.copies;
              const owned = card.have > 0;
              const img = cardImage(card.game ?? currentGame, card.code, card.imageSmall);

              return (
                <div
                  key={card.key}
                  className="relative rounded-lg overflow-hidden bg-muted shadow-soft"
                >
                  {img && (
                    <img
                      src={img}
                      alt={card.name}
                      loading="lazy"
                      className={`w-full card-aspect object-cover ${owned ? "" : "opacity-40 grayscale"}`}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.opacity = "0";
                      }}
                    />
                  )}

                  {!owned && <div className="absolute inset-0 bg-background/40 pointer-events-none" />}

                  <div className="absolute top-1 right-1 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-background/90 shadow">
                    {ok ? (
                      <Check className="h-3 w-3 text-green-600" />
                    ) : (
                      <X className="h-3 w-3 text-destructive" />
                    )}
                    {card.have}/{card.copies}
                  </div>

                  <div className="p-2 bg-card space-y-1">
                    <p className="text-xs font-semibold truncate">{card.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{card.code}</p>

                    <div className="flex items-center justify-between gap-1 pt-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-6 w-6"
                        disabled={card.have <= 0}
                        onClick={() => removeOne(card)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>

                      <span className="text-xs font-semibold tabular-nums">{card.have}</span>

                      <Button
                        size="icon"
                        variant="outline"
                        className="h-6 w-6"
                        onClick={() => addOne(card)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
