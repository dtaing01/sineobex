> Draft plan (Nov 14), checked against the reviewed phase 4 design and the designs of the phases before it. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 6: orders, inventory and alerts

"PRD main N" is a line of the product spec's main tab; "Build plan N" a line of its Build plan tab. Code citations are paths and functions at `1fe1632` (phase 5 closed), from the repository root. "lifecycle" and "forms" with a section number are the two parts of the phase 4 design (`docs/design/phase-4/`); "phase 5" with a section number is `docs/design/phase-5-admin-configuration.md`. A row id (PL-27, BM-85, CO-16, TM-37) is a row of `docs/decisions-for-review.md`. The migrations take the next free numbers when their unit starts: phase 4 took 0017 to 0022 and phase 5 took 0023 to 0025, so 0026 to 0030 if nothing lands between.

## 1. Scope and Done when
**Done when** (Build plan 98; `IMPLEMENTATION_PLAN.md` section 4, phase 6 row): dispensing 3 of an item a bag holds 1 of leaves it at −2 and alerts the Program Admin, Logistics and the route lead, with nothing shown to the field user during the run. Section 10.1 walks it as one story, in five places.

| In | PRD |
|---|---|
| Phase 5's leftovers, first: the API's own team filter where row-level security is the only line, the portal's end-to-end job split across runners, a shorter local CI, a held answer that keeps naming another hash, table cells that split short words (plan risks 11 to 14 and 16, D146); the phone's focus ring as a unit of its own (risk 15) | `IMPLEMENTATION_PLAN.md` section 8 |
| Stock for phase 5's bags and for team stock; a bag's owner, whose bag goes with them; a bag counted once at set-up; a count corrected, and an item taken off a bag's list, with a reason | main 474, 475, 954, 961; Build plan 95 |
| Required periodic recounts: a team setting, off by default | main 475 |
| The Orders screen: items by category (OTC, Rx, Labs, others), the in-bag list with a search bar, single items in one tap, a Labs item with its result and an item that captures a lot with its lot | main 104, 125, 426, 443 |
| Suggest, then confirm: bundles (their prompt first) and field mappings pre-fill a supply screen, shown once at Complete when untouched; the worker confirms or adjusts | main 382, 424-431, 437-448, 471 |
| The Quick encounter's Medication answer leads to the order (phase 4 records the answers only) | main 404, 409; forms 6.4, 6.8 |
| Deduction from the bags being carried; the app picks the bag, staff can change it | main 448, 475 |
| Dispensing past the count, or an item the bag does not list: the count goes negative, nothing is shown to anyone on the run, and three roles are alerted | main 126, 472; Build plan 96 |
| The restock reminder when a bag drops below a minimum phase 5 set, while minimums are on | main 477 |
| Every stock change logged with user, bag, item, quantity, reason and time; the supply log | main 473, 475 |
| In the portal: restock from team stock or from outside, receipts into team stock, the set-up count and the count correction; team stock and each bag listed A–Z with a search box | main 473, 475, 957, 960, 961, 967 |
| Medication orders by ordering credentials only; Medical and Non-Medical items; an order of a sensitive item read as a sensitive note is | main 121, 435, 447, 450 |
| Point-of-care lab orders record the test and its result | main 104 |
| The allergy hard stop before every order: it blocks until acknowledged with a reason, offers another item, and the override is logged | main 450, 497; Build plan 97 |
| Passive banners on the chart; they never block and work offline | main 498, 501 |
| Push notifications with no names or health details, built up to the sender | main 601, 746; Build plan 97 |

| Out | Goes to | PRD |
|---|---|---|
| Items, categories, bundles, mappings, bags' names and minimums, and their admin pages | Phase 5 owns them (phase 5 4.4, 8.1). This phase adds three optional body fields (4.3) and two boxes to phase 5's pages (8) | Build plan 90 |
| Routes, the bag check on confirm, the packing list, restock on the phone ("Restock now"), "Request supplies" beside a route's bag check result, banners on a route stop, the medication delivery task, the after-run checklist's bag counts and restock, the route push sentences | Phase 7 (Request supplies: PL-34) | main 330, 331, 362, 366, 418, 476, 478 |
| Billing codes from an order set; the supply log in exports | Phase 10 | main 437, 473 |
| Medication distribution tracking on desktop | After the MVP: stage 18 | main 450, 784 |
| Team kits on a Logistics phone in Assignment mode | Not built: bags are managed in the portal (BM-102) | main 956 |
| A push for the 24-hour alert, or for tasks due | Not built: it needs a scheduled job no phase designs (PL-33; phase 12 design 11.1 #20). Both still show in the app | main 99, 746 |
| The real push sender, the phone's push plugin and its permission prompt, a scheduled drain | Phase 12, once the accounts exist (BF-11) and counsel answers (CO-16) | main 601 |
| Send-out labs and result follow-up; geofenced alerts; barcode scanning | V2 or deferred | main 104, 479, 499 |

## 2. Ground truth
### 2.1 What the code has at `1fe1632`
| Fact | Where |
|---|---|
| Migrations stop at `0025_note_type_origin.sql`; the next free number is 0026. No stock, order, outing, route or push table exists. A bag is a `team_presets` row of kind `bag` holding only its name and minimums, and a preset can be a composite foreign key's target (`team_presets_team_id_key unique (team_id, id)`) | `db/migrations/`; `0023_team_presets.sql` 40-66 |
| `inventory.view` ("See bags, team stock and supply logs") and `inventory.manage` ("Restock bags, move stock and record recounts") exist. Program Admin holds every key; Logistics holds both and neither `team.manage_presets` nor `team.manage_users`; Healthcare Staff and Billing/Data hold `inventory.view` only; Billing/Data holds `patients.view` and `billing.view_codes` and not `patients.view_sensitive` | `services/api/src/auth/permissions.ts` 12-37; `db/migrations/0002_identity_access.sql` 84-97 |
| `CAPABILITIES[credential]` has `chartMedical` and `orderMedications`: attending, resident, NP and PA have both; a student charts Medical and cannot order; a CHW and none have neither | `services/api/src/auth/permissions.ts` 96-170 |
| A Program Admin, where a rule needs one with no new key, is a holder of `team.manage_users` (PL-19) | `services/api/src/sync/read-rules.ts` `flagChangeShown`; `services/api/src/encounters/counts.ts` `homeCounts` |
| A synced record type is one `EntityRules` module in `RULES`; `storeCreate` checks, inserts, writes history and the audit event in the change's transaction and puts the rule's answer in the receipt's details. Every `load(tx, id, lock)` takes no team and reads by id alone (D146) | `services/api/src/sync/records.ts` 729-764, 803-863; `services/api/src/sync/entities/index.ts` 25-40; `services/api/src/sync/entities/allergy.ts` `load` |
| The read rule has one copy, `read-rules.ts` (`readNeed`, `readsRecord`, `flagChangeShown`). The sync read refuses by it (`routes/sync.ts` `requireRead`), the review queue hides a held change by it (`review.ts` `shownChange`), the records read shows a record by it (`review.ts` `fetchRecords`, `asRead`), and a value sent back holds nothing by it (`apply.ts` `fieldForAnswer`). Each rule that needs the reader has a case in the last three; an entity with none falls to `default` and is shown whole | `services/api/src/sync/read-rules.ts` 7-34, 143-157; `services/api/src/sync/review.ts` 263-304, 804-864; `services/api/src/sync/apply.ts` 182-197 |
| `applyInSavepoint` stores a `DefinitionError` as `validation`, `definition_error` ("This couldn’t be checked. Tell a Program Admin.") and an integrity error (class 23) as `server_constraint`; any other error stops the batch. `byDefinition` turns a rule's throw into a `DefinitionError`. Phase 5 reads a preset body with `->>` and no cast, since a cast's class 22 would stop a push at every retry | `services/api/src/sync/apply.ts` 391-410; `services/api/src/sync/records.ts` 361-375; `services/api/src/sync/read-rules.ts` `flagRows`; `apps/mobile/lib/features/sync/sync_labels.dart` 94 |
| `decide` holds a change whose sender lacks the entity's key, and one an entity's `mayChange` refuses, for a Program Admin (`permission`). A missing parent is refused `stale_reference` with problem `<entity>_missing`, or held behind the sender's own held create (`heldCreate`) | `services/api/src/sync/apply.ts` 517-545, 642-643, 665-668; `services/api/src/sync/entities/index.ts` `missingParent`, `missingProblem` |
| The credential an act was made under is `signedUnder`'s: the time is believed only with a verified clock, at most 5 minutes after receipt and not before `notBefore` (an addendum's is its visit's receipt, `createReceivedAt`); otherwise the credential now | `services/api/src/encounters/signed-under.ts` 64-105; `services/api/src/sync/entities/note-addendum.ts` 81; `services/api/src/sync/records.ts` 606 |
| Every online route that writes calls `lockTeamWrites(tx, teamId)` as its first statement | `services/api/src/sync/locks.ts` 17-20 |
| A portal act makes its id once per form (D115): the same act again gets the first answer and writes nothing more; an id another act holds is 409 `id_taken` | `services/api/src/patients/flags.ts` `setPatientFlag` |
| A refused key is logged `access.denied` in a transaction of its own, so the refusal survives the route's rollback (D98) | `services/api/src/auth/context.ts` 231-257 |
| Allergies are append-only rows with `substance` (1 to 120), `category`, `severity` and `status` (`active`, `entered_in_error`), never merged by text; the team index carries each active one with its id | `services/api/src/sync/entities/allergy.ts`; `services/api/src/sync/entities/values.ts` 162-174; `services/api/src/patients/team-index.ts` 90-96 |
| The phone reads a patient's allergies two ways: the profile's `AllergyView` list (the group's allergy records that the chart or the opened index entry lists, plus this phone's own, with their Entered in error marks) and a search row's (the index entry's own list). Opening a patient from the index imports the entry's records first (`importIndexEntry`). One rule words the badge, `allergyBadge()`, "Allergies not asked yet" among its states | `apps/mobile/lib/patients/patient_repository.dart` 540-557; `apps/mobile/lib/patients/team_index.dart` 232-244; `apps/mobile/lib/patients/chart_cache.dart` 233; `apps/mobile/lib/design/widgets/allergy_badge.dart` 9-13 |
| A chart's records are imported as records (`importServerRecord`), so an offline set carries real field versions, and only their ids ride in the patient record's `_chart` field (`flagChangeIds`); D44's `_chart` is for what is not a record | `apps/mobile/lib/patients/chart_cache.dart` 16-25, 55-66, 205-212 |
| The visit read lists the records made at the visit (`recordsMadeAt`: referrals, allergies, problems, problem notes) as record snapshots in `records`, each logged `patient.viewed` on its entity and id; the phone logs the same when it reads a cached visit; `recentVisits` are visit reads | `services/api/src/encounters/read.ts` 517-541, 599-631; `apps/mobile/lib/encounters/encounter_api.dart` 539-540; `services/api/src/encounters/timeline.ts` 145-157 |
| Home's numbers are each the length of its list, built by that list's own function, and absent for a list the caller may not open; they name no patient and log nothing | `services/api/src/encounters/counts.ts` 6-67 |
| A record changed by one mark carries `version`, `field_versions`, `field_meta`, `updated_at` with its touch trigger and a why-who-when check, and a guard trigger refuses any other change with class 23 naming its constraint; it is never deleted. An append-only table has `forbid_mutation` and the app role loses update and delete | `db/migrations/0021_referrals.sql`; `0024_patient_flag_changes.sql` 51-127; `0001_base.sql` 103; `0009_patients.sql` 478-495 |
| `CHART_TABLES` lists every table with a `patient_id`, held by a schema test; `patient_of_change` was last replaced in 0024 | `services/api/src/patients/charts.ts` 38-57; `services/api/test/patients-charts.test.ts`; `0024_patient_flag_changes.sql` 144-211 |
| `user_notices` holds a kind, an entity, a record id, a note id and a patient id, no text; kinds are free text; the list route is `GET /v1/team/notices` | `db/migrations/0004_sync.sql` 160-170; `0022_notice_note.sql`; `0024`; `services/api/src/routes/sync.ts` 55-65 |
| `sineobex.devices` has `id uuid primary key` and no `unique (team_id, id)`. "Each user and team gets its own device ID". A wipe is requested in `requestWipe` and confirmed in `confirmWiped`; a member is removed in `removeMember` | `db/migrations/0004_sync.sql` 8-30; `apps/mobile/lib/sync/device_identity.dart` 13-18; `services/api/src/sync/devices.ts` 369, 447; `services/api/src/services/memberships.ts` 337 |
| `Deps` holds `config`, `db`, `verifier`, `identityAdmin`, `log`, `now`, built in `bootstrap.ts` and by hand in three tests. No push code exists anywhere, and no scheduled route | `services/api/src/types.ts` 9-18; `services/api/src/entry/bootstrap.ts` 64; `services/api/test/harness.ts`, `sync.test.ts` 2298, `presets-store.test.ts` 79; `services/api/src/routes/system.ts` |
| The contract's PHI test lets a query carry only an ID, a listed value, a field name, a numeric cursor, or a pattern named for that path (`QUERY_PATTERNS`) | `packages/contract/test/spec.test.ts` 66-144 |
| The phone's local schema is version 4 (`_v1` to `_v4`, additive). Server copies go at every sign-out, Log out anyway included, and when the index's expiry or 403 clears them (`clearServerData`: the team index, cache scopes, presets). Refreshers run in `appRefreshers`' order, the presets' after the team index's. What a receipt hook keeps lives in `receipt_kept`, which goes with its record (D143) | `apps/mobile/lib/sync/local_db.dart` 21, 104-121; `apps/mobile/lib/sync/local_store.dart` 495, 590-605, 2998-3036; `apps/mobile/lib/app_providers.dart` 141-173 |
| Each phone entity declares its outbox category, clock pause, patient side, `patientVia`, parents and status change; `categoryLabel` words `encounters`, `notes`, `patients`, `problems` and `activity`, the last being where an entity with no category falls | `apps/mobile/lib/sync/entities.dart` 595-735, 978; `apps/mobile/lib/features/sync/sync_labels.dart` 33-62 |
| Every sheet and dialog that shows or takes a chart's detail sits in a freeze gate (D125), held by a test that reads `lib`; every box that takes a patient's details or a note's text is a `PrivateBox` (D126) | `apps/mobile/lib/features/patients/sheet_gate.dart`; `apps/mobile/test/security/dialog_gates_test.dart`; `apps/mobile/lib/design/widgets/private_box.dart` |
| The phone's test server serves sync, the index, charts, search, match, notices, history, review decisions, presets and the time; it has no visit read, no timeline and no `/v1/me/counts`, which tests script (`ScriptedApi`) | `apps/mobile/test/sync/fake_server.dart` 746-768; `apps/mobile/test/encounters/scripted_api.dart` |
| The portal's stacked table (`STACKED_TABLE`); the Phones page's rule that wraps cells at spaces; `expectReflowWithSpacing`, `tableWordsSplit` and `expectNothingStored`; server actions in `apps/portal/src/app/actions/<area>.ts`, and route handlers for acts whose page must not re-render (D115) | `apps/portal/src/components/SideBySide.tsx` 11; `apps/portal/src/app/(app)/team/devices/devices.module.css`; `apps/portal/e2e/helpers.ts` 184-283; `apps/portal/src/app/actions/` |
| Recipes for a synced entity, shared vectors, the fake's mirror, an API route and seed data | `docs/plan/patterns/synced-entity.md`, `shared-vectors.md`, `fake-mirror.md`, `api-route.md`, `seed-data.md` |

### 2.2 What phases 4 and 5 built, by file, and what this phase does with it
| From | Thing, as built | What phase 6 does with it |
|---|---|---|
| lifecycle 3.1, 3.10; D56 | Medical is a property of a note's type; a visit's kind only goes to Medical and only decides what is offered; a visit with no patient holds Non-Medical notes only | An order's rules read the item and the credential; the server never judges an order by the visit's kind (5.1) |
| lifecycle 6.4; D66; `packages/forms/src/interp/visible.ts` `visibleAnswers`; `services/api/src/sync/records.ts` `noteReader` | A Medical note is read with `patients.view` and `encounters.chart` or `billing.view_codes` (`mayViewProblems`); a sensitive note type also with `patients.view_sensitive`, and every sensitive type is Medical-only; a treatment record section also with a credential that charts Medical (CO-1); the author reads all | An order is read the same way, by its item's marks (5.1) |
| lifecycle 4.1, 4.2; D59; D137 | A refusal only for what the worker can fix, with the store call that settles it (`fixRejected`); a missing key held for a Program Admin; a throwing rule a stored `definition_error`; every change takes the team lock | Both new entities follow all of it (6) |
| lifecycle 5.1, 5.2, 6.4, 9.7; D67; D91 | The visit read with its `records` made at the visit, logged one by one; the chart answer's `timeline` and `recentVisits`, kept in `_chart` | Orders join `records` (7); patient alerts come with the chart as records (6.4) |
| lifecycle 5.6, 9.9; `apps/mobile/lib/encounters/encounter_api.dart` `HomeTiles`; `apps/mobile/lib/features/encounters/home_tiles.dart` `EncounterTiles` | `GET /v1/me/counts`; Home's tiles, "Connect to see …" offline | It gains `stockAlerts` and a tile (7, 8.7) |
| lifecycle 9.1, 9.4, 9.6, 9.7, 9.13 | The profile's quick actions, "+ Order" left to this phase (`apps/mobile/lib/features/patients/patient_screen.dart` 580-603); the note types list, one list with no tabs (`apps/mobile/lib/features/encounters/note_type_list.dart` `NoteTypesScreen`); the summary with Complete (`summary_screen.dart`); the visit's read view (`visit_screen.dart`, its `_RecordRow`); Needs attention (`apps/mobile/lib/features/sync/needs_attention_screen.dart`, `sync_labels.dart`, `apps/mobile/lib/encounters/refusal_fixes.dart`) | Section 8 hooks into each |
| lifecycle 3.9; `docs/design/phase-4/lifecycle.md` 1133-1135 | The 24-hour alert is worked out when read; its push sentence is reserved ("A note is waiting to be finished.") | The sentence joins the fixed list, unsent (9; PL-33) |
| forms 6.4, 6.8; `packages/forms/definitions/note-types/quick_encounter/v1.json` | The Quick encounter's Medication section (`needs: 'orderMedications'`) holds `order` (choose-many: `otc`, `prescription`), `delivery` (`yes`, `no`) and `instructions`; nothing names which medication, and the platform maps none of it | It leads to the order without a mapping (5.1) |
| Phase 5 4.4; `packages/presets/src/schemas.ts` | Bodies: `order_category` (`behaviour`: `supply`, `medication`, `lab`, fixed); `item` (`name`, `categoryId`, `unit`, `medical`, `captureLot`, `result`); `bundle` (`medical`, `prompt` 0 to 300, `''` asking nothing, `lines` of `itemId`, `qty` 1 to 99, `core`); `field_supply_map`; `condition_supply_map` (phase 7's bag check); `bag` (`name`, `minimums` of `itemId`, `min` 1 to 999); `settings` (`bagMinimumsOn`, `newBagMinimums`, `problemCheckDays`). An item is Medical in a medication or Labs category. A later phase's field joins a body optional, with a default (PL-21). Fixed at creation: `FIXED_FIELDS` (`packages/presets/src/rules.ts` 201) | Orders and stock point at preset ids and versions. Three optional fields join the bodies (4.3). No table for items, bundles, mappings, bag names or minimums |
| Phase 5 4.6; D140; `packages/presets/data/platform.json` | 4 categories (OTC and Rx `medication`, Labs `lab`, Supplies `supply`), 39 items, 18 bundles (three with a prompt), 25 field maps, no bag. Every OTC item (Acetaminophen, Hydrocortisone cream, Naloxone kit, Allergy kit, Cold and flu kit) is a medication, so it needs `orderMedications`. The demo team has one bag, "Demo: Outreach backpack" (`db/seed/demo-presets.ts`) | 5.1 offers OTC items disabled to a student or a CHW; the platform marks six items sensitive (4.3) |
| Phase 5 5.2; D133 | A platform update is decided per entry by `platformUpdateEffect`: an untouched copy takes it in place, an edited one is offered it | The platform's sensitivity marks arrive this way (4.3) |
| Phase 5 5.3 | `suggestSupplies` and `bundleLines`, in TypeScript and Dart (`packages/presets/src/supplies.ts`, `apps/mobile/lib/presets/supplies.dart`), pinned by `supply-suggest.json` | Called as they are (5.1) |
| Phase 5 6.1, 6.4; D130 | `GET /v1/presets`, the phone's `presets` table and `PresetsRefresher`; a body kept as sent, so an older reader keeps a field it does not know; `presetsReaderRevision` and the pin of `preset-bodies.json` (`apps/mobile/lib/presets/models.dart` 76-81, `apps/mobile/test/presets/models_test.dart` 98-117). A record against an older version or an archived preset is accepted | 4.3 stores `item_id` and `item_version`, `bundle_id` and `bundle_version`, `map_id` |
| Phase 5 8.1; PL-15 | Bags are added, named and removed on `/team/presets/bag-minimums`, where `bagMinimumsOn` is set; "phase 6 adds stock and owners" | 4.1, 8 |
| D138; BM-77 | A mapping fires only where every reader of the note sees the answer, and never in a sensitive note type; a line it suggests is read as its note is read (this phase) | `orderVisibleTo`'s note arm (5.1) |
| D146; plan risks 11 to 16 | Phase 5's leftovers, each "phase 6's first unit", or a unit of its own for the focus ring | Unit I0, then IF (2.3, 13) |
| Phase 7 | Nothing | Phase 7 builds on the outing of 4.1 |

### 2.3 Phase 5's leftovers (plan risks 11 to 16)
These come first, because the code they change is what this phase's entities and pages build on. Unit I0 carries them and IF the focus ring (13.1); each plan risk names its card.

| Risk | What | Card |
|---|---|---|
| 13 (D146) | Every synced entity's load by id, `fetchRecords`, flags.ts's id check and `requestWipe` name their team in their own SQL, tested on phase 5's harness, whose database bypasses row-level security (`services/api/test/sync.test.ts` 2259). `EntityRules.load` gains the team, which both new entities then take | I0-sweep |
| 11, 12 | The portal's end-to-end job split across runners, each spec file making the data it reads; local CI running the database and API suites side by side on their own scratch databases, and only what needs the fixed ports under the lock | I0-split |
| 16 | A change whose answer keeps naming another hash shows in Needs attention as a sync fault past a threshold (TM-39), still unconfirmed and never let go of, and the backoff is kept to that change alone | I0-held |
| 14 | The Flags history's remedy (cells wrap at spaces, free text anywhere, the table stacked up to the width it needs) as one rule of the stacked table, on the eight pages the risk lists, held by `tableWordsSplit` at 640, 800 and 1024 px, plain and with text spacing. Every new table of this phase takes it | I0-words |
| 15 | A focus ring at 3:1 in the three themes for the whole phone app, before this phase's screens | IF-ring |

## 3. The design in one page
1. **A count is a sum, never a stored number a phone writes.** Every stock change is one immutable row with a signed quantity. Two phones offline cannot conflict, and −2 is plain arithmetic (PRD main 126). A count already held what an order given before it took, so a dispense dated before a count that arrives after it is absorbed by the server (5.2).
2. **Phones send orders; the server writes the stock movement.** One synced record type carries the order and its bag, so an order and its deduction cannot disagree, and the order is stored with its encounter. A held order moves no stock until it is accepted.
3. **The server never refuses an order for a judgment rule.** The item has already been handed over. A missed allergy or a credential that may not order is stored and flagged for review. A refusal is kept for what the worker can fix (D59), each with its fix (6.1); a rule that throws is a `definition_error`. An order is judged by the item version it names.
4. **Medical follows the item and the credential, as phase 4 made it follow the note** (D56), **and so does sensitivity.** A Medical item needs a credential that charts Medical; a medication also one that orders. An item marked sensitive is read as a sensitive note is, one marked treatment as a treatment record is. The visit's kind only decides what the phone offers.
5. **Items, bundles, mappings and bags are phase 5's presets.** This phase adds what a preset cannot hold: stock, a bag's owner, outings and orders, and three optional body fields. It stores preset ids and versions and defines none of them again.
6. **One read rule each, in `read-rules.ts`.** Who reads an order (`orderVisibleTo`) and a patient alert (`patientAlertShown`) is decided once and asked by the sync read, the review queue, a value sent back, the visit read, the chart, the supply log and the review list (D99).
7. **The allergy check is one pure function, run twice.** The phone runs it over the allergies the profile shows, this phone's own included; the server runs it again over what it holds. Vectors pin both.
8. **Stock alerts are rows opened and closed by arithmetic** in the transaction of the movement that crossed the line. Who is shown one is worked out when it is read, so a role change needs no repair.
9. **Nobody on a run is shown a stock alert, and no phone shows a count.** The portal shows the team's alerts to `inventory.view`; a phone and a push show them to the people who restock and to the route lead, each only once their own outing is over (PRD main 126). The order screen lists what a bag carries, not how many.
10. **"The route" is an outing until phase 7.** An outing is a day, a lead, up to three members and the bags taken. It gives this phase the route's bags, its lead and who is on the run without building routes. Phase 7 attaches a route to it.
11. **Counting is online only.** A count is the one stock change that is not a sum. The server works out its difference under the team lock, in the portal.
12. **Banners are computed from data the phone already holds**, plus one small synced record for the alerts staff write. No banner ever blocks.
13. **Push text comes from a fixed list of sentences.** The payload type has no free-text field, so a name cannot get in. The sender is an interface that sends nothing until the accounts exist and counsel answers.
14. **No new permission keys** (D37). Every check uses keys in `services/api/src/auth/permissions.ts`.

## 4. Data model
Five migrations, 0026 to 0030 if nothing lands between, all level X (policies and triggers). Each table has `team_id uuid not null references sineobex.teams (id)`, `created_at timestamptz not null default now()` and the team policy block of `0009_patients.sql` 478-490 (`team_id = sineobex.current_team_id() or sineobex.is_platform_scope()`, `using` and `with check`). IDs are `uuid`. Every foreign key to a team table is composite with `team_id`, and every unique index starts with `team_id`, so no write is checked against a row the policy hides (a conflict there raises 42501 and stops the push: review finding DR13). An item, a bundle, a mapping or a bag is a composite foreign key to phase 5's `team_presets (team_id, id)`; the API checks the preset's `kind`, as phase 5 does for `flag_id`. Every query this phase writes names `team_id` in its own SQL, row-level security being the second line (D5, D146).

A record changed by one mark takes the shape of `referrals` (0021): `version`, `field_versions`, `field_meta`, `updated_at` with its touch trigger, the mark's why, who and when all three or none, a guard trigger as 0024's that lets only the mark and its bookkeeping change (class 23, naming its constraint), and `revoke delete`. An append-only table takes `forbid_mutation` and `revoke update, delete … from sineobex_app` (0009 495).

### 4.1 `0026_stock_locations_outings.sql`
| Table.column | Type | Meaning and constraint |
|---|---|---|
| `stock_locations.kind` | text | `bag` or `team_stock`; one `team_stock` row per team (partial unique index on `team_id`) |
| `.bag_id` | uuid null | The bag preset. Set exactly when `kind = 'bag'`, and then equal to `id`, so a bag's location ID is its preset ID. Its name and whether it is retired are the preset's (`name`, `state`) |
| `.owner_user_id` | uuid null | A bag someone carries themselves (PRD main 474); a member of the team (the API checks) |
| `.set_up_at`, `.set_up_by` | timestamptz, uuid null | Set by the first count, once: a bag is "counted once when it's set up" |
| `bag_outings.id` | uuid | The act's id, made once per form (7) |
| `.service_date` | date | The day the bags go out |
| `.lead_user_id` | uuid | The route lead for this phase's alerts; one of the members |
| `.name` | text null | 1 to 80, for the picker ("North loop") |
| `.route_id` | uuid null | No foreign key yet; phase 7 adds it |
| `.ended_at`, `.ended_by` | timestamptz, uuid null | Set once, both or neither, when the bags are back; a guard trigger lets nothing else change |
| `bag_outing_members` (`outing_id`, `user_id`) | | Primary key (`team_id`, `outing_id`, `user_id`); one to three per outing, the lead among them (PRD main 327; the API checks, a DB test holds it) |
| `bag_outing_bags` (`outing_id`, `location_id`, `service_date`, `position`) | | Unique (`team_id`, `location_id`, `service_date`): "a bag can go on only one route a day" (PRD main 474) |

A location row is made by the server, never by a person: `ensureLocation` inserts it in the transaction of the bag's first movement, owner change or outing, after the team lock. A bag with no row has no stock yet.

### 4.2 `0027_stock_movements.sql`
`stock_movements` is **append-only**.

| Column | Type | Meaning and constraint |
|---|---|---|
| `location_id`, `item_id` | uuid | Composite foreign keys with `team_id`; `item_id` is an `item` preset |
| `quantity` | integer | Signed, between −9999 and 9999, never 0 but for `not_carried`. No check that a sum stays above 0 |
| `reason` | text | `dispense`, `void`, `restock_out`, `restock_in`, `received`, `setup_count`, `recount`, `not_carried`, `count_absorbed` |
| `order_id` | uuid null | Set for `dispense` and `void`; unique (`team_id`, `order_id`, `reason`), so a replay writes nothing twice |
| `absorbs_movement_id` | uuid null | Set exactly for `count_absorbed`: the `dispense` or `void` it cancels (5.2) |
| `pair_id` | uuid null | The two rows of one restock share it |
| `counted` | integer null | For `setup_count`, `recount` and `not_carried` (0): the number counted |
| `note` | text null | 3 to 300, required for `recount` and `not_carried`: why. Kept with the row and shown in the supply log, never in the audit log (PL-14) |
| `act_id` | uuid null | The online act's id, made once per form (7); unique (`team_id`, `act_id`, `location_id`, `item_id`, `reason`) |
| `outing_id` | uuid null | The outing the server found the movement on (5.2) |
| `effective_at` | timestamptz | When it happened: an order's or a void's own time, never later than its receipt (a check, as 0024's `not_after_receipt`), else the server's |
| `recorded_by`, `clock_verified`, `device_id`, `change_id`, `received_at` | | As `patient_consents` |

`stock_balances` (`team_id`, `location_id`, `item_id`, `quantity integer`, `carried boolean not null default true`, primary key on the first three) is kept by an insert trigger on `stock_movements`: it adds `quantity`; a `not_carried` row clears `carried`; a `restock_in`, `received`, `setup_count` or `recount` row sets it. The balance may be negative. A row exists once an item has moved at a location, and "the bag lists the item" means a row with `carried`. The trigger runs as the app role, which keeps insert and update on the table as it does on `team_index_versions` (0009 493-494); a DB test checks that every balance equals its sum after random movements, so a direct write is caught. A minimum is not stored here: it is read from the bag preset's `minimums`, and counts only while `settings.bagMinimumsOn` is true (phase 5 4.4).

`stock_alerts`: `id`, `location_id`, `item_id`, `kind` (`negative`, `below_minimum`), `opened_at`, `opened_by_movement_id`, `opened_by_user_id`, `outing_id` null, `closed_at` null, `closed_by_movement_id` null. Partial unique index on (`team_id`, `location_id`, `item_id`, `kind`) where `closed_at is null`: one open alert of a kind per item per location. A guard trigger lets only `closed_*` change, once; `revoke delete`.

### 4.3 `0028_encounter_orders.sql`, and three preset body fields
`encounter_orders`, the shape of `referrals`: one row per item given or test done. Only the void and its bookkeeping change after insert; `review_flags` is set once, when the order is stored.

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid | Made on the phone |
| `encounter_id` | uuid | Composite foreign key; the patient is the encounter's (may be none), so the table has no `patient_id` and no `CHART_TABLES` row |
| `item_id`, `item_version` | uuid, integer | The item preset and the version the phone held (phase 5 6.4) |
| `quantity` | integer | 1 to 999, in the item's `unit` (PRD main 127) |
| `location_id` | uuid null | The bag it came from; null means team stock |
| `outing_id` | uuid null | The outing the phone chose, stored when the team holds it, else null |
| `source` | text | `manual`, `bundle`, `mapping` |
| `bundle_id`, `bundle_version`, `map_id` | uuid null, integer null, uuid null | Where a suggested line came from (phase 5 6.4), for phase 10's codes; one that is no bundle or field map of the team is stored null (6.1) |
| `note_id` | uuid null | The note a mapping fired on, set exactly when `map_id` is; a parent of the order (6.1). The line is read as that note is read (`orderVisibleTo`), since what it gives tells what the note recorded (phase 5 4.4, BM-77) |
| `lab_result` | text null | 1 to 120: one of the item's `result` options, or a number as text; required for an item with a `result` (PRD main 104) |
| `lot`, `expiry` | text null (1 to 40), date null | For an item with `captureLot` (PRD main 426); either may be left empty |
| `override_allergy_ids`, `override_reason` | uuid[] null, text null (3 to 300) | Both or neither |
| `review_flags` | text[] not null default `{}` | Subset of `allergy_unchecked`, `needs_medical_credential`, `needs_ordering_credential`; set by the server once, at insert |
| `void_reason`, `voided_by`, `voided_at` | | The set-once void, all three or none |
| `ordered_at` | timestamptz | The order's own time, never later than its receipt (a check) |
| `author_user_id`, `clock_verified`, `created_device_id`, `change_id`, `version`, `field_versions`, `field_meta`, `received_at`, `updated_at` | | As `referrals` |

The migration also replaces `patient_of_change` with a version that has a branch for `encounter_order` (through its encounter) and for `patient_alert` (its `patient_id`), as 0024 did for its entity; the function is `plpgsql`, so the branch for 4.4's table can come first. No migration touches a preset table.

Three optional fields join phase 5's bodies, each with a default in both parsers (PL-21's rule):
- **`item.allergenTerms`**: 0 to 20 words of 2 to 60 characters the allergy check matches besides the item's name, default none (5.4). The platform's items carry none: an item's name already matches, and which drug classes a word stands for is a clinical choice the platform does not invent (D140; BM-103).
- **`item.sensitivity`**: `none` (default), `sensitive` or `treatment`. An order of a `sensitive` item is read as a sensitive note is, of a `treatment` item as a treatment record section is (5.1). It may be raised, never lowered: lowering would show past orders to readers they were hidden from (D132's reason), while raising only hides them, and is how the platform's marks reach a team that installed its items before this phase. `FIXED_FIELDS` gains a list of fields that may only rise; a platform version that raises one is decided by `platformUpdateEffect` as any other change (taken in place for an untouched copy, offered for an edited one, D133). The platform's Pregnancy test, Sexual health kit, Safe smoking kit, Safer crack use kit, Injection kit and Naloxone kit move to their next version as `sensitive` (CO-19).
- **`settings.recountDays`**: null (off, the default) or 7 to 365. A location whose last `setup_count` or `recount` is older is due a recount (5.2; BM-97).

The phone's reader learns all three in the same card, and `models_test.dart`'s pin of `preset-bodies.json` is moved after looking. `presetsReaderRevision` stays, since an older reader keeps a body as sent and so the fields it did not know (phase 5 risk 3).

### 4.4 `0029_patient_alerts.sql`
`patient_alerts`, the shape of `referrals`: `id`, `patient_id` (composite foreign key), `kind` (`safety`, `clinical`, `other`), `text` (1 to 200), `sensitive boolean`, `status` (`active`, `ended`), `end_reason` (3 to 300), `ended_by`, `ended_at` (all three or none), `author_user_id`, `recorded_at`, `clock_verified`, `created_device_id`, `change_id`, `version`, `field_versions`, `field_meta`, `received_at`, `updated_at` with its touch trigger, `unique (team_id, id)`; a guard trigger lets only the end and its bookkeeping change; `revoke delete`. Listed in `CHART_TABLES` as `group`, so a merged chart shows both sides' alerts (D27).

### 4.5 `0030_push.sql`
The migration first adds `alter table sineobex.devices add constraint devices_team_id_key unique (team_id, id)`, so a token's device is a composite key that row-level security cannot hide (0024's comment: a foreign key check ignores it).

| Table | Columns |
|---|---|
| `device_push_tokens` | `device_id` (composite foreign key to `devices (team_id, id)`), `user_id`, `platform` (`android`, `ios`), `token` text (1 to 4096), `updated_at`. Primary key (`team_id`, `device_id`); unique (`team_id`, `token`): registering a token deletes the team's other rows that hold it |
| `push_outbox` | `id`, `user_id`, `message_key` text (one of 9's keys, a check), `count` integer, `not_before` timestamptz, `dedupe_key` text, unique (`team_id`, `dedupe_key`), `sent_at` null, `dropped_at` null, `attempts` integer, `last_error` text null (a code, never the provider's text) |

`push_outbox` has no column that could hold a name, an item or free text. A schema test pins its column list.

## 5. Rules
### 5.1 An order
| State | Reached by | Who | Offline |
|---|---|---|---|
| Suggested (phone memory only, never stored) | A bundle is applied (`bundleLines`), after its prompt (below), or a mapping fires on a note the person acts as the author of (`suggestSupplies` over the answers that count; phase 5 5.3) | The person charting | Yes |
| Ordered | Confirm on the supply screen, or one tap on a single item | `encounters.chart` (BM-88). A Medical item (`medical` true: every medication and test, phase 5 4.4) also needs a credential with `chartMedical`; an item in a `medication` category also `orderMedications` | Yes |
| Voided | "Remove", with a reason | The order's author; anyone else's void is held for a Program Admin (6.1; BM-94) | Yes |

There is no edit. A wrong quantity is a void and a new order. An order is accepted whatever state its encounter and notes are in, and it is outside every note's content hash, so it never changes what was signed (D57; BM-90).

**What the phone offers** (`itemOffered`, 5.3). A Medical item or bundle is listed only in a visit whose kind is Medical and that has a patient (lifecycle 3.10), to a credential with `chartMedical`. A medication is listed but disabled for a credential that may not order. On the platform's categories OTC and Rx are both medications, so a student or a CHW is offered OTC items disabled (BM-63). A CHW adding a Social needs note to a teammate's Medical visit is offered Non-Medical items only.

**Before an order is placed.** Tapping an item with a `result` asks for the result first (its options, or a number in its unit), and the order is placed with it (PRD main 104). Tapping an item that captures a lot asks for its lot and expiry, which may be left empty (BM-93). Applying a bundle whose `prompt` is not empty first shows the prompt on its own screen with **Continue** and **Back**, every time the bundle is applied, offline too; its lines are suggested only after Continue, and Back suggests nothing (PRD main 445; BM-74). Then the allergy check (5.4), before any line is ordered.

**Suggest, then confirm.** The supply screen (8.4) holds the suggested lines from the person's own notes and the bundles they applied. It opens from the summary's **Supplies** row, and Complete opens it first, once, when the visit holds suggestions the person neither confirmed nor dismissed: **Confirm supplies** and **Nothing given** both go on to Complete, and Back returns to the summary. It never stops Complete (PRD main 382, 424, 471; BM-99). Whether a visit's suggestions were seen is kept in memory, so after a restart Complete opens the screen once more.

**The Quick encounter.** When its Medication section's Order holds OTC or Prescription, the supply screen shows a line "Which medication was given?" that opens the Orders screen on the OTC or the Rx chip, the first the answer names. The order is placed there, through the allergy check, as any single item; Nothing given clears the line. No mapping is used: the section names no item (PRD main 404, 409; BM-100). Delivery yes/no stays phase 7's delivery task (PRD main 418).

**The bag.** `pickLocation` (5.3) picks it, among the bags the person carries today (8.1): the chosen outing's, then their own. Staff change it with the line's bag chip on the supply screen, or on a row of Given in this visit (8.5), where choosing another bag voids the order with the reason "Wrong bag", filled in, and places the same order at the chosen bag, in one local transaction (PRD main 475).

**What the server checks.** The credential only, never the visit's kind, which a teammate's switch to Medical may not have synced yet (D56). It flags, never refuses. `mayOrderItem` reads the item and its category's behaviour at the version the order names (`item_version`, as phase 5 6.4 accepts it), and the credential `signedUnder` finds for the order's time, its `notBefore` the encounter's receipt as an addendum's is: a time it does not believe reads the credential now (PL-30).

**Who reads an order** (`orderVisibleTo`, 5.3; one copy, in `services/api/src/sync/read-rules.ts`, asked by every read of section 6.1 and 7). Its author always. Anyone else, all of:
- for a line a mapping suggested, its note is one they may read (`fromNote.readable`: `visibleAnswers` gives them that note);
- a Non-Medical item with `patients.view`; a Medical item as a Medical note is read (`mayViewProblems`: `patients.view` with `encounters.chart` or `billing.view_codes`);
- a `sensitive` item also `patients.view_sensitive`, as a sensitive note type (all of which are Medical) is read, which is the sensitive projection a sensitive flag needs (PL-23);
- a `treatment` item also `patients.view_sensitive` and a credential that charts Medical, as a treatment record section is (CO-1).

The item's marks are read both at the order's version and as the team holds them now, and the stricter counts: Medical if either is, the higher sensitivity of the two. So raising a mark hides past orders at once, and nothing lowered later shows an order to a reader it was hidden from (CO-19). A voided order's reason goes only to its author and a Program Admin (PL-19's: `team.manage_users`); anyone else reads it voided with no reason, the key left out as `flagChangeShown` leaves a mark's (PL-35). The sync read also needs `encounters.chart`, as a visit's records do (`readNeed`).

### 5.2 Stock
| Movement | Who | Where | Effect on the sum |
|---|---|---|---|
| `dispense` | Written by the server for each order | Sync | −quantity at the order's location (team stock when null), dated by the order's time |
| `void` | Written by the server when an order is voided | Sync | +quantity at the same location, dated by the void's time |
| `count_absorbed` | Written by the server after a late `dispense` or `void` (below) | Sync | The opposite of the movement it names |
| `restock_out` and `restock_in` | `inventory.manage` | Portal | −q at team stock, +q at the bag, one `pair_id`. From outside: `restock_in` alone (TM-38) |
| `received` | `inventory.manage` | Portal | +q at team stock |
| `setup_count` | `inventory.manage`, on a location never set up | Portal | counted − current sum |
| `recount` (a correction) | `inventory.manage` and `team.manage_users`, PL-19's Program Admin (PRD main 961; Logistics records restocks but corrects no count: PL-31), with a reason | Portal | counted − current sum; an item added to a bag is a line of it |
| `not_carried` | As a correction, with a reason | Portal | −current sum, to 0; clears `carried`, so the bag no longer lists the item (PRD main 954). A later restock, receipt or count of the item lists it again |

**After every movement** the server reads the balance before and after and the bag's minimum, calls `alertEffect`, and opens or closes alert rows in the same transaction, after the team lock. An alert is never edited by a person. A minimum changed in the portal takes effect at the item's next movement ("after an encounter or a recount", PRD main 477), and a below-minimum alert is shown only while minimums are on and the bag's current minimum is above its balance (5.6), so turning minimums off or lowering one quiets it at once; the row stays as history.

**A count taken while orders are unsynced.** Sums commute; a count does not. A count records when it was taken (its `effective_at`, the server's time). A `dispense` or `void` that arrives after a `setup_count`, `recount` or `not_carried` of its item at its location, and is dated before it, is stored as sent and followed in the same transaction by a `count_absorbed` movement of the opposite quantity naming it: the count already held what it took (`absorbs`, 5.3). `alertEffect` runs on the net change, which is none. The supply log shows both rows.

**Which outing a movement is on.** The server finds it; it never takes the phone's word. For a bag, the outing whose bags include the location and whose window holds the movement's time (from its service date's UTC midnight to 36 hours after, unless ended sooner: `outingOver`, TM-37), the latest if two do. For team stock, the outing the order's author is a member of whose window holds the order's time, the latest if two do. Otherwise none. An alert's outing is the outing of the movement that opened it.

**Recount due.** While the team's `recountDays` is set, a location whose last `setup_count` or `recount` is older than it is due a recount: "Recount due" on the Inventory page, the location's page and the portal's Home count. Nothing blocks, and nothing reaches a phone (PRD main 475; BM-97).

Team stock has no minimum, so its only alert is `negative`; bags warn through their minimums (PRD main 473; BM-98).

### 5.3 The pure functions
Each is written once in TypeScript and once in Dart where both sides need it, with no database or network, and is tested against one hand-written vector file both sides read (`docs/plan/patterns/shared-vectors.md`). `suggestSupplies` and `bundleLines` are phase 5's and are not written again.

| Vector file (`packages/contract/test-vectors/`) | Function: inputs → output | TypeScript | Dart |
|---|---|---|---|
| `stock-rules.json` | `alertEffect({before: int or null, after: int, minimum: int or null})` → `{open: kind[], close: kind[]}`. `negative` opens when `after < 0` and `before` was null or ≥ 0; closes when `before < 0` and `after ≥ 0`. `below_minimum` likewise against `minimum`, never when `minimum` is null (no minimum set, or minimums are off) | `services/api/src/inventory/rules.ts` | none |
| | `countDelta({counted, current})` → int (`counted − current`; 0 means write nothing) | same | none |
| | `absorbs({movementAt, countsAt: [instant]})` → bool: a count of the same item and location was taken after the movement's time | same | none |
| | `outingOver({serviceDate, endedAt, now})` → bool: `endedAt` set, or `now` ≥ the service date's UTC midnight + 36 h. `outingUnderway` is its window's other side: not over and `now` ≥ that midnight | same | `apps/mobile/lib/inventory/rules.dart` |
| | `alertVisibleTo({surface, hasInventoryView, hasInventoryManage, leadsAlertOuting, onOutingUnderway, kind, minimumHolds})` → `shown`, `held` or `hidden` (5.6) | same | same |
| | `pickLocation({itemId, bags: [{id, items: [{itemId, inStock}]}], teamStockId})` → location ID: among the bags in order (the chosen outing's, then the person's own), the first where the item is in stock; else the first that lists it; else the first bag; with no bags, team stock | none | same |
| `order-rules.json` | `mayOrderItem({itemMedical, behaviour, chartMedical, orderMedications})` → flags: `needs_medical_credential` when the item is Medical and `chartMedical` is false; `needs_ordering_credential` when `behaviour` is `medication` and `orderMedications` is false. Both read at the order's item version | `services/api/src/orders/rules.ts` | `apps/mobile/lib/orders/rules.dart` |
| | `itemOffered({visitKind, hasPatient, itemMedical, behaviour, chartMedical, orderMedications})` → `listed`, `disabled` or `hidden` (5.1) | none | same |
| | `orderProblem(value, item)` → null, `result_invalid` (a result on an item with no `result`, an option the item's version does not have, text that is not a number for a number result) or `result_missing` (an item with a `result` and none given) | same | same |
| | `orderVisibleTo({isAuthor, isProgramAdmin, canViewPatients, readsMedical, viewSensitive, chartsMedical, itemMedical, sensitivity, fromNote, voided})` → `{visible, voidReasonShown}` (5.1); `itemMedical` and `sensitivity` are the stricter of the order's version and the head | same | same |
| `allergy-check.json` | `allergyMatches({itemName, allergenTerms, allergies: [{id, substance, status}]})` → sorted allergy IDs. Rule in 5.4 | `services/api/src/orders/allergy-check.ts` | `apps/mobile/lib/orders/allergy_check.dart` |
| | `allergyOutcome({matches, overrideIds})` → `clear`, `overridden` (every match is in `overrideIds`) or `unchecked` | same | same |
| `chart-banners.json` | `chartBanners({alerts, labOrders, today})` → ordered `[{key, tone, alertId?}]` (5.5), over alerts and orders the reader may already see | `services/api/src/alerts/banners.ts` | `apps/mobile/lib/alerts/banners.dart` |
| | `patientAlertShown({isAuthor, sensitiveProjection, sensitive})` → bool (5.5) | same | same |
| `push-messages.json` | `pushMessage(key, count)` → `{title, body}` from the list in section 9 | `services/api/src/push/messages.ts` | none |
| `inventory-done-when.json` | Section 10.1's story: its people, the bag, the item, the outing and each step's expected answer in each place | read by the five tests of 10.1 | same |

### 5.4 The allergy hard stop
- **Match.** Normalize the item name, each of the item's `allergenTerms` and each active allergy's substance with the pinned name normalization (D43; `packages/contract/test-vectors/normalize.json`) and split into words. An allergy matches when a term (or the item name) and the substance are equal, or one is a run of whole words inside the other. A side shorter than 3 characters matches only when equal. Allergies marked entered in error never match. All categories are checked (BM-91).
- **When.** Before every order, single or in a bundle, whatever its category (PRD main 450: "Every order runs the allergy hard-stop check first"). A bundle with a matching line stops before any line is ordered.
- **On the phone.** `allergyMatches` reads the patient's `AllergyView` list, the one the profile's badge is drawn from (`apps/mobile/lib/patients/patient_repository.dart`): the group's allergy records the chart or the index entry lists, plus this phone's own, confirmed or not, less any marked entered in error, here or on the server. An off-route patient opened from the team index has its entry imported as records first (`importIndexEntry`), so the same list serves, and an allergy recorded at this visit offline stops the next matching order. `allergyOutcome` not `clear` → the hard stop (8.3).
- **Ways out.** Only **Record and give**, with a reason of 3 characters or more, places the order, storing `allergyOverride {allergyIds, reason}`. Every other way out places nothing and returns to the list, a bundle's other lines unordered too: **Choose something else**, the back gesture, Escape, a screen reader's dismiss, the store freezing and the app going to the background. **Choose something else** returns to the same category's list with the items that match the patient's allergies marked "Allergy", so another item is one tap; the app recommends no drug (Build plan 97; BM-92).
- **On the server.** The same two functions over the server's active allergies of the encounter's patient group, with the item's name and its current `allergenTerms`: a word added since the phone's copy is what the re-check is for. `clear`: stored. `overridden`: stored, audit `order.allergy_override`. `unchecked` (the phone did not hold the allergy): stored with the flag `allergy_unchecked`, the receipt says so, the author gets a notice, audit `order.flagged`. Never refused (CO-17).
- **No patient, or allergies "not asked".** The check has nothing to match. No stop; the allergy badge, which stays on screen while ordering, says "Allergies not asked yet". A visit with no patient is offered no Medical item (5.1).

### 5.5 Passive banners and patient alerts
`chartBanners` returns, in this order: active `safety` alerts; active `clinical` alerts; a point-of-care result recorded in the last 7 days ("New test result"), from the orders the reader may see; `other` alerts (BM-95). "Allergies not asked yet" is the badge's, not a banner's (`allergyBadge()`). The banner about being unable to consent (phase 3) stays where it is. A banner's words wrap, never truncate; the strip scrolls with the chart and never covers it.

A patient alert is read by `patients.view`, and one marked sensitive only by a reader with the sensitive projection (`patients.view_sensitive` with the problem list's keys, PL-23) or by its author: `patientAlertShown`, one copy in `read-rules.ts`, which the chart answer, the sync read, the records read, the review queue, a value sent back and the banners all ask. One the reader may not see is absent, never blanked (CO-18).

Adding an alert (`kind`, `text`, `sensitive`) and ending one with a reason both need `encounters.chart`, and both work offline (BM-96).

### 5.6 Who is shown a stock alert, and when
"The field user sees no alert during the run; the count goes negative, and the Program Admin, Logistics and the route lead are alerted" (PRD main 126). `alertVisibleTo` (5.3) decides it when the alert is read:
- A `below_minimum` alert whose minimum no longer holds (minimums off, or the bag's current minimum not above its balance) is `hidden` everywhere.
- **The portal**: `shown` to `inventory.view`, at any time (BM-87). It is the desk's list, not the field's.
- **A phone, and a push**: to whoever holds `inventory.manage` and to the lead of the alert's outing (PL-27): `held` while they are on an outing under way (a member, the lead included, of an outing of the team whose window holds now and that is not ended), `shown` otherwise. Everyone else: `hidden`. So nobody on a run sees one, from any bag, and the lead sees their own run's once it is over (BM-86).

Home's **Supplies to restock** number is the count of the phone's `shown` alerts (7). A push is queued, in the opening movement's transaction, for each person the phone surface gives `shown` or `held`, with `not_before` the end of their outing's window when held; one row per team, person, sentence and hour, so a burst is one push (`queuePush`). The drain asks again before it sends (7): the count it sends is the person's `shown` alerts at that moment; a person still on a run waits; one with none left, or who no longer holds the key, is dropped.

## 6. Sync
Both entities follow lifecycle 4.1 and 4.2. No new reject reason: a refused rule is `validation` with a `details.problem`. Every change takes the team lock (D32). A sender without the key is held for a Program Admin, never refused. Each entity's `load` names its team in its own SQL, as I0-sweep makes every entity's do (D146). Every preset body this phase reads (item, category, bundle, map, bag, settings) is read with `->>` and no cast, as `flagRows` reads a flag's, and parsed with the presets package's schemas; a body that does not parse, a version the team does not hold, or a rule that throws raises `DefinitionError` (`byDefinition`), which `applyInSavepoint` stores as `validation`, `definition_error`, worded already ("This couldn’t be checked. Tell a Program Admin."), and the queue goes on.

### 6.1 `encounter_order`
Create value (strict): `encounterId`, `itemId`, `itemVersion`, `quantity`, `locationId` (null allowed), `outingId` (null allowed), `source`, `bundleId`, `bundleVersion`, `mapId`, `noteId` (with `mapId` exactly), `labResult`, `lot`, `expiry` (a date), `allergyOverride` (`{allergyIds: 1 to 30 IDs, reason: 3 to 300}` or null). One settable field: `voided` (`{reason}`, class `set_once`, the `Retraction` shape of `values.ts`). Permission `encounters.chart` for create and for `voided`; `mayChange` for `voided` is the order's author. Clock pause: follows encounters (D35). Phone category `inventory`, worded "Encounter inventory" (PRD main 575); its patient is its encounter's (`patientVia`).

**Parents**: the encounter, and the note when `noteId` is set. A missing one is refused `stale_reference`, `encounter_missing` or `encounter_note_missing`, or held behind the sender's own held create, as today (`missingParent`, `heldCreate`); the phone holds the order behind both, so a refused or held note holds the line it suggested. For `encounter_missing` Needs attention offers **Remove this order**, since an order belongs to its visit.

**Before the insert** the rule checks every id the value names, so a foreign key never answers first: the item (an item preset of the team at a version it holds, in any state: `unknown_item` otherwise), the location (a bag of the team, in any state, or null: `unknown_bag` otherwise), the result (`orderProblem` at the order's item version: `result_invalid`, `result_missing`), the note (one of the same visit: `note_other_visit` otherwise). A `bundleId` that is no bundle of the team and a `mapId` that is no field supply map of the team are stored as null and the line kept, as an unknown `outingId` is: they are provenance.

**After the insert**, in the change's transaction: `mayOrderItem` (5.1), the allergy re-check (5.4), the flags set once with their notice and audit event, then the `dispense` movement with `alertEffect` and any alert rows (5.2), and `order.created`.

| Case | The server answers |
|---|---|
| Valid; rules pass | `accepted`, version 1. One `dispense` movement; `alertEffect` applied. No details about stock, ever |
| `mayOrderItem` returns a flag for the credential `signedUnder` finds | `accepted`, flagged; details `{flags: [...]}`; notice `order_flagged` to the author |
| Allergy outcome `overridden` | `accepted`; audit `order.allergy_override` |
| Allergy outcome `unchecked` | `accepted`, flagged; details `{flags: ['allergy_unchecked']}`; notice to the author |
| The item, bundle or mapping is archived or at an older version; the bag is archived; the encounter is finished; `outingId`, `bundleId` or `mapId` is unknown | `accepted` (phase 5 6.4); an unknown id stored as null |
| `itemId` is not an item of the team (a build fault: the phone offers only items the server sent) | Refused `validation`, problem `unknown_item`. The fix: **Choose the item again**; the store sends the same record with the item chosen, through `fixRejected`, as phase 5 settles `unknown_flag` |
| `locationId` is not a bag of the team (a build fault) | Refused `validation`, problem `unknown_bag`. The fix: **Choose the bag again**; the same record is sent with the bag chosen |
| `orderProblem` returns `result_invalid` or `result_missing` | Refused `validation`, with that problem. The fix: **Enter the result**; the same record is sent with the result |
| `noteId` names a note of another visit | Refused `validation`, problem `note_other_visit`. The fix: **Send without the note**; the same record is sent as a manual line, with `mapId` and `noteId` null |
| A parent is missing | `stale_reference` as above, or held behind the sender's own held create |
| The item's version is not one the team holds, a body does not parse, or a rule throws | Stored `validation`, `definition_error`; the queue goes on |
| The sender lacks `encounters.chart` (a role lowered while offline) | Held for a Program Admin (`permission`), with no movement until it is accepted |
| The value fails the wire schema | The wire schema's answer, naming the change (D51). The screens cannot send one |
| The same change again | The stored receipt; the unique (`team_id`, `order_id`, `reason`) index means no second movement |
| `voided` set by the order's author | `accepted`; one `void` movement; `alertEffect`; audit `order.voided`. A second set: the `set_once` answer |
| `voided` set by anyone else | `mayChange` refuses it, and `decide` holds it for a Program Admin (`permission`), audited `sync.quarantined`; an accept applies it, as phase 5 built for a flag change's mark |

**A held order or void.** It writes no movement. An accept applies it as a push would: its movement and `alertEffect` in the accept's transaction, dated by the order's or the void's own time, and absorbed if a count came between (5.2). A reject writes none, and its sender gets `order_not_applied`, a notice kind with no text naming the order (as D89's). A void held behind its order follows it.

**The read rule** is `read-rules.ts`'s one copy (D99): `readNeed` gives `encounter_order` `encounters.chart`; `orderShown(tx, reader, order)` applies `orderVisibleTo` with the item's marks and the note's readability, and leaves out the void reason where it is not shown. The records read (`fetchRecords`, `asRead`), the review queue (`shownChange`) and a value sent back (`fieldForAnswer`, for a `voided` answer) each gain its case; an order the reader may not see is absent, and a held order or void is shown to a reviewer only as they may read it. A held change of an order whose item is sensitive or treatment, for a reviewer who may not read it, is left out of the queue, its count and its people filter, as a hidden flag's is (D145; CO-19).

### 6.2 `patient_alert`
Create value: `patientId`, `kind`, `text`, `sensitive`. Field `ended` (`{reason}`, `set_once`). Permission `encounters.chart` (BM-96); parent the patient (unknown yet: held behind the patient's create); no clock pause (as allergies, D35); phone category `patients`. No rule refuses: the only failures are the wire schema's. A late create naming a merged patient is stored as sent (D27). Audit `patient_alert.created` and `.ended`.

**The read rule** is `patientAlertShown` (5.5), in `read-rules.ts`: `readNeed` leaves `patient_alert` at `patients.view`, and the records read, the review queue and a value sent back (an `ended` answer) each gain its case, with the reader's id for the author's exception. A held sensitive alert, for a reviewer who may not read it, is left out of the queue as a hidden flag's change is (D145; CO-19).

### 6.3 What the phone's test server must mirror (`apps/mobile/test/sync/fake_server.dart`, level X)
Each rule is pinned to the API's answer in `fake_parity_test.dart` or `fake_reads_test.dart` (D52), named as the API's own, and lands in one push with the rule it mirrors (13.1):
- both create schemas, with astral and U+0085 cases as phase 5's (`sync-values.json`), and `orderProblem`;
- the refusals of 6.1 with their names and fixes; the parents, the note among them, with the hold behind a held create; a missing key held for review; a throwing rule as `definition_error`;
- accept-and-flag for the three flags, with the same receipt details, and the `order_flagged` notice; the allergy re-check over the fake's allergies;
- the fake's own movement list and balances, so a test can read −2; the absorbed late dispense; alert rows opened and closed by `alertEffect`'s vectors; no stock detail in any receipt;
- `voided` and `ended` as `set_once`; a void by anyone but the author held; `order_not_applied` for a held order or void that is rejected;
- the read rule of each entity (`orderVisibleTo`, `patientAlertShown`) in the sync read and a value sent back;
- the reads the phone takes: `GET /v1/inventory/field-bundle`; the chart's `alerts`, by 6.2's rule; `GET /v1/inventory/alerts?surface=phone`, by `alertVisibleTo`;
- every new read answers only the team's rows, as the API's own team filter and row-level security do (phase 5's S3): another team's order, alert or bag is missing; each order and alert stored takes its own receipt instant, after every receipt before it (phase 5's VS6, VR4).

Not mirrored, and said in its header: the visit read (with its orders among `records`), `recentVisits` and `/v1/me/counts`, which the fake does not serve and tests script (`scripted_api.dart`), as phase 4's do, the API's own tests and the live job holding them; the inventory and push routes; the review queue and the orders to review; the team lock and the audit events; `queuePush` and the drain.

### 6.4 What a phone holds
| Data | How it arrives | When it leaves |
|---|---|---|
| Items, categories, bundles, mappings, bags' names (with `allergenTerms` and `sensitivity`), settings | Phase 5's `GET /v1/presets`, in its `presets` table | Phase 5's rule: with the team's other server copies (`clearServerData`), so at every sign-out, Log out anyway included, and when the index's expiry or a 403 clears them |
| The field bundle: the team's outings whose service date is the server's UTC date or a day either side, each with its lead, members and bags; the bags the person owns; per bag the items it lists, each with `inStock` (no numbers) | `GET /v1/inventory/field-bundle` after each sync, an `AfterSyncRefresher` wired in `appRefreshers` after the presets' refresher, run only for a role that may read it (`encounters.chart` or `inventory.view`). Stored whole in a new table `inventory_bundle` of the team database (an additive step `_v5`, `schemaVersion` 5) | Replaced whole at each pull; with the team's other server copies (`clearServerData`); on a 403 from the route |
| The outing chosen today | Phone only, in memory. Bags today (8.1) shows the outings of the phone's own local date that the person is a member of; one alone is chosen without asking, so only someone on none or several is asked, and asked again after a restart | End of day |
| Allergies | Already there: the chart, or the team index entry imported as records when the patient is opened (PRD main 272) | With the chart or index |
| Patient alerts | The chart answer's `alerts`, record snapshots imported with `importServerRecord` as flag changes are (`chart_cache.dart`), their ids kept in `_chart` as `alertIds`; also `POST /v1/sync/records`; the phone's own in the outbox | With the chart (D46); one made here only after its own hash-confirmed receipt |
| Own orders | The local store, filed under their encounter | With the encounter, after a hash-confirmed receipt (D23) |
| Orders of the visits the phone holds | Among each visit read's `records` (7), as record snapshots with their versions, so a void can be sent from one, `recentVisits` offline included | With the chart |
| A receipt's flags | A receipt hook (kind `orderFlags`) in `receipt_kept`, until the order's record from the server brings them (D143) | With the record |

A phone with no field bundle (first sign-in offline, or a role without the keys) still orders: `pickLocation` returns team stock (`locationId` null). Nothing a phone holds for this phase is in `kv`, enters the team index, or names a patient outside a chart (D40).

## 7. API routes that only work online
All follow `docs/plan/patterns/api-route.md`. **Every route that writes calls `lockTeamWrites` as its first statement**, as every online writer does (lifecycle 5), then writes and audits in one transaction. Each write's form makes its act's id once (D115): a restock's, a receipt's, a count's, a removal's and an outing's id is stored on the rows it makes (`stock_movements.act_id`, `bag_outings.id`), so the same act sent again answers what those rows hold and writes nothing more, and an id another act holds is 409 `id_taken`, as `POST /v1/patients/{patientId}/flags` does. Every refusal is the standard 403 with the key it lacked, logged, or a code shown to a person at a desk who can fix it; none reaches a phone's queue. A key that can only be decided after a read (a correction's, below) is refused by ending that transaction and logging `access.denied {permission, route}` in one of its own, as `require` does (D98). Every read that shows a patient's visit or chart writes its event in its transaction, and one whose event can't be written is refused. No path, query or log line carries a patient ID or an item name; a query carries an ID, a listed value, a numeric cursor or, on exactly the paths named, a date (`^\d{4}-\d{2}-\d{2}$`, joining `QUERY_PATTERNS` in `packages/contract/test/spec.test.ts`).

| Route | Key | Request → answer | Refusals | Audit event |
|---|---|---|---|---|
| `GET /v1/inventory/locations` | `inventory.view` | → team stock and every bag preset, A–Z, with name, owner, set-up state, "Recount due", item counts and open alerts | | none (no patient data) |
| `PATCH /v1/inventory/locations/{id}` | `team.manage_presets` (PL-29) | `{id, ownerUserId or null}` → the location. A bag is added, renamed and removed by phase 5's preset routes, not here | `owner_not_member`, `team_stock_fixed` | `inventory.bag_owner_set` |
| `GET /v1/inventory/locations/{id}/stock` | `inventory.view` | → the items it lists, A–Z, with balance and minimum; the page searches them | | none |
| `POST /v1/inventory/restocks` | `inventory.manage` | `{id, bagId, source: team_stock or outside, lines: [{itemId, quantity}]}` → new balances | `bag_archived`, `item_unknown` | `inventory.restocked` (bag, line count, total) |
| `POST /v1/inventory/receipts` | `inventory.manage` | `{id, lines}` into team stock → balances | `item_unknown` | `inventory.received` |
| `POST /v1/inventory/counts` | `inventory.manage`; a count of a set-up location (a correction) also `team.manage_users` (PL-31) | `{id, locationId, reason (a correction's, 3 to 300), lines: [{itemId, counted}]}` → balances; under the team lock the server reads the balances and uses `countDelta` | `item_unknown`, `reason_invalid` | `inventory.set_up`, or `inventory.recounted` with each line's `{itemId, before, after}`, never the reason |
| `POST /v1/inventory/locations/{id}/items/{itemId}/not-carried` | As a correction | `{id, reason}` → the location's stock; one `not_carried` movement | `reason_invalid` | `inventory.not_carried` (`itemId`, `before`) |
| `GET /v1/inventory/movements` | `inventory.view` | Filters (location, item, reason, `from` and `to` dates), keyset pages → the supply log: user, bag, item, quantity, reason, a count's note, time. A movement's `encounterId` (and its order) only where `orderVisibleTo` gives the caller that order; otherwise the line is shown without them | | `inventory.log_viewed {patientIds, count}` when any visit was shown, naming every patient whose visit it showed (D33's shape) |
| `GET /v1/inventory/outings?date=`, `POST /v1/inventory/outings` | `routes.view`; `routes.manage` | `{id, serviceDate, leadUserId, memberIds (1 to 3, the lead among them), name, bagIds}` → the outing | `bag_taken` (already out that day), `bag_archived`, `team_size`, `lead_not_member`, `member_not_field` (lacks `routes.view`) | `inventory.outing_created` (members, bags) |
| `POST /v1/inventory/outings/{id}/end` | `routes.manage`, or its lead with `routes.view` | `{id}` → ended; the held pushes of its members become due | `already_ended` | `inventory.outing_ended` |
| `GET /v1/inventory/field-bundle` | `encounters.chart` or `inventory.view` (it holds no number, and a charting role without `inventory.view` would otherwise always deduct from team stock) | → 6.4's bundle | | none |
| `GET /v1/inventory/alerts?surface=` | `portal`: `inventory.view`. `phone`: any member | → the open alerts `alertVisibleTo` gives the caller `shown` on that surface (5.6): bag, item, kind, since when, and on the portal balance and who was out with it | | none |
| `GET /v1/me/counts` (phase 4's, lifecycle 5.6) gains `stockAlerts` | as today | the length of `GET /v1/inventory/alerts?surface=phone`'s own rows, by its function (D99); left out for a caller who holds neither `inventory.manage` nor the lead of an outing, whose list is always empty. Names no patient, so it logs none | as today | none |
| `GET /v1/encounters/{encounterId}` (phase 4's visit read, lifecycle 5.1) | as today (`patients.view`) | `recordsMadeAt` gains `encounter_order`: each order `orderShown` gives the reader, as a record snapshot in `records`, with its versions, so a void can be sent from it, `recentVisits` offline included. An order the reader may not see is absent. The order carries its `allergyOverride` (ids and reason) to whoever may read it. No new key | as today | each order shown is logged `patient.viewed` on its entity and id, as every record made at a visit is, and as the phone's cached read logs it (`encounter_api.dart`) |
| `GET /v1/patients/{patientId}` and `POST /v1/patients/charts` (the chart answer, one schema) gain `alerts` | as today | active and ended alerts, as record snapshots, by `patientAlertShown` | as today | as today |
| `GET /v1/team/orders-to-review` | `team.view_audit` | → the orders with a review flag or an override that `orderShown` gives the caller: IDs, flags, author, time; never a reason. A link opens the visit | | `order.review_viewed (patientIds)` |
| `PUT` and `DELETE /v1/devices/{deviceId}/push-token` | the signed-in user's own device, active | `{platform, token}` → 204. Registering deletes the team's other rows that hold the token | `not_your_device` | `push.token_registered`, `.token_removed` (`deviceId`, `platform`, never the token) |

**Push: built now.** The two tables; the token routes, with a token's rows deleted in `requestWipe`'s and the wipe confirmation's transaction (`services/api/src/sync/devices.ts`) and in a removal's (`services/api/src/services/memberships.ts`), and by the phone at every sign-out, Log out anyway included, and at a team switch, through `DELETE` when online (offline, the next sign-in on that phone registers the token under its new person); `PushSender` (`send(token, platform, {title, body})`) as an optional member of `Deps` whose default is a sender that does nothing, so `bootstrap.ts` and the tests that build `Deps` by hand need no change, and a recording one in `services/api/test/harness.ts`; `queuePush` (5.6: one outbox row per team, recipient, sentence and hour, in the opening movement's transaction, `dedupe_key` = recipient + sentence + hour, its conflict target `(team_id, dedupe_key)`); `drainPush`, called after a sync request commits and never failing it, which sends each due row's sentence with the count it works out then, one push per recipient and sentence, only to an active device of an active member, leaves a row whose recipient is on a run, and drops one with nothing left to say; on the phone a `PushTokenSource` interface with an empty implementation. **Waits for accounts** (BF-11: a Firebase project and an APNs key from the Apple Developer account) **and counsel** (CO-16): the real sender, the phone plugin and its permission prompt, a scheduled drain (phase 12's housekeeping). Until then nothing is sent, and Home and the portal show every alert.

## 8. Screens
The PRD gives wording only for the list (main 125), the kit stepper "− 2 kits +" (main 442) and "2 tasks due today" (main 746). All other wording below is a default for Brooke and Mercy (BM-93), with curly apostrophes as the existing copy has.

Every phone screen here runs its main scenario in Day, Night run and High contrast with the guideline matchers, at 200% text with no overflow and on a 320 px wide phone, and offline, in that screen's own test, with its semantics (labels, focus order). Every sheet, dialog and picker sits in a freeze gate (`SheetGate`, `DialogGate`, the `gate:` of `confirm` and `askReason`; D125), held by `apps/mobile/test/security/dialog_gates_test.dart`; the hard stop is a full-screen route under its screen's gate, and freezing closes it as Choose something else would. Every box that takes an override reason, a void reason, an alert's text or its end reason, a lab result, a lot or an expiry is a `PrivateBox` (D126). Words wrap, never truncate. The focus ring is IF's (plan risk 15), landed before these screens.

| Phone screen | Shows | States and wording |
|---|---|---|
| 8.1 Bags today | "Your bags" (the bags the person owns that no outing takes today, ticked); then the day's outings the person is a member of, each with its bags | Asked only when the person is on none or several outings: "Which bags are you carrying today?"; none: "No bags set for today. Supplies will come from team stock."; not downloaded: the same sentence. The outings are those of the phone's local date (6.4) |
| 8.2 Orders, a screen of its own (`orders_screen.dart`), opened from an **Orders** row at the top of phase 4's note types list (`NoteTypesScreen`, lifecycle 9.4), from the supply screen's lines, and from **+ Order** on the profile (lifecycle 9.1), which opens the person's open visit or phase 4's Start | Category chips (OTC, Rx, Labs, others); a scrollable list of the items the carried bags list, with a search bar; "All items" for the rest of the active items; bundles | No numbers, no stock colour. What is listed follows `itemOffered` (5.1). No ordering credential: medication rows are disabled with "Needs an ordering credential". One tap on an item orders 1, but an item with a result first asks "What was the result?" and one that captures a lot asks "Lot" and "Expiry" (either may be left empty). A line's stepper reads in its unit, "− 2 kits +" (PRD main 442) |
| 8.3 Allergy hard stop | Full screen, under its screen's freeze gate | Title "Allergy warning". Body "This patient has a recorded allergy to {substance} ({severity}). {item} may cause a reaction." Buttons **Choose something else** and **Give anyway**. Give anyway opens a gated `askReason`, "Why is it safe to give?" (3 characters at least), then **Record and give**. On open, focus goes to the title, announced with the allergy and the item; Choose something else comes first in reading order and is the default; nothing is preselected for Give. Every way out but Record and give places nothing (5.4). Choose something else returns to the category's list, the matching items marked "Allergy" |
| 8.3a Before a bundle | The bundle's prompt, full screen | Its words (BM-74), **Continue** and **Back**; Back suggests nothing |
| 8.4 Supply screen (opened from phase 4's summary screen, lifecycle 9.6, by a **Supplies** row above Complete, and by Complete itself once when suggestions are untouched, 5.1) | Suggested lines from the person's own notes and bundles: checkbox, item, unit, stepper in the unit, bag chip (tap to change); for a Quick encounter's Medication answer, the line "Which medication was given?" | Core lines checked, optional unchecked. Buttons **Confirm supplies** and **Nothing given**, both going on to Complete when Complete opened it; Back returns to the summary. After confirm: "Saved", whatever the bag holds |
| 8.5 Given in this visit (on the Orders screen, and under the notes in phase 4's read view of a visit, `visit_screen.dart`'s `_RecordRow`) | Order rows the reader may see, each with its bag as a chip; lab rows with "Result"; rows of an item with `captureLot` with "Lot" and "Expiry" | **Remove** asks "Why remove it?" (a gated `askReason`). Choosing another bag on the chip voids the order ("Wrong bag", filled in) and places it at the chosen bag. A flagged row: "An allergy to this was on the chart when it was given, but not on this phone. Tell the clinician in charge." or "This needed a credential you didn’t hold. Your Program Admin will review it." The flags come from the receipt, kept until the server's record brings them (6.4) |
| 8.6 Banners on the chart | `chartBanners`, each an icon and its words, never colour alone, wrapping | **Add an alert** (a gated sheet: kind, text, "Only for staff who see sensitive details"); **End alert**, with a reason |
| 8.7 Home: a **Supplies to restock** tile among phase 4's tiles (`home_tiles.dart`'s `EncounterTiles`, lifecycle 9.9) | For whoever `stockAlerts` is sent to: its number, from `HomeTiles.stockAlerts` (`encounter_api.dart`) | "{n} supply items need a restock"; opens a list of bag and item (`stock_alerts_screen.dart`), no counts and no patients; offline, as phase 4's tiles: "Connect to see these." |
| 8.8 Needs attention (lifecycle 9.13) | `sync_labels.dart` gains the entity labels ("Order", "Patient alert"), the category "Encounter inventory", and a sentence and a button for each problem of 6.1; `needs_attention_screen.dart` the buttons | **Choose the item again**, **Choose the bag again**, **Enter the result**, **Send without the note**, **Remove this order** (for `encounter_missing`); the sentences of the `order_flagged` and `order_not_applied` notices. A held change shows "Sent for review", as phase 4's do |

| Portal page | Key | Shows |
|---|---|---|
| Inventory | `inventory.view` | Team stock and bags, A–Z, with "Recount due" where it is; negative counts shown as numbers with the word "short". "Add bag" links to phase 5's Bag minimums page |
| A location (team stock or a bag) | `inventory.view` | Its items A–Z by name with a search box (PRD main 473), balance, minimum, open alerts, owner; **Restock** and **Count** for those who may; **Not carried** on an item, with its reason box, for those who may correct; **Change owner** with `team.manage_presets` |
| Restock, Receive and Count forms | section 7's keys | A stepper or typed number per line, in the item's unit; an item the bag does not carry can be added; the **Save restock** button stays pinned (PRD main 950); the list keeps its row order and scroll position while quantities change, and a restock opened from an alert opens pre-filled with the shortfall, those rows on top (PRD main 957). A correction asks "Why are you correcting this count?" |
| Supply log | `inventory.view` | User, bag, item, quantity, reason, a count's note, time (PRD main 475); filters; a visit's link only where the reader may read its order |
| Bags out today | `routes.view`; create with `routes.manage` | Outings by day: lead, members, bags; **End** |
| Restock alerts, and a count on Home | `inventory.view` | Open alerts: bag, item, balance, since when, who was out with it |
| Orders to review | `team.view_audit` | Flagged and overridden orders the reader may read, with a link to the visit |
| Patient page; phase 4's visit page (lifecycle 9.11) | `patients.view` | The same banners as the phone, computed by the server; the visit's orders from the visit read's `records` |
| Phase 5's item form (`team/presets/items/`: `ItemFields.tsx`, `[id]/ItemView.tsx`) | `team.manage_presets` | Two more parts: "Allergy words", with "Words that should stop an order, for example penicillin."; and "Sensitivity": "Not sensitive", "Sensitive: only staff who see sensitive details see who was given it" and "Treatment record: only clinicians who see sensitive details see who was given it", offered only upward once set |
| Phase 5's Bag minimums page (`team/presets/bag-minimums/`) | `team.manage_presets` | One more setting beside "Bag minimums on": "Ask for a recount every … days", off by default |

Every list here (Inventory, a location's stock, the supply log, Bags out today, Restock alerts, Orders to review) is a `STACKED_TABLE` on I0-words' rule (plan risk 14): cells wrap at spaces, free text anywhere, the table stacked up to the width its columns need. Each page passes axe in the three themes, reflows at 320 px, and passes `expectReflowWithSpacing` and `tableWordsSplit` at 640, 800 and 1024 px, plain and with text spacing, and `expectNothingStored`; its addresses carry only IDs, listed values and dates, and its title names no patient. Server actions live in `apps/portal/src/app/actions/inventory.ts` (and `presets-items.ts`, `presets-bags.ts` for phase 5's forms), and an act whose page must not re-render is a route handler with its id made once per form (D115).

## 9. Audit events and the PHI rules that apply
Every event is written in the transaction of the change it records (`ctx.audit`, or the route's transaction). Details carry IDs, counts, codes and flags only. The chain can't be redacted (D41), so an event about a patient names neither the item nor the bag of an order, nor whether an alert is sensitive, for any of them: naming only the others would mark the sensitive ones by their absence, to a role that holds `team.view_audit` without the sensitive keys (CO-14's reasoning, phase 5). The item and the bag are in the order's row, read by `orderVisibleTo`.

| Event | Written when | Details |
|---|---|---|
| `order.created`, `order.voided` | The sync change applies | `changeId`, `quantity`, `source`, `flags`; patient ID in the event's own column |
| `order.allergy_override` | An order with a matching override is stored | `allergyIds`, `reasonLength` (never the reason) |
| `order.flagged` | The server sets a review flag | `flags` |
| `inventory.alert_opened`, `.alert_closed` | `alertEffect` says so | `alertId`, `locationId`, `itemId`, `kind`, `balance`, `recipientCount`; no patient, order or visit |
| `patient_alert.created`, `.ended` | The sync change applies | `kind` (never the text, never whether it is sensitive) |
| `inventory.recounted` | A correction | each line's `{itemId, before, after}`; never the reason, which stays with its movement (PL-14) |
| `inventory.log_viewed`, `order.review_viewed` | The supply log shows a visit; the review list is read | `patientIds`, `count` |
| Section 7's other events | As listed | As listed |

- The supply log is `stock_movements` itself: append-only, so it needs no second copy in the audit chain.
- An override reason, an alert's text, a void reason and a lab result are patient details. They live in their rows, reach only readers of the chart by the read rules of 5.1 and 5.5, and never enter audit details, logs, URLs, page titles, notices or pushes. A count's reason is not patient data but free text, kept with its movement and never audited (PL-14). The `order_flagged` and `order_not_applied` notices are a kind and a record ID, with no text (lifecycle 4.10).
- A stock alert names a bag and an item, never a patient or an encounter. Home's number comes from `GET /v1/me/counts`, which names no patient, so opening Home logs none.
- Push sentences: `stock_alert`: "Supplies to review" / "{n} supply items need a restock."; `note_incomplete`: "Notes" / "A note is waiting to be finished." (reserved by phase 4, lifecycle 3.9); `tasks_due`: "Tasks" / "{n} tasks due today" (PRD main 746). Nothing queues the last two in this phase: both are worked out when read, and no scheduled job exists (PL-33). Phase 7 adds its route sentences to the list (PRD main 330); a sentence joins only by being added to it, in `services/api/src/push/messages.ts` and its vectors.

## 10. Tests
### 10.1 The Done when, as one story
The story is `packages/contract/test-vectors/inventory-done-when.json`: its people, the bag, the item, the outing and each step's expected answer in each place, written before any test that walks it. Its people are the seed's: a Program Admin; Logistics, who builds the outing and goes on it; a Healthcare Staff field user, who dispenses; a second Healthcare Staff member, the lead. So the field user is not the lead, and one of the alerted roles is on the run (PRD main 327, 956).

| # | Step | Asserted |
|---|---|---|
| 1 | A Program Admin adds a bag (phase 5's route) and sets it up with 1 of a Non-Medical supply item (portal route) | Balance 1; one `setup_count` movement; no alert |
| 2 | Logistics creates today's outing: that bag; members the field user, the lead and Logistics, the lead its lead | The field bundle lists the item as in stock, with no number; the field user's Bags today shows the outing chosen, since they are on it alone |
| 3 | The field user's phone goes offline, opens a visit and orders 3 from that bag | The order is in the local store with its encounter and the bag; the screen says "Saved"; no dialog, banner, snack bar, badge or tile mentions stock (widget test) |
| 4 | The phone syncs; the drain runs | Receipt `accepted`, hash matches, no details; the order leaves the outbox |
| 5 | Read the server | Balance −2; one `dispense` movement of −3, on the outing; one open `negative` alert; `inventory.alert_opened` in the same transaction |
| 6 | Read alerts as each person, portal surface, during the outing | All four see it (`inventory.view`, BM-87). The recording sender has sent the Program Admin's push at step 4's drain; Logistics' and the lead's rows wait for the outing; the field user has none (no `inventory.manage`, not the lead) |
| 7 | Read alerts and `/v1/me/counts` as the field user, the lead and Logistics, phone surface, during the outing | Empty; `stockAlerts` 0 for the lead and Logistics, and left out for the field user. The recording sender has sent none of them anything |
| 8 | End the outing; drain | The lead and Logistics see the alert on the phone; each is pushed once, the body equal to `pushMessage`'s text; the field user's phone still shows nothing |
| 9 | Logistics restocks 5 | Balance 3; the alert is closed by that movement; a drain sends nothing more |

It runs in five places: the API (`services/api/test/inventory-done-when.test.ts`, steps 1 to 9); the phone on its test server (`apps/mobile/test/orders/done_when_test.dart`, steps 3 and 4, and step 5's receipt and ledger, −2); the phone against the real API (`apps/mobile/test/orders/live_orders_test.dart`, steps 1 to 9, the field user's and the lead's phones, last in `tools/live-sync.sh`); the screens (`apps/mobile/test/features/orders/done_when_screens_test.dart`, steps 3 and 8 in Day, Night run and High contrast, at 200% text and 320 px wide, offline for step 3); and the portal (`apps/portal/e2e/inventory.spec.ts`, steps 1, 2, 6 and 9, with axe in the three themes, at 320 px and with text spacing).

### 10.2 The rules and the tests that hold them
For sync, audit and permission rules the test bites: the rule is taken out by a script and the test is seen to fail ("How this phase is built").

| Rule | Test that holds it |
|---|---|
| A count is a sum; two phones cannot conflict | Two phones each order 1 of a bag's last item offline, sync in either order: balance −1, one open alert (`sync-orders.test.ts`, `sync_scenarios_test.dart`) |
| `stock_balances` equals the sum of movements; movements cannot be changed | DB test over random movements; update and delete refused; a direct write to a balance caught by the sum check |
| A count already held what an order took | Count, then a dispense dated before it arrives: balance unchanged, the log shows both and a `count_absorbed`; the same on the fake's ledger; `absorbs` vectors |
| A replayed order moves stock once | Send the change twice: one movement |
| An order is never lost | Order offline, kill the app before sync, reopen, sync: stored once, receipt hash matches |
| An item the bag does not list | Dispensing 2 of it: a balance row at −2 and a `negative` alert, nothing on the phone (API and fake) |
| The restock reminder | A dispense below the bag's minimum opens `below_minimum`, a restock above it closes it; with `bagMinimumsOn` false none opens; a minimum changed in the portal counts from the item's next movement; turning minimums off empties `stockAlerts` of below-minimum alerts at once (`inventory-movements.test.ts`, `alertVisibleTo` vectors) |
| A judgment rule never refuses; the visit's kind is never judged | Vectors for `mayOrderItem` and `itemOffered`; each flag case is `accepted` with the flag, on the API and the fake; a Medical item ordered before a teammate's switch to Medical syncs is accepted with no flag; in a visit the server already held, a credential lowered after an order made with a verified clock gives no flag |
| An order is judged by the version it names | An option removed from the item since the order's version: accepted; a supply moved to a medication category since: no flag; an allergy word added since: flagged (`order-rules.json`, `sync-orders.test.ts`) |
| No refusal a worker cannot fix; no fault stops a queue | Each problem of 6.1 is settled by its fix and the queue continues; a preset body that does not parse and a version the team does not hold are stored `definition_error`, and the next change applies |
| A rejected change's dependents are held | A void sent behind its order's refused create (`unknown_item`) is held until the fix, then both apply; an order behind a refused or held note waits, and goes once the note is fixed; an alert's end behind its create (`sync-orders.test.ts`, `sync_scenarios_test.dart`) |
| A held order moves stock only when accepted | An order from a role that lost `encounters.chart`: no movement; the accept writes it, dated by the order's time; a reject writes none and leaves `order_not_applied` |
| A void by someone else | Held for a Program Admin; the accept applies its movement |
| The hard stop | `allergy-check.json` (PCN against "penicillin" words, entered in error, short words, word runs); widget tests: no order is created until a reason is recorded, and each other way out (Choose something else, back, Escape, a screen reader's dismiss, a freeze, the app to the background) creates none; a bundle with one matching line orders nothing until the stop is answered; server test: an allergy added by a second phone gives `allergy_unchecked` |
| The allergies the phone checks | An allergy added offline in the visit stops the next matching order; one marked entered in error here does not stop it; the off-route patient's stop fires from the index entry's allergies with no chart downloaded |
| The bundle's prompt | A bundle with a prompt suggests no line until Continue; Back suggests none (`order_flow_test.dart`) |
| A Labs item needs its result | A one-tap Labs order is not placed until a result is entered; the server refuses `result_missing` with its fix |
| Suggest, then confirm | Complete opens the supply screen once when suggestions are untouched; Nothing given and Confirm supplies both complete; a Quick encounter's OTC answer offers "Which medication was given?" and opens the OTC chip |
| The bag the app picks, and changing it | `pickLocation` vectors; on the supply screen a changed bag chip is the order's `locationId`; in Given in this visit it voids and places the order again; an owner's order deducts from their own bag with no outing |
| Audit in the same transaction; the team lock first | Force the audit insert to fail: no order, no movement, no alert row, for the sync change and for each writing route of 7. Each writing route is seen to take the lock before its first read |
| A read that can't be logged is refused | For the visit read with orders, the chart with alerts, the supply log with visits and the orders to review: the audit insert forced to fail returns an error and no data |
| Row-level security is the second line (D146) | Each new route and both entities run through the bypass harness of I0-sweep: another team's bag, outing, movement, alert, order, patient alert and outbox row are absent, refused or untouched; one person on two teams gets one outbox row per team in the same hour |
| No stock detail reaches anyone on a run | Receipts carry no stock keys (API and fake parity); `alertVisibleTo` vectors; a member holding `inventory.manage` sees nothing and is pushed nothing until the outing ends; a role lowered before the drain is not pushed |
| No patient detail in a push, a URL, a title, storage or the audit log | `push_outbox` column pin; a scan of every new event's details for the seeded name, item text, bag name, reason, result and alert text, and for `sensitive`; `/v1/me/counts` writes no audit row; every portal page's addresses carry only IDs, listed values and dates, its title names no patient, `expectNothingStored`; the new routes' log lines carry only allowlisted keys |
| Log out anyway keeps unsynced work; the offline index is unchanged (D40) | A sign-out that keeps work leaves an unsynced order, its encounter and an unsynced alert, and `clearServerData` takes `inventory_bundle` (`local_store_test.dart`); `inventory_bundle` holds no patient ID or name, and nothing new is written to `kv` or `team_index` |
| Push tokens go with their person | A wipe, a removal and a sign-out each delete the token; a token registered by a second person deletes the first's row; the drain sends only to an active device of an active member |
| Permissions, and who reads an order | One refusal test per route and key; the count correction and Not carried refused for Logistics, the refusal logged in its own transaction; `orderVisibleTo` vectors; a Medical item's order, and a Non-Medical line a mapping suggested from a Medical-only note, are absent from the visit read, `recentVisits` and the sync read for the CHW preset; Billing/Data and the CHW preset get no pregnancy test, safer-use kit or naloxone kit order in the visit read, `recentVisits`, the sync read or the banners, and the supply log gives them no visit for those movements; a voided order's reason only for its author and a Program Admin; the review queue leaves out a held order of a sensitive item for a reviewer without the keys |
| Sensitive alerts | Absent for a reader without the sensitive projection, in the chart answer, the sync read, the review queue and `chartBanners` vectors; present for their author |
| Accessibility | Each new phone screen and portal page by section 8's standard, in its own test; `dialog_gates_test.dart` passes |

## 11. Defaults chosen (PLAN-OPEN) and questions for people
Each default is built, marked `PLAN-OPEN (<row>):` in the code that holds it, and listed in `docs/decisions-for-review.md` under who decides, as "Chosen, not yet built (phase 6)" until the phase closes and names the files its markers are in. No question is left without a default (`CLAUDE.md`: nothing is asked of a person mid-build).

| # | Row | Question | Default | Who decides |
|---|---|---|---|---|
| 1 | PL-27 | Who counts as "Program Admin" and "Logistics" for a stock alert, with custom roles and no new keys? | Everyone holding `inventory.manage`, plus the lead of the alert's outing: it follows the person who can restock (5.6) | Project lead |
| 2 | PL-28 | What is "the route" before routes exist? | An outing: a day, a lead, one to three members and the bags taken. Phase 7 attaches its route (4.1) | Project lead |
| 3 | TM-37 | When does a run start and end, for its members' alerts? | From its service date's UTC midnight until it is ended, or 36 hours after that midnight. Teams have no time zone, so in US zones a member of tomorrow's outing is held from the evening before (5.2, 5.6) | The team |
| 4 | BM-86 | Is someone on the run pushed at once? | No: every member of an outing under way, the lead included, gets the push and the Home tile once their outing is over; everyone else at once (5.6) | Brooke and Mercy |
| 5 | BM-87 | Does "nothing shown to the field user during the run" cover the portal? | No: the phone and the push. The portal shows the team's alerts to `inventory.view` at any time, a field user who opens it mid-run included (5.6, 12) | Brooke and Mercy |
| 6 | BM-85 | Does a field user see how many a bag holds? | No numbers on the phone; "in the bag" or not (8.2) | Brooke and Mercy |
| 7 | BM-101 | Is a bag with an owner carried by its owner? | Yes, on any day no outing takes it: Bags today offers it ticked, and the app looks in it after the outing's bags (6.4, 8.1) | Brooke and Mercy |
| 8 | PL-29 | Who may give a bag an owner? | `team.manage_presets`, the key that adds a bag in phase 5 ("Admins can add bags", PRD main 474) | Project lead |
| 9 | BM-88 | Who may dispense? | `encounters.chart`; check-ins (phase 9) decide for CHWs | Brooke and Mercy |
| 10 | BM-89 | What makes an order Medical: the visit, a note or the item? | The item's `medical` switch and the orderer's credential (`chartMedical`; `orderMedications` for a medication). The phone also asks for a Medical visit with a patient; the server does not judge the kind. No Medical note need exist in the visit (5.1) | Brooke and Mercy |
| 11 | PL-30 | A Medical item ordered under a credential lowered while the phone was offline | Stored and flagged, because the item has left the bag, by the credential `signedUnder` finds for the order's time (5.1). Phase 4 holds a note change in the same case (lifecycle 4.2); an order held would leave the count and the chart wrong until someone acted | Project lead |
| 12 | BM-90 | Is an order part of what a signature covers? (with counsel) | No: it is outside the content hash (D57) and can be added or removed after signing; the visit shows when | Brooke and Mercy; counsel |
| 13 | CO-19 | Which items' orders are sensitive details, and who reads them? (with Brooke and Mercy) | By the item's sensitivity: a `sensitive` item's orders are read as a sensitive note (`patients.view_sensitive` with the problem list's keys), a `treatment` item's also with a credential that charts Medical, as a treatment record (CO-1). A mark may be raised, never lowered. The platform marks the Pregnancy test, the Sexual health kit, the three safer-use kits and the Naloxone kit sensitive, and not the Menstrual care kit, which PRD main 447 lists among the Non-Medical bundles. A held change of one is left out of the review queue for a reviewer who may not read it, as a hidden flag's is (D145) (4.3, 5.1, 6.1) | Counsel, with Brooke and Mercy |
| 14 | PL-35 | Who reads why an order was removed? | Its author and a Program Admin (PL-19), as a flag change's reasons (PL-18): the commonest void is a line charted on the wrong patient (5.1) | Project lead |
| 15 | BM-94 | Who may void an order? | Its author; a void by anyone else is held for a Program Admin (6.1) | Brooke and Mercy |
| 16 | BM-91 | What does the hard stop match on, and which orders are checked? | Every order, whatever its category (PRD main 450); the item's name and its allergy words against every active allergy, all categories; no drug-class dictionary (5.4) | Brooke and Mercy |
| 17 | BM-103 | Which allergy words each platform item carries | None: the platform's items match by their names, and teams add words on the item form; which drug classes a word stands for is a clinical choice the platform does not invent (D140) (4.3) | Brooke and Mercy |
| 18 | BM-92 | What is the "alternative" of Build plan 97? | Choose something else: the same category's list with the items that match the allergies marked "Allergy"; the app suggests no drug (5.4) | Brooke and Mercy |
| 19 | BM-93 | The hard stop's, the screens' and Needs attention's wording; the reasons' length; whether a lot may be left empty | Section 8; 3 to 300 characters, free text; a lot and an expiry are asked and may be left empty | Brooke and Mercy |
| 20 | CO-17 | An order the server finds unsafe after the fact (with Brooke and Mercy) | Stored and flagged, never refused; the author and `team.view_audit` are told (5.4, 7) | Counsel, then Brooke and Mercy |
| 21 | BM-99 | Is the supply screen shown at Complete when suggestions are untouched? | Yes, once; Confirm supplies and Nothing given both go on to Complete; it never stops Complete (5.1) | Brooke and Mercy |
| 22 | BM-100 | How does the Quick encounter's Medication answer become an order? | A line on the supply screen, "Which medication was given?", opens the Orders screen on its chip; no mapping, since the section names no item (5.1) | Brooke and Mercy |
| 23 | PL-31 | Who may correct a count, or take an item off a bag, with no new keys? (with Brooke and Mercy) | `inventory.manage` and `team.manage_users`, PL-19's Program Admin. Logistics records restocks, receipts and set-up counts and corrects nothing (PRD main 961; main 966 asks whether Logistics should) (5.2, 7) | Project lead, with Brooke and Mercy |
| 24 | BM-97 | Do teams require periodic recounts, and how often? | A team setting, off; when on (7 to 365 days), a location past it shows "Recount due" in the portal, and nothing blocks (5.2) | Brooke and Mercy |
| 25 | BM-98 | Does team stock warn when low (PRD main 473)? | Not in the MVP: team stock alerts only when negative; bags warn through their minimums (5.2) | Brooke and Mercy |
| 26 | TM-38 | Do restocks come from outside team stock (PRD main 967)? | Allowed, as `source: outside`: a `restock_in` with no `restock_out` (5.2) | The team |
| 27 | BM-95 | Banner kinds; how long a test result is "new" | `safety`, `clinical`, `other`; 7 days (5.5) | Brooke and Mercy |
| 28 | BM-96 | Who adds and ends a patient alert? | `encounters.chart`, online or offline (5.5) | Brooke and Mercy |
| 29 | CO-18 | Is TB or HIV status in a banner a sensitive detail? | The author marks it; a marked one is read only with the sensitive projection, or by its author (5.5) | Counsel |
| 30 | BM-102 | Team kits on a Logistics phone in Assignment mode (PRD main 956) | Not built: bags are managed in the portal (1) | Brooke and Mercy |
| 31 | PL-34 | Which phase builds "Request supplies" (PRD main 366)? | Phase 7, beside the route's bag check result, with the run it belongs to (1) | Project lead |
| 32 | PL-32 | Which push provider? (with counsel) | Firebase Cloud Messaging for both platforms, fixed sentences only; the sender sends nothing until the accounts exist (BF-11) and counsel answers (CO-16) (7) | Project lead |
| 33 | CO-16 | May a push with a fixed sentence go through a provider with no BAA? | Built with fixed sentences and a count; production sends none until counsel answers (phase 12 design 11.1 #17); Home and the portal show every alert either way (7) | Counsel |
| 34 | PL-33 | Is a scheduled job built so that the 24-hour alert and tasks due are pushed? | Not built in this phase; both show in the app (9; phase 12 design 11.1 #20) | Project lead |
| 35 | TM-39 | When does a change whose answer keeps naming another hash show in Needs attention (plan risk 16)? | After three pushes in a row; it stays unconfirmed and is never let go of, and the backoff is its own, so other changes go at the next tick (2.3) | The team |

Rows already in the document, reused rather than repeated: BM-74 (a bundle's prompt and its words), BM-77 (who reads a line a mapping suggests), BM-63 (naloxone's category), PL-15 (bags in phase 5), PL-19 (who is a Program Admin), PL-23 (the sensitive projection), CO-1 (who reads a treatment record), CO-14 (what the audit log says), CO-15 (the review queue's hidden changes) and PL-9 (how the phase is built). Needed before the first real patient, but no decision: BF-11, the push provider's accounts (a Firebase project and an APNs key from the Apple Developer account) and who owns them.

## 12. Risks, and where the design departs from the PRD or reads it a particular way
1. **Phase 5's leftovers change the code this phase builds on.** I0-sweep gives `EntityRules.load` the team, which both new entities implement; I0-held changes the sync engine and Needs attention, which I1 and I4 edit. They land first (13.1), and a unit that starts before them is rebased on them.
2. **The outing overlaps phase 7.** If phase 7 models routes differently, `bag_outings` becomes a view over routes. It is four small tables, chosen so that the Done when's "route lead", and who is on the run, are real now. Phase 7's design absorbs the outing with its lead as its only member (`docs/design/phase-7-routes-runs.md`, "The outing, absorbed"); with members stored here, it takes them as the route's members.
3. **Reading: "the field user sees no alert during the run" (PRD main 126)** means no stock signal on the phone or in a push of anyone on an outing under way, whatever their role and whichever bag; the lead is alerted after their run, and the Program Admin and Logistics at once unless they are on one. The portal is the desk's, and shows the team's alerts to `inventory.view` at any time (BM-86, BM-87).
4. **Departure: the phone shows no counts.** The PRD's "in-bag items" (main 125) is read as "items the bag lists". A shown count would turn negative and act as an alert. It holds on the Orders screen, the supply screen and during a run; phase 7's bag check at confirm is its one exception (main 476), and needs its own yes.
5. **Departure: an unsafe order is stored, not blocked, by the server.** The hard stop blocks on the phone (PRD main 497). The server cannot block what has been handed over; it flags it (CO-17).
6. **Reading: "needs a Medical encounter and an ordering credential" (PRD main 447) is enforced as phase 4 enforces Medical,** and "Only credentials allowed to order can place them" (main 450) as the phone's rule: the phone offers a Medical item only in a Medical visit and disables a medication for a credential that may not order; the server checks the credential, never the kind (D56), and flags what a lowered credential sent. "No orders" in Non-Medical work (main 379) is read as no Medical items; supplies still deduct.
7. **Text matching misses.** "PCN" matches only if an admin lists it as a word, and the platform ships none (BM-103). A miss shows no stop. The allergy badge stays on screen while ordering.
8. **The phone's test server grows a stock ledger** (plan risk 7). Its parity tests land with the rules they mirror, in I1b, and its reads' in I2.
9. **Push is unproven until accounts exist.** Everything up to the sender is tested; delivery is not, and production sends nothing until counsel answers (CO-16). A token left by a sign-out made offline goes only when that phone next signs in, so until then a push can reach a phone its person signed out of; it carries a fixed sentence only.
10. **Reading: "the route's bags" (PRD main 448, 475)** are the bags of the outing the person is on, and the bags they own that no outing takes that day (main 474).
11. **Reading: "before signing" (PRD main 471)** is the supply screen shown once at Complete when suggestions are untouched; an order can still be added or removed after signing (D57).
12. **Reading: the "alternative" of Build plan 97** is choosing another item of the category, the matching ones marked; the app recommends no drug (BM-92).
13. **Reading: "the team gets a restock reminder" (PRD main 477)** is the people alerted for a negative count (PL-27), and "low-stock warnings" (main 473) are bag minimums (BM-98).
14. **Departure: no push for the 24-hour alert (PRD main 99) or for tasks due (main 746)** until a scheduled job exists (PL-33; phase 12 design 11.1 #20). Both still show on Home and in the portal.
15. **Reading: an order's sensitivity follows its item, as a note's follows its type.** An item marked sensitive or treatment is read as phase 4 reads a sensitive note type or a treatment record; a hand-entered or bundled line has no note to be read by, so the item carries it (CO-19). An item a team forgets to mark is read as any other.
16. **A late order is placed around a count by its own time.** An order made offline with a clock off by a few minutes (within the clock pause's 5) can fall on the wrong side of a count taken in those minutes, and the count's balance is off by that order until the next count.
17. **The audit log names no item or bag for an order** (9). An audit search can tell that a patient was given something, and when, but not what; the chart and the supply log, under their read rules, can.
18. **Below-minimum reminders are read against the minimum now.** An alert opened under an old minimum is quiet while the current one does not hold, and shows again if a later minimum does, until the item's next movement closes or keeps it.

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
