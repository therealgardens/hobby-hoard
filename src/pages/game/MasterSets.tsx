import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Plus, Search, Trash2, Heart, LayoutGrid, List, Minus } from "lucide-react";
import { toast } from "sonner";
import { cardImageCandidates, proxiedImage, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { addWishlist, listWishlist, removeWishlistByCard } from "@/lib/wishlist";
import { withDbRetry } from "@/lib/supabaseRetry";
import { emitCollectionChanged, onCollectionChanged } from "@/lib/collectionEvents";

type CardRow = Tables<"cards">;

interface SetInfo {
  id: string;
  name: string;
  series?: string | null;
  releaseDate?: string | null;
  total?: number | null;
  logo?: string | null;
}

const LANGS = ["EN", "JP", "IT", "FR", "DE", "ES", "PT"];
const LANG_FLAG: Record<string, string> = {
  EN: "🇬🇧", JP: "🇯🇵", IT: "🇮🇹", FR: "🇫🇷", DE: "🇩🇪", ES: "🇪🇸", PT: "🇵🇹",
};
const SETS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function extractSetId(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/\[([A-Z]{1,4}-?\d{1,3}[A-Z]?)\]/i);
  if (m) return m[1].toUpperCase().replace(/-/g, "");
  const m2 = s.match(/\b(OP|ST|EB|PRB|GC)-?(\d{1,3})\b/i);
  if (m2) return (m2[1] + m2[2]).toUpperCase();
  return null;
}

function setIdForCard(game: Game, c: { set_id: string | null; set_name: string | null; code: string | null }): string | null {
  if (game === "pokemon" || game === "yugioh") return c.set_id ?? null;
  // For One Piece, prefer the explicit set_id (e.g. "ST-26", "OP-06", "EB-03")
  // since that matches the set the user browsed when adding the card.
  // Fall back to bracketed tag in set_name (e.g. "[ST-28]"), and finally to
  // the printing code prefix (e.g. "OP06-103" -> "OP06").
  const fromSetId = c.set_id ? c.set_id.toUpperCase().replace(/-/g, "") : null;
  return fromSetId || extractSetId(c.set_name) || extractSetId(c.code ?? "");
}

export default function MasterSets() {
  const { game } = useParams<{ game: Game }>();
  const [sets, setSets] = useState<SetInfo[]>([]);
  const [ownedBySet, setOwnedBySet] = useState<Map<string, number>>(new Map());
  const [loadingSets, setLoadingSets] = useState(true);
  const [query, setQuery] = useState("");
  const [activeSet, setActiveSet] = useState<SetInfo | null>(null);
  const [ownedCardIds, setOwnedCardIds] = useState<Set<string>>(new Set());
  const [ownedLangByCard, setOwnedLangByCard] = useState<Map<string, string>>(new Map());
  const [wantedCardIds, setWantedCardIds] = useState<Set<string>>(new Set());
  const [wishlistBusy, setWishlistBusy] = useState<Set<string>>(new Set());

  const [picked, setPicked] = useState<CardRow | null>(null);
  const [pickedOwned, setPickedOwned] = useState(false);
  const [rarity, setRarity] = useState("");
  const [language, setLanguage] = useState("EN");
  const [quantity, setQuantity] = useState(1);

  const refreshOwned = async () => {
    if (!game) return;
    const userRes = await supabase.auth.getUser();
    const uid = userRes.data.user?.id;
    if (!uid) return;
    const ownedCacheKey = `tcg.owned.${game}.${uid}.v3`;

    const { data: ownedRows } = await withDbRetry(() =>
      supabase
        .from("collection_entries")
        .select("card_id, language")
        .eq("user_id", uid)
        .eq("game", game),
    );
    const cardIds = Array.from(new Set((ownedRows ?? []).map((r: any) => r.card_id).filter(Boolean))) as string[];
    let cardsById = new Map<string, { set_id: string | null; set_name: string | null; code: string | null }>();
    if (cardIds.length) {
      const { data: cards } = await withDbRetry(() =>
        supabase.from("cards").select("id, set_id, set_name, code").in("id", cardIds),
      );
      cardsById = new Map((cards ?? []).map((c: any) => [c.id, c]));
    }
    const counts = new Map<string, number>();
    const langs = new Map<string, string>();
    const ids = new Set<string>();
    for (const row of (ownedRows ?? []) as Array<{ card_id: string; language: string | null }>) {
      if (!ids.has(row.card_id)) {
        const cardMeta = cardsById.get(row.card_id);
        if (cardMeta) {
          const id = setIdForCard(game, cardMeta);
          if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        ids.add(row.card_id);
      }
      if (row.language && !langs.has(row.card_id)) langs.set(row.card_id, row.language);
    }
    setOwnedBySet(counts);
    setOwnedCardIds(ids);
    setOwnedLangByCard(langs);
    try {
      sessionStorage.setItem(
        ownedCacheKey,
        JSON.stringify({
          counts: Array.from(counts.entries()),
          ids: Array.from(ids),
          langs: Array.from(langs.entries()),
        }),
      );
    } catch (_) {}

    try {
      setWantedCardIds(new Set((await listWishlist(game)).map((item) => item.card_id)));
    } catch (_) {}
  };

  useEffect(() => {
    if (!game) return;
    setLoadingSets(true);
    setActiveSet(null);
    setQuery("");
    (async () => {
      const cacheKey = `tcg.sets.${game}.v1`;
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { ts: number; sets: SetInfo[] };
          if (Date.now() - parsed.ts < SETS_CACHE_TTL_MS && Array.isArray(parsed.sets) && parsed.sets.length) {
            setSets(parsed.sets);
            setLoadingSets(false);
          }
        }
      } catch (_) {}

      try {
        const res = await fetch(
          `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/card-sets?game=${game}`,
          { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } },
        );
        const json = await res.json();
        const fresh = (json.sets ?? []) as SetInfo[];
        if (fresh.length) {
          setSets(fresh);
          try {
            localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), sets: fresh }));
          } catch (_) {}
        }
      } catch (e) {
        console.error(e);
      }

      const userRes = await supabase.auth.getUser();
      const uid = userRes.data.user?.id;
      if (uid) {
        // Warm from sessionStorage so re-entering the page is instant.
        const ownedCacheKey = `tcg.owned.${game}.${uid}.v3`;
        try {
          const raw = sessionStorage.getItem(ownedCacheKey);
          if (raw) {
            const parsed = JSON.parse(raw) as {
              counts: [string, number][];
              ids: string[];
              langs: [string, string][];
            };
            setOwnedBySet(new Map(parsed.counts));
            setOwnedCardIds(new Set(parsed.ids));
            setOwnedLangByCard(new Map(parsed.langs));
          }
        } catch (_) {}

        await refreshOwned();
      }
      setLoadingSets(false);
    })();
  }, [game]);

  // Refresh owned/wanted when the tab regains focus or another component
  // mutates the collection (e.g. CardSearch, Binders), so My Master Sets
  // always reflects current data without a manual reload.
  useEffect(() => {
    if (!game) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshOwned();
    };
    const offChange = onCollectionChanged((detail) => {
      if (!detail?.game || detail.game === game) refreshOwned();
    });
    window.addEventListener("focus", refreshOwned);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refreshOwned);
      document.removeEventListener("visibilitychange", onVisible);
      offChange();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  const visibleSets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sets;
    return sets.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.series ?? "").toLowerCase().includes(q),
    );
  }, [sets, query]);

  const ownedSets = useMemo(
    () => visibleSets.filter((s) => (ownedBySet.get(s.id) ?? 0) > 0),
    [visibleSets, ownedBySet],
  );

  const openCard = (c: CardRow) => {
    setPicked(c);
    setPickedOwned(ownedCardIds.has(c.id));
    setRarity(c.rarity ?? "");
    setLanguage(ownedLangByCard.get(c.id) ?? "EN");
    setQuantity(1);
  };

  const persistOwnedCache = async (
    counts: Map<string, number>,
    ids: Set<string>,
    langs: Map<string, string>,
  ) => {
    const userRes = await supabase.auth.getUser();
    const uid = userRes.data.user?.id;
    if (!uid || !game) return;
    try {
      sessionStorage.setItem(
        `tcg.owned.${game}.${uid}.v3`,
        JSON.stringify({
          counts: Array.from(counts.entries()),
          ids: Array.from(ids),
          langs: Array.from(langs.entries()),
        }),
      );
    } catch (_) {}
  };

  const quickAdd = async (c: CardRow) => {
    if (!game) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error } = await supabase.from("collection_entries").insert({
      user_id: userData.user.id,
      card_id: c.id,
      game,
      rarity: c.rarity ?? null,
      language: "EN",
      quantity: 1,
    });
    if (error) return toast.error(error.message);
    toast.success(`Added ${c.name}`);
    const wasOwned = ownedCardIds.has(c.id);
    const nextIds = new Set(ownedCardIds).add(c.id);
    const nextLangs = new Map(ownedLangByCard);
    if (!nextLangs.has(c.id)) nextLangs.set(c.id, "EN");
    const nextCounts = new Map(ownedBySet);
    if (!wasOwned) {
      const sid = setIdForCard(game, c);
      if (sid) nextCounts.set(sid, (nextCounts.get(sid) ?? 0) + 1);
    }
    setOwnedCardIds(nextIds);
    setOwnedLangByCard(nextLangs);
    setOwnedBySet(nextCounts);
    persistOwnedCache(nextCounts, nextIds, nextLangs);
    emitCollectionChanged({ game, cardId: c.id });
  };

  const toggleWanted = async (c: CardRow) => {
    if (!game) return;
    if (wishlistBusy.has(c.id)) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setWishlistBusy((prev) => new Set(prev).add(c.id));
    const wasWanted = wantedCardIds.has(c.id);
    // Optimistic update
    setWantedCardIds((prev) => {
      const n = new Set(prev);
      if (wasWanted) n.delete(c.id);
      else n.add(c.id);
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
      // Rollback
      setWantedCardIds((prev) => {
        const n = new Set(prev);
        if (wasWanted) n.add(c.id);
        else n.delete(c.id);
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
    if (!picked || !game) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error } = await supabase.from("collection_entries").insert({
      user_id: userData.user.id,
      card_id: picked.id,
      game,
      rarity: rarity || null,
      language,
      quantity,
    });
    if (error) return toast.error(error.message);
    toast.success(`Added ${picked.name} ×${quantity}`);
    const savedId = picked.id;
    const savedSetId = setIdForCard(game, picked);
    const wasOwned = ownedCardIds.has(savedId);
    const savedCard = picked;
    setPicked(null);
    const nextIds = new Set(ownedCardIds).add(savedId);
    const nextLangs = new Map(ownedLangByCard).set(savedId, language);
    const nextCounts = new Map(ownedBySet);
    if (!wasOwned && savedSetId) {
      nextCounts.set(savedSetId, (nextCounts.get(savedSetId) ?? 0) + 1);
    }
    setOwnedCardIds(nextIds);
    setOwnedLangByCard(nextLangs);
    setOwnedBySet(nextCounts);
    persistOwnedCache(nextCounts, nextIds, nextLangs);
    emitCollectionChanged({ game, cardId: savedCard.id });
  };

  const removeOne = async () => {
    if (!picked || !game) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { data: rows } = await supabase
      .from("collection_entries")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("card_id", picked.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const target = rows?.[0]?.id;
    if (!target) {
      toast.info("No entry found to remove");
      return;
    }
    const { error } = await supabase.from("collection_entries").delete().eq("id", target);
    if (error) return toast.error(error.message);
    toast.success(`Removed one ${picked.name}`);

    const removedId = picked.id;
    const removedSetId = setIdForCard(game, picked);
    setPicked(null);

    const { data: remain } = await supabase
      .from("collection_entries")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("card_id", removedId)
      .limit(1);
    if (!remain || remain.length === 0) {
      const nextIds = new Set(ownedCardIds);
      nextIds.delete(removedId);
      const nextLangs = new Map(ownedLangByCard);
      nextLangs.delete(removedId);
      const nextCounts = new Map(ownedBySet);
      if (removedSetId) {
        nextCounts.set(removedSetId, Math.max(0, (nextCounts.get(removedSetId) ?? 0) - 1));
      }
      setOwnedCardIds(nextIds);
      setOwnedLangByCard(nextLangs);
      setOwnedBySet(nextCounts);
      persistOwnedCache(nextCounts, nextIds, nextLangs);
    }
    emitCollectionChanged({ game, cardId: removedId });
  };

  return (
    <div>
      <h2 className="text-4xl font-display mb-2">Master Sets</h2>
      <p className="text-muted-foreground mb-6">
        Browse every expansion and track your progress across the catalog.
      </p>

      {activeSet ? (
        <SetView
          game={game}
          set={activeSet}
          onBack={() => setActiveSet(null)}
          onPickCard={openCard}
          onQuickAdd={quickAdd}
          ownedCardIds={ownedCardIds}
          ownedLangByCard={ownedLangByCard}
          wantedCardIds={wantedCardIds}
          onToggleWanted={toggleWanted}
        />
      ) : (
        <>
          <div className="relative mb-6 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={
                game === "onepiece"
                  ? "Search by name or code (e.g. Azure Sea Seven, OP14, ST21)"
                  : game === "yugioh"
                  ? "Search by name or code (e.g. Legend of Blue Eyes, LOB, MRD)"
                  : "Search by name or code (e.g. Crown Zenith, sv1, swsh12)"
              }
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">All Expansions ({visibleSets.length})</TabsTrigger>
              <TabsTrigger value="mine">My Master Sets ({ownedSets.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-6">
              {loadingSets && sets.length === 0 ? (
                <SetGridSkeleton />
              ) : (
                <SetGrid sets={visibleSets} ownedBySet={ownedBySet} onOpen={setActiveSet} />
              )}
            </TabsContent>

            <TabsContent value="mine" className="mt-6">
              {loadingSets && sets.length === 0 ? (
                <SetGridSkeleton />
              ) : ownedSets.length === 0 ? (
                <p className="text-muted-foreground text-center py-12">
                  You don't own any cards yet. Open an expansion and start building.
                </p>
              ) : (
                <SetGrid sets={ownedSets} ownedBySet={ownedBySet} onOpen={setActiveSet} />
              )}
            </TabsContent>
          </Tabs>
        </>
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
              {(() => {
                return <CardImg card={picked} className="rounded-lg w-full" alt="" />;
              })()}
              <div className="space-y-3">
                <div>
                  <p className="font-semibold">{picked.name}</p>
                  <p className="text-xs text-muted-foreground">{picked.code} · {picked.set_name}</p>
                </div>
                <div>
                  <Label>Rarity</Label>
                  <Input value={rarity} onChange={(e) => setRarity(e.target.value)} placeholder="e.g. Rare Holo" />
                </div>
                <div>
                  <Label>Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{LANGS.map(l => <SelectItem key={l} value={l}>{LANG_FLAG[l]} {l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantity</Label>
                  <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} />
                </div>
                <Button className="w-full" onClick={saveCard}>
                  {pickedOwned ? `Add ${quantity} more` : "Add to collection"}
                </Button>
                {pickedOwned && (
                  <Button variant="outline" className="w-full" onClick={removeOne}>
                    <Trash2 className="h-4 w-4 mr-1" /> Remove one
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SetGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="p-4 bg-gradient-card">
          <div className="flex items-start gap-3">
            <Skeleton className="h-14 w-14 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-10" />
          </div>
          <Skeleton className="mt-3 h-1.5 w-full" />
        </Card>
      ))}
    </div>
  );
}

function SetThumb({ s }: { s: SetInfo }) {
  // Build a cascade of candidate URLs; advance to next on error.
  const candidates = useMemo(() => {
    const list: string[] = [];
    if (s.logo) list.push(s.logo);
    // Common One Piece card-image patterns to use as a thumbnail.
    const id = s.id.toUpperCase();
    list.push(`https://en.onepiece-cardgame.com/images/cardlist/card/${id}-001.png`);
    list.push(`https://en.onepiece-cardgame.com/images/cardlist/card/${id}-001_p1.png`);
    list.push(`https://en.onepiece-cardgame.com/images/cardlist/card/${id}-002.png`);
    list.push(`https://en.onepiece-cardgame.com/images/cardlist/card/${id}-003.png`);
    // apitcg logo as a final shot
    list.push(`https://www.apitcg.com/images/sets/one-piece/${id}-logo.png`);
    return Array.from(new Set(list));
  }, [s.id, s.logo]);

  const [idx, setIdx] = useState(0);
  const url = candidates[idx];
  const src = url ? proxiedImage(url) : null;

  if (!src) {
    return (
      <div className="h-14 w-14 rounded bg-muted flex items-center justify-center text-xs font-mono shrink-0">
        {s.id}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="h-14 w-14 object-contain rounded bg-background/40 p-1 shrink-0"
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

function CardImg({ card, className, alt }: { card: CardRow; className: string; alt: string }) {
  const candidates = useMemo(
    () => cardImageCandidates(card.game, card.code, card.image_small ?? card.image_large),
    [card.game, card.code, card.image_small, card.image_large],
  );
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];

  if (!src) {
    return (
      <div className="w-full card-aspect bg-muted flex items-center justify-center text-muted-foreground text-xs">
        No image
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

function SetGrid({
  sets,
  ownedBySet,
  onOpen,
}: {
  sets: SetInfo[];
  ownedBySet: Map<string, number>;
  onOpen: (s: SetInfo) => void;
}) {
  if (sets.length === 0) {
    return <p className="text-muted-foreground text-center py-12">No expansions match your search.</p>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {sets.map((s) => {
        return (
          <Card
            key={s.id}
            className="p-4 cursor-pointer hover:shadow-card transition-shadow bg-gradient-card"
            onClick={() => onOpen(s)}
          >
            <div className="flex items-start gap-3">
              <SetThumb s={s} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.id}{s.releaseDate ? ` · ${s.releaseDate}` : ""}
                </p>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function SetViewSkeleton() {
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

function SetView({
  game,
  set,
  onBack,
  onPickCard,
  onQuickAdd,
  ownedCardIds,
  ownedLangByCard,
  wantedCardIds,
  onToggleWanted,
}: {
  game: Game;
  set: SetInfo;
  onBack: () => void;
  onPickCard: (c: CardRow) => void;
  onQuickAdd: (c: CardRow) => void;
  ownedCardIds: Set<string>;
  ownedLangByCard: Map<string, string>;
  wantedCardIds: Set<string>;
  onToggleWanted: (c: CardRow) => void;
}) {
  const [cards, setCards] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"grid" | "list">(() => {
    if (typeof window === "undefined") return "grid";
    return (localStorage.getItem("masterset.view") as "grid" | "list") ?? "grid";
  });

  useEffect(() => {
    try { localStorage.setItem("masterset.view", view); } catch (_) {}
  }, [view]);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.functions.invoke("card-search", {
        body: { game, setId: set.id },
      });
      if (error) toast.error(error.message);
      const remote = ((data?.cards as CardRow[]) ?? []);

      const dashed = set.id.replace(/^([A-Z]+)(\d+)$/, "$1-$2");
      const { data: local } = await supabase
        .from("cards")
        .select("*")
        .eq("game", game)
        .or(
          game === "pokemon"
            ? `set_id.eq.${set.id}`
            : `set_name.ilike.%[${set.id}]%,set_name.ilike.%[${dashed}]%,code.ilike.${set.id}-%`,
        )
        .limit(500);

      const map = new Map<string, CardRow>();
      for (const c of [...(local ?? []), ...remote]) map.set(c.id, c);
      const merged = Array.from(map.values()).sort((a, b) =>
        (a.code ?? "").localeCompare(b.code ?? "", undefined, { numeric: true }),
      );
      setCards(merged);
      setLoading(false);
    })();
  }, [game, set.id]);

  const ownedCount = cards.filter((c) => ownedCardIds.has(c.id)).length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex-1">
          <h3 className="text-2xl font-display">{set.name}</h3>
          <p className="text-xs text-muted-foreground">
            {set.id}{set.releaseDate ? ` · ${set.releaseDate}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border bg-muted p-0.5">
          <Button
            type="button"
            size="sm"
            variant={view === "grid" ? "default" : "ghost"}
            className="h-7 w-7 p-0"
            onClick={() => setView("grid")}
            title="Full image view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "list" ? "default" : "ghost"}
            className="h-7 w-7 p-0"
            onClick={() => setView("list")}
            title="List view"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
        <Badge variant="default" className="text-sm">
          {ownedCount}/{cards.length || set.total || "?"}
        </Badge>
      </div>

      {loading ? (
        <SetViewSkeleton />
      ) : cards.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">
          No cards available for this expansion yet.
        </p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {cards.map((c) => {
            const owned = ownedCardIds.has(c.id);
            const wanted = wantedCardIds.has(c.id);
            const lang = ownedLangByCard.get(c.id);
            return (
              <Card
                key={c.id}
                className="overflow-hidden bg-gradient-card cursor-pointer hover:shadow-card transition-shadow group relative"
                onClick={() => onPickCard(c)}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleWanted(c);
                  }}
                  className="absolute top-2 left-2 z-10 p-1.5 rounded-full bg-background/90 shadow hover:bg-background transition-colors"
                  title={wanted ? "Remove from wishlist" : "Add to wishlist"}
                >
                  <Heart className={`h-4 w-4 ${wanted ? "fill-red-500 text-red-500" : "text-muted-foreground"}`} />
                </button>
                {owned && lang && (
                  <div className="absolute top-2 right-2 z-10 bg-background/90 rounded px-1.5 py-0.5 text-xs shadow">
                    {LANG_FLAG[lang] ?? lang}
                  </div>
                )}
                {!owned && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute bottom-12 right-2 z-10 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickAdd(c);
                    }}
                    title="Quick add (+1)"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
                <CardImg
                  card={c}
                  alt={c.name}
                  className={`w-full card-aspect object-cover transition-all ${owned ? "" : "opacity-60 grayscale"}`}
                />
                <div className="p-2">
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.code}{c.rarity ? ` · ${c.rarity}` : ""}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {cards.map((c) => {
            const owned = ownedCardIds.has(c.id);
            const wanted = wantedCardIds.has(c.id);
            const lang = ownedLangByCard.get(c.id);
            return (
              <Card
                key={c.id}
                className={`flex items-center gap-3 px-3 py-2 bg-gradient-card cursor-pointer hover:shadow-card transition-shadow ${owned ? "" : "opacity-70"}`}
                onClick={() => onPickCard(c)}
              >
                <div className="font-mono text-xs text-muted-foreground w-20 shrink-0 truncate">
                  {c.code ?? "—"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  {c.rarity && <p className="text-xs text-muted-foreground truncate">{c.rarity}</p>}
                </div>
                {owned && lang && (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {LANG_FLAG[lang] ?? lang}
                  </Badge>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleWanted(c);
                    }}
                    title={wanted ? "Remove from wishlist" : "Add to wishlist"}
                  >
                    <Heart className={`h-4 w-4 ${wanted ? "fill-red-500 text-red-500" : "text-muted-foreground"}`} />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickAdd(c);
                    }}
                    title="Add one to collection"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  {owned && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPickCard(c);
                      }}
                      title="Adjust collection"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
