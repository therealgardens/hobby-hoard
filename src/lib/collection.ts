// Single source of truth for "I own this card" / "I want this card" actions.
// Every entry point (Search, Master Sets, Binder owned-add) MUST go through here
// so the rules stay consistent:
//
//   addOwnedCard(card, game, qty?)  -> inserts into collection_entries.
//                                       Master Set ownership is derived from this.
//   addWantedCard(card, game)       -> inserts into wanted_cards (wishlist).
//   removeOneOwned(card, game)      -> deletes the most-recent collection_entry.
//
// Binder slots marked as "wanted" call addWantedCard. Binder slots marked as
// "owned" call addOwnedCard. That's the entire pipeline.

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { Game } from "@/lib/game";
import { withDbRetry } from "@/lib/supabaseRetry";
import { addWishlist, removeWishlistByCard } from "@/lib/wishlist";

type CardRow = Tables<"cards">;

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

export async function addOwnedCard(
  card: CardRow,
  game: Game,
  opts: { quantity?: number; language?: string; rarity?: string | null } = {},
) {
  const userId = await requireUserId();
  const { error } = await withDbRetry(() =>
    supabase.from("collection_entries").insert({
      user_id: userId,
      card_id: card.id,
      game,
      rarity: opts.rarity ?? card.rarity ?? null,
      language: opts.language ?? "EN",
      quantity: Math.max(1, opts.quantity ?? 1),
    }),
  );
  if (error) throw new Error(error.message);
}

export async function removeOneOwned(card: CardRow, game: Game) {
  const userId = await requireUserId();
  const { data: rows, error: selErr } = await withDbRetry(() =>
    supabase
      .from("collection_entries")
      .select("id")
      .eq("user_id", userId)
      .eq("game", game)
      .eq("card_id", card.id)
      .order("created_at", { ascending: false })
      .limit(1),
  );
  if (selErr) throw new Error(selErr.message);
  const target = rows?.[0]?.id;
  if (!target) return false;
  const { error } = await withDbRetry(() =>
    supabase.from("collection_entries").delete().eq("id", target),
  );
  if (error) throw new Error(error.message);
  return true;
}

export async function addWantedCard(card: CardRow, game: Game) {
  await addWishlist(card, game);
}

export async function removeWantedCard(card: CardRow, game: Game) {
  await removeWishlistByCard(card.id, game);
}
