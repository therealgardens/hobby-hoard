-- Ensure each binder slot position is unique per binder so upsert(onConflict) works atomically
DO $$
BEGIN
  -- Remove duplicates if any (keep the most recent by id)
  DELETE FROM public.binder_slots a
  USING public.binder_slots b
  WHERE a.binder_id = b.binder_id
    AND a.position  = b.position
    AND a.ctid < b.ctid;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'binder_slots_binder_position_unique'
  ) THEN
    ALTER TABLE public.binder_slots
      ADD CONSTRAINT binder_slots_binder_position_unique
      UNIQUE (binder_id, position);
  END IF;
END$$;

-- Helpful index for the ordered per-binder fetch (cheap if it already exists)
CREATE INDEX IF NOT EXISTS binder_slots_binder_position_idx
  ON public.binder_slots (binder_id, position);