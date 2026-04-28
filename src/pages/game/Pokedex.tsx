import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

const TOTAL = 1025;

const sprite = (n: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${n}.png`;

const titleCase = (s: string) =>
  s.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

export default function Pokedex() {
  const [registered, setRegistered] = useState<Set<number>>(new Set());
  const [auto, setAuto] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const [names, setNames] = useState<string[]>([]);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await supabase
      .from("pokedex_entries")
      .select("pokedex_number")
      .eq("user_id", u.user.id)
      .eq("registered", true);
    setRegistered(new Set((data ?? []).map((d) => d.pokedex_number)));

    const { data: ents } = await supabase
      .from("collection_entries")
      .select("card:cards(pokedex_number)")
      .eq("game", "pokemon");
    const nums = new Set<number>();
    (ents ?? []).forEach((e: any) => {
      if (e.card?.pokedex_number) nums.add(e.card.pokedex_number);
    });
    setAuto(nums);
  };

  useEffect(() => {
    load();
  }, []);

  // Load species names once (cached in localStorage).
  useEffect(() => {
    const cached = localStorage.getItem("pokedex.names.v1");
    if (cached) {
      try {
        setNames(JSON.parse(cached));
        return;
      } catch (_) {}
    }
    fetch("https://pokeapi.co/api/v2/pokemon-species?limit=1025")
      .then((r) => r.json())
      .then((d) => {
        const arr: string[] = (d.results ?? []).map((x: any) => x.name);
        setNames(arr);
        localStorage.setItem("pokedex.names.v1", JSON.stringify(arr));
      })
      .catch(() => {});
  }, []);

  const toggle = async (n: number, checked: boolean) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    if (checked) {
      const { error } = await supabase
        .from("pokedex_entries")
        .upsert(
          { user_id: u.user.id, pokedex_number: n, registered: true },
          { onConflict: "user_id,pokedex_number" },
        );
      if (error) return toast.error(error.message);
      setRegistered((prev) => new Set(prev).add(n));
    } else {
      await supabase
        .from("pokedex_entries")
        .delete()
        .eq("user_id", u.user.id)
        .eq("pokedex_number", n);
      setRegistered((prev) => {
        const s = new Set(prev);
        s.delete(n);
        return s;
      });
    }
  };

  const all = useMemo(() => Array.from({ length: TOTAL }, (_, i) => i + 1), []);

  const matches = (n: number) => {
    if (!filter) return true;
    const q = filter.toLowerCase().trim();
    if (String(n).padStart(4, "0").includes(q)) return true;
    const name = names[n - 1] ?? "";
    return name.includes(q);
  };

  const totalSet = useMemo(() => {
    const s = new Set<number>(registered);
    auto.forEach((n) => s.add(n));
    return s;
  }, [registered, auto]);

  return (
    <div>
      <h2 className="text-4xl font-display">Pokédex</h2>
      <p className="text-muted-foreground mb-4">
        Two views: your manually-registered Pokémon, and a combined total that also includes
        every Pokémon you own a card of.
      </p>
      <Input
        placeholder="Search name or number…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-4 max-w-xs"
      />

      <Tabs defaultValue="manual">
        <TabsList>
          <TabsTrigger value="manual">
            Manual ({registered.size}/{TOTAL})
          </TabsTrigger>
          <TabsTrigger value="total">
            Total ({totalSet.size}/{TOTAL})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manual" className="mt-4">
          <PokeGrid
            list={all.filter(matches)}
            names={names}
            highlight={registered}
            secondary={auto}
            interactive
            onToggle={toggle}
          />
        </TabsContent>

        <TabsContent value="total" className="mt-4">
          <PokeGrid
            list={all.filter(matches)}
            names={names}
            highlight={totalSet}
            secondary={new Set()}
            interactive={false}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PokeGrid({
  list,
  names,
  highlight,
  secondary,
  interactive,
  onToggle,
}: {
  list: number[];
  names: string[];
  highlight: Set<number>;
  secondary: Set<number>;
  interactive: boolean;
  onToggle?: (n: number, checked: boolean) => void;
}) {
  return (
    <Card className="p-4 bg-gradient-card max-h-[70vh] overflow-y-auto">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {list.map((n) => {
          const has = highlight.has(n);
          const isAuto = secondary.has(n) && !has;
          const name = names[n - 1] ?? "";
          return (
            <label
              key={n}
              className={`flex items-center gap-2 p-2 rounded-lg border text-sm ${
                interactive ? "cursor-pointer" : ""
              } ${
                has
                  ? "bg-primary/10 border-primary"
                  : isAuto
                  ? "bg-accent/10 border-accent"
                  : "bg-background border-border opacity-70"
              }`}
            >
              <img
                src={sprite(n)}
                alt={name}
                loading="lazy"
                className={`h-10 w-10 object-contain shrink-0 ${
                  has ? "" : "grayscale opacity-60"
                }`}
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")}
              />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] text-muted-foreground">
                  #{String(n).padStart(4, "0")}
                </div>
                <div className="truncate text-xs font-medium capitalize">
                  {name ? name.replace(/-/g, " ") : "—"}
                </div>
              </div>
              {interactive && (
                <Checkbox
                  checked={has}
                  onCheckedChange={(c) => onToggle?.(n, !!c)}
                />
              )}
              {isAuto && interactive && (
                <span className="text-[9px] text-accent">auto</span>
              )}
            </label>
          );
        })}
      </div>
    </Card>
  );
}
