// sync-cards: refreshes the card catalog for Pokémon, One Piece and Yu-Gi-Oh!.
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
const GAMES: Game[] = ["pokemon", "onepiece", "yugioh"];

const STEP_BUDGET_MS = 60_000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function upsertBatch(rows: any[]) {
  if (rows.length === 0) return 0;
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (!r.external_id) return false;
    const k = `${r.game}:${r.external_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
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
      console.error("[sync-cards] upsert chunk error", error.message);
    } else {
      total += slice.length;
    }
  }
  return total;
}

async function patchSummary(jobId: string, patch: Record<string, unknown>) {
  const { data } = await admin.from("sync_jobs").select("summary").eq("id", jobId).maybeSingle();
  const merged = { ...((data?.summary as any) ?? {}), ...patch };
  await admin.from("sync_jobs").update({ summary: merged }).eq("id", jobId);
}

async function finishJob(jobId: string, status: "succeeded" | "failed", error: string | null) {
  const { data } = await admin.from("sync_jobs").select("summary").eq("id", jobId).maybeSingle();
  const s = (data?.summary as any) ?? {};
  const total =
    (Number(s.pokemon) > 0 ? Number(s.pokemon) : 0) +
    (Number(s.onepiece) > 0 ? Number(s.onepiece) : 0) +
    (Number(s.yugioh) > 0 ? Number(s.yugioh) : 0);
  await admin.from("sync_jobs").update({
    status, total, error,
    summary: { ...s, _stage: "done" },
    finished_at: new Date().toISOString(),
  }).eq("id", jobId);
}

function chainStep(body: Record<string, unknown>) {
  const url = `${SUPABASE_URL}/functions/v1/sync-cards`;
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify(body),
  }).catch((e) => console.error("[sync-cards] chain failed", e));
}

async function stepPokemon(cursor: number, deadline: number) {
  let page = Math.max(1, cursor);
  let count = 0;
  const PAGE_SIZE = 250;
  while (Date.now() < deadline) {
    const url = `https://api.pokemontcg.io/v2/cards?page=${page}&pageSize=${PAGE_SIZE}&orderBy=number`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("[sync-cards] pokemon page", page, "status", res.status);
      return { done: true, count, cursor: page };
    }
    const json = await res.json();
    const data = json.data || [];
    if (data.length === 0) return { done: true, count, cursor: page };
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
      pokedex_number: Array.isArray(c.nationalPokedexNumbers) ? c.nationalPokedexNumbers[0] : null,
      data: c,
    }));
    count += await upsertBatch(rows);
    if (data.length < PAGE_SIZE) return { done: true, count, cursor: page + 1 };
    page++;
    await wait(100);
  }
  return { done: false, count, cursor: page };
}

async function stepOnePiece(cursor: number, deadline: number) {
  let page = Math.max(1, cursor);
  let count = 0;
  const LIMIT = 100;
  while (Date.now() < deadline) {
    const url = `https://www.apitcg.com/api/one-piece/cards?limit=${LIMIT}&page=${page}`;
    const res = await fetch(url, { headers: { "x-api-key": APITCG_KEY } });
    if (!res.ok) {
      console.error("[sync-cards] onepiece page", page, "status", res.status);
      return { done: true, count, cursor: page };
    }
    const json = await res.json();
    const data = json.data || [];
    if (data.length === 0) return { done: true, count, cursor: page };
    const rows = data.map((c: any) => {
      const code: string = c.code ?? c.id ?? "";
      // FIX: deriva set_id dal prefisso del code per correggere le alternate art
      // che dall'API ricevono il set_id del set originale invece di quello corretto
      const derivedSetId =
        code.match(/^([A-Z]{1,4}\d{1,3}[A-Z]?)-/i)?.[1]?.toUpperCase() ??
        c.set?.id ??
        c.set_id ??
        null;
      return {
        game: "onepiece",
        external_id: c.id ?? code,
        code,
        name: c.name,
        set_id: derivedSetId,
        set_name: c.set?.name ?? null,
        number: c.number ?? null,
        rarity: c.rarity ?? null,
        image_small: c.images?.small ?? c.image ?? null,
        image_large: c.images?.large ?? c.image ?? null,
        pokedex_number: null,
        data: c,
      };
    });
    count += await upsertBatch(rows);
    if (data.length < LIMIT) return { done: true, count, cursor: page + 1 };
    page++;
    await wait(100);
  }
  return { done: false, count, cursor: page };
}

async function stepYugioh(cursor: number, deadline: number) {
  const SLICE = 4000;
  const url = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
  const res = await fetch(url);
  if (!res.ok) {
    console.error("[sync-cards] yugioh status", res.status);
    return { done: true, count: 0, cursor };
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
        game: "yugioh", external_id: code, code, name: c.name,
        set_id: null, set_name: null, number: null, rarity: null,
        image_small: baseImageSmall, image_large: baseImage,
        pokedex_number: null, data: c,
      });
    } else {
      for (const p of printings) {
        rows.push({
          game: "yugioh", external_id: p.set_code, code: p.set_code,
          name: c.name,
          set_id: (p.set_code ?? "").split("-")[0] || null,
          set_name: p.set_name ?? null,
          number: (p.set_code ?? "").split("-")[1] ?? null,
          rarity: p.set_rarity ?? null,
          image_small: baseImageSmall, image_large: baseImage,
          pokedex_number: null, data: { ...c, _printing: p },
        });
      }
    }
  }

  let pos = Math.max(0, cursor);
  let count = 0;
  while (pos < rows.length && Date.now() < deadline) {
    const slice = rows.slice(pos, pos + SLICE);
    count += await upsertBatch(slice);
    pos += slice.length;
  }
  const done = pos >= rows.length;
  return { done, count, cursor: pos };
}

async function runStep(jobId: string, game: Game, cursor: number) {
  const deadline = Date.now() + STEP_BUDGET_MS;
  let result: { done: boolean; count: number; cursor: number };
  try {
    if (game === "pokemon") result = await stepPokemon(cursor, deadline);
    else if (game === "onepiece") result = await stepOnePiece(cursor, deadline);
    else result = await stepYugioh(cursor, deadline);
  } catch (e) {
    console.error("[sync-cards] step error", game, e);
    await finishJob(jobId, "failed", e instanceof Error ? e.message : String(e));
    return;
  }

  const { data } = await admin.from("sync_jobs").select("summary").eq("id", jobId).maybeSingle();
  const prev = ((data?.summary as any) ?? {}) as Record<string, unknown>;
  const prevCount = Number(prev[game] ?? 0);
  const newCount = (Number.isFinite(prevCount) ? prevCount : 0) + result.count;
  await patchSummary(jobId, { [game]: newCount, _stage: game });

  if (!result.done) {
    chainStep({ action: "step", jobId, game, cursor: result.cursor });
    return;
  }

  const idx = GAMES.indexOf(game);
  const next = GAMES[idx + 1];
  if (next) {
    chainStep({ action: "step", jobId, game: next, cursor: 0 });
  } else {
    await finishJob(jobId, "succeeded", null);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const isServiceCall = authHeader === `Bearer ${SERVICE_KEY}`;
    let triggeredBy: string | null = null;

    if (!isServiceCall) {
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace("Bearer ", "");
      const { data: claims, error: authError } = await userClient.auth.getClaims(token);
      if (authError || !claims?.claims?.sub) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      triggeredBy = claims.claims.sub as string;
      const { data: isAdmin } = await admin.rpc("has_role", {
        _user_id: triggeredBy, _role: "admin",
      });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "start";

    if (action === "step") {
      if (!isServiceCall) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { jobId, game, cursor } = body;
      if (!jobId || !GAMES.includes(game)) {
        return new Response(JSON.stringify({ error: "invalid step params" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: job } = await admin.from("sync_jobs").select("status").eq("id", jobId).maybeSingle();
      if (!job || job.status !== "running") {
        return new Response(JSON.stringify({ ok: false, reason: "job not running" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await runStep(jobId, game as Game, Number(cursor ?? 0));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // action === "start"
    // FIX: usa la funzione SQL già presente nel DB invece di una query inline
    await admin.rpc("cleanup_stuck_sync_jobs").catch((e) =>
      console.warn("[sync-cards] cleanup rpc failed", e)
    );

    const jobId = crypto.randomUUID();
    const { error: insertErr } = await admin.from("sync_jobs").insert({
      id: jobId,
      status: "running",
      triggered_by: triggeredBy,
      started_at: new Date().toISOString(),
      games: ["pokemon", "onepiece", "yugioh"],  // FIX: campo obbligatorio
      summary: { pokemon: 0, onepiece: 0, yugioh: 0, _stage: "pokemon" },
    });
    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    chainStep({ action: "step", jobId, game: GAMES[0], cursor: 0 });

    return new Response(JSON.stringify({ ok: true, jobId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[sync-cards] top-level error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
