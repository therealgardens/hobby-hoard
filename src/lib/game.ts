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
// The proxy requires authentication, so we append the current session's
// access token as a query parameter (plain <img> tags cannot send headers).
import { supabase } from "@/integrations/supabase/client";

let cachedAccessToken: string | null = null;

// Initialize and keep the cached token in sync with the auth state.
supabase.auth.getSession().then(({ data }) => {
  cachedAccessToken = data.session?.access_token ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
  cachedAccessToken = session?.access_token ?? null;
});

// Hosts that block hotlinking via Cross-Origin-Resource-Policy and must
// be routed through our authenticated image-proxy edge function.
const HOSTS_REQUIRING_PROXY = new Set([
  "en.onepiece-cardgame.com",
  "asia-en.onepiece-cardgame.com",
  "assets.pokemon.com",
  "storage.googleapis.com",
]);

export function proxiedImage(url?: string | null): string | undefined {
  if (!url) return undefined;
  let host = "";
  try { host = new URL(url).hostname; } catch { return url; }
  if (!HOSTS_REQUIRING_PROXY.has(host)) return url;
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  if (!projectId) return url;
  const base = `https://${projectId}.supabase.co/functions/v1/image-proxy?url=${encodeURIComponent(url)}`;
  return cachedAccessToken
    ? `${base}&access_token=${encodeURIComponent(cachedAccessToken)}`
    : base;
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
  // Yu-Gi-Oh image URLs use the numeric card id, not the printing code.
  // We can't reconstruct the URL from `code`, so just rely on imageUrl above.
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
