/**
 * Centralized card identity & normalization logic.
 * 
 * Core concepts:
 * - canonical_card_id: "what card is this logically" (grouping base + variants)
 * - printing_key: "what exact printing is this" (stable, used for dedup)
 * - variant_type: "what variant of the card is this" (base, alt_art, holo, etc.)
 */

import type { Tables } from "@/integrations/supabase/types";
import type { Game } from "./game";

type CardRow = Tables<"cards">;

/**
 * Get the stable printing key for a card.
 * Format: game|set_id|code|language|variant_type
 * 
 * This is the PRIMARY deduplication key: two cards with the same printing key
 * are the EXACT SAME physical card and should never both appear in a collection.
 */
export function getPrintingKey(card: CardRow): string {
  const game = (card.game || "unknown").toLowerCase();
  const set_id = (card.set_id || "unknown").toLowerCase();
  const code = (card.code || "unknown").toLowerCase();
  const language = (card.language || "EN").toUpperCase();
  const variant = (card.variant_type || "base").toLowerCase();
  
  return `${game}|${set_id}|${code}|${language}|${variant}`;
}

/**
 * Check if a printing key is valid (i.e., represents a fully identified card).
 * Invalid if any critical component is "unknown".
 */
export function isValidPrintingKey(key: string): boolean {
  const parts = key.split("|");
  if (parts.length !== 5) return false;
  const [game, set_id, code, lang, variant] = parts;
  return (
    game !== "unknown" &&
    set_id !== "unknown" &&
    code !== "unknown" &&
    lang !== "" &&
    variant !== ""
  );
}

/**
 * Get the canonical card ID.
 * - If card.canonical_card_id is set → use it (this is a variant, points to base).
 * - Otherwise → use card.id (this IS the canonical card, or variant without link).
 * 
 * Used for grouping all variants/printings of the same logical card.
 */
export function getCanonicalCardId(card: CardRow): string {
  return card.canonical_card_id || card.id;
}

/**
 * Detect One Piece alternate art based on heuristics.
 * 
 * One Piece cards can be:
 * - Base card (normal rarity, no parallel code)
 * - Parallel/Alt art (code ends with _P1, _P2, etc. OR rarity in [AA, SP, MR])
 * 
 * Returns 'base' or 'alt_art'. This should be stored in variant_type.
 */
export function detectOnePieceVariant(card: CardRow): "base" | "alt_art" {
  const code = String(card.code ?? "").toUpperCase();
  if (/_P\d+$/.test(code)) return "alt_art";
  
  const rarity = String(card.rarity ?? "").toUpperCase();
  if (rarity === "AA" || rarity === "SP" || rarity === "MR") return "alt_art";
  
  return "base";
}

/**
 * Detect Pokémon card variant based on heuristics.
 * 
 * Pokémon cards can have many variants: normal, holo, reverse holo, etc.
 * For now, if no explicit variant_type, return 'base'.
 */
export function detectPokemonVariant(card: CardRow): string {
  // If DB has variant_type, trust it
  if (card.variant_type) return card.variant_type;
  
  // Otherwise, return generic 'base'
  return "base";
}

/**
 * Normalize set ID for comparison/matching.
 * 
 * Removes dashes, spaces, converts to uppercase.
 * E.g., "sv-1" → "SV1", "OP-14" → "OP14"
 */
export function normalizeSetId(setId: string | null | undefined): string {
  return String(setId ?? "")
    .toUpperCase()
    .replace(/[\s\-]/g, "");
}

/**
 * Check if a card belongs to a set based on:
 * 1. Exact set_id match (after normalization)
 * 2. Code prefix match (e.g., "OP14-001" matches set "OP14")
 * 
 * For One Piece: ONLY use code, never set_id (reprints keep old set_id)
 */
export function cardBelongsToSet(
  game: Game,
  card: CardRow,
  setId: string
): boolean {
  const normSetId = normalizeSetId(setId);
  
  if (!normSetId) return false;
  
  // One Piece: rely on code pattern ONLY
  if (game === "onepiece") {
    const code = normalizeSetId(card.code);
    return code.startsWith(normSetId + "-") || code.startsWith(normSetId);
  }
  
  // Pokémon & Yu-Gi-Oh: check both set_id (primary) and code (fallback)
  const cardSetId = normalizeSetId(card.set_id);
  if (cardSetId === normSetId) return true;
  
  const code = normalizeSetId(card.code);
  return code.startsWith(normSetId + "-") || code.startsWith(normSetId);
}

/**
 * Deduplicate cards by printing key.
 * 
 * Takes an array of CardRow, returns unique array keeping first occurrence.
 * This is the single source of truth for dedup across the app.
 */
export function dedupeCardsByPrinting(cards: CardRow[]): CardRow[] {
  const seen = new Set<string>();
  const result: CardRow[] = [];
  
  for (const card of cards) {
    const key = getPrintingKey(card);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(card);
    }
  }
  
  return result;
}

/**
 * Group cards by canonical card ID.
 * 
 * Returns a Map where each key is a canonical_card_id,
 * and each value is an array of all variants/printings of that card.
 */
export function groupVariantsByCanonicalCard(
  cards: CardRow[]
): Map<string, CardRow[]> {
  const map = new Map<string, CardRow[]>();
  
  for (const card of cards) {
    const canonical = getCanonicalCardId(card);
    if (!map.has(canonical)) {
      map.set(canonical, []);
    }
    map.get(canonical)!.push(card);
  }
  
  return map;
}

/**
 * For a set of cards (e.g., from a master set), compute a stable dedup key
 * that includes grouping information.
 * 
 * Used for React keys and stable sorting.
 */
export function getCardGroupKey(
  game: Game,
  card: CardRow,
  includeVariant: boolean = false
): string {
  const canonical = getCanonicalCardId(card);
  
  if (includeVariant) {
    return `${game}:${canonical}:${card.variant_type || "base"}:${card.language || "EN"}`;
  }
  
  return `${game}:${canonical}`;
}
