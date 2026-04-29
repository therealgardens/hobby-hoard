import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { validateUsername } from "@/lib/username";

/**
 * Blocking modal: if the signed-in user has no `username`, force them to pick one
 * before they can interact with the rest of the app.
 */
export function UsernameGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [needsUsername, setNeedsUsername] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!user) {
        setChecked(true);
        setNeedsUsername(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setNeedsUsername(!data?.username);
      setChecked(true);
    };
    check();
    return () => { cancelled = true; };
  }, [user]);

  const save = async () => {
    if (!user) return;
    const v = validateUsername(username);
    if (!v.ok) {
      toast.error(v.error);
      return;
    }
    setBusy(true);
    const { data: taken } = await supabase
      .from("profiles")
      .select("id")
      .ilike("username", v.value)
      .neq("id", user.id)
      .maybeSingle();
    if (taken) {
      setBusy(false);
      toast.error("That username is already taken.");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ username: v.value, display_name: v.value })
      .eq("id", user.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Username saved!");
    setNeedsUsername(false);
  };

  if (loading || !checked) return <>{children}</>;

  return (
    <>
      {children}
      <Dialog open={needsUsername}>
        <DialogContent
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="[&>button]:hidden"
        >
          <DialogHeader>
            <DialogTitle>Pick a username</DialogTitle>
            <DialogDescription>
              You need a unique username so friends can find you. 3–20 characters: letters, numbers or underscore.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. ash_ketchum" />
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save username"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
