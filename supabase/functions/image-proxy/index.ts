// Proxies card images so the browser can load them despite
// Cross-Origin-Resource-Policy: same-site on the source CDN.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_HOSTS = new Set([
  "en.onepiece-cardgame.com",
  "asia-en.onepiece-cardgame.com",
  "optcgapi.com",
  "www.apitcg.com",
  "images.pokemontcg.io",
  "assets.pokemon.com",
  "images.ygoprodeck.com",
  "storage.googleapis.com",
]);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Require an authenticated caller to prevent open-proxy abuse.
  // Accept the JWT either via Authorization header (fetch) or as ?access_token=
  // query parameter, since plain <img src> tags cannot send custom headers.
  const reqUrl = new URL(req.url);
  const headerAuth = req.headers.get("Authorization") ?? "";
  const queryToken = reqUrl.searchParams.get("access_token") ?? "";
  const token = headerAuth.startsWith("Bearer ")
    ? headerAuth.slice("Bearer ".length)
    : queryToken;
  if (!token) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  try {
    const u = new URL(req.url);
    const target = u.searchParams.get("url");
    if (!target) {
      return new Response("missing url", { status: 400, headers: corsHeaders });
    }
    const t = new URL(target);
    if (!ALLOWED_HOSTS.has(t.hostname)) {
      return new Response("host not allowed", { status: 400, headers: corsHeaders });
    }
    const upstream = await fetch(t.toString(), {
      headers: {
        "Referer": `${t.protocol}//${t.hostname}/`,
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!upstream.ok) {
      return new Response("upstream error", {
        status: upstream.status,
        headers: corsHeaders,
      });
    }
    const ct = upstream.headers.get("content-type") ?? "image/png";
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": ct,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "error", {
      status: 500,
      headers: corsHeaders,
    });
  }
});
