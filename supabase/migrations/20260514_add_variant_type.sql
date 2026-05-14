-- FASE 4: Schema migrations to support card variant tracking
-- Enables proper deduplication and One Piece alt-art handling

-- Add variant_type column to track base vs alt_art (One Piece), holo variations (Pokemon), etc.
ALTER TABLE public.cards 
  ADD COLUMN IF NOT EXISTS variant_type TEXT DEFAULT 'base' 
  CHECK (variant_type IN ('base', 'alt_art', 'holo', 'reverse_holo', 'secret_rare', 'special'));

-- Add canonical_card_id for grouping variants of the same logical card
-- E.g., OP14-001 base and OP14-001_P1 alt-art both reference same canonical card
ALTER TABLE public.cards 
  ADD COLUMN IF NOT EXISTS canonical_card_id UUID REFERENCES public.cards(id) ON DELETE SET NULL;

-- Create indexes for efficient variant queries and grouping
CREATE INDEX IF NOT EXISTS idx_cards_canonical_id 
  ON public.cards (canonical_card_id) 
  WHERE canonical_card_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cards_variant_type_game 
  ON public.cards (game, variant_type);

CREATE INDEX IF NOT EXISTS idx_cards_game_code_variant 
  ON public.cards (game, code, variant_type);

-- Helper function: detect One Piece variant type from code and rarity
CREATE OR REPLACE FUNCTION public.detect_op_variant(
  _code TEXT, 
  _rarity TEXT
)
RETURNS TEXT AS $$
BEGIN
  -- Parallel cards end with _P<number>
  IF _code ILIKE '%\_P%' THEN 
    RETURN 'alt_art'; 
  END IF;
  
  -- Alt-art rarities: AA (Alternate Art), SP (Special), MR (Millennium Rare)
  IF _rarity IN ('AA', 'SP', 'MR') THEN 
    RETURN 'alt_art'; 
  END IF;
  
  RETURN 'base';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

GRANT EXECUTE ON FUNCTION public.detect_op_variant(TEXT, TEXT) TO authenticated;

-- Helper function: detect Pokémon variant type from card name/rarity
CREATE OR REPLACE FUNCTION public.detect_pokemon_variant(
  _name TEXT,
  _rarity TEXT
)
RETURNS TEXT AS $$
BEGIN
  -- Special rarity categories
  IF _rarity IN ('Secret Rare', 'Special Illustration Rare', 'Shiny Rare', 'Shiny Ultra Rare') THEN
    RETURN 'alt_art';
  END IF;
  
  -- Check for holo indicators in name
  IF _name ILIKE '%Reverse Holo%' THEN
    RETURN 'reverse_holo';
  END IF;
  
  RETURN 'base';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

GRANT EXECUTE ON FUNCTION public.detect_pokemon_variant(TEXT, TEXT) TO authenticated;

-- Update trigger: auto-populate variant_type if empty
CREATE OR REPLACE FUNCTION public.auto_detect_variant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.variant_type IS NULL OR NEW.variant_type = 'base' THEN
    CASE NEW.game
      WHEN 'onepiece' THEN
        NEW.variant_type := public.detect_op_variant(NEW.code, NEW.rarity);
      WHEN 'pokemon' THEN
        NEW.variant_type := public.detect_pokemon_variant(NEW.name, NEW.rarity);
      ELSE
        NEW.variant_type := 'base';
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_detect_variant_trigger ON public.cards;
CREATE TRIGGER auto_detect_variant_trigger
  BEFORE INSERT OR UPDATE ON public.cards
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_detect_variant();

-- Comment on columns for documentation
COMMENT ON COLUMN public.cards.variant_type IS 
  'Card variant type: base, alt_art, holo, reverse_holo, secret_rare, special. Used for deduplication and display.';

COMMENT ON COLUMN public.cards.canonical_card_id IS 
  'Reference to the canonical/base card. If set, this card is a variant (alt art, holo, etc.) of another card.';
