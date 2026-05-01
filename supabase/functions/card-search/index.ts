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

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function escapePgPattern(s: string) {
  // Escape the PostgREST/PostgREST `or` filter special chars and SQL LIKE wildcards.
  return s.replace(/[%_,()]/g, (m) => `\\${m}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    // Require an authenticated caller.
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

    // No criteria — return empty.
    if (!query && !setId) {
      return new Response(JSON.stringify({ cards: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Browse a whole set.
    if (setId && !query) {
      const id = setId.toUpperCase().replace(/-/g, "");
      const { data, error } = await admin
        .from("cards")
        .select("*")
        .eq("game", body.game)
        .or(`set_id.ilike.${id},code.ilike.${id}-%,code.ilike.${id}%`)
        .order("code", { ascending: true })
        .limit(500);
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

    // Free-text search by name OR code (ilike). The FTS index keeps this fast,
    // and the lower(name)/lower(code) indexes accelerate prefix matches.
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
      q = q.or(`set_id.ilike.${id},code.ilike.${id}-%`);
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
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
