import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APITCG_KEY = Deno.env.get("APITCG_API_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

type Game = "pokemon" | "onepiece" | "yugioh";
const GAMES: Game[] = ["pokemon", "onepiece", "yugioh"];
const STEP_BUDGET_MS = 55_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function upsertBatch(rows: any[]) {
  if (rows.length === 0) return 0;
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (!r.external_id) return false;
    if (!r.name || String(r.name).trim() === "") return false;
    if (!r.image_small && !r.image_large) return false;
    const k = `${r.game}:${r.external_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const CHUNK = 100;
  let total = 0;
  for (let i = 0; i < deduped.length; i += CHUNK) {
    const slice = deduped.slice(i, i + CHUNK);
    let attempt = 0;
    while (attempt < 4) {
      const { error } = await admin.from("cards").upsert(slice, {
        onConflict: "game,external_id",
        defaultToNull: false,
      });
      if (!error) { total += slice.length; break; }
      const msg = String(error.message ?? "").toLowerCase();
      const retriable = msg.includes("timeout") || msg.includes("statement") || msg.includes("connection") || msg.includes("recovery");
      console.error("[sync-cards] upsert error", error.message, "attempt", attempt);
      if (!retriable || attempt === 3) break;
      attempt++;
      await wait(500 * 2 ** attempt);
    }
  }
  return total;
}

async function finishJob(jobId: string, status: "succeeded" | "failed", error: string | null) {
  const { data } = await admin.from("sync_jobs").select("summary").eq("id", jobId).maybeSingle();
  const s = (data?.summary as any) ?? {};
  const total = (Number(s.pokemon) || 0) + (Number(s.onepiece) || 0) + (Number(s.yugioh) || 0);
  await admin.from("sync_jobs").update({
    status, total, error,
    summary: { ...s, _stage: "done" },
    finished_at: new Date().toISOString(),
  }).eq("id", jobId);
}

function chainStep(body: Record<string, unknown>) {
  fetch(`${SUPABASE_URL}/functions/v1/sync-cards`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify(body),
  }).catch((e) => console.error("[sync-cards] chain failed", e));
}

function mapPokemonCard(c: any) {
  return {
    game: "pokemon", external_id: c.id, code: c.id, name: c.name,
    set_id: c.set?.id ?? null, set_name: c.set?.name ?? null,
    number: c.number ?? null, rarity: c.rarity ?? null,
    image_small: c.images?.small ?? null, image_large: c.images?.large ?? null,
    pokedex_number: Array.isArray(c.nationalPokedexNumbers) ? c.nationalPokedexNumbers[0] : null,
    data: c,
  };
}

async function stepPokemon(cursor: number, deadline: number) {
  let page = Math.max(1, cursor);
  let count = 0;
  const PAGE_SIZE = 250;
  while (Date.now() < deadline) {
    const res = await fetch(
      `https://api.pokemontcg.io/v2/cards?page=${page}&pageSize=${PAGE_SIZE}&orderBy=id`,
    );
    if (!res.ok) return { done: true, count, cursor: page };
    const json = await res.json();
    const data = json.data || [];
    if (data.length === 0) {
      try { count += await augmentPokemonFromTcgdex(deadline); }
      catch (e) { console.warn("[sync-cards] tcgdex augment failed", e); }
      return { done: true, count, cursor: page };
    }
    count += await upsertBatch(data.map(mapPokemonCard));
    if (data.length < PAGE_SIZE) {
      try { count += await augmentPokemonFromTcgdex(deadline); }
      catch (e) { console.warn("[sync-cards] tcgdex augment failed", e); }
      return { done: true, count, cursor: page + 1 };
    }
    page++;
    await wait(150);
  }
  return { done: false, count, cursor: page };
}

async function augmentPokemonFromTcgdex(deadline: number): Promise<number> {
  const setsRes = await fetchWithTimeout("https://api.tcgdex.net/v2/en/sets", 8000).catch(() => null);
  if (!setsRes || !setsRes.ok) return 0;
  const sets: any[] = await setsRes.json().catch(() => []);
  let count = 0;
  for (const s of sets) {
    if (Date.now() > deadline) break;
    const setId = String(s.id || "").toLowerCase();
    if (!setId) continue;
    const r = await fetchWithTimeout(`https://api.tcgdex.net/v2/en/sets/${setId}`, 6000).catch(() => null);
    if (!r || !r.ok) continue;
    const setData: any = await r.json().catch(() => null);
    if (!setData?.cards?.length) continue;
    const rows = setData.cards.map((c: any) => {
      const externalId = `tcgdex-${setId}-${c.localId ?? c.id}`;
      const img = c.image ? `${c.image}/low.png` : null;
      const imgLarge = c.image ? `${c.image}/high.png` : null;
      return {
        game: "pokemon",
        external_id: externalId,
        code: externalId,
        name: c.name,
        set_id: setId,
        set_name: setData.name ?? s.name ?? null,
        number: String(c.localId ?? ""),
        rarity: c.rarity ?? null,
        image_small: img,
        image_large: imgLarge,
        pokedex_number: null,
        data: { ...c, _source: "tcgdex", _set: { id: setId, name: setData.name } },
      };
    });
    count += await upsertBatch(rows);
    await wait(60);
  }
  return count;
}

async function fetchWithTimeout(url: string, ms = 8000, init?: RequestInit) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function appendVariantSuffixToUrl(url: string | null | undefined, suffix: string): string | null {
  if (!url || !suffix) return url ?? null;
  if (url.includes(`_${suffix}.`) || url.includes(`_${suffix}_`)) return url;
  return url.replace(/(\.[a-zA-Z0-9]+)(\?|$)/, `_${suffix}$1$2`);
}

function extractVariantSuffix(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = String(id).match(/_([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

function mapOptcgCard(c: any) {
  const code: string = c.id ?? c.set_id ?? "";
  if (!code) return null;
  const derivedSetId =
    code.match(/^([A-Z]{1,4}\d{1,3}[A-Z]?)-/i)?.[1]?.toUpperCase() ?? null;

  const suffix = extractVariantSuffix(c.id);
  const isAltArt = !!suffix || c.is_alternate || c.variant;
  const altImg = c.images?.alternate ?? c.alternate_art_url ?? c.image_url_alternate ?? null;
  const normalImg = c.images?.small ?? c.images?.large ?? c.image_url ?? null;
  let image = isAltArt && altImg ? altImg : (normalImg ?? altImg);
  if (suffix && image) image = appendVariantSuffixToUrl(image, suffix);

  return {
    game: "onepiece",
    external_id: c.id ? String(c.id) : code,
    code,
    name: c.name,
    set_id: derivedSetId,
    set_name: c.set_name ?? null,
    number: c.card_number ?? null,
    rarity: c.rarity ?? null,
    image_small: image,
    image_large: image,
    pokedex_number: null,
    data: c,
  };
}

async function stepOnePiece(cursor: number, deadline: number) {
  let page = Math.max(1, cursor);
  let count = 0;
  const LIMIT = 100;
  while (Date.now() < deadline) {
    const res = await fetchWithTimeout(
      `https://www.apitcg.com/api/one-piece/cards?limit=${LIMIT}&page=${page}`,
      8000,
      { headers: { "x-api-key": APITCG_KEY } }
    ).catch(() => null);
    if (!res || !res.ok) return { done: true, count, cursor: page };
    const json = await res.json();
    const data = json.data || [];
    if (data.length === 0) return { done: true, count, cursor: page };
    const rows = data.map((c: any) => {
      const code: string = c.code ?? c.id ?? "";
      const derivedSetId =
        code.match(/^([A-Z]{1,4}\d{1,3}[A-Z]?)-/i)?.[1]?.toUpperCase() ??
        c.set?.id ?? c.set_id ?? null;

      const suffix = extractVariantSuffix(c.id ?? c.code);
      const isSpecial = !!suffix || (c.variant_type && c.variant_type !== "Regular") || c.is_special || c.is_alternate;
      const variantImg = c.images?.alternate || c.images?.parallel || c.images?.special || c.image_url_alternate || c.alternate_image;
      const baseImg = c.images?.large ?? c.images?.small ?? c.image ?? null;
      let finalImg = isSpecial && variantImg ? variantImg : (baseImg ?? variantImg);
      if (suffix && finalImg) finalImg = appendVariantSuffixToUrl(finalImg, suffix);

      return {
        game: "onepiece",
        external_id: c.id ? String(c.id) : code,
        code,
        name: c.name,
        set_id: derivedSetId,
        set_name: c.set?.name ?? null,
        number: c.number ?? null,
        rarity: c.rarity ?? null,
        image_small: finalImg,
        image_large: finalImg,
        pokedex_number: null,
        data: c,
      };
    });
    count += await upsertBatch(rows);
    if (data.length < LIMIT) {
      try {
        count += await augmentOnePieceFromOptcg(deadline);
      } catch (e) { console.warn("[sync-cards] optcg augment failed", e); }
      return { done: true, count, cursor: page + 1 };
    }
    page++;
    await wait(150);
  }
  return { done: false, count, cursor: page };
}

async function augmentOnePieceFromOptcg(deadline: number): Promise<number> {
  const allRes = await fetchWithTimeout("https://optcgapi.com/api/allSets/", 8000).catch(() => null);
  if (!allRes || !allRes.ok) return 0;
  const sets: any[] = await allRes.json().catch(() => []);
  const setIds = Array.from(new Set(
    (sets || [])
      .map((s) => String(s.set_id || "").toUpperCase())
      .filter(Boolean)
      .map((raw) => raw.split("-EB")[0].split("-OP")[0]),
  ));
  let count = 0;
  for (const sid of setIds) {
    if (Date.now() > deadline) break;
    const urls = /^ST/.test(sid)
      ? [`https://optcgapi.com/api/decks/${sid}/`, `https://optcgapi.com/api/sets/${sid}/`]
      : [`https://optcgapi.com/api/sets/${sid}/`, `https://optcgapi.com/api/decks/${sid}/`];
    let cards: any[] = [];
    for (const url of urls) {
      try {
        const r = await fetchWithTimeout(url, 6000);
        if (!r.ok) continue;
        const j = await r.json();
        if (Array.isArray(j) && j.length) { cards = j; break; }
      } catch (_) { /* try next */ }
    }
    if (!cards.length) continue;
    const rows = cards.map(mapOptcgCard).filter(Boolean) as any[];
    count += await upsertBatch(rows);
    await wait(80);
  }
  return count;
}

async function stepYugioh(cursor: number, deadline: number) {
  const SLICE = 3000;
  const res = await fetch("https://db.ygoprodeck.com/api/v7/cardinfo.php");
  if (!res.ok) return { done: true, count: 0, cursor };
  const json = await res.json();
  const cards = json?.data ?? [];
  const rows: any[] = [];
  for (const c of cards) {
    const printings = Array.isArray(c.card_sets) ? c.card_sets : [];
    const baseImageSmall = c.card_images?.[0]?.image_url_small ?? null;
    const baseImage = c.card_images?.[0]?.image_url ?? null;
    if (printings.length === 0) {
      rows.push({
        game: "yugioh", external_id: `YGO-${c.id}`, code: `YGO-${c.id}`,
        name: c.name, set_id: null, set_name: null, number: null, rarity: null,
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
    count += await upsertBatch(rows.slice(pos, pos + SLICE));
    pos += SLICE;
  }
  return { done: pos >= rows.length, count, cursor: pos };
}

async function runStep(jobId: string, game: Game, cursor: number, prevCount: number) {
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

  const newCount = prevCount + result.count;
  try {
    await admin.rpc("increment_sync_summary", {
      job_id: jobId,
      game_key: game,
      delta: result.count,
    });
  } catch (_) {
    const { data } = await admin.from("sync_jobs").select("summary").eq("id", jobId).maybeSingle();
    const s = (data?.summary as any) ?? {};
    await admin.from("sync_jobs").update({
      summary: { ...s, [game]: newCount, _stage: game },
    }).eq("id", jobId);
  }

  if (!result.done) {
    chainStep({ action: "step", jobId, game, cursor: result.cursor, prevCount: newCount });
    return;
  }

  const idx = GAMES.indexOf(game);
  const next = GAMES[idx + 1];
  if (next) {
    chainStep({ action: "step", jobId, game: next, cursor: 0, prevCount: 0 });
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
      const { jobId, game, cursor, prevCount } = body;
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
      await runStep(jobId, game as Game, Number(cursor ?? 0), Number(prevCount ?? 0));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try { await admin.rpc("cleanup_stuck_sync_jobs"); } catch (_) {}

    const jobId = crypto.randomUUID();
    const { error: insertErr } = await admin.from("sync_jobs").insert({
      id: jobId,
      status: "running",
      triggered_by: triggeredBy,
      started_at: new Date().toISOString(),
      games: ["pokemon", "onepiece", "yugioh"],
      summary: { pokemon: 0, onepiece: 0, yugioh: 0, _stage: "pokemon" },
    });
    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    chainStep({ action: "step", jobId, game: GAMES[0], cursor: 0, prevCount: 0 });

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
