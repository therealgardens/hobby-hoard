import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Layers, BookOpen, Heart, Copy, Swords, ListChecks, Upload, Download } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { Game } from "@/lib/game";

type TileCounts = {
  master?: string;
  binders?: string;
  wanted?: string;
  duplicates?: string;
  decks?: string;
  pokedex?: string;
};

function setIdForCard(game: Game, c: { set_id: string | null; set_name: string | null; code: string | null }): string | null {
  if (game === "pokemon" || game === "yugioh") return c.set_id ?? null;
  // onepiece: derive from code prefix like "OP01-001" or set_name
  const fromCode = c.code?.match(/^([A-Z]+\d+)/i)?.[1] ?? null;
  if (fromCode) return fromCode.toUpperCase();
  const fromName = c.set_name?.match(/\b([A-Z]+\d+)\b/)?.[1] ?? null;
  return fromName ? fromName.toUpperCase() : null;
}

export default function GameHome() {
  const { game } = useParams<{ game: Game }>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<TileCounts>({});

  useEffect(() => {
    if (!game) return;
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const uid = u.user.id;

      try {
        const [collectionRes, bindersRes, wantedRes, decksRes, pokedexRes, setsRes] = await Promise.all([
          supabase
            .from("collection_entries")
            .select("card_id, quantity")
            .eq("user_id", uid)
            .eq("game", game),
          supabase.from("binders").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("game", game),
          supabase.from("wanted_cards").select("card_id, quantity").eq("user_id", uid).eq("game", game),
          (game === "onepiece" || game === "yugioh")
            ? supabase.from("decks").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("game", game)
            : Promise.resolve({ count: 0 } as any),
          game === "pokemon"
            ? supabase.from("pokedex_entries").select("id", { count: "exact", head: true }).eq("user_id", uid)
            : Promise.resolve({ count: 0 } as any),
          fetch(`https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/card-sets?game=${game}`)
            .then((r) => (r.ok ? r.json() : { sets: [] }))
            .catch(() => ({ sets: [] })),
        ]);

        if (cancelled) return;

        const collectionRows = (collectionRes.data ?? []) as Array<{ card_id: string; quantity: number }>;

        // Duplicates + total copies (no join needed)
        const uniqueWithDupes = new Set<string>();
        let dupExtras = 0;
        for (const row of collectionRows) {
          const q = row.quantity ?? 0;
          if (q > 1) {
            uniqueWithDupes.add(row.card_id);
            dupExtras += q - 1;
          }
        }

        // Master sets owned: fetch the cards for the user's collection card_ids
        const totalSets = Array.isArray((setsRes as any).sets) ? (setsRes as any).sets.length : 0;
        const ownedSetIds = new Set<string>();
        const cardIds = Array.from(new Set(collectionRows.map((r) => r.card_id)));
        if (cardIds.length) {
          const { data: cardsData } = await supabase
            .from("cards")
            .select("id, set_id, set_name, code")
            .in("id", cardIds);
          for (const c of (cardsData ?? []) as any[]) {
            const id = setIdForCard(game, c);
            if (id) ownedSetIds.add(id);
          }
        }

        // Wanted: distinct cards / total copies
        const wantedRows = (wantedRes.data ?? []) as Array<{ card_id: string; quantity: number }>;
        const wantedUnique = new Set(wantedRows.map((r) => r.card_id)).size;
        const wantedTotal = wantedRows.reduce((s, r) => s + (r.quantity ?? 0), 0);

        const next: TileCounts = {
          master: `${ownedSetIds.size}/${totalSets || "?"}`,
          binders: String((bindersRes as any).count ?? 0),
          wanted: `${wantedUnique}/${wantedTotal}`,
          duplicates: `${dupExtras}/${uniqueWithDupes.size}`,
          decks: String((decksRes as any).count ?? 0),
          pokedex: String((pokedexRes as any).count ?? 0),
        };
        setCounts(next);
      } catch (e) {
        console.error("[GameHome] failed to load counts", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game]);

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
    } catch (e: any) {
      toast.error("Import failed: " + e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const tiles: Array<{ to: keyof TileCounts; icon: any; label: string; desc: string }> = [
    { to: "master", icon: Layers, label: "Master Sets", desc: "Browse every set and add cards" },
    { to: "binders", icon: BookOpen, label: "Binders", desc: "Build virtual binders" },
    { to: "wanted", icon: Heart, label: "Wanted", desc: "Wishlist & set fillers" },
    { to: "duplicates", icon: Copy, label: "Duplicates", desc: "See your extras" },
    ...(game === "pokemon" ? [{ to: "pokedex" as const, icon: ListChecks, label: "Pokédex", desc: "Track all species" }] : []),
    ...(game === "onepiece" || game === "yugioh" ? [{ to: "decks" as const, icon: Swords, label: "Decks", desc: "Import & track deck lists" }] : []),
  ];

  return (
    <div className="space-y-8">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map((t) => {
          const count = counts[t.to];
          return (
            <Link key={t.to} to={t.to}>
              <Card className="p-6 bg-gradient-card hover:shadow-pop transition-all hover:-translate-y-1 cursor-pointer h-full relative">
                {count !== undefined && (
                  <span
                    className="absolute top-3 right-3 inline-flex items-center justify-center min-w-[2.5rem] h-8 px-2 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-md"
                    title={`${t.label} count`}
                  >
                    {count}
                  </span>
                )}
                <t.icon className="h-8 w-8 text-primary mb-3" />
                <h3 className="text-2xl font-display">{t.label}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t.desc}</p>
              </Card>
            </Link>
          );
        })}
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
