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

type Binder = Tables<"binders">;

export default function Binders() {
  const { game } = useParams<{ game: Game }>();
  const [binders, setBinders] = useState<Binder[]>([]);
  const [name, setName] = useState("");
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!game) return;
    const { data, error } = await withDbRetry(() =>
      supabase.from("binders").select("*").eq("game", game).order("created_at"),
    );
    if (error) return toast.error(error.message);
    setBinders(data ?? []);
  };
  useEffect(() => { load(); }, [game]);

  const create = async () => {
    if (!game || !name.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data, error } = await withDbRetry(() =>
      supabase
        .from("binders")
        .insert({ user_id: u.user!.id, game, name: name.trim(), cols, rows })
        .select()
        .single(),
    );
    if (error) return toast.error(error.message);
    // Optimistically append so the new binder shows even if the reload fails
    if (data) setBinders((prev) => [...prev, data as Binder]);
    setName("");
    setOpen(false);
    toast.success("Binder created");
    load();
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
              <Button className="w-full" onClick={create}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {binders.length === 0 ? (
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
