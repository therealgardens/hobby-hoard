CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS cards_name_trgm_idx ON public.cards USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cards_code_trgm_idx ON public.cards USING gin (lower(code) gin_trgm_ops);