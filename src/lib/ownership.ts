// Hooks/helpers per leggere e mutare il possesso (ownership) tramite la nuova tabella `ownership`.
// La UI può migrare incrementalmente da `collection_entries` a questo layer; nel frattempo i due restano
// sincronizzati dal trigger `sync_binder_to_ownership` (binder_entries → ownership) e dal trigger di compat
// `sync_binder_slot_to_collection` (binder_slots → collection_entries).

import { supabase } from "@/integrations/supabase/client";
import { withDbRetry } from "@/lib/supabaseRetry";

export interface OwnershipRow {
  id: string;
  user_id: string;
  printing_id: string;
  quantity: number;
  language: string;
  condition: string;
  notes: string | null;
}

/** Restituisce le ownership row di un utente per un set specifico (join client-side). */
export async function listOwnershipForSet(userId: string, game: string, setId: string): Promise<OwnershipRow[]> {
  // Step 1: prendo i printing_id appartenenti al set
  const { data: cards } = await withDbRetry(() =>
    supabase.from("cards").select("id").eq("game", game).eq("set_id", setId),
  );
  if (!cards?.length) return [];
  const cardIds = cards.map((c: any) => c.id);

  const { data: printings } = await withDbRetry(() =>
    (supabase as any).from("card_printings").select("id").in("card_id", cardIds),
  );
  if (!printings?.length) return [];
  const printingIds = (printings as any[]).map((p) => p.id);

  const { data: own } = await withDbRetry(() =>
    (supabase as any)
      .from("ownership")
      .select("id, user_id, printing_id, quantity, language, condition, notes")
      .eq("user_id", userId)
      .in("printing_id", printingIds),
  );
  return (own as OwnershipRow[]) ?? [];
}

/** Aggiunge una copia di una stampa (printing) al possesso. Idempotente via UPSERT. */
export async function addOwnership(
  userId: string,
  printingId: string,
  opts: { language?: string; condition?: string; quantity?: number } = {},
) {
  const language = opts.language ?? "EN";
  const condition = opts.condition ?? "NM";
  const quantity = Math.max(1, opts.quantity ?? 1);

  // Cerca esistente
  const { data: existing } = await (supabase as any)
    .from("ownership")
    .select("id, quantity")
    .eq("user_id", userId)
    .eq("printing_id", printingId)
    .eq("language", language)
    .eq("condition", condition)
    .maybeSingle();

  if (existing) {
    return await (supabase as any)
      .from("ownership")
      .update({ quantity: existing.quantity + quantity, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  }
  return await (supabase as any).from("ownership").insert({
    user_id: userId, printing_id: printingId, language, condition, quantity,
  });
}

/** Decrementa, mai sotto 0; rimuove la riga se quantity arriva a 0. */
export async function removeOwnership(userId: string, printingId: string, opts: { language?: string; condition?: string } = {}) {
  const language = opts.language ?? "EN";
  const condition = opts.condition ?? "NM";
  const { data: existing } = await (supabase as any)
    .from("ownership")
    .select("id, quantity")
    .eq("user_id", userId)
    .eq("printing_id", printingId)
    .eq("language", language)
    .eq("condition", condition)
    .maybeSingle();
  if (!existing) return { error: null };
  const next = Math.max(0, existing.quantity - 1);
  if (next === 0) {
    return await (supabase as any).from("ownership").delete().eq("id", existing.id);
  }
  return await (supabase as any).from("ownership").update({ quantity: next, updated_at: new Date().toISOString() }).eq("id", existing.id);
}
