> Draft plan (Nov 14), checked against the reviewed phase 4 design and the designs of the phases before it. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 6: orders, inventory and alerts

"PRD main N" is a line of the product spec's main tab; "Build plan N" a line of its Build plan tab. Paths are from the repository root. "lifecycle" and "forms" with a section number are the two parts of the phase 4 design (`docs/design/phase-4/`); "phase 5" with a section number is `docs/design/phase-5-admin-configuration.md`. "Next free number" means the lowest unused migration number when the unit starts (phase 4 took 0017 to 0022 and phase 5 takes 0023 and 0024, so 0025 to 0029 if nothing lands between).

## 1. Scope and Done when
**Done when** (Build plan 98; `IMPLEMENTATION_PLAN.md` section 4, phase 6 row): dispensing 3 of an item a bag holds 1 of leaves it at −2 and alerts the Program Admin, Logistics and the route lead, with nothing shown to the field user during the run.

| In | PRD |
|---|---|
| Stock for phase 5's bags and for team stock; a bag's owner; a bag is counted once at set-up | main 474; Build plan 95 |
| The Orders tab: items by category (OTC, Rx, Labs, others), the in-bag list with a search bar, single items in one tap | main 104, 125, 443 |
| Suggest, then confirm: bundles and field mappings pre-fill a supply screen; the worker confirms or adjusts | main 424-431, 437-448, 471 |
| The Quick encounter's medication answers become a suggested order (phase 4 records the answers only) | main 409; forms 6.4, 6.8 |
| Deduction from the bags being carried; the app picks the bag, staff can change it | main 448, 475 |
| Dispensing past the count, or an item the bag does not list: the count goes negative, no alert in the field, three roles alerted | main 126, 472; Build plan 96 |
| The restock reminder when a bag drops below a minimum phase 5 set | main 477 |
| Every stock change logged with user, bag, item, quantity, reason, time; the supply log | main 473, 475 |
| Restock from team stock, set-up count and count correction, in the portal | main 475, 960, 961 |
| Medication orders by ordering credentials only; Medical and Non-Medical items | main 447, 450 |
| Point-of-care lab orders record the test and its result | main 104 |
| The allergy hard stop: blocks until acknowledged with a reason; offers another item; override logged | main 450, 497; Build plan 97 |
| Passive banners on the chart; never block; work offline | main 498, 501 |
| Push notifications with no names or health details | main 601, 746; Build plan 97 |

| Out | Goes to | PRD |
|---|---|---|
| Items, categories, bundles, mappings, bags' names and minimums, and their admin pages | Phase 5 owns them (phase 5 4.4, 8.1) | Build plan 90 |
| Routes, the bag check on confirm, the packing list, restock on the phone ("Restock now") | Phase 7 | main 476, 478 |
| Billing codes from an order set; the supply log in exports | Phase 10 | main 437, 473 |
| Required periodic recounts; medication distribution tracking on desktop | After the MVP (PLAN-OPEN, section 11) | main 450, 475 |
| Send-out labs and result follow-up; geofenced alerts; barcode scanning | V2 or deferred | main 104, 479, 499 |

## 2. Ground truth
What the code has today:

| Fact | Where |
|---|---|
| No inventory, order, bag, route or push table exists. Migrations stop at `0016`. | `db/migrations/` |
| `inventory.view` ("See bags, team stock and supply logs") and `inventory.manage` ("Restock bags, move stock and record recounts") exist. Program Admin and Logistics hold both; Healthcare Staff and Billing/Data hold `inventory.view` only. | `services/api/src/auth/permissions.ts` 29-30; `db/migrations/0002_identity_access.sql` 88-97 |
| `CAPABILITIES[credential]` has `chartMedical` and `orderMedications`. Attending, resident, NP and PA have both; a student charts Medical and cannot order; CHW and none have neither. | `services/api/src/auth/permissions.ts` 96-170 |
| A synced record type is one `EntityRules` module registered in `RULES`. `storeCreate` does the insert, the history rows and the audit event in the change's transaction. | `services/api/src/sync/records.ts` 380-415, 445-493; `services/api/src/sync/entities/index.ts` 20-30 |
| Every online route that writes calls `lockTeamWrites(tx, teamId)` as its first statement. | `services/api/src/sync/locks.ts` 13-17 |
| Allergies are append-only rows with `substance` (free text, 1 to 120), `category`, `severity`, `status` (`active`, `entered_in_error`). They are never merged by text. | `services/api/src/sync/entities/allergy.ts` 16-21, 26-47; `services/api/src/sync/entities/values.ts` 157-169 |
| The phone shows allergies as a badge from one rule, `allergyBadge()`. The team index holds allergies for patients off the route. | `apps/mobile/lib/design/widgets/allergy_badge.dart` 9-13; `apps/mobile/lib/patients/display.dart`; PRD main 272 |
| An append-only table with its trigger, and the team policy block every team table gets. Every table with a `patient_id` is listed in `CHART_TABLES`. | `db/migrations/0009_patients.sql` 220-243, 484-488; `services/api/src/patients/charts.ts` 24-37 |
| `encounters` has `kind` (`medical`, `non_medical`), `patient_id` (may be null), `author_user_id`. | `db/migrations/0004_sync.sql` 33-50 |
| `user_notices` (user, kind, entity, record ID, no text) and its list route exist. | `db/migrations/0004_sync.sql` 160-170; `services/api/src/routes/sync.ts` 49-65 |
| `Deps` injects `db`, `verifier`, `identityAdmin`, `log`, `now`. There is no scheduled job route. | `services/api/src/types.ts` 9-18; `services/api/src/routes/system.ts` |
| Recipes for a synced entity, shared vectors and the fake's mirror. | `docs/plan/patterns/synced-entity.md`, `shared-vectors.md`, `fake-mirror.md` |

What phases 4 and 5 deliver first (designed and checked, not built on Nov 14). Each owns what it names; this design uses its names. If one is missing when this phase starts, it is built first, as its own card.

| From | Thing | What phase 6 does with it |
|---|---|---|
| lifecycle 3.1, 3.10; D56 | Medical is a property of a note, through its type (`encounter_notes.medical`). A Non-Medical note is never signed, in any visit. A visit's kind only goes from Non-Medical to Medical and only decides what is offered. A visit with no patient holds Non-Medical notes only | An order's rules read the item and the credential. The server never judges an order by the visit's kind (5.1) |
| lifecycle 1.3, 3.5, 4.2; D58 | The Medical gate (`chartMedical`); the credential a person held at a given time (`loadSigner`, `credentialChangesAfter`) | Flags are set from the credential held when the order was made |
| lifecycle 4.1, 4.2; D59 | A refusal only for what the worker can fix, as `validation` with a `details.problem` and the store call that settles it; no new reject reason; a missing key on a push is held for a Program Admin; a rule that throws is a stored rejection; every change takes the team lock | Both new entities follow all of it (6.1, 6.2) |
| lifecycle 5.1, 5.2, 6.4; D66, D67 | The visit read `GET /v1/encounters/{encounterId}`; the chart answer's `timeline` and `recentVisits`, kept on the phone in the patient record's `_chart` field (`chart_cache.dart` names its keys by hand); `visibleAnswers`; what a reader may not see is absent, never blanked | The visit read gains `orders`; the chart answer gains `alerts` (section 7). No second read route for orders |
| lifecycle 5.6, 9.9 | `GET /v1/me/counts` gives Home's numbers and names no patient | It gains `stockAlerts` |
| lifecycle 9.1, 9.4, 9.6, 9.7, 9.13 | The profile's quick actions ("+ Order arrives in phase 6"); the note types screen; the summary screen with Complete; the visit's read view; Needs attention and `sync_labels.dart`. Code under `apps/mobile/lib/encounters/` and `lib/features/encounters/` | Section 8 hooks into these. There is no "step before signing": the supply screen opens from the summary, before Complete |
| lifecycle 3.9, 4.10 | The 24-hour alert is worked out when read and sends nothing; its push sentence is reserved. Notice kinds carry no text | The sentence joins the fixed list (section 9). One new notice kind, `order_flagged` |
| forms 6.4, 6.8; lifecycle 6.4 rule 5 | The Quick encounter's Medication section is marked `needs: 'orderMedications'`; its answers are recorded and no order is placed | A phase 5 mapping on that section suggests the order (5.1) |
| Phase 5 4.1 to 4.4 | Presets in `team_presets` and `team_preset_versions`: `order_category` (`behaviour`: `supply`, `medication`, `lab`), `item` (`name`, `categoryId`, `unit`, `medical`, `captureLot`, `result`), `bundle` (`medical`, `lines` of `itemId`, `qty`, `core`), `field_supply_map`, `bag` (`name`, `minimums` of `itemId`, `min`), `settings` (`bagMinimumsOn`). Nothing is deleted; remove means `state = 'archived'` | Orders and stock point at preset ids. This phase has no table for items, bundles, mappings, bag names or minimums |
| Phase 5 5.3 | `suggestSupplies` and `bundleLines`, in TypeScript and Dart, pinned by `supply-suggest.json` | Called as they are (5.1) |
| Phase 5 6.1, 6.4 | `GET /v1/presets`, the phone's `presets` table and `PresetsRefresher`. An order stores `item_id` and `item_version`, a bundle `bundle_id` and `bundle_version`, a mapping `map_id`; a record against an older version or an archived preset is accepted | 4.3 stores exactly these |
| Phase 5 8.1, default 14 | Bags are added, named and removed on `/team/presets/bag-minimums`. "Phase 6 adds stock and owners" | 4.1 |
| Phase 7 | Nothing | Phase 7 builds on the outing of 4.1 |

## 3. The design in one page
1. **A count is a sum, never a stored number a phone writes.** Every stock change is one immutable row with a signed quantity. Two phones offline cannot conflict, and −2 is plain arithmetic (PRD main 126).
2. **Phones send orders; the server writes the stock movement.** One synced record type carries the order and its bag, so an order and its deduction cannot disagree, and the order is stored with its encounter.
3. **The server never refuses an order for a judgment rule.** The item has already been handed over. A missed allergy or a credential that may not order is stored and flagged for review. A refusal is kept for what the worker can fix (D59): there are three, each with its fix (6.1).
4. **Medical follows the item and the credential, as phase 4 made it follow the note** (D56). A Medical item needs a credential that charts Medical; a medication also needs one that orders. The visit's kind only decides what the phone offers.
5. **Items, bundles, mappings and bags are phase 5's presets.** This phase adds what a preset cannot hold: stock, a bag's owner, outings and orders. It stores preset ids and versions and defines none of them again.
6. **The allergy check is one pure function, run twice.** The phone runs it on the allergies it holds (chart or team index); the server runs it again on what it holds. Vectors pin both.
7. **Stock alerts are rows opened and closed by arithmetic** in the transaction of the movement that crossed the line. Who sees one is worked out when it is read, so a role change needs no repair.
8. **The phone shows no counts and no stock warnings.** The order screen lists what a bag carries, not how many. That is how "no alert during the run" holds for everyone, the lead included (PRD main 126).
9. **"The route" is an outing until phase 7.** An outing is a day, a lead and the bags taken. It gives this phase the route's bags and the route lead without building routes. Phase 7 attaches a route to it.
10. **Counting is online only.** A recount is the one stock change that is not a sum. The server works out its difference under the team lock, in the portal.
11. **Banners are computed from data the phone already holds**, plus one small append-only record for alerts staff write. No banner ever blocks.
12. **Push text comes from a fixed list of sentences.** The payload type has no free-text field, so a name cannot get in. The sender is an interface; the real provider waits for accounts.
13. **No new permission keys** (D37). Every check uses keys in `services/api/src/auth/permissions.ts`. Who reads an order is one function, as `visibleAnswers` is for a note.

## 4. Data model
Five migrations, each the next free number, each with the team policy block of `0009_patients.sql` 484-488 (`team_id = sineobex.current_team_id() or sineobex.is_platform_scope()`, `using` and `with check`). All are level X (policies, triggers). IDs are `uuid`; every table has `team_id uuid not null references sineobex.teams (id)` and `created_at timestamptz not null default now()`. An item, a bundle, a mapping or a bag is a composite foreign key to phase 5's `team_presets (team_id, id)`; the API checks the preset's `kind`, as phase 5 does for `flag_id`.

### 4.1 `<n>_stock_locations_outings.sql`
| Table.column | Type | Meaning and constraint |
|---|---|---|
| `stock_locations.kind` | text | `bag` or `team_stock`; one `team_stock` row per team (partial unique index) |
| `.bag_id` | uuid null | The bag preset. Set exactly when `kind = 'bag'`, and then equal to `id`, so a bag's location ID is its preset ID. The name and whether the bag is retired are the preset's (`name`, `state`) |
| `.owner_user_id` | uuid null | A bag someone carries themselves (PRD main 474) |
| `.set_up_at`, `.set_up_by` | timestamptz, uuid null | Set by the first count; a bag is "counted once when it's set up" |
| `bag_outings.service_date` | date | The day the bags go out |
| `.lead_user_id` | uuid | The route lead for this phase's alerts |
| `.name` | text null | 1 to 80, for the picker ("North loop") |
| `.route_id` | uuid null | No foreign key yet; phase 7 adds it |
| `.ended_at`, `.ended_by` | timestamptz, uuid null | Set once, when the bags are back |
| `bag_outing_bags` (`outing_id`, `location_id`, `service_date`, `position`) | | Unique (`location_id`, `service_date`): "a bag can go on only one route a day" (PRD main 474) |

A location row is made by the server, never by a person: `ensureLocation` inserts it in the transaction of the bag's first movement, owner change or outing, after the team lock. A bag with no row has no stock yet.

### 4.2 `<n>_stock_movements.sql`
`stock_movements` is **append-only** (trigger refusing update and delete, as `patient_consents`).

| Column | Type | Meaning and constraint |
|---|---|---|
| `location_id`, `item_id` | uuid | Composite foreign keys with `team_id`; `item_id` is an `item` preset |
| `quantity` | integer | Signed, not 0, between −9999 and 9999. No check that a sum stays above 0 |
| `reason` | text | `dispense`, `void`, `restock_out`, `restock_in`, `received`, `setup_count`, `recount` |
| `order_id` | uuid null | Set for `dispense` and `void`; unique (`order_id`, `reason`), so a replay writes nothing twice |
| `pair_id` | uuid null | The two rows of one restock share it |
| `counted` | integer null | For `setup_count` and `recount`: the number counted |
| `outing_id` | uuid null | The outing the bag was on |
| `recorded_by`, `recorded_at`, `clock_verified`, `device_id`, `change_id` | | As `patient_consents` |

`stock_balances` (`team_id`, `location_id`, `item_id`, `quantity integer`, primary key on the three) is kept by an insert trigger on `stock_movements` that adds `quantity`. It may be negative. A row exists once an item has moved at a location; "the bag lists the item" means the row exists. A minimum is not stored here: it is read from the bag preset's `minimums`, and counts only while `settings.bagMinimumsOn` is true (phase 5 4.4).

`stock_alerts`: `location_id`, `item_id`, `kind` (`negative`, `below_minimum`), `opened_at`, `opened_by_movement_id`, `opened_by_user_id`, `outing_id` null, `closed_at` null, `closed_by_movement_id` null. Partial unique index on (`location_id`, `item_id`, `kind`) where `closed_at is null`: one open alert of a kind per item per location. Only `closed_*` ever change.

### 4.3 `<n>_encounter_orders.sql`
`encounter_orders`: one row per item given or test done. Only the void columns and `review_flags` change after insert.

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid | Made on the phone |
| `encounter_id` | uuid | Foreign key with `team_id`; the patient is the encounter's (may be none) |
| `item_id`, `item_version` | uuid, integer | The item preset and the version the phone held (phase 5 6.4) |
| `quantity` | integer | 1 to 999, in the item's `unit` (PRD main 127) |
| `location_id` | uuid null | The bag or team stock it came from; null means team stock |
| `outing_id` | uuid null | Stored null when the server does not know it |
| `source` | text | `manual`, `bundle`, `mapping` |
| `bundle_id`, `bundle_version`, `map_id` | uuid null, integer null, uuid null | Where a suggested line came from (phase 5 6.4); for phase 10's codes |
| `note_id` | uuid null | The note a mapping fired on, set exactly when `map_id` is: the line is read as that note is read (`orderVisibleTo`), since what it gives tells what the note recorded (phase 5 4.4, BM-77) |
| `lab_result` | text null | 1 to 120: one of the item's `result` options, or a number as text; only for an item with a `result` (PRD main 104) |
| `lot`, `expiry` | text null (1 to 40), date null | For an item with `captureLot` (PRD main 426) |
| `override_allergy_ids`, `override_reason` | uuid[] null, text null (3 to 300) | Both or neither |
| `review_flags` | text[] not null default `{}` | Subset of `allergy_unchecked`, `needs_medical_credential`, `needs_ordering_credential`; set by the server only |
| `voided_at`, `voided_by`, `void_reason` | | Set once |
| `author_user_id`, `ordered_at`, `clock_verified`, `created_device_id`, `change_id`, `version`, `field_versions`, `field_meta` | | As `patient_allergies` |

The migration also replaces `patient_of_change` with a version that has a branch for `encounter_order` (through its encounter) and for `patient_alert`, as phase 5's 0024 does for its entity. No migration touches a preset table. The allergy check's terms are a new optional field of the `item` body, `allergenTerms` (0 to 20 terms of 2 to 60 characters, default none), added to phase 5's schema and Dart parser as phase 5's risk 3 asks: optional, with a default in both.

### 4.4 `<n>_patient_alerts.sql`
`patient_alerts`: `id`, `patient_id` (composite foreign key), `kind` (`safety`, `clinical`, `other`), `text` (1 to 200), `sensitive boolean`, `author_user_id`, `recorded_at`, `clock_verified`, `device_id`, `change_id`, and the set-once `ended_at`, `ended_by`, `end_reason`. Listed in `CHART_TABLES` as `group`, so a merged chart shows both sides' alerts (D27).

### 4.5 `<n>_push.sql`
| Table | Columns |
|---|---|
| `device_push_tokens` | `device_id` (primary key, references `devices`), `user_id`, `platform` (`android`, `ios`), `token` text (1 to 4096), `updated_at`. Deleted when the device is wiped or the user removed |
| `push_outbox` | `user_id`, `message_key` text, `count` integer, `not_before` timestamptz, `outing_id` null, `dedupe_key` text unique, `sent_at` null, `attempts` integer, `last_error` text null (a code, never provider text) |

`push_outbox` has no column that could hold a name, an item or free text. A schema test pins its column list.

## 5. Rules
### 5.1 An order
| State | Reached by | Who | Offline |
|---|---|---|---|
| Suggested (phone memory only, never stored) | A bundle is applied (`bundleLines`), or a mapping fires on a note the person acts as the author of (`suggestSupplies` over the answers that count; phase 5 5.3) | The person charting | Yes |
| Ordered | Confirm on the supply screen, or one tap on a single item | `encounters.chart`. A Medical item (`medical` true: every medication and test, phase 5 4.4) also needs a credential with `chartMedical`; an item in a `medication` category also `orderMedications` | Yes |
| Voided | "Remove", with a reason | The order's author only | Yes |

There is no edit. A wrong quantity is a void and a new order. An order is accepted whatever state its encounter and notes are in, and it is outside every note's content hash, so it never changes what was signed (D57).

**What the phone offers** (`itemOffered`, 5.3). A Medical item or bundle is listed only in a visit whose kind is Medical and that has a patient (lifecycle 3.10), to a credential with `chartMedical`. A medication is listed but disabled for a credential that may not order. A CHW adding a Social needs note to a teammate's Medical visit is offered Non-Medical items only. **What the server checks.** The credential only, as held when the order was made (lifecycle 4.2), and it flags, never refuses. It does not read the visit's kind: a teammate's switch to Medical may not have synced yet (D56).

**The Quick encounter.** Its Medication section is shown only to an ordering credential (forms 6.4). A phase 5 mapping on that section's fields turns its answers into a suggested line, which goes through the allergy check and Confirm like any other.

### 5.2 Stock
| Movement | Who | Where | Effect on the sum |
|---|---|---|---|
| `dispense` | Written by the server for each order | Sync | −quantity at the order's location |
| `void` | Written by the server when an order is voided | Sync | +quantity at the same location |
| `restock_out` and `restock_in` | `inventory.manage` | Portal | −q at team stock, +q at the bag, one `pair_id`. From outside: `restock_in` alone |
| `received` | `inventory.manage` | Portal | +q at team stock |
| `setup_count` | `inventory.manage`, on a bag never set up | Portal | counted − current sum |
| `recount` (a correction) | `inventory.manage` and `team.manage_presets` (Program Admin, not Logistics: PRD main 961) | Portal | counted − current sum |

After every movement the server reads the balance before and after and the bag's minimum, calls `alertEffect`, and opens or closes alert rows in the same transaction. An alert is never edited by a person. A minimum changed in the portal takes effect at the item's next movement ("after an encounter or a recount", PRD main 477).

### 5.3 The pure functions
Each is written once in TypeScript and once in Dart, with no database or network, and is tested against one hand-written vector file both sides read (`docs/plan/patterns/shared-vectors.md`). `suggestSupplies` and `bundleLines` are phase 5's and are not written again.

| Vector file (`packages/contract/test-vectors/`) | Function: inputs → output | TypeScript | Dart |
|---|---|---|---|
| `stock-rules.json` | `alertEffect({before: int or null, after: int, minimum: int or null})` → `{open: kind[], close: kind[]}`. `negative` opens when `after < 0` and `before` was null or ≥ 0; closes when `before < 0` and `after ≥ 0`. `below_minimum` likewise against `minimum`, never when `minimum` is null (no minimum set, or minimums are off) | `services/api/src/inventory/rules.ts` | none |
| | `countDelta({counted, current})` → int (`counted − current`; 0 means write nothing) | same | none |
| | `outingOver({serviceDate, endedAt, now})` → bool: `endedAt` set, or `now` ≥ the service date's UTC midnight + 36 h | same | `apps/mobile/lib/inventory/rules.dart` |
| | `alertVisibleTo({surface, hasInventoryView, hasInventoryManage, isLead, hasOuting, outingOver})` → bool. Portal: `hasInventoryView`. Phone: (`hasInventoryManage` or `isLead`) and (not `hasOuting` or `outingOver`) | same | same |
| | `pickLocation({itemId, bags: [{id, items: [{itemId, inStock}]}], teamStockId})` → location ID: the first bag where the item is in stock; else the first that lists it; else the first bag; with no bags, team stock | none | same |
| `order-rules.json` | `mayOrderItem({itemMedical, behaviour, chartMedical, orderMedications})` → flags: `needs_medical_credential` when the item is Medical and `chartMedical` is false; `needs_ordering_credential` when `behaviour` is `medication` and `orderMedications` is false | `services/api/src/orders/rules.ts` | `apps/mobile/lib/orders/rules.dart` |
| | `itemOffered({visitKind, hasPatient, itemMedical, behaviour, chartMedical, orderMedications})` → `listed`, `disabled` or `hidden` (5.1) | none | same |
| | `orderProblem(value, item)` → null or `result_invalid`: a result on an item with no `result`, an option the item does not have, or text that is not a number for a number result | same | same |
| | `orderVisibleTo({itemMedical, isAuthor, canViewPatients, canChart, canViewCodes, fromNote})` → bool: the author always; a line a mapping suggested (`fromNote` is `{readable}`, whether `visibleAnswers` gives the reader that note) only when its note is readable, whatever its item; otherwise a Non-Medical item with `patients.view`; a Medical item as a Medical note is read (lifecycle 6.4): `patients.view` with `encounters.chart` or `billing.view_codes` | same | same |
| `allergy-check.json` | `allergyMatches({itemName, allergenTerms, allergies: [{id, substance, status}]})` → sorted allergy IDs. Rule in 5.4 | `services/api/src/orders/allergy-check.ts` | `apps/mobile/lib/orders/allergy_check.dart` |
| | `allergyOutcome({matches, overrideIds})` → `clear`, `overridden` (every match is in `overrideIds`) or `unchecked` | same | same |
| `chart-banners.json` | `chartBanners({allergyScreen, alerts, canSeeSensitive, labOrders, today})` → ordered `[{key, tone, alertId?}]` (5.5) | `services/api/src/alerts/banners.ts` | `apps/mobile/lib/alerts/banners.dart` |
| `push-messages.json` | `pushMessage(key, count)` → `{title, body}` from the list in section 9 | `services/api/src/push/messages.ts` | none |

### 5.4 The allergy hard stop
- **Match.** Normalize the item name, each of the item's `allergenTerms` and each active allergy's substance with the pinned name normalization (D43; `packages/contract/test-vectors/normalize.json`) and split into words. An allergy matches when a term (or the item name) and the substance are equal, or one is a run of whole words inside the other. A side shorter than 3 characters matches only when equal. Allergies marked entered in error never match. All categories are checked.
- **When.** Before every order of an item that is in a `medication` category or has any allergen term, single or in a bundle (PRD main 447, 450). A bundle with a matching line stops before any line is ordered.
- **On the phone.** `allergyOutcome` is not `clear` → the hard stop screen (8.3). "Choose something else" returns to the list. "Give anyway" needs a reason and stores `allergyOverride {allergyIds, reason}` on the order.
- **On the server.** The same two functions over the server's allergies for the encounter's patient group. `clear`: stored. `overridden`: stored, audit `order.allergy_override`. `unchecked` (the phone did not hold the allergy): stored with the flag `allergy_unchecked`, the receipt says so, the author gets a notice, audit `order.flagged`. Never refused.
- **No patient, or allergies "not asked".** The check has nothing to match. No stop; a passive banner says the allergies are not known (5.5). A visit with no patient is offered no Medical item (5.1).

### 5.5 Passive banners
`chartBanners` returns, in this order: active `safety` alerts; "Allergies not asked yet" when `allergyScreen` is `not_asked` and there is no allergy; active `clinical` alerts; a point-of-care result recorded in the last 7 days ("New test result"), from the orders the reader may see; `other` alerts. An alert marked sensitive is absent, never blanked, unless the reader holds `patients.view_sensitive` or wrote it. The banner about being unable to consent (phase 3) stays where it is.

Adding an alert (`kind`, `text`, `sensitive`) and ending one with a reason both need `encounters.chart`, and both work offline.

## 6. Sync
Both entities follow lifecycle 4.1 and 4.2: no new reject reason (a refused rule is `validation` with a `details.problem`); every change takes the team lock (D32); a sender without the key is held for a Program Admin, never refused; a throw while reading a preset body or running a check is caught and stored as `validation`, `preset_error`, so no fault here stops a queue.

### 6.1 `encounter_order`
Create value (strict): `encounterId`, `itemId`, `itemVersion`, `quantity`, `locationId` (null allowed), `outingId` (null allowed), `source`, `bundleId`, `bundleVersion`, `mapId`, `noteId` (with `mapId` exactly, a note of the same visit), `labResult`, `lot`, `expiry` (a date), `allergyOverride` (`{allergyIds: 1 to 30 IDs, reason: 3 to 300}` or null). One settable field: `voided` (`{reason}`, class `set_once`, the `Retraction` shape of `values.ts`). Permission `encounters.chart` for create and for `voided`; `mayChange` for `voided` is the order's author. Parent: the encounter (missing: held as `encounter_missing`, as today). Clock pause: follows encounters (D35). Sync read: `encounters.chart`, then `orderVisibleTo`; an order the reader may not see is absent.

| Case | The server answers |
|---|---|
| Valid; rules pass | `accepted`, version 1. One `dispense` movement; `alertEffect` applied. No details about stock, ever |
| `mayOrderItem` returns a flag for the credential held at the order's time | `accepted`, flagged; details `{flags: [...]}`; notice `order_flagged` to the author |
| Allergy outcome `overridden` | `accepted`; audit `order.allergy_override` |
| Allergy outcome `unchecked` | `accepted`, flagged; details `{flags: ['allergy_unchecked']}`; notice to the author |
| The item, bundle or mapping is archived or at an older version; the bag is archived; the encounter is finished; `outingId` is unknown | `accepted` (phase 5 6.4; an unknown outing is stored as null) |
| `itemId` is not an item of the team (a build fault: the phone offers only items the server sent) | Refused `validation`, problem `unknown_item`. The fix: **Choose the item again**; the store sends the same record with the item chosen, as phase 5 settles `unknown_flag` |
| `locationId` is not a bag or the team stock of the team (a build fault) | Refused `validation`, problem `unknown_bag`. The fix: **Choose the bag again**; the same record is sent with the bag chosen |
| `orderProblem` returns `result_invalid` | Refused `validation`, problem `result_invalid`. The fix: **Enter the result again**; the same record is sent with the result |
| The value fails the wire schema | The wire schema's answer, naming the change (D51). The screens cannot send one |
| The same change again | The stored receipt; the unique (`order_id`, `reason`) index means no second movement |
| `voided` set | `accepted`; one `void` movement; `alertEffect`; audit `order.voided`. A second set: the `set_once` answer. From someone who is not the author: stored with no effect and a notice (`change_not_applied`, lifecycle 4.1) |

All three checks run before the insert, so a foreign key never throws.

### 6.2 `patient_alert`
Create value: `patientId`, `kind`, `text`, `sensitive`. Field `ended` (`{reason}`, `set_once`). Permission `encounters.chart`; parent the patient (unknown yet: held behind the patient's create); no clock pause (as allergies, D35); sync read needs `patients.view`, and a sensitive alert also `patients.view_sensitive` unless the reader wrote it. No rule refuses: the only failures are the wire schema's. A late create naming a merged patient is stored as sent (D27). Audit `patient_alert.created` and `.ended`.

### 6.3 What the phone test server must mirror (`apps/mobile/test/sync/fake_server.dart`, level X)
Each is pinned to the API's answer in `fake_parity_test.dart` (D52): both create schemas and `orderProblem`; the three problems of 6.1 with their names; accept-and-flag for the three flags, with the same receipt details; the allergy re-check over the fake's allergies; the fake's own movement list and balances (so a test can read −2); alert rows opened and closed by `alertEffect`'s vectors; `voided` as `set_once` by the author; the read rule of each entity; `orders` in the visit read; `GET /v1/inventory/field-bundle`; no stock detail in any receipt.

### 6.4 What a phone holds
| Data | How it arrives | When it leaves |
|---|---|---|
| Items, categories, bundles, mappings, bags' names (with `allergenTerms`) | Phase 5's `GET /v1/presets`, in its `presets` table | Phase 5's rule: with the team database |
| Today's and tomorrow's outings, and per bag the items it lists with `inStock` (no numbers) | `GET /v1/inventory/field-bundle` after each sync (an `AfterSyncRefresher`), stored whole in a new table `inventory_bundle` of the team database | Replaced whole; with the team database |
| The outing the worker chose today | Phone only, kept in memory and re-asked after a restart | End of day |
| Allergies | Already there: the chart, or the team index (PRD main 272) | With the chart or index |
| Patient alerts | The chart answer's `alerts`, in the patient record's `_chart` field (D44; `chart_cache.dart` gains the key), plus the phone's own unsynced alerts | With the chart (D46) |
| Own orders | The local store, with their encounter | With the encounter, after a hash-confirmed receipt (D23) |
| Orders of the last three visits | Inside `recentVisits` (lifecycle 5.2), as the visit read answers them | With the chart |

A phone with no field bundle (first sign-in offline) still orders: `pickLocation` returns team stock (`locationId` null). Nothing a phone holds for this phase is in `kv` or names a patient outside a chart.

## 7. API routes that only work online
All follow `docs/plan/patterns/api-route.md`. **Every route that writes calls `lockTeamWrites` as its first statement**, as every online writer does (lifecycle 5), then writes and audits in one transaction. Every refusal is the standard 403 with the key it lacked, logged, or a code shown to a person at a desk who can fix it; none reaches a phone's queue. Each write carries a client `requestId`; the same one again returns the first answer. No path, query or log line carries a patient ID or an item name.

| Route | Key | Request → answer | Refusals | Audit event |
|---|---|---|---|---|
| `GET /v1/inventory/locations` | `inventory.view` | → team stock and every bag preset, A–Z, with name, owner, set-up state, item counts and open alerts | | none (no patient data) |
| `PATCH /v1/inventory/locations/{id}` | `team.manage_presets` | `{ownerUserId or null}` → the location. A bag is added, renamed and removed by phase 5's preset routes, not here | `owner_not_member`, `team_stock_fixed` | `inventory.bag_owner_set` |
| `GET /v1/inventory/locations/{id}/stock` | `inventory.view` | → items with balance and minimum | | none |
| `POST /v1/inventory/restocks` | `inventory.manage` | `{bagId, source: team_stock or outside, lines: [{itemId, quantity}]}` → new balances | `bag_archived`, `item_unknown` | `inventory.restocked` (bag, line count, total) |
| `POST /v1/inventory/receipts` | `inventory.manage` | `{lines}` into team stock → balances | `item_unknown` | `inventory.received` |
| `POST /v1/inventory/counts` | `inventory.manage`; a count of a set-up location also `team.manage_presets` | `{locationId, lines: [{itemId, counted}]}` → balances; under the team lock the server reads the balances and uses `countDelta` | `item_unknown` | `inventory.set_up` or `inventory.recounted` (lines, how many changed) |
| `GET /v1/inventory/movements` | `inventory.view` | filters (location, item, reason, dates), keyset pages → the supply log. `encounterId` only for a caller with `patients.view` | | `inventory.log_viewed` when encounter IDs were returned |
| `GET /v1/inventory/outings?date=`, `POST /v1/inventory/outings` | `routes.view`; `routes.manage` | `{serviceDate, leadUserId, name, bagIds}` → the outing | `bag_taken` (already out that day), `bag_archived`, `lead_not_member` | `inventory.outing_created` |
| `POST /v1/inventory/outings/{id}/end` | `routes.manage`, or its lead with `routes.view` | → ended; held pushes for it are released | `already_ended` | `inventory.outing_ended` |
| `GET /v1/inventory/field-bundle` | `inventory.view` | → section 6.4's bundle, with a version | | none |
| `GET /v1/inventory/alerts?surface=` | `inventory.view`, or a lead with `routes.view` | → open alerts that `alertVisibleTo` allows this caller | | none |
| `GET /v1/me/counts` (phase 4's, lifecycle 5.6) gains `stockAlerts` | as today | the number of alerts `alertVisibleTo` allows this caller on the phone. Names no patient, so it logs none | as today | none |
| `GET /v1/encounters/{encounterId}` (phase 4's visit read, lifecycle 5.1) gains `orders` | as today (`patients.view`) | each order `orderVisibleTo` allows, with item ID and version, quantity, result, lot, flags and void. An order the reader may not see is absent. It rides in `recentVisits` too | as today | phase 4's `encounter.viewed` gains the order IDs shown |
| `GET /v1/patients/{patientId}` (the chart answer) gains `alerts` | as today | active and ended alerts; a sensitive one is absent without `patients.view_sensitive` | as today | as today |
| `GET /v1/team/orders-to-review` | `team.view_audit` | → orders with a review flag or an override: IDs, flags, author, time | | `order.review_viewed` (`patientIds`) |
| `PUT` and `DELETE /v1/devices/{deviceId}/push-token` | the signed-in user's own device | `{platform, token}` → 204 | `not_your_device` | `push.token_registered`, `.token_removed` |

**Push: built now.** The two tables; the token routes; `PushSender` (`send(token, platform, {title, body})`) added to `Deps` with a sender that does nothing and a recording one for tests; `queuePush` (one outbox row per recipient, same transaction as the alert, `dedupe_key` = user + message + hour, so a burst is one push with a count); `drainPush`, called after a sync request commits and never failing it; on the phone a `PushTokenSource` interface with an empty implementation. **Waits for accounts** (`IMPLEMENTATION_PLAN.md` section 7: Apple, Google, and a push provider project): the real sender, the phone plugin and its permission prompt, a scheduled drain.

## 8. Screens
The PRD gives wording only for the list (main 125), the kit stepper "− 2 kits +" (main 442) and "2 tasks due today" (main 746). All other wording below is a default for Brooke and Mercy (section 11). Every screen is tested in Day, Night run and High contrast, at narrow width, and offline.

| Phone screen | Shows | States and wording |
|---|---|---|
| 8.1 Bags today | The day's outings, each with its bags | "Which bags are you carrying today?"; none: "No bags set for today. Supplies will come from team stock."; not downloaded: the same sentence |
| 8.2 Orders (a tab on phase 4's note types screen, lifecycle 9.4; also "+ Order" on the profile, lifecycle 9.1, which opens the person's open visit or phase 4's Start) | Category chips (OTC, Rx, Labs, others); a scrollable list of the items the chosen bags list, with a search bar; "All items" for the rest of the active items; bundles | No numbers, no stock colour. What is listed follows `itemOffered` (5.1): Medical items and bundles only in a Medical visit with a patient, for a credential that charts Medical. No ordering credential: medication rows are disabled with "Needs an ordering credential". One tap on an item orders 1 |
| 8.3 Allergy hard stop | Full screen, not dismissible by tapping outside | Title "Allergy warning". Body "This patient has a recorded allergy to {substance} ({severity}). {item} may cause a reaction." Buttons "Choose something else" and "Give anyway". "Give anyway" opens "Why is it safe to give?" (3 characters at least), then "Record and give" |
| 8.4 Supply screen (opened from phase 4's summary screen, lifecycle 9.6, by a "Supplies" row above Complete; never a condition of Complete) | Suggested lines from the person's own notes: checkbox, item, unit, stepper, bag chip (tap to change) | Core lines checked, optional unchecked. Buttons "Confirm supplies" and "Nothing given". After confirm: "Saved", whatever the bag holds |
| 8.5 Given in this visit (on the Orders tab, and under the notes in phase 4's read view of a visit, lifecycle 9.7) | Order rows the reader may see; lab rows with "Result"; rows of an item with `captureLot` with "Lot" and "Expiry" | "Remove" asks "Why remove it?". A flagged row: "An allergy to this was recorded after it was given. Tell the clinician in charge." or "This needed a credential you didn’t hold. Your Program Admin will review it." |
| 8.6 Banners on the chart | `chartBanners`, one line each, icon and text, never colour alone | "Add an alert" (kind, text, "Only for staff who see sensitive details"); "End alert" with a reason |
| 8.7 Home: a **Supplies to restock** tile beside phase 4's tiles (lifecycle 9.9) | For a lead or `inventory.manage`, only what `alertVisibleTo` allows on the phone; the number is `stockAlerts` of `GET /v1/me/counts` | "{n} supply items need a restock"; opens a list of bag and item, no counts of patients |
| 8.8 Needs attention (lifecycle 9.13) | `sync_labels.dart` gains one sentence and one button for each problem of 6.1, and the sentence of the `order_flagged` notice | A held change shows "Sent for review", as phase 4's do |

| Portal page | Key | Shows |
|---|---|---|
| Inventory | `inventory.view` | Team stock and bags, A–Z, a search box (PRD main 473); negative counts shown as numbers with the word "short". "Add bag" links to phase 5's Bag minimums page |
| A bag | `inventory.view` | Items, balance, minimum, open alerts, owner; "Restock" and "Count" for those who may; "Change owner" with `team.manage_presets` |
| Restock, Receive, Count forms | section 7's keys | A stepper or typed number per line; an item the bag does not carry can be added; the Save button stays pinned (PRD main 950, 960) |
| Supply log | `inventory.view` | User, bag, item, quantity, reason, time (PRD main 475); filters |
| Bags out today | `routes.view`; create with `routes.manage` | Outings by day, lead, bags; "End" |
| Restock alerts, and a count on Home | `inventory.view` | Open alerts: bag, item, balance, since when, who was out with it |
| Orders to review | `team.view_audit` | Flagged and overridden orders, with a link to the chart |
| Patient page; phase 4's visit page (lifecycle 9.11) | `patients.view` | The same banners as the phone, computed by the server; the visit's orders from the visit read |
| Phase 5's item form (`/team/presets/items/[id]`) | `team.manage_presets` | One more box: "Allergy words", with "Words that should stop an order, for example penicillin." |

## 9. Audit events and the PHI rules that apply
Every event is written in the transaction of the change it records (`ctx.audit`, or the route's transaction). Details carry IDs, counts, codes and flags only.

| Event | Written when | Details |
|---|---|---|
| `order.created`, `order.voided` | The sync change applies | `changeId`, `itemId`, `quantity`, `locationId`, `source`; patient ID in the event's own column |
| `order.allergy_override` | An order with a matching override is stored | `allergyIds`, `itemId`, `reasonLength` (never the reason) |
| `order.flagged` | The server sets a review flag | `flags`, `itemId` |
| `inventory.alert_opened`, `.alert_closed` | `alertEffect` says so | `alertId`, `locationId`, `itemId`, `kind`, `balance`, `recipientCount` |
| `patient_alert.created`, `.ended` | The sync change applies | `kind`, `sensitive` (never the text) |
| Section 7's events | As listed | As listed |

- The supply log is `stock_movements` itself: append-only, so it needs no second copy in the audit chain.
- An override reason, an alert's text and a lab result are patient details. They live in their rows, reach only readers of the chart, and never enter audit details, logs, URLs, page titles, notices or pushes. The `order_flagged` notice is a kind and a record ID, with no text (lifecycle 4.10).
- A stock alert names a bag and an item, never a patient or an encounter. Home's number comes from `GET /v1/me/counts`, which names no patient, so opening Home logs none.
- Push sentences, the whole list: `stock_alert`: "Supplies to review" / "{n} supply items need a restock."; `note_incomplete`: "Notes" / "A note is waiting to be finished." (reserved by phase 4, lifecycle 3.9; nothing queues it in this phase, because that alert is worked out when read and no scheduled job exists); `tasks_due`: "Tasks" / "{n} tasks due today" (PRD main 746). Nothing else can be sent.

## 10. Tests
The Done when, as steps. It runs three times: against the API (`services/api/test/inventory-done-when.test.ts`), on the phone against the fake (`apps/mobile/test/orders/done_when_test.dart`), and on the phone against the real API (the live job).

| # | Step | Asserted |
|---|---|---|
| 1 | A Program Admin adds a bag (phase 5's route) and sets it up with 1 of a Non-Medical supply item (portal route) | Balance 1; one `setup_count` movement; no alert |
| 2 | Logistics creates today's outing: that bag, a Healthcare Staff lead | The field bundle lists the item as in stock, with no number |
| 3 | The lead's phone goes offline, opens a visit and orders 3 | The order is in the local store with its encounter; the screen says "Saved"; no dialog, banner, snack bar or badge mentions stock (widget test) |
| 4 | The phone syncs | Receipt `accepted`, hash matches, no details; the order leaves the outbox |
| 5 | Read the server | Balance −2; one `dispense` movement of −3; one open `negative` alert; `inventory.alert_opened` in the same transaction |
| 6 | Read alerts as each person, portal surface | The Program Admin and Logistics see it. Outbox rows exist for all three; the lead's has `not_before` after the outing |
| 7 | Read alerts and `/v1/me/counts` as the lead, phone surface, during the outing | Empty, and `stockAlerts` is 0. The recording sender has sent nothing to the lead |
| 8 | End the outing; drain | The lead sees the alert on the phone; all three pushes sent, each body equal to `pushMessage`'s text |
| 9 | Logistics restocks 5 | Balance 3; the alert is closed by that movement |

| Rule | Test that holds it (revert the rule, see it fail) |
|---|---|
| A count is a sum; two phones cannot conflict | Two phones each order 1 of a bag's last item offline, sync in either order: balance −1, one open alert (`sync-orders.test.ts`, `sync_scenarios_test.dart`) |
| `stock_balances` equals the sum of movements; movements cannot be changed | DB test over random movements; update and delete refused |
| A replayed order moves stock once | Send the change twice: one movement |
| An order is never lost | Order offline, kill the app before sync, reopen, sync: stored once, receipt hash matches |
| A judgment rule never refuses; the visit's kind is never judged | Vectors for `mayOrderItem` and `itemOffered`; each flag case is `accepted` with the flag, on the API and the fake; a Medical item ordered before a teammate's switch to Medical syncs is accepted with no flag; a credential lowered after the order gives no flag |
| No refusal a worker cannot fix; no fault stops a queue | Each problem of 6.1 is settled by its store call and the queue continues; a preset body that throws is a stored `preset_error`, and the next change applies |
| The hard stop | `allergy-check.json` (PCN against "penicillin" terms, entered in error, short words, word runs); widget test: no order is created until a reason is recorded; server test: allergy added by a second phone gives `allergy_unchecked` |
| The off-route patient | The hard stop fires from team-index allergies with no chart downloaded |
| Audit in the same transaction; the team lock first | Force the audit insert to fail: no order, no movement, no alert row. Each writing route is seen to take the lock before its first read |
| No stock detail reaches a field user | Receipts carry no stock keys (API and fake parity); `alertVisibleTo` vectors |
| No patient detail in a push or audit | `push_outbox` column pin; a scan of every new event's details for the seeded name, item text, reason and alert text; `/v1/me/counts` writes no audit row |
| Permissions, and who reads an order | One refusal test per route and key; the count correction refused for Logistics; `orderVisibleTo` vectors; a Medical item's order, and a Non-Medical line a mapping suggested from a Medical-only note, are absent from the visit read, `recentVisits` and the sync read for the CHW preset |
| Sensitive alerts | Absent for a role without `patients.view_sensitive`, in the chart answer, the sync read and `chartBanners` vectors |
| Accessibility | Each new screen in three themes at narrow width (phone golden and semantics tests; Playwright and axe) |

## 11. Defaults chosen (PLAN-OPEN) and questions for people
| Question | Default | Who decides |
|---|---|---|
| Who counts as "Program Admin" and "Logistics" for an alert, with custom roles and no new keys? | Everyone holding `inventory.manage`, plus the outing's lead. It follows the person who can restock | Project lead |
| What is "the route" before routes exist? | An outing: a day, a lead, bags. Phase 7 attaches its route | Project lead |
| When is a run over, for the lead's alert? | When the outing is ended, or 36 hours after the service date's UTC midnight | The team |
| Does a field user see how many a bag holds? | No numbers on the phone; "in the bag" or not | Brooke and Mercy |
| Is an admin on the run pushed at once? | Only the lead's push is held; others with `inventory.manage` get it at once | Brooke and Mercy |
| Who may give a bag an owner? | `team.manage_presets`, the key that adds a bag in phase 5 ("Admins can add bags", PRD main 474) | Project lead |
| Who may dispense? | `encounters.chart`; check-ins (phase 9) decide for CHWs | Brooke and Mercy |
| What makes an order Medical: the visit, a note or the item? | The item's `medical` switch and the orderer's credential (`chartMedical`; `orderMedications` for a medication). The phone also asks for a Medical visit with a patient; the server does not judge the kind. No Medical note need exist in the visit | Brooke and Mercy |
| A Medical item ordered under a credential lowered while the phone was offline | Stored and flagged, because the item has left the bag. Phase 4 holds a note change for a Program Admin in the same case (lifecycle 4.2); an order held would leave the count and the chart wrong until someone acted | Project lead |
| Is an order part of what a signature covers? | No. It is outside the content hash (D57) and can be added or removed after signing; the visit shows when | Brooke and Mercy; counsel |
| Who reads an order, and is a test result (a pregnancy test) a sensitive detail? | A Medical item's order is read as a Medical note is; there is no sensitive mark on an item, so a result is not hidden from a clinical reader | Counsel; Brooke and Mercy |
| What does the hard stop match on? | The item's name and admin-set `allergenTerms` against every active allergy, all categories; no drug-class dictionary | Brooke and Mercy |
| What is the "alternative" of Build plan 97? | The button "Choose something else"; the app suggests no drug | Brooke and Mercy |
| Hard stop and screen wording; override reason length | Section 8; 3 to 300 characters, free text | Brooke and Mercy |
| An order the server finds unsafe after the fact | Stored and flagged, never refused; the author and `team.view_audit` are told | Counsel, then Brooke and Mercy |
| Who may void an order? | Its author only | Brooke and Mercy |
| Banner kinds; how long a test result is "new" | `safety`, `clinical`, `other`; 7 days | Brooke and Mercy |
| Is TB or HIV status in a banner a sensitive detail? | The author marks it; marked ones need `patients.view_sensitive` | Counsel |
| Restocks from outside team stock (open in PRD main 967) | Allowed, as `source: outside` | The team |
| Push provider | Firebase Cloud Messaging for both platforms, generic text only | Project lead, counsel (no BAA covers it) |

Questions with no default, which need a person: (1) accounts for the push provider, Apple and Google, and who owns them; (2) whether counsel accepts any push at all through a provider without a BAA, given fixed text; (3) whether required periodic recounts and desktop medication distribution tracking (PRD main 450, 475) are in the MVP, and in which phase; (4) which fields of the Quick encounter's Medication section the platform's default mapping reads (phase 5's question 2 covers the other note types).

## 12. Risks, and where the design departs from the PRD or reads it a particular way
1. **Phases 4 and 5 are designed, not built.** Section 2's second table is their designs as they read on Nov 14. This phase adds one field to phase 5's item body and one key each to three of phase 4's answers (the visit read, the chart answer, `/v1/me/counts`); if either build changes those, the cards that touch them are checked again.
2. **The outing overlaps phase 7.** If phase 7 models routes differently, `bag_outings` becomes a view over routes. It is two small tables, chosen so that the Done when's "route lead" is real now.
3. **Reading: "no alert during the run" means no stock signal on any phone** while the outing runs, the lead's included (PRD main 126). The PRD names the lead among those alerted; this design alerts the lead after the run.
4. **Departure: the phone shows no counts.** The PRD's "in-bag items" (main 125) is read as "items the bag lists". A shown count would turn negative and act as an alert.
5. **Departure: an unsafe order is stored, not blocked, by the server.** The hard stop blocks on the phone (PRD main 497). The server cannot block what has been handed over; it flags it.
6. **Reading: "needs a Medical encounter and an ordering credential" (PRD main 447) is enforced as phase 4 enforces Medical.** The phone offers a Medical item only in a Medical visit; the server checks the credential and never the kind (D56). "No orders" in Non-Medical work (PRD main 379) is read as no Medical items; supplies still deduct.
7. **Text matching misses.** "PCN" matches only if an admin lists it as a term. A miss shows no stop. The allergy badge stays on screen while ordering, and phase 5's platform items should ship terms for common drugs.
8. **The fake grows a stock ledger** (plan risk 7). Its parity tests are part of unit I1, not later.
9. **Push is unproven until accounts exist.** Everything up to the sender is tested; delivery is not.

## 13. Units and a first card list
Units: I1 schema, rules and sync; I2 inventory routes; I3 push; I4 phone orders; I5 phone banners and alerts; I6 portal; I7 the Done when and the close. The names share nothing with phase 4's units (F, E, L) or phase 5's (P). A card's ID is its unit and a short name. Each unit with T cards has one `tests` card (level X) that writes those cards' test files and vectors first. I1 lands first, alone, with CI green. Then I2 and I3 side by side, then I4 and I5, then I6, then I7. Levels follow `docs/plan/README.md`: an always-X path is X, a screen, a widget or a page is R, and S is kept for a card whose every mistake a machine check catches. A contract card regenerates the contract after its unit's routes or schemas. Files an earlier phase also edits, its cards first: `api/app.ts`, `api/routes/sync.ts`, `api/routes/encounters.ts`, `api/encounters/{read,counts}.ts`, `api/patients/{charts,projection,schemas}.ts`, `api-test/permissions.test.ts`, `db/seed/seed.ts`, `presets/src/schemas.ts`, `phone/presets/models.dart`, `phone/sync/{entities,local_store,local_db}.dart`, the fake, `chart_cache.dart`, `home_screen.dart`, `patient_screen.dart`, `sync_labels.dart`, phase 4's note types, summary and visit screens, phase 5's item page, the generated contract. Short paths: `api/` is `services/api/src/`, `api-test/` is `services/api/test/`, `phone/` is `apps/mobile/lib/`, `phone-test/` is `apps/mobile/test/`, `presets/` is `packages/presets/`, `vectors/` is `packages/contract/test-vectors/`, `portal/` is `apps/portal/src/app/(app)/`, `fake` is `phone-test/sync/fake_server.dart`.

| Card | Level | Files | Needs |
|---|---|---|---|
| I1-migration-locations | X | `db/migrations/<n>_stock_locations_outings.sql`, `db/test/stock-locations.test.ts` | phase 5's P0-migration |
| I1-migration-movements | X | `<n>_stock_movements.sql` (append-only trigger, balances trigger, alerts), `db/test/stock-movements.test.ts` | I1-migration-locations |
| I1-migration-orders | X | `<n>_encounter_orders.sql` (with `patient_of_change`), `db/test/encounter-orders.test.ts` | I1-migration-movements; phase 4's L0; phase 5's P5-migration |
| I1-migration-alerts | X | `<n>_patient_alerts.sql`, `db/test/patient-alerts.test.ts` | I1-migration-orders |
| I1-migration-push | X | `<n>_push.sql`, `db/test/push.test.ts` (the column pin) | — |
| I1-tests | X | The five vector files of 5.3 with their TypeScript and Dart readers; new `allergenTerms` cases in phase 5's `vectors/preset-bodies.json` | phase 5's P0-tests |
| I1-item-terms | T | `presets/src/schemas.ts`, `phone/presets/models.dart` (`allergenTerms`, optional, default none) | I1-tests; phase 5's P0-schemas-catalog, P2-models |
| I1-stock-rules-ts | T | `api/inventory/rules.ts` | I1-tests |
| I1-stock-rules-dart | T | `phone/inventory/rules.dart` | I1-tests |
| I1-order-rules-ts | T | `api/orders/rules.ts` | I1-tests |
| I1-order-rules-dart | T | `phone/orders/rules.dart` | I1-tests |
| I1-allergy-ts | T | `api/orders/allergy-check.ts` | I1-tests |
| I1-allergy-dart | T | `phone/orders/allergy_check.dart` | I1-tests |
| I1-banners-ts | T | `api/alerts/banners.ts` | I1-tests |
| I1-banners-dart | T | `phone/alerts/banners.dart` | I1-tests |
| I1-push-text | T | `api/push/messages.ts` | I1-tests |
| I1-wire | X | `api/sync/schemas.ts`, `api/sync/entities/values.ts`, `vectors/sync-values.json` (both entities) | I1-migration-orders, I1-migration-alerts |
| I1-movements | X | `api/inventory/movements.ts` (`ensureLocation`, the movement, `alertEffect`, alert rows, audit), `api-test/inventory-movements.test.ts` | I1-migration-movements, I1-stock-rules-ts |
| I1-order-entity | X | `api/sync/entities/order.ts`, `api/sync/entities/index.ts`, `api-test/sync-orders.test.ts` | I1-order-rules-ts, I1-allergy-ts, I1-wire, I1-movements; phase 4's L1 (`loadSigner`) |
| I1-alert-entity | X | `api/sync/entities/patient-alert.ts`, `api/sync/entities/index.ts`, `api/patients/charts.ts` (`CHART_TABLES`) | I1-wire |
| I1-read-rules | X | `api/routes/sync.ts` (the read rule of each entity, 6.1 and 6.2) | I1-order-entity, I1-alert-entity |
| I1-phone-entities | X | `phone/sync/entities.dart`, `phone/sync/local_store.dart` | I1-wire |
| I1-local-db | X | `phone/sync/local_db.dart` (the `inventory_bundle` table) | — |
| I1-fake-orders | X | `fake`, `fake_parity_test.dart` (orders, the ledger, stock alerts) | I1-read-rules, I1-phone-entities |
| I1-fake-alerts | X | `fake`, `fake_parity_test.dart` (patient alerts and their read rule) | I1-fake-orders |
| I1-labels | R | `phone/features/sync/sync_labels.dart` (the three problems, the notice) | I1-phone-entities |
| I1-contract | S | The generated contract | I1-wire |
| I2-tests | X | `api-test/inventory-{locations,stock,restock,counts,outings,field-bundle,alerts}.test.ts`, `orders-{visit-read,review}.test.ts`, `chart-alerts.test.ts`, `me-counts-stock.test.ts` | I1 |
| I2-locations | T | `api/routes/inventory.ts`, `api/inventory/locations.ts`, `api/app.ts` (list, owner) | I2-tests |
| I2-stock-log | T | `api/routes/inventory.ts`, `api/inventory/reads.ts` (a location's stock, the supply log) | I2-locations |
| I2-restock | T | `api/routes/inventory.ts`, `api/inventory/restock.ts` (restock, receive) | I2-locations |
| I2-counts | T | `api/routes/inventory.ts`, `api/inventory/counts.ts` (set-up, correction) | I2-restock |
| I2-outings | T | `api/routes/inventory.ts`, `api/inventory/outings.ts` (list, create, end) | I2-locations |
| I2-field-bundle | T | `api/routes/inventory.ts`, `api/inventory/field-bundle.ts` | I2-outings |
| I2-alerts | T | `api/routes/inventory.ts`, `api/inventory/alerts.ts` | I2-outings |
| I2-home-count | T | `api/encounters/counts.ts`, `api/routes/encounters.ts` (`stockAlerts`) | I2-alerts; phase 4's L2 |
| I2-visit-orders | T | `api/encounters/read.ts`, `api/routes/encounters.ts` (`orders`, through `orderVisibleTo`) | I2-tests; phase 4's L2 |
| I2-chart-alerts | T | `api/patients/projection.ts`, `api/patients/schemas.ts` (`alerts`, with the sensitive filter) | I2-tests; phase 5's P5-chart-read |
| I2-review | T | `api/routes/orders.ts`, `api/orders/reads.ts`, `api/app.ts` (orders to review) | I2-tests |
| I2-permissions | R | `api-test/permissions.test.ts` (a row for each route of I2 and I3) | the route cards of I2; I3-tokens |
| I2-contract | S | The generated contract | I2-permissions |
| I2-seed | S | `db/seed/demo-inventory.ts`, `db/seed/seed.ts` (stock, an owner and an outing for phase 5's demo bags; recipe `seed-data.md`; the PHI guard checks it) | I2-outings |
| I3-tests | X | `api-test/push-{tokens,sender}.test.ts`, `phone-test/push/push_tokens_test.dart` | I1-migration-push |
| I3-tokens | T | `api/routes/push.ts`, `api/push/tokens.ts`, `api/app.ts` | I3-tests |
| I3-sender | T | `api/types.ts`, `api/push/sender.ts`, `api-test/harness.ts` (`PushSender` in `Deps`, the empty and the recording sender) | I3-tests |
| I3-outbox | X | `api/push/outbox.ts` (`queuePush`), one call each in `api/inventory/movements.ts` and `outings.ts`, `api-test/push-outbox.test.ts` | I1-movements, I2-outings |
| I3-drain | X | `api/push/drain.ts`, `api/routes/sync.ts`, `api-test/push-drain.test.ts` | I3-sender, I3-outbox |
| I3-phone | T | `phone/push/push_tokens.dart`, `phone/app_providers.dart` (`PushTokenSource`, empty, registered after sign-in) | I3-tokens, I2-contract |
| I4-tests | X | `phone-test/inventory/inventory_repository_test.dart`, `phone-test/orders/{order_repository,order_flow,offline_orders}_test.dart` (offline, and kill the app before sync) | I2-contract |
| I4-fake-reads | X | `fake`, `fake_reads_test.dart` (the field bundle, `orders` in the visit read) | I2-contract, I1-fake-alerts |
| I4-bundle-store | T | `phone/inventory/inventory_repository.dart`, `inventory_refresher.dart`, `phone/patients/patient_providers.dart` | I4-tests, I4-fake-reads, I1-local-db |
| I4-orders-store | T | `phone/orders/order_repository.dart` (`placeOrders`, `voidOrder`, the three fixes of 6.1) | I4-tests |
| I4-flow | T | `phone/orders/order_flow.dart` (offer, check, stop, override; a bundle stops before any line) | I4-orders-store; phase 5's P2-supplies |
| I4-bags-screen | R | `phone/features/orders/bags_today_screen.dart` | I4-bundle-store |
| I4-orders-tab | R | `phone/features/orders/orders_tab.dart` | I4-flow, I4-bags-screen |
| I4-allergy-stop | R | `phone/features/orders/allergy_stop_screen.dart` | I4-flow |
| I4-supply-screen | R | `phone/features/orders/supply_screen.dart` | I4-allergy-stop |
| I4-given-list | R | `phone/features/orders/given_list.dart`, phase 4's visit read view | I4-orders-store; phase 4's L5 |
| I4-hook | R | Phase 4's note types screen and summary screen, `phone/features/patients/patient_screen.dart` ("+ Order") | I4-orders-tab, I4-supply-screen |
| I4-a11y | R | Three-theme and narrow-width tests for the screens of I4 | I4-hook, I4-given-list |
| I5-tests | X | `phone-test/alerts/{alert_repository,stock_alerts}_test.dart` | I2-contract |
| I5-alert-store | T | `phone/alerts/alert_repository.dart` (add, end, read from `_chart`), `phone/alerts/stock_alerts.dart` | I5-tests, I1-phone-entities |
| I5-chart-cache | R | `phone/patients/chart_cache.dart`, its test (keeps `alerts`) | I2-contract |
| I5-banner-strip | R | `phone/features/alerts/banner_strip.dart`, `phone/features/patients/patient_screen.dart` | I5-alert-store, I5-chart-cache, I1-banners-dart |
| I5-alert-sheets | R | `phone/features/alerts/alert_sheets.dart` | I5-alert-store |
| I5-home | R | `phone/features/alerts/stock_alerts_screen.dart`, `phone/features/home/home_screen.dart` | I5-alert-store, I1-stock-rules-dart |
| I5-a11y | R | Three-theme, narrow-width and offline tests for the screens of I5 | I5-home, I5-banner-strip, I5-alert-sheets |
| I6-inventory | R | `portal/inventory/page.tsx`, `(app)/layout.tsx` (the nav entry) | I2-contract |
| I6-bag | R | `portal/inventory/[locationId]/page.tsx`, its `actions.ts` (owner) | I6-inventory |
| I6-restock | R | `portal/inventory/[locationId]/RestockForm.tsx`, `actions.ts` (restock, receive) | I6-bag |
| I6-count | R | `portal/inventory/[locationId]/CountForm.tsx`, `actions.ts` | I6-restock |
| I6-log | R | `portal/inventory/log/page.tsx` | I6-inventory |
| I6-outings | R | `portal/inventory/outings/page.tsx`, its `actions.ts` | I6-inventory |
| I6-alerts | R | `portal/inventory/alerts/page.tsx`, `portal/home/page.tsx` (the count) | I6-inventory |
| I6-review | R | `portal/team/orders-review/page.tsx` | I2-contract |
| I6-patient-banners | R | `portal/patients/[patientId]/page.tsx`, `Banners.tsx` | I2-contract |
| I6-visit-orders | R | Phase 4's visit page under `portal/encounters/` | I2-contract; phase 4's L6 |
| I6-item-terms | R | Phase 5's `portal/team/presets/items/[id]/page.tsx` ("Allergy words") | I1-item-terms; phase 5's P3-item-edit |
| I6-e2e | R | `apps/portal/e2e/inventory.spec.ts`, `a11y.spec.ts` (Playwright and axe, three themes) | the page cards of I6 |
| I7-server | X | `api-test/inventory-done-when.test.ts` | I2, I3 |
| I7-phone | X | `phone-test/orders/done_when_test.dart` (against the fake) | I4 |
| I7-live | X | `phone-test/orders/live_orders_test.dart`, `tools/live-sync.sh` | I7-phone |
| I7-phi-pins | X | `api-test/inventory-phi.test.ts` (the outbox column list, the details scan, no audit row from Home's count) | I3 |
| I7-docs | R | `docs/compliance/`, `IMPLEMENTATION_PLAN.md` (the D-table, section 6 rows), the PR description | all |

**Count: 84 cards. S 3, T 28, R 27, X 26.** By unit: I1 27, I2 15, I3 6, I4 12, I5 7, I6 12, I7 5. No card changes more than three source files.
