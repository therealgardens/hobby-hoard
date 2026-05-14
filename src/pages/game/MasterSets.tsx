// src/pages/game/MasterSets.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
import { CardSearch } from "@/components/CardSearch";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, BookOpen, Clock, Heart, LayoutGrid, List, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import {
  cardImageCandidates,
  proxiedImage,
  setIdForCard,
  setImageCandidates,
  type Game,
} from "@/lib/game";
import { cardBelongsToSet, dedupeCardsByPrinting, getPrintingKey } from "@/lib/cardNormalization";
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

interface RecentEntry {
  entryId: string;
  cardId: string;
  cardName: string;
  cardCode: string | null;
  imageSmall: string | null;
  game: string;
  addedAt: string;
}

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

const SETS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface OwnedCache {
  counts: Map<string, number>;
  ids: Set<string>;
  langs: Map<string, string>;
}

const _ownedCache = new Map<string, OwnedCache>();
const _setsCache = new Map<string, SetInfo[]>();

function normalizeSetKey(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getOwnedCountForSet(ownedBySet: Map<string, number>, setId: string): number {
  return ownedBySet.get(normalizeSetKey(setId)) ?? 0;
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

function SetThumb({ game, set }: { game: Game; set: SetInfo }) {
  const candidates = useMemo(() => setImageCandidates(game, set.id, set.logo), [game, set.id, set.logo]);
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];

  if (!src) {
    return <div className="h-14 w-14 rounded bg-muted flex items-center justify-center text-xs font-mono shrink-0">{set.id}</div>;
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
          <div className="p-2 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function SetGrid({
  game,
  sets,
  ownedBySet,
  onOpen,
}: {
  game: Game;
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
        const count = getOwnedCountForSet(ownedBySet, s.id);
        return (
          <Card key={s.id} className="p-4 cursor-pointer hover:shadow-card transition-shadow bg-gradient-card" onClick={() => onOpen(s)}>
            <div className="flex items-start gap-3">
              <SetThumb game={game} set={s} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.id}
                  {s.releaseDate ? ` · ${s.releaseDate}` : ""}
                  {count > 0 ? ` · ${count} owned` : ""}
                </p>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function RecentCards({
  entries,
  loading,
  onRemove,
}: {
  entries: RecentEntry[];
  loading: boolean;
  onRemove: (entryId: string, cardId: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="flex items-center gap-3 px-3 py-2 bg-gradient-card">
            <Skeleton className="h-10 w-8 rounded" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (!entries.length) {
    return <p className="text-muted-foreground text-center py-12">Nessuna carta aggiunta ancora.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground mb-3">Ultime {entries.length} carte aggiunte — clicca 🗑 per rimuovere un'aggiunta per errore.</p>
      {entries.map((e) => {
        const imgSrc = e.imageSmall ? proxiedImage(e.imageSmall) : null;
        const date = new Date(e.addedAt).toLocaleString("it-IT", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });

        return (
          <Card key={e.entryId} className="flex items-center gap-3 px-3 py-2 bg-gradient-card">
            {imgSrc ? (
              <img src={imgSrc} alt={e.cardName} className="h-10 w-8 object-cover rounded shrink-0" loading="lazy" />
            ) : (
              <div className="h-10 w-8 bg-muted rounded shrink-0 flex items-center justify-center text-[9px] font-mono text-muted-foreground">
                {e.cardCode?.slice(0, 4) ?? "?"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{e.cardName}</p>
              <p className="text-xs text-muted-foreground">{e.cardCode ?? "—"} · {date}</p>
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 hover:bg-destructive/10 hover:text-destructive" onClick={() => onRemove(e.entryId, e.cardId)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </Card>
        );
      })}
    </div>
  );
}

interface CreateBinderDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  game: Game;
  set: SetInfo;
  cards: CardRow[];
  ownedCardIds: Set<string>;
  onCreated: (binderId: string) => void;
}

function CreateBinderDialog({ open, onOpenChange, game, set, cards, ownedCardIds, onCreated }: CreateBinderDialogProps) {
  const { user } = useAuth();
  const [name, setName] = useState(`${set.name} Binder`);
  const [creating, setCreating] = useState(false);
  const [onlyOwned, setOnlyOwned] = useState(true);

  useEffect(() => {
    if (open) {
      setName(`${set.name} Binder`);
      setOnlyOwned(true);
    }
  }, [open, set.name]);

  const cardsToPlace = onlyOwned ? cards.filter((c) => ownedCardIds.has(c.id)) : cards;

  async function handleCreate() {
    if (!user) {
      toast.error("Devi essere loggato");
      return;
    }
    if (!name.trim()) {
      toast.error("Inserisci un nome");
      return;
    }

    try {
      setCreating(true);
      const binderId = crypto.randomUUID();
      const { error: binderErr } = await withDbRetry(() =>
        supabase.from("binders").insert({
          id: binderId,
          user_id: user.id,
          game,
          name: name.trim(),
          rows: 3,
          cols: 3,
          description: `${set.name} (${set.id})`,
        } as any)
      );

      if (binderErr) {
        toast.error(binderErr.message);
        return;
      }

      const slots = cardsToPlace.map((c, idx) => ({
        binder_id: binderId,
        user_id: user.id,
        position: idx,
        card_id: c.id,
        is_wanted: !ownedCardIds.has(c.id),
      }));

      const BATCH = 200;
      for (let i = 0; i < slots.length; i += BATCH) {
        const { error: slotErr } = await withDbRetry(() => supabase.from("binder_slots").insert(slots.slice(i, i + BATCH) as any));
        if (slotErr) {
          toast.error(slotErr.message);
          return;
        }
      }

      toast.success("Binder creato");
      onOpenChange(false);
      onCreated(binderId);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crea binder da {set.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nome binder</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="font-medium">Solo carte possedute</p>
              <p className="text-sm text-muted-foreground">Se disattivo, aggiungo anche le mancanti come wanted.</p>
            </div>
            <input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} />
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Carte da inserire: <strong>{cardsToPlace.length}</strong></p>
            {!onlyOwned && cards.filter((c) => !ownedCardIds.has(c.id)).length > 0 && (
              <p>💛 <strong>{cards.filter((c) => !ownedCardIds.has(c.id)).length}</strong> carte marcate come wanted</p>
            )}
          </div>
          <Button className="w-full" onClick={handleCreate} disabled={creating || cardsToPlace.length === 0}>
            {creating ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creazione in corso…</> : <><BookOpen className="h-4 w-4 mr-2" /> Crea binder</>}
          </Button>
          {cardsToPlace.length === 0 && <p className="text-xs text-center text-muted-foreground">Nessuna carta da inserire.</p>}
        </div>
      </DialogContent>
    </Dialog>
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
  quickAddBusy,
  onBinderCreated,
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
  quickAddBusy: Set<string>;
  onBinderCreated: (binderId: string) => void;
}) {
  const [cards, setCards] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"grid" | "list">(() => {
    if (typeof window === "undefined") return "grid";
    return (localStorage.getItem("masterset.view") as "grid" | "list") ?? "grid";
  });
  const [showOnlyOwned, setShowOnlyOwned] = useState(false);
  const [binderDialogOpen, setBinderDialogOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("masterset.view", view);
    } catch (_) {}
  }, [view]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("card-search", { body: { game, setId: set.id } });
        if (error) toast.error(error.message);

        const remote = ((data?.cards as CardRow[]) ?? []).filter((c) => cardBelongsToSet(game, c, set.id));

        const localRows: CardRow[] = [];
        const pageSize = 1000;
        let from = 0;

        while (true) {
          const { data: chunk, error: localError } = await supabase
            .from("cards")
            .select("*")
            .eq("game", game)
            .range(from, from + pageSize - 1);

          if (localError) {
            toast.error(localError.message);
            break;
          }

          const rows = ((chunk ?? []) as CardRow[]).filter((c) => cardBelongsToSet(game, c, set.id));
          localRows.push(...rows);

          if (!chunk || chunk.length < pageSize) break;
          from += pageSize;
        }

        const merged = dedupeCardsByPrinting([...remote, ...localRows]).sort((a, b) =>
          (a.code ?? "").localeCompare(b.code ?? "", undefined, { numeric: true, sensitivity: "base" })
        );

        if (!cancelled) {
          setCards(merged);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [game, set.id]);

  const isOwned = (c: CardRow) => ownedCardIds.has(c.id);

  const visibleCards = useMemo(() => (showOnlyOwned ? cards.filter(isOwned) : cards), [cards, showOnlyOwned, ownedCardIds]);
  const ownedCount = cards.filter(isOwned).length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex-1 min-w-0">
          <h3 className="text-2xl font-display">{set.name}</h3>
          <p className="text-xs text-muted-foreground">{set.id}{set.releaseDate ? ` · ${set.releaseDate}` : ""}</p>
        </div>
        {!loading && cards.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setBinderDialogOpen(true)}>
            <BookOpen className="h-4 w-4 mr-1" /> Crea binder
          </Button>
        )}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{ownedCount}/{cards.length}</span>
          <button
            type="button"
            onClick={() => setShowOnlyOwned((v) => !v)}
            className={`px-2 py-1 rounded text-xs border transition-colors ${showOnlyOwned ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
          >
            {showOnlyOwned ? "Tutte" : "Solo mie"}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant={view === "grid" ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => setView("grid")}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button variant={view === "list" ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => setView("list")}>
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <CreateBinderDialog
        open={binderDialogOpen}
        onOpenChange={setBinderDialogOpen}
        game={game}
        set={set}
        cards={cards}
        ownedCardIds={ownedCardIds}
        onCreated={onBinderCreated}
      />

      {loading ? (
        <SetViewSkeleton />
      ) : visibleCards.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">
          {showOnlyOwned ? "Non possiedi ancora nessuna carta di questo set." : "No cards found for this set."}
        </p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {visibleCards.map((c) => {
            const owned = isOwned(c);
            const wanted = wantedCardIds.has(c.id);
            const busy = quickAddBusy.has(c.id);

            return (
              <Card key={getPrintingKey(c)} className={`overflow-hidden cursor-pointer bg-gradient-card transition-all hover:shadow-card ${owned ? "ring-2 ring-primary/60" : ""}`} onClick={() => onPickCard(c)}>
                <div className="relative">
                  <CardImg card={c} className="w-full card-aspect object-cover" alt={c.name} />
                  {owned && <Badge className="absolute top-1 right-1 text-[10px] px-1 py-0 bg-primary/90">✓</Badge>}
                  {!owned && wanted && <Badge variant="outline" className="absolute top-1 right-1 text-[10px] px-1 py-0 border-yellow-400 text-yellow-500">♡</Badge>}
                </div>
                <div className="p-2">
                  <p className="text-xs font-semibold truncate">{c.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{c.code}{c.rarity ? ` · ${c.rarity}` : ""}</p>
                  <div className="flex gap-1 mt-1.5">
                    <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-primary/10 hover:text-primary" disabled={busy} onClick={(e) => { e.stopPropagation(); onQuickAdd(c); }}>
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    </Button>
                    <Button size="icon" variant="ghost" className={`h-6 w-6 ${wanted ? "text-yellow-500 hover:text-yellow-600" : "hover:text-yellow-500"}`} onClick={(e) => { e.stopPropagation(); onToggleWanted(c); }}>
                      <Heart className="h-3 w-3" fill={wanted ? "currentColor" : "none"} />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {visibleCards.map((c) => {
            const owned = isOwned(c);
            const wanted = wantedCardIds.has(c.id);
            const busy = quickAddBusy.has(c.id);
            const lang = ownedLangByCard.get(c.id);

            return (
              <Card key={getPrintingKey(c)} className={`flex items-center gap-3 px-3 py-2 cursor-pointer bg-gradient-card hover:shadow-card transition-all ${owned ? "ring-1 ring-primary/40" : ""}`} onClick={() => onPickCard(c)}>
                <CardImg card={c} className="h-10 w-8 object-cover rounded shrink-0" alt="" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.code}{c.rarity ? ` · ${c.rarity}` : ""}</p>
                </div>
                {owned && <Badge className="text-[10px] shrink-0">{lang ? `${LANG_FLAG[lang] ?? ""} ${lang}` : "✓"}</Badge>}
                {!owned && wanted && <Badge variant="outline" className="text-[10px] border-yellow-400 text-yellow-500 shrink-0">Wanted</Badge>}
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-primary/10 hover:text-primary" disabled={busy} onClick={(e) => { e.stopPropagation(); onQuickAdd(c); }}>
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  </Button>
                  <Button size="icon" variant="ghost" className={`h-7 w-7 ${wanted ? "text-yellow-500 hover:text-yellow-600" : "hover:text-yellow-500"}`} onClick={(e) => { e.stopPropagation(); onToggleWanted(c); }}>
                    <Heart className="h-3 w-3" fill={wanted ? "currentColor" : "none"} />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MasterSets() {
  const { game: gameParam } = useParams();
  const game = (gameParam ?? "onepiece") as Game;
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [sets, setSets] = useState<SetInfo[]>([]);
  const [setsLoading, setSetsLoading] = useState(true);
  const [selectedSet, setSelectedSet] = useState<SetInfo | null>(null);
  const [query, setQuery] = useState("");
  const [ownedBySet, setOwnedBySet] = useState<Map<string, number>>(new Map());
  const [ownedCardIds, setOwnedCardIds] = useState<Set<string>>(new Set());
  const [ownedLangByCard, setOwnedLangByCard] = useState<Map<string, string>>(new Map());
  const [wantedCardIds, setWantedCardIds] = useState<Set<string>>(new Set());
  const [quickAddBusy, setQuickAddBusy] = useState<Set<string>>(new Set());
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newBinderId, setNewBinderId] = useState<string | null>(null);
  const [collectionLanguage, setCollectionLanguage] = useState("EN");
  const [collectionRarity, setCollectionRarity] = useState("");

  const filteredSets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sets;
    return sets.filter((s) =>
      [s.id, s.name, s.series, s.releaseDate].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [sets, query]);

  useEffect(() => {
    const fromState = location.state as { setId?: string } | null;
    if (!fromState?.setId || sets.length === 0) return;
    const found = sets.find((s) => normalizeSetKey(s.id) === normalizeSetKey(fromState.setId!));
    if (found) setSelectedSet(found);
  }, [location.state, sets]);

  useEffect(() => {
    let cancelled = false;

    async function loadSets() {
      setSetsLoading(true);
      try {
        const cacheKey = `sets:${game}`;
        const cached = _setsCache.get(cacheKey);
        if (cached) {
          if (!cancelled) setSets(cached);
          return;
        }

        const { data, error } = await supabase.functions.invoke("card-sets", { body: { game } });
        if (error) {
          toast.error(error.message);
          if (!cancelled) setSets([]);
          return;
        }

        const result = ((data?.sets ?? []) as SetInfo[]).sort((a, b) =>
          String(b.releaseDate ?? "").localeCompare(String(a.releaseDate ?? ""))
        );

        _setsCache.set(cacheKey, result);
        if (!cancelled) setSets(result);
      } finally {
        if (!cancelled) setSetsLoading(false);
      }
    }

    loadSets();
    return () => {
      cancelled = true;
    };
  }, [game]);

  useEffect(() => {
    let cancelled = false;

    async function refreshOwned() {
      if (!user) {
        if (!cancelled) {
          setOwnedBySet(new Map());
          setOwnedCardIds(new Set());
          setOwnedLangByCard(new Map());
        }
        return;
      }

      const cacheKey = `${user.id}:${game}`;
      const cached = _ownedCache.get(cacheKey);
      if (cached) {
        if (!cancelled) {
          setOwnedBySet(new Map(cached.counts));
          setOwnedCardIds(new Set(cached.ids));
          setOwnedLangByCard(new Map(cached.langs));
        }
      }

      const { data: rows, error } = await supabase
        .from("collection_entries")
        .select("card_id, language")
        .eq("user_id", user.id)
        .eq("game", game);

      if (error) {
        toast.error(error.message);
        return;
      }

      const ids = Array.from(new Set((rows ?? []).map((r: any) => r.card_id).filter(Boolean))) as string[];
      const langs = new Map<string, string>();
      for (const row of (rows ?? []) as Array<{ card_id: string; language: string | null }>) {
        if (row.card_id && row.language && !langs.has(row.card_id)) {
          langs.set(row.card_id, row.language);
        }
      }

      const counts = new Map<string, number>();

      if (ids.length) {
        const pageSize = 1000;
        let offset = 0;
        const ownedCards: CardRow[] = [];

        while (true) {
          const slice = ids.slice(offset, offset + pageSize);
          if (!slice.length) break;

          const { data: chunk } = await supabase
            .from("cards")
            .select("id, game, set_id, set_name, code")
            .in("id", slice);

          ownedCards.push(...(((chunk ?? []) as CardRow[])));
          offset += pageSize;
        }

        for (const card of ownedCards) {
          const setId = setIdForCard(game, card);
          const key = normalizeSetKey(setId);
          if (!key) continue;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }

      const cacheValue = {
        counts: new Map(counts),
        ids: new Set(ids),
        langs: new Map(langs),
      };

      _ownedCache.set(cacheKey, cacheValue);

      if (!cancelled) {
        setOwnedBySet(counts);
        setOwnedCardIds(new Set(ids));
        setOwnedLangByCard(langs);
      }
    }

    refreshOwned();

    const off = onCollectionChanged(() => {
      _ownedCache.delete(`${user?.id}:${game}`);
      refreshOwned();
    });

    return () => {
      cancelled = true;
      off();
    };
  }, [user, game]);

  useEffect(() => {
    let cancelled = false;

    async function refreshWishlist() {
      const ids = await listWishlist(game);
      if (!cancelled) setWantedCardIds(new Set(ids));
    }

    refreshWishlist();
    return () => {
      cancelled = true;
    };
  }, [game]);

  useEffect(() => {
    let cancelled = false;

    async function loadRecent() {
      setRecentLoading(true);
      try {
        if (!user) {
          if (!cancelled) setRecentEntries([]);
          return;
        }

        const { data, error } = await supabase
          .from("collection_entries")
          .select("id, created_at, card_id, cards(name, code, image_small, game)")
          .eq("user_id", user.id)
          .eq("game", game)
          .order("created_at", { ascending: false })
          .limit(12);

        if (error) {
          toast.error(error.message);
          if (!cancelled) setRecentEntries([]);
          return;
        }

        const entries: RecentEntry[] = ((data ?? []) as any[]).map((row) => ({
          entryId: row.id,
          cardId: row.card_id,
          cardName: row.cards?.name ?? "Unknown card",
          cardCode: row.cards?.code ?? null,
          imageSmall: row.cards?.image_small ?? null,
          game: row.cards?.game ?? game,
          addedAt: row.created_at,
        }));

        if (!cancelled) setRecentEntries(entries);
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    }

    loadRecent();
    return () => {
      cancelled = true;
    };
  }, [user, game]);

  async function handleQuickAdd(card: CardRow) {
    if (!user) {
      toast.error("Devi essere loggato");
      return;
    }

    setQuickAddBusy((prev) => new Set(prev).add(card.id));

    try {
      const payload = {
        user_id: user.id,
        card_id: card.id,
        game,
        language: collectionLanguage,
        quantity: 1,
        rarity: collectionRarity || null,
      };

      const { error } = await withDbRetry(() => supabase.from("collection_entries").insert(payload as any));
      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success("Carta aggiunta");
      emitCollectionChanged();
    } finally {
      setQuickAddBusy((prev) => {
        const next = new Set(prev);
        next.delete(card.id);
        return next;
      });
    }
  }

  async function handleToggleWanted(card: CardRow) {
    const wanted = wantedCardIds.has(card.id);

    if (wanted) {
      await removeWishlistByCard(game, card.id);
      setWantedCardIds((prev) => {
        const next = new Set(prev);
        next.delete(card.id);
        return next;
      });
      return;
    }

    await addWishlist(game, card.id);
    setWantedCardIds((prev) => new Set(prev).add(card.id));
  }

  async function handleRemoveRecent(entryId: string, _cardId: string) {
    const { error } = await withDbRetry(() => supabase.from("collection_entries").delete().eq("id", entryId));
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Aggiunta rimossa");
    emitCollectionChanged();
    setRecentEntries((prev) => prev.filter((e) => e.entryId !== entryId));
  }

  function handlePickCard(card: CardRow) {
    navigate(`/game/${game}/card/${card.id}`, { state: { card } });
  }

  function handleBinderCreated(binderId: string) {
    setNewBinderId(binderId);
    setCreateDialogOpen(true);
  }

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-display">Master Sets</h1>
          <p className="text-muted-foreground">Browse every expansion and track what you own.</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={collectionLanguage} onValueChange={setCollectionLanguage}>
            <SelectTrigger className="w-[100px]">
              <SelectValue placeholder="Lang" />
            </SelectTrigger>
            <SelectContent>
              {LANGS.map((lang) => (
                <SelectItem key={lang} value={lang}>
                  {LANG_FLAG[lang] ?? ""} {lang}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={collectionRarity || "__none__"} onValueChange={(v) => setCollectionRarity(v === "__none__" ? "" : v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Rarity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Any rarity</SelectItem>
              {RARITIES[game].map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="sets" className="space-y-6">
        <TabsList>
          <TabsTrigger value="sets">Sets</TabsTrigger>
          <TabsTrigger value="recent">
            <Clock className="h-4 w-4 mr-1" /> Recenti
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sets" className="space-y-4">
          {selectedSet ? (
            <SetView
              game={game}
              set={selectedSet}
              onBack={() => setSelectedSet(null)}
              onPickCard={handlePickCard}
              onQuickAdd={handleQuickAdd}
              ownedCardIds={ownedCardIds}
              ownedLangByCard={ownedLangByCard}
              wantedCardIds={wantedCardIds}
              onToggleWanted={handleToggleWanted}
              quickAddBusy={quickAddBusy}
              onBinderCreated={handleBinderCreated}
            />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search expansions by name, set id, series…"
                  className="max-w-md"
                />
              </div>

              {setsLoading ? (
                <SetGridSkeleton />
              ) : (
                <SetGrid game={game} sets={filteredSets} ownedBySet={ownedBySet} onOpen={setSelectedSet} />
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="recent">
          <RecentCards entries={recentEntries} loading={recentLoading} onRemove={handleRemoveRecent} />
        </TabsContent>
      </Tabs>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Binder creato</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Il binder è stato creato correttamente.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Chiudi
              </Button>
              {newBinderId && (
                <Button onClick={() => navigate(`/game/${game}/binders/${newBinderId}`)}>
                  Apri binder
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CardSearch
        game={game}
        open={false}
        onOpenChange={() => {}}
        onSelect={() => {}}
      />
    </div>
  );
}
