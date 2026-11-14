> Draft plan (Nov 14), written before phase 4 was built. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 6: orders, inventory and alerts

"PRD main N" is a line of the product spec's main tab; "Build plan N" a line of its Build plan tab. Paths are from the repository root. "Next free number" means the lowest unused migration number when the unit starts (phase 4 reserves 0017 to 0021; phase 5 will take more).

## 1. Scope and Done when
**Done when** (Build plan 98; `IMPLEMENTATION_PLAN.md` section 4, phase 6 row): dispensing 3 of an item a bag holds 1 of leaves it at −2 and alerts the Program Admin, Logistics and the route lead, with nothing shown to the field user during the run.

| In | PRD |
|---|---|
| Shared bags and team stock as stock locations; a bag is counted once at set-up | main 474; Build plan 95 |
| The Orders tab: items by category (OTC, Rx, Labs, others), the in-bag list with a search bar, single items in one tap | main 104, 125, 443 |
| Suggest, then confirm: bundles and field mappings pre-fill a supply screen; the worker confirms or adjusts | main 424-431, 437-448, 471 |
| Deduction from the bags being carried; the app picks the bag, staff can change it | main 448, 475 |
| Dispensing past the count, or an item the bag does not list: the count goes negative, no alert in the field, three roles alerted | main 126, 472; Build plan 96 |
| Every stock change logged with user, bag, item, quantity, reason, time; the supply log | main 473, 475 |
| Restock from team stock, set-up count and count correction, in the portal | main 475, 960, 961 |
| Medication orders by ordering credentials only; Medical and Non-Medical items | main 447, 450 |
| Point-of-care lab orders record the test and its result | main 104 |
| The allergy hard stop: blocks until acknowledged with a reason; offers another item; override logged | main 450, 497; Build plan 97 |
| Passive banners on the chart; never block; work offline | main 498, 501 |
| Push notifications with no names or health details | main 601, 746; Build plan 97 |

| Out | Goes to | PRD |
|---|---|---|
| Catalog, bundles, mappings, categories, bag minimums as admin pages | Phase 5 | Build plan 90 |
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
| `CAPABILITIES[credential].orderMedications` is true for attending, resident, NP and PA; false for student, CHW and none. | `services/api/src/auth/permissions.ts` 96-170 |
| A synced record type is one `EntityRules` module registered in `RULES`. `storeCreate` does the insert, the history rows and the audit event in the change's transaction. | `services/api/src/sync/records.ts` 380-415, 445-493; `services/api/src/sync/entities/index.ts` 20-30 |
| Allergies are append-only rows with `substance` (free text, 1 to 120), `category`, `severity`, `status` (`active`, `entered_in_error`). They are never merged by text. | `services/api/src/sync/entities/allergy.ts` 16-21, 26-47; `services/api/src/sync/entities/values.ts` 157-169 |
| The phone shows allergies as a badge from one rule, `allergyBadge()`. The team index holds allergies for patients off the route. | `apps/mobile/lib/design/widgets/allergy_badge.dart` 9-13; `apps/mobile/lib/patients/display.dart`; PRD main 272 |
| An append-only table with its trigger, and the team policy block every team table gets. | `db/migrations/0009_patients.sql` 220-243, 484-488 |
| `encounters` has `kind` (`medical`, `non_medical`), `patient_id` (may be null), `author_user_id`. | `db/migrations/0004_sync.sql` 33-50 |
| `user_notices` (user, kind, entity, record ID) and its list route exist. | `db/migrations/0004_sync.sql` 160-170; `services/api/src/routes/sync.ts` 49-65 |
| `Deps` injects `db`, `verifier`, `identityAdmin`, `log`, `now`. There is no scheduled job route. | `services/api/src/types.ts` 9-18; `services/api/src/routes/system.ts` |
| Recipes for a synced entity, shared vectors and the fake's mirror. | `docs/plan/patterns/synced-entity.md`, `shared-vectors.md`, `fake-mirror.md` |

What earlier, unbuilt phases must have delivered. If one is missing, it is built first, as its own card.

| Phase | Thing this phase needs |
|---|---|
| 4 | The encounter screen with a place for an Orders tab and a step before signing; `apps/mobile/lib/encounters/`; note data keyed by field path; the rule "a change that arrives too late is kept" (`docs/design/phase-4/lifecycle.md` 46-48); the credential a person held at a given time (lifecycle 3.5); phone Home's "Needs your attention" lists (lifecycle 3.9) |
| 5 | A catalog table (called `catalog_items` here) with `id`, `team_id`, `name`, `unit_label`, `category_key`, `kind` (`supply`, `medication`, `lab`), `medical` boolean, `active`; never hard-deleted. Bundles with lines (`item_id`, `quantity`, `core`). Field mappings (`field_path`, `when_value`, `item_id`, `quantity`). Bag minimums (`location_id`, `item_id`, `minimum`) and the team's on/off setting. One download that brings all of it to the phone with a version. |
| 7 | Nothing. Phase 7 builds on the outing of section 4.1. |

## 3. The design in one page
1. **A count is a sum, never a stored number a phone writes.** Every stock change is one immutable row with a signed quantity. Two phones offline cannot conflict, and −2 is plain arithmetic (PRD main 126).
2. **Phones send orders; the server writes the stock movement.** One synced record type carries the order and its bag, so an order and its deduction cannot disagree, and the order is stored with its encounter.
3. **The server never refuses an order for a judgment rule.** The item has already been handed over. A missed allergy, a missing credential or a Non-Medical encounter is stored and flagged for review (as phase 4 keeps a late change, lifecycle 46-48; D42).
4. **The allergy check is one pure function, run twice.** The phone runs it on the allergies it holds (chart or team index); the server runs it again on what it holds. Vectors pin both.
5. **Stock alerts are rows opened and closed by arithmetic** in the transaction of the movement that crossed the line. Who sees one is worked out when it is read, so a role change needs no repair.
6. **The phone shows no counts and no stock warnings.** The order screen lists what a bag carries, not how many. That is how "no alert during the run" holds for everyone, the lead included (PRD main 126).
7. **"The route" is an outing until phase 7.** An outing is a day, a lead and the bags taken. It gives this phase the route's bags and the route lead without building routes. Phase 7 attaches a route to it.
8. **Counting is online only.** A recount is the one stock change that is not a sum. The server works out its difference under a lock, in the portal.
9. **Banners are computed from data the phone already holds**, plus one small append-only record for alerts staff write. No banner ever blocks.
10. **Push text comes from a fixed list of sentences.** The payload type has no free-text field, so a name cannot get in. The sender is an interface; the real provider waits for accounts.
11. **No new permission keys** (D37). Every check uses keys in `services/api/src/auth/permissions.ts`.

## 4. Data model
Five migrations, each the next free number, each with the team policy block of `0009_patients.sql` 484-488 (`team_id = sineobex.current_team_id() or sineobex.is_platform_scope()`, `using` and `with check`). All are level X (policies, triggers). IDs are `uuid`; every table has `team_id uuid not null references sineobex.teams (id)` and `created_at timestamptz not null default now()`.

### 4.1 `<n>_stock_locations_outings.sql`
| Table.column | Type | Meaning and constraint |
|---|---|---|
| `stock_locations.kind` | text | `bag` or `team_stock`; one `team_stock` row per team (partial unique index) |
| `.name` | text | 1 to 80; unique per team among active rows, case-insensitive |
| `.owner_user_id` | uuid null | A bag someone carries themselves (PRD main 474) |
| `.set_up_at`, `.set_up_by` | timestamptz, uuid null | Set by the first count; a bag is "counted once when it's set up" |
| `.retired_at` | timestamptz null | Bags are retired, never deleted |
| `bag_outings.service_date` | date | The day the bags go out |
| `.lead_user_id` | uuid | The route lead for this phase's alerts |
| `.name` | text null | 1 to 80, for the picker ("North loop") |
| `.route_id` | uuid null | No foreign key yet; phase 7 adds it |
| `.ended_at`, `.ended_by` | timestamptz, uuid null | Set once, when the bags are back |
| `bag_outing_bags` (`outing_id`, `location_id`, `service_date`, `position`) | | Unique (`location_id`, `service_date`): "a bag can go on only one route a day" (PRD main 474) |

### 4.2 `<n>_stock_movements.sql`
`stock_movements` is **append-only** (trigger refusing update and delete, as `patient_consents`).

| Column | Type | Meaning and constraint |
|---|---|---|
| `location_id`, `item_id` | uuid | Composite foreign keys with `team_id` |
| `quantity` | integer | Signed, not 0, between −9999 and 9999. No check that a sum stays above 0 |
| `reason` | text | `dispense`, `void`, `restock_out`, `restock_in`, `received`, `setup_count`, `recount` |
| `order_id` | uuid null | Set for `dispense` and `void`; unique (`order_id`, `reason`), so a replay writes nothing twice |
| `pair_id` | uuid null | The two rows of one restock share it |
| `counted` | integer null | For `setup_count` and `recount`: the number counted |
| `outing_id` | uuid null | The outing the bag was on |
| `recorded_by`, `recorded_at`, `clock_verified`, `device_id`, `change_id` | | As `patient_consents` |

`stock_balances` (`team_id`, `location_id`, `item_id`, `quantity integer`, primary key on the three) is kept by an insert trigger on `stock_movements` that adds `quantity`. It may be negative. A row exists once an item has moved at a location; "the bag lists the item" means the row exists.

`stock_alerts`: `location_id`, `item_id`, `kind` (`negative`, `below_minimum`), `opened_at`, `opened_by_movement_id`, `opened_by_user_id`, `outing_id` null, `closed_at` null, `closed_by_movement_id` null. Partial unique index on (`location_id`, `item_id`, `kind`) where `closed_at is null`: one open alert of a kind per item per location. Only `closed_*` ever change.

### 4.3 `<n>_encounter_orders.sql`
`encounter_orders`: one row per item given or test done. Only the void columns and `review_flags` change after insert.

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid | Made on the phone |
| `encounter_id` | uuid | Foreign key with `team_id`; the patient is the encounter's (may be none) |
| `item_id` | uuid | The catalog item |
| `quantity` | integer | 1 to 999, in the item's dispensing unit (PRD main 127) |
| `location_id` | uuid null | The bag or team stock it came from; null means team stock |
| `outing_id` | uuid null | Stored null when the server does not know it |
| `source` | text | `manual`, `bundle`, `mapping` |
| `bundle_id` | uuid null | The bundle applied, for phase 10's codes |
| `lab_result` | text null | 1 to 120; only when the item's kind is `lab` (PRD main 104) |
| `lot`, `expiry` | text null (1 to 40), date null | For a vaccine dose (PRD main 426) |
| `override_allergy_ids`, `override_reason` | uuid[] null, text null (3 to 300) | Both or neither |
| `review_flags` | text[] not null default `{}` | Subset of `allergy_unchecked`, `no_ordering_credential`, `needs_medical_encounter`; set by the server only |
| `voided_at`, `voided_by`, `void_reason` | | Set once |
| `author_user_id`, `ordered_at`, `clock_verified`, `created_device_id`, `change_id`, `version`, `field_versions`, `field_meta` | | As `patient_allergies` |

The migration also replaces `patient_of_change` with a version that has a branch for `encounter_order` (through its encounter) and for `patient_alert` (recipe step 1). If phase 5's catalog has no `allergen_terms text[] not null default '{}'` column, this migration adds it (each term 2 to 60 characters, at most 20).

### 4.4 `<n>_patient_alerts.sql`
`patient_alerts`: `id`, `patient_id` (composite foreign key), `kind` (`safety`, `clinical`, `other`), `text` (1 to 200), `sensitive boolean`, `author_user_id`, `recorded_at`, `clock_verified`, `device_id`, `change_id`, and the set-once `ended_at`, `ended_by`, `end_reason`. Listed in the schema test of tables with a `patient_id` (D27).

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
| Suggested (phone memory only, never stored) | A bundle is applied or a mapped field is answered | The encounter's author | Yes |
| Ordered | Confirm on the supply screen, or one tap on a single item | `encounters.chart`; a `medication` item also needs `orderMedications`; a `medical` item needs a Medical encounter | Yes |
| Voided | "Remove", with a reason | The order's author only | Yes |

There is no edit. A wrong quantity is a void and a new order. An order is accepted whatever state its encounter and notes are in.

### 5.2 Stock
| Movement | Who | Where | Effect on the sum |
|---|---|---|---|
| `dispense` | Written by the server for each order | Sync | −quantity at the order's location |
| `void` | Written by the server when an order is voided | Sync | +quantity at the same location |
| `restock_out` and `restock_in` | `inventory.manage` | Portal | −q at team stock, +q at the bag, one `pair_id`. From outside: `restock_in` alone |
| `received` | `inventory.manage` | Portal | +q at team stock |
| `setup_count` | `inventory.manage`, on a bag never set up | Portal | counted − current sum |
| `recount` (a correction) | `inventory.manage` and `team.manage_presets` (Program Admin, not Logistics: PRD main 961) | Portal | counted − current sum |

After every movement the server reads the balance before and after, calls `alertEffect`, and opens or closes alert rows in the same transaction. An alert is never edited by a person.

### 5.3 The pure functions
Each is written once in TypeScript and once in Dart, with no database or network, and is tested against one hand-written vector file both sides read (`docs/plan/patterns/shared-vectors.md`).

| Vector file (`packages/contract/test-vectors/`) | Function: inputs → output | TypeScript | Dart |
|---|---|---|---|
| `stock-rules.json` | `alertEffect({before: int or null, after: int, minimum: int or null})` → `{open: kind[], close: kind[]}`. `negative` opens when `after < 0` and `before` was null or ≥ 0; closes when `before < 0` and `after ≥ 0`. `below_minimum` likewise against `minimum`, never when `minimum` is null | `services/api/src/inventory/rules.ts` | none |
| | `countDelta({counted, current})` → int (`counted − current`; 0 means write nothing) | same | none |
| | `outingOver({serviceDate, endedAt, now})` → bool: `endedAt` set, or `now` ≥ the service date's UTC midnight + 36 h | same | `apps/mobile/lib/inventory/rules.dart` |
| | `alertVisibleTo({surface, hasInventoryView, hasInventoryManage, isLead, hasOuting, outingOver})` → bool. Portal: `hasInventoryView`. Phone: (`hasInventoryManage` or `isLead`) and (not `hasOuting` or `outingOver`) | same | same |
| | `pickLocation({itemId, bags: [{id, items: [{itemId, inStock}]}], teamStockId})` → location ID: the first bag where the item is in stock; else the first that lists it; else the first bag; with no bags, team stock | none | same |
| `order-rules.json` | `mayOrderItem({encounterKind, itemKind, itemMedical, canOrderMedications})` → `ok`, `needs_medical_encounter` or `needs_ordering_credential` | `services/api/src/orders/rules.ts` | `apps/mobile/lib/orders/rules.dart` |
| | `orderProblem(value, itemKind)` → null or a code: `lab_result_not_lab`, `override_incomplete`, `expiry_invalid` | same | same |
| | `bundleLines(bundle)` → `[{itemId, quantity, checked}]`: core lines checked, optional unchecked (PRD main 441) | none | same |
| | `suggestLines({answers, mappings})` → `[{itemId, quantity, checked: true}]`: a mapping fires only when the answer at `fieldPath` equals `whenValue` (the action field, PRD main 431); the same item twice is summed | none | same |
| `allergy-check.json` | `allergyMatches({itemName, allergenTerms, allergies: [{id, substance, status}]})` → sorted allergy IDs. Rule in 5.4 | `services/api/src/orders/allergy-check.ts` | `apps/mobile/lib/orders/allergy_check.dart` |
| | `allergyOutcome({matches, overrideIds})` → `clear`, `overridden` (every match is in `overrideIds`) or `unchecked` | same | same |
| `chart-banners.json` | `chartBanners({allergyScreen, alerts, canSeeSensitive, labOrders, today})` → ordered `[{key, tone, alertId?}]` (5.5) | `services/api/src/alerts/banners.ts` | `apps/mobile/lib/alerts/banners.dart` |
| `push-messages.json` | `pushMessage(key, count)` → `{title, body}` from the list in section 9 | `services/api/src/push/messages.ts` | none |

### 5.4 The allergy hard stop
- **Match.** Normalize the item name, each allergen term and each active allergy's substance with the pinned name normalization (D43; `packages/contract/test-vectors/normalize.json`) and split into words. An allergy matches when a term (or the item name) and the substance are equal, or one is a run of whole words inside the other. A side shorter than 3 characters matches only when equal. Allergies marked entered in error never match. All categories are checked.
- **When.** Before every order of an item that has a kind of `medication` or any allergen term, single or in a bundle (PRD main 447, 450). A bundle with a matching line stops before any line is ordered.
- **On the phone.** `allergyOutcome` is not `clear` → the hard stop screen (8.3). "Choose something else" returns to the list. "Give anyway" needs a reason and stores `allergyOverride {allergyIds, reason}` on the order.
- **On the server.** The same two functions over the server's allergies for the encounter's patient group. `clear`: stored. `overridden`: stored, audit `order.allergy_override`. `unchecked` (the phone did not hold the allergy): stored with the flag `allergy_unchecked`, the receipt says so, the author gets a notice, audit `order.flagged`. Never refused.
- **No patient, or allergies "not asked".** The check has nothing to match. No stop; a passive banner says the allergies are not known (5.5).

### 5.5 Passive banners
`chartBanners` returns, in this order: active `safety` alerts; "Allergies not asked yet" when `allergyScreen` is `not_asked` and there is no allergy; active `clinical` alerts; a point-of-care result recorded in the last 7 days ("New test result"); `other` alerts. An alert marked sensitive is left out unless the reader holds `patients.view_sensitive`. The banner about being unable to consent (phase 3) stays where it is.

Adding an alert (`kind`, `text`, `sensitive`) and ending one with a reason both need `encounters.chart`, and both work offline.

## 6. Sync
### 6.1 `encounter_order`
Create value (strict): `encounterId`, `itemId`, `quantity`, `locationId` (null allowed), `outingId` (null allowed), `source`, `bundleId`, `labResult`, `lot`, `expiry`, `allergyOverride` (`{allergyIds: 1 to 30 IDs, reason: 3 to 300}` or null). One settable field: `voided` (`{reason}`, class `set_once`, the `Retraction` shape of `values.ts`).

| Rule | Value |
|---|---|
| Permission | `encounters.chart` for create and for `voided` |
| `mayChange` for `voided` | The order's author |
| Parent | The encounter. Missing: held as `encounter_missing`, as today |
| Team lock | Always (D32): it writes audit and stock rows |
| Clock pause | Follows encounters (D35): paused with them |
| Read (`requireRead`) | `encounters.chart` |

| Case | The server answers |
|---|---|
| Valid; rules pass | `accepted`, version 1. One `dispense` movement; `alertEffect` applied. No details about stock, ever |
| `mayOrderItem` is not `ok` for the credential held at the order's time | `accepted`, flagged; details `{flags: [...]}`; notice to the author |
| Allergy outcome `overridden` | `accepted`; audit `order.allergy_override` |
| Allergy outcome `unchecked` | `accepted`, flagged; details `{flags: ['allergy_unchecked']}`; notice to the author |
| `itemId` is not in the team's catalog | `rejected`, `item_unknown` (the worker picks another item in Needs attention) |
| `locationId` is not one of the team's locations | `rejected`, `location_unknown` |
| Item or bag retired; encounter finished; `outingId` unknown | `accepted` (unknown outing stored as null) |
| `orderProblem` returns a code; schema fails | `rejected` with the code, as any invalid value |
| The same change again | The stored receipt; the unique (`order_id`, `reason`) index means no second movement |
| `voided` set | `accepted`; one `void` movement; `alertEffect`; audit `order.voided`. A second set: the `set_once` answer |

### 6.2 `patient_alert`
Create value: `patientId`, `kind`, `text`, `sensitive`. Field `ended` (`{reason}`, `set_once`). Permission `encounters.chart`; parent the patient; team lock always; no clock pause (as allergies, D35); read needs `patients.view`, and a sensitive alert also `patients.view_sensitive`. A late create naming a merged patient is stored as sent (D27). Audit `patient_alert.created` and `.ended`.

### 6.3 What the phone test server must mirror (`apps/mobile/test/sync/fake_server.dart`, level X)
Each is pinned to the API's answer in `fake_parity_test.dart` (D52): both create schemas and `orderProblem`; `item_unknown` and `location_unknown`; accept-and-flag for the three flags, with the same receipt details; the allergy re-check over the fake's allergies; the fake's own movement list and balances (so a test can read −2); alert rows opened and closed by `alertEffect`'s vectors; `voided` as `set_once` by the author; the read permission of each entity; no stock detail in any receipt.

### 6.4 What a phone holds
| Data | How it arrives | When it leaves |
|---|---|---|
| Catalog, bundles, mappings (with `allergen_terms`) | Phase 5's download | Replaced whole at each refresh; sign-out |
| Bags, today's and tomorrow's outings, and per bag the items it lists with `inStock` (no numbers) | `GET /v1/inventory/field-bundle` at each sync, stored whole beside phase 5's download | Replaced whole; sign-out |
| The outing the worker chose today | Phone only, kept in memory and re-asked after a restart | End of day |
| Allergies | Already there: the chart, or the team index (PRD main 272) | With the chart or index |
| Patient alerts | In the chart's server-only `_chart` field (D44), plus the phone's own unsynced alerts | With the chart (D46) |
| Own orders | The local store, with their encounter | With the encounter, after a hash-confirmed receipt (D23) |

A phone with no field bundle (first sign-in offline) still orders: `pickLocation` returns team stock (`locationId` null). Nothing a phone holds for this phase is in `kv` or names a patient outside a chart.

## 7. API routes that only work online
All follow `docs/plan/patterns/api-route.md`. Every refusal is the standard 403 with the key it lacked, logged. Each write carries a client `requestId`; the same one again returns the first answer. No path, query or log line carries a patient ID or an item name.

| Route | Key | Request → answer | Refusals | Audit event |
|---|---|---|---|---|
| `GET /v1/inventory/locations` | `inventory.view` | → bags and team stock, A–Z, with item counts and open alerts | | none (no patient data) |
| `POST /v1/inventory/locations`, `PATCH …/{id}` | `team.manage_presets` | name, owner, retire → the location | `name_taken`, `team_stock_fixed` | `inventory.bag_created`, `.bag_updated`, `.bag_retired` |
| `GET /v1/inventory/locations/{id}/stock` | `inventory.view` | → items with balance and minimum | | none |
| `POST /v1/inventory/restocks` | `inventory.manage` | `{bagId, source: team_stock or outside, lines: [{itemId, quantity}]}` → new balances | `bag_retired`, `item_unknown` | `inventory.restocked` (bag, line count, total) |
| `POST /v1/inventory/receipts` | `inventory.manage` | `{lines}` into team stock → balances | `item_unknown` | `inventory.received` |
| `POST /v1/inventory/counts` | `inventory.manage`; a count of a set-up location also `team.manage_presets` | `{locationId, lines: [{itemId, counted}]}` → balances; the server locks the balance rows and uses `countDelta` | `item_unknown` | `inventory.set_up` or `inventory.recounted` (lines, how many changed) |
| `GET /v1/inventory/movements` | `inventory.view` | filters (location, item, reason, dates), keyset pages → the supply log. `encounterId` only for a caller with `patients.view` | | `inventory.log_viewed` when encounter IDs were returned |
| `GET /v1/inventory/outings?date=`, `POST /v1/inventory/outings` | `routes.view`; `routes.manage` | `{serviceDate, leadUserId, name, bagIds}` → the outing | `bag_taken` (already out that day), `lead_not_member` | `inventory.outing_created` |
| `POST /v1/inventory/outings/{id}/end` | `routes.manage`, or its lead with `routes.view` | → ended; held pushes for it are released | `already_ended` | `inventory.outing_ended` |
| `GET /v1/inventory/field-bundle` | `inventory.view` | → section 6.4's bundle, with a version | | none |
| `GET /v1/inventory/alerts?surface=` | `inventory.view`, or a lead with `routes.view` | → open alerts that `alertVisibleTo` allows this caller | | none |
| `GET /v1/encounters/{id}/orders` | `encounters.chart` or `billing.view_codes`, plus `patients.view` | → the encounter's orders | | `order.list_viewed` (patient, count) |
| `GET /v1/team/orders-to-review` | `team.view_audit` | → orders with a review flag or an override: IDs, flags, author, time | | `order.review_viewed` (`patientIds`) |
| `PUT` and `DELETE /v1/devices/{deviceId}/push-token` | the signed-in user's own device | `{platform, token}` → 204 | `not_your_device` | `push.token_registered`, `.token_removed` |

**Push: built now.** The two tables; the token routes; `PushSender` (`send(token, platform, {title, body})`) added to `Deps` with a sender that does nothing and a recording one for tests; `queuePush` (one outbox row per recipient, same transaction as the alert, `dedupe_key` = user + message + hour, so a burst is one push with a count); `drainPush`, called after a sync request commits and never failing it; on the phone a `PushTokenSource` interface with an empty implementation. **Waits for accounts** (`IMPLEMENTATION_PLAN.md` section 7: Apple, Google, and a push provider project): the real sender, the phone plugin and its permission prompt, a scheduled drain.

## 8. Screens
The PRD gives wording only for the list (main 125), the kit stepper "− 2 kits +" (main 442) and "2 tasks due today" (main 746). All other wording below is a default for Brooke and Mercy (section 11). Every screen is tested in Day, Night run and High contrast, at narrow width, and offline.

| Phone screen | Shows | States and wording |
|---|---|---|
| 8.1 Bags today | The day's outings, each with its bags | "Which bags are you carrying today?"; none: "No bags set for today. Supplies will come from team stock."; not downloaded: the same sentence |
| 8.2 Orders tab (in an encounter) | Category chips (OTC, Rx, Labs, others); a scrollable list of the items the chosen bags list, with a search bar; "All items" for the rest of the catalog; bundles | No numbers, no stock colour. Non-Medical encounter: Medical items and bundles are not listed. No ordering credential: medication rows are disabled with "Needs an ordering credential". One tap on an item orders 1 |
| 8.3 Allergy hard stop | Full screen, not dismissible by tapping outside | Title "Allergy warning". Body "This patient has a recorded allergy to {substance} ({severity}). {item} may cause a reaction." Buttons "Choose something else" and "Give anyway". "Give anyway" opens "Why is it safe to give?" (3 characters at least), then "Record and give" |
| 8.4 Supply screen (before signing) | Suggested lines: checkbox, item, unit, stepper, bag chip (tap to change) | Core lines checked, optional unchecked. Buttons "Confirm supplies" and "Nothing given". After confirm: "Saved", whatever the bag holds |
| 8.5 Given in this encounter | Order rows; lab rows with "Result"; vaccine rows with "Lot" and "Expiry" | "Remove" asks "Why remove it?". A flagged row: "An allergy to this was recorded after it was given. Tell the clinician in charge." |
| 8.6 Banners on the chart | `chartBanners`, one line each, icon and text, never colour alone | "Add an alert" (kind, text, "Only for staff who see sensitive details"); "End alert" with a reason |
| 8.7 Home, Needs your attention: Alerts | For a lead or `inventory.manage`, only what `alertVisibleTo` allows on the phone | "{n} supply items need a restock"; opens a list of bag and item, no counts of patients |

| Portal page | Key | Shows |
|---|---|---|
| Inventory | `inventory.view` | Team stock and bags, A–Z, a search box (PRD main 473); negative counts shown as numbers with the word "short" |
| A bag | `inventory.view` | Items, balance, minimum, open alerts; "Restock" and "Count" for those who may |
| Restock, Receive, Count forms | section 7's keys | A stepper or typed number per line; an item the bag does not carry can be added; the Save button stays pinned (PRD main 950, 960) |
| Supply log | `inventory.view` | User, bag, item, quantity, reason, time (PRD main 475); filters |
| Bags out today | `routes.view`; create with `routes.manage` | Outings by day, lead, bags; "End" |
| Restock alerts, and a count on Home | `inventory.view` | Open alerts: bag, item, balance, since when, who was out with it |
| Orders to review | `team.view_audit` | Flagged and overridden orders, with a link to the chart |
| Patient page | `patients.view` | The same banners as the phone, computed by the server |

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
- An override reason, an alert's text and a lab result are patient details. They live in their rows, reach only readers of the chart, and never enter audit details, logs, URLs, page titles, notices or pushes.
- A stock alert names a bag and an item, never a patient or an encounter.
- Push sentences, the whole list: `stock_alert`: "Supplies to review" / "{n} supply items need a restock."; `note_incomplete`: "Notes" / "A note is waiting to be finished." (reserved by phase 4, lifecycle 3.9); `tasks_due`: "Tasks" / "{n} tasks due today" (PRD main 746). Nothing else can be sent.

## 10. Tests
The Done when, as steps. It runs three times: against the API (`services/api/test/inventory-done-when.test.ts`), on the phone against the fake (`apps/mobile/test/orders/done_when_test.dart`), and on the phone against the real API (the live job).

| # | Step | Asserted |
|---|---|---|
| 1 | A Program Admin sets up a bag with 1 of an item (portal route) | Balance 1; one `setup_count` movement; no alert |
| 2 | Logistics creates today's outing: that bag, a Healthcare Staff lead | The field bundle lists the item as in stock, with no number |
| 3 | The lead's phone goes offline, opens an encounter and orders 3 | The order is in the local store with its encounter; the screen says "Saved"; no dialog, banner, snack bar or badge mentions stock (widget test) |
| 4 | The phone syncs | Receipt `accepted`, hash matches, no details; the order leaves the outbox |
| 5 | Read the server | Balance −2; one `dispense` movement of −3; one open `negative` alert; `inventory.alert_opened` in the same transaction |
| 6 | Read alerts as each person, portal surface | The Program Admin and Logistics see it. Outbox rows exist for all three; the lead's has `not_before` after the outing |
| 7 | Read alerts as the lead, phone surface, during the outing | Empty. The recording sender has sent nothing to the lead |
| 8 | End the outing; drain | The lead sees the alert on the phone; all three pushes sent, each body equal to `pushMessage`'s text |
| 9 | Logistics restocks 5 | Balance 3; the alert is closed by that movement |

| Rule | Test that holds it (revert the rule, see it fail) |
|---|---|
| A count is a sum; two phones cannot conflict | Two phones each order 1 of a bag's last item offline, sync in either order: balance −1, one open alert (`sync-orders.test.ts`, `sync_scenarios_test.dart`) |
| `stock_balances` equals the sum of movements; movements cannot be changed | DB test over random movements; update and delete refused |
| A replayed order moves stock once | Send the change twice: one movement |
| An order is never lost | Order offline, kill the app before sync, reopen, sync: stored once, receipt hash matches |
| A judgment rule never refuses | Vectors for `mayOrderItem`; each flag case is `accepted` with the flag, on the API and the fake |
| The hard stop | `allergy-check.json` (PCN against "penicillin" terms, entered in error, short words, word runs); widget test: no order is created until a reason is recorded; server test: allergy added by a second phone gives `allergy_unchecked` |
| The off-route patient | The hard stop fires from team-index allergies with no chart downloaded |
| Audit in the same transaction | Force the audit insert to fail: no order, no movement, no alert row |
| No stock detail reaches a field user | Receipts carry no stock keys (API and fake parity); `alertVisibleTo` vectors |
| No patient detail in a push or audit | `push_outbox` column pin; a scan of every new event's details for the seeded name, item text, reason and alert text |
| Permissions | One refusal test per route and key; the count correction refused for Logistics |
| Sensitive alerts | Hidden from a role without `patients.view_sensitive`, in the chart and in `chartBanners` vectors |
| Accessibility | Each new screen in three themes at narrow width (phone golden and semantics tests; Playwright and axe) |

## 11. Defaults chosen (PLAN-OPEN) and questions for people
| Question | Default | Who decides |
|---|---|---|
| Who counts as "Program Admin" and "Logistics" for an alert, with custom roles and no new keys? | Everyone holding `inventory.manage`, plus the outing's lead. It follows the person who can restock | Project lead |
| What is "the route" before routes exist? | An outing: a day, a lead, bags. Phase 7 attaches its route | Project lead |
| When is a run over, for the lead's alert? | When the outing is ended, or 36 hours after the service date's UTC midnight | The team |
| Does a field user see how many a bag holds? | No numbers on the phone; "in the bag" or not | Brooke and Mercy |
| Is an admin on the run pushed at once? | Only the lead's push is held; others with `inventory.manage` get it at once | Brooke and Mercy |
| Who may add or retire a bag? | `team.manage_presets` ("Admins can add bags", PRD main 474) | Project lead |
| Who may dispense? | `encounters.chart`; check-ins (phase 9) decide for CHWs | Brooke and Mercy |
| What does the hard stop match on? | The item's name and admin-set allergen terms against every active allergy, all categories; no drug-class dictionary | Brooke and Mercy |
| What is the "alternative" of Build plan 97? | The button "Choose something else"; the app suggests no drug | Brooke and Mercy |
| Hard stop and screen wording; override reason length | Section 8; 3 to 300 characters, free text | Brooke and Mercy |
| An order the server finds unsafe after the fact | Stored and flagged, never refused; the author and `team.view_audit` are told | Counsel, then Brooke and Mercy |
| Who may void an order? | Its author only | Brooke and Mercy |
| Banner kinds; how long a test result is "new" | `safety`, `clinical`, `other`; 7 days | Brooke and Mercy |
| Is TB or HIV status in a banner a sensitive detail? | The author marks it; marked ones need `patients.view_sensitive` | Counsel |
| Restocks from outside team stock (open in PRD main 967) | Allowed, as `source: outside` | The team |
| Push provider | Firebase Cloud Messaging for both platforms, generic text only | Project lead, counsel (no BAA covers it) |

Questions with no default, which need a person: (1) accounts for the push provider, Apple and Google, and who owns them; (2) whether counsel accepts any push at all through a provider without a BAA, given fixed text; (3) whether required periodic recounts and desktop medication distribution tracking (PRD main 450, 475) are in the MVP, and in which phase; (4) phase 5's real table and column names, to be checked against section 2 before cards are cut.

## 12. Risks, and where the design departs from the PRD or reads it a particular way
1. **Phases 4 and 5 are not built.** Section 2's second table is a guess at their shapes. Renames are cheap; a catalog without `kind` or `medical` is not, and would add a card to this phase.
2. **The outing overlaps phase 7.** If phase 7 models routes differently, `bag_outings` becomes a view over routes. It is two small tables, chosen so that the Done when's "route lead" is real now.
3. **Reading: "no alert during the run" means no stock signal on any phone** while the outing runs, the lead's included (PRD main 126). The PRD names the lead among those alerted; this design alerts the lead after the run.
4. **Departure: the phone shows no counts.** The PRD's "in-bag items" (main 125) is read as "items the bag lists". A shown count would turn negative and act as an alert.
5. **Departure: an unsafe order is stored, not blocked, by the server.** The hard stop blocks on the phone (PRD main 497). The server cannot block what has been handed over; it flags it.
6. **Text matching misses.** "PCN" matches only if an admin lists it as a term. A miss shows no stop. The allergy badge stays on screen while ordering, and phase 5's presets should ship terms for common drugs.
7. **The fake grows a stock ledger** (plan risk 7). Its parity tests are part of unit 1, not later.
8. **Push is unproven until accounts exist.** Everything up to the sender is tested; delivery is not.

## 13. Units and a first card list
Unit 1 lands first, alone, with CI green. Then units 2 and 3 run side by side, then 4 and 5, then 6, then 7. Each line: title, level, files, needs. A route or schema card regenerates the contract in the same commit. Vector files and tests for T cards are written first by the planner (card 1.06 and the "tests first" notes).

**Unit 1. Schema, rules and sync** (owns `db/migrations/`, `services/api/src/{inventory,orders,alerts}/`, `services/api/src/push/messages.ts`, `services/api/src/sync/`, `apps/mobile/lib/{inventory,orders,alerts}/` rule files, `apps/mobile/lib/sync/`, the fake)
- 1.01 Migration: stock locations and outings. X. `<n>_stock_locations_outings.sql`. Needs phase 5's catalog.
- 1.02 Migration: movements, balances trigger, alerts. X. `<n>_stock_movements.sql`. Needs 1.01.
- 1.03 Migration: encounter orders, `patient_of_change`, `allergen_terms`. X. `<n>_encounter_orders.sql`. Needs 1.02.
- 1.04 Migration: patient alerts. X. `<n>_patient_alerts.sql`. Needs 1.03.
- 1.05 Migration: push tables. X. `<n>_push.sql`. Needs nothing.
- 1.06 The five vector files and both readers for each. X. `packages/contract/test-vectors/*.json`, reader tests. Needs nothing.
- 1.07 Stock rules in TypeScript. T. `services/api/src/inventory/rules.ts`. Needs 1.06.
- 1.08 Stock rules in Dart. T. `apps/mobile/lib/inventory/rules.dart`. Needs 1.06.
- 1.09 Order rules in TypeScript. T. `services/api/src/orders/rules.ts`. Needs 1.06.
- 1.10 Order rules in Dart. T. `apps/mobile/lib/orders/rules.dart`. Needs 1.06.
- 1.11 Allergy check in TypeScript. T. `services/api/src/orders/allergy-check.ts`. Needs 1.06.
- 1.12 Allergy check in Dart. T. `apps/mobile/lib/orders/allergy_check.dart`. Needs 1.06.
- 1.13 Banners in TypeScript. T. `services/api/src/alerts/banners.ts`. Needs 1.06.
- 1.14 Banners in Dart. T. `apps/mobile/lib/alerts/banners.dart`. Needs 1.06.
- 1.15 Push sentences. T. `services/api/src/push/messages.ts`. Needs 1.06.
- 1.16 Wire schemas and `sync-values.json` cases for both entities. X. `sync/schemas.ts`, `sync/entities/values.ts`. Needs 1.03, 1.04.
- 1.17 The movement writer: movement, balances read, `alertEffect`, alert rows, audit. X. `services/api/src/inventory/movements.ts`. Needs 1.02, 1.07.
- 1.18 `orderRules`. X. `sync/entities/order.ts`, `sync/entities/index.ts`, `routes/sync.ts`. Needs 1.09, 1.11, 1.16, 1.17.
- 1.19 `patientAlertRules`, and alerts in the chart's `_chart`. X. `sync/entities/patient-alert.ts`, `sync/entities/index.ts`, the chart projection. Needs 1.16.
- 1.20 Phone registry for both entities. X. `apps/mobile/lib/sync/entities.dart`, `local_store.dart`. Needs 1.16.
- 1.21 Fake server: orders, ledger, alerts, with parity tests. X. `fake_server.dart`, `fake_parity_test.dart`. Needs 1.18, 1.20.
- 1.22 Fake server: patient alerts and the field bundle read. X. `fake_server.dart`, `fake_reads_test.dart`. Needs 1.19, 1.21.
- 1.23 Headings and rejection wording for the new entities. R. `apps/mobile/lib/features/sync/sync_labels.dart`. Needs 1.20.

**Unit 2. Inventory routes** (owns `services/api/src/routes/inventory.ts`, `routes/orders.ts`, `services/api/src/inventory/` except `rules.ts` and `movements.ts`, the seed)
- 2.01 Locations: list, create, update. T. `routes/inventory.ts`, `inventory/locations.ts`. Needs unit 1.
- 2.02 A location's stock, and the supply log. T. `routes/inventory.ts`, `inventory/reads.ts`. Needs 2.01.
- 2.03 Restock and receive. T. `routes/inventory.ts`, `inventory/restock.ts`. Needs 2.01.
- 2.04 Counts: set-up and correction. T. `routes/inventory.ts`, `inventory/counts.ts`. Needs 2.03.
- 2.05 Outings: list, create, end. T. `routes/inventory.ts`, `inventory/outings.ts`. Needs 2.01.
- 2.06 The field bundle. T. `routes/inventory.ts`, `inventory/field-bundle.ts`. Needs 2.05.
- 2.07 Alerts list. T. `routes/inventory.ts`, `inventory/alerts.ts`. Needs 2.05.
- 2.08 An encounter's orders, and orders to review. T. `routes/orders.ts`, `orders/reads.ts`. Needs unit 1.
- 2.09 Demo bags, stock and an outing in the seed. S. The seed script and its data module. Needs 2.05.

**Unit 3. Push** (owns `services/api/src/push/` except `messages.ts`, `routes/push.ts`, `apps/mobile/lib/push/`)
- 3.01 Token routes. T. `routes/push.ts`, `push/tokens.ts`. Needs 1.05.
- 3.02 `PushSender` in `Deps`, with the empty and recording senders. T. `types.ts`, `push/sender.ts`, `test/harness.ts`. Needs nothing.
- 3.03 `queuePush`: recipients, `not_before`, dedupe; called by the movement writer and by "end outing". X. `push/outbox.ts`, and one call each in `inventory/movements.ts` and `inventory/outings.ts` (after 1.17 and 2.05 are merged). Needs 1.17, 2.05.
- 3.04 `drainPush`, called after a sync request commits. X. `push/drain.ts`, `routes/sync.ts`. Needs 3.02, 3.03.
- 3.05 Phone: `PushTokenSource` with an empty implementation, registered after sign-in. T. `apps/mobile/lib/push/push_tokens.dart`, `app_providers.dart`. Needs 3.01.

**Unit 4. Phone orders** (owns `apps/mobile/lib/inventory/` and `lib/orders/` except rule files, `lib/features/orders/`)
- 4.01 Field bundle: fetch, keep, read. T (X if it needs a new local table). `lib/inventory/inventory_repository.dart`. Needs 2.06.
- 4.02 `placeOrders` and `voidOrder` through the store. T. `lib/orders/order_repository.dart`. Needs 1.20.
- 4.03 Bags today. R. `lib/features/orders/bags_today_screen.dart`. Needs 4.01.
- 4.04 Orders tab: categories, list, search, one-tap item. R. `lib/features/orders/orders_tab.dart`. Needs 4.02, 4.03.
- 4.05 Allergy hard stop screen, tests first. R. `lib/features/orders/allergy_stop_screen.dart`. Needs 1.12.
- 4.06 Ordering flow: check, stop, override, bundle stops before any line; tests first. T. `lib/orders/order_flow.dart`. Needs 4.02, 4.05.
- 4.07 Supply screen. R. `lib/features/orders/supply_screen.dart`. Needs 4.06.
- 4.08 Given in this encounter: rows, result, lot, remove, flag wording. R. `lib/features/orders/given_list.dart`. Needs 4.02.
- 4.09 Hook the tab and the supply step into phase 4's encounter screen. R. Phase 4's encounter screen file. Needs 4.04, 4.07.
- 4.10 Offline and kill-the-app tests for orders. T. Tests only. Needs 4.06.
- 4.11 Three-theme and narrow-width tests for 4.03 to 4.08. S. Tests only. Needs 4.09.

**Unit 5. Phone banners and alerts** (owns `apps/mobile/lib/alerts/` except `banners.dart`, `lib/features/alerts/`, the banner slot in `patient_screen.dart`)
- 5.01 Alert repository: add, end, read from `_chart`. T. `lib/alerts/alert_repository.dart`. Needs 1.20.
- 5.02 Banner strip on the chart. R. `lib/features/alerts/banner_strip.dart`, `lib/features/patients/patient_screen.dart`. Needs 5.01, 1.14.
- 5.03 Add and end alert sheets. R. `lib/features/alerts/alert_sheets.dart`. Needs 5.01.
- 5.04 Home: supply alerts row and list. R. `lib/features/alerts/stock_alerts_screen.dart`, `lib/features/home/home_screen.dart`. Needs 2.07, 1.08.
- 5.05 Three-theme and offline tests for 5.02 to 5.04. S. Tests only. Needs 5.04.

**Unit 6. Portal** (owns `apps/portal/src/app/(app)/inventory/`, `team/orders-review/`, their e2e files)
- 6.01 Inventory page and its nav entry. R. `inventory/page.tsx`, the nav file. Needs 2.01.
- 6.02 A bag's page. R. `inventory/[locationId]/page.tsx`. Needs 2.02.
- 6.03 Restock and receive forms. R. `inventory/[locationId]/RestockForm.tsx`, its action. Needs 2.03.
- 6.04 Count form. R. `inventory/[locationId]/CountForm.tsx`, its action. Needs 2.04.
- 6.05 Supply log. R. `inventory/log/page.tsx`. Needs 2.02.
- 6.06 Bags out today. R. `inventory/outings/page.tsx`, its action. Needs 2.05.
- 6.07 Restock alerts, and the Home count. R. `inventory/alerts/page.tsx`, `home/page.tsx`. Needs 2.07.
- 6.08 Orders to review. R. `team/orders-review/page.tsx`. Needs 2.08.
- 6.09 Banners on the patient page. R. The patient page file. Needs 1.19.
- 6.10 Playwright and axe for 6.01 to 6.09, three themes. S. `apps/portal/e2e/inventory.spec.ts`, `a11y.spec.ts`. Needs 6.09.

**Unit 7. Close**
- 7.01 Done when against the API. X. `services/api/test/inventory-done-when.test.ts`. Needs units 2 and 3.
- 7.02 Done when on the phone: fake, and the live job. X. `apps/mobile/test/orders/done_when_test.dart`, `tools/live-sync.sh`. Needs unit 4.
- 7.03 Push and audit PHI pins (column list, details scan). T. Tests only. Needs unit 3.
- 7.04 Compliance docs, the plan's D-table and section 6 rows. S. `docs/compliance/*.md`, `IMPLEMENTATION_PLAN.md`. Needs all.

**Cards by level: 67 in all. S 5, T 26, R 19, X 17.**
