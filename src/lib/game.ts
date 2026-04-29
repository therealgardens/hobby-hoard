export type Game = "pokemon" | "onepiece" | "yugioh";

const KEY = "tcg.activeGame";

export function getActiveGame(): Game | null {
  const v = localStorage.getItem(KEY);
  return v === "pokemon" || v === "onepiece" || v === "yugioh" ? v : null;
}

export function setActiveGame(g: Game) {
  localStorage.setItem(KEY, g);
}

export function clearActiveGame() {
  localStorage.removeItem(KEY);
}

export const GAME_LABEL: Record<Game, string> = {
  pokemon: "Pokémon",
  onepiece: "One Piece",
  yugioh: "Yu-Gi-Oh!",
};

// Wraps an external image URL through our edge proxy so the browser can
// load it (some CDNs send Cross-Origin-Resource-Policy: same-site).
export function proxiedImage(url?: string | null): string | undefined {
  if (!url) return undefined;
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  if (!projectId) return url;
  return `https://${projectId}.supabase.co/functions/v1/image-proxy?url=${encodeURIComponent(url)}`;
}

// Resolve a card image URL. For One Piece cards, falls back to the official
// CDN (via our proxy) when we don't have an image cached yet.
export function cardImage(
  game: Game | string | null | undefined,
  code: string | null | undefined,
  imageUrl?: string | null,
): string | undefined {
  if (imageUrl) return proxiedImage(imageUrl);
  if (game === "onepiece" && code) {
    return proxiedImage(`https://en.onepiece-cardgame.com/images/cardlist/card/${code}.png`);
  }
  if (game === "yugioh" && code) {
    return proxiedImage(`https://images.ygoprodeck.com/images/cards/${code}.jpg`);
  }
  return undefined;
}

export function cardImageCandidates(
  game: Game | string | null | undefined,
  code: string | null | undefined,
  imageUrl?: string | null,
): string[] {
  const urls: string[] = [];
  if (imageUrl) urls.push(imageUrl);
  if (game === "onepiece" && code) {
    urls.push(`https://en.onepiece-cardgame.com/images/cardlist/card/${code}.png`);
    urls.push(`https://en.onepiece-cardgame.com/images/cardlist/card/${code.replace(/_p\d+$/i, "")}.png`);
  }
  // Yu-Gi-Oh: image URLs come from the API (numeric card id, not printing code),
  // so we rely solely on the stored imageUrl.
  return Array.from(new Set(urls)).map((url) => proxiedImage(url)).filter(Boolean) as string[];
}
