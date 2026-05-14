
-- ============================================================
-- REFACTOR: card_printings, ownership, binder_entries (additivo)
-- ============================================================

-- 1) card_printings: ogni stampa fisica distinta di una carta
CREATE TABLE IF NOT EXISTS public.card_printings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  printing_code TEXT NOT NULL,           -- es. "OP01-001", "OP01-001_p1"
  variant_type TEXT NOT NULL DEFAULT 'base'
    CHECK (variant_type IN ('base','alt_art','parallel','promo','special','reprint','foil')),
  rarity TEXT,
  finish TEXT,                            -- normal, holo, reverse_holo, etc.
  language TEXT NOT NULL DEFAULT 'EN',
  image_small TEXT,
  image_large TEXT,
  source TEXT NOT NULL DEFAULT 'unknown', -- 'apitcg','optcgapi','pokemontcg','tcgdex','ygoprodeck','backfill'
  source_id TEXT,                         -- id originale dalla fonte
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (card_id, printing_code, variant_type, language)
);

CREATE INDEX IF NOT EXISTS idx_card_printings_card_id ON public.card_printings(card_id);
CREATE INDEX IF NOT EXISTS idx_card_printings_printing_code ON public.card_printings(printing_code);
CREATE INDEX IF NOT EXISTS idx_card_printings_variant_type ON public.card_printings(variant_type);

ALTER TABLE public.card_printings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone authed reads card_printings" ON public.card_printings;
CREATE POLICY "anyone authed reads card_printings"
  ON public.card_printings FOR SELECT TO authenticated USING (true);

CREATE TRIGGER update_card_printings_updated_at
  BEFORE UPDATE ON public.card_printings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) ownership: source of truth per le copie possedute
CREATE TABLE IF NOT EXISTS public.ownership (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  printing_id UUID NOT NULL REFERENCES public.card_printings(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  language TEXT NOT NULL DEFAULT 'EN',
  condition TEXT NOT NULL DEFAULT 'NM',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, printing_id, language, condition)
);

CREATE INDEX IF NOT EXISTS idx_ownership_user ON public.ownership(user_id);
CREATE INDEX IF NOT EXISTS idx_ownership_printing ON public.ownership(printing_id);

ALTER TABLE public.ownership ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own ownership all" ON public.ownership;
CREATE POLICY "own ownership all" ON public.ownership FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "friends read shared ownership" ON public.ownership;
CREATE POLICY "friends read shared ownership" ON public.ownership FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.card_printings cp
    JOIN public.cards c ON c.id = cp.card_id
    WHERE cp.id = ownership.printing_id
      AND public.shares_with(ownership.user_id, auth.uid(), c.game, 'collection')
  ));

CREATE TRIGGER update_ownership_updated_at
  BEFORE UPDATE ON public.ownership
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) binder_entries: collocazione fisica nei binder (sostituisce binder_slots)
CREATE TABLE IF NOT EXISTS public.binder_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  binder_id UUID NOT NULL REFERENCES public.binders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  printing_id UUID REFERENCES public.card_printings(id) ON DELETE SET NULL,
  is_wanted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (binder_id, position)
);

CREATE INDEX IF NOT EXISTS idx_binder_entries_user ON public.binder_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_binder_entries_binder ON public.binder_entries(binder_id);
CREATE INDEX IF NOT EXISTS idx_binder_entries_printing ON public.binder_entries(printing_id);

ALTER TABLE public.binder_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own binder_entries all" ON public.binder_entries;
CREATE POLICY "own binder_entries all" ON public.binder_entries FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "friends read shared binder_entries" ON public.binder_entries;
CREATE POLICY "friends read shared binder_entries" ON public.binder_entries FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.binders b
    WHERE b.id = binder_entries.binder_id
      AND public.shares_with(b.user_id, auth.uid(), b.game, 'binders')
  ));

-- 4) sync_conflicts: log dei conflitti tra fonti dati
CREATE TABLE IF NOT EXISTS public.sync_conflicts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game TEXT NOT NULL,
  printing_code TEXT,
  source_a TEXT NOT NULL,
  source_b TEXT NOT NULL,
  field TEXT NOT NULL,
  value_a TEXT,
  value_b TEXT,
  resolved_to TEXT,
  resolved_by_rule TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sync_conflicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read sync_conflicts" ON public.sync_conflicts;
CREATE POLICY "admins read sync_conflicts" ON public.sync_conflicts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5) Trigger: binder_entries → ownership (auto-incrementa quando aggiungi al binder)
CREATE OR REPLACE FUNCTION public.sync_binder_to_ownership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ownership_id UUID;
BEGIN
  -- INSERT: se il binder slot ha una printing reale (non wanted), assicura ownership >= 1
  IF (TG_OP = 'INSERT') THEN
    IF NEW.printing_id IS NOT NULL AND NEW.is_wanted = false THEN
      INSERT INTO public.ownership (user_id, printing_id, quantity)
      VALUES (NEW.user_id, NEW.printing_id, 1)
      ON CONFLICT (user_id, printing_id, language, condition)
      DO UPDATE SET quantity = ownership.quantity + 1, updated_at = now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: se cambia la printing, decrementa la vecchia e incrementa la nuova
  IF (TG_OP = 'UPDATE') THEN
    IF OLD.printing_id IS DISTINCT FROM NEW.printing_id OR OLD.is_wanted IS DISTINCT FROM NEW.is_wanted THEN
      IF OLD.printing_id IS NOT NULL AND OLD.is_wanted = false THEN
        UPDATE public.ownership
          SET quantity = GREATEST(quantity - 1, 0), updated_at = now()
          WHERE user_id = OLD.user_id AND printing_id = OLD.printing_id;
      END IF;
      IF NEW.printing_id IS NOT NULL AND NEW.is_wanted = false THEN
        INSERT INTO public.ownership (user_id, printing_id, quantity)
        VALUES (NEW.user_id, NEW.printing_id, 1)
        ON CONFLICT (user_id, printing_id, language, condition)
        DO UPDATE SET quantity = ownership.quantity + 1, updated_at = now();
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE: decrementa, mai sotto 0
  IF (TG_OP = 'DELETE') THEN
    IF OLD.printing_id IS NOT NULL AND OLD.is_wanted = false THEN
      UPDATE public.ownership
        SET quantity = GREATEST(quantity - 1, 0), updated_at = now()
        WHERE user_id = OLD.user_id AND printing_id = OLD.printing_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_binder_entries_sync_ownership ON public.binder_entries;
CREATE TRIGGER trg_binder_entries_sync_ownership
  AFTER INSERT OR UPDATE OR DELETE ON public.binder_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_binder_to_ownership();

-- 6) View masterset_progress: completamento per (user, game, set_id)
CREATE OR REPLACE VIEW public.masterset_progress AS
SELECT
  o.user_id,
  c.game,
  c.set_id,
  c.set_name,
  COUNT(DISTINCT cp.id) FILTER (WHERE o.quantity > 0) AS owned_printings,
  (SELECT COUNT(*) FROM public.card_printings cp2
     JOIN public.cards c2 ON c2.id = cp2.card_id
     WHERE c2.game = c.game AND c2.set_id = c.set_id) AS total_printings
FROM public.ownership o
JOIN public.card_printings cp ON cp.id = o.printing_id
JOIN public.cards c ON c.id = cp.card_id
GROUP BY o.user_id, c.game, c.set_id, c.set_name;

-- 7) View user_owned_cards: convenience per il frontend (compat con vecchio modello)
CREATE OR REPLACE VIEW public.user_owned_cards AS
SELECT DISTINCT
  o.user_id,
  cp.card_id,
  cp.id AS printing_id,
  cp.printing_code,
  cp.variant_type,
  c.game,
  c.set_id,
  c.code,
  o.quantity
FROM public.ownership o
JOIN public.card_printings cp ON cp.id = o.printing_id
JOIN public.cards c ON c.id = cp.card_id
WHERE o.quantity > 0;
