import { useState } from "react";
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
import { ArrowLeft, Trash2, Sun, Moon, Monitor } from "lucide-react";

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { signOut } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);

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

        {/* Data import/export is now per-game on each game's home page. */}

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
