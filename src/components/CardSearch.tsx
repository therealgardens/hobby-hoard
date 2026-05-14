import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Heart, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cardImageCandidates, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { addWishlist, listWishlist, removeWishlistByCard } from "@/lib/wishlist";
import { withDbRetry } from "@/lib/supabaseRetry";
import { emitCollectionChanged } from "@/lib/collectionEvents";
import { useAuth } from "@/hooks/useAuth";

type CardRow = Tables<"cards">;

const LANGS = ["EN", "JP", "IT", "FR", "DE", "ES", "PT"];
const LANG_FLAG: Record<string, string> = {
  EN: "🇬🇧",
  JP: "🇯🇵",
  IT: "🇮🇹",
  FR: "🇫🇷",
  DE: "🇩🇪",
  ES: "🇪🇸",
  PT: "🇵🇹",
};

const RARITIES: Record<Game, string[]> = {
  onepiece: ["C", "UC", "R", "SR", "L", "SEC", "SP", "TR", "AA", "MR", "Promo"],
  yugioh: ["N", "R", "SR", "UR", "Ultimate Rare", "SEC", "Prismatic SR", "Quarter Century SEC", "Collectors Rare", "Ghost Rare", "Starlight Rare", "Promo"],
  pokemon: ["Common", "Uncommon", "Rare", "Double Rare", "Illustration Rare", "Ultra Rare", "Special Illustration Rare", "Hyper Rare", "Shiny Rare", "Shiny Ultra Rare", "Ace Spec", "Promo"],
};

function normalizeSetId(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function extractSetId(s: string | null | undefined): string | null {
  if (!s) return null;

  const mBracket = s.match(/\[([A-Z]{1,4}-?\d{1,3}[A-Z]?)\]/i);
  if (mBracket) return normalizeSetId(mBracket[1]);

  const mCode = s.match(/\b(OP|ST|EB|PRB|GC)-?(\d{1,3}[A-Z]?)\b/i);
  if (mCode) return normalizeSetId(`${mCode[1]}${mCode[2]}`);

  const mPokemon = s.match(/\b([A-Z]{2,5}\d{1,3})\b/i);
  if (mPokemon) return normalizeSetId(mPokemon[1]);

  return null;
}

function searchIndex(card: CardRow): string {
  return [
    card.name ?? "",
    card.code ?? "",
    card.number ?? "",
    card.rarity ?? "",
    card.set_name ?? "",
    card.set_id ?? "",
    card.type ?? "",
    card.attribute ?? "",
    card.color ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function cardDedupKey(card: CardRow): string {
  return [
    card.game ?? "",
    (card.code ?? "").toUpperCase(),
    (card.rarity ?? "").toUpperCase(),
    normalizeSetId(card.set_id),
    (card.image_small ?? card.image_large ?? "").trim(),
  ].join("::");
}

function CardImg({ card, className, alt }: { card: CardRow; className: string; alt: string }) {
  const candidates = useMemo(
    () => cardImageCandidates(card.game, card.code, card.image_small ?? card.image_large),
    [card.game, card.code, card.image_small, card.image_large]
  );
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];

  if (!src) {
    return <div className="w-full card-aspect bg-muted flex items-center justify-center text-muted-foreground text-xs">No image</div>;
  }

  return <img src={src} alt={alt} loading="lazy" className={className} onError={() => setIdx((i) => i + 1)} />;
}

function SearchSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <Card key={i} className="overflow-hidden bg-gradient-card">
          <Skeleton className="w-full card-aspect" />
          <div className="p-2 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function CardSearch({ game, autoLoad = true }: { game: Game; autoLoad?: boolean }) {
  const { user } = useAuth();

  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [loaded, setLoaded] = useState(!autoLoad);

  const [ownedCardIds, setOwnedCardIds] = useState<Set<string>>(new Set());
  const [ownedLangByCard, setOwnedLangByCard] = useState<Map<string, string>>(new Map());
  const [wantedCardIds, setWantedCardIds] = useState<Set<string>>(new Set());
  const [quickAddBusy, setQuickAddBusy] = useState<Set<string>>(new Set());
  const [wishlistBusy, setWishlistBusy] = useState<Set<string>>(new Set());

  const [picked, setPicked] = useState<CardRow | null>(null);
  const [pickedOwned, setPickedOwned] = useState(false);
  const [rarity, setRarity] = useState("");
  const [language, setLanguage] = useState("EN");
  const [quantity, setQuantity] = useState<number | "">(1);
  const [pickedTotalCopies, setPickedTotalCopies] = useState(0);
  const [savingCard, setSavingCard] = useState(false);

  const loadOwned = async () => {
    if (!game || !user) return;

    const { data: rows, error } = await withDbRetry(() =>
      supabase.from("collection_entries").select("card_id, language").eq("user_id", user.id).eq("game", game)
    );

    if (error) {
      console.warn("CardSearch loadOwned failed", error);
      return;
    }

    const ids = new Set<string>();
    const langs = new Map<string, string>();

    for (const row of (rows ?? []) as Array<{ card_id: string; language: string | null }>) {
      if (!row.card_id) continue;
      ids.add(row.card_id);
      if (row.language && !langs.has(row.card_id)) langs.set(row.card_id, row.language);
    }

    setOwnedCardIds(ids);
    setOwnedLangByCard(langs);
  };

  const loadWishlist = async () => {
    if (!game || !user) return;
    try {
      setWantedCardIds(new Set((await listWishlist(game)).map((item) => item.card_id)));
    } catch (_) {}
  };

  const loadCards = async () => {
    if (!game) return;

    setLoading(true);
    try {
      const { data: remote, error } = await supabase.functions.invoke("card-search", {
        body: { game, q: "", limit: 500 },
      });

      if (error) {
        console.warn("CardSearch remote load failed", error);
      }

      const remoteCards = ((remote?.cards as CardRow[]) ?? []);

      const { data: local } = await supabase.from("cards").select("*").eq("game", game).limit(3000);
      const localCards = (local ?? []) as CardRow[];

      const map = new Map<string, CardRow>();
      for (const c of [...localCards, ...remoteCards]) {
        const key = cardDedupKey(c);
        if (!map.has(key)) map.set(key, c);
      }

      const merged = Array.from(map.values()).sort((a, b) =>
        (a.code ?? "").localeCompare(b.code ?? "", undefined, { numeric: true, sensitivity: "base" })
      );

      setCards(merged);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCards([]);
    setQuery("");
    setLoaded(!autoLoad);
    setLoading(autoLoad);

    if (autoLoad) {
      loadCards();
    }

    loadOwned();
    loadWishlist();
  }, [game, user?.id, autoLoad]);

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((card) => searchIndex(card).includes(q));
  }, [cards, query]);

  const openCard = async (c: CardRow) => {
    setPicked(c);
    setPickedOwned(ownedCardIds.has(c.id));
    setRarity(c.rarity ?? "");
    setLanguage(ownedLangByCard.get(c.id) ?? "EN");
    setQuantity(1);
    setPickedTotalCopies(0);

    if (ownedCardIds.has(c.id) && user) {
      const { data } = await supabase
        .from("collection_entries")
        .select("quantity")
        .eq("card_id", c.id)
        .eq("user_id", user.id);

      const total = (data ?? []).reduce((sum: number, r: any) => sum + (r.quantity ?? 1), 0);
      setPickedTotalCopies(total);
    }
  };

  const quickAdd = async (c: CardRow) => {
    if (!game || !user || quickAddBusy.has(c.id)) return;

    setQuickAddBusy((prev) => new Set(prev).add(c.id));
    const wasOwned = ownedCardIds.has(c.id);

    const nextIds = new Set(ownedCardIds).add(c.id);
    const nextLangs = new Map(ownedLangByCard);
    if (!nextLangs.has(c.id)) nextLangs.set(c.id, "EN");

    setOwnedCardIds(nextIds);
    setOwnedLangByCard(nextLangs);

    try {
      const { data: existing } = await supabase
        .from("collection_entries")
        .select("id, quantity")
        .eq("user_id", user.id)
        .eq("card_id", c.id)
        .maybeSingle();

      let error;
      if (existing) {
        ({ error } = await withDbRetry(() =>
          supabase.from("collection_entries").update({ quantity: existing.quantity + 1 }).eq("id", existing.id)
        ));
      } else {
        ({ error } = await withDbRetry(() =>
          supabase.from("collection_entries").insert({
            user_id: user.id,
            card_id: c.id,
            game,
            rarity: c.rarity ?? null,
            language: "EN",
            quantity: 1,
          })
        ));
      }

      if (error) {
        const rollbackIds = new Set(ownedCardIds);
        if (!wasOwned) rollbackIds.delete(c.id);
        setOwnedCardIds(rollbackIds);
        setOwnedLangByCard(ownedLangByCard);
        return toast.error(error.message);
      }

      toast.success(`Added ${c.name}`);
      emitCollectionChanged({ game, cardId: c.id, card: c as any });
    } finally {
      setQuickAddBusy((prev) => {
        const n = new Set(prev);
        n.delete(c.id);
        return n;
      });
    }
  };

  const toggleWanted = async (c: CardRow) => {
    if (!game || !user || wishlistBusy.has(c.id)) return;

    setWishlistBusy((prev) => new Set(prev).add(c.id));
    const wasWanted = wantedCardIds.has(c.id);

    setWantedCardIds((prev) => {
      const n = new Set(prev);
      wasWanted ? n.delete(c.id) : n.add(c.id);
      return n;
    });

    try {
      if (wasWanted) {
        await removeWishlistByCard(c.id, game);
        toast.success("Removed from wishlist");
      } else {
        await addWishlist(c, game);
        toast.success("Added to wishlist");
      }
    } catch (error) {
      setWantedCardIds((prev) => {
        const n = new Set(prev);
        wasWanted ? n.add(c.id) : n.delete(c.id);
        return n;
      });
      toast.error(error instanceof Error ? error.message : "Wishlist action failed");
    } finally {
      setWishlistBusy((prev) => {
        const n = new Set(prev);
        n.delete(c.id);
        return n;
      });
    }
  };

  const saveCard = async () => {
    if (!picked || !game || !user || savingCard) return;

    setSavingCard(true);
    const qtyToAdd = Number(quantity) || 1;
    const savedId = picked.id;
    const wasOwned = ownedCardIds.has(savedId);

    const nextIds = new Set(ownedCardIds).add(savedId);
    const nextLangs = new Map(ownedLangByCard).set(savedId, language);
    setOwnedCardIds(nextIds);
    setOwnedLangByCard(nextLangs);
    setPicked(null);

    try {
      const { data: existing } = await supabase
        .from("collection_entries")
        .select("id, quantity")
        .eq("user_id", user.id)
        .eq("card_id", savedId)
        .maybeSingle();

      let error;
      if (existing) {
        ({ error } = await withDbRetry(() =>
          supabase.from("collection_entries").update({ quantity: existing.quantity + qtyToAdd }).eq("id", existing.id)
        ));
      } else {
        ({ error } = await withDbRetry(() =>
          supabase.from("collection_entries").insert({
            user_id: user.id,
            card_id: savedId,
            game,
            rarity: rarity === "__none__" ? null : rarity || null,
            language,
            quantity: qtyToAdd,
          })
        ));
      }

      if (error) {
        const rollbackIds = new Set(ownedCardIds);
        if (!wasOwned) rollbackIds.delete(savedId);
        setOwnedCardIds(rollbackIds);
        setOwnedLangByCard(ownedLangByCard);
        return toast.error(error.message);
      }

      toast.success(`Added ${picked?.name ?? "card"} ×${qtyToAdd}`);
      emitCollectionChanged({ game, cardId: savedId, card: picked as any });
    } finally {
      setSavingCard(false);
    }
  };

  const gameRarities = RARITIES[game] ?? [];

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cerca per nome, codice, set, rarità..."
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!autoLoad && !loaded && (
          <Button onClick={loadCards} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Carica carte
          </Button>
        )}
      </div>

      {loading ? (
        <SearchSkeleton />
      ) : filteredCards.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">
          {loaded ? "Nessuna carta trovata." : "Premi “Carica carte” per iniziare la ricerca."}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredCards.map((c) => {
            const owned = ownedCardIds.has(c.id);
            const wanted = wantedCardIds.has(c.id);
            const busy = quickAddBusy.has(c.id);

            return (
              <Card key={cardDedupKey(c)} className={`overflow-hidden bg-gradient-card transition-all hover:shadow-card ${owned ? "ring-2 ring-primary/60" : ""}`}>
                <button type="button" className="block w-full text-left" onClick={() => openCard(c)}>
                  <div className="relative">
                    <CardImg card={c} className="w-full card-aspect object-cover" alt={c.name} />
                    {owned && <Badge className="absolute top-1 right-1 text-[10px] px-1 py-0 bg-primary/90">✓</Badge>}
                    {!owned && wanted && (
                      <Badge variant="outline" className="absolute top-1 right-1 text-[10px] px-1 py-0 border-yellow-400 text-yellow-500">
                        ♡
                      </Badge>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-semibold truncate">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {c.code}
                      {c.rarity ? ` · ${c.rarity}` : ""}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {c.set_name ?? c.set_id ?? "—"}
                    </p>
                  </div>
                </button>

                <div className="px-2 pb-2 flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 hover:bg-primary/10 hover:text-primary"
                    disabled={busy}
                    onClick={() => quickAdd(c)}
                  >
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`h-6 w-6 ${wanted ? "text-yellow-500 hover:text-yellow-600" : "hover:text-yellow-500"}`}
                    onClick={() => toggleWanted(c)}
                  >
                    <Heart className="h-3 w-3" fill={wanted ? "currentColor" : "none"} />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!picked} onOpenChange={(o) => !o && setPicked(null)}>
        <DialogContent
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
              e.preventDefault();
              saveCard();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{pickedOwned ? "Update collection" : "Add to collection"}</DialogTitle>
          </DialogHeader>

          {picked && (
            <div className="grid grid-cols-[120px_1fr] gap-4">
              <CardImg card={picked} className="rounded-lg w-full" alt="" />
              <div className="space-y-3">
                <div>
                  <p className="font-semibold">{picked.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {picked.code} · {picked.set_name}
                  </p>
                  {pickedOwned && pickedTotalCopies > 0 && (
                    <p className="text-xs mt-1 font-medium text-primary">
                      Hai {pickedTotalCopies} {pickedTotalCopies === 1 ? "copia" : "copie"} in collezione
                    </p>
                  )}
                </div>

                <div>
                  <Label>Rarity</Label>
                  {gameRarities.length > 0 ? (
                    <Select value={rarity || "__none__"} onValueChange={(v) => setRarity(v === "__none__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona rarità" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Nessuna —</SelectItem>
                        {gameRarities.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={rarity} onChange={(e) => setRarity(e.target.value)} placeholder="e.g. Rare Holo" />
                  )}
                </div>

                <div>
                  <Label>Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGS.map((l) => (
                        <SelectItem key={l} value={l}>
                          {LANG_FLAG[l]} {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value === "" ? "" : parseInt(e.target.value) || 1)}
                    onBlur={() => setQuantity((q) => (!q || Number(q) < 1 ? 1 : Number(q)))}
                  />
                </div>

                <Button className="w-full" onClick={saveCard} disabled={savingCard}>
                  {savingCard ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {pickedOwned ? `Add ${quantity} more` : "Add to collection"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
