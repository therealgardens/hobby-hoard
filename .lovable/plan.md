
# Social & Trading System — Cleanup & Upgrade

Five focused changes, in one pass.

## 1. Database hardening (migration)

Tighten constraints, fix race conditions, and make the username flow atomic.

- **Profiles**
  - Add `CHECK (username ~ '^[A-Za-z0-9_]{3,20}$')` so the API can't accept garbage.
  - Add avatar/bio fields (`avatar_url text`, `bio text`) — small, sets up future polish, optional in UI.
- **Friendships**
  - Add `CHECK (status IN ('pending','accepted','declined','blocked'))`.
  - Replace `UNIQUE (requester_id, addressee_id)` with a unique index on the **unordered pair** so A→B and B→A can't both exist:
    `CREATE UNIQUE INDEX ON friendships (LEAST(requester_id,addressee_id), GREATEST(requester_id,addressee_id))`.
  - Add FKs to `auth.users(id) ON DELETE CASCADE` for both columns.
  - Tighten the UPDATE policy: only the **addressee** can flip `pending → accepted/declined`. The requester can only `DELETE` (cancel). Both parties can change status to `blocked` if they own the row.
- **friend_shares**
  - Add FKs to `auth.users(id) ON DELETE CASCADE`.
- **chat_messages**
  - Add FK `card_id REFERENCES cards(id) ON DELETE SET NULL`.
  - Add FKs `sender_id`, `recipient_id` → `auth.users(id) ON DELETE CASCADE`.
  - Add `CHECK (body IS NULL OR length(body) <= 2000)`.
  - Add new columns for two-sided trades:
    - `offer_card_id uuid REFERENCES cards(id) ON DELETE SET NULL` — what the sender offers in exchange (nullable = "just asking").
    - `trade_status text` with `CHECK (trade_status IN ('open','accepted','declined','cancelled') OR trade_status IS NULL)`.
    - On insert, if `kind = 'trade_request'`, default `trade_status = 'open'`.
  - Allow the **recipient** of a trade request to update `trade_status` (already covered by the existing recipient-update policy; add a column-level note).
  - Allow the **sender** to cancel their own trade request (new policy: UPDATE on own sent rows when only flipping `trade_status` to `cancelled`).
- **handle_new_user trigger**
  - Read `raw_user_meta_data->>'username'` and store it on the new `profiles` row atomically. The unique index will naturally fail signup if the name was just taken — caught client-side.
- **Block list**
  - Update `are_friends` to ignore `blocked` rows (already does — only matches `accepted`).
  - Add `is_blocked(_a, _b)` SECURITY DEFINER function. Tighten `chat_messages` INSERT policy to `NOT is_blocked(...)` and friendship INSERT policy to refuse if the other party blocked you.

## 2. Sharing logic — `all` as default, per-game overrides

Current behaviour: a per-game `false` is overridden by `all = true` (OR logic). User-confusing.

New behaviour inside `shares_with`:
```text
1. If a row exists for (owner, friend, _game) → use that row's module flag.
2. Otherwise → fall back to the (owner, friend, 'all') row's flag (or false if absent).
```
The `ShareSettingsDialog` UI gets a small caption clarifying the new precedence.

## 3. Notification badges + small UX

- New hook `useUnreadCounts()` polling every 30s (and on focus): returns `{ pendingRequests, unreadChats, openTradeRequests }`.
- Friends button on the home page (`Index.tsx`) shows a red dot/number when any of the three is non-zero.
- Inside `Friends.tsx`, the "Requests" tab shows the count, and each friend card shows an unread badge per chat.

## 4. Two-sided trade requests (the part you specifically asked about)

`TradeRequestDialog` is reworked into two modes the sender picks from:

- **"Just ask"** — single-card request. Same as today.
- **"Offer a trade"** — pick one of *your own* cards (from your collection in the same game) to offer in exchange. Stored in the new `offer_card_id` column.

In `ChatDialog`, trade-request bubbles render:
- The card the sender is asking for (existing `card_id`).
- If `offer_card_id` is set → render the offered card next to it with an arrow between them: `[their card] ← → [your card]`.
- If `trade_status = 'open'` and the current user is the recipient → show **Accept** and **Decline** buttons.
- If the sender → show **Cancel** while open.
- Once resolved, the bubble shows a colored status pill (Accepted / Declined / Cancelled) and the buttons disappear.

Accept/Decline simply flip `trade_status`. No automatic inventory transfer — users still finalize physically. (Open question for later: should accept auto-add a chat note? Keeping it minimal for now.)

The "offer a card" picker reuses an inline grid of the sender's `collection_entries` for the same game, with a search box. This avoids opening yet another full page.

## 5. Block user flow

- Friend card → kebab menu → **Block**. Sets friendship row `status = 'blocked'`, owned by the blocker (we add a small denormalized `blocker_id` column or use the existing requester/addressee + a `blocked_by uuid` column — going with `blocked_by` for clarity).
- Blocked users:
  - Can't appear in each other's friend search (filter in `Friends.tsx`).
  - Can't send chat messages (RLS via `is_blocked`).
  - Can't send friend requests (RLS).
- A small "Blocked" sub-tab in `Friends.tsx` shows blocked users with an **Unblock** button.

## Technical details

**New DB objects**
```sql
-- pair-unique index
CREATE UNIQUE INDEX friendships_pair_uidx
  ON public.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

-- block helper
CREATE FUNCTION public.is_blocked(_a uuid, _b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'blocked'
      AND ((requester_id = _a AND addressee_id = _b)
        OR (requester_id = _b AND addressee_id = _a))
  );
$$;

-- shares_with rewritten with override semantics
CREATE OR REPLACE FUNCTION public.shares_with(_owner uuid, _friend uuid, _game text, _module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH game_row AS (
    SELECT * FROM public.friend_shares
    WHERE owner_id = _owner AND friend_id = _friend AND game = _game LIMIT 1
  ),
  all_row AS (
    SELECT * FROM public.friend_shares
    WHERE owner_id = _owner AND friend_id = _friend AND game = 'all' LIMIT 1
  ),
  resolved AS (
    SELECT COALESCE(g.share_collection, a.share_collection, false) AS share_collection,
           COALESCE(g.share_binders,    a.share_binders,    false) AS share_binders,
           COALESCE(g.share_decks,      a.share_decks,      false) AS share_decks,
           COALESCE(g.share_wanted,     a.share_wanted,     false) AS share_wanted
    FROM (SELECT 1) x
    LEFT JOIN game_row g ON true LEFT JOIN all_row a ON true
  )
  SELECT public.are_friends(_owner, _friend) AND CASE _module
    WHEN 'collection' THEN (SELECT share_collection FROM resolved)
    WHEN 'binders'    THEN (SELECT share_binders    FROM resolved)
    WHEN 'decks'      THEN (SELECT share_decks      FROM resolved)
    WHEN 'wanted'     THEN (SELECT share_wanted     FROM resolved)
    ELSE false END;
$$;
```

**Files to add**
- `src/hooks/useUnreadCounts.tsx` — polling hook.
- `src/components/friends/CardPicker.tsx` — inline picker over user's own collection.
- `supabase/migrations/<ts>_social_hardening.sql` — all DB changes above.

**Files to edit**
- `src/components/friends/TradeRequestDialog.tsx` — add "just ask / offer" toggle + CardPicker.
- `src/components/friends/ChatDialog.tsx` — render offered card, status pill, Accept/Decline/Cancel buttons.
- `src/components/friends/ShareSettingsDialog.tsx` — update caption to reflect new override semantics.
- `src/pages/Friends.tsx` — block menu, blocked sub-tab, unread badges.
- `src/pages/Index.tsx` — Friends button badge.
- `src/pages/Auth.tsx` — drop the post-signup `profiles.update(...)` (the trigger handles it now).

**Notes**
- No data migration needed; new columns are nullable.
- Existing chats/trade requests stay valid (`trade_status` will be `NULL` for old rows; UI treats `NULL` as "open" for backward compat, or simply hides buttons).
- Polling interval kept conservative (30s) to stay light on the DB.
