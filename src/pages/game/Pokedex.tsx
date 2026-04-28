import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

// Simple Pokédex placeholder: 1..1025 (Gen 1-9). User can mark registered.
const TOTAL = 1025;

export default function Pokedex() {
  const [registered, setRegistered] = useState<Set<number>>(new Set());
  const [auto, setAuto] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await supabase.from("pokedex_entries").select("pokedex_number").eq("user_id", u.user.id).eq("registered", true);
    setRegistered(new Set((data ?? []).map(d => d.pokedex_number)));
    // Passive: from collection_entries, derive pokedex numbers
    const { data: ents } = await supabase
      .from("collection_entries")
      .select("card:cards(pokedex_number)")
      .eq("game", "pokemon");
    const nums = new Set<number>();
    (ents ?? []).forEach((e: any) => { if (e.card?.pokedex_number) nums.add(e.card.pokedex_number); });
    setAuto(nums);
  };
  useEffect(() => { load(); }, []);

  const toggle = async (n: number, checked: boolean) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    if (checked) {
      const { error } = await supabase.from("pokedex_entries").upsert(
        { user_id: u.user.id, pokedex_number: n, registered: true },
        { onConflict: "user_id,pokedex_number" },
      );
      if (error) return toast.error(error.message);
      setRegistered(prev => new Set(prev).add(n));
    } else {
      await supabase.from("pokedex_entries").delete().eq("user_id", u.user.id).eq("pokedex_number", n);
      setRegistered(prev => { const s = new Set(prev); s.delete(n); return s; });
    }
  };

  const list = Array.from({ length: TOTAL }, (_, i) => i + 1).filter(n => !filter || String(n).padStart(4, "0").includes(filter));

  return (
    <div>
      <h2 className="text-4xl font-display">Pokédex</h2>
      <p className="text-muted-foreground mb-4">Manually check off Pokémon you've registered. Auto-tracked from your collection are marked too.</p>
      <Input placeholder="Jump to number…" value={filter} onChange={e => setFilter(e.target.value)} className="mb-4 max-w-xs" />
      <div className="text-sm text-muted-foreground mb-4">
        Manual: <strong>{registered.size}</strong> · Auto from collection: <strong>{auto.size}</strong> / {TOTAL}
      </div>
      <Card className="p-4 bg-gradient-card max-h-[70vh] overflow-y-auto">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {list.map(n => {
            const isReg = registered.has(n);
            const isAuto = auto.has(n);
            return (
              <label
                key={n}
                className={`flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer ${
                  isReg ? "bg-primary/10 border-primary" : isAuto ? "bg-accent/10 border-accent" : "bg-background border-border"
                }`}
              >
                <Checkbox checked={isReg} onCheckedChange={(c) => toggle(n, !!c)} />
                <span className="font-mono">#{String(n).padStart(4, "0")}</span>
                {isAuto && !isReg && <span className="ml-auto text-[10px] text-accent">auto</span>}
              </label>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
