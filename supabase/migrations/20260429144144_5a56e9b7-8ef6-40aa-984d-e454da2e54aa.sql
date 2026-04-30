-- Fix 1: Tighten friendships UPDATE policies
DROP POLICY IF EXISTS "either party can block or unblock" ON public.friendships;
DROP POLICY IF EXISTS "addressee responds to pending" ON public.friendships;

-- Only the addressee can accept/decline a pending request
CREATE POLICY "addressee responds to pending"
ON public.friendships
FOR UPDATE
TO authenticated
USING (auth.uid() = addressee_id AND status = 'pending')
WITH CHECK (
  auth.uid() = addressee_id
  AND status IN ('accepted', 'declined')
  AND blocked_by IS NULL
);

-- Either party may block, and the blocker may unblock (delete row), but this policy
-- is restricted to transitions into the 'blocked' state only.
CREATE POLICY "either party can block"
ON public.friendships
FOR UPDATE
TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
WITH CHECK (
  (auth.uid() = requester_id OR auth.uid() = addressee_id)
  AND status = 'blocked'
  AND blocked_by = auth.uid()
);

-- Fix 2: Defense-in-depth — explicitly deny direct UPDATEs on chat_messages.
-- All mutations must go through the SECURITY DEFINER RPCs.
CREATE POLICY "no direct updates on chat_messages"
ON public.chat_messages
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);