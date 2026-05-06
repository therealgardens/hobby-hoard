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

// ─── ONE PIECE PARSER ────────────────────────────────────────────────────────
// Gestisce:
//   1x OP15-002
//   1 OP15-002
//   1 Lucy (OP15-002)
//   1 Fo...llow...Me (OP10-059)   ← nomi con caratteri speciali
// Ignora righe di sezione: Leader, Character, Event, Stage
function parseOnePiece(raw: string): ParsedDeckEntry[] {
  const results: ParsedDeckEntry[] = [];

  // Regex del codice One Piece: OP##-### oppure EB##-### oppure ST##-### ecc.
  const OP_CODE = /[A-Z]{1,3}\d{2,3}-\d{3,4}/i;

  // Righe da saltare (sezioni)
  const SECTION = /^(leader|character|event|stage)\b/i;

  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("//") || SECTION.test(t)) continue;

    // Cerca il codice OP ovunque nella riga
    const codeMatch = t.match(OP_CODE);
    if (!codeMatch) continue;

    const code = codeMatch[0].toUpperCase();

    // Cerca la quantità all'inizio della riga: "4x..." oppure "4 ..."
    const qtyMatch = t.match(/^(\d+)\s*[xX]?\s*/);
    const copies = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1;

    results.push({ copies, code });
  }

  return results;
}

// ─── YU-GI-OH PARSER ─────────────────────────────────────────────────────────
// Gestisce:
//   Formato testo:  "3 Crystal Bond"  /  "1 LEDE-EN001"  /  "3 Gandora (LEDE-EN001)"
//   Formato JSON:   ["Exported from https://ygoprodeck.com/...", "10938846", "10938846", ...]
// Ignora: == MONSTER CARDS (58 cards) == e simili
function parseYugioh(raw: string): ParsedDeckEntry[] {
  const results: ParsedDeckEntry[] = [];

  // ── Formato JSON YGOPRODeck ──
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr: unknown[] = JSON.parse(trimmed);
      // Il primo elemento è sempre la stringa "Exported from ..."
      // Gli altri sono ID numerici (possibilmente duplicati = copie)
      const idCount = new Map<string, number>();
      for (const item of arr) {
        if (typeof item !== "string") continue;
        if (item.startsWith("Exported from") || item.startsWith("http")) continue;
        if (!/^\d+$/.test(item)) continue; // solo ID numerici
        idCount.set(item, (idCount.get(item) ?? 0) + 1);
      }
      for (const [id, copies] of idCount) {
        results.push({ copies, code: id });
      }
      return results;
    } catch {
      // Se il JSON non è valido, cade nel parser testo sotto
    }
  }

  // ── Formato testo ──
  // Regex codice YGO testuale: es. LEDE-EN001, PHNI-IT052, BLC1-EN123
  const YGO_CODE = /\b([A-Z]{2,8}-(?:[A-Z]{0,3})?\d{2,4})\b/i;

  // Righe di sezione da saltare
  const SECTION = /^==.*==\s*$/;

  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("//") || SECTION.test(t)) continue;

    // Formato con codice testuale esplicito (con o senza nome):
    // "3 Gandora (LEDE-EN001)" oppure "3 LEDE-EN001"
    const codeMatch = t.match(YGO_CODE);
    if (codeMatch) {
      const code = codeMatch[1].toUpperCase();
      const qtyMatch = t.match(/^(\d+)\s*/);
      const copies = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1;
      results.push({ copies, code });
      continue;
    }

    // Formato solo nome: "3 Crystal Bond"
    const nameMatch = t.match(/^(\d+)\s+(.+)$/);
    if (nameMatch) {
      const copies = Math.max(1, parseInt(nameMatch[1], 10));
      const name = nameMatch[2].trim();
      if (name) results.push({ copies, name });
    }
  }

  return results;
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────
function parseDeckList(raw: string, game: Game): ParsedDeckEntry[] {
  if (game === "onepiece") return parseOnePiece(raw);
  if (game === "yugioh") return parseYugioh(raw);
  return [];
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

// ─── LOOKUP CARTE ─────────────────────────────────────────────────────────────
// One Piece: cerca per codice (sempre disponibile dopo il parser)
async function lookupOnePieceCard(code: string, game: Game) {
  const { data } = await supabase
    .from("cards")
    .select("id, code, name, image_small, game")
    .eq("game", game)
    .ilike("code", code)
    .maybeSingle();
  return data ?? null;
}

// Yu-Gi-Oh: se il codice è numerico cerca per id esterno (YGOPRODeck),
// se è testuale cerca per codice, se è solo nome cerca per nome
async function lookupYugiohCard(entry: { code?: string; name?: string }, game: Game) {
  if (entry.code) {
    // ID numerico YGOPRODeck → colonna dedicata (es. external_id o ygo_id)
    if (/^\d+$/.test(entry.code)) {
      const { data } = await supabase
        .from("cards")
        .select("id, code, name, image_small, game")
        .eq("game", game)
        .eq("external_id", entry.code)
        .maybeSingle();
      if (data) return data;
    } else {
      // Codice testuale (LEDE-EN001)
      const { data } = await supabase
        .from("cards")
        .select("id, code, name, image_small, game")
        .eq("game", game)
        .ilike("code", entry.code)
        .maybeSingle();
      if (data) return data;
    }
  }

  // Fallback per nome
  if (entry.name) {
    const { data } = await supabase
      .from("cards")
      .select("id, code, name, image_small, game")
      .eq("game", game)
      .ilike("name", entry.name)
      .maybeSingle();
    if (data) return data;
  }

  return null;
}

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
    if (error) { toast.error(error.message); return; }
    setDecks(data ?? []);
  };

  useEffect(() => { void load(); }, [currentGame]);

  const create = async () => {
    try {
      if (!deckName.trim() || !raw.trim()) return;

      const parsed = parseDeckList(raw, currentGame);
      if (!parsed.length) {
        toast.error("Nessuna carta trovata nel testo");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;

      const { data: deck, error } = await supabase
        .from("decks")
        .insert({ user_id: userId, name: deckName.trim(), raw_list: raw, game: currentGame })
        .select()
        .single();

      if (error || !deck) {
        toast.error(error?.message ?? "Errore creazione deck");
        return;
      }

      const { error: insertCardsError } = await supabase.from("deck_cards").insert(
        parsed.map((p) => ({
          deck_id: deck.id,
          user_id: userId,
          code: p.code ?? null,
          name: p.name ?? null,
          copies: p.copies,
        }))
      );

      if (insertCardsError) {
        toast.error(insertCardsError.message);
        return;
      }

      setDeckName("");
      setRaw("");
      setOpen(false);
      await load();
      await analyze(deck);
      toast.success(`Importate ${parsed.length} carte`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Errore durante l'import");
    }
  };

  const analyze = async (deck: Deck) => {
    try {
      setActive(deck);
      setCards([]);

      const { data: dcards, error } = await supabase
        .from("deck_cards")
        .select("id, code, name, copies")
        .eq("deck_id", deck.id);

      if (error) { toast.error(error.message); return; }
      if (!dcards?.length) return;

      const finalCards: DeckCard[] = [];

      for (const d of dcards) {
        const code = d.code?.trim() ?? null;
        const name = d.name ?? null;

        // Lookup separato per gioco
        const matchedCard =
          currentGame === "yugioh"
            ? await lookupYugiohCard({ code: code ?? undefined, name: name ?? undefined }, currentGame)
            : code
            ? await lookupOnePieceCard(code, currentGame)
            : null;

        // Per YGO con ID numerico: il "code" da mostrare e usare per l'immagine
        // è l'ID numerico stesso finché non troviamo la carta nel DB
        const displayCode = matchedCard?.code ?? code ?? "UNKNOWN";
        const imageCode =
          matchedCard?.code ??
          (currentGame === "yugioh" && code && /^\d+$/.test(code) ? code : null) ??
          code ??
          null;

        finalCards.push({
          key: d.id,
          code: displayCode,
          copies: d.copies,
          have: 0,
          cardId: matchedCard?.id,
          name: matchedCard?.name ?? name ?? code ?? "Carta",
          imageSmall: matchedCard?.image_small ?? null,
          game: matchedCard?.game ?? currentGame,
          // salviamo imageCode separato per costruire l'URL correttamente
          _imageCode: imageCode,
        } as DeckCard & { _imageCode: string | null });
      }

      const cardIds = finalCards.map((c) => c.cardId).filter(Boolean) as string[];
      const haveMap = new Map<string, number>();

      if (cardIds.length) {
        const { data: entries } = await supabase
          .from("collection_entries")
          .select("card_id, quantity")
          .in("card_id", cardIds);

        for (const e of entries ?? []) {
          haveMap.set(e.card_id, (haveMap.get(e.card_id) ?? 0) + (e.quantity ?? 0));
        }
      }

      setCards(
        finalCards.map((c) => ({
          ...c,
          have: c.cardId ? (haveMap.get(c.cardId) ?? 0) : 0,
        }))
      );
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Errore analisi deck");
    }
  };

  const addOne = async (card: DeckCard) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;
      if (!userId) return;

      let cardId = card.cardId;

      if (!cardId) {
        const matched =
          currentGame === "yugioh"
            ? await lookupYugiohCard({ code: card.code !== "UNKNOWN" ? card.code : undefined, name: card.name }, currentGame)
            : card.code && card.code !== "UNKNOWN"
            ? await lookupOnePieceCard(card.code, currentGame)
            : null;

        cardId = matched?.id;
      }

      if (!cardId) {
        toast.error(`${card.name ?? card.code} non trovata nel catalogo`);
        return;
      }

      const { error } = await supabase.from("collection_entries").insert({
        user_id: userId,
        card_id: cardId,
        game: currentGame,
        rarity: null,
        language: "EN",
        quantity: 1,
      });

      if (error) { toast.error(error.message); return; }

      setCards((prev) =>
        prev.map((p) => p.key === card.key ? { ...p, have: p.have + 1, cardId } : p)
      );
      toast.success(`Aggiunta ${card.name ?? card.code}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Errore aggiunta carta");
    }
  };

  const removeOne = async (card: DeckCard) => {
    try {
      if (card.have <= 0 || !card.cardId) return;

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;
      if (!userId) return;

      const { data: rows } = await supabase
        .from("collection_entries")
        .select("id")
        .eq("user_id", userId)
        .eq("card_id", card.cardId)
        .order("created_at", { ascending: false })
        .limit(1);

      const id = rows?.[0]?.id;
      if (!id) return;

      await supabase.from("collection_entries").delete().eq("id", id);

      setCards((prev) =>
        prev.map((p) => p.key === card.key ? { ...p, have: Math.max(0, p.have - 1) } : p)
      );
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Errore rimozione carta");
    }
  };

  const confirmDelete = async () => {
    try {
      if (!toDelete) return;
      setDeleting(true);
      await supabase.from("deck_cards").delete().eq("deck_id", toDelete.id);
      const { error } = await supabase.from("decks").delete().eq("id", toDelete.id);
      setDeleting(false);
      setToDelete(null);
      if (error) { toast.error(error.message); return; }
      setDecks((prev) => prev.filter((d) => d.id !== toDelete.id));
      if (active?.id === toDelete.id) { setActive(null); setCards([]); }
      toast.success("Deck eliminato");
    } catch (err: any) {
      setDeleting(false);
      console.error(err);
      toast.error(err?.message ?? "Errore eliminazione deck");
    }
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
                    currentGame === "onepiece"
                      ? "1xOP15-002\n4 Viola (OP15-040)\n4xOP15-052"
                      : "3 Crystal Bond\n3 LEDE-EN001\n[\"Exported from ygoprodeck...\", \"10938846\", ...]"
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
                <p className="text-xs text-muted-foreground">Tocca per controllare cosa ti manca</p>
              </Card>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2 h-8 w-8 opacity-70 hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); setToDelete(d); }}
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

              // Usa _imageCode per costruire l'URL corretto (es. ID numerico per YGO)
              const imageCode = (card as any)._imageCode ?? card.code;
              const img =
                card.imageSmall
                  ? card.imageSmall
                  : cardImage(card.game ?? currentGame, imageCode, null);

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
                    {ok ? <Check className="h-3 w-3 text-green-600" /> : <X className="h-3 w-3 text-destructive" />}
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
