import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, RefreshCw } from "lucide-react";
import { cardImage } from "@/lib/game";

type Msg = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string | null;
  kind: string;
  card_id: string | null;
  game: string | null;
  created_at: string;
};

type CardLite = { id: string; name: string; code: string | null; image_small: string | null; game: string };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  friend: { id: string; username: string | null };
}

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
    const cardIds = Array.from(new Set(list.map((m) => m.card_id).filter(Boolean))) as string[];
    if (cardIds.length) {
      const { data: cs } = await supabase
        .from("cards")
        .select("id, name, code, image_small, game")
        .in("id", cardIds);
      const map: Record<string, CardLite> = {};
      (cs ?? []).forEach((c: any) => { map[c.id] = c; });
      setCards(map);
    }
    // mark unread as read
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

  useEffect(() => { if (open) load(); }, [open, load]);

  const send = async () => {
    if (!user || !text.trim()) return;
    setSending(true);
    const { error } = await supabase.from("chat_messages").insert({
      sender_id: user.id,
      recipient_id: friend.id,
      body: text.trim(),
      kind: "text",
    });
    setSending(false);
    if (error) return;
    setText("");
    load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl flex flex-col h-[70vh]">
        <DialogHeader className="flex-row items-center justify-between">
          <DialogTitle>Chat with @{friend.username ?? "friend"}</DialogTitle>
          <Button size="sm" variant="ghost" onClick={load}>
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
            const card = m.card_id ? cards[m.card_id] : null;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`rounded-lg px-3 py-2 max-w-[80%] text-sm ${
                    mine ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {m.kind === "trade_request" ? (
                    <div className="space-y-2">
                      <p className="font-semibold">
                        {mine ? "You'd like to trade" : `@${friend.username} would like to trade`}
                      </p>
                      {card && (
                        <div className="flex items-center gap-2">
                          {cardImage(card.game, card.code, card.image_small) && (
                            <img
                              src={cardImage(card.game, card.code, card.image_small)!}
                              alt={card.name}
                              className="h-20 rounded"
                            />
                          )}
                          <div>
                            <p className="font-medium">{card.name}</p>
                            {card.code && <p className="text-xs opacity-80">{card.code}</p>}
                          </div>
                        </div>
                      )}
                      {m.body && <p>{m.body}</p>}
                      <p className="text-xs opacity-80">
                        Take a look at their cards or chat to agree on a trade.
                      </p>
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
