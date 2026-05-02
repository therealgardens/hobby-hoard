// sync-scheduler: tiny endpoint that pg_cron calls daily. It just forwards to
// sync-cards with the service role key. Kept separate so pg_cron only needs
// one URL and we can add throttling/logging later.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only allow callers that present the service role key (e.g. pg_cron via pg_net).
  const callerAuth = req.headers.get("Authorization") ?? "";
  if (callerAuth !== `Bearer ${SERVICE_KEY}`) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const url = `${SUPABASE_URL}/functions/v1/sync-cards`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify({ games: ["pokemon", "onepiece", "yugioh"] }),
    });
    const text = await res.text();
    return new Response(
      JSON.stringify({ ok: res.ok, status: res.status, body: text.slice(0, 2000) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
