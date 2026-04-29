import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cardImage } from "@/lib/game";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  friend: { id: string; username: string | null };
  card: { id: string; name: string; code: string | null; image_small: string | null; game: string };
}

export function TradeRequestDialog({ open, onOpenChange, friend, card }: Props) {
  const { user } = useAuth();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("chat_messages").insert({
      sender_id: user.id,
      recipient_id: friend.id,
      kind: "trade_request",
      card_id: card.id,
      game: card.game,
      body: note.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Trade request sent!");
    setNote("");
    onOpenChange(false);
  };

  const img = cardImage(card.game, card.code, card.image_small);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask @{friend.username} to trade</DialogTitle>
          <DialogDescription>
            We'll drop a trade request in your chat with this card attached.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3">
          {img && <img src={img} alt={card.name} className="h-32 rounded" />}
          <div>
            <p className="font-semibold">{card.name}</p>
            {card.code && <p className="text-xs text-muted-foreground">{card.code}</p>}
          </div>
        </div>

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional message…"
          maxLength={500}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={send} disabled={busy}>{busy ? "Sending…" : "Send request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
