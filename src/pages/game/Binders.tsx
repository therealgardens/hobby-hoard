import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, BookOpen } from "lucide-react";
import { toast } from "sonner";
import type { Game } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";
import { withDbRetry } from "@/lib/supabaseRetry";
import { useAuth } from "@/hooks/useAuth";

type Binder = Tables<"binders">;

const cacheKey = (game: string, userId: string) => `tcg.binders.${game}.${userId}.v1`;

const sortBinders = (rows: Binder[]) =>
  [...rows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

export default function Binders() {
  const { game } = useParams<{ game: Game }>();
  const { user } = useAuth();
  const [binders, setBinders] = useState<Binder[]>([]);
  const [name, setName] = useState("");
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!game || !user) return;
    setLoading(true);
    const key = cacheKey(game, user.id);
    const cached = sessionStorage.getItem(key);
    if (cached) {
      try {
        setBinders(JSON.parse(cached));
        setLoading(false);
      } catch {
        sessionStorage.removeItem(key);
      }
    }
    const { data, error } = await withDbRetry(() =>
      supabase.from("binders").select("*").eq("user_id", user.id).eq("game", game).order("created_at"),
    );
    setLoading(false);
    if (error) {
      if (!cached) toast.error(error.message);
      return;
    }
    const rows = (data ?? []) as Binder[];
    setBinders(rows);
    sessionStorage.setItem(key, JSON.stringify(rows));
  };
  useEffect(() => { load(); }, [game, user?.id]);

  const create = async () => {
    if (!game || !user || !name.trim() || creating) return;
    setCreating(true);
    const now = new Date().toISOString();
    const next = {
      id: crypto.randomUUID(),
      user_id: user.id,
      game,
      name: name.trim(),
      cols,
      rows,
      pages: 1,
      created_at: now,
    } satisfies Binder;
    const { error } = await withDbRetry(() =>
      supabase
        .from("binders")
        .insert(next),
    );
    setCreating(false);
    if (error) return toast.error(error.message);
    setBinders((prev) => {
      const merged = sortBinders([...prev.filter((b) => b.id !== next.id), next]);
      sessionStorage.setItem(cacheKey(game, user.id), JSON.stringify(merged));
      return merged;
    });
    setName("");
    setOpen(false);
    toast.success("Binder created");
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-4xl font-display">Binders</h2>
          <p className="text-muted-foreground">Personal collections — character sets, favorites, anything.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> New binder</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create binder</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="My Pikachu binder" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Columns</Label><Input type="number" min={2} max={6} value={cols} onChange={e => setCols(parseInt(e.target.value) || 3)} /></div>
                <div><Label>Rows</Label><Input type="number" min={2} max={6} value={rows} onChange={e => setRows(parseInt(e.target.value) || 3)} /></div>
              </div>
              <Button className="w-full" onClick={create} disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading && binders.length === 0 ? (
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
            <Link key={b.id} to={b.id}>
              <Card className="p-6 bg-gradient-card hover:shadow-pop transition-all hover:-translate-y-1 cursor-pointer">
                <BookOpen className="h-6 w-6 text-primary mb-2" />
                <h3 className="text-2xl font-display">{b.name}</h3>
                <p className="text-sm text-muted-foreground">{b.cols}×{b.rows} grid · {b.cols * b.rows} slots/page</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
