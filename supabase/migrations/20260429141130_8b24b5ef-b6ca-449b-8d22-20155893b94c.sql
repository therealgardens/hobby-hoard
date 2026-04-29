
-- 1) Tighten chat_messages UPDATE policy: split into narrow operations via RPCs.
DROP POLICY IF EXISTS "update own received chat" ON public.chat_messages;
DROP POLICY IF EXISTS "sender updates own trade request" ON public.chat_messages;

-- RPC: mark a single message as read (recipient-only, only touches read_at)
CREATE OR REPLACE FUNCTION public.mark_message_read(_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_messages
  SET read_at = COALESCE(read_at, now())
  WHERE id = _message_id
    AND recipient_id = auth.uid();
END;
$$;

-- RPC: mark all messages from a friend as read
CREATE OR REPLACE FUNCTION public.mark_thread_read(_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_messages
  SET read_at = now()
  WHERE recipient_id = auth.uid()
    AND sender_id = _friend_id
    AND read_at IS NULL;
END;
$$;

-- RPC: recipient responds to a trade request (accept/decline only)
CREATE OR REPLACE FUNCTION public.respond_to_trade(_message_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _status NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'Invalid trade response status';
  END IF;
  UPDATE public.chat_messages
  SET trade_status = _status
  WHERE id = _message_id
    AND recipient_id = auth.uid()
    AND kind = 'trade_request'
    AND trade_status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade request not found or no longer open';
  END IF;
END;
$$;

-- RPC: sender cancels their own open trade request
CREATE OR REPLACE FUNCTION public.cancel_trade(_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_messages
  SET trade_status = 'cancelled'
  WHERE id = _message_id
    AND sender_id = auth.uid()
    AND kind = 'trade_request'
    AND trade_status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade request not found or no longer open';
  END IF;
END;
$$;

-- Grant execute on the new RPCs only
GRANT EXECUTE ON FUNCTION public.mark_message_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_thread_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_trade(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_trade(uuid) TO authenticated;

-- 2) Lock down SECURITY DEFINER helper functions used inside RLS policies.
-- They're invoked by the policy planner regardless of EXECUTE grants, so we
-- can revoke direct execute access from clients to satisfy the linter.
REVOKE EXECUTE ON FUNCTION public.are_friends(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_blocked(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shares_with(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
