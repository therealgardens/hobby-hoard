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

    // 1xOP15-002 / 4xEB03-053 / 3xLEDE-EN001
    let m = t.match(
      /^(\d+)\s*[xX]\s*([A-Z0-9]{2,10}-(?:[A-Z]{0,3})?\d{2,4}[A-Z0-9_-]*)$/i
    );
    if (m) {
      results.push({
        copies: Math.max(1, parseInt(m[1], 10)),
        code: m[2].toUpperCase(),
      });
      continue;
    }

    // 1 Boa Hancock (OP14-041)
    m = t.match(
      /^(\d+)\s+.+?\\(([A-Z0-9]{2,10}-(?:[A-Z]{0,3})?\d{2,4}[A-Z0-9_-]*)\\)$/i
    );
    if (m) {
      results.push({
        copies: Math.max(1, parseInt(m[1], 10)),
        code: m[2].toUpperCase(),
      });
      continue;
    }

    // Solo codice: OP15-002
    m = t.match(
      /^([A-Z0-9]{2,10}-(?:[A-Z]{0,3})?\d{2,4}[A-Z0-9_-]*)$/i
    );
    if (m) {
      results.push({
        copies: 1,
        code: m[1].toUpperCase(),
      });
      continue;
    }

    // Yu-Gi-Oh per nome: 3 Crystal Bond
    if (game === "yugioh") {
      m = t.match(/^(\d+)\s+(.+)$/);
      if (m) {
        const copies = Math.max(1, parseInt(m[1], 10));
        const name = m[2].trim();
        if (name) {
          results.push({ copies, name });
          continue;
        }
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

    if (error) {
      console.error("load decks error", error);
      toast.error(error.message);
      return;
    }

    setDecks(data ?? []);
  };

  useEffect(() => {
    void load();
  }, [currentGame]);

  const create = async () => {
    try {
      if (!deckName.trim()) {
        toast.error("Inserisci un nome deck");
        return;
      }

      if (!raw.trim()) {
        toast.error("Incolla una lista carte");
        return;
      }

      const parsed = parseDeckList(raw, currentGame);

      if (!parsed.length) {
        toast.error("Nessuna carta trovata nel testo");
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser();

      if (authError) {
        console.error("auth error", authError);
        toast.error(authError.message);
        return;
      }

      const user = authData?.user;

      if (!user) {
        toast.error("Utente non autenticato");
        return;
      }

      const { data: deck, error: deckError } = await supabase
        .from("decks")
        .insert({
          user_id: user.id,
          name: deckName.trim(),
          raw_list: raw,
          game: currentGame,
        })
        .select()
        .single();

      if (deckError || !deck) {
        console.error("deck insert error", deckError);
        toast.error(deckError?.message ?? "Errore creazione deck");
        return;
      }

      const rows = parsed.map((p) => ({
        deck_id: deck.id,
        user_id: user.id,
        code: p.code ?? null,
        name: p.name ?? null,
        copies: p.copies,
      }));

      const { error: deckCardsError } = await supabase.from("deck_cards").insert(rows);

      if (deckCardsError) {
        console.error("deck_cards insert error", deckCardsError);
        toast.error(deckCardsError.message);
        return;
      }

      setDeckName("");
      setRaw("");
      setOpen(false);

      await load();
      await analyze(deck);

      toast.success(`Importate ${parsed.length} carte`);
    } catch (err: any) {
      console.error("create crashed", err);
      toast.error(err?.message ?? "Errore inatteso durante l'import");
    }
  };

  const analyze = async (deck: Deck) => {
    try {
      setActive(deck);
      setCards([]);

      const { data: dcards, error: dcardsError } = await supabase
        .from("deck_cards")
        .select("id, code, name, copies")
        .eq("deck_id", deck.id);

      if (dcardsError) {
        console.error("deck_cards load error", dcardsError);
        toast.error(dcardsError.message);
        return;
      }

      if (!dcards?.length) return;

      const entries = dcards.map((d) => ({
        key: d.id,
        code: d.code?.toUpperCase() ?? null,
        name: d.name ?? null,
        copies: d.copies,
      }));

      const finalCards: DeckCard[] = [];
      const matchedCardIds = new Set<string>();

      for (const entry of entries) {
        let matchedCard: any = null;

        if (entry.code) {
          const { data: byCode, error: byCodeError } = await supabase
            .from("cards")
            .select("id, code, name, image_small, game")
            .eq("game", currentGame)
            .ilike("code", entry.code)
            .maybeSingle();

          if (byCodeError) {
            console.error("byCode lookup error", byCodeError);
          } else if (byCode) {
            matchedCard = byCode;
          }
        }

        if (!matchedCard && entry.name) {
          const { data: byName, error: byNameError } = await supabase
            .from("cards")
            .select("id, code, name, image_small, game")
            .eq("game", currentGame)
            .ilike("name", entry.name)
            .maybeSingle();

          if (byNameError) {
            console.error("byName lookup error", byNameError);
          } else if (byName) {
            matchedCard = byName;
          }
        }

        if (matchedCard?.id) {
          matchedCardIds.add(matchedCard.id);
        }

        finalCards.push({
          key: entry.key,
          code: matchedCard?.code ?? entry.code ?? "UNKNOWN",
          copies: entry.copies,
          have: 0,
          cardId: matchedCard?.id,
          name: matchedCard?.name ?? entry.name ?? entry.code ?? "Carta",
          imageSmall: matchedCard?.image_small ?? null,
          game: matchedCard?.game ?? currentGame,
        });
      }

      const haveMap = new Map<string, number>();

      if (matchedCardIds.size > 0) {
        const { data: collectionRows, error: collectionError } = await supabase
          .from("collection_entries")
          .select("card_id, quantity")
          .in("card_id", Array.from(matchedCardIds));

        if (collectionError) {
          console.error("collection entries error", collectionError);
          toast.error(collectionError.message);
          return;
        }

        for (const row of collectionRows ?? []) {
          haveMap.set(row.card_id, (haveMap.get(row.card_id) ?? 0) + (row.quantity ?? 0));
        }
      }

      setCards(
        finalCards.map((card) => ({
          ...card,
          have: card.cardId ? (haveMap.get(card.cardId) ?? 0) : 0,
        }))
      );
    } catch (err: any) {
      console.error("analyze crashed", err);
      toast.error(err?.message ?? "Errore durante l'analisi del deck");
    }
  };

  const addOne = async (card: DeckCard) => {
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();

      if (authError) {
        toast.error(authError.message);
        return;
      }

      const user = authData?.user;
      if (!user) {
        toast.error("Utente non autenticato");
        return;
      }

      let cardId = card.cardId;

      if (!cardId && card.code && card.code !== "UNKNOWN") {
        const { data, error } = await supabase
          .from("cards")
          .select("id")
          .eq("game", currentGame)
          .ilike("code", card.code)
          .maybeSingle();

        if (error) {
          toast.error(error.message);
          return;
        }

        cardId = data?.id;
      }

      if (!cardId && card.name) {
        const { data, error } = await supabase
          .from("cards")
          .select("id")
          .eq("game", currentGame)
          .ilike("name", card.name)
          .maybeSingle();

        if (error) {
          toast.error(error.message);
          return;
        }

        cardId = data?.id;
      }

      if (!cardId) {
        toast.error(`${card.name ?? card.code} non trovata nel catalogo`);
        return;
      }

      const { error } = await supabase.from("collection_entries").insert({
        user_id: user.id,
        card_id: cardId,
        game: currentGame,
        rarity: null,
        language: "EN",
        quantity: 1,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      setCards((prev) =>
        prev.map((p) =>
          p.key === card.key ? { ...p, have: p.have + 1, cardId } : p
        )
      );

      toast.success(`Aggiunta ${card.name ?? card.code}`);
    } catch (err: any) {
      console.error("addOne crashed", err);
      toast.error(err?.message ?? "Errore durante l'aggiunta");
    }
  };

  const removeOne = async (card: DeckCard) => {
    try {
      if (card.have <= 0 || !card.cardId) return;

      const { data: authData, error: authError } = await supabase.auth.getUser();

      if (authError) {
        toast.error(authError.message);
        return;
      }

      const user = authData?.user;
      if (!user) {
        toast.error("Utente non autenticato");
        return;
      }

      const { data: rows, error: rowsError } = await supabase
        .from("collection_entries")
        .select("id")
        .eq("user_id", user.id)
        .eq("card_id", card.cardId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (rowsError) {
        toast.error(rowsError.message);
        return;
      }

      const id = rows?.[0]?.id;
      if (!id) return;

      const { error } = await supabase
        .from("collection_entries")
        .delete()
        .eq("id", id);

      if (error) {
        toast.error(error.message);
        return;
      }

      setCards((prev) =>
        prev.map((p) =>
          p.key === card.key ? { ...p, have: Math.max(0, p.have - 1) } : p
        )
      );
    } catch (err: any) {
      console.error("removeOne crashed", err);
      toast.error(err?.message ?? "Errore durante la rimozione");
    }
  };

  const confirmDelete = async () => {
    try {
      if (!toDelete) return;

      setDeleting(true);

      const { error: cardsDeleteError } = await supabase
        .from("deck_cards")
        .delete()
        .eq("deck_id", toDelete.id);

      if (cardsDeleteError) {
        setDeleting(false);
        toast.error(cardsDeleteError.message);
        return;
      }

      const { error } = await supabase
        .from("decks")
        .delete()
        .eq("id", toDelete.id);

      setDeleting(false);
      setToDelete(null);

      if (error) {
        toast.error(error.message);
        return;
      }

      setDecks((prev) => prev.filter((d) => d.id !== toDelete.id));
      toast.success("Deck eliminato");
    } catch (err: any) {
      setDeleting(false);
      console.error("confirmDelete crashed", err);
      toast.error(err?.message ?? "Errore durante l'eliminazione");
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
            <Button type="button">
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
                    "One Piece:\n1xOP15-002\n4xOP15-053\n\noppure:\n1 Boa Hancock (OP14-041)\n\nYu-Gi-Oh:\n3 Crystal Bond\n\noppure:\n3 Gandora (LEDE-EN001)"
                  }
                />
              </div>

              <Button
                type="button"
                className="w-full"
                onClick={() => {
                  void create();
                }}
              >
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
                onClick={() => {
                  void analyze(d);
                }}
              >
                <Swords className="h-5 w-5 text-primary mb-2" />
                <h3 className="text-2xl font-display pr-8">{d.name}</h3>
                <p className="text-xs text-muted-foreground">
                  Tocca per controllare cosa ti manca
                </p>
              </Card>

              <Button
                type="button"
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
              onClick={() => {
                void confirmDelete();
              }}
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

                  {!owned && (
                    <div className="absolute inset-0 bg-background/40 pointer-events-none" />
                  )}

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
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-6 w-6"
                        disabled={card.have <= 0}
                        onClick={() => {
                          void removeOne(card);
                        }}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>

                      <span className="text-xs font-semibold tabular-nums">{card.have}</span>

                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-6 w-6"
                        onClick={() => {
                          void addOne(card);
                        }}
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
