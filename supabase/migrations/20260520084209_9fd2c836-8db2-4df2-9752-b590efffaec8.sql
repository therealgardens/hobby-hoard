CREATE OR REPLACE FUNCTION public.cleanup_stuck_sync_jobs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.sync_jobs
  SET status = 'failed',
      error = 'Timed out — cleaned up automatically',
      finished_at = now()
  WHERE status = 'running'
    AND started_at < now() - interval '6 hours';
$$;