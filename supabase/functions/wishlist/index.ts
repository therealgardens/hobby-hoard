import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.1";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DB_URL = Deno.env.get("SUPABASE_DB_URL")!;

const createSql = () => postgres(DB_URL, { max: 1, prepare: false, ssl: "require" });
let sql: any = createSql();

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

function isRetryableDbError(error: unknown) {
  const message = String((error as Error)?.message ?? error).toLowerCase();
  const code = String((error as { code?: string })?.code ?? "");
  return (
    code === "57P02" ||
    code === "57P03" || // cannot_connect_now / recovery mode
    code === "57P01" || // admin_shutdown
    code === "53300" || // too_many_connections
    code === "08006" || // connection_failure
    code === "08001" || // sqlclient_unable_to_establish_sqlconnection
    code === "08000" ||
    message.includes("recovery mode") ||
    message.includes("starting up") ||
    message.includes("unexpectedeof") ||
    message.includes("unexpected eof") ||
    message.includes("tls close_notify") ||
    message.includes("peer closed connection") ||
    message.includes("terminating connection") ||
    message.includes("connection")
  );
}

async function withDb<T>(operation: (db: typeof sql) => Promise<T>, attempts = 6) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await operation(sql);
    } catch (error) {
      lastError = error;
      if (!isRetryableDbError(error) || i === attempts - 1) throw error;
      const old = sql;
      sql = createSql();
      try {
        await old.end({ timeout: 0 });
      } catch (_) {}
      await wait(Math.min(500 * 2 ** i, 4000));
    }
  }
  throw lastError;
}

type DbRow = Record<string, any>;

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
      const rows = await withDb<DbRow[]>((db) => db`
        select
          w.id, w.user_id, w.card_id, w.game, w.rarity, w.language, w.quantity, w.binder_id, w.created_at,
          case when c.id is null then null else jsonb_build_object(
            'id', c.id,
            'game', c.game,
            'external_id', c.external_id,
            'code', c.code,
            'name', c.name,
            'set_id', c.set_id,
            'set_name', c.set_name,
            'number', c.number,
            'rarity', c.rarity,
            'image_small', c.image_small,
            'image_large', c.image_large,
            'pokedex_number', c.pokedex_number,
            'data', c.data,
            'created_at', c.created_at
          ) end as card
        from public.wanted_cards w
        left join public.cards c on c.id = w.card_id
        where w.user_id = ${userId}::uuid and w.game = ${game}
        order by w.created_at desc
      `);
      return json({ items: rows });
    }

    if (action === "status") {
      const cardIds = Array.isArray(body.cardIds)
        ? body.cardIds.filter((id: unknown) => typeof id === "string" && uuidRe.test(id))
        : [];
      if (!cardIds.length) return json({ cardIds: [] });
      const rows = await withDb<DbRow[]>((db) => db`
        select distinct card_id
        from public.wanted_cards
        where user_id = ${userId}::uuid and card_id in ${db(cardIds)}
      `);
      return json({ cardIds: rows.map((row) => row.card_id) });
    }

    if (action === "add") {
      const game = requireGame(body.game);
      const cardId = requireUuid(body.cardId, "card id");
      const quantity = Math.max(1, Number.parseInt(String(body.quantity ?? 1), 10) || 1);
      const binderId = body.binderId == null ? null : requireUuid(body.binderId, "binder id");
      const rarity = typeof body.rarity === "string" && body.rarity ? body.rarity : null;
      const language = typeof body.language === "string" && body.language ? body.language : "EN";

      const rows = await withDb<DbRow[]>((db) => db`
        insert into public.wanted_cards (user_id, card_id, game, rarity, language, quantity, binder_id)
        select ${userId}::uuid, ${cardId}::uuid, ${game}, ${rarity}, ${language}, ${quantity}, ${binderId}::uuid
        where not exists (
          select 1 from public.wanted_cards
          where user_id = ${userId}::uuid and card_id = ${cardId}::uuid and game = ${game}
        )
        returning *
      `);
      return json({ item: rows[0] ?? null });
    }

    if (action === "remove") {
      if (body.id) {
        const id = requireUuid(body.id, "wishlist id");
        await withDb((db) => db`delete from public.wanted_cards where id = ${id}::uuid and user_id = ${userId}::uuid`);
      } else {
        const game = requireGame(body.game);
        const cardId = requireUuid(body.cardId, "card id");
        await withDb((db) => db`delete from public.wanted_cards where user_id = ${userId}::uuid and card_id = ${cardId}::uuid and game = ${game}`);
      }
      return json({ ok: true });
    }

    if (action === "update") {
      const id = requireUuid(body.id, "wishlist id");
      const quantity = Math.max(1, Number.parseInt(String(body.quantity ?? 1), 10) || 1);
      await withDb((db) => db`
        update public.wanted_cards
        set quantity = ${quantity}
        where id = ${id}::uuid and user_id = ${userId}::uuid
      `);
      return json({ ok: true });
    }

    throw new Error("Invalid wishlist action");
  } catch (e) {
    console.error("wishlist error", e);
    const message = e instanceof Error ? e.message : "Wishlist failed";
    return json({ error: isRetryableDbError(e) ? "Database is reconnecting. Please try again." : message }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}