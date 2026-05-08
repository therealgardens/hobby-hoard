// sync-scheduler: tiny endpoint that pg_cron calls daily.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const callerAuth = req.headers.get("Authorization") ?? "";
  if (callerAuth !== `Bearer ${SERVICE_KEY}`) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // FIX: pulisce job stuck su "running" da più di 15 minuti prima di avviarne uno nuovo
  try {
    await admin
      .from("sync_jobs")
      .update({
        status: "failed",
        error: "Timed out — cleaned up by scheduler",
        finished_at: new Date().toISOString(),
      })
      .eq("status", "running")
      .lt("started_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
  } catch (e) {
    console.warn("[sync-scheduler] cleanup failed", e);
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
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
