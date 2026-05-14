// src/lib/cardNormalization.ts
import type { Tables } from "@/integrations/supabase/types";
import type { Game } from "./game";

type CardRow = Tables<"cards">;

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function upper(value: string | null | undefined): string {
  return clean(value).toUpperCase();
}

export function normalizeSetId(setId: string | null | undefined): string {
  return upper(setId).replace(/[^A-Z0-9]/g, "");
}

export function normalizeCardCode(code: string | null | undefined): string {
  return upper(code).replace(/\s+/g, "");
}

export function normalizeVariantType(card: Pick<CardRow, "game" | "code" | "rarity" | "variant_type">): string {
  if (card.variant_type) return clean(card.variant_type).toLowerCase();

  if (card.game === "onepiece") {
    const code = upper(card.code);
    const rarity = upper(card.rarity);

    if (/_P\d+$/.test(code)) return "alt_art";
    if (rarity === "AA" || rarity === "SP" || rarity === "MR") return "alt_art";
    return "base";
  }

  return "base";
}

export function getCanonicalCardId(card: Pick<CardRow, "id" | "canonical_card_id">): string {
  return clean(card.canonical_card_id) || clean(card.id);
}

export function getPrintingKey(
  card: Pick<CardRow, "id" | "game" | "set_id" | "code" | "language" | "variant_type" | "rarity">
): string {
  const game = clean(card.game).toLowerCase() || "unknown";
  const setId = normalizeSetId(card.set_id) || "unknown";
  const code = normalizeCardCode(card.code) || clean(card.id) || "unknown";
  const language = upper(card.language) || "EN";
  const variant = normalizeVariantType(card);
  return `${game}|${setId}|${code}|${language}|${variant}`;
}

export function cardBelongsToSet(
  game: Game,
  card: Pick<CardRow, "set_id" | "set_name" | "code">,
  setId: string
): boolean {
  const target = normalizeSetId(setId);
  if (!target) return false;

  const cardSetId = normalizeSetId(card.set_id);
  const code = normalizeCardCode(card.code);
  const codePrefix = code.split("-")[0];
  const compactPrefixMatch = code.startsWith(target);
  const dashedPrefixMatch = !!codePrefix && normalizeSetId(codePrefix) === target;

  if (game === "onepiece") {
    return dashedPrefixMatch || compactPrefixMatch;
  }

  if (cardSetId === target) return true;
  if (dashedPrefixMatch || compactPrefixMatch) return true;

  const setName = upper(card.set_name);
  if (setName.includes(target)) return true;

  return false;
}

export function dedupeCardsByPrinting(cards: CardRow[]): CardRow[] {
  const map = new Map<string, CardRow>();

  for (const card of cards) {
    const key = getPrintingKey(card);
    if (!map.has(key)) {
      map.set(key, card);
      continue;
    }

    const existing = map.get(key)!;
    const existingScore =
      (existing.image_small ? 1 : 0) +
      (existing.image_large ? 1 : 0) +
      (existing.set_id ? 1 : 0) +
      (existing.set_name ? 1 : 0);
    const incomingScore =
      (card.image_small ? 1 : 0) +
      (card.image_large ? 1 : 0) +
      (card.set_id ? 1 : 0) +
      (card.set_name ? 1 : 0);

    if (incomingScore > existingScore) {
      map.set(key, card);
    }
  }

  return Array.from(map.values());
}

export function groupVariantsByCanonicalCard(cards: CardRow[]): Map<string, CardRow[]> {
  const map = new Map<string, CardRow[]>();

  for (const card of cards) {
    const canonical = getCanonicalCardId(card);
    if (!map.has(canonical)) map.set(canonical, []);
    map.get(canonical)!.push(card);
  }

  return map;
}

export function getCardGroupKey(
  game: Game,
  card: Pick<CardRow, "id" | "canonical_card_id" | "variant_type" | "language" | "code" | "rarity">
): string {
  const canonical = getCanonicalCardId(card);
  const variant = normalizeVariantType({
    game,
    code: card.code ?? null,
    rarity: card.rarity ?? null,
    variant_type: card.variant_type ?? null,
  } as Pick<CardRow, "game" | "code" | "rarity" | "variant_type">);
  const lang = upper(card.language) || "EN";
  return `${game}:${canonical}:${variant}:${lang}`;
}
