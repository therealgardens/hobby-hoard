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
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!game) return;
    const { data: entries } = await supabase
      .from("collection_entries")
      .select("card_id, quantity")
      .eq("game", game);
    const unique = new Set((entries ?? []).map((e: any) => e.card_id)).size;
    const total = entries?.reduce((s, e) => s + (e.quantity ?? 0), 0) ?? 0;
    const { count: binders } = await supabase
      .from("binders").select("*", { count: "exact", head: true }).eq("game", game);
    const { count: wanted } = await supabase
      .from("wanted_cards").select("*", { count: "exact", head: true }).eq("game", game);
    setStats({ unique, total, binders: binders ?? 0, wanted: wanted ?? 0 });
  };

  const exportGame = async () => {
    if (!game) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setBusy(true);
    try {
      const [collection, binders, slots, wanted, decks, deckCards] = await Promise.all([
        supabase.from("collection_entries").select("*").eq("user_id", u.user.id).eq("game", game),
        supabase.from("binders").select("*").eq("user_id", u.user.id).eq("game", game),
        supabase.from("binder_slots").select("*").eq("user_id", u.user.id),
        supabase.from("wanted_cards").select("*").eq("user_id", u.user.id).eq("game", game),
        supabase.from("decks").select("*").eq("user_id", u.user.id).eq("game", game),
        supabase.from("deck_cards").select("*").eq("user_id", u.user.id),
      ]);
      const binderIds = new Set((binders.data ?? []).map((b: any) => b.id));
      const deckIds = new Set((decks.data ?? []).map((d: any) => d.id));
      const payload = {
        version: 1,
        game,
        exported_at: new Date().toISOString(),
        collection_entries: collection.data ?? [],
        binders: binders.data ?? [],
        binder_slots: (slots.data ?? []).filter((s: any) => binderIds.has(s.binder_id)),
        wanted_cards: wanted.data ?? [],
        decks: decks.data ?? [],
        deck_cards: (deckCards.data ?? []).filter((d: any) => deckIds.has(d.deck_id)),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cardkeeper-${game}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported");
    } finally {
      setBusy(false);
    }
  };

  const importGame = async (file: File) => {
    if (!game) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      const onlyGame = (rows: any[]) =>
        (rows ?? []).filter((r) => !r.game || r.game === game);

      const collection = onlyGame(data.collection_entries).map((r: any) => ({
        ...r, user_id: u.user!.id, game,
      }));
      const binders = onlyGame(data.binders).map((r: any) => ({
        ...r, user_id: u.user!.id, game,
      }));
      const wanted = onlyGame(data.wanted_cards).map((r: any) => ({
        ...r, user_id: u.user!.id, game,
      }));
      const decks = onlyGame(data.decks).map((r: any) => ({
        ...r, user_id: u.user!.id, game,
      }));

      const importedBinderIds = new Set(binders.map((b: any) => b.id));
      const importedDeckIds = new Set(decks.map((d: any) => d.id));
      const slots = (data.binder_slots ?? [])
        .filter((s: any) => importedBinderIds.has(s.binder_id))
        .map((r: any) => ({ ...r, user_id: u.user!.id }));
      const deckCards = (data.deck_cards ?? [])
        .filter((d: any) => importedDeckIds.has(d.deck_id))
        .map((r: any) => ({ ...r, user_id: u.user!.id }));

      const ops: Array<[string, any[]]> = [
        ["collection_entries", collection],
        ["binders", binders],
        ["binder_slots", slots],
        ["wanted_cards", wanted],
        ["decks", decks],
        ["deck_cards", deckCards],
      ];
      let imported = 0;
      for (const [table, rows] of ops) {
        if (!rows.length) continue;
        const { error } = await (supabase.from(table as any) as any).upsert(rows, { onConflict: "id" });
        if (error) throw error;
        imported += rows.length;
      }
      toast.success(`Imported ${imported} rows for ${game}`);
      load();
    } catch (e: any) {
      toast.error("Import failed: " + e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  useEffect(() => { load(); }, [game]);

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

      <Card className="p-6 bg-gradient-card">
        <h3 className="text-2xl font-display mb-1">Import / Export collection</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Only cards belonging to this game ({game}) will be imported or exported.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportGame} disabled={busy}>
            <Upload className="h-4 w-4 mr-2" /> Export {game}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importGame(e.target.files[0])}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Download className="h-4 w-4 mr-2" /> Import {game}
          </Button>
        </div>
      </Card>
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
