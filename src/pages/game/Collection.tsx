import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Loader2 } from "lucide-react";
import { cardImageCandidates, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { withDbRetry } from "@/lib/supabaseRetry";
import { toast } from "sonner";

type CardRow = Tables<"cards">;
type Entry = {
  id: string;
  card_id: string;
  language: string;
  quantity: number;
  rarity: string | null;
  created_at: string;
  card: CardRow | null;
};

const PAGE_SIZE = 36;
const cacheKey = (game: string, uid: string) => `tcg.collection.${game}.${uid}.v1`;

export default function Collection() {
  const { game } = useParams<{ game: Game }>();
  const { user, loading: authLoading } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback(
    async (from: number) => {
      if (!user || !game) return { rows: [] as Entry[], end: true, error: null as string | null };
      const { data: rows, error } = await withDbRetry(() =>
        supabase
          .from("collection_entries")
          .select("id, card_id, language, quantity, rarity, created_at")
          .eq("user_id", user.id)
          .eq("game", game)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE_SIZE - 1),
      );
      if (error) {
        return { rows: [], end: true, error: error.message };
      }
      const ids = Array.from(new Set((rows ?? []).map((r) => r.card_id)));
      let byId = new Map<string, CardRow>();
      if (ids.length) {
        const { data: cards, error: cErr } = await withDbRetry(() =>
          supabase
            .from("cards")
            .select("id, game, code, name, rarity, set_name, image_small, image_large")
            .in("id", ids),
        );
        if (cErr) {
          return { rows: [], end: true, error: cErr.message };
        }
        byId = new Map((cards ?? []).map((c: any) => [c.id, c as CardRow]));
      }
      const mapped = (rows ?? []).map((r) => ({ ...r, card: byId.get(r.card_id) ?? null }));
      return { rows: mapped, end: (rows?.length ?? 0) < PAGE_SIZE, error: null };
    },
    [user, game],
  );

  const loadInitial = useCallback(() => {
    if (!game || !user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDone(false);
    fetchPage(0).then(({ rows, end, error: err }) => {
      if (cancelled) return;
      if (err) {
        setError(err);
        setLoading(false);
        return;
      }
      setEntries(rows);
      setDone(end);
      setLoading(false);
      try {
        sessionStorage.setItem(cacheKey(game, user.id), JSON.stringify({ rows, end, t: Date.now() }));
      } catch {}
    });
    return () => {
      cancelled = true;
    };
  }, [game, user, fetchPage]);

  // Initial load — hydrate from cache instantly, then refresh in background
  useEffect(() => {
    if (!game || authLoading) return;
    if (!user) {
      setEntries([]);
      setLoading(false);
      return;
    }
    // Hydrate cache for instant paint
    try {
      const raw = sessionStorage.getItem(cacheKey(game, user.id));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.rows) {
          setEntries(parsed.rows);
          setDone(!!parsed.end);
          setLoading(false);
        }
      }
    } catch {}
    return loadInitial();
  }, [game, user?.id, authLoading, loadInitial]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || done || error) return;
    setLoadingMore(true);
    const { rows, end, error: err } = await fetchPage(entries.length);
    if (err) {
      toast.error(err);
      setLoadingMore(false);
      return;
    }
    setEntries((prev) => {
      const next = [...prev, ...rows];
      if (game && user) {
        try {
          sessionStorage.setItem(cacheKey(game, user.id), JSON.stringify({ rows: next, end, t: Date.now() }));
        } catch {}
      }
      return next;
    });
    setDone(end);
    setLoadingMore(false);
  }, [entries.length, loading, loadingMore, done, error, fetchPage, game, user]);

  // Infinite-scroll sentinel
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, done]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((e) => {
      const c = e.card;
      if (!c) return false;
      return (
        c.name.toLowerCase().includes(term) ||
        (c.code ?? "").toLowerCase().includes(term) ||
        (c.set_name ?? "").toLowerCase().includes(term)
      );
    });
  }, [entries, q]);

  if (!game) return null;

  return (
    <div>
      <h2 className="text-4xl font-display mb-2">My Collection</h2>
      <p className="text-muted-foreground mb-6">
        Every card you own, in the order you added them.
      </p>

      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, code or set"
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
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
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">
          {entries.length === 0
            ? "Your collection is empty. Add cards from Master Sets or Search."
            : "No cards match your search."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filtered.map((e) => (
              <Card key={e.id} className="overflow-hidden bg-gradient-card relative">
                {e.card ? (
                  <CardImg card={e.card} />
                ) : (
                  <div className="w-full card-aspect bg-muted flex items-center justify-center text-muted-foreground text-xs">
                    Unknown card
                  </div>
                )}
                {e.quantity > 1 && (
                  <Badge className="absolute top-2 right-2">×{e.quantity}</Badge>
                )}
                <div className="p-2">
                  <p className="text-sm font-semibold truncate">
                    {e.card?.name ?? "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {e.card?.code ?? "—"}
                    {e.rarity ? ` · ${e.rarity}` : ""}
                  </p>
                </div>
              </Card>
            ))}
          </div>

          {!done && (
            <div ref={sentinelRef} className="flex justify-center py-6">
              {loadingMore ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <Button variant="ghost" size="sm" onClick={loadMore}>
                  Load more
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CardImg({ card }: { card: CardRow }) {
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
      alt={card.name}
      loading="lazy"
      className="w-full card-aspect object-cover"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
