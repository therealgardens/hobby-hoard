import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface UnreadCounts {
  pendingRequests: number;
  unreadChats: number;
  openTradeRequests: number;
}

const ZERO: UnreadCounts = { pendingRequests: 0, unreadChats: 0, openTradeRequests: 0 };

/**
 * Polls every 30s (and on window focus) for incoming friend requests, unread
 * chat messages, and open trade requests addressed to the current user.
 */
export function useUnreadCounts(): UnreadCounts & { refresh: () => void } {
  const { user } = useAuth();
  const [counts, setCounts] = useState<UnreadCounts>(ZERO);

  const load = useCallback(async () => {
    if (!user) {
      setCounts(ZERO);
      return;
    }
    const [{ count: pending }, { count: unread }, { count: openTrades }] = await Promise.all([
      supabase
        .from("friendships")
        .select("*", { count: "exact", head: true })
        .eq("addressee_id", user.id)
        .eq("status", "pending"),
      supabase
        .from("chat_messages")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", user.id)
        .is("read_at", null),
      supabase
        .from("chat_messages")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", user.id)
        .eq("kind", "trade_request")
        .eq("trade_status", "open"),
    ]);
    setCounts({
      pendingRequests: pending ?? 0,
      unreadChats: unread ?? 0,
      openTradeRequests: openTrades ?? 0,
    });
  }, [user]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  return { ...counts, refresh: load };
}
