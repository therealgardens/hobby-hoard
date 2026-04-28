import { useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CardSearch } from "@/components/CardSearch";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cardImage, type Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";

type CardRow = Tables<"cards">;

const LANGS = ["EN", "JP", "IT", "FR", "DE", "ES", "PT"];

export default function MasterSets() {
  const { game } = useParams<{ game: Game }>();
  const [picked, setPicked] = useState<CardRow | null>(null);
  const [rarity, setRarity] = useState("");
  const [language, setLanguage] = useState("EN");
  const [quantity, setQuantity] = useState(1);

  const open = (c: CardRow) => {
    setPicked(c);
    setRarity(c.rarity ?? "");
    setLanguage("EN");
    setQuantity(1);
  };

  const save = async () => {
    if (!picked || !game) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error } = await supabase.from("collection_entries").insert({
      user_id: userData.user.id,
      card_id: picked.id,
      game,
      rarity: rarity || null,
      language,
      quantity,
    });
    if (error) return toast.error(error.message);
    toast.success(`Added ${picked.name} ×${quantity}`);
    setPicked(null);
  };

  return (
    <div>
      <h2 className="text-4xl font-display mb-2">Master Sets</h2>
      <p className="text-muted-foreground mb-6">Search the full catalog and add cards to your collection.</p>
      {game && <CardSearch game={game} onPick={open} />}

      <Dialog open={!!picked} onOpenChange={(o) => !o && setPicked(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to collection</DialogTitle>
          </DialogHeader>
          {picked && (
            <div className="grid grid-cols-[120px_1fr] gap-4">
              {(() => { const img = cardImage(picked.game, picked.code, picked.image_small); return img && <img src={img} alt="" className="rounded-lg w-full" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />; })()}
              <div className="space-y-3">
                <div>
                  <p className="font-semibold">{picked.name}</p>
                  <p className="text-xs text-muted-foreground">{picked.code} · {picked.set_name}</p>
                </div>
                <div>
                  <Label>Rarity</Label>
                  <Input value={rarity} onChange={(e) => setRarity(e.target.value)} placeholder="e.g. Rare Holo" />
                </div>
                <div>
                  <Label>Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{LANGS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantity</Label>
                  <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} />
                </div>
                <Button className="w-full" onClick={save}>Add to collection</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
