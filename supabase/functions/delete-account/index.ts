import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return new Response(JSON.stringify({ error: "Invalid user" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(supabaseUrl, serviceKey);
    // Delete user data (RLS-protected tables also covered, but explicit for cleanliness)
    const tables = ["collection_entries", "binder_slots", "binders", "wanted_cards", "deck_cards", "decks", "pokedex_entries", "profiles"];
    for (const t of tables) {
      await admin.from(t).delete().eq(t === "profiles" ? "id" : "user_id", user.id);
    }
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) throw delErr;

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
