// Returns the list of expansions/sets for a given game.
// Pokémon: from pokemontcg.io /sets endpoint.
// One Piece: from apitcg.com /one-piece/sets, augmented with sets observed
// in our local cards cache (since the public sets endpoint is incomplete).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

interface SetOut {
  id: string;       // canonical set id (e.g. "sv1", "OP14")
  name: string;     // human name (e.g. "Scarlet & Violet", "AZURE SEA SEVEN")
  series?: string | null;
  releaseDate?: string | null;
  total?: number | null;
  logo?: string | null;
}

async function pokemonSets(): Promise<SetOut[]> {
  const res = await fetch(
    "https://api.pokemontcg.io/v2/sets?pageSize=500&orderBy=-releaseDate",
  );
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    series: s.series ?? null,
    releaseDate: s.releaseDate ?? null,
    total: s.total ?? s.printedTotal ?? null,
    logo: s.images?.logo ?? s.images?.symbol ?? null,
  }));
}

// Try to extract a canonical set id like "OP14", "ST-21", "EB-02", "PRB-01"
// from a set_name string like "-AZURE SEA SEVEN- [OP14]".
function extractSetId(setName: string | null | undefined): string | null {
  if (!setName) return null;
  const m = setName.match(/\[([A-Z]{1,4}-?\d{1,3}[A-Z]?)\]/i);
  if (m) return m[1].toUpperCase().replace(/-/g, "");
  // Fallback: scan for a bare prefix
  const m2 = setName.match(/\b(OP|ST|EB|PRB|GC)-?(\d{1,3})\b/i);
  if (m2) return (m2[1] + m2[2]).toUpperCase();
  return null;
}

function cleanName(setName: string): string {
  return setName.replace(/\[[^\]]+\]/g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

async function onePieceSets(): Promise<SetOut[]> {
  const map = new Map<string, SetOut>();

  // Primary: optcgapi has the full set list
  try {
    const res = await fetch("https://optcgapi.com/api/allSets/");
    if (res.ok) {
      const arr = await res.json();
      for (const s of arr || []) {
        const raw = String(s.set_id || "").toUpperCase();
        if (!raw) continue;
        // Some entries are dual ids like "OP14-EB04" — keep the first canonical one
        const primary = raw.split("-EB")[0].split("-OP")[0];
        const id = primary.replace(/-/g, "");
        map.set(id, {
          id,
          name: s.set_name,
          series: null,
          releaseDate: null,
          total: null,
          logo: null,
        });
      }
    }
  } catch (_) {}

  // Augment with apitcg metadata (release date, totals, logo) when available
  try {
    const res = await fetch("https://www.apitcg.com/api/one-piece/sets", {
      headers: { "x-api-key": Deno.env.get("APITCG_API_KEY") ?? "" },
    });
    if (res.ok) {
      const json = await res.json();
      for (const s of json.data || []) {
        const id = String(s.id || "").toUpperCase().replace(/-/g, "");
        if (!id) continue;
        const existing = map.get(id);
        const enriched: SetOut = {
          id,
          name: existing?.name ?? s.name,
          series: s.series ?? null,
          releaseDate: s.release_date ?? null,
          total: s.total_cards ?? s.printed_total ?? null,
          logo: s.logo_url ? `https://www.apitcg.com${s.logo_url}` : null,
        };
        map.set(id, enriched);
      }
    }
  } catch (_) {}

  // Augment from DB cache (group cards by set_name -> canonical id)
  const { data } = await admin
    .from("cards")
    .select("set_name, code")
    .eq("game", "onepiece")
    .limit(5000);
  const counts = new Map<string, { name: string; total: number }>();
  for (const row of data || []) {
    const id = extractSetId(row.set_name) ?? extractSetId(row.code ?? "");
    if (!id) continue;
    const display = row.set_name ? cleanName(row.set_name) : id;
    const cur = counts.get(id) ?? { name: display, total: 0 };
    cur.total += 1;
    counts.set(id, cur);
  }
  for (const [id, info] of counts.entries()) {
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: info.name,
        series: null,
        releaseDate: null,
        total: null,
        logo: null,
      });
    }
  }

  // Probe known set-id ranges that aren't in /allSets/ (newer ST decks,
  // newer OP boosters, EB/PRB extras). We hit the /decks/ and /sets/
  // endpoints in parallel and add anything that returns a non-empty payload.
  const probeIds: string[] = [];
  for (let i = 1; i <= 35; i++) probeIds.push(`ST-${String(i).padStart(2, "0")}`);
  for (let i = 1; i <= 20; i++) probeIds.push(`OP-${String(i).padStart(2, "0")}`);
  for (let i = 1; i <= 6; i++) probeIds.push(`EB-${String(i).padStart(2, "0")}`);
  for (let i = 1; i <= 4; i++) probeIds.push(`PRB-${String(i).padStart(2, "0")}`);

  await Promise.all(
    probeIds.map(async (raw) => {
      const id = raw.replace(/-/g, "");
      if (map.has(id)) return; // already discovered
      const isStarter = /^ST/i.test(raw);
      const urls = isStarter
        ? [`https://optcgapi.com/api/decks/${raw}/`, `https://optcgapi.com/api/sets/${raw}/`]
        : [`https://optcgapi.com/api/sets/${raw}/`, `https://optcgapi.com/api/decks/${raw}/`];
      for (const url of urls) {
        try {
          const r = await fetch(url);
          if (!r.ok) continue;
          const j = await r.json();
          if (Array.isArray(j) && j.length > 0) {
            const setName = j[0]?.set_name || id;
            map.set(id, {
              id, name: setName, series: null, releaseDate: null, total: j.length, logo: null,
            });
            return;
          }
        } catch (_) {}
      }
    }),
  );

  // For sets without a logo, use the leader card image as a representative thumbnail.
  for (const s of map.values()) {
    if (!s.logo) {
      s.logo = `https://en.onepiece-cardgame.com/images/cardlist/card/${s.id}-001.png`;
    }
  }

  // Sort: newest by id family. ST first by number desc, then OP desc, then others.
  return Array.from(map.values()).sort((a, b) => b.id.localeCompare(a.id));
}

async function yugiohSets(): Promise<SetOut[]> {
  // YGOPRODeck — free, no API key required.
  const res = await fetch("https://db.ygoprodeck.com/api/v7/cardsets.php");
  if (!res.ok) return [];
  const arr = await res.json();
  // Some promotional codes (e.g. "LART" — The Lost Art Promotion) split a
  // single set across dozens of sub-entries that all share the same set_code.
  // Collapse them into one row per set_code, preferring the canonical
  // "(series)" entry when it exists, otherwise the entry with the most cards.
  const byCode = new Map<string, any>();
  for (const s of arr || []) {
    const code = String(s.set_code || s.set_name || "").toUpperCase();
    if (!code) continue;
    const existing = byCode.get(code);
    if (!existing) { byCode.set(code, s); continue; }
    const existingIsSeries = /\(series\)/i.test(String(existing.set_name || ""));
    const newIsSeries = /\(series\)/i.test(String(s.set_name || ""));
    if (newIsSeries && !existingIsSeries) { byCode.set(code, s); continue; }
    if (existingIsSeries && !newIsSeries) continue;
    if ((s.num_of_cards ?? 0) > (existing.num_of_cards ?? 0)) byCode.set(code, s);
  }
  return Array.from(byCode.values())
    .map((s: any) => ({
      id: String(s.set_code || s.set_name).toUpperCase(),
      // Strip the "(series)" suffix from the display name.
      name: String(s.set_name).replace(/\s*\(series\)\s*$/i, "").trim(),
      series: null,
      releaseDate: s.tcg_date ?? null,
      total: s.num_of_cards ?? null,
      logo: s.set_image ?? null,
    }))
    .filter((s: SetOut) => s.id && s.name)
    .sort((a: SetOut, b: SetOut) =>
      (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""),
    );
}

// In-memory cache (per edge function instance) — sets lists rarely change,
// so cache for 30 minutes to make subsequent loads instant.
const _setsCache: Record<string, { at: number; data: SetOut[] }> = {};
const SETS_TTL_MS = 30 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Set lists are public data — no auth required.
    const url = new URL(req.url);
    const game = url.searchParams.get("game");
    if (game !== "pokemon" && game !== "onepiece" && game !== "yugioh") {
      return new Response(JSON.stringify({ error: "invalid game" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const cached = _setsCache[game];
    if (cached && Date.now() - cached.at < SETS_TTL_MS) {
      return new Response(JSON.stringify({ sets: cached.data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sets =
      game === "pokemon" ? await pokemonSets()
      : game === "onepiece" ? await onePieceSets()
      : await yugiohSets();
    if (sets.length > 0) _setsCache[game] = { at: Date.now(), data: sets };
    return new Response(JSON.stringify({ sets }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
