ALTER TABLE public.deck_cards ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.deck_cards ALTER COLUMN code DROP NOT NULL;
ALTER TABLE public.deck_cards ADD CONSTRAINT deck_cards_code_or_name_chk CHECK (code IS NOT NULL OR name IS NOT NULL);