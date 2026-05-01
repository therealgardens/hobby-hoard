-- Full-text search index on name + code
CREATE INDEX IF NOT EXISTS cards_fts_idx ON public.cards
USING gin(to_tsvector('english', coalesce(name,'') || ' ' || coalesce(code,'')));

-- Trigram-style ilike helpers (lightweight, complements FTS for short prefixes)
CREATE INDEX IF NOT EXISTS cards_name_lower_idx ON public.cards (lower(name));
CREATE INDEX IF NOT EXISTS cards_code_lower_idx ON public.cards (lower(code));

-- Enable pg_cron and pg_net for scheduled HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;