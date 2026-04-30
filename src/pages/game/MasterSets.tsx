import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import { ArrowLeft, Plus, Search, Trash2, Heart, LayoutGrid, List, Minus, Loader2, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { cardImageCandidates, proxiedImage, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { addWishlist, listWishlist, removeWishlistByCard } from "@/lib/wishlist";
import { withDbRetry } from "@/lib/supabaseRetry";
import { emitCollectionChanged, onCollectionChanged } from "@/lib/collectionEvents";
import { CardSearch } from "@/components/CardSearch";
import { useAuth } from "@/hooks/useAuth";

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

interface OwnedCache {
  counts: Map<string, number>;
  ids: Set<string>;
  langs: Map<string, string>;
}
const _ownedCache = new Map<string, OwnedCache>();
const _setsCache = new Map<string, SetInfo[]>();

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
  const fromSetId = c.set_id ? c.set_id.toUpperCase().replace(/-/g, "") : null;
  return fromSetId || extractSetId(c.set_name) || extractSetId(c.code ?? "");
}

export default function MasterSets() {
  const { game } = useParams<{ game: Game }>();
  const navigate = useNavigate();
  const { user } = useAuth(); // ← fix bug 2

  const cachedOwned = game ? _ownedCache.get(game) : undefined;
  const cachedSets = game ? _setsCache.get(game) : undefined;

  const [sets, setSets] = useState<SetInfo[]>(cachedSets ?? []);
  const [ownedBySet, setOwnedBySet] = useState<Map<string, number>>(cachedOwned?.counts ?? new Map());
  const [loadingSets, setLoadingSets] = useState(!cachedSets?.length);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"sets" | "cards">("sets");
  const [activeSet, setActiveSet] = useState<SetInfo | null>(null);
  const [ownedCardIds, setOwnedCardIds] = useState<Set<string>>(cachedOwned?.ids ?? new Set());
  const [ownedLangByCard, setOwnedLangByCard] = useState<Map<string, string>>(cachedOwned?.langs ?? new Map());
  const [wantedCardIds, setWantedCardIds] = useState<Set<string>>(new Set());
  const [wishlistBusy, setWishlistBusy] = useState<Set<string>>(new Set());
  const [quickAddBusy, setQuickAddBusy] = useState<Set<string>>(new Set());

  const [picked, setPicked] = useState<CardRow | null>(null);
  const [pickedOwned, setPickedOwned] = useState(false);
  const [rarity, setRarity] = useState("");
  const [language, setLanguage] = useState("EN");
  const [quantity, setQuantity] = useState(1);
  const [savingCard, setSavingCard] = useState(false);

  const writeOwnedCache = (counts: Map<string, number>, ids: Set<string>, langs: Map<string, string>) => {
    if (!game || !user) return;
    _ownedCache.set(game, { counts, ids, langs });
    try {
      sessionStorage.setItem(`tcg.owned.${game}.${user.id}.v3`, JSON.stringify({
        counts: Array.from(counts.entries()),
        ids: Array.from(ids),
        langs: Array.from(langs.entries()),
      }));
    } catch (_) {}
  };

  // ← fix bug 2: usa user da useAuth invece di getUser() async
  const refreshOwned = async () => {
    if (!game || !user) return;
    const uid = user.id;

    const { data: ownedRows, error: ownedErr } = await withDbRetry(() =>
      supabase.from("collection_entries").select("card_id, language").eq("user_id", uid).eq("game", game),
    );
    if (ownedErr) { console.warn("refreshOwned failed", ownedErr); return; }

    const cardIds = Array.from(new Set((ownedRows ?? []).map((r: any) => r.card_id).filter(Boolean))) as string[];
    let cardsById = new Map<string, { set_id: string | null; set_name: string | null; code: string | null }>();
    if (cardIds.length) {
      const { data: cards, error: cardsErr } = await withDbRetry(() =>
        supabase.from("cards").select("id, set_id, set_name, code").in("id", cardIds),
      );
      if (cardsErr) { console.warn("refreshOwned cards failed", cardsErr); return; }
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
    writeOwnedCache(counts, ids, langs);

    try {
      setWantedCardIds(new Set((await listWishlist(game)).map((item) => item.card_id)));
    } catch (_) {}
  };

  // ← fix bug 2: dipende da user?.id, legge sessionStorage solo quando user è pronto
  useEffect(() => {
    if (!game || !user) return;
    setActiveSet(null);
    setQuery("");
    setSearchMode("sets");
    if (!_setsCache.has(game)) setLoadingSets(true);

    (async () => {
      const cacheKey = `tcg.sets.${game}.v1`;
      if (!_setsCache.has(game)) {
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw) {
            const parsed = JSON.parse(raw) as { ts: number; sets: SetInfo[] };
            if (Date.now() - parsed.ts < SETS_CACHE_TTL_MS && Array.isArray(parsed.sets) && parsed.sets.length) {
              _setsCache.set(game, parsed.sets);
              setSets(parsed.sets);
              setLoadingSets(false);
            }
          }
        } catch (_) {}
      }

      try {
        const res = await fetch(
          `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/card-sets?game=${game}`,
          { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } },
        );
        const json = await res.json();
        const fresh = (json.sets ?? []) as SetInfo[];
        if (fresh.length) {
          _setsCache.set(game, fresh);
          setSets(fresh);
          try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), sets: fresh })); } catch (_) {}
        }
      } catch (e) { console.error(e); }

      setLoadingSets(false);

      // ← fix bug 2: user.id è già disponibile qui, no await getUser()
      const uid = user.id;
      if (!_ownedCache.has(game)) {
        try {
          const raw = sessionStorage.getItem(`tcg.owned.${game}.${uid}.v3`);
          if (raw) {
            const parsed = JSON.parse(raw) as { counts: [string, number][]; ids: string[]; langs: [string, string][] };
            const counts = new Map(parsed.counts);
            const ids = new Set(parsed.ids);
            const langs = new Map(parsed.langs);
            _ownedCache.set(game, { counts, ids, langs });
            setOwnedBySet(counts);
            setOwnedCardIds(ids);
            setOwnedLangByCard(langs);
          }
        } catch (_) {}
      }

      await refreshOwned();
    })();
  }, [game, user?.id]); // ← dipende da user?.id

  useEffect(() => {
    if (!game || !user) return;

    const refreshTimeout = { current: null as ReturnType<typeof setTimeout> | null };
    const debouncedRefresh = () => {
      if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
      refreshTimeout.current = setTimeout(() => refreshOwned(), 400);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") debouncedRefresh();
    };

    const offChange = onCollectionChanged((detail) => {
      if (!detail?.game || detail.game === game) refreshOwned();
    });

    window.addEventListener("focus", debouncedRefresh);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
      window.removeEventListener("focus", debouncedRefresh);
      document.removeEventListener("visibilitychange", onVisible);
      offChange();
    };
  }, [game, user?.id]); // ← dipende da user?.id

  const visibleSets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sets;
    return sets.filter((s) =>
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

  const quickAdd = async (c: CardRow) => {
    if (!game || !user || quickAddBusy.has(c.id)) return;
    const uid = user.id;

    setQuickAddBusy((prev) => new Set(prev).add(c.id));
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
    writeOwnedCache(nextCounts, nextIds, nextLangs);

    try {
      const { data: existing } = await supabase
        .from("collection_entries").select("id, quantity")
        .eq("user_id", uid).eq("card_id", c.id).maybeSingle();
      let error;
      if (existing) {
        ({ error } = await withDbRetry(() =>
          supabase.from("collection_entries").update({ quantity: existing.quantity + 1 }).eq("id", existing.id)
        ));
      } else {
        ({ error } = await withDbRetry(() =>
          supabase.from("collection_entries").insert({
            user_id: uid, card_id: c.id, game,
            rarity: c.rarity ?? null, language: "EN", quantity: 1,
          })
        ));
      }
      if (error) {
        const rollbackIds = new Set(ownedCardIds);
        if (!wasOwned) rollbackIds.delete(c.id);
        setOwnedCardIds(rollbackIds);
        setOwnedLangByCard(ownedLangByCard);
        setOwnedBySet(ownedBySet);
        writeOwnedCache(ownedBySet, rollbackIds, ownedLangByCard);
        return toast.error(error.message);
      }
      toast.success(`Added ${c.name}`);
      emitCollectionChanged({ game, cardId: c.id });
    } finally {
      setQuickAddBusy((prev) => { const n = new Set(prev); n.delete(c.id); return n; });
    }
  };

  const toggleWanted = async (c: CardRow) => {
    if (!game || !user || wishlistBusy.has(c.id)) return;
    setWishlistBusy((prev) => new Set(prev).add(c.id));
    const wasWanted = wantedCardIds.has(c.id);
    setWantedCardIds((prev) => { const n = new Set(prev); wasWanted ? n.delete(c.id) : n.add(c.id); return n; });
    try {
      if (wasWanted) { await removeWishlistByCard(c.id, game); toast.success("Removed from wishlist"); }
      else { await addWishlist(c, game); toast.success("Added to wishlist"); }
    } catch (error) {
      setWantedCardIds((prev) => { const n = new Set(prev); wasWanted ? n.add(c.id) : n.delete(c.id); return n; });
      toast.error(error instanceof Error ? error.message : "Wishlist action failed");
    } finally {
      setWishlistBusy((prev) => { const n = new Set(prev); n.delete(c.id); return n; });
    }
  };

  const saveCard = async () => {
    if (!picked || !game || !user || savingCard) return;
    const uid = user.id;
    setSavingCard(true);

    const savedId = picked.id;
    const savedSetId = setIdForCard(game, picked);
    const wasOwned = ownedCardIds.has(savedId);
    const nextIds = new Set(ownedCardIds).add(savedId);
    const nextLangs = new Map(ownedLangByCard).set(savedId, language);
    const nextCounts = new Map(ownedBySet);
    if (!wasOwned && savedSetId) nextCounts.set(savedSetId, (nextCounts.get(savedSetId) ?? 0) + 1);
    setOwnedCardIds(nextIds);
    setOwnedLangByCard(nextLangs);
    setOwnedBySet(nextCounts);
    writeOwnedCache(nextCounts, nextIds, nextLangs);
    setPicked(null);

    try {
      const { data: existing } = await supabase
        .from("collection_entries").select("id, quantity")
        .eq("user_id", uid).eq("card_id", savedId).maybeSingle();
      let error;
      if (existing) {
        ({ error } = await withDbRetry(() =>
          supabase.from("collection_entries").update({ quantity: existing.quantity + quantity }).eq("id", existing.id)
        ));
      } else {
        ({ error } = await withDbRetry(() =>
          supabase.from("collection_entries").insert({
            user_id: uid, card_id: savedId, game,
            rarity: rarity || null, language, quantity,
          })
        ));
      }
      if (error) {
        const rollbackIds = new Set(ownedCardIds);
        if (!wasOwned) rollbackIds.delete(savedId);
        setOwnedCardIds(rollbackIds);
        setOwnedLangByCard(ownedLangByCard);
        setOwnedBySet(ownedBySet);
        writeOwnedCache(ownedBySet, rollbackIds, ownedLangByCard);
        return toast.error(error.message);
      }
      toast.success(`Added ${picked?.name ?? "card"} ×${quantity}`);
      emitCollectionChanged({ game, cardId: savedId });
    } finally {
      setSavingCard(false);
    }
  };

  const removeOne = async () => {
    if (!picked || !game || !user) return;
    const uid = user.id;
    const { data: rows } = await supabase
      .from("collection_entries").select("id")
      .eq("user_id", uid).eq("card_id", picked.id)
      .order("created_at", { ascending: false }).limit(1);
    const target = rows?.[0]?.id;
    if (!target) { toast.info("No entry found to remove"); return; }
    const { error } = await supabase.from("collection_entries").delete().eq("id", target);
    if (error) return toast.error(error.message);
    toast.success(`Removed one ${picked.name}`);
    const removedId = picked.id;
    const removedSetId = setIdForCard(game, picked);
    setPicked(null);
    const { data: remain } = await supabase
      .from("collection_entries").select("id")
      .eq("user_id", uid).eq("card_id", removedId).limit(1);
    if (!remain || remain.length === 0) {
      const nextIds = new Set(ownedCardIds); nextIds.delete(removedId);
      const nextLangs = new Map(ownedLangByCard); nextLangs.delete(removedId);
      const nextCounts = new Map(ownedBySet);
      if (removedSetId) nextCounts.set(removedSetId, Math.max(0, (nextCounts.get(removedSetId) ?? 0) - 1));
      setOwnedCardIds(nextIds); setOwnedLangByCard(nextLangs); setOwnedBySet(nextCounts);
      writeOwnedCache(nextCounts, nextIds, nextLangs);
    }
    emitCollectionChanged({ game, cardId: removedId });
  };

  if (!game) return null;

  return (
    <div>
      <h2 className="text-4xl font-display mb-2">Master Sets</h2>
      <p className="text-muted-foreground mb-6">Browse every expansion and track your progress across the catalog.</p>

      {activeSet ? (
        <SetView
          game={game} set={activeSet} onBack={() => setActiveSet(null)}
          onPickCard={openCard} onQuickAdd={quickAdd}
          ownedCardIds={ownedCardIds} ownedLangByCard={ownedLangByCard}
          wantedCardIds={wantedCardIds} onToggleWanted={toggleWanted}
          quickAddBusy={quickAddBusy}
          onBinderCreated={(binderId) => navigate(`/${game}/binders/${binderId}`)}
        />
      ) : (
        <>
          <div className="flex items-center gap-1 mb-6 rounded-lg border bg-muted p-1 w-fit">
            <button
              type="button"
              onClick={() => setSearchMode("sets")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                searchMode === "sets"
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Espansioni
            </button>
            <button
              type="button"
              onClick={() => setSearchMode("cards")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                searchMode === "cards"
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Cerca carte
            </button>
          </div>

          {searchMode === "sets" ? (
            <>
              <div className="relative mb-6 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={
                    game === "onepiece" ? "Search by name or code (e.g. Azure Sea Seven, OP14, ST21)"
                    : game === "yugioh" ? "Search by name or code (e.g. Legend of Blue Eyes, LOB, MRD)"
                    : "Search by name or code (e.g. Crown Zenith, sv1, swsh12)"
                  }
                  className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Tabs defaultValue="all">
                <TabsList>
                  <TabsTrigger value="all">All Expansions ({visibleSets.length})</TabsTrigger>
                  <TabsTrigger value="mine">My Master Sets ({ownedSets.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="all" className="mt-6">
                  {loadingSets && sets.length === 0 ? <SetGridSkeleton /> : <SetGrid sets={visibleSets} ownedBySet={ownedBySet} onOpen={setActiveSet} />}
                </TabsContent>
                <TabsContent value="mine" className="mt-6">
                  {loadingSets && sets.length === 0 ? <SetGridSkeleton />
                   : ownedSets.length === 0 ? (
                    <p className="text-muted-foreground text-center py-12">You don't own any cards yet. Open an expansion and start building.</p>
                   ) : <SetGrid sets={ownedSets} ownedBySet={ownedBySet} onOpen={setActiveSet} />}
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <CardSearch game={game} autoLoad={false} />
          )}
        </>
      )}

      <Dialog open={!!picked} onOpenChange={(o) => !o && setPicked(null)}>
        <DialogContent onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") { e.preventDefault(); saveCard(); } }}>
          <DialogHeader>
            <DialogTitle>{pickedOwned ? "Update collection" : "Add to collection"}</DialogTitle>
          </DialogHeader>
          {picked && (
            <div className="grid grid-cols-[120px_1fr] gap-4">
              <CardImg card={picked} className="rounded-lg w-full" alt="" />
              <div className="space-y-3">
                <div>
                  <p className="font-semibold">{picked.name}</p>
                  <p className="text-xs text-muted-foreground">{picked.code} · {picked.set_name}</p>
                </div>
                <div><Label>Rarity</Label><Input value={rarity} onChange={(e) => setRarity(e.target.value)} placeholder="e.g. Rare Holo" /></div>
                <div>
                  <Label>Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{LANGS.map(l => <SelectItem key={l} value={l}>{LANG_FLAG[l]} {l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Quantity</Label><Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} /></div>
                <Button className="w-full" onClick={saveCard} disabled={savingCard}>
                  {savingCard ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
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

// ─── Componenti di supporto ───────────────────────────────────────────────────

function SetGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="p-4 bg-gradient-card">
          <div className="flex items-start gap-3">
            <Skeleton className="h-14 w-14 rounded" />
            <div className="flex-1 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function SetThumb({ s }: { s: SetInfo }) {
  const candidates = useMemo(() => {
    const list: string[] = [];
    if (s.logo) list.push(s.logo);
    const id = s.id.toUpperCase();
    list.push(`https://en.onepiece-cardgame.com/images/cardlist/card/${id}-001.png`);
    list.push(`https://en.onepiece-cardgame.com/images/cardlist/card/${id}-001_p1.png`);
    list.push(`https://en.onepiece-cardgame.com/images/cardlist/card/${id}-002.png`);
    list.push(`https://en.onepiece-cardgame.com/images/cardlist/card/${id}-003.png`);
    list.push(`https://www.apitcg.com/images/sets/one-piece/${id}-logo.png`);
    return Array.from(new Set(list));
  }, [s.id, s.logo]);
  const [idx, setIdx] = useState(0);
  const url = candidates[idx];
  const src = url ? proxiedImage(url) : null;
  if (!src) return <div className="h-14 w-14 rounded bg-muted flex items-center justify-center text-xs font-mono shrink-0">{s.id}</div>;
  return <img src={src} alt="" className="h-14 w-14 object-contain rounded bg-background/40 p-1 shrink-0" loading="lazy" onError={() => setIdx((i) => i + 1)} />;
}

function CardImg({ card, className, alt }: { card: CardRow; className: string; alt: string }) {
  const candidates = useMemo(() => cardImageCandidates(card.game, card.code, card.image_small ?? card.image_large), [card.game, card.code, card.image_small, card.image_large]);
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];
  if (!src) return <div className="w-full card-aspect bg-muted flex items-center justify-center text-muted-foreground text-xs">No image</div>;
  return <img src={src} alt={alt} loading="lazy" className={className} onError={() => setIdx((i) => i + 1)} />;
}

function SetGrid({ sets, ownedBySet, onOpen }: { sets: SetInfo[]; ownedBySet: Map<string, number>; onOpen: (s: SetInfo) => void }) {
  if (sets.length === 0) return <p className="text-muted-foreground text-center py-12">No expansions match your search.</p>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {sets.map((s) => (
        <Card key={s.id} className="p-4 cursor-pointer hover:shadow-card transition-shadow bg-gradient-card" onClick={() => onOpen(s)}>
          <div className="flex items-start gap-3">
            <SetThumb s={s} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{s.name}</p>
              <p className="text-xs text-muted-foreground truncate">{s.id}{s.releaseDate ? ` · ${s.releaseDate}` : ""}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function SetViewSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <Card key={i} className="overflow-hidden bg-gradient-card">
          <Skeleton className="w-full card-aspect" />
          <div className="p-2 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>
        </Card>
      ))}
    </div>
  );
}

interface CreateBinderDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  game: Game;
  set: SetInfo;
  cards: CardRow[];
  ownedCardIds: Set<string>;
  onCreated: (binderId: string) => void;
}

function CreateBinderDialog({ open, onOpenChange, game, set, cards, ownedCardIds, onCreated }: CreateBinderDialogProps) {
  const [name, setName] = useState(set.name);
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(3);
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [creating, setCreating] = useState(false);

  const cardsToPlace = onlyOwned ? cards.filter((c) => ownedCardIds.has(c.id)) : cards;
  const perPage = cols * rows;
  const pagesNeeded = Math.max(1, Math.ceil(cardsToPlace.length / perPage));

  const create = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return toast.error("Not signed in");
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const binderId = crypto.randomUUID();
      const { error: binderErr } = await withDbRetry(() =>
        supabase.from("binders").insert({
          id: binderId, user_id: userData.user!.id, game,
          name: name.trim(), cols, rows, pages: pagesNeeded,
        } as any)
      );
      if (binderErr) { toast.error(binderErr.message); return; }
      if (cardsToPlace.length > 0) {
        const slots = cardsToPlace.map((c, i) => ({
          binder_id: binderId, user_id: userData.user!.id,
          position: i, card_id: c.id, is_wanted: !ownedCardIds.has(c.id),
        }));
        const BATCH = 50;
        for (let i = 0; i < slots.length; i += BATCH) {
          const { error: slotErr } = await withDbRetry(() =>
            supabase.from("binder_slots").insert(slots.slice(i, i + BATCH) as any)
          );
          if (slotErr) { toast.error(`Slots insert failed: ${slotErr.message}`); break; }
        }
      }
      toast.success(`Binder "${name.trim()}" creato con ${cardsToPlace.length} carte su ${pagesNeeded} pagine!`);
      onOpenChange(false);
      onCreated(binderId);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Crea binder da {set.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Nome binder</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={set.name} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Colonne</Label><Input type="number" min={2} max={6} value={cols} onChange={(e) => setCols(parseInt(e.target.value) || 4)} /></div>
            <div><Label>Righe</Label><Input type="number" min={2} max={6} value={rows} onChange={(e) => setRows(parseInt(e.target.value) || 3)} /></div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/40">
            <input type="checkbox" id="only-owned" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} className="h-4 w-4 accent-primary" />
            <label htmlFor="only-owned" className="text-sm cursor-pointer flex-1">
              Solo carte possedute
              <span className="block text-xs text-muted-foreground">
                {onlyOwned ? `${cardsToPlace.length} carte possedute` : `${cards.length} carte totali (le non possedute saranno marcate come "wanted")`}
              </span>
            </label>
          </div>
          <div className="text-sm text-muted-foreground bg-muted/40 rounded-lg p-3 space-y-1">
            <p>📄 <strong>{pagesNeeded}</strong> pagine · <strong>{perPage}</strong> slot/pagina</p>
            <p>🃏 <strong>{cardsToPlace.length}</strong> carte verranno inserite in ordine</p>
            {!onlyOwned && cards.filter((c) => !ownedCardIds.has(c.id)).length > 0 && (
              <p>💛 <strong>{cards.filter((c) => !ownedCardIds.has(c.id)).length}</strong> carte marcate come wanted</p>
            )}
          </div>
          <Button className="w-full" onClick={create} disabled={creating || !name.trim() || cardsToPlace.length === 0}>
            {creating ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creazione in corso…</> : <><BookOpen className="h-4 w-4 mr-2" /> Crea binder</>}
          </Button>
          {cardsToPlace.length === 0 && <p className="text-xs text-center text-muted-foreground">Nessuna carta da inserire.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SetView({
  game, set, onBack, onPickCard, onQuickAdd,
  ownedCardIds, ownedLangByCard, wantedCardIds, onToggleWanted, quickAddBusy, onBinderCreated,
}: {
  game: Game; set: SetInfo; onBack: () => void;
  onPickCard: (c: CardRow) => void; onQuickAdd: (c: CardRow) => void;
  ownedCardIds: Set<string>; ownedLangByCard: Map<string, string>;
  wantedCardIds: Set<string>; onToggleWanted: (c: CardRow) => void;
  quickAddBusy: Set<string>; onBinderCreated: (binderId: string) => void;
}) {
  const [cards, setCards] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"grid" | "list">(() => {
    if (typeof window === "undefined") return "grid";
    return (localStorage.getItem("masterset.view") as "grid" | "list") ?? "grid";
  });
  const [binderDialogOpen, setBinderDialogOpen] = useState(false);

  useEffect(() => { try { localStorage.setItem("masterset.view", view); } catch (_) {} }, [view]);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.functions.invoke("card-search", { body: { game, setId: set.id } });
      if (error) toast.error(error.message);
      const remote = ((data?.cards as CardRow[]) ?? []);
      const dashed = set.id.replace(/^([A-Z]+)(\d+)$/, "$1-$2");
      const { data: local } = await supabase.from("cards").select("*").eq("game", game)
        .or(game === "pokemon" ? `set_id.eq.${set.id}` : `set_name.ilike.%[${set.id}]%,set_name.ilike.%[${dashed}]%,code.ilike.${set.id}-%`)
        .limit(500);
      const map = new Map<string, CardRow>();
      for (const c of [...(local ?? []), ...remote]) map.set(c.id, c);
      setCards(Array.from(map.values()).sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "", undefined, { numeric: true })));
      setLoading(false);
    })();
  }, [game, set.id]);

  const ownedCount = cards.filter((c) => ownedCardIds.has(c.id)).length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        <div className="flex-1 min-w-0">
          <h3 className="text-2xl font-display">{set.name}</h3>
          <p className="text-xs text-muted-foreground">{set.id}{set.releaseDate ? ` · ${set.releaseDate}` : ""}</p>
        </div>
        {!loading && cards.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setBinderDialogOpen(true)}>
            <BookOpen className="h-4 w-4 mr-1" /> Crea binder
          </Button>
        )}
        <div className="flex items-center gap-1 rounded-md border bg-muted p-0.5">
          <Button type="button" size="sm" variant={view === "grid" ? "default" : "ghost"} className="h-7 w-7 p-0" onClick={() => setView("grid")}><LayoutGrid className="h-4 w-4" /></Button>
          <Button type="button" size="sm" variant={view === "list" ? "default" : "ghost"} className="h-7 w-7 p-0" onClick={() => setView("list")}><List className="h-4 w-4" /></Button>
        </div>
        <Badge variant="default" className="text-sm">{ownedCount}/{cards.length || set.total || "?"}</Badge>
      </div>

      {binderDialogOpen && (
        <CreateBinderDialog open={binderDialogOpen} onOpenChange={setBinderDialogOpen}
          game={game} set={set} cards={cards} ownedCardIds={ownedCardIds} onCreated={onBinderCreated} />
      )}

      {loading ? <SetViewSkeleton /> : cards.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">No cards available for this expansion yet.</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {cards.map((c) => {
            const owned = ownedCardIds.has(c.id);
            const wanted = wantedCardIds.has(c.id);
            const lang = ownedLangByCard.get(c.id);
            const busy = quickAddBusy.has(c.id);
            return (
              <Card key={c.id} className="overflow-hidden bg-gradient-card cursor-pointer hover:shadow-card transition-shadow group relative" onClick={() => onPickCard(c)}>
                <button type="button" onClick={(e) => { e.stopPropagation(); onToggleWanted(c); }}
                  className="absolute top-2 left-2 z-10 p-1.5 rounded-full bg-background/90 shadow hover:bg-background transition-colors"
                  title={wanted ? "Remove from wishlist" : "Add to wishlist"}>
                  <Heart className={`h-4 w-4 ${wanted ? "fill-red-500 text-red-500" : "text-muted-foreground"}`} />
                </button>
                {owned && lang && <div className="absolute top-2 right-2 z-10 bg-background/90 rounded px-1.5 py-0.5 text-xs shadow">{LANG_FLAG[lang] ?? lang}</div>}
                {!owned && (
                  <Button size="sm" variant="secondary" disabled={busy}
                    className="absolute bottom-12 right-2 z-10 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onQuickAdd(c); }}>
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </Button>
                )}
                <CardImg card={c} alt={c.name} className={`w-full card-aspect object-cover transition-all ${owned ? "" : "opacity-60 grayscale"}`} />
                <div className="p-2">
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.code}{c.rarity ? ` · ${c.rarity}` : ""}</p>
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
            const busy = quickAddBusy.has(c.id);
            return (
              <Card key={c.id} className={`flex items-center gap-3 px-3 py-2 bg-gradient-card cursor-pointer hover:shadow-card transition-shadow ${owned ? "" : "opacity-70"}`} onClick={() => onPickCard(c)}>
                <div className="font-mono text-xs text-muted-foreground w-20 shrink-0 truncate">{c.code ?? "—"}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  {c.rarity && <p className="text-xs text-muted-foreground truncate">{c.rarity}</p>}
                </div>
                {owned && lang && <Badge variant="secondary" className="text-xs shrink-0">{LANG_FLAG[lang] ?? lang}</Badge>}
                <div className="flex items-center gap-1 shrink-0">
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={(e) => { e.stopPropagation(); onToggleWanted(c); }}>
                    <Heart className={`h-4 w-4 ${wanted ? "fill-red-500 text-red-500" : "text-muted-foreground"}`} />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={busy} onClick={(e) => { e.stopPropagation(); onQuickAdd(c); }}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </Button>
                  {owned && (
                    <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={(e) => { e.stopPropagation(); onPickCard(c); }}>
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
