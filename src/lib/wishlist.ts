import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { Game } from "@/lib/game";

export type WishlistItem = Tables<"wanted_cards"> & { card: Tables<"cards"> | null };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableWishlistError(error: unknown) {
  const message = String((error as Error)?.message ?? error).toLowerCase();
  return (
    message.includes("database is reconnecting") ||
    message.includes("recovery mode") ||
    message.includes("starting up") ||
    message.includes("unexpected eof") ||
    message.includes("tls close_notify") ||
    message.includes("peer closed connection") ||
    message.includes("terminating connection")
  );
}

async function invokeWishlist<T>(action: string, payload: Record<string, unknown> = {}) {
  let lastError: unknown;
  for (let i = 0; i < 4; i += 1) {
    const { data, error } = await supabase.functions.invoke("wishlist", {
      body: { action, ...payload },
    });
    lastError = error ?? (data?.error ? new Error(data.error) : null);
    if (!lastError) return data as T;
    if (!isRetryableWishlistError(lastError) || i === 3) break;
    await wait(500 * 2 ** i);
  }
  throw lastError;
}

export async function listWishlist(game: Game) {
  const data = await invokeWishlist<{ items: WishlistItem[] }>("list", { game });
  return data.items ?? [];
}

export async function wishlistStatus(cardIds: string[]) {
  const data = await invokeWishlist<{ cardIds: string[] }>("status", { cardIds });
  return new Set(data.cardIds ?? []);
}

export async function addWishlist(card: Tables<"cards">, game: Game, extra: Partial<Tables<"wanted_cards">> = {}) {
  await invokeWishlist("add", {
    game,
    cardId: card.id,
    rarity: extra.rarity ?? card.rarity ?? null,
    language: extra.language ?? "EN",
    quantity: extra.quantity ?? 1,
    binderId: extra.binder_id ?? null,
  });
}

export async function removeWishlistByCard(cardId: string, game: Game) {
  await invokeWishlist("remove", { cardId, game });
}

export async function removeWishlistById(id: string) {
  await invokeWishlist("remove", { id });
}

export async function updateWishlistQuantity(id: string, quantity: number) {
  await invokeWishlist("update", { id, quantity });
}