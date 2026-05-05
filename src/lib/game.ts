export type Game = "pokemon" | "onepiece" | "yugioh";

const KEY = "tcg.activeGame";

export function getActiveGame(): Game | null {
  const v = localStorage.getItem(KEY);
  return v === "pokemon" || v === "onepiece" || v === "yugioh" ? v : null;
}
export function setActiveGame(g: Game) { localStorage.setItem(KEY, g); }
export function clearActiveGame() { localStorage.removeItem(KEY); }

export const GAME_LABEL: Record<Game, string> = {
  pokemon: "Pokémon",
  onepiece: "One Piece",
  yugioh: "Yu-Gi-Oh!",
};

import { supabase } from "@/integrations/supabase/client";

let cachedAccessToken: string | null = null;
supabase.auth.getSession().then(({ data }) => {
  cachedAccessToken = data.session?.access_token ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
  cachedAccessToken = session?.access_token ?? null;
});

// Hosts con CORS permissivo o CDN pubblico — carica direttamente senza proxy
const DIRECT_HOSTS = [
  "optcgapi.com",
  "images.ygoprodeck.com",
  "cdn.ygoprodeck.com",
  "en.onepiece-cardgame.com",
];

export function proxiedImage(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname;
    if (DIRECT_HOSTS.some((h) => host.endsWith(h))) return url;
  } catch (_) {}
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  if (!projectId) return url;
  const base = `https://${projectId}.supabase.co/functions/v1/image-proxy?url=${encodeURIComponent(url)}`;
  return cachedAccessToken
    ? `${base}&access_token=${encodeURIComponent(cachedAccessToken)}`
    : base;
}

export function cardImage(
  game: Game | string | null | undefined,
  code: string | null | undefined,
  imageUrl?: string | null,
): string | undefined {
  if (imageUrl) return proxiedImage(imageUrl);
  if (game === "onepiece" && code) {
    return proxiedImage(`https://en.onepiece-cardgame.com/images/cardlist/card/${code}.png`);
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
  return Array.from(new Set(urls)).map((url) => proxiedImage(url)).filter(Boolean) as string[];
}
