import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, MessageCircle, HandCoins } from "lucide-react";
import { cardImage, GAME_LABEL, type Game } from "@/lib/game";
import { ChatDialog } from "@/components/friends/ChatDialog";
import { TradeRequestDialog } from "@/components/friends/TradeRequestDialog";

type Profile = { id: string; username: string | null; display_name: string | null };

const MODULES = ["collection", "binders", "decks", "wanted"] as const;
type ModuleKey = typeof MODULES[number];

export default function FriendProfile() {
  const { friendId } = useParams<{ friendId: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeGame, setActiveGame] = useState<Game>("pokemon");
  const [shares, setShares] = useState<Record<string, Record<ModuleKey, boolean>>>({});
  const [collection, setCollection] = useState<any[]>([]);
  const [binders, setBinders] = useState<any[]>([]);
  const [decks, setDecks] = useState<any[]>([]);
  const [wanted, setWanted] = useState<any[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [tradeCard, setTradeCard] = useState<any | null>(null);

  const loadShares = useCallback(async () => {
    if (!friendId || !user) return;
    const { data } = await supabase
      .from("friend_shares")
      .select("*")
      .eq("owner_id", friendId)
      .eq("friend_id", user.id);
    const map: Record<string, Record<ModuleKey, boolean>> = {};
    (data ?? []).forEach((r: any) => {
      map[r.game] = {
        collection: !!r.share_collection,
        binders: !!r.share_binders,
        decks: !!r.share_decks,
        wanted: !!r.share_wanted,
      };
    });
    setShares(map);
  }, [friendId, user]);

  useEffect(() => {
    if (!friendId) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .eq("id", friendId)
        .maybeSingle();
      setProfile(data as Profile | null);
    })();
    loadShares();
  }, [friendId, loadShares]);

  const isShared = (mod: ModuleKey): boolean => {
    return Boolean(shares[activeGame]?.[mod] || shares["all"]?.[mod]);
  };

  // load shared content for the active game
  useEffect(() => {
    if (!friendId) return;
    (async () => {
      const [{ data: col }, { data: bin }, { data: dks }, { data: wnt }] = await Promise.all([
        isShared("collection")
          ? supabase.from("collection_entries").select("*").eq("user_id", friendId).eq("game", activeGame)
          : Promise.resolve({ data: [] as any[] }),
        isShared("binders")
          ? supabase.from("binders").select("*").eq("user_id", friendId).eq("game", activeGame)
          : Promise.resolve({ data: [] as any[] }),
        isShared("decks")
          ? supabase.from("decks").select("*").eq("user_id", friendId).eq("game", activeGame)
          : Promise.resolve({ data: [] as any[] }),
        isShared("wanted")
          ? supabase.from("wanted_cards").select("*").eq("user_id", friendId).eq("game", activeGame)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      // Hydrate card details for collection + wanted via a single cards query
      const cardIds = Array.from(new Set([
        ...((col ?? []).map((r: any) => r.card_id).filter(Boolean) as string[]),
        ...((wnt ?? []).map((r: any) => r.card_id).filter(Boolean) as string[]),
      ]));
      let cardsById = new Map<string, any>();
      if (cardIds.length) {
        const { data: cards } = await supabase.from("cards").select("*").in("id", cardIds);
        cardsById = new Map((cards ?? []).map((c: any) => [c.id, c]));
      }
      setCollection((col ?? []).map((r: any) => ({ ...r, card: cardsById.get(r.card_id) ?? null })));
      setBinders(bin ?? []);
      setDecks(dks ?? []);
      setWanted((wnt ?? []).map((r: any) => ({ ...r, card: cardsById.get(r.card_id) ?? null })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendId, activeGame, shares]);

  if (!profile) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-gradient-hero text-primary-foreground">
        <div className="container mx-auto flex items-center gap-3 py-4 px-4">
          <Button variant="ghost" size="sm" onClick={() => nav("/friends")} className="text-primary-foreground hover:bg-white/10">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-display">@{profile.username}</h1>
            {profile.display_name && profile.display_name !== profile.username && (
              <p className="text-sm opacity-90">{profile.display_name}</p>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setChatOpen(true)}>
            <MessageCircle className="h-4 w-4 mr-1" /> Chat
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-5xl">
        <Tabs value={activeGame} onValueChange={(v) => setActiveGame(v as Game)}>
          <TabsList className="grid grid-cols-3 w-full">
            {(["pokemon", "onepiece", "yugioh"] as Game[]).map((g) => (
              <TabsTrigger key={g} value={g}>{GAME_LABEL[g]}</TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={activeGame} className="mt-4 space-y-6">
            <Section
              title="Collection"
              shared={isShared("collection")}
              empty={collection.length === 0 ? "Nothing yet." : null}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {collection.map((e: any) => (
                  <CardTile
                    key={e.id}
                    card={e.card}
                    qty={e.quantity}
                    onTrade={() => setTradeCard(e.card)}
                  />
                ))}
              </div>
            </Section>

            <Section
              title="Binders"
              shared={isShared("binders")}
              empty={binders.length === 0 ? "No binders." : null}
            >
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {binders.map((b: any) => (
                  <Card key={b.id} className="p-4">
                    <p className="font-semibold">{b.name}</p>
                    <p className="text-xs text-muted-foreground">{b.pages} pages · {b.rows}×{b.cols}</p>
                  </Card>
                ))}
              </div>
            </Section>

            <Section
              title="Decks"
              shared={isShared("decks")}
              empty={decks.length === 0 ? "No decks." : null}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {decks.map((d: any) => (
                  <Card key={d.id} className="p-4">
                    <p className="font-semibold">{d.name}</p>
                  </Card>
                ))}
              </div>
            </Section>

            <Section
              title="Wanted list"
              shared={isShared("wanted")}
              empty={wanted.length === 0 ? "Nothing wanted." : null}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {wanted.map((w: any) => (
                  <CardTile
                    key={w.id}
                    card={w.card}
                    qty={w.quantity}
                    onTrade={() => setTradeCard(w.card)}
                  />
                ))}
              </div>
            </Section>
          </TabsContent>
        </Tabs>
      </main>

      <ChatDialog open={chatOpen} onOpenChange={setChatOpen} friend={profile} />
      {tradeCard && (
        <TradeRequestDialog
          open={!!tradeCard}
          onOpenChange={(o) => !o && setTradeCard(null)}
          friend={profile}
          card={tradeCard}
        />
      )}
    </div>
  );
}

function Section({
  title, shared, empty, children,
}: { title: string; shared: boolean; empty: string | null; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-display mb-2">{title}</h2>
      {!shared ? (
        <Card className="p-4 text-sm text-muted-foreground">Not shared with you.</Card>
      ) : empty ? (
        <Card className="p-4 text-sm text-muted-foreground">{empty}</Card>
      ) : (
        children
      )}
    </div>
  );
}

function CardTile({ card, qty, onTrade }: { card: any; qty: number; onTrade: () => void }) {
  if (!card) return null;
  const img = cardImage(card.game, card.code, card.image_small);
  return (
    <Card className="p-2 flex flex-col gap-2">
      {img ? (
        <img src={img} alt={card.name} className="w-full aspect-[3/4] object-cover rounded" loading="lazy" />
      ) : (
        <div className="w-full aspect-[3/4] bg-muted rounded" />
      )}
      <div>
        <p className="text-xs font-medium truncate">{card.name}</p>
        <p className="text-[11px] text-muted-foreground">x{qty}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onTrade}>
        <HandCoins className="h-3 w-3 mr-1" /> Trade
      </Button>
    </Card>
  );
}
