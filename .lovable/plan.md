
# Piano operativo

Approccio **additivo**: aggiungo nuove tabelle accanto a quelle esistenti, le popolo via backfill, faccio migrare gradualmente la UI. `cards`, `collection_entries`, `binder_slots` continuano a funzionare durante la transizione.

---

## 1. Nuovo schema (migrazione additiva)

```text
card_printings        ← ogni stampa fisica distinta (base/alt/parallel/promo)
  id, card_id (FK cards), printing_code, variant_type,
  rarity, finish, image_small, image_large, source, source_id, data
  UNIQUE (card_id, printing_code, variant_type)

ownership             ← source of truth del possesso
  id, user_id, printing_id (FK card_printings),
  quantity, language, condition, notes
  UNIQUE (user_id, printing_id, language, condition)

binder_entries        ← collocazione fisica (sostituisce binder_slots)
  id, user_id, binder_id, position, printing_id, ownership_id, is_wanted
  
masterset_progress    ← VIEW derivata
  user_id, game, set_id, total_printings, owned_printings, completion_pct
```

Trigger:
- `binder_entries` insert/update/delete → upsert/decrement `ownership.quantity` (mai sotto 0; non azzera se ci sono copie extra fuori binder)
- `ownership` write → cache invalidation per masterset

`binder_slots` resta come legacy table; un trigger ne mantiene la sincronia con `binder_entries` finché la UI non migra completamente.

## 2. Pipeline sync One Piece (multi-source)

Riscrittura `sync-cards` step One Piece:
1. **apitcg.com** → carte base + metadata
2. **optcgapi.com** `/allSets/` + `/sets/{id}/` + `/decks/{id}/` → varianti, alt-art, set vecchi
3. Canonicalization key = `(set_code_derivato_dal_code, card_number, variant_marker)`
   - variant_marker estratto da suffisso code (`_p1`, `_p2`) e rarity (`AA`, `SP`, `MR`)
4. Per ogni carta canonica → upsert in `cards`; per ogni stampa → upsert in `card_printings` con `source` + `source_id`
5. Conflict resolution: optcgapi vince su apitcg per varianti; apitcg vince per metadata base
6. Report conflitti scritto in nuova tabella `sync_conflicts`

## 3. Pipeline sync Pokémon (con TCGdex fallback)

1. Sync attuale **pokemontcg.io** (già paginato) — verifico bug paginazione su set vecchi
2. Recupero lista completa set da **api.tcgdex.net/v2/en/sets**
3. Per ogni set non coperto da pokemontcg.io (es. Unseen Forces ex2) → fetch da TCGdex e mapping a `cards` + `card_printings`
4. Merge per `(set_id, card_number)` con priorità pokemontcg.io quando entrambi presenti
5. Test esplicito: dopo sync, `cards WHERE set_id ILIKE '%unseen%'` deve restituire ≥115 righe

## 4. Binder → Masterset sync

- Endpoint binder add usa `binder_entries` + trigger ownership
- `MasterSets.tsx` query cambia da `collection_entries` a `ownership` JOIN `card_printings`
- Una carta possiede tutte le sue varianti separate; ogni variante ha il suo flag "owned"
- Backfill: per ogni `binder_slots` esistente → crea `binder_entry` + `ownership` corrispondente

## 5. UI varianti

`SetView` / `MasterSets`:
- Mostra carta base con badge contatore varianti
- Click su carta → drawer con tutte le `card_printings` (base, alt, parallel, promo)
- Per ciascuna: stato owned, quantità, bottone "aggiungi"
- Filtri: "solo varianti possedute", "solo varianti mancanti", "alt art only"

`CardSearch`: aggiungo selettore variante prima di aggiungere a binder.

## 6. Migrazione/backfill

Script SQL eseguiti nell'ordine:
1. Crea tabelle nuove + indici + RLS
2. Backfill `card_printings` da `cards` esistenti (1:1, variant_type='base' di default; suffissi `_p\d+` → 'parallel'; rarity AA/SP/MR → 'alt_art')
3. Backfill `ownership` da `collection_entries`
4. Backfill `binder_entries` da `binder_slots`
5. Trigger di compat installati
6. Sync One Piece + Pokémon rieseguiti per popolare varianti mancanti

Tutti gli script sono **idempotenti** (`ON CONFLICT DO NOTHING/UPDATE`).

## 7. Test (Vitest)

- `tests/canonicalization.test.ts` — 20+ casi su parsing code/variant/set
- `tests/onepiece-variants.test.ts` — fixture: carta con base + 2 alt → 3 printings distinti, no merge
- `tests/onepiece-set-assignment.test.ts` — set_id sempre derivato da code, mai dall'API
- `tests/binder-ownership-sync.test.ts` — add binder_entry → ownership.quantity++; remove → decrement; non azzera se extra copies
- `tests/masterset-derivation.test.ts` — masterset_progress riflette ownership in tempo reale
- `tests/pokemon-legacy-sets.test.ts` — Unseen Forces presente con ≥115 carte
- `tests/sync-multi-source.test.ts` — merge apitcg + optcgapi senza duplicati

Edge function tests Deno per `sync-cards` e `card-search`.

## 8. Report finale

Documento `REFACTOR_REPORT.md`:
- Cause radice trovate (set_id da API inaffidabile, dedup su `c.id`, mancanza model varianti, binder/collection silos)
- Nuovo data model con ER diagram ASCII
- Fonti integrate e regole conflict resolution
- Migrazioni eseguite con conteggi righe
- Test aggiunti + coverage
- TODO residui (es. UI Decks non ancora migrata su printings)

---

## Dettagli tecnici

**File modificati:**
- `supabase/functions/sync-cards/index.ts` (riscrittura step OP + Pokémon)
- `supabase/functions/card-search/index.ts` (query su `card_printings`)
- `supabase/functions/card-sets/index.ts` (TCGdex fallback)
- `src/pages/game/MasterSets.tsx` (query `ownership` + drawer varianti)
- `src/pages/game/BinderDetail.tsx` (usa `binder_entries`)
- `src/components/CardSearch.tsx` (selettore variante)
- nuovo: `src/lib/printings.ts` (helper canonicalization client-side)
- nuovo: `src/lib/ownership.ts` (mutation hooks)

**File creati per test:**
- `vitest.config.ts` (già presente, verifico)
- `src/test/canonicalization.test.ts`
- `src/test/onepiece-variants.test.ts`
- + altri 5 sopra

**Migrazioni SQL:** 1 grande migrazione strutturale + 1 insert tool call per backfill dati.

**Tempo stimato:** lavoro pesante. Procedo end-to-end come hai chiesto e ti consegno tutto insieme con report finale. Se durante l'esecuzione trovo blocchi (es. fonte dati down, ambiguità nei dati reali), li annoto nel report invece di fermarmi.

**Rischi:**
- Backfill su DB di produzione: se i dati attuali hanno code malformati, alcune stampe finiranno con `variant_type='base'` errato → il report flaggerà i casi sospetti per review manuale
- TCGdex potrebbe avere rate limit; aggiungo retry+backoff
- Trigger ownership su binder_entries deve essere a prova di race condition — uso advisory lock per utente
