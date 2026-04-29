import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cardImage, type Game } from "@/lib/game";
import { CardPicker, type PickerCard } from "./CardPicker";
import { ArrowLeftRight } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  friend: { id: string; username: string | null };
  card: { id: string; name: string; code: string | null; image_small: string | null; game: string };
}

export function TradeRequestDialog({ open, onOpenChange, friend, card }: Props) {
  const { user } = useAuth();
  const [mode, setMode] = useState<"ask" | "offer">("ask");
  const [offerCard, setOfferCard] = useState<PickerCard | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!user) return;
    if (mode === "offer" && !offerCard) {
      toast.error("Pick a card to offer, or switch to “Just ask”.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("chat_messages").insert({
      sender_id: user.id,
      recipient_id: friend.id,
      kind: "trade_request",
      card_id: card.id,
      offer_card_id: mode === "offer" ? offerCard!.id : null,
      game: card.game,
      body: note.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Trade request sent!");
    setNote("");
    setOfferCard(null);
    setMode("ask");
    onOpenChange(false);
  };

  const img = cardImage(card.game, card.code, card.image_small);
  const offerImg = offerCard ? cardImage(offerCard.game, offerCard.code, offerCard.image_small) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ask @{friend.username} to trade</DialogTitle>
          <DialogDescription>
            Choose whether you just want to ask for this card, or offer one of yours in exchange.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={mode} onValueChange={(v) => setMode(v as "ask" | "offer")} className="grid grid-cols-2 gap-2">
          <Label
            htmlFor="trade-ask"
            className={`cursor-pointer border rounded-md p-3 ${mode === "ask" ? "border-primary ring-1 ring-primary" : "border-border"}`}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem id="trade-ask" value="ask" />
              <span className="font-medium">Just ask</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">No offer attached.</p>
          </Label>
          <Label
            htmlFor="trade-offer"
            className={`cursor-pointer border rounded-md p-3 ${mode === "offer" ? "border-primary ring-1 ring-primary" : "border-border"}`}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem id="trade-offer" value="offer" />
              <span className="font-medium">Offer a trade</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Pick one of your cards.</p>
          </Label>
        </RadioGroup>

        <div className="flex items-center gap-3 justify-center">
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">You want</p>
            {img && <img src={img} alt={card.name} className="h-32 rounded mx-auto" />}
            <p className="text-xs font-medium mt-1 max-w-[8rem] truncate">{card.name}</p>
          </div>
          {mode === "offer" && (
            <>
              <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">You offer</p>
                {offerImg ? (
                  <img src={offerImg} alt={offerCard!.name} className="h-32 rounded mx-auto" />
                ) : (
                  <div className="h-32 w-24 bg-muted rounded mx-auto flex items-center justify-center text-xs text-muted-foreground">
                    Pick a card
                  </div>
                )}
                <p className="text-xs font-medium mt-1 max-w-[8rem] truncate">{offerCard?.name ?? "—"}</p>
              </div>
            </>
          )}
        </div>

        {mode === "offer" && (
          <CardPicker
            game={card.game as Game}
            selectedId={offerCard?.id ?? null}
            onSelect={setOfferCard}
          />
        )}

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
