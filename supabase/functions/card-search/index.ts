// supabase/functions/card-search/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function upper(value: string | null | undefined): string {
  return clean(value).toUpperCase();
}

function normalizeSetId(value: string | null | undefined): string {
  return upper(value).replace(/[^A-Z0-9]/g, "");
}

function normalizeCardCode(value: string | null | undefined): string {
  return upper(value).replace(/\s+/g, "");
}

function setCodePrefixes(setId: string): string[] {
  const normalized = normalizeSetId(setId);
  if (!normalized) return [];
  const variants = new Set<string>([normalized]);

  const m = normalized.match(/^([A-Z]+)(\d+[A-Z]?)$/);
  if (m) {
    variants.add(`${m[1]}-${m[2]}`);
  }

  return Array.from(variants);
}

function cardBelongsToSet(
  game: "pokemon" | "onepiece" | "yugioh",
  card: { set_id?: string | null; set_name?: string | null; code?: string | null },
  setId: string
): boolean {
  const target = normalizeSetId(setId);
  if (!target) return false;

  const cardSetId = normalizeSetId(card.set_id);
  const code = normalizeCardCode(card.code);
  const codePrefix = code.split("-")[0];
  const compactPrefixMatch = code.startsWith(target);
  const dashedPrefixMatch = !!codePrefix && normalizeSetId(codePrefix) === target;

  if (game === "onepiece") {
    return dashedPrefixMatch || compactPrefixMatch;
  }

  if (cardSetId === target) return true;
  if (dashedPrefixMatch || compactPrefixMatch) return true;

  const setName = upper(card.set_name);
  return setName.includes(target);
}

function escapePgPattern(s: string) {
  return s.replace(/[%_,()]/g, (m) => `\\${m}`);
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

function isOpAltArt(c: any): boolean {
  const code = String(c?.code ?? "").toUpperCase();
  if (/_P\d+$/.test(code)) return true;
  const rarity = String(c?.rarity ?? "").toUpperCase();
  return rarity === "AA" || rarity === "SP" || rarity === "MR";
}

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

    const query = clean(body.query);
    const setId = clean(body.setId);

    if (!query && !setId) {
      return new Response(JSON.stringify({ cards: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (setId && !query) {
      const prefixes = setCodePrefixes(setId);

      const { data, error } = await admin
        .from("cards")
        .select("*")
        .eq("game", body.game)
        .order("code", { ascending: true })
        .limit(3000);

      if (error) {
        console.error("set browse error", error);
        return new Response(JSON.stringify({ cards: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cards = (data ?? []).filter((card: any) => {
        if (cardBelongsToSet(body.game, card, setId)) return true;
        const code = normalizeCardCode(card.code);
        return prefixes.some((prefix) => code.startsWith(prefix));
      });

      return new Response(JSON.stringify({ cards }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const term = escapePgPattern(query);
    const { data, error } = await admin
      .from("cards")
      .select("*")
      .eq("game", body.game)
      .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
      .order("name", { ascending: true })
      .limit(300);

    if (error) {
      console.error("search error", error);
      return new Response(JSON.stringify({ cards: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let cards = (data ?? []) as any[];

    if (setId) {
      cards = cards.filter((card) => cardBelongsToSet(body.game, card, setId));
    }

    let only_alt_available = false;

    if (body.game === "pokemon" && query) {
      const live = await pokemonLiveSearch(query);
      const merged = [...cards];

      for (const card of live) {
        const exists = merged.some((existing) => {
          const existingId = clean(existing.external_id || existing.id);
          const incomingId = clean(card.external_id || card.id);
          if (existingId && incomingId && existingId === incomingId) return true;

          return (
            normalizeCardCode(existing.code) === normalizeCardCode(card.code) &&
            normalizeSetId(existing.set_id) === normalizeSetId(card.set_id)
          );
        });

        if (!exists) merged.push(card);
      }

      cards = setId ? merged.filter((card) => cardBelongsToSet("pokemon", card, setId)) : merged;
    }

    if (body.game === "onepiece" && cards.length > 0 && cards.every(isOpAltArt)) {
      only_alt_available = true;
    }

    return new Response(JSON.stringify({ cards, only_alt_available }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
