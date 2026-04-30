import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { Game } from "@/lib/game";
import { withFunctionRetry } from "@/lib/supabaseRetry";

export type WishlistItem = Tables<"wanted_cards"> & { card: Tables<"cards"> | null };

export async function listWishlist(game: Game): Promise<WishlistItem[]> {
  const data = await withFunctionRetry<{ items: WishlistItem[] }>(() =>
    supabase.functions.invoke("wishlist", { body: { action: "list", game } }),
  );
  return data.items ?? [];
}

export async function wishlistStatus(cardIds: string[]): Promise<Set<string>> {
  const data = await withFunctionRetry<{ cardIds: string[] }>(() =>
    supabase.functions.invoke("wishlist", { body: { action: "status", cardIds } }),
  );
  return new Set(data.cardIds ?? []);
}

export async function addWishlist(
  card: Tables<"cards">,
  game: Game,
  extra: Partial<Tables<"wanted_cards">> = {},
) {
  await withFunctionRetry(() =>
    supabase.functions.invoke("wishlist", {
      body: {
        action: "add",
        game,
        cardId: card.id,
        rarity: extra.rarity ?? card.rarity ?? null,
        language: extra.language ?? "EN",
        quantity: extra.quantity ?? 1,
        binderId: extra.binder_id ?? null,
      },
    }),
  );
}

export async function removeWishlistByCard(cardId: string, game: Game) {
  await withFunctionRetry(() =>
    supabase.functions.invoke("wishlist", { body: { action: "remove", cardId, game } }),
  );
}

export async function removeWishlistById(id: string) {
  await withFunctionRetry(() =>
    supabase.functions.invoke("wishlist", { body: { action: "remove", id } }),
  );
}

export async function updateWishlistQuantity(id: string, quantity: number) {
  await withFunctionRetry(() =>
    supabase.functions.invoke("wishlist", { body: { action: "update", id, quantity } }),
  );
}
