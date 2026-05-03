import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, BookOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { withDbRetry } from "@/lib/supabaseRetry";
import { useAuth } from "@/hooks/useAuth";

type Binder = Tables<"binders">;

// Cache in-memory a livello di modulo — sopravvive alla navigazione
const _bindersCache = new Map<string, Binder[]>();

const cacheKey = (game: string, userId: string) => `${game}:${userId}`;

const sortBinders = (rows: Binder[]) =>
  [...rows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

export default function Binders() {
  const { game } = useParams<{ game: Game }>();
  const { user, loading: authLoading } = useAuth();

  const memKey = game && user ? cacheKey(game, user.id) : null;
  const cached = memKey ? _bindersCache.get(memKey) : undefined;

  const [binders, setBinders] = useState<Binder[]>(cached ?? []);
  const [name, setName] = useState("");
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [open, setOpen] = useState(false);
  // Se abbiamo già la cache, non mostrare lo skeleton
  const [loading, setLoading] = useState(!cached?.length);
  const [creating, setCreating] = useState(false);

  const writeCaches = (data: Binder[]) => {
    if (!game || !user) return;
    const key = cacheKey(game, user.id);
    _bindersCache.set(key, data);
    try { sessionStorage.setItem(`tcg.binders.${key}.v1`, JSON.stringify(data)); } catch (_) {}
  };

  const load = async () => {
    if (!game || !user) return;
    const key = cacheKey(game, user.id);

    // Prova sessionStorage se non abbiamo cache in-memory
    if (!_bindersCache.has(key)) {
      try {
        const raw = sessionStorage.getItem(`tcg.binders.${key}.v1`);
        if (raw) {
          const parsed = JSON.parse(raw) as Binder[];
          _bindersCache.set(key, parsed);
          setBinders(parsed);
          setLoading(false);
        }
      } catch (_) {}
    }

    const { data, error } = await withDbRetry(() =>
      supabase.from("binders").select("*").eq("user_id", user.id).eq("game", game).order("created_at"),
    );
    setLoading(false);

    if (error) {
      if (!_bindersCache.has(key)) toast.error(error.message);
      return;
    }
    const fresh = sortBinders((data ?? []) as Binder[]);
    setBinders(fresh);
    writeCaches(fresh);
  };

  useEffect(() => {
    // Aspetta che auth finisca di caricare
    if (authLoading) return;
    // Se non c'è utente, smetti di caricare
    if (!user) { setLoading(false); return; }
    load();
  }, [game, user?.id, authLoading]);

  const create = async () => {
    if (!game || !user || !name.trim() || creating) return;
    setCreating(true);

    const newBinder: Binder = {
      id: crypto.randomUUID(),
      user_id: user.id,
      game,
      name: name.trim(),
      cols,
      rows,
      pages: 1,
      created_at: new Date().toISOString(),
    } as Binder;

    // Ottimistico: aggiunge subito alla lista
    const optimistic = sortBinders([...binders, newBinder]);
    setBinders(optimistic);
    writeCaches(optimistic);
    setName("");
    setOpen(false);

    const { error } = await withDbRetry(() =>
      supabase.from("binders").insert(newBinder),
    );
    setCreating(false);

    if (error) {
      // Rollback
      const rolled = binders.filter((b) => b.id !== newBinder.id);
      setBinders(rolled);
      writeCaches(rolled);
      setOpen(true);
      setName(newBinder.name);
      return toast.error(error.message);
    }
    toast.success("Binder created");
  };

  const [toDelete, setToDelete] = useState<Binder | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!toDelete || !user) return;
    setDeleting(true);
    const target = toDelete;
    const prev = binders;
    const optimistic = binders.filter(b => b.id !== target.id);
    setBinders(optimistic);
    writeCaches(optimistic);

    // Delete child slots first (no FK cascade), then the binder
    await supabase.from("binder_slots").delete().eq("binder_id", target.id).eq("user_id", user.id);
    const { error } = await supabase.from("binders").delete().eq("id", target.id).eq("user_id", user.id);
    setDeleting(false);
    setToDelete(null);
    if (error) {
      setBinders(prev);
      writeCaches(prev);
      return toast.error(error.message);
    }
    toast.success("Binder deleted");
  };

  // Mostra skeleton solo se sta davvero caricando E non abbiamo nulla da mostrare
  const showSkeleton = loading && binders.length === 0 && !authLoading;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-4xl font-display">Binders</h2>
          <p className="text-muted-foreground">Personal collections — character sets, favorites, anything.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> New binder</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create binder</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="My Pikachu binder"
                  onKeyDown={(e) => e.key === "Enter" && create()}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Columns</Label>
                  <Input type="number" min={2} max={6} value={cols} onChange={e => setCols(parseInt(e.target.value) || 3)} />
                </div>
                <div>
                  <Label>Rows</Label>
                  <Input type="number" min={2} max={6} value={rows} onChange={e => setRows(parseInt(e.target.value) || 3)} />
                </div>
              </div>
              <Button className="w-full" onClick={create} disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {showSkeleton ? (
        <Card className="p-12 text-center bg-gradient-card">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground animate-pulse" />
          <p className="mt-3 text-muted-foreground">Loading binders…</p>
        </Card>
      ) : binders.length === 0 ? (
        <Card className="p-12 text-center bg-gradient-card">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">No binders yet. Create your first one!</p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {binders.map(b => (
            <Link key={b.id} to={b.id} state={{ binder: b }}>
              <Card className="p-6 bg-gradient-card hover:shadow-pop transition-all hover:-translate-y-1 cursor-pointer">
                <BookOpen className="h-6 w-6 text-primary mb-2" />
                <h3 className="text-2xl font-display">{b.name}</h3>
                <p className="text-sm text-muted-foreground">{b.cols}×{b.rows} grid · {(b as any).pages ?? 1} page{((b as any).pages ?? 1) > 1 ? "s" : ""} · {b.cols * b.rows} slots/page</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
