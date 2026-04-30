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

// Split a free-text query like "yamato eb04" into a name part and an optional
// set hint. A token is treated as a set hint when it looks like a TCG set code
// (2–4 letters optionally followed by 1–3 digits, e.g. "eb04", "op14", "st28",
// "sv1", "lob", "me1"). Pure printing codes like "op01-001" are left in the
// name part so the caller's existing code-detection still triggers.
function splitQuery(query: string): { name: string; setHint: string | null } {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return { name: query.trim(), setHint: null };
  let setHint: string | null = null;
  const nameTokens: string[] = [];
  for (const t of tokens) {
    const isPrintingCode = /-/.test(t); // e.g. op01-001, lob-en001
    const looksLikeSet = !isPrintingCode && /^[a-z]{2,4}\d{0,3}$/i.test(t) && /[a-z]/i.test(t);
    if (looksLikeSet && !setHint) {
      setHint = t;
    } else {
      nameTokens.push(t);
    }
  }
  return { name: nameTokens.join(" ").trim(), setHint };
}

async function searchPokemon(query: string, setId?: string) {
  // https://docs.pokemontcg.io/
  const parts: string[] = [];
  let effectiveSetId = setId;
  let q = query.trim();
  if (!setId && q) {
    const split = splitQuery(q);
    if (split.setHint) {
      effectiveSetId = split.setHint.toLowerCase();
      q = split.name;
    }
  }
  if (effectiveSetId) parts.push(`set.id:${effectiveSetId}`);
  if (q) {
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

// Cache for optcgapi /allSets/ — used to resolve dual ids like OP14 -> OP14-EB04.
let _optcgAllSetsCache: { at: number; data: any[] } | null = null;
async function getOptcgAllSetsCached(): Promise<any[]> {
  const now = Date.now();
  if (_optcgAllSetsCache && now - _optcgAllSetsCache.at < 10 * 60 * 1000) {
    return _optcgAllSetsCache.data;
  }
  try {
    const res = await fetch("https://optcgapi.com/api/allSets/");
    if (!res.ok) return _optcgAllSetsCache?.data ?? [];
    const arr = await res.json();
    _optcgAllSetsCache = { at: now, data: arr };
    return arr;
  } catch {
    return _optcgAllSetsCache?.data ?? [];
  }
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

  // Look up dual ids (e.g. "OP14-EB04") from the cached /allSets/ list
  const arr = await getOptcgAllSetsCached();
  const norm = upper.replace(/-/g, "");
  for (const s of arr || []) {
    const raw = String(s.set_id || "").toUpperCase();
    if (!raw) continue;
    const head = raw.split("-EB")[0].split("-OP")[0].replace(/-/g, "");
    if (head === norm && !candidates.includes(raw)) candidates.push(raw);
  }

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

// optcgapi has no name-search endpoint; free-text One Piece search relies on
// apitcg only (this function is kept as a no-op stub for compatibility).
async function searchOptcgByName(_query: string): Promise<any[]> {
  return [];
}

// Cache for ygoprodeck cardsets (used to translate set codes -> set names).
// In-memory cache lives for the lifetime of the edge function instance.
let _ygoSetsCache: { at: number; data: any[] } | null = null;
async function getYugiohSetsCached(): Promise<any[]> {
  const now = Date.now();
  if (_ygoSetsCache && now - _ygoSetsCache.at < 10 * 60 * 1000) return _ygoSetsCache.data;
  try {
    const res = await fetch("https://db.ygoprodeck.com/api/v7/cardsets.php");
    if (!res.ok) return _ygoSetsCache?.data ?? [];
    const arr = await res.json();
    _ygoSetsCache = { at: now, data: arr };
    return arr;
  } catch {
    return _ygoSetsCache?.data ?? [];
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
  const rawQ = query.trim();
  const isCode = /^[a-z]{2,4}\d{2,3}-\d+/i.test(rawQ);
  // Allow "<name> <setHint>" e.g. "yamato eb04" — split into a name + set filter.
  const split = isCode ? { name: rawQ, setHint: null as string | null } : splitQuery(rawQ);
  const q = split.name || rawQ;
  const setFilter = split.setHint ? split.setHint.toUpperCase().replace(/-/g, "") : null;

  // apitcg
  try {
    const params = new URLSearchParams();
    if (isCode) params.set("code", q.toUpperCase());
    else params.set("name", q);
    if (setFilter) params.set("code", setFilter);
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
      const base = rawQ.toUpperCase().replace(/_.*$/, "");
      const arr = await fetchOptcgCardVariants(base);
      for (const c of arr) merged.push(mapOptcgCard(c));
    } else {
      const arr = await searchOptcgByName(q);
      for (const c of arr) merged.push(mapOptcgCard(c));
    }
  } catch (e) { console.error("optcgapi search error", e); }

  // If a set hint was provided, filter merged results to that set.
  const filtered = setFilter
    ? merged.filter((c) => {
        const code = String(c.code ?? "").toUpperCase().replace(/-/g, "");
        const setId = String(c.set_id ?? "").toUpperCase().replace(/-/g, "");
        return code.startsWith(setFilter) || setId === setFilter;
      })
    : merged;

  return filtered;
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
  let effectiveSetId = setId;
  let q = query.trim();

  // Allow "<name> <setHint>" e.g. "dark magician lob"
  if (!effectiveSetId && q && !/^[A-Z]{2,4}-(?:[A-Z]{2})?\d{1,4}/i.test(q)) {
    const split = splitQuery(q);
    if (split.setHint) {
      effectiveSetId = split.setHint.toUpperCase();
      q = split.name;
    }
  }

  if (effectiveSetId) {
    // Look up the set name for this code, then query by it. Prefer the
    // canonical "(series)" entry when one exists (Yu-Gi-Oh splits some
    // promotional codes like "LART" across many sub-sets that share the
    // same set_code).
    try {
      const arr = await getYugiohSetsCached();
      const want = effectiveSetId!.toUpperCase();
      const matches = (arr || []).filter(
        (s: any) =>
          String(s.set_code || "").toUpperCase() === want ||
          String(s.set_name || "").toUpperCase() === want,
      );
      const preferred =
        matches.find((s: any) => /\(series\)/i.test(String(s.set_name || ""))) ??
        matches.sort((a: any, b: any) => (b.num_of_cards ?? 0) - (a.num_of_cards ?? 0))[0];
      if (preferred?.set_name) params.set("cardset", preferred.set_name);
    } catch (_) {}
    if (!params.has("cardset")) params.set("cardset", effectiveSetId);
    if (q) params.set("fname", q);
  } else {
    params.set("fname", q);
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
      if (effectiveSetId) {
        // When browsing/filtering by a set, keep all printings of that set.
        const wantSet = effectiveSetId.toUpperCase();
        out.push(...exploded.filter((p) =>
          (p.set_id ?? "").toUpperCase() === wantSet ||
          (p.code ?? "").toUpperCase().startsWith(wantSet + "-"),
        ));
      } else {
        // Free-text search: return ALL printings of each matching card so
        // users can find reprints across every expansion (e.g. PGL2, YGLD).
        out.push(...exploded);
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
    const deduped = results.filter((r: any) => {
      if (!r.external_id || seen.has(r.external_id)) return false;
      seen.add(r.external_id);
      return true;
    });

    if (deduped.length) {
      const { error } = await withDbRetry(() =>
        admin.from("cards").upsert(deduped, { onConflict: "game,external_id" }),
      );
      if (error) console.error("upsert error", error);
    }

    const ids = deduped.map((r: any) => r.external_id);
    let cached: any[] = [];
    if (ids.length > 0) {
      // Batch the IN() lookup — PostgREST URLs cap out around ~2KB and large
      // sets (e.g. browsing a 250-card set) can exceed that, returning 0 rows.
      const BATCH = 60;
      for (let i = 0; i < ids.length; i += BATCH) {
        const slice = ids.slice(i, i + BATCH);
        const { data, error } = await withDbRetry(() =>
          admin
            .from("cards")
            .select("*")
            .eq("game", body.game)
            .in("external_id", slice),
        );
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
