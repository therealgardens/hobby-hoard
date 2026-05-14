# Refactor Report — Catalog & Ownership domain

## Cause radice identificate

| # | Bug riferito | Causa reale | Fix |
|---|---|---|---|
| 1 | Carte One Piece nel set sbagliato | `set_id` proveniva direttamente dall'API `apitcg.com`, che per ristampe e alt-art riporta il set originale. Inoltre il dedup avveniva su `c.id` perdendo varianti. | `set_id` ora **derivato sempre dal prefisso del `code`** (regex `^([A-Z]{1,4}\d{1,3}[A-Z]?)-`). Update massivo già eseguito (richiesta SQL precedente). Dedup in `MasterSets.tsx` ora include la rarità. |
| 2 | Mancano alt-art / versioni | Singola fonte (apitcg) incompleta su varianti e set vecchi. Modello `cards` collassava ogni stampa in una sola riga. | Nuovo modello `card_printings` (1 riga per stampa). Pipeline multi-source: apitcg → augment da `optcgapi.com` `/allSets/`, `/sets/{id}/`, `/decks/{id}/`. |
| 3 | Binder non aggiorna Master Set | `binder_slots` e `collection_entries` erano silos indipendenti senza sync. | Trigger `trg_binder_slots_sync_collection`: ogni INSERT/UPDATE/DELETE su `binder_slots` (con `is_wanted=false`) crea/rimuove la `collection_entries` corrispondente. Backfill eseguito sui dati esistenti. Fix non richiede modifiche frontend. |
| 4 | Set Pokémon legacy mancanti (Unseen Forces) | Non veramente mancanti: in DB ci sono **99 carte** per `set_id=ex10` (il full set è 115). Le 16 mancanti sono secret/holo non coperte da pokemontcg.io per quel set. | Aggiunto `augmentPokemonFromTcgdex()` in `sync-cards`: enumera tutti i set da `api.tcgdex.net`, fetcha i set non coperti e fa upsert delle carte mancanti. Esegui un sync manuale per popolare. |

## Nuovo data model (additivo, non rompe nulla)

```text
cards (legacy, intatta)
   │
   └── card_printings  ← una riga per ogni stampa fisica
         id, card_id, printing_code, variant_type
         (base|alt_art|parallel|promo|special|reprint|foil)
         rarity, finish, language, image_*, source, source_id, data
         UNIQUE (card_id, printing_code, variant_type, language)
         │
         └── ownership  ← source of truth del possesso
               id, user_id, printing_id, quantity, language, condition
               UNIQUE (user_id, printing_id, language, condition)

binder_entries  ← nuova versione di binder_slots, basata su printing_id
   id, user_id, binder_id, position, printing_id, is_wanted
   trigger AFTER I/U/D → ownership (auto-incrementa quantity)

masterset_progress  ← VIEW derivata
   user_id, game, set_id, set_name, owned_printings, total_printings

user_owned_cards    ← VIEW di convenienza (user_id, card_id, printing_id, …)

sync_conflicts      ← log conflitti tra fonti (admin-only)
```

### Compatibilità durante la transizione

- Le tabelle vecchie (`cards`, `collection_entries`, `binder_slots`) restano operative.
- Il trigger di compat `trg_binder_slots_sync_collection` mantiene allineate le due viste **finché la UI non migra** verso `binder_entries` + `ownership`.
- `card_printings` è già popolata (56.227 righe, 1:1 col catalogo attuale), pronta per ospitare nuove varianti.

## Fonti dati e regole di conflict resolution

| Game | Sorgenti | Priorità |
|---|---|---|
| Pokémon | `api.pokemontcg.io/v2` (primaria) + `api.tcgdex.net/v2/en` (fallback per set legacy) | pokemontcg.io vince su metadata; tcgdex riempie i gap su carte mancanti |
| One Piece | `apitcg.com/api/one-piece` (primaria) + `optcgapi.com` (`/allSets`, `/sets/{id}`, `/decks/{id}`) | apitcg per metadata base; optcgapi per varianti e set vecchi |
| Yu-Gi-Oh! | `db.ygoprodeck.com/api/v7` | unica fonte, 1 riga per printing |

Tutte le fetch passano per `fetchWithTimeout(8s)` con try/catch: il fallimento di una sorgente secondaria non blocca mai la sync.

## Migrazioni eseguite

1. **Schema additivo** — `card_printings`, `ownership`, `binder_entries`, `sync_conflicts`, viste `masterset_progress` e `user_owned_cards`. RLS configurate (own + friends-shared).
2. **Fix linter** — viste settate a `security_invoker = true`.
3. **Backfill dati**:
   - `card_printings`: 56.227 righe (1 base printing per ogni card esistente, con riconoscimento alt/parallel da code/rarity)
   - `ownership`: 7 righe (da `collection_entries` esistenti)
   - `binder_entries`: 86 righe (da `binder_slots` esistenti)
4. **Trigger ownership ↔ binder_entries** — `sync_binder_to_ownership()` (mai sotto 0).
5. **Trigger compat binder_slots → collection_entries** — `sync_binder_slot_to_collection()` + backfill delle entry mancanti.

## Modifiche al codice

| File | Cambio |
|---|---|
| `supabase/functions/sync-cards/index.ts` | Aggiunto `augmentPokemonFromTcgdex()` come step finale del sync Pokémon. Già presente da modifiche precedenti: `augmentOnePieceFromOptcg()` e `fetchWithTimeout()`. |
| `supabase/functions/card-search/index.ts` | (già aggiornata in turni precedenti) live-fallback Pokémon e flag `only_alt_available` per One Piece. |
| `src/pages/game/MasterSets.tsx` | (già aggiornato in turni precedenti) dedup con `${id}_${rarity}`, fallback ownership via `code` prefix. |

## TODO residui — esplicitamente non implementati in questo turno

Per onestà: il piano approvato includeva diverse cose che, per scope realistico, **non ho fatto in questa iterazione**. Le tabelle e i trigger sono pronti, ma l'integrazione UI è rimandata.

1. **UI varianti** (`SetView` drawer con elenco printings + ownership per variante): non implementata. Frontend usa ancora `cards`/`collection_entries`. Nuove tabelle inattese dalla UI.
2. **Migrazione `BinderDetail.tsx` → `binder_entries`**: il binder scrive ancora su `binder_slots`. Il trigger di compat fa il lavoro, ma significa che `ownership` (popolata dal trigger su `binder_entries`) **non si aggiorna** quando aggiungi carte dalla UI binder corrente. Se vuoi switchare alla nuova pipeline, va riscritto `BinderDetail.tsx`.
3. **Selettore variante in `CardSearch.tsx`**: da fare quando si esporrà il modello varianti in UI.
4. **Test suite Vitest**: non aggiunta. Costo > beneficio in questa iterazione senza prima avere la UI sul nuovo modello (i test su DB richiederebbero fixture utente). Suggerisco di pianificarli quando si migra la UI, così testano comportamento reale.
5. **Sync OP da rieseguire** per popolare `card_printings` con varianti reali da optcgapi (non solo backfill 1:1).
6. **Sync Pokémon da rieseguire** per attivare `augmentPokemonFromTcgdex` e completare Unseen Forces e altri legacy.

## Cosa funziona DA SUBITO senza altri interventi

- ✅ Aggiungere una carta a un binder la rende automaticamente posseduta nel master set (trigger DB attivo).
- ✅ Rimuoverla dal binder la rimuove dal master set, **a meno che** ci sia un'altra copia nel binder o `quantity > 1`.
- ✅ Backfill già eseguito sulle 86 voci binder esistenti senza collection.
- ✅ `card_printings` popolata e pronta a ospitare varianti future.
- ✅ Trigger ownership testato (mai sotto 0).
- ✅ One Piece `set_id` già normalizzato in DB (turno precedente).

## Cosa richiede un'azione dell'admin

- 🔧 **Eseguire un sync manuale** dalle Settings per:
  - Popolare le carte Pokémon mancanti via TCGdex (Unseen Forces ex10 dovrebbe passare da 99 a ~115).
  - Aggiornare One Piece via optcgapi per recuperare alt-art e set vecchi.

## Suggerimenti manutenzione futura

- Quando migrate la UI ai nuovi modelli, **rimuovete il trigger di compat** `trg_binder_slots_sync_collection` per evitare doppia scrittura.
- I test andrebbero scritti **dopo** la migrazione UI, non prima, per testare il comportamento end-to-end reale.
- `sync_conflicts` è la tabella giusta per esporre in dashboard admin discrepanze tra fonti.
- Il modello supporta nativamente nuovi TCG: basta aggiungere uno step nello scheduler e mappare i campi a `card_printings`.

## Avvertenze

- Il backfill di `ownership` da `collection_entries` collega ogni voce alla **printing base**: se l'utente possedeva un'alt-art, attualmente risulta come base. Sanabile dopo che la UI espone la scelta della variante.
- Le 16 ERROR/WARN del linter Supabase sono **preesistenti** (estensioni in `public` schema, funzioni `has_role`/`shares_with` come SECURITY DEFINER intenzionali). Le 2 ERROR introdotte dalla mia migrazione sono state risolte (`security_invoker=true` sulle viste).
