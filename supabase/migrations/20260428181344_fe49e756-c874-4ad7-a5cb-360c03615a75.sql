-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Shared card catalog (cache from public APIs)
CREATE TABLE public.cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game TEXT NOT NULL CHECK (game IN ('pokemon','onepiece')),
  external_id TEXT NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  set_id TEXT,
  set_name TEXT,
  number TEXT,
  rarity TEXT,
  image_small TEXT,
  image_large TEXT,
  pokedex_number INT,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(game, external_id)
);
CREATE INDEX cards_game_name_idx ON public.cards (game, lower(name));
CREATE INDEX cards_game_code_idx ON public.cards (game, lower(code));
CREATE INDEX cards_set_idx ON public.cards (game, set_id);
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone authed reads cards" ON public.cards FOR SELECT TO authenticated USING (true);

-- Collection entries (a row per card+rarity+language combo)
CREATE TABLE public.collection_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES public.cards ON DELETE CASCADE,
  game TEXT NOT NULL CHECK (game IN ('pokemon','onepiece')),
  rarity TEXT,
  language TEXT NOT NULL DEFAULT 'EN',
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX collection_user_game_idx ON public.collection_entries (user_id, game);
CREATE INDEX collection_card_idx ON public.collection_entries (card_id);
ALTER TABLE public.collection_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own collection select" ON public.collection_entries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own collection insert" ON public.collection_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own collection update" ON public.collection_entries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own collection delete" ON public.collection_entries FOR DELETE USING (auth.uid() = user_id);

-- Binders
CREATE TABLE public.binders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  game TEXT NOT NULL CHECK (game IN ('pokemon','onepiece')),
  name TEXT NOT NULL,
  cols INT NOT NULL DEFAULT 3 CHECK (cols BETWEEN 2 AND 6),
  rows INT NOT NULL DEFAULT 3 CHECK (rows BETWEEN 2 AND 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.binders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own binders all" ON public.binders FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.binder_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  binder_id UUID NOT NULL REFERENCES public.binders ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  position INT NOT NULL,
  card_id UUID REFERENCES public.cards ON DELETE SET NULL,
  is_wanted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(binder_id, position)
);
ALTER TABLE public.binder_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own slots all" ON public.binder_slots FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Wanted cards
CREATE TABLE public.wanted_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES public.cards ON DELETE CASCADE,
  game TEXT NOT NULL CHECK (game IN ('pokemon','onepiece')),
  rarity TEXT,
  language TEXT DEFAULT 'EN',
  quantity INT NOT NULL DEFAULT 1,
  binder_id UUID REFERENCES public.binders ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wanted_user_game_idx ON public.wanted_cards (user_id, game);
ALTER TABLE public.wanted_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own wanted all" ON public.wanted_cards FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Decks (One Piece focus, but game column for flexibility)
CREATE TABLE public.decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  game TEXT NOT NULL DEFAULT 'onepiece',
  name TEXT NOT NULL,
  raw_list TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.decks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own decks all" ON public.decks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.deck_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id UUID NOT NULL REFERENCES public.decks ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  code TEXT NOT NULL,
  copies INT NOT NULL DEFAULT 1
);
ALTER TABLE public.deck_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own deck cards all" ON public.deck_cards FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Pokedex manual tracking
CREATE TABLE public.pokedex_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  pokedex_number INT NOT NULL,
  registered BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, pokedex_number)
);
ALTER TABLE public.pokedex_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pokedex all" ON public.pokedex_entries FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);