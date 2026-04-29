import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { Game } from "@/lib/game";

type ShareRow = {
  id?: string;
  owner_id: string;
  friend_id: string;
  game: Game | "all";
  share_collection: boolean;
  share_binders: boolean;
  share_decks: boolean;
  share_wanted: boolean;
};

const GAMES: Array<Game | "all"> = ["all", "pokemon", "onepiece", "yugioh"];
const LABELS: Record<Game | "all", string> = {
  all: "All games",
  pokemon: "Pokémon",
  onepiece: "One Piece",
  yugioh: "Yu-Gi-Oh!",
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  friend: { id: string; username: string | null };
}

export function ShareSettingsDialog({ open, onOpenChange, friend }: Props) {
  const { user } = useAuth();
  const [shares, setShares] = useState<Record<string, ShareRow>>({});
  const [active, setActive] = useState<Game | "all">("all");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      const { data } = await supabase
        .from("friend_shares")
        .select("*")
        .eq("owner_id", user.id)
        .eq("friend_id", friend.id);
      const map: Record<string, ShareRow> = {};
      (data ?? []).forEach((r: any) => { map[r.game] = r as ShareRow; });
      setShares(map);
    })();
  }, [open, user, friend.id]);

  const current = (g: Game | "all"): ShareRow =>
    shares[g] ?? {
      owner_id: user!.id,
      friend_id: friend.id,
      game: g,
      share_collection: false,
      share_binders: false,
      share_decks: false,
      share_wanted: false,
    };

  const update = (g: Game | "all", patch: Partial<ShareRow>) => {
    setShares((s) => ({ ...s, [g]: { ...current(g), ...patch } }));
  };

  const save = async () => {
    if (!user) return;
    setBusy(true);
    const rows = Object.values(shares).map((r) => ({ ...r, owner_id: user.id, friend_id: friend.id }));
    const { error } = await supabase
      .from("friend_shares")
      .upsert(rows, { onConflict: "owner_id,friend_id,game" });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Sharing preferences saved.");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share with @{friend.username ?? "friend"}</DialogTitle>
          <DialogDescription>
            Choose what this friend can see on your profile. You can change this anytime.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={active} onValueChange={(v) => setActive(v as Game | "all")}>
          <TabsList className="grid grid-cols-4 w-full">
            {GAMES.map((g) => (
              <TabsTrigger key={g} value={g}>{LABELS[g]}</TabsTrigger>
            ))}
          </TabsList>
          {GAMES.map((g) => {
            const c = current(g);
            return (
              <TabsContent key={g} value={g} className="space-y-4 mt-4">
                {([
                  ["share_collection", "Collection"],
                  ["share_binders", "Binders"],
                  ["share_decks", "Decks"],
                  ["share_wanted", "Wanted list"],
                ] as Array<[keyof ShareRow, string]>).map(([key, label]) => (
                  <div key={key as string} className="flex items-center justify-between">
                    <Label htmlFor={`${g}-${key as string}`}>{label}</Label>
                    <Switch
                      id={`${g}-${key as string}`}
                      checked={Boolean(c[key])}
                      onCheckedChange={(v) => update(g, { [key]: v } as Partial<ShareRow>)}
                    />
                  </div>
                ))}
                {g === "all" && (
                  <p className="text-xs text-muted-foreground">
                    “All games” acts as a fallback — if it's on for a module, the friend can see that module across every game.
                  </p>
                )}
              </TabsContent>
            );
          })}
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
