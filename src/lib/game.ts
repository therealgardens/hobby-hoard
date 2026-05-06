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

const DIRECT_HOSTS = [
  "optcgapi.com",
  ".supabase.co",
  ".supabase.in",
];

export function proxiedImage(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname;
    if (DIRECT_HOSTS.some((h) => host === h.replace(/^\./, "") || host.endsWith(h))) return url;
  } catch (_) { return url; }
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  if (!projectId) return url;
  const base = `https://${projectId}.supabase.co/functions/v1/image-proxy?url=${encodeURIComponent(url)}`;
  return cachedAccessToken
    ? `${base}&access_token=${encodeURIComponent(cachedAccessToken)}`
    : base;
}

// Costruisce l'URL immagine YGO da ID numerico (es. "10938846")
function ygoImageUrl(idOrCode: string): string {
  // Se è un ID puramente numerico usa l'API YGOPRODeck
  if (/^\d+$/.test(idOrCode)) {
    return `https://images.ygoprodeck.com/images/cards_small/${idOrCode}.jpg`;
  }
  // Altrimenti è un codice testuale (es. LEDE-EN001) — niente fallback URL disponibile
  return "";
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

  if (game === "yugioh" && code) {
    const url = ygoImageUrl(code);
    if (url) return proxiedImage(url);
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

  if (game === "yugioh" && code) {
    const url = ygoImageUrl(code);
    if (url) urls.push(url);
  }

  return Array.from(new Set(urls)).map((url) => proxiedImage(url)).filter(Boolean) as string[];
}
