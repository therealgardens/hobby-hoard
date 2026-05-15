# Refactor report — CardKeeperCentral

## Stato attuale

### ✅ Completato

**Schema additivo (3 migrazioni)**
- `card_printings` (56 227 righe) — una stampa fisica per riga, chiave `(card_id, printing_code, variant_type)`
- `ownership` (91 righe) — source-of-truth del possesso, chiave `(user_id, printing_id, language, condition)`
- `binder_entries` (86 righe) — collocazione fisica con flag `is_wanted`
- `sync_conflicts` (0 righe) — log conflitti sync multi-source
- View `masterset_progress` e `user_owned_cards` con `security_invoker = true`

**Trigger di sincronizzazione**
- `sync_binder_to_ownership` su `binder_entries` → mantiene `ownership.quantity` consistente
- `sync_binder_slot_to_collection` su `binder_slots` → mantiene `collection_entries` (compat layer)

**Backfill dati**
- 56 227 stampe materializzate da `cards` esistenti
- 86 binder_slots → 86 binder_entries (1:1)
- 91 ownership records popolati per le coppie (user, printing) esistenti

**Normalizzazione One Piece**
- `set_id` derivato da regex su `code` (`^([A-Z]{1,4}\d{1,3}[A-Z]?)-`)
- 0 mismatch residui in DB sui ~3 700 record One Piece con code valido

**Edge function `sync-cards`**
- Nuovo step `augmentPokemonFromTcgdex()` (fallback TCGdex per set legacy come Unseen Forces)
- Set_id One Piece sempre derivato da prefisso del code, mai dal payload API
- Try/catch + timeout 8 s su tutte le chiamate esterne — fallimento secondario non interrompe il job

**Layer client per il nuovo modello**
- `src/lib/printings.ts` — `extractSetCode`, `classifyVariant`, `parseCode`, `canonicalKey`, `printingKey`
- `src/lib/ownership.ts` — `listOwnershipForSet`, `addOwnership`, `removeOwnership` (idempotenti)

**Test suite Vitest (30 test, 100% verdi)**
- `src/test/printings.test.ts` — 20 test su parsing code/variant/set
- `src/test/onepiece-fixtures.test.ts` — 9 test su fixture realistiche One Piece
- `src/test/example.test.ts` — 1 smoke test

---

### ⚠️ Da fare in step controllati (richiedono modifiche UI invasive)

1. **Drawer varianti in `MasterSets.tsx` / `SetView`**
   - Quando l'utente clicca una carta-base, mostrare drawer con tutte le `card_printings` (base + alt + parallel + promo)
   - Ogni variante con il proprio stato owned, quantità, bottone aggiungi
   - Filtri "solo varianti possedute" / "solo mancanti" / "alt art only"

2. **Migrazione `BinderDetail.tsx` da `binder_slots` a `binder_entries`**
   - Oggi il file lavora ancora su `binder_slots` (453 righe). Il trigger di compat tiene allineate le due tabelle, quindi non c'è urgenza tecnica ma è debito.
   - Quando si migra, aggiungere il selettore di variante allo slot.

3. **Selettore variante in `CardSearch.tsx`**
   - Prima di aggiungere a binder/collection, l'utente deve poter scegliere la stampa specifica (oggi va sempre sulla "base").

4. **Sync manuale dalla UI**
   - L'edge function `sync-cards` con la nuova logica TCGdex+optcgapi è deployata ma serve un trigger admin da Settings per popolare le varianti reali.
   - Stato attuale `card_printings`: 55 532 base + 695 promo + **0 parallel/alt_art** (perché il backfill 1:1 non distingue le varianti — solo il sync da optcgapi le crea).

---

## Causa radice dei bug originali

| Sintomo | Causa | Fix |
|---|---|---|
| Carte da binder non in Master Set | Dedup su `c.id` + collection_entries non sincronizzato | Trigger `sync_binder_slot_to_collection` + nuovo path via `ownership` |
| Set vecchi Pokémon vuoti | Paginazione pokemontcg.io incompleta su set legacy | `augmentPokemonFromTcgdex()` come fallback |
| One Piece set_id sbagliati | API esterna restituisce id compositi (`OP14-EB04`) | `set_id` ora derivato da regex sul code |
| Varianti alt-art non distinte | `cards` non ha colonna variant | Nuova tabella `card_printings` con `variant_type` |
| Binder e collection silos | Tabelle separate senza sync | `ownership` come SoT + trigger bidirezionali |

---

## File modificati / creati

**Migrazioni**: `20260514100247`, `20260514100308`, `20260514100604`
**Edge function**: `supabase/functions/sync-cards/index.ts`
**Nuovi moduli client**: `src/lib/printings.ts`, `src/lib/ownership.ts`
**Test**: `src/test/printings.test.ts`, `src/test/onepiece-fixtures.test.ts`

---

## Comando per chiudere il loop

Quando vuoi popolare effettivamente le varianti One Piece e i set Pokémon legacy, vai su **Settings → Sync card catalog now** (richiede ruolo admin). Il job gira in background, polling automatico ogni 3 s, segnala in toast il numero di carte sincronizzate per gioco.
