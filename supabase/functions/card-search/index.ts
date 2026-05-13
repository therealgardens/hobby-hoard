// card-search: searches the local cards table only. The catalog is kept fresh
// by the daily sync-cards job (and the manual sync button in Settings).
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
const POKEMONTCG_API_KEY = Deno.env.get("POKEMONTCG_API_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function escapePgPattern(s: string) {
  return s.replace(/[%_,()]/g, (m) => `\\${m}`);
}

// Fetch with hard timeout — secondary sources must never hang the function.
async function fetchWithTimeout(url: string, ms = 8000, init?: RequestInit) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Heuristic: a One Piece card is "alt art" if its code carries a parallel
// suffix (e.g. "OP01-001_p1") or its rarity is one of the alt-art markers.
function isOpAltArt(c: any): boolean {
  const code = String(c?.code ?? "").toUpperCase();
  if (/_P\d+$/.test(code)) return true;
  const rarity = String(c?.rarity ?? "").toUpperCase();
  return rarity === "AA" || rarity === "SP" || rarity === "MR";
}

// Live fallback to pokemontcg.io for vintage / un-synced Pokémon cards.
async function pokemonLiveSearch(name: string): Promise<any[]> {
  try {
    const safe = name.replace(/"/g, "").trim();
    if (!safe) return [];
    const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(`name:"${safe}*"`)}&pageSize=60&orderBy=-set.releaseDate`;
    const headers: Record<string, string> = {};
    if (POKEMONTCG_API_KEY) headers["X-Api-Key"] = POKEMONTCG_API_KEY;
    const res = await fetchWithTimeout(url, 8000, { headers });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data ?? []).map((c: any) => ({
      // Use the upstream id as a STRING — frontend treats this as live-only data.
      id: c.id,
      external_id: c.id,
      code: c.id,
      name: c.name,
      game: "pokemon",
      set_id: c.set?.id ?? null,
      set_name: c.set?.name ?? null,
      number: c.number ?? null,
      rarity: c.rarity ?? null,
      image_small: c.images?.small ?? null,
      image_large: c.images?.large ?? null,
      pokedex_number: Array.isArray(c.nationalPokedexNumbers) ? c.nationalPokedexNumbers[0] : null,
      data: c,
    }));
  } catch (e) {
    console.warn("pokemonLiveSearch failed", e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
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
    const setId = body.setId?.trim();

    if (!query && !setId) {
      return new Response(JSON.stringify({ cards: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Browse a whole set.
    if (setId && !query) {
      const id = setId.toUpperCase().replace(/-/g, "");
      const dashed = id.replace(/^([A-Z]+)(\d+)$/, "$1-$2");

      let dbQuery = admin
        .from("cards")
        .select("*")
        .eq("game", body.game)
        .order("code", { ascending: true })
        .limit(500);

      if (body.game === "onepiece") {
        // Per One Piece usa SOLO il code — il set_id non è affidabile per
        // alternate art e reprint che conservano il set_id del set originale
        dbQuery = dbQuery.or(`code.ilike.${id}-%,code.ilike.${dashed}-%`);
      } else {
        dbQuery = dbQuery.or(
          `set_id.ilike.${id},set_id.ilike.${dashed},code.ilike.${id}-%,code.ilike.${dashed}-%`
        );
      }

      const { data, error } = await dbQuery;
      if (error) {
        console.error("set browse error", error);
        return new Response(JSON.stringify({ cards: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ cards: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Free-text search by name OR code.
    const term = escapePgPattern(query);
    let q = admin
      .from("cards")
      .select("*")
      .eq("game", body.game)
      .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
      .order("name", { ascending: true })
      .limit(60);

    if (setId) {
      const id = setId.toUpperCase().replace(/-/g, "");
      const dashed = id.replace(/^([A-Z]+)(\d+)$/, "$1-$2");
      if (body.game === "onepiece") {
        q = q.or(`code.ilike.${id}-%,code.ilike.${dashed}-%`);
      } else {
        q = q.or(`set_id.ilike.${id},set_id.ilike.${dashed},code.ilike.${id}-%,code.ilike.${dashed}-%`);
      }
    }

    const { data, error } = await q;
    if (error) {
      console.error("search error", error);
      return new Response(JSON.stringify({ cards: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ cards: data ?? [] }), {
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
