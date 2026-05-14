export type Game = "onepiece" | "pokemon" | "yugioh";

const GAME_LABELS: Record<Game, string> = {
  onepiece: "One Piece",
  pokemon: "Pokémon",
  yugioh: "Yu-Gi-Oh!",
};

const GAME_ROUTE_SEGMENTS: Record<Game, string> = {
  onepiece: "onepiece",
  pokemon: "pokemon",
  yugioh: "yugioh",
};

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function upper(value: string | null | undefined): string {
  return clean(value).toUpperCase();
}

function normalizeSetId(value: string | null | undefined): string {
  return upper(value).replace(/[^A-Z0-9]/g, "");
}

function normalizeCardCode(value: string | null | undefined): string {
  return upper(value).replace(/\s+/g, "");
}

function onePieceDashedSetId(value: string | null | undefined): string {
  const raw = upper(value);
  if (!raw) return "";
  if (raw.includes("-")) return raw;
  const m = raw.match(/^([A-Z]+)(\d+[A-Z]?)$/);
  if (!m) return raw;
  return `${m[1]}-${m[2]}`;
}

function extractSetId(source: string | null | undefined): string | null {
  const s = upper(source);
  if (!s) return null;

  const bracket = s.match(/\[([A-Z]{1,4}-?\d{1,3}[A-Z]?)\]/i);
  if (bracket) return normalizeSetId(bracket[1]);

  const tcg = s.match(/\b(OP|ST|EB|PRB|GC)-?(\d{1,3}[A-Z]?)\b/i);
  if (tcg) return normalizeSetId(`${tcg[1]}${tcg[2]}`);

  const alt = s.match(/\b([A-Z]{2,5}\d{1,3})\b/i);
  if (alt) return normalizeSetId(alt[1]);

  return null;
}

export const GAME_LABEL = GAME_LABELS;

export function gameLabel(game: Game): string {
  return GAME_LABELS[game];
}

const ACTIVE_GAME_KEY = "active_game";

export function setActiveGame(game: Game): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_GAME_KEY, game);
    }
  } catch {
    // ignore storage errors
  }
}

export function getActiveGame(): Game | null {
  try {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(ACTIVE_GAME_KEY);
    return isValidGame(v) ? v : null;
  } catch {
    return null;
  }
}

export function cardImage(
  game: string | null | undefined,
  code: string | null | undefined,
  image: string | null | undefined,
): string {
  return cardImageCandidates(game, code, image)[0] ?? "";
}

export function gameRouteSegment(game: Game): string {
  return GAME_ROUTE_SEGMENTS[game];
}

export function isValidGame(value: string | null | undefined): value is Game {
  return value === "onepiece" || value === "pokemon" || value === "yugioh";
}

export function proxiedImage(url: string | null | undefined): string {
  const src = clean(url);
  if (!src) return "";
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;
  return src;
}

export function cardImageCandidates(
  game: string | null | undefined,
  code: string | null | undefined,
  image: string | null | undefined
): string[] {
  const normalizedGame = clean(game).toLowerCase() as Game | "";
  const normalizedCode = normalizeCardCode(code);
  const imageUrl = clean(image);

  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    const v = proxiedImage(value);
    if (!v) return;
    if (!candidates.includes(v)) candidates.push(v);
  };

  push(imageUrl);

  if (!normalizedCode) return candidates;

  if (normalizedGame === "onepiece") {
    const dashed = normalizedCode.includes("-")
      ? normalizedCode
      : normalizedCode.replace(/^([A-Z]+)(\d+[A-Z]?)-(\d+)$/i, "$1-$2-$3");

    const compact = normalizedCode.replace(/\s+/g, "");
    const setPrefix = compact.split("-").slice(0, 2).join("-");
    const setCompact = normalizeSetId(setPrefix);
    const setDashed = onePieceDashedSetId(setCompact);

    push(`https://en.onepiece-cardgame.com/images/cardlist/card/${compact}.png`);
    push(`https://en.onepiece-cardgame.com/images/cardlist/card/${dashed}.png`);
    push(`https://www.apitcg.com/images/cards/one-piece/${compact}.jpg`);
    push(`https://www.apitcg.com/images/cards/one-piece/${compact}.png`);

    if (setCompact) {
      push(`https://en.onepiece-cardgame.com/images/cardlist/card/${setCompact}-001.png`);
      push(`https://en.onepiece-cardgame.com/images/cardlist/card/${setDashed}-001.png`);
    }
  }

  if (normalizedGame === "pokemon") {
    const compact = normalizedCode.replace(/\s+/g, "");
    push(`https://www.apitcg.com/images/cards/pokemon/${compact}.jpg`);
    push(`https://www.apitcg.com/images/cards/pokemon/${compact}.png`);
  }

  if (normalizedGame === "yugioh") {
    const compact = normalizedCode.replace(/\s+/g, "");
    push(`https://www.apitcg.com/images/cards/yugioh/${compact}.jpg`);
    push(`https://www.apitcg.com/images/cards/yugioh/${compact}.png`);
  }

  return candidates;
}

export function setImageCandidates(game: Game, setId: string, logo?: string | null): string[] {
  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    const v = proxiedImage(value);
    if (!v) return;
    if (!candidates.includes(v)) candidates.push(v);
  };

  const cleanId = normalizeSetId(setId);
  const dashedId = onePieceDashedSetId(setId);

  push(logo);

  if (game === "onepiece") {
    push(`https://www.apitcg.com/images/sets/one-piece/${cleanId}-logo.png`);
    push(`https://en.onepiece-cardgame.com/images/cardlist/card/${cleanId}-001.png`);
    push(`https://en.onepiece-cardgame.com/images/cardlist/card/${dashedId}-001.png`);
    push(`https://en.onepiece-cardgame.com/images/cardlist/card/${cleanId}-002.png`);
    push(`https://en.onepiece-cardgame.com/images/cardlist/card/${dashedId}-002.png`);
  }

  if (game === "pokemon") {
    push(`https://www.apitcg.com/images/sets/pokemon/${cleanId}-logo.png`);
  }

  if (game === "yugioh") {
    push(`https://www.apitcg.com/images/sets/yugioh/${cleanId}-logo.png`);
  }

  return candidates;
}

export function setIdForCard(
  game: Game,
  card: { set_id?: string | null; set_name?: string | null; code?: string | null }
): string | null {
  if (game === "pokemon" || game === "yugioh") {
    const normalized = normalizeSetId(card.set_id);
    return normalized || extractSetId(card.set_name) || extractSetId(card.code);
  }

  const direct = upper(card.set_id);
  if (direct) {
    const compositeTrimmed = direct.split("-EB")[0].split("-OP")[0];
    const normalized = normalizeSetId(compositeTrimmed);
    if (normalized) return normalized;
  }

  return extractSetId(card.set_name) || extractSetId(card.code);
}

export function cardMatchesSet(
  game: Game,
  card: { set_id?: string | null; set_name?: string | null; code?: string | null },
  setId: string
): boolean {
  const target = normalizeSetId(setId);
  const targetDashed = onePieceDashedSetId(setId);
  const cardSetId = normalizeSetId(card.set_id);
  const cardSetFromName = extractSetId(card.set_name);
  const cardCode = upper(card.code);

  if (game === "pokemon" || game === "yugioh") {
    return cardSetId === target || cardSetFromName === target;
  }

  if (cardSetId === target || cardSetFromName === target) return true;
  if (cardCode.startsWith(`${target}-`) || cardCode.startsWith(`${targetDashed}-`)) return true;

  return false;
}

export function cardSearchIndex(card: {
  name?: string | null;
  code?: string | null;
  number?: string | null;
  rarity?: string | null;
  set_name?: string | null;
  set_id?: string | null;
  type?: string | null;
  attribute?: string | null;
  color?: string | null;
}): string {
  return [
    card.name ?? "",
    card.code ?? "",
    card.number ?? "",
    card.rarity ?? "",
    card.set_name ?? "",
    card.set_id ?? "",
    card.type ?? "",
    card.attribute ?? "",
    card.color ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

export function cardDedupKey(card: {
  game?: string | null;
  code?: string | null;
  rarity?: string | null;
  set_id?: string | null;
  image_small?: string | null;
  image_large?: string | null;
}): string {
  return [
    clean(card.game).toLowerCase(),
    upper(card.code),
    upper(card.rarity),
    normalizeSetId(card.set_id),
    clean(card.image_small ?? card.image_large),
  ].join("::");
}
