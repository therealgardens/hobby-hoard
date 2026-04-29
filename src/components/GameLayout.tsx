import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { GAME_LABEL, type Game, setActiveGame } from "@/lib/game";
import { ArrowLeft, BookOpen, Library, Heart, Layers, Copy, Swords, ListChecks, Search, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { withDbRetry } from "@/lib/supabaseRetry";

type NavCounts = Partial<Record<"master" | "binders" | "wanted" | "duplicates" | "decks" | "pokedex", string>>;

function setIdForCard(game: Game, c: { set_id: string | null; set_name: string | null; code: string | null }): string | null {
  if (game === "pokemon" || game === "yugioh") return c.set_id ?? null;
  const fromCode = c.code?.match(/^([A-Z]+\d+)/i)?.[1] ?? null;
  if (fromCode) return fromCode.toUpperCase();
  const fromName = c.set_name?.match(/\b([A-Z]+\d+)\b/)?.[1] ?? null;
  return fromName ? fromName.toUpperCase() : null;
}

export default function GameLayout() {
  const { game } = useParams<{ game: Game }>();
  const nav = useNavigate();
  const { signOut, user } = useAuth();
  const { t } = useTranslation();
  const [counts, setCounts] = useState<NavCounts>({});
  if (!game || (game !== "pokemon" && game !== "onepiece" && game !== "yugioh")) {
    nav("/");
    return null;
  }
  setActiveGame(game);

  useEffect(() => {
    if (!user) {
      setCounts({});
      return;
    }
    let cancelled = false;

    (async () => {
      const zeroCount = { count: 0, data: null, error: null } as any;
      const [collectionRes, bindersRes, wantedRes, decksRes, pokedexRes, setsRes] = await Promise.all([
        withDbRetry(() => supabase.from("collection_entries").select("card_id, quantity").eq("user_id", user.id).eq("game", game)),
        withDbRetry(() => supabase.from("binders").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("game", game)),
        withDbRetry(() => supabase.from("wanted_cards").select("card_id, quantity").eq("user_id", user.id).eq("game", game)),
        game === "onepiece" || game === "yugioh"
          ? withDbRetry(() => supabase.from("decks").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("game", game))
          : Promise.resolve(zeroCount),
        game === "pokemon"
          ? withDbRetry(() => supabase.from("pokedex_entries").select("id", { count: "exact", head: true }).eq("user_id", user.id))
          : Promise.resolve(zeroCount),
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/card-sets?game=${game}`)
          .then((r) => (r.ok ? r.json() : { sets: [] }))
          .catch(() => ({ sets: [] })),
      ]);

      const collectionRows = (collectionRes.data ?? []) as Array<{ card_id: string; quantity: number }>;
      const uniqueWithDupes = new Set<string>();
      let duplicateCopies = 0;
      for (const row of collectionRows) {
        const q = row.quantity ?? 0;
        if (q > 1) {
          uniqueWithDupes.add(row.card_id);
          duplicateCopies += q;
        }
      }

      const ownedSetIds = new Set<string>();
      const cardIds = Array.from(new Set(collectionRows.map((r) => r.card_id)));
      if (cardIds.length) {
        const { data: cardsData } = await withDbRetry(() =>
          supabase.from("cards").select("id, set_id, set_name, code").in("id", cardIds),
        );
        for (const c of (cardsData ?? []) as any[]) {
          const setId = setIdForCard(game, c);
          if (setId) ownedSetIds.add(setId);
        }
      }

      const wantedRows = (wantedRes.data ?? []) as Array<{ card_id: string; quantity: number }>;
      const wantedUnique = new Set(wantedRows.map((r) => r.card_id)).size;
      const wantedTotal = wantedRows.reduce((sum, row) => sum + (row.quantity ?? 0), 0);
      const totalSets = Array.isArray((setsRes as any).sets) ? (setsRes as any).sets.length : 0;

      if (!cancelled) {
        setCounts({
          master: `${ownedSetIds.size}/${totalSets}`,
          binders: String((bindersRes as any).count ?? 0),
          wanted: `${wantedUnique}/${wantedTotal}`,
          duplicates: `${duplicateCopies}/${uniqueWithDupes.size}`,
          decks: String((decksRes as any).count ?? 0),
          pokedex: String((pokedexRes as any).count ?? 0),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [game, user]);

  const links = [
    { to: ``, label: "Home", icon: Library, end: true },
    { to: `master`, label: "Master Sets", icon: Layers },
    { to: `search`, label: "Search", icon: Search },
    { to: `binders`, label: "Binders", icon: BookOpen },
    { to: `wanted`, label: "Wanted", icon: Heart },
    { to: `duplicates`, label: "Duplicates", icon: Copy },
    ...(game === "pokemon" ? [{ to: `pokedex`, label: "Pokédex", icon: ListChecks }] : []),
    ...(game === "onepiece" || game === "yugioh" ? [{ to: `decks`, label: "Decks", icon: Swords }] : []),
  ];

  const accent =
    game === "pokemon" ? "bg-gradient-pokemon"
    : game === "onepiece" ? "bg-gradient-onepiece"
    : "bg-gradient-yugioh";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className={cn("text-primary-foreground", accent)}>
        <div className="container mx-auto flex items-center justify-between py-4 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => nav("/")} className="text-primary-foreground hover:bg-white/10">
              <ArrowLeft className="h-4 w-4 mr-1" /> {t("nav.switch")}
            </Button>
            <h1 className="text-3xl font-display">{GAME_LABEL[game]}</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => nav("/settings")} className="text-primary-foreground hover:bg-white/10">
              <Settings className="h-4 w-4 mr-1" /> {t("nav.settings")}
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut} className="text-primary-foreground hover:bg-white/10">
              {t("nav.signOut")}
            </Button>
          </div>
        </div>
        <nav className="container mx-auto px-4 pb-3 flex gap-1 overflow-x-auto">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                cn(
                  "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "bg-white/10 text-primary-foreground hover:bg-white/20",
                )
              }
            >
              <l.icon className="h-4 w-4" />
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
