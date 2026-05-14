
-- Trigger di compat: binder_slots → collection_entries
-- Risolve immediatamente il bug "carte nel binder non appaiono nel master set"
-- senza richiedere refactor del frontend.

CREATE OR REPLACE FUNCTION public.sync_binder_slot_to_collection()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _game TEXT;
  _rarity TEXT;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.card_id IS NOT NULL AND NEW.is_wanted = false THEN
      SELECT c.game, c.rarity INTO _game, _rarity FROM public.cards c WHERE c.id = NEW.card_id;
      IF _game IS NOT NULL THEN
        INSERT INTO public.collection_entries (user_id, card_id, game, rarity, language, quantity)
        VALUES (NEW.user_id, NEW.card_id, _game, _rarity, 'EN', 1)
        ON CONFLICT DO NOTHING;
        -- se esiste già, non incrementiamo: una collection_entry copre N copie binder
        -- (la presenza è ciò che conta per il masterset)
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF (TG_OP = 'DELETE') THEN
    IF OLD.card_id IS NOT NULL AND OLD.is_wanted = false THEN
      -- Rimuovi collection_entry SOLO se non ci sono altri slot per la stessa carta
      IF NOT EXISTS (
        SELECT 1 FROM public.binder_slots
        WHERE user_id = OLD.user_id AND card_id = OLD.card_id
          AND id <> OLD.id AND is_wanted = false
      ) THEN
        DELETE FROM public.collection_entries
        WHERE user_id = OLD.user_id AND card_id = OLD.card_id
          AND quantity = 1;  -- preserva voci con quantità manuale > 1
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF (TG_OP = 'UPDATE') THEN
    -- Se cambia card_id, applica DELETE+INSERT logica
    IF OLD.card_id IS DISTINCT FROM NEW.card_id THEN
      IF OLD.card_id IS NOT NULL AND OLD.is_wanted = false THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.binder_slots
          WHERE user_id = OLD.user_id AND card_id = OLD.card_id
            AND id <> OLD.id AND is_wanted = false
        ) THEN
          DELETE FROM public.collection_entries
          WHERE user_id = OLD.user_id AND card_id = OLD.card_id AND quantity = 1;
        END IF;
      END IF;
      IF NEW.card_id IS NOT NULL AND NEW.is_wanted = false THEN
        SELECT c.game, c.rarity INTO _game, _rarity FROM public.cards c WHERE c.id = NEW.card_id;
        IF _game IS NOT NULL THEN
          INSERT INTO public.collection_entries (user_id, card_id, game, rarity, language, quantity)
          VALUES (NEW.user_id, NEW.card_id, _game, _rarity, 'EN', 1)
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_binder_slots_sync_collection ON public.binder_slots;
CREATE TRIGGER trg_binder_slots_sync_collection
  AFTER INSERT OR UPDATE OR DELETE ON public.binder_slots
  FOR EACH ROW EXECUTE FUNCTION public.sync_binder_slot_to_collection();

-- BACKFILL: per binder_slots esistenti senza collection_entry corrispondente
INSERT INTO public.collection_entries (user_id, card_id, game, rarity, language, quantity)
SELECT DISTINCT ON (bs.user_id, bs.card_id)
  bs.user_id, bs.card_id, c.game, c.rarity, 'EN', 1
FROM public.binder_slots bs
JOIN public.cards c ON c.id = bs.card_id
WHERE bs.is_wanted = false
  AND bs.card_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.collection_entries ce
    WHERE ce.user_id = bs.user_id AND ce.card_id = bs.card_id
  );
