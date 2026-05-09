CREATE OR REPLACE FUNCTION public.increment_sync_summary(
  job_id uuid,
  game_key text,
  delta integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.sync_jobs
  SET summary = jsonb_set(
    COALESCE(summary, '{}'::jsonb),
    ARRAY[game_key],
    to_jsonb(COALESCE((summary->>game_key)::integer, 0) + delta)
  )
  WHERE id = job_id;
$$;