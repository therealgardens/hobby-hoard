// sync-cards: fetches the full card catalog for Pokémon, One Piece and Yu-Gi-Oh!
// and upserts it into public.cards. Designed to run daily via pg_cron and also
// callable on-demand from the Settings page.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APITCG_KEY = Deno.env.get("APITCG_API_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

type Game = "pokemon" | "onepiece" | "yugioh";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function upsertBatch(rows: any[]) {
  if (rows.length === 0) return 0;
  // Dedupe by external_id within the batch
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (!r.external_id || seen.has(`${r.game}:${r.external_id}`)) return false;
    seen.add(`${r.game}:${r.external_id}`);
    return true;
  });
  const CHUNK = 500;
  let total = 0;
  for (let i = 0; i < deduped.length; i += CHUNK) {
    const slice = deduped.slice(i, i + CHUNK);
    const { error } = await admin.from("cards").upsert(slice, {
      onConflict: "game,external_id",
      defaultToNull: false,
    });
    if (error) {
      console.error("upsert chunk error", error);
    } else {
      total += slice.length;
    }
  }
  return total;
}

// ----------------------- Pokémon TCG -----------------------
async function syncPokemon(): Promise<number> {
  let page = 1;
  const pageSize = 250;
  let total = 0;
  while (true) {
    const url = `https://api.pokemontcg.io/v2/cards?page=${page}&pageSize=${pageSize}&orderBy=number`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("pokemon page", page, "status", res.status);
      break;
    }
    const json = await res.json();
    const data = json.data || [];
    if (data.length === 0) break;
    const rows = data.map((c: any) => ({
      game: "pokemon",
      external_id: c.id,
      code: c.id,
      name: c.name,
      set_id: c.set?.id ?? null,
      set_name: c.set?.name ?? null,
      number: c.number ?? null,
      rarity: c.rarity ?? null,
      image_small: c.images?.small ?? null,
      image_large: c.images?.large ?? null,
      pokedex_number: Array.isArray(c.nationalPokedexNumbers)
        ? c.nationalPokedexNumbers[0]
        : null,
      data: c,
    }));
    total += await upsertBatch(rows);
    if (data.length < pageSize) break;
    page++;
    await wait(150);
  }
  return total;
}

// ----------------------- One Piece (apitcg) -----------------------
async function syncOnePiece(): Promise<number> {
  let page = 1;
  const limit = 100;
  let total = 0;
  while (true) {
    const url = `https://www.apitcg.com/api/one-piece/cards?limit=${limit}&page=${page}`;
    const res = await fetch(url, {
      headers: { "x-api-key": APITCG_KEY },
    });
    if (!res.ok) {
      console.error("onepiece page", page, "status", res.status);
      break;
    }
    const json = await res.json();
    const data = json.data || [];
    if (data.length === 0) break;
    const rows = data.map((c: any) => ({
      game: "onepiece",
      external_id: c.id ?? c.code,
      code: c.code ?? c.id,
      name: c.name,
      set_id: c.set?.id ?? c.set_id ?? null,
      set_name: c.set?.name ?? null,
      number: c.number ?? null,
      rarity: c.rarity ?? null,
      image_small: c.images?.small ?? c.image ?? null,
      image_large: c.images?.large ?? c.image ?? null,
      pokedex_number: null,
      data: c,
    }));
    total += await upsertBatch(rows);
    if (data.length < limit) break;
    page++;
    await wait(150);
  }
  return total;
}

// ----------------------- Yu-Gi-Oh! (ygoprodeck) -----------------------
async function syncYugioh(): Promise<number> {
  const url = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
  const res = await fetch(url);
  if (!res.ok) {
    console.error("yugioh status", res.status);
    return 0;
  }
  const json = await res.json();
  const cards = json?.data ?? [];
  const rows: any[] = [];
  for (const c of cards) {
    const printings = Array.isArray(c.card_sets) ? c.card_sets : [];
    const baseImage = c.card_images?.[0]?.image_url ?? null;
    const baseImageSmall = c.card_images?.[0]?.image_url_small ?? null;
    if (printings.length === 0) {
      const code = `YGO-${c.id}`;
      rows.push({
        game: "yugioh",
        external_id: code,
        code,
        name: c.name,
        set_id: null,
        set_name: null,
        number: null,
        rarity: null,
        image_small: baseImageSmall,
        image_large: baseImage,
        pokedex_number: null,
        data: c,
      });
    } else {
      for (const p of printings) {
        rows.push({
          game: "yugioh",
          external_id: p.set_code,
          code: p.set_code,
          name: c.name,
          set_id: (p.set_code ?? "").split("-")[0] || null,
          set_name: p.set_name ?? null,
          number: (p.set_code ?? "").split("-")[1] ?? null,
          rarity: p.set_rarity ?? null,
          image_small: baseImageSmall,
          image_large: baseImage,
          pokedex_number: null,
          data: { ...c, _printing: p },
        });
      }
    }
  }
  return await upsertBatch(rows);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authorization: allow either the service role key (used by sync-scheduler /
    // pg_cron) or an authenticated user with the 'admin' role (manual trigger
    // from the Settings page). Reject everyone else — this endpoint is
    // expensive and bypasses RLS via the service role.
    const authHeader = req.headers.get("Authorization") ?? "";
    const isServiceCall = authHeader === `Bearer ${SERVICE_KEY}`;
    if (!isServiceCall) {
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace("Bearer ", "");
      const { data: claims, error: authError } = await userClient.auth.getClaims(token);
      if (authError || !claims?.claims?.sub) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: isAdmin, error: roleError } = await admin.rpc("has_role", {
        _user_id: claims.claims.sub,
        _role: "admin",
      });
      if (roleError || !isAdmin) {
        return new Response(
          JSON.stringify({ error: "Forbidden: admin role required" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    let games: Game[] = ["pokemon", "onepiece", "yugioh"];
    let waitForResult = false;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (Array.isArray(body?.games) && body.games.length) {
          games = body.games.filter((g: string) =>
            ["pokemon", "onepiece", "yugioh"].includes(g),
          ) as Game[];
        }
        if (body?.wait === true) waitForResult = true;
      }
    } catch {/* ignore */}

    const runSync = async () => {
      const startedAt = Date.now();
      const summary: Record<string, number> = {};
      for (const g of games) {
        try {
          console.log(`[sync-cards] starting ${g}`);
          if (g === "pokemon") summary.pokemon = await syncPokemon();
          else if (g === "onepiece") summary.onepiece = await syncOnePiece();
          else if (g === "yugioh") summary.yugioh = await syncYugioh();
          console.log(`[sync-cards] ${g} done: ${summary[g]} rows`);
        } catch (e) {
          console.error("[sync-cards] error", g, e);
          summary[g] = -1;
        }
      }
      const elapsedMs = Date.now() - startedAt;
      const total = Object.values(summary).reduce((a, b) => a + Math.max(0, b), 0);
      console.log(`[sync-cards] complete in ${elapsedMs}ms, total=${total}`, summary);
      return { ok: true, elapsedMs, total, summary };
    };

    if (waitForResult) {
      const result = await runSync();
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Run in background so the HTTP request returns immediately, avoiding
    // edge-function wall-clock / CPU timeouts on the ~50k-row catalog.
    // @ts-ignore - EdgeRuntime is provided by Supabase edge runtime.
    EdgeRuntime.waitUntil(runSync());
    return new Response(
      JSON.stringify({
        ok: true,
        accepted: true,
        message: "Sync started in the background. It usually finishes within 1–3 minutes.",
        games,
      }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );</parameter>
</invoke>
  } catch (e) {
    console.error("sync-cards fatal", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
