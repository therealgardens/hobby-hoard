import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const games = new Set(["pokemon", "onepiece", "yugioh"]);

function requireGame(game: unknown) {
  if (typeof game !== "string" || !games.has(game)) throw new Error("Invalid game");
  return game;
}

function requireUuid(value: unknown, name: string) {
  if (typeof value !== "string" || !uuidRe.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableError(error: unknown) {
  const message = String((error as Error)?.message ?? error).toLowerCase();
  const code = String((error as { code?: string })?.code ?? "");
  // Empty error object from supabase-js usually indicates a transient fetch/network failure
  const isEmpty = !message && !code;
  return (
    isEmpty ||
    code === "57P02" || code === "57P03" || code === "57P01" ||
    code === "53300" || code === "08006" || code === "08001" || code === "08000" ||
    message.includes("schema cache") ||
    message.includes("recovery mode") ||
    message.includes("starting up") ||
    message.includes("unexpected eof") ||
    message.includes("fetch failed") ||
    message.includes("terminating connection") ||
    message.includes("network") ||
    message.includes("timeout")
  );
}

async function withRetry<T>(op: () => Promise<{ data: T | null; error: any }>, attempts = 5) {
  let lastError: any;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const { data, error } = await op();
      if (!error) return data as T;
      lastError = error;
      if (!isRetryableError(error) || i === attempts - 1) throw error;
    } catch (e) {
      lastError = e;
      if (!isRetryableError(e) || i === attempts - 1) throw e;
    }
    await wait(Math.min(500 * 2 ** i, 4000));
  }
  throw lastError;
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Not signed in" }, 401);
    const token = authHeader.replace("Bearer ", "").trim();

    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    const userId = claimsData?.claims?.sub;
    if (claimsError || !userId || !uuidRe.test(userId)) return json({ error: "Not signed in" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "list");

    if (action === "list") {
      const game = requireGame(body.game);
      const wanted = await withRetry(() =>
        admin.from("wanted_cards").select("*").eq("user_id", userId).eq("game", game).order("created_at", { ascending: false }),
      );
      const cardIds = Array.from(new Set((wanted ?? []).map((r: any) => r.card_id).filter(Boolean))) as string[];
      let cardsById = new Map<string, any>();
      if (cardIds.length) {
        const cards = await withRetry(() => admin.from("cards").select("*").in("id", cardIds));
        cardsById = new Map((cards ?? []).map((c: any) => [c.id, c]));
      }
      const items = (wanted ?? []).map((r: any) => ({ ...r, card: cardsById.get(r.card_id) ?? null }));
      return json({ items });
    }

    if (action === "status") {
      const cardIds = Array.isArray(body.cardIds)
        ? body.cardIds.filter((id: unknown) => typeof id === "string" && uuidRe.test(id))
        : [];
      if (!cardIds.length) return json({ cardIds: [] });
      const rows = await withRetry(() =>
        admin.from("wanted_cards").select("card_id").eq("user_id", userId).in("card_id", cardIds),
      );
      const set = new Set((rows ?? []).map((r: any) => r.card_id));
      return json({ cardIds: Array.from(set) });
    }

    if (action === "add") {
      const game = requireGame(body.game);
      const cardId = requireUuid(body.cardId, "card id");
      const quantity = Math.max(1, Number.parseInt(String(body.quantity ?? 1), 10) || 1);
      const binderId = body.binderId == null ? null : requireUuid(body.binderId, "binder id");
      const rarity = typeof body.rarity === "string" && body.rarity ? body.rarity : null;
      const language = typeof body.language === "string" && body.language ? body.language : "EN";

      const existing = await withRetry(() =>
        admin.from("wanted_cards").select("id").eq("user_id", userId).eq("card_id", cardId).eq("game", game).limit(1),
      );
      if (existing && existing.length) return json({ item: null });

      const inserted = await withRetry(() =>
        admin.from("wanted_cards").insert({
          user_id: userId, card_id: cardId, game, rarity, language, quantity, binder_id: binderId,
        }).select().single(),
      );
      return json({ item: inserted ?? null });
    }

    if (action === "remove") {
      if (body.id) {
        const id = requireUuid(body.id, "wishlist id");
        await withRetry(() => admin.from("wanted_cards").delete().eq("id", id).eq("user_id", userId).select());
      } else {
        const game = requireGame(body.game);
        const cardId = requireUuid(body.cardId, "card id");
        await withRetry(() =>
          admin.from("wanted_cards").delete().eq("user_id", userId).eq("card_id", cardId).eq("game", game).select(),
        );
      }
      return json({ ok: true });
    }

    if (action === "update") {
      const id = requireUuid(body.id, "wishlist id");
      const quantity = Math.max(1, Number.parseInt(String(body.quantity ?? 1), 10) || 1);
      await withRetry(() =>
        admin.from("wanted_cards").update({ quantity }).eq("id", id).eq("user_id", userId).select(),
      );
      return json({ ok: true });
    }

    throw new Error("Invalid wishlist action");
  } catch (e: any) {
    console.error("wishlist error", JSON.stringify({
      message: e?.message, code: e?.code, details: e?.details, hint: e?.hint, name: e?.name,
    }));
    const message = (e?.message && String(e.message)) || "Wishlist failed";
    return json({ error: isRetryableError(e) ? "Database is reconnecting. Please try again." : message }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
