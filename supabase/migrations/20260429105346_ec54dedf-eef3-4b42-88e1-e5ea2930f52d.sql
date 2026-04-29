-- Drop and recreate game CHECK constraints to include 'yugioh'
ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_game_check;
ALTER TABLE public.cards ADD CONSTRAINT cards_game_check
  CHECK (game = ANY (ARRAY['pokemon'::text, 'onepiece'::text, 'yugioh'::text]));

ALTER TABLE public.collection_entries DROP CONSTRAINT IF EXISTS collection_entries_game_check;
ALTER TABLE public.collection_entries ADD CONSTRAINT collection_entries_game_check
  CHECK (game = ANY (ARRAY['pokemon'::text, 'onepiece'::text, 'yugioh'::text]));

ALTER TABLE public.binders DROP CONSTRAINT IF EXISTS binders_game_check;
ALTER TABLE public.binders ADD CONSTRAINT binders_game_check
  CHECK (game = ANY (ARRAY['pokemon'::text, 'onepiece'::text, 'yugioh'::text]));

ALTER TABLE public.wanted_cards DROP CONSTRAINT IF EXISTS wanted_cards_game_check;
ALTER TABLE public.wanted_cards ADD CONSTRAINT wanted_cards_game_check
  CHECK (game = ANY (ARRAY['pokemon'::text, 'onepiece'::text, 'yugioh'::text]));

-- decks already has a `game` column with default 'onepiece' but no check; add one
ALTER TABLE public.decks DROP CONSTRAINT IF EXISTS decks_game_check;
ALTER TABLE public.decks ADD CONSTRAINT decks_game_check
  CHECK (game = ANY (ARRAY['pokemon'::text, 'onepiece'::text, 'yugioh'::text]));