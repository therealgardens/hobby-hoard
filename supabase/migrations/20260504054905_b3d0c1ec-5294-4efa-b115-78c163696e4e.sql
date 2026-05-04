CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running',
  games text[] NOT NULL DEFAULT '{}',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  total integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  triggered_by uuid
);

CREATE INDEX IF NOT EXISTS sync_jobs_started_at_idx ON public.sync_jobs (started_at DESC);

ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read sync_jobs"
ON public.sync_jobs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));