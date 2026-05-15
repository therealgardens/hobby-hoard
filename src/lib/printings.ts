// Helpers per canonicalizzazione codici carta e classificazione varianti.
// Usati sia client-side (CardSearch / SetView) sia server-side via copia in edge functions.

export type VariantType = "base" | "alt_art" | "parallel" | "promo" | "reprint" | "secret";

export interface CanonicalCode {
  raw: string;
  setCode: string | null;
  number: string | null;
  variantMarker: string | null; // es. "p1", "p2"
  variantType: VariantType;
}

const SET_CODE_RE = /^([A-Za-z]{1,4}\d{1,3}[A-Za-z]?)-/;
const FULL_CODE_RE = /^([A-Za-z]{1,4}\d{1,3}[A-Za-z]?)-(\d{1,4}[A-Za-z]?)(?:_(p\d+))?$/i;

/**
 * Estrae il prefisso set da un code tipo "OP01-001_p1" → "OP01".
 * Usato per evitare di affidarsi al set_id ricevuto dall'API esterna.
 */
export function extractSetCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const match = code.match(SET_CODE_RE);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Determina il tipo di variante da un code + rarity.
 * - suffisso _p\d+   → parallel
 * - rarity AA / SP   → alt_art
 * - rarity SEC       → secret
 * - rarity PR/PROMO  → promo
 * - default          → base
 */
export function classifyVariant(code: string | null | undefined, rarity?: string | null): VariantType {
  const r = (rarity ?? "").toUpperCase().trim();
  if (code && /_p\d+$/i.test(code)) return "parallel";
  if (r === "AA" || r === "ALT ART" || r === "ALTERNATE ART") return "alt_art";
  if (r === "SEC" || r === "SECRET" || r === "SR") return "secret";
  if (r === "PR" || r === "PROMO" || r === "P") return "promo";
  return "base";
}

/** Parsing completo di un printing code. Gestisce input malformati restituendo null nei campi. */
export function parseCode(code: string | null | undefined, rarity?: string | null): CanonicalCode {
  const raw = code ?? "";
  const m = raw.match(FULL_CODE_RE);
  return {
    raw,
    setCode: m ? m[1].toUpperCase() : extractSetCode(raw),
    number: m ? m[2].toUpperCase() : null,
    variantMarker: m && m[3] ? m[3].toLowerCase() : null,
    variantType: classifyVariant(raw, rarity),
  };
}

/**
 * Chiave canonica per la "carta logica" (senza varianti).
 * Due stampe con la stessa canonicalKey rappresentano la stessa illustrazione/carta-base.
 */
export function canonicalKey(code: string | null | undefined): string | null {
  const parsed = parseCode(code);
  if (!parsed.setCode || !parsed.number) return null;
  return `${parsed.setCode}-${parsed.number}`;
}

/** Chiave univoca della stampa (include variante). */
export function printingKey(code: string | null | undefined, rarity?: string | null): string | null {
  const parsed = parseCode(code, rarity);
  if (!parsed.setCode || !parsed.number) return null;
  const variant = parsed.variantMarker ?? (parsed.variantType !== "base" ? parsed.variantType : "");
  return variant ? `${parsed.setCode}-${parsed.number}_${variant}` : `${parsed.setCode}-${parsed.number}`;
}
