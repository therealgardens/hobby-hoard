import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Layers, BookOpen, Heart, Copy, Swords, ListChecks, Upload, Download } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { Game } from "@/lib/game";

export default function GameHome() {
  const { game } = useParams<{ game: Game }>();
  const [stats, setStats] = useState({ unique: 0, total: 0, binders: 0, wanted: 0 });

  useEffect(() => {
    if (!game) return;
    (async () => {
      const { data: entries } = await supabase
        .from("collection_entries")
        .select("quantity")
        .eq("game", game);
      const unique = entries?.length ?? 0;
      const total = entries?.reduce((s, e) => s + (e.quantity ?? 0), 0) ?? 0;
      const { count: binders } = await supabase
        .from("binders").select("*", { count: "exact", head: true }).eq("game", game);
      const { count: wanted } = await supabase
        .from("wanted_cards").select("*", { count: "exact", head: true }).eq("game", game);
      setStats({ unique, total, binders: binders ?? 0, wanted: wanted ?? 0 });
    })();
  }, [game]);

  const tiles = [
    { to: "master", icon: Layers, label: "Master Sets", desc: "Browse every set and add cards" },
    { to: "binders", icon: BookOpen, label: "Binders", desc: "Build virtual binders" },
    { to: "wanted", icon: Heart, label: "Wanted", desc: "Wishlist & set fillers" },
    { to: "duplicates", icon: Copy, label: "Duplicates", desc: "See your extras" },
    ...(game === "pokemon" ? [{ to: "pokedex", icon: ListChecks, label: "Pokédex", desc: "Track all species" }] : []),
    ...(game === "onepiece" || game === "yugioh" ? [{ to: "decks", icon: Swords, label: "Decks", desc: "Import & track deck lists" }] : []),
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Unique cards" value={stats.unique} />
        <Stat label="Total copies" value={stats.total} />
        <Stat label="Binders" value={stats.binders} />
        <Stat label="Wanted" value={stats.wanted} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to}>
            <Card className="p-6 bg-gradient-card hover:shadow-pop transition-all hover:-translate-y-1 cursor-pointer h-full">
              <t.icon className="h-8 w-8 text-primary mb-3" />
              <h3 className="text-2xl font-display">{t.label}</h3>
              <p className="text-sm text-muted-foreground mt-1">{t.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-5 bg-gradient-card shadow-soft">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-4xl font-display text-primary mt-1">{value}</p>
    </Card>
  );
}
