// Proxies card images so the browser can load them despite
// Cross-Origin-Resource-Policy: same-site on the source CDN.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
        // Some CDNs require a referer matching their own domain
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
