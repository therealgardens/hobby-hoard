import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

function isRetryableBackendError(error: unknown) {
  const message = String((error as Error)?.message ?? error).toLowerCase();
  const code = String((error as { code?: string })?.code ?? "");
  return (
    code === "57P02" ||
    code === "57P03" ||
    code === "57P01" ||
    code === "53300" ||
    code === "08006" ||
    code === "08001" ||
    code === "08000" ||
    code === "PGRST001" ||
    code === "PGRST002" ||
    message.includes("recovery mode") ||
    message.includes("starting up") ||
    message.includes("schema cache") ||
    message.includes("database client error") ||
    message.includes("no connection to the server") ||
    message.includes("retrying") ||
    message.includes("unexpectedeof") ||
    message.includes("unexpected eof") ||
    message.includes("unexpected end of file") ||
    message.includes("failed to fetch") ||
    message.includes("tls close_notify") ||
    message.includes("peer closed connection") ||
    message.includes("terminating connection") ||
    message.includes("connection")
  );
}

async function withRetry<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableBackendError(error) || i === attempts - 1) throw error;
      await wait(Math.min(400 * 2 ** i, 3000));
    }
  }
  throw lastError;
}

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

    const dbClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "list");

    if (action === "list") {
      const game = requireGame(body.game);
      const rows = await withRetry(async () => {
        const { data, error } = await dbClient
          .from("wanted_cards")
          .select("id,user_id,card_id,game,rarity,language,quantity,binder_id,created_at,card:cards(id,game,external_id,code,name,set_id,set_name,number,rarity,image_small,image_large,pokedex_number,data,created_at)")
          .eq("user_id", userId)
          .eq("game", game)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
      });
      return json({ items: rows });
    }

    if (action === "status") {
      const cardIds = Array.isArray(body.cardIds)
        ? body.cardIds.filter((id: unknown) => typeof id === "string" && uuidRe.test(id))
        : [];
      if (!cardIds.length) return json({ cardIds: [] });
      const wantedIds = await withRetry(async () => {
        const { data, error } = await dbClient
          .from("wanted_cards")
          .select("card_id")
          .eq("user_id", userId)
          .in("card_id", cardIds);
        if (error) throw error;
        return Array.from(new Set((data ?? []).map((row) => row.card_id)));
      });
      return json({ cardIds: wantedIds });
    }

    if (action === "add") {
      const game = requireGame(body.game);
      const cardId = requireUuid(body.cardId, "card id");
      const quantity = Math.max(1, Number.parseInt(String(body.quantity ?? 1), 10) || 1);
      const binderId = body.binderId == null ? null : requireUuid(body.binderId, "binder id");
      const rarity = typeof body.rarity === "string" && body.rarity ? body.rarity : null;
      const language = typeof body.language === "string" && body.language ? body.language : "EN";

      const item = await withRetry(async () => {
        const { data: existing, error: existingError } = await dbClient
          .from("wanted_cards")
          .select("*")
          .eq("user_id", userId)
          .eq("card_id", cardId)
          .eq("game", game)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing) return existing;

        const { data, error } = await dbClient
          .from("wanted_cards")
          .insert({ user_id: userId, card_id: cardId, game, rarity, language, quantity, binder_id: binderId })
          .select("*")
          .single();
        if (error) throw error;
        return data;
      });
      return json({ item });
    }

    if (action === "remove") {
      if (body.id) {
        const id = requireUuid(body.id, "wishlist id");
        await withRetry(async () => {
          const { error } = await dbClient.from("wanted_cards").delete().eq("id", id).eq("user_id", userId);
          if (error) throw error;
        });
      } else {
        const game = requireGame(body.game);
        const cardId = requireUuid(body.cardId, "card id");
        await withRetry(async () => {
          const { error } = await dbClient.from("wanted_cards").delete().eq("user_id", userId).eq("card_id", cardId).eq("game", game);
          if (error) throw error;
        });
      }
      return json({ ok: true });
    }

    if (action === "update") {
      const id = requireUuid(body.id, "wishlist id");
      const quantity = Math.max(1, Number.parseInt(String(body.quantity ?? 1), 10) || 1);
      await withRetry(async () => {
        const { error } = await dbClient.from("wanted_cards").update({ quantity }).eq("id", id).eq("user_id", userId);
        if (error) throw error;
      });
      return json({ ok: true });
    }

    throw new Error("Invalid wishlist action");
  } catch (e) {
    console.error("wishlist error", e);
    const retryable = isRetryableBackendError(e);
    const message = e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Wishlist failed";
    return json({ error: retryable ? "Database is reconnecting. Please try again." : message }, retryable ? 503 : 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}