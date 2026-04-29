
-- 1. PROFILES: format check + avatar + bio
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS bio text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format_chk
  CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,20}$');

-- 2. handle_new_user: persist username from signup metadata atomically
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _username text := NEW.raw_user_meta_data->>'username';
  _display  text := COALESCE(NEW.raw_user_meta_data->>'display_name', _username, split_part(NEW.email, '@', 1));
BEGIN
  IF _username IS NOT NULL AND _username !~ '^[A-Za-z0-9_]{3,20}$' THEN
    _username := NULL;
  END IF;
  INSERT INTO public.profiles (id, display_name, username)
  VALUES (NEW.id, _display, _username);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. FRIENDSHIPS: status check, undirected uniqueness, blocked_by, FKs
ALTER TABLE public.friendships
  DROP CONSTRAINT IF EXISTS friendships_unique_pair;

ALTER TABLE public.friendships
  ADD COLUMN IF NOT EXISTS blocked_by uuid;

ALTER TABLE public.friendships
  DROP CONSTRAINT IF EXISTS friendships_status_chk;
ALTER TABLE public.friendships
  ADD CONSTRAINT friendships_status_chk
  CHECK (status IN ('pending','accepted','declined','blocked'));

DROP INDEX IF EXISTS public.friendships_pair_uidx;
CREATE UNIQUE INDEX friendships_pair_uidx
  ON public.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

ALTER TABLE public.friendships
  DROP CONSTRAINT IF EXISTS friendships_requester_fk,
  DROP CONSTRAINT IF EXISTS friendships_addressee_fk,
  DROP CONSTRAINT IF EXISTS friendships_blocked_by_fk;
ALTER TABLE public.friendships
  ADD CONSTRAINT friendships_requester_fk
    FOREIGN KEY (requester_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT friendships_addressee_fk
    FOREIGN KEY (addressee_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT friendships_blocked_by_fk
    FOREIGN KEY (blocked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. is_blocked helper
CREATE OR REPLACE FUNCTION public.is_blocked(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'blocked'
      AND ((requester_id = _a AND addressee_id = _b)
        OR (requester_id = _b AND addressee_id = _a))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_blocked(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_blocked(uuid, uuid) TO authenticated;

-- 5. Tighten friendship policies
DROP POLICY IF EXISTS "create friend request" ON public.friendships;
CREATE POLICY "create friend request"
ON public.friendships FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = requester_id
  AND NOT public.is_blocked(requester_id, addressee_id)
);

DROP POLICY IF EXISTS "update own friendship" ON public.friendships;
-- Addressee can accept/decline pending; either party can move row to 'blocked' (must set blocked_by = self);
-- Either party can unblock a row they previously blocked (status -> 'declined' or delete).
CREATE POLICY "addressee responds to pending"
ON public.friendships FOR UPDATE TO authenticated
USING (auth.uid() = addressee_id)
WITH CHECK (auth.uid() = addressee_id);

CREATE POLICY "either party can block or unblock"
ON public.friendships FOR UPDATE TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
WITH CHECK (
  (auth.uid() = requester_id OR auth.uid() = addressee_id)
  AND (
    -- block: must set yourself as blocker
    (status = 'blocked' AND blocked_by = auth.uid())
    -- unblock: only the original blocker can clear it
    OR (status <> 'blocked' AND blocked_by IS NULL)
  )
);

-- 6. FRIEND_SHARES: FKs + new override-based shares_with
ALTER TABLE public.friend_shares
  DROP CONSTRAINT IF EXISTS friend_shares_owner_fk,
  DROP CONSTRAINT IF EXISTS friend_shares_friend_fk;
ALTER TABLE public.friend_shares
  ADD CONSTRAINT friend_shares_owner_fk
    FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT friend_shares_friend_fk
    FOREIGN KEY (friend_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.shares_with(_owner uuid, _friend uuid, _game text, _module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH game_row AS (
    SELECT * FROM public.friend_shares
    WHERE owner_id = _owner AND friend_id = _friend AND game = _game LIMIT 1
  ),
  all_row AS (
    SELECT * FROM public.friend_shares
    WHERE owner_id = _owner AND friend_id = _friend AND game = 'all' LIMIT 1
  ),
  resolved AS (
    SELECT
      COALESCE((SELECT share_collection FROM game_row), (SELECT share_collection FROM all_row), false) AS share_collection,
      COALESCE((SELECT share_binders    FROM game_row), (SELECT share_binders    FROM all_row), false) AS share_binders,
      COALESCE((SELECT share_decks      FROM game_row), (SELECT share_decks      FROM all_row), false) AS share_decks,
      COALESCE((SELECT share_wanted     FROM game_row), (SELECT share_wanted     FROM all_row), false) AS share_wanted
  )
  SELECT public.are_friends(_owner, _friend) AND CASE _module
    WHEN 'collection' THEN (SELECT share_collection FROM resolved)
    WHEN 'binders'    THEN (SELECT share_binders    FROM resolved)
    WHEN 'decks'      THEN (SELECT share_decks      FROM resolved)
    WHEN 'wanted'     THEN (SELECT share_wanted     FROM resolved)
    ELSE false END;
$$;

-- 7. CHAT_MESSAGES: FKs, length cap, trade columns
ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_sender_fk,
  DROP CONSTRAINT IF EXISTS chat_recipient_fk,
  DROP CONSTRAINT IF EXISTS chat_card_fk,
  DROP CONSTRAINT IF EXISTS chat_offer_card_fk,
  DROP CONSTRAINT IF EXISTS chat_body_length_chk,
  DROP CONSTRAINT IF EXISTS chat_trade_status_chk,
  DROP CONSTRAINT IF EXISTS chat_kind_chk;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS offer_card_id uuid,
  ADD COLUMN IF NOT EXISTS trade_status text;

ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_sender_fk
    FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT chat_recipient_fk
    FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT chat_card_fk
    FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE SET NULL,
  ADD CONSTRAINT chat_offer_card_fk
    FOREIGN KEY (offer_card_id) REFERENCES public.cards(id) ON DELETE SET NULL,
  ADD CONSTRAINT chat_body_length_chk
    CHECK (body IS NULL OR length(body) <= 2000),
  ADD CONSTRAINT chat_kind_chk
    CHECK (kind IN ('text','trade_request')),
  ADD CONSTRAINT chat_trade_status_chk
    CHECK (trade_status IS NULL OR trade_status IN ('open','accepted','declined','cancelled'));

-- Trigger: default trade_status='open' for trade_request inserts
CREATE OR REPLACE FUNCTION public.set_trade_status_default()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'trade_request' AND NEW.trade_status IS NULL THEN
    NEW.trade_status := 'open';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_messages_trade_status_default ON public.chat_messages;
CREATE TRIGGER chat_messages_trade_status_default
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_trade_status_default();

-- Tighten chat insert: also block when blocked
DROP POLICY IF EXISTS "send chat to friend" ON public.chat_messages;
CREATE POLICY "send chat to friend"
ON public.chat_messages FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND public.are_friends(sender_id, recipient_id)
  AND NOT public.is_blocked(sender_id, recipient_id)
);

-- Allow sender to update their own trade request (e.g. cancel)
DROP POLICY IF EXISTS "sender updates own trade request" ON public.chat_messages;
CREATE POLICY "sender updates own trade request"
ON public.chat_messages FOR UPDATE TO authenticated
USING (auth.uid() = sender_id AND kind = 'trade_request')
WITH CHECK (auth.uid() = sender_id AND kind = 'trade_request');
