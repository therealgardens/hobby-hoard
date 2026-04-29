import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, RefreshCw, ArrowLeftRight, Check, X } from "lucide-react";
import { cardImage } from "@/lib/game";
import { toast } from "sonner";

type Msg = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string | null;
  kind: string;
  card_id: string | null;
  offer_card_id: string | null;
  trade_status: string | null;
  game: string | null;
  created_at: string;
};

type CardLite = { id: string; name: string; code: string | null; image_small: string | null; game: string };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  friend: { id: string; username: string | null };
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};

export function ChatDialog({ open, onOpenChange, friend }: Props) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [cards, setCards] = useState<Record<string, CardLite>>({});
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .or(
        `and(sender_id.eq.${user.id},recipient_id.eq.${friend.id}),and(sender_id.eq.${friend.id},recipient_id.eq.${user.id})`,
      )
      .order("created_at", { ascending: true })
      .limit(200);
    const list = (data ?? []) as Msg[];
    setMessages(list);
    const cardIds = Array.from(
      new Set(list.flatMap((m) => [m.card_id, m.offer_card_id]).filter(Boolean)),
    ) as string[];
    if (cardIds.length) {
      const { data: cs } = await supabase
        .from("cards")
        .select("id, name, code, image_small, game")
        .in("id", cardIds);
      const map: Record<string, CardLite> = {};
      (cs ?? []).forEach((c: any) => { map[c.id] = c; });
      setCards(map);
    }
    await supabase
      .from("chat_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", user.id)
      .eq("sender_id", friend.id)
      .is("read_at", null);
    queueMicrotask(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, [user, friend.id]);

  useEffect(() => {
    if (!open) return;
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [open, load]);

  const send = async () => {
    if (!user || !text.trim()) return;
    setSending(true);
    const { error } = await supabase.from("chat_messages").insert({
      sender_id: user.id,
      recipient_id: friend.id,
      body: text.trim().slice(0, 2000),
      kind: "text",
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setText("");
    load();
  };

  const updateTradeStatus = async (m: Msg, status: "accepted" | "declined" | "cancelled") => {
    const { error } = await supabase
      .from("chat_messages")
      .update({ trade_status: status })
      .eq("id", m.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Trade ${status}.`);
    load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl flex flex-col h-[70vh]">
        <DialogHeader className="flex-row items-center justify-between">
          <DialogTitle>Chat with @{friend.username ?? "friend"}</DialogTitle>
          <Button size="sm" variant="ghost" onClick={load} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 pr-1">
          {messages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              No messages yet. Say hi!
            </p>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === user?.id;
            const askCard = m.card_id ? cards[m.card_id] : null;
            const offerCard = m.offer_card_id ? cards[m.offer_card_id] : null;
            const status = m.trade_status ?? (m.kind === "trade_request" ? "open" : null);
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`rounded-lg px-3 py-2 max-w-[85%] text-sm ${
                    mine ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {m.kind === "trade_request" ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">
                          {mine ? "You proposed a trade" : `@${friend.username} proposed a trade`}
                        </p>
                        {status && (
                          <Badge
                            variant={
                              status === "accepted" ? "default"
                              : status === "open" ? "secondary"
                              : "outline"
                            }
                            className="text-[10px]"
                          >
                            {STATUS_LABEL[status]}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {askCard ? (
                          <CardThumb card={askCard} label={mine ? "You want" : "They want"} />
                        ) : (
                          <p className="text-xs italic opacity-80">card unavailable</p>
                        )}
                        {offerCard && (
                          <>
                            <ArrowLeftRight className="h-4 w-4 opacity-70 shrink-0" />
                            <CardThumb card={offerCard} label={mine ? "You offer" : "They offer"} />
                          </>
                        )}
                      </div>

                      {!offerCard && (
                        <p className="text-xs opacity-80 italic">No card offered — just asking.</p>
                      )}
                      {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}

                      {status === "open" && !mine && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => updateTradeStatus(m, "accepted")}
                          >
                            <Check className="h-3 w-3 mr-1" /> Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateTradeStatus(m, "declined")}
                          >
                            <X className="h-3 w-3 mr-1" /> Decline
                          </Button>
                        </div>
                      )}
                      {status === "open" && mine && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateTradeStatus(m, "cancelled")}
                          className="text-foreground"
                        >
                          Cancel request
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  )}
                  <p className="text-[10px] opacity-60 mt-1">
                    {new Date(m.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a message…"
            maxLength={2000}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <Button onClick={send} disabled={sending || !text.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CardThumb({ card, label }: { card: CardLite; label: string }) {
  const img = cardImage(card.game, card.code, card.image_small);
  return (
    <div className="text-center">
      <p className="text-[10px] opacity-80 mb-0.5">{label}</p>
      {img && <img src={img} alt={card.name} className="h-20 rounded mx-auto" />}
      <p className="text-[11px] font-medium mt-0.5 max-w-[6rem] truncate">{card.name}</p>
    </div>
  );
}
