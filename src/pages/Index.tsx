import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { setActiveGame } from "@/lib/game";
import { useAuth } from "@/hooks/useAuth";
import heroImg from "@/assets/hero-binder.jpg";
import { LogOut, Settings as SettingsIcon } from "lucide-react";

export default function Index() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();

  const pick = (g: "pokemon" | "onepiece" | "yugioh") => {
    setActiveGame(g);
    nav(`/${g}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="container mx-auto flex items-center justify-between py-6">
        <h2 className="text-3xl text-primary font-display">CardKeeper</h2>
        {user && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => nav("/settings")}>
              <SettingsIcon className="h-4 w-4 mr-2" /> Settings
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </Button>
          </div>
        )}
      </header>

      <section className="container mx-auto px-4 pt-6 pb-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-6xl md:text-7xl leading-none text-secondary">
              Your <span className="text-primary">card</span> collection,
              <br /> finally organized.
            </h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-lg">
              Track every Pokémon and One Piece card you own. Build binders,
              chase wishlists, import decks, and never buy a duplicate by accident.
            </p>
          </div>
          <div className="rounded-3xl overflow-hidden shadow-card">
            <img src={heroImg} alt="Card binder illustration" className="w-full h-auto" />
          </div>
        </div>

        <h3 className="text-4xl mt-20 mb-6 text-secondary font-display text-center">Pick your collection</h3>
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          <Card
            onClick={() => pick("pokemon")}
            className="group cursor-pointer p-10 bg-gradient-pokemon text-primary-foreground border-0 shadow-card hover:shadow-pop transition-all hover:-translate-y-1"
          >
            <div className="text-7xl mb-3">⚡</div>
            <h3 className="text-5xl font-display">Pokémon</h3>
            <p className="opacity-90 mt-2">Pokédex tracker, master sets, binders & more.</p>
          </Card>
          <Card
            onClick={() => pick("onepiece")}
            className="group cursor-pointer p-10 bg-gradient-onepiece text-primary-foreground border-0 shadow-card hover:shadow-pop transition-all hover:-translate-y-1"
          >
            <div className="text-7xl mb-3">🏴‍☠️</div>
            <h3 className="text-5xl font-display">One Piece</h3>
            <p className="opacity-90 mt-2">Master sets, binders, deck importer & wishlist.</p>
          </Card>
        </div>
      </section>
    </div>
  );
}
