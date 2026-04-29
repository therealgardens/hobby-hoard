-- USERNAME on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx ON public.profiles (lower(username)) WHERE username IS NOT NULL;

-- Allow authenticated users to look up profiles by username (for friend search)
DROP POLICY IF EXISTS "search profiles by username" ON public.profiles;
CREATE POLICY "search profiles by username"
ON public.profiles FOR SELECT
TO authenticated
USING (username IS NOT NULL);

-- FRIENDSHIPS
CREATE TABLE IF NOT EXISTS public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL,
  addressee_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | accepted | declined
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friendships_distinct CHECK (requester_id <> addressee_id),
  CONSTRAINT friendships_unique_pair UNIQUE (requester_id, addressee_id)
);
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view own friendships"
ON public.friendships FOR SELECT
TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "create friend request"
ON public.friendships FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "update own friendship"
ON public.friendships FOR UPDATE
TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "delete own friendship"
ON public.friendships FOR DELETE
TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- Helper: are two users friends?
CREATE OR REPLACE FUNCTION public.are_friends(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND ((requester_id = _a AND addressee_id = _b) OR (requester_id = _b AND addressee_id = _a))
  );
$$;

-- FRIEND SHARES: per (owner -> friend, game) toggles
CREATE TABLE IF NOT EXISTS public.friend_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  friend_id uuid NOT NULL,
  game text NOT NULL, -- 'pokemon' | 'onepiece' | 'yugioh' | 'all'
  share_collection boolean NOT NULL DEFAULT false,
  share_binders boolean NOT NULL DEFAULT false,
  share_decks boolean NOT NULL DEFAULT false,
  share_wanted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_shares_unique UNIQUE (owner_id, friend_id, game),
  CONSTRAINT friend_shares_distinct CHECK (owner_id <> friend_id)
);
ALTER TABLE public.friend_shares ENABLE ROW LEVEL SECURITY;

-- Owner manages own shares
CREATE POLICY "owner manages shares"
ON public.friend_shares FOR ALL
TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

-- Friend can read shares directed at them
CREATE POLICY "friend reads shares"
ON public.friend_shares FOR SELECT
TO authenticated
USING (auth.uid() = friend_id);

-- Helper: does owner share given module with friend (game-specific or 'all')?
CREATE OR REPLACE FUNCTION public.shares_with(_owner uuid, _friend uuid, _game text, _module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.are_friends(_owner, _friend) AND EXISTS (
    SELECT 1 FROM public.friend_shares fs
    WHERE fs.owner_id = _owner
      AND fs.friend_id = _friend
      AND (fs.game = _game OR fs.game = 'all')
      AND CASE _module
        WHEN 'collection' THEN fs.share_collection
        WHEN 'binders'    THEN fs.share_binders
        WHEN 'decks'      THEN fs.share_decks
        WHEN 'wanted'     THEN fs.share_wanted
        ELSE false END
  );
$$;

-- Add SELECT policies allowing friends to read shared content
CREATE POLICY "friends read shared collection"
ON public.collection_entries FOR SELECT
TO authenticated
USING (public.shares_with(user_id, auth.uid(), game, 'collection'));

CREATE POLICY "friends read shared binders"
ON public.binders FOR SELECT
TO authenticated
USING (public.shares_with(user_id, auth.uid(), game, 'binders'));

CREATE POLICY "friends read shared binder slots"
ON public.binder_slots FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.binders b
  WHERE b.id = binder_slots.binder_id
    AND public.shares_with(b.user_id, auth.uid(), b.game, 'binders')
));

CREATE POLICY "friends read shared decks"
ON public.decks FOR SELECT
TO authenticated
USING (public.shares_with(user_id, auth.uid(), game, 'decks'));

CREATE POLICY "friends read shared deck cards"
ON public.deck_cards FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.decks d
  WHERE d.id = deck_cards.deck_id
    AND public.shares_with(d.user_id, auth.uid(), d.game, 'decks')
));

CREATE POLICY "friends read shared wanted"
ON public.wanted_cards FOR SELECT
TO authenticated
USING (public.shares_with(user_id, auth.uid(), game, 'wanted'));

-- CHAT MESSAGES
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  body text,
  kind text NOT NULL DEFAULT 'text', -- 'text' | 'trade_request'
  card_id uuid,
  game text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT chat_distinct CHECK (sender_id <> recipient_id)
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view own chat"
ON public.chat_messages FOR SELECT
TO authenticated
USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "send chat to friend"
ON public.chat_messages FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = sender_id AND public.are_friends(sender_id, recipient_id));

CREATE POLICY "update own received chat"
ON public.chat_messages FOR UPDATE
TO authenticated
USING (auth.uid() = recipient_id);

CREATE INDEX IF NOT EXISTS chat_pair_idx ON public.chat_messages (sender_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS chat_recipient_idx ON public.chat_messages (recipient_id, created_at);

-- updated_at trigger for friendships and friend_shares
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS friendships_updated_at ON public.friendships;
CREATE TRIGGER friendships_updated_at BEFORE UPDATE ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS friend_shares_updated_at ON public.friend_shares;
CREATE TRIGGER friend_shares_updated_at BEFORE UPDATE ON public.friend_shares
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();