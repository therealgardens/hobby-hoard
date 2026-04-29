// Card search proxy: searches Pokémon TCG API and One Piece TCG API,
// caches results into public.cards, and returns the cached rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SearchBody {
  game: "pokemon" | "onepiece" | "yugioh";
  query?: string;
  setId?: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryablePgError(error: any) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  return (
    code === "PGRST002" ||
    code === "PGRST001" ||
    code === "57P03" ||
    code === "57P01" ||
    code === "57P02" ||
    code === "53300" ||
    code.startsWith("08") ||
    msg.includes("schema cache") ||
    msg.includes("recovery mode") ||
    msg.includes("starting up") ||
    msg.includes("no connection") ||
    msg.includes("connection closed") ||
    msg.includes("retrying the connection")
  );
}

// Retry transient PostgREST/Postgres errors (schema cache reload, recovery, etc.)
async function withDbRetry<T extends { error: any }>(
  op: () => PromiseLike<T>,
  attempts = 5,
): Promise<T> {
  let last: T | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await op();
    if (!last.error || !isRetryablePgError(last.error) || i === attempts - 1) return last;
    await wait(400 * 2 ** i);
  }
  return last as T;
}

async function searchPokemon(query: string, setId?: string) {
  // https://docs.pokemontcg.io/
  const parts: string[] = [];
  if (setId) parts.push(`set.id:${setId}`);
  if (query) {
    const q = query.trim();
    if (/^[a-z0-9]+-\d+/i.test(q)) {
      parts.push(`id:${q.toLowerCase()}`);
    } else if (/^\d+$/.test(q)) {
      parts.push(`number:${q}`);
    } else {
      parts.push(`name:"${q}*"`);
    }
  }
  const pageSize = setId ? 250 : 40;
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(
    parts.join(" "),
  )}&pageSize=${pageSize}&orderBy=number`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pokemon API ${res.status}`);
  const json = await res.json();
  return (json.data || []).map((c: any) => ({
    game: "pokemon" as const,
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
}

// Map an optcgapi card row to our schema.
function mapOptcgCard(c: any) {
  const code = c.card_set_id ?? c.id ?? c.code;
  return {
    game: "onepiece" as const,
    external_id: code,
    code,
    name: c.card_name ?? c.name,
    set_id: c.set_id ?? null,
    set_name: c.set_name ?? null,
    number: null,
    rarity: c.rarity ?? null,
    image_small: c.card_image ?? null,
    image_large: c.card_image ?? null,
    pokedex_number: null,
    data: c,
  };
}

// Fetch a full set from optcgapi. Tries booster sets, then starter decks,
// and also resolves dual-ids like "OP14" -> "OP14-EB04" via /api/allSets/.
async function fetchOptcgSet(setId: string): Promise<any[]> {
  const upper = setId.toUpperCase();
  const dashed = upper.match(/^([A-Z]+)-?(\d+)$/);
  const candidates: string[] = [];
  if (dashed) {
    candidates.push(`${dashed[1]}-${dashed[2]}`); // OP-14
    candidates.push(`${dashed[1]}${dashed[2]}`);  // OP14
  } else {
    candidates.push(upper);
  }

  // Look up dual ids (e.g. "OP14-EB04") from /api/allSets/
  try {
    const res = await fetch("https://optcgapi.com/api/allSets/");
    if (res.ok) {
      const arr = await res.json();
      const norm = upper.replace(/-/g, "");
      for (const s of arr || []) {
        const raw = String(s.set_id || "").toUpperCase();
        if (!raw) continue;
        const head = raw.split("-EB")[0].split("-OP")[0].replace(/-/g, "");
        if (head === norm && !candidates.includes(raw)) candidates.push(raw);
      }
    }
  } catch (_) {}

  const isStarter = /^ST/i.test(setId);
  const tryEndpoints = (c: string) =>
    isStarter
      ? [`https://optcgapi.com/api/decks/${c}/`, `https://optcgapi.com/api/sets/${c}/`]
      : [`https://optcgapi.com/api/sets/${c}/`, `https://optcgapi.com/api/decks/${c}/`];

  for (const c of candidates) {
    for (const url of tryEndpoints(c)) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        if (Array.isArray(json) && json.length > 0) return json;
      } catch (_) {}
    }
  }
  return [];
}

function mapApitcgCard(c: any) {
  return {
    game: "onepiece" as const,
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
  };
}

// Fetch ALL variants of a card from optcgapi by base code (e.g. "OP01-001"
// returns the regular printing plus alt arts like "OP01-001_p1").
async function fetchOptcgCardVariants(baseCode: string): Promise<any[]> {
  try {
    const res = await fetch(`https://optcgapi.com/api/cards/${baseCode}/`);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json) ? json : [json];
  } catch {
    return [];
  }
}

// Free-text search on optcgapi by name (scans allCards endpoint).
async function searchOptcgByName(query: string): Promise<any[]> {
  try {
    const res = await fetch(`https://optcgapi.com/api/allCards/`);
    if (!res.ok) return [];
    const json = await res.json();
    const q = query.toLowerCase();
    return (json || []).filter((c: any) =>
      String(c.card_name ?? c.name ?? "").toLowerCase().includes(q),
    );
  } catch {
    return [];
  }
}

async function searchOnePiece(query: string, setId?: string) {
  // Set browse: merge results from BOTH apitcg AND optcgapi to capture every
  // card + every alternate art across both sources.
  if (setId) {
    const code = setId.toUpperCase().replace(/-/g, "");
    const merged: any[] = [];

    // apitcg (rich metadata + some alternates)
    try {
      const url = `https://www.apitcg.com/api/one-piece/cards?code=${code}&limit=250`;
      const res = await fetch(url, {
        headers: { "x-api-key": Deno.env.get("APITCG_API_KEY") ?? "" },
      });
      if (res.ok) {
        const json = await res.json();
        for (const c of json.data || []) merged.push(mapApitcgCard(c));
      }
    } catch (e) { console.error("apitcg setId error", e); }

    // optcgapi (full set coverage including newer sets and many variants)
    try {
      const arr = await fetchOptcgSet(setId);
      console.log("optcgapi returned", arr.length, "cards for", setId);
      for (const c of arr) merged.push(mapOptcgCard(c));
    } catch (e) { console.error("optcgapi setId error", e); }

    return merged;
  }

  // Free-text search: hit both APIs and merge.
  const merged: any[] = [];
  const q = query.trim();
  const isCode = /^[a-z]{2,4}\d{2,3}-\d+/i.test(q);

  // apitcg
  try {
    const params = new URLSearchParams();
    if (isCode) params.set("code", q.toUpperCase());
    else params.set("name", q);
    const url = `https://www.apitcg.com/api/one-piece/cards?${params.toString()}&limit=100`;
    const res = await fetch(url, {
      headers: { "x-api-key": Deno.env.get("APITCG_API_KEY") ?? "" },
    });
    if (res.ok) {
      const json = await res.json();
      for (const c of json.data || []) merged.push(mapApitcgCard(c));
    }
  } catch (e) { console.error("apitcg search error", e); }

  // optcgapi — by code (returns all variants) or by name scan
  try {
    if (isCode) {
      const base = q.toUpperCase().replace(/_.*$/, "");
      const arr = await fetchOptcgCardVariants(base);
      for (const c of arr) merged.push(mapOptcgCard(c));
    } else {
      const arr = await searchOptcgByName(q);
      for (const c of arr) merged.push(mapOptcgCard(c));
    }
  } catch (e) { console.error("optcgapi search error", e); }

  return merged;
}

// --- Yu-Gi-Oh! (YGOPRODeck, free public API) -----------------------------
// Each YGO card has multiple printings ("card_sets"). We explode each printing
// into its own row with the printing code as `code`/`external_id` so master
// sets and binders behave like the other games.
function explodeYugiohCard(c: any): any[] {
  const printings = Array.isArray(c.card_sets) ? c.card_sets : [];
  const baseImage = c.card_images?.[0]?.image_url ?? null;
  const baseImageSmall = c.card_images?.[0]?.image_url_small ?? null;
  if (printings.length === 0) {
    const code = `YGO-${c.id}`;
    return [{
      game: "yugioh" as const,
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
    }];
  }
  return printings.map((p: any) => ({
    game: "yugioh" as const,
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
  }));
}

async function searchYugioh(query: string, setId?: string) {
  const params = new URLSearchParams();
  if (setId) {
    // Look up the set name for this code, then query by it.
    try {
      const setRes = await fetch("https://db.ygoprodeck.com/api/v7/cardsets.php");
      if (setRes.ok) {
        const arr = await setRes.json();
        const match = (arr || []).find(
          (s: any) =>
            String(s.set_code || "").toUpperCase() === setId.toUpperCase() ||
            String(s.set_name || "").toUpperCase() === setId.toUpperCase(),
        );
        if (match?.set_name) params.set("cardset", match.set_name);
      }
    } catch (_) {}
    if (!params.has("cardset")) params.set("cardset", setId);
  } else {
    const q = query.trim();
    // YGO printing codes look like "LOB-001", "MRD-EN001"
    if (/^[A-Z]{2,4}-(?:[A-Z]{2})?\d{1,4}/i.test(q)) {
      // No code search endpoint; fall back to fname which scans names.
      params.set("fname", q);
    } else {
      params.set("fname", q);
    }
  }
  const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?${params.toString()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const cards = json?.data ?? [];
    const out: any[] = [];
    for (const c of cards) {
      const exploded = explodeYugiohCard(c);
      if (setId) {
        // When browsing a set, keep all printings of that set.
        const wantSet = setId.toUpperCase();
        out.push(...exploded.filter((p) =>
          (p.set_id ?? "").toUpperCase() === wantSet ||
          (p.code ?? "").toUpperCase().startsWith(wantSet + "-"),
        ));
      } else {
        // Free-text search: only show one row per unique card (first printing)
        // to avoid flooding results with every reprint of the same card.
        if (exploded.length > 0) out.push(exploded[0]);
      }
    }
    return out;
  } catch (e) {
    console.error("ygoprodeck error", e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Require an authenticated caller — this proxy uses a private API key
    // and writes to public.cards via the service role.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
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

    const body = (await req.json()) as SearchBody;
    if (!body?.game || !["pokemon", "onepiece", "yugioh"].includes(body.game)) {
      return new Response(JSON.stringify({ error: "invalid game" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const query = (body.query || "").trim();
    if (!query && !body.setId) {
      return new Response(JSON.stringify({ cards: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results =
      body.game === "pokemon"
        ? await searchPokemon(query, body.setId)
        : body.game === "onepiece"
        ? await searchOnePiece(query, body.setId)
        : await searchYugioh(query, body.setId);

    // Dedupe by external_id to avoid "ON CONFLICT cannot affect row a second time".
    const seen = new Set<string>();
    const deduped = results.filter((r) => {
      if (!r.external_id || seen.has(r.external_id)) return false;
      seen.add(r.external_id);
      return true;
    });

    if (deduped.length) {
      const { error } = await admin
        .from("cards")
        .upsert(deduped, { onConflict: "game,external_id" });
      if (error) console.error("upsert error", error);
    }

    const ids = deduped.map((r) => r.external_id);
    let cached: any[] = [];
    if (ids.length > 0) {
      // Batch the IN() lookup — PostgREST URLs cap out around ~2KB and large
      // sets (e.g. browsing a 250-card set) can exceed that, returning 0 rows.
      const BATCH = 60;
      for (let i = 0; i < ids.length; i += BATCH) {
        const slice = ids.slice(i, i + BATCH);
        const { data, error } = await admin
          .from("cards")
          .select("*")
          .eq("game", body.game)
          .in("external_id", slice);
        if (error) {
          console.error("cards lookup error", error);
          continue;
        }
        if (data?.length) cached.push(...data);
      }
      // NOTE: we deliberately do NOT synthesize fake UUIDs when the DB lookup
      // misses — the client uses `card.id` as a real UUID for inserts into
      // collection_entries / wanted_cards / chat_messages, so a fake id breaks
      // every subsequent write with a 22P02 error.
    } else if (body.setId && (body.game === "onepiece" || body.game === "yugioh")) {
      const id = body.setId.toUpperCase().replace(/-/g, "");
      const { data } = await admin
        .from("cards")
        .select("*")
        .eq("game", body.game)
        .ilike("code", `${id}-%`)
        .limit(500);
      cached = data ?? [];
    }

    return new Response(JSON.stringify({ cards: cached }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
