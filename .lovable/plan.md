## Implement all 12 improvements

Touches three files: `src/pages/game/MasterSets.tsx`, `src/components/CardSearch.tsx`, `src/pages/game/Pokedex.tsx`. No DB schema changes.

### 1. Master Sets — quick-add and remove-one
- Add a hover-only "+1" button overlay on each unowned card in `SetView` that calls a new `quickAdd(card)` helper. It inserts a `collection_entries` row with defaults (rarity from card, language EN, qty 1) without opening the dialog.
- The dialog opens only when clicking the card body. When the card is already owned, the dialog title becomes "Update collection", the primary button becomes "Add N more", and a secondary "Remove one" button deletes the most recent `collection_entries` row for that card. If no entries remain, the card flips back to gray and the per-set count decrements.

### 2. Local cache for set lists
- Wrap the `card-sets` fetch with a localStorage cache keyed `tcg.sets.{game}.v1`, TTL 24h.
- Render cached data immediately when present, then refresh in the background and overwrite the cache.

### 3. Set thumbnail fallback
- Replace the inline `onError` swap with a small `SetThumb` component that holds local `failed` state and renders the `{set.id}` text badge when the image fails. Cleaner and avoids fragile DOM sibling lookups.

### 4. Loading skeletons
- Add `SetGridSkeleton` (8 placeholder cards) used while the sets list is loading with no cache hit.
- Add `SetViewSkeleton` (10 placeholder cards) used while a single set's cards are loading.

### 5. Dialog Enter-to-save + opacity tweak
- Add `onKeyDown` on `DialogContent` that runs `saveCard()` on Enter (excluding textareas).
- Change unowned card image classes from `opacity-40 grayscale` to `opacity-60 grayscale` for better legibility.

### 6. Language badges on owned cards
- Build `ownedLangByCard: Map<cardId, language>` alongside `ownedCardIds` from the same `collection_entries` query.
- Show a small flag chip in the top-right corner of every owned card tile. Add a `LANG_FLAG` map (EN/JP/IT/FR/DE/ES/PT) and use it in the dialog's language `Select` items as well.

### 7. Wanted-list overlay
- One extra query on mount: `wanted_cards.select(card_id).eq(game)`. Store as `wantedCardIds: Set<string>`.
- Render a yellow star pin in the top-left corner of any tile whose card id is in that set.

### 8. Debounce global card search
- In `CardSearch.tsx`, add a `useEffect` watching `q` with a 300ms timer that triggers `search()` automatically when `q.trim().length >= 2`. Remove the manual submit requirement (keep the form for Enter support but rely on the debounce as the primary trigger). Cancel the timer on cleanup.

### 9. Pokedex generation chips
- Add a `GENERATIONS` constant: `[{label:"Gen 1", from:1, to:151}, ..., {label:"Gen 9", from:906, to:1025}]`.
- Render a sticky chip row above the grid. Selecting a chip filters `all` to that range. "All" chip resets. Combine with the existing name/number filter.

### Technical notes

- All state changes stay in React; no schema/migrations.
- The "+1" button uses `e.stopPropagation()` to avoid also opening the dialog.
- `removeOne` uses two queries: delete the newest entry by `created_at`, then re-check whether any entries remain to decide whether to flip the owned/lang/count UI state.
- Sets cache is invalidated naturally by TTL — no manual purge needed; users can always hard-refresh.
- `CardSearch` debounce keeps the existing local DB lookup + edge function hydration logic intact, just triggered automatically instead of on submit.
