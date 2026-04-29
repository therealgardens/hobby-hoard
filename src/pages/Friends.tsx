import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, UserPlus, Check, X, Search, Settings2, MessageCircle, Eye } from "lucide-react";
import { toast } from "sonner";
import { ChatDialog } from "@/components/friends/ChatDialog";
import { ShareSettingsDialog } from "@/components/friends/ShareSettingsDialog";

type Profile = { id: string; username: string | null; display_name: string | null };
type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: string;
  created_at: string;
};

export default function Friends() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [chatWith, setChatWith] = useState<Profile | null>(null);
  const [shareWith, setShareWith] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data: rows } = await supabase
      .from("friendships")
      .select("*")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .order("created_at", { ascending: false });
    setFriendships((rows ?? []) as Friendship[]);
    const ids = Array.from(new Set((rows ?? []).flatMap((r) => [r.requester_id, r.addressee_id])));
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .in("id", ids);
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p: Profile) => { map[p.id] = p; });
      setProfiles(map);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const doSearch = async () => {
    if (!user) return;
    const term = search.trim();
    if (!term) { setSearchResults([]); return; }
    const { data } = await supabase
      .from("profiles")
      .select("id, username, display_name")
      .ilike("username", `%${term}%`)
      .neq("id", user.id)
      .limit(20);
    setSearchResults((data ?? []) as Profile[]);
  };

  const sendRequest = async (target: Profile) => {
    if (!user) return;
    // If a friendship already exists either direction, surface that
    const existing = friendships.find(
      (f) =>
        (f.requester_id === user.id && f.addressee_id === target.id) ||
        (f.requester_id === target.id && f.addressee_id === user.id),
    );
    if (existing) {
      toast.info(existing.status === "accepted" ? "Already friends." : "Request already pending.");
      return;
    }
    const { error } = await supabase
      .from("friendships")
      .insert({ requester_id: user.id, addressee_id: target.id });
    if (error) return toast.error(error.message);
    toast.success(`Friend request sent to ${target.username}`);
    load();
  };

  const respond = async (f: Friendship, accept: boolean) => {
    const { error } = await supabase
      .from("friendships")
      .update({ status: accept ? "accepted" : "declined" })
      .eq("id", f.id);
    if (error) return toast.error(error.message);
    if (accept) {
      // Open share settings right away
      const otherId = f.requester_id === user!.id ? f.addressee_id : f.requester_id;
      setShareWith(profiles[otherId] ?? null);
    }
    load();
  };

  const removeFriend = async (f: Friendship) => {
    await supabase.from("friendships").delete().eq("id", f.id);
    load();
  };

  if (!user) return null;

  const accepted = friendships.filter((f) => f.status === "accepted");
  const incoming = friendships.filter((f) => f.status === "pending" && f.addressee_id === user.id);
  const outgoing = friendships.filter((f) => f.status === "pending" && f.requester_id === user.id);

  const otherOf = (f: Friendship) => (f.requester_id === user.id ? f.addressee_id : f.requester_id);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-gradient-hero text-primary-foreground">
        <div className="container mx-auto flex items-center gap-3 py-4 px-4">
          <Button variant="ghost" size="sm" onClick={() => nav("/")} className="text-primary-foreground hover:bg-white/10">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-3xl font-display">Friends</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <Tabs defaultValue="friends">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="friends">Friends ({accepted.length})</TabsTrigger>
            <TabsTrigger value="requests">Requests ({incoming.length})</TabsTrigger>
            <TabsTrigger value="search">Find people</TabsTrigger>
          </TabsList>

          <TabsContent value="friends" className="mt-4 space-y-3">
            {accepted.length === 0 && (
              <Card className="p-6 text-center text-muted-foreground">No friends yet — find someone in the “Find people” tab.</Card>
            )}
            {accepted.map((f) => {
              const p = profiles[otherOf(f)];
              return (
                <Card key={f.id} className="p-4 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">@{p?.username ?? "unknown"}</p>
                    {p?.display_name && p.display_name !== p.username && (
                      <p className="text-sm text-muted-foreground truncate">{p.display_name}</p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => p && nav(`/friend/${p.id}`)}>
                    <Eye className="h-4 w-4 mr-1" /> Profile
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => p && setChatWith(p)}>
                    <MessageCircle className="h-4 w-4 mr-1" /> Chat
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => p && setShareWith(p)}>
                    <Settings2 className="h-4 w-4 mr-1" /> Share
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeFriend(f)}>
                    <X className="h-4 w-4" />
                  </Button>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="requests" className="mt-4 space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground mt-2">Incoming</h3>
            {incoming.length === 0 && <p className="text-sm text-muted-foreground">No pending requests.</p>}
            {incoming.map((f) => {
              const p = profiles[f.requester_id];
              return (
                <Card key={f.id} className="p-4 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-semibold">@{p?.username ?? "unknown"}</p>
                    <p className="text-xs text-muted-foreground">wants to be your friend</p>
                  </div>
                  <Button size="sm" onClick={() => respond(f, true)}>
                    <Check className="h-4 w-4 mr-1" /> Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => respond(f, false)}>
                    <X className="h-4 w-4 mr-1" /> Decline
                  </Button>
                </Card>
              );
            })}

            <h3 className="text-sm font-semibold text-muted-foreground mt-6">Sent</h3>
            {outgoing.length === 0 && <p className="text-sm text-muted-foreground">No pending sent requests.</p>}
            {outgoing.map((f) => {
              const p = profiles[f.addressee_id];
              return (
                <Card key={f.id} className="p-4 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-semibold">@{p?.username ?? "unknown"}</p>
                    <p className="text-xs text-muted-foreground">request pending</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeFriend(f)}>
                    Cancel
                  </Button>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="search" className="mt-4 space-y-3">
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearch()}
                placeholder="Search by exact or partial username…"
              />
              <Button onClick={doSearch}><Search className="h-4 w-4 mr-1" /> Search</Button>
            </div>
            {searchResults.length === 0 && search && (
              <p className="text-sm text-muted-foreground">No users found.</p>
            )}
            {searchResults.map((p) => (
              <Card key={p.id} className="p-4 flex items-center gap-3">
                <div className="flex-1">
                  <p className="font-semibold">@{p.username}</p>
                  {p.display_name && p.display_name !== p.username && (
                    <p className="text-xs text-muted-foreground">{p.display_name}</p>
                  )}
                </div>
                <Button size="sm" onClick={() => sendRequest(p)}>
                  <UserPlus className="h-4 w-4 mr-1" /> Add friend
                </Button>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </main>

      {chatWith && (
        <ChatDialog
          open={!!chatWith}
          onOpenChange={(o) => !o && setChatWith(null)}
          friend={chatWith}
        />
      )}
      {shareWith && (
        <ShareSettingsDialog
          open={!!shareWith}
          onOpenChange={(o) => !o && setShareWith(null)}
          friend={shareWith}
        />
      )}
    </div>
  );
}
