CREATE INDEX IF NOT EXISTS idx_collection_entries_user_game_qty
  ON public.collection_entries (user_id, game, quantity);

CREATE INDEX IF NOT EXISTS idx_cards_game_set_id
  ON public.cards (game, set_id);

CREATE INDEX IF NOT EXISTS idx_cards_game_code_pattern
  ON public.cards (game, code text_pattern_ops);

CREATE OR REPLACE FUNCTION public.cleanup_stuck_sync_jobs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.sync_jobs
  SET
    status = 'failed',
    error = 'Timed out — cleaned up automatically',
    finished_at = now()
  WHERE
    status = 'running'
    AND started_at < now() - interval '15 minutes';
$$;