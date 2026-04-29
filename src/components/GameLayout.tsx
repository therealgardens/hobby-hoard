import { NavLink, Outlet, useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { GAME_LABEL, type Game, setActiveGame } from "@/lib/game";
import { ArrowLeft, BookOpen, Library, Heart, Layers, Copy, Swords, ListChecks, Search, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export default function GameLayout() {
  const { game } = useParams<{ game: Game }>();
  const nav = useNavigate();
  const { signOut } = useAuth();
  const { t } = useTranslation();
  if (!game || (game !== "pokemon" && game !== "onepiece")) {
    nav("/");
    return null;
  }
  setActiveGame(game);

  const links = [
    { to: ``, label: "Home", icon: Library, end: true },
    { to: `master`, label: "Master Sets", icon: Layers },
    { to: `search`, label: "Search", icon: Search },
    { to: `binders`, label: "Binders", icon: BookOpen },
    { to: `wanted`, label: "Wanted", icon: Heart },
    { to: `duplicates`, label: "Duplicates", icon: Copy },
    ...(game === "pokemon" ? [{ to: `pokedex`, label: "Pokédex", icon: ListChecks }] : []),
    ...(game === "onepiece" ? [{ to: `decks`, label: "Decks", icon: Swords }] : []),
  ];

  const accent = game === "pokemon" ? "bg-gradient-pokemon" : "bg-gradient-onepiece";

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
