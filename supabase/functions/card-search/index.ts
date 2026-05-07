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
      const dashed = id.replace(/^([A-Z]+)(\d+)$/, "$1-$2");
      // Match cards by either set_id (canonical or dashed, including dual ids
      // like "OP14-EB04" or "EB-03"), code prefix, or set_name tag — this
      // ensures alt art / SEC / SP variants stored under sibling set_ids are
      // returned along with the base set.
      const orFilter = [
        `set_id.ilike.${id}`,
        `set_id.ilike.${dashed}`,
        `set_id.ilike.${id}-%`,
        `set_id.ilike.%-${id}`,
        `set_id.ilike.${dashed}-%`,
        `set_id.ilike.%-${dashed}`,
        `set_name.ilike.%[${id}]%`,
        `set_name.ilike.%[${dashed}]%`,
        `code.ilike.${id}-%`,
        `code.ilike.${dashed}-%`,
      ].join(",");
      const { data, error } = await admin
        .from("cards")
        .select("*")
        .eq("game", body.game)
        .or(orFilter)
        .order("code", { ascending: true })
        .limit(1000);
      if (error) {
        console.error("set browse error", error);
        return new Response(JSON.stringify({ cards: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Strict client-side filter to avoid neighbour-set bleed (e.g. ST1 vs ST10).
      const idU = id.toUpperCase();
      const dashedU = dashed.toUpperCase();
      const filtered = (data ?? []).filter((c: any) => {
        const sid = String(c.set_id ?? "").toUpperCase();
        const code = String(c.code ?? "").toUpperCase();
        const sname = String(c.set_name ?? "").toUpperCase();
        return (
          sid === idU ||
          sid === dashedU ||
          sid.startsWith(idU + "-") || sid.endsWith("-" + idU) ||
          sid.startsWith(dashedU + "-") || sid.endsWith("-" + dashedU) ||
          code.startsWith(idU + "-") ||
          code.startsWith(dashedU + "-") ||
          sname.includes("[" + idU + "]") ||
          sname.includes("[" + dashedU + "]")
        );
      });
      return new Response(JSON.stringify({ cards: filtered }), {
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
