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
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { cardImage, proxiedImage, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";

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

// Same id-extraction logic as the edge function, used to match local cards to sets.
function extractSetId(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/\[([A-Z]{1,4}-?\d{1,3}[A-Z]?)\]/i);
  if (m) return m[1].toUpperCase().replace(/-/g, "");
  const m2 = s.match(/\b(OP|ST|EB|PRB|GC)-?(\d{1,3})\b/i);
  if (m2) return (m2[1] + m2[2]).toUpperCase();
  return null;
}

function setIdForCard(game: Game, c: { set_id: string | null; set_name: string | null; code: string | null }): string | null {
  if (game === "pokemon") return c.set_id ?? null;
  // One Piece: derive from set_name or card code
  return extractSetId(c.set_name) ?? extractSetId(c.code ?? "");
}

export default function MasterSets() {
  const { game } = useParams<{ game: Game }>();
  const [sets, setSets] = useState<SetInfo[]>([]);
  const [ownedBySet, setOwnedBySet] = useState<Map<string, number>>(new Map());
  const [loadingSets, setLoadingSets] = useState(true);
  const [query, setQuery] = useState("");
  const [activeSet, setActiveSet] = useState<SetInfo | null>(null);

  // Add-to-collection dialog
  const [picked, setPicked] = useState<CardRow | null>(null);
  const [rarity, setRarity] = useState("");
  const [language, setLanguage] = useState("EN");
  const [quantity, setQuantity] = useState(1);

  // Load sets + owned counts on mount / game change
  useEffect(() => {
    if (!game) return;
    setLoadingSets(true);
    setActiveSet(null);
    setQuery("");
    (async () => {
      // Fetch sets via direct GET (edge function reads ?game=)
      let setsList: SetInfo[] = [];
      try {
        const res = await fetch(
          `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/card-sets?game=${game}`,
          { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } },
        );
        const json = await res.json();
        setsList = json.sets ?? [];
      } catch (e) {
        console.error(e);
      }
      setSets(setsList);

      const userRes = await supabase.auth.getUser();

      const uid = userRes.data.user?.id;
      if (uid) {
        // Pull every owned card row for this game with its set info
        const { data: owned } = await supabase
          .from("collection_entries")
          .select("quantity, cards!inner(set_id, set_name, code, game)")
          .eq("user_id", uid)
          .eq("game", game);
        const counts = new Map<string, number>();
        for (const row of owned ?? []) {
          // typing: cards relation
          const c = (row as unknown as { cards: { set_id: string | null; set_name: string | null; code: string | null } }).cards;
          const id = setIdForCard(game, c);
          if (!id) continue;
          counts.set(id, (counts.get(id) ?? 0) + 1); // count distinct owned entries; not summing quantity
        }
        setOwnedBySet(counts);
      }
      setLoadingSets(false);
    })();
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
    setRarity(c.rarity ?? "");
    setLanguage("EN");
    setQuantity(1);
  };

  const [ownedCardIds, setOwnedCardIds] = useState<Set<string>>(new Set());

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
    setPicked(null);
    setOwnedCardIds((prev) => {
      const next = new Set(prev);
      next.add(savedId);
      return next;
    });
    if (savedSetId) {
      setOwnedBySet((prev) => new Map(prev).set(savedSetId, (prev.get(savedSetId) ?? 0) + 1));
    }
  };

  if (!game) return null;

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
          ownedCardIds={ownedCardIds}
          setOwnedCardIds={setOwnedCardIds}
        />
      ) : (
        <>
          <div className="relative mb-6 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={
                game === "onepiece"
                  ? "Search by name or code (e.g. Azure Sea Seven, OP14, ST21)"
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
              {loadingSets ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <SetGrid sets={visibleSets} ownedBySet={ownedBySet} onOpen={setActiveSet} />
              )}
            </TabsContent>

            <TabsContent value="mine" className="mt-6">
              {ownedSets.length === 0 ? (
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to collection</DialogTitle>
          </DialogHeader>
          {picked && (
            <div className="grid grid-cols-[120px_1fr] gap-4">
              {(() => {
                const img = cardImage(picked.game, picked.code, picked.image_small);
                return img && (
                  <img
                    src={img}
                    alt=""
                    className="rounded-lg w-full"
                    onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                  />
                );
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
                    <SelectContent>{LANGS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantity</Label>
                  <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} />
                </div>
                <Button className="w-full" onClick={saveCard}>Add to collection</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
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
        const owned = ownedBySet.get(s.id) ?? 0;
        const total = s.total ?? 0;
        const pct = total > 0 ? Math.min(100, Math.round((owned / total) * 100)) : 0;
        return (
          <Card
            key={s.id}
            className="p-4 cursor-pointer hover:shadow-card transition-shadow bg-gradient-card"
            onClick={() => onOpen(s)}
          >
            <div className="flex items-start gap-3">
              {s.logo ? (
                <img
                  src={proxiedImage(s.logo)}
                  alt=""
                  className="h-14 w-14 object-contain rounded bg-background/40 p-1"
                  loading="lazy"
                  onError={(e) => {
                    const el = e.currentTarget as HTMLImageElement;
                    el.style.display = "none";
                    const fb = el.nextElementSibling as HTMLElement | null;
                    if (fb) fb.style.display = "flex";
                  }}
                />
              ) : null}
              <div
                className="h-14 w-14 rounded bg-muted items-center justify-center text-xs font-mono shrink-0"
                style={{ display: s.logo ? "none" : "flex" }}
              >
                {s.id}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.id}{s.releaseDate ? ` · ${s.releaseDate}` : ""}
                </p>
              </div>
              <Badge variant={owned > 0 ? "default" : "secondary"}>
                {owned}{total ? `/${total}` : ""}
              </Badge>
            </div>
            {total > 0 && (
              <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function SetView({
  game,
  set,
  onBack,
  onPickCard,
  ownedCardIds,
  setOwnedCardIds,
}: {
  game: Game;
  set: SetInfo;
  onBack: () => void;
  onPickCard: (c: CardRow) => void;
  ownedCardIds: Set<string>;
  setOwnedCardIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const [cards, setCards] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      // Live fetch the full set list (and cache in DB)
      const { data, error } = await supabase.functions.invoke("card-search", {
        body: { game, setId: set.id },
      });
      if (error) toast.error(error.message);
      const remote = ((data?.cards as CardRow[]) ?? []);

      // Also pull whatever is already cached locally for this set, so we still
      // show something if the live API returned nothing.
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

      // owned ids
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        const { data: owned } = await supabase
          .from("collection_entries")
          .select("card_id")
          .eq("user_id", userData.user.id)
          .eq("game", game);
        setOwnedIds(new Set((owned ?? []).map((r) => r.card_id)));
      }
      setLoading(false);
    })();
  }, [game, set.id]);

  const ownedCount = cards.filter((c) => ownedIds.has(c.id)).length;

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
        <Badge variant="default" className="text-sm">
          {ownedCount}/{cards.length || set.total || "?"}
        </Badge>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : cards.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">
          No cards available for this expansion yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {cards.map((c) => {
            const img = cardImage(c.game, c.code, c.image_small);
            const owned = ownedIds.has(c.id);
            return (
              <Card
                key={c.id}
                className="overflow-hidden bg-gradient-card cursor-pointer hover:shadow-card transition-shadow"
                onClick={() => onPickCard(c)}
              >
                {img ? (
                  <img
                    src={img}
                    alt={c.name}
                    loading="lazy"
                    className={`w-full card-aspect object-cover ${owned ? "" : "opacity-40 grayscale"}`}
                    onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                  />
                ) : (
                  <div className="w-full card-aspect bg-muted flex items-center justify-center text-muted-foreground text-xs">
                    No image
                  </div>
                )}
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
      )}
    </div>
  );
}
