// Card search proxy: searches Pokémon TCG API and One Piece TCG API,
// caches results into public.cards, and returns the cached rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SearchBody {
  game: "pokemon" | "onepiece";
  query?: string;
  setId?: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

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

async function searchOnePiece(query: string, setId?: string) {
  const params = new URLSearchParams();
  if (query) {
    if (/^[a-z]{2,3}\d{2,3}-\d+/i.test(query.trim())) {
      params.set("code", query.trim().toUpperCase());
    } else {
      params.set("name", query.trim());
    }
  }
  if (setId) {
    // apitcg expects e.g. "OP14"
    params.set("set_id", setId.toUpperCase());
    params.set("limit", "250");
  }
  const url = `https://www.apitcg.com/api/one-piece/cards?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "x-api-key": Deno.env.get("APITCG_API_KEY") ?? "" },
  });
  if (!res.ok) {
    if (!query) return [];
    const fallback = await fetch(
      `https://optcgapi.com/api/Cards/${encodeURIComponent(
        query.trim().toUpperCase(),
      )}/`,
    );
    if (!fallback.ok) return [];
    const arr = await fallback.json();
    return (Array.isArray(arr) ? arr : [arr]).map((c: any) => ({
      game: "onepiece" as const,
      external_id: c.id ?? c.card_set_id ?? c.code,
      code: c.id ?? c.code,
      name: c.name,
      set_id: c.set_id ?? c.card_set ?? null,
      set_name: c.set_name ?? null,
      number: c.card_number ?? null,
      rarity: c.rarity ?? null,
      image_small: c.images_thumb ?? c.images_small ?? null,
      image_large: c.images_large ?? c.image_url ?? null,
      pokedex_number: null,
      data: c,
    }));
  }
  const json = await res.json();
  const list = json.data || json.cards || [];
  return list.map((c: any) => ({
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
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json()) as SearchBody;
    if (!body?.game || !["pokemon", "onepiece"].includes(body.game)) {
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
        : await searchOnePiece(query, body.setId);

    if (results.length) {
      const { error } = await admin
        .from("cards")
        .upsert(results, { onConflict: "game,external_id" });
      if (error) console.error("upsert error", error);
    }

    // Return rows from cache (with proper UUIDs)
    const ids = results.map((r) => r.external_id);
    const { data: cached } = await admin
      .from("cards")
      .select("*")
      .eq("game", body.game)
      .in("external_id", ids);

    return new Response(JSON.stringify({ cards: cached ?? [] }), {
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
