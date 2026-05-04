import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/components/ThemeProvider";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { LANGUAGES } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Trash2, Sun, Moon, Monitor, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";

type SyncJob = {
  id: string;
  status: "running" | "succeeded" | "failed";
  summary: Record<string, number>;
  total: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { signOut, user } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [job, setJob] = useState<SyncJob | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [user]);

  // On mount (admin only) load the most recent job so we can resume polling
  // if a sync was kicked off in another tab / earlier session.
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const { data } = await supabase
        .from("sync_jobs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        const j = data as unknown as SyncJob;
        setJob(j);
        if (j.status === "running") startPolling(j.id);
      }
    })();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const stopPolling = () => {
  if (pollRef.current) {
    window.clearInterval(pollRef.current);
    pollRef.current = null;
  }
  if (timeoutRef.current) {           // ← aggiungi queste 3 righe
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
};

  const timeoutRef = useRef<number | null>(null); // aggiungi questo vicino a pollRef (riga ~37)

const startPolling = (jobId: string) => {
  stopPolling();
  setSyncing(true);

  // Timeout di sicurezza: dopo 5 minuti forza lo stop
  if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  timeoutRef.current = window.setTimeout(() => {
    stopPolling();
    setSyncing(false);
    toast.error("Sync timed out after 5 minutes. Please try again.");
  }, 5 * 60 * 1000);

  pollRef.current = window.setInterval(async () => {
      const { data, error } = await supabase
        .from("sync_jobs").select("*").eq("id", jobId).maybeSingle();
      if (error || !data) return;
      const j = data as unknown as SyncJob;
      setJob(j);
      if (j.status !== "running") {
        stopPolling();
        setSyncing(false);
        if (j.status === "succeeded") {
          const s = j.summary ?? {};
          toast.success(
            `Sync complete — ${j.total} cards (Pokémon: ${s.pokemon ?? 0}, One Piece: ${s.onepiece ?? 0}, Yu-Gi-Oh!: ${s.yugioh ?? 0})`,
          );
        } else {
          toast.error(`Sync failed: ${j.error ?? "unknown error"}`);
        }
      }
    }, 3000);
  };

  const runCardSync = async () => {
    setSyncing(true);
    setJob(null);
    try {
      const { data, error } = await supabase.functions.invoke("sync-cards");
      if (error) throw error;
      const jobId = data?.jobId as string | undefined;
      if (jobId) {
        toast.info("Sync started — polling for progress…");
        startPolling(jobId);
      } else if (data?.accepted) {
        toast.success("Sync started in the background.");
        setSyncing(false);
      } else {
        const s = data?.summary ?? {};
        toast.success(
          `Sync complete — ${data?.total ?? 0} cards (Pokémon: ${s.pokemon ?? 0}, One Piece: ${s.onepiece ?? 0}, Yu-Gi-Oh!: ${s.yugioh ?? 0})`,
        );
        setSyncing(false);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Sync failed");
      setSyncing(false);
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("delete-account");
      if (error) throw error;
      toast.success(t("settings.deleted"));
      await signOut();
      nav("/auth");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const renderJobStatus = () => {
    if (!job) return null;
    const s = job.summary ?? {};
    const elapsed = job.finished_at
      ? Math.round((new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000)
      : Math.round((Date.now() - new Date(job.started_at).getTime()) / 1000);
    return (
      <div className="mt-4 rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
        <div className="flex items-center gap-2 font-medium">
          {job.status === "running" && <><RefreshCw className="h-4 w-4 animate-spin text-primary" /> Sync in progress…</>}
          {job.status === "succeeded" && <><CheckCircle2 className="h-4 w-4 text-green-600" /> Last sync succeeded</>}
          {job.status === "failed" && <><AlertCircle className="h-4 w-4 text-destructive" /> Last sync failed</>}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{elapsed}s</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          {(["pokemon", "onepiece", "yugioh"] as const).map((g) => (
            <div key={g} className="rounded bg-background px-2 py-1.5 border">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {g === "pokemon" ? "Pokémon" : g === "onepiece" ? "One Piece" : "Yu-Gi-Oh!"}
              </div>
              <div className="font-mono">
                {s[g] === undefined
                  ? (job.status === "running" ? "…" : "—")
                  : s[g] === -1
                    ? "error"
                    : s[g].toLocaleString()}
              </div>
            </div>
          ))}
        </div>
        {job.error && <p className="text-xs text-destructive">{job.error}</p>}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-gradient-hero text-primary-foreground">
        <div className="container mx-auto flex items-center gap-3 py-4 px-4">
          <Button variant="ghost" size="sm" onClick={() => nav(-1)} className="text-primary-foreground hover:bg-white/10">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-3xl font-display">{t("settings.title")}</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        {/* Appearance */}
        <Card className="p-6">
          <h2 className="text-2xl font-display mb-4">{t("settings.appearance")}</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{t("settings.theme")}</p>
            </div>
            <div className="flex gap-2">
              <Button variant={theme === "light" ? "default" : "outline"} size="sm" onClick={() => setTheme("light")}>
                <Sun className="h-4 w-4 mr-1" /> {t("settings.light")}
              </Button>
              <Button variant={theme === "dark" ? "default" : "outline"} size="sm" onClick={() => setTheme("dark")}>
                <Moon className="h-4 w-4 mr-1" /> {t("settings.dark")}
              </Button>
              <Button variant={theme === "system" ? "default" : "outline"} size="sm" onClick={() => setTheme("system")}>
                <Monitor className="h-4 w-4 mr-1" /> {t("settings.system")}
              </Button>
            </div>
          </div>
        </Card>

        {/* Language */}
        <Card className="p-6">
          <h2 className="text-2xl font-display mb-2">{t("settings.language")}</h2>
          <p className="text-muted-foreground text-sm mb-4">{t("settings.languageDesc")}</p>
          <Select value={i18n.language.split("-")[0]} onValueChange={(v) => i18n.changeLanguage(v)}>
            <SelectTrigger className="w-full md:w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Card>

        {/* Card database sync — admins only */}
        {isAdmin && (
          <Card className="p-6">
            <h2 className="text-2xl font-display mb-2">Card database</h2>
            <p className="text-muted-foreground text-sm mb-4">
              The full card catalog is refreshed automatically every day at 3:00 UTC.
              Manual syncs run in the background and usually finish within 1–3 minutes.
            </p>
            <Button onClick={runCardSync} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync card catalog now"}
            </Button>
            {renderJobStatus()}
          </Card>
        )}


        {/* Danger zone */}
        <Card className="p-6 border-destructive/30">
          <h2 className="text-2xl font-display mb-4 text-destructive">{t("settings.danger")}</h2>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">{t("settings.deleteAccount")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.deleteDesc")}</p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={busy}>
                  <Trash2 className="h-4 w-4 mr-2" /> {t("settings.deleteAccount")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("settings.confirmDelete")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("settings.confirmDeleteDesc")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("settings.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteAccount} className="bg-destructive hover:bg-destructive/90">
                    {t("settings.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Card>
      </main>
    </div>
  );
}
