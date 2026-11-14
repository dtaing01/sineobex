> Draft plan (Nov 14), written before phase 4 was built. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 7: routes and runs

"PRD main N" is a line of the product spec's main tab; "Build plan N" a line of its Build plan tab. Paths are from the repository root. "Next free number" means the lowest unused migration number when the unit starts (phase 4 reserves 0017 to 0021; phases 5 and 6 take more). "Lifecycle" is `docs/design/phase-4/lifecycle.md`; "phase 5 design" and "phase 6 design" are the files in `docs/design/`.

## 1. Scope and Done when
**Done when** (Build plan 106; `IMPLEMENTATION_PLAN.md` section 4, phase 7 row): Logistics builds a route, the lead confirms it from the phone, the team runs it with one patient added on the fly and one not located, and Logistics reschedules from the report.

| In | PRD |
|---|---|
| A run (name, date, time window, meeting point, focus, notes) holding one or more routes | main 358-363 |
| Route builder in the portal: team of one to three, one lead, bags, patients ranked by both flag tiers, search box, last seen date, patients on another active route hidden and counted | main 327, 340, 120; Build plan 102 |
| Every stop starts Not yet; anyone on the route logs pre-visit contact (Confirmed, No response, Declined, Rescheduled) with the time; Declined and Rescheduled move the stop to the Removed list; one-tap restore | main 117, 335, 336 |
| The lead reviews and taps Confirm route: the route starts and locks to its team; hard stops before confirming | main 328, 333, 562 |
| Bag check on confirm and whenever a confirmed route changes; warns, never blocks; works offline; the packing list | main 334, 476, 478 |
| Change requests (add, drop, reorder) from Logistics; the lead accepts or declines on the phone; push with no patient details | main 329, 330, 941 |
| Patients and locations added on the run, attributed to the route | main 118, 112, 338 |
| Stop outcomes (Seen, Declined, Could not locate, No response, Other with a reason); corrections after completion, logged old and new. Complete run: untouched stops become Not reached; the route locks | main 365, 119, 148, 149, 342 |
| Post-run report: seen, added on the run, Patients Not Seen, notes not complete, plus counts the app already has | main 99, 119, 367, 369; Build plan 105 |
| Follow-ups: a clinician sets a date from the chart; the board in six columns by due date, filtered by flag and clinician; ticked patients go into the route planner | main 312, 341, 935 |
| Phone Home (your next route, the team's next route) and the Schedule tab | main 744, 745 |
| The route cache: charts of a route's patients kept on the phone | main 337, 533; D30 |
| The route lead's share of the 24-hour incomplete-note alert | main 99; lifecycle 3.9 |

| Out | Who takes it | PRD |
|---|---|---|
| Maps, stop order optimisation, heatmaps, stop time windows | After the MVP list; needs a map provider under a BAA (PLAN-OPEN, section 11) | main 344-356, 364 |
| Volunteer roster, emailing volunteers, run sign-up; team chat | V2; chat is deferred past the MVP | main 360, 362, 745, 330 |
| The continuity-of-care priority list and check-ins | Phase 9. Until then the builder ranks by flags, due follow-ups and missed runs | main 322; Build plan 113 |
| Building a route on the phone | Not in the Build plan's phase 7. The lead adds stops on the phone; the builder is portal only | Build plan 102; main 941 |
| "Request supplies", recounts, bag minimums | Phase 6 | main 366, 477 |
| A real push provider | Waits for accounts (phase 6 design, section 7) | |

## 2. Ground truth
What the code has today:

| Fact | Where |
|---|---|
| No route, run, stop or follow-up table. Migrations stop at `0016`. | `db/migrations/` |
| `routes.view` ("See routes and runs") and `routes.manage` ("Build and assign routes; send change requests") exist. Program Admin and Logistics hold both; Healthcare Staff and the CHW preset hold `routes.view` only; Billing/Data holds neither. | `services/api/src/auth/permissions.ts` 27-28, 79-90; `db/migrations/0002_identity_access.sql` 71-97 |
| A synced record type is one `EntityRules` module in `RULES`; `storeCreate` writes the row, the history and the audit event in the change's transaction. Field classes are `draft`, `keep_both`, `identity`, `status`, `set_once`. | `services/api/src/sync/entities/index.ts` 20-30; `services/api/src/sync/records.ts` 422, 445-493 |
| An append-only, create-only entity with one `set_once` field is `patient_allergy`. It is the pattern for both entities of this phase. | `services/api/src/sync/entities/allergy.ts` |
| The phone holds charts in `records` and `fields`, kept by cache scopes. `CacheSource` has one implementation, `OpenedSource`; the comments reserve a `route` kind with the route ID as `ref`. `reconcile(sources)` downloads what a source wants and adds its scope. | `apps/mobile/lib/patients/chart_cache.dart` 228-256, 392-420; D30 |
| The store has `addScope` and `scopes()`, and no call that removes a scope before it expires. It holds back a change that names a record whose create is rejected or held. | `apps/mobile/lib/sync/local_store.dart` 1709-1721, 966-994 |
| The team search index (no legal names, D40) stays team-wide, as PRD main 534 says. It gives the lead an offline patient picker. It carries last seen dates. | `apps/mobile/lib/patients/team_index.dart` 10-18; `services/api/src/patients/team-index.ts` 51-63 |
| A chart download is audited per chart with a `reason`. | `services/api/src/patients/charts.ts` 610-629 |
| Phone tabs are Home and Patients; "Start, Schedule and Resources arrive with their phases". Home shows a greeting, the clock card and the sync card. | `apps/mobile/lib/app.dart` 74, 202-203; `apps/mobile/lib/features/home/home_screen.dart` |
| `user_notices` (user, kind, entity, record ID; no text) exists. The portal has `home`, `patients`, `team`, `audit`, `owner`; nothing for routes. | `db/migrations/0004_sync.sql` 160-170; `apps/portal/src/app/(app)/` |

What earlier, unbuilt phases must have delivered. If one is missing, it is built first, as its own card.

| Phase | Thing this phase needs |
|---|---|
| 4 | Encounters started from the phone, with a place to pass "started from this stop"; drafts and `GET /v1/team/incomplete-notes` with an author filter (lifecycle 3.9); `isOverdue`; phone Home's "Needs your attention". The forms' follow-up answers "create the same kind of follow-up task" (`docs/design/phase-4/forms-inventory.md` 491): that task is section 4.3's `follow_ups` row. |
| 5 | Flags as presets (`tier`, `rank`, `sensitive`), `patient_flag_changes`, `currentFlags`; bundles; `condition_supply_map` (`codes`, `lines[{itemId, qtyPerPatient}]`); the phone's preset copy (phase 5 design 4.4, 4.5, 5.3, 6.1). |
| 6 | `stock_locations`, `bag_outings` (with a `route_id` column and no foreign key), `bag_outing_bags`, `stock_balances`, `encounter_orders`; outing create and end; the field bundle; `queuePush` and the fixed sentence list; `POST /v1/inventory/restocks` (phase 6 design 4.1, 4.2, 7, 9). |

## 3. The design in one page
1. **A route is built online and run from an event log.** Logistics writes the route in the portal. Everything done on a phone is one immutable `route_event` (contact, confirm, add, drop, restore, reorder, outcome, answer, complete). Phones never overwrite a route or a stop, so two phones offline cannot conflict.
2. **One pure function decides what each event does.** `eventEffect(route, actor, event)` holds the whole state table. The server runs it under the route's row lock; the phone runs it to show the same result before syncing. Vectors pin both.
3. **The server never refuses an event for a route rule.** An event that arrives too late, from the wrong person or against the lock is stored with `applied = false` and a reason code, shown to the lead and Logistics, and told to its author. Nothing sits in Needs attention that the worker cannot fix (lifecycle 48-50; D42).
4. **The lock is the route's status on the server.** After the lead's confirm applies, planner edits are refused online with `route_locked`, and only events from the lead change the plan. The lock does not depend on any phone's copy.
5. **Being the lead is data, not a permission.** Every phone event needs `routes.view`; the planner routes need `routes.manage`. What a lead may do comes from `routes.lead_user_id` (D37: no new keys).
6. **A stop's outcome is resolved, not overwritten.** Outcomes are events. Two people reporting one stop both stay; a fixed order (Seen first) picks what shows, and the report marks the disagreement.
7. **On-the-fly is attribution, not a plan edit.** Anyone on the route adds a patient or a place they met; it always applies, even after Complete, and never takes the patient off another route (main 338).
8. **A phone gets its routes as one bundle, replaced whole,** and the charts of their patients through the existing cache with a `route` scope. Both start arriving when the route is assigned, not when it starts, because the lead may confirm with no signal.
9. **The bag check is a pure function over the bundle.** The server works out each stop's needs and what the route's bags hold; the phone sums them offline (main 476). The server repeats it when the confirm arrives and stores the result.
10. **Reports and the board are worked out when read.** Not reached, Patients Not Seen, missed runs and overdue follow-ups are never written by a job (lifecycle 3.9's rule).

## 4. Data model
Three migrations, each the next free number, each **level X**: every table gets the team policy block of `0009_patients.sql` 484-488, and two get triggers. IDs are `uuid`; every table has `team_id uuid not null references sineobex.teams (id)` and `created_at timestamptz not null default now()`. Foreign keys to team tables are composite with `team_id`.

### 4.1 `<n>_runs_routes.sql`
| Table.column | Type | Meaning and constraint |
|---|---|---|
| `runs.name`, `.service_date` | text 1-80, date | Unique (`team_id`, `service_date`, lower(`name`)) among runs not cancelled |
| `.window_start`, `.window_end`, `.meet_time`; `.meeting_point`, `.focus`, `.notes`, `.summary` | time null; text null, at most 120, 200, 1000, 4000 | `summary` is the after-run narrative. Free text: never logged |
| `.cancelled_at`, `.created_by` | timestamptz null, uuid | Runs are cancelled, never deleted |
| `routes.run_id`, `.name`, `.service_date` | uuid, text 1-80, date | The date is copied from the run |
| `.status` | text | `draft`, `assigned`, `confirmed`, `completed`, `cancelled`. "In progress" is `confirmed` with at least one outcome; it is shown, not stored |
| `.lead_user_id` | uuid not null | A current member of the route |
| `.revision` | integer default 0 | Plus one for every applied event. The lead's confirm names the revision they saw |
| `.assigned_at`, `.confirmed_at`, `.completed_at`, `.cancelled_at` and the matching `_by` | timestamptz, uuid null | Each set once. Times are clock-corrected device times when they come from a phone |
| `route_members` (`route_id`, `user_id`) primary key; `.added_at`, `.added_by`, `.removed_at`, `.removed_by` | | Never deleted, so "was on this route" stays answerable. The API keeps one to three current members |
| `route_stops.id` | uuid | Made by the API for a planned stop, by the phone for one added there |
| `.route_id`, `.patient_id`, `.place` | uuid, uuid null, text null 1-120 | Check: a patient, a place, or both. Unique (`route_id`, `patient_id`). `patient_id` joins the schema test's list of chart tables (D27) |
| `.origin` | text | `planned`, `lead`, `request`, `on_the_fly` |
| `.position` | integer | Order among active stops; gaps allowed |
| `.state`, `.removed_reason` | text, text null | `active` or `removed`; `declined`, `rescheduled`, `dropped` |
| `.contact_status` | text default `not_yet` | `not_yet`, `confirmed`, `no_response`, `declined`, `rescheduled`: the last applied contact |
| `.outcome`, `.outcome_event_id`, `.outcome_conflict` | text null, uuid null, boolean | `seen`, `declined`, `could_not_locate`, `no_response`, `other`. Null shows as Not yet, or Not reached once the route is completed |
| `.planned_bundle_ids`, `.note` | uuid[], text null at most 200 | Planned order sets (main 331); a planner's note ("size 9 sneakers", main 366) |
| `.holds_patient` | boolean | True while the stop is active, not on-the-fly, and its route is `assigned` or `confirmed`. Partial unique index (`team_id`, `patient_id`) where true: one active route per patient (main 340) |

Also: `alter table bag_outings add foreign key (team_id, route_id)` to `routes`, and a unique index on `route_id` where not null. `routes` and `route_stops` are written only by section 5's writer; a schema test replays each route's events and compares.

### 4.2 `<n>_route_events.sql`
`route_events` is **append-only** (trigger refusing update and delete, as `patient_consents`).

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid primary key | Made on the phone, or by the API for a portal action |
| `route_id`, `stop_id`, `patient_id` | uuid, uuid null, uuid null | `patient_id` is set for contact, add and outcome events, so the chart timeline can read them (main 336) |
| `seq` | bigint identity | Server order. Under the route's row lock it is the order events were applied |
| `kind` | text | `contact`, `confirm`, `stop_added`, `stop_dropped`, `stop_restored`, `reorder`, `outcome`, `request_answered`, `complete`, and from the API only `lead_changed`, `assigned`, `team_changed` |
| `payload` | jsonb | Section 6.1's value for the kind |
| `applied`, `reason` | boolean, text null | What `eventEffect` answered: applied, or kept with a reason code |
| `author_user_id`, `device_id`, `change_id`, `device_time`, `effective_at`, `clock_verified` | | As `patient_consents`. `device_id` and `change_id` are null for the portal |

`route_change_requests`: `route_id`, `kind` (`add`, `drop`, `reorder`), `patient_id` null, `place` null, `stop_id` null, `stop_ids uuid[]` null, `status` (`pending`, `accepted`, `declined`, `withdrawn`, `could_not_apply`), `fail_reason` null, `created_by`, `answered_by`, `answered_at`, `answer_event_id`. A trigger lets `status` change once, from `pending`.

`route_bag_checks` is **append-only**: `route_id`, `event_id`, `trigger` (`confirm`, `route_changed`), `lines jsonb` (`[{itemId, needed, held, short}]`), `short_count integer`.

### 4.3 `<n>_follow_ups.sql`
`follow_ups`: `id` (phone- or API-made), `patient_id`, `due_date date`, `source` (`clinician`, `rescheduled`, `declined`), `route_event_id` null (unique, so a replayed event makes one row), `encounter_id` null, `note` text null at most 200, `author_user_id`, `recorded_at`, `clock_verified`, `device_id`, `change_id`, and the set-once `closed_at`, `closed_by`, `close_reason` (`done`, `cancelled`, `replaced`). Nothing else changes after insert (trigger). Index (`team_id`, `due_date`) where `closed_at is null`. Listed with the chart tables (D27).

## 5. Rules
### 5.1 Who is who
**P** planner: holds `routes.manage`, acts online through section 7. **L** lead: `routes.lead_user_id` when the event is applied. **M** member: in `route_members` now or earlier (someone taken off a route mid-run keeps their outcomes). Every phone event also needs `routes.view`.

### 5.2 What each event does, by route status
"Kept" means stored with `applied = false` and the reason in brackets. No cell refuses.

| Event | By | `assigned` | `confirmed` | `completed` |
|---|---|---|---|---|
| `contact` | M, or P | Applied: sets `contact_status`; Declined or Rescheduled removes the stop; Rescheduled also makes a follow-up on its date | The same; no removal once the stop has an outcome | Kept (`route_completed`); still on the timeline |
| `confirm` | L | Applied: status `confirmed`; `unseenChanges` is true when `seenRevision` is behind | Kept (`already_confirmed`) | Kept (`route_closed`) |
| `stop_added`, origin `lead` | L | Applied; a removed stop of the same patient is restored instead; kept (`patient_on_other_route`) when another route holds the patient | The same | Kept (`route_completed`) |
| `stop_added`, origin `on_the_fly` | M | Applied | Applied | Applied |
| `stop_dropped` | L | Applied; kept (`has_outcome`) when the stop has one | The same | Kept (`route_completed`) |
| `stop_restored` | M in `assigned`; L after | Applied; kept (`patient_on_other_route`) | The same | Kept (`route_completed`) |
| `reorder` | L | Applied; stops not named keep their order, after the named ones | The same | Kept (`route_completed`) |
| `outcome` | M, or P | Applied through `resolveOutcome` | Applied | Applied as a correction (main 342) |
| `request_answered` | L | Kept (`not_confirmed`) | Applied; Accept runs the request as the lead's own event; if that is kept, the request becomes `could_not_apply` | Kept (`route_completed`) |
| `complete` | L, or P | Kept (`not_confirmed`) | Applied: status `completed`; phase 6's outing is ended | Kept (`already_completed`) |

Other rows: a `draft` route keeps every phone event (`not_assigned`); a `cancelled` one keeps them (`route_cancelled`). Wrong actor: `not_lead` where L is needed, `not_on_route` where M is needed. A `Seen` outcome with an encounter, sent by a `not_on_route` author, is still kept and listed on the report, so the visit is not lost from the count. Every kept event writes a notice to its author and shows on the route page (8.2). A Declined outcome makes a follow-up (main 150).

**Planner edits** (section 7) are written as the same events by the API. `draft` and `assigned`: allowed. `confirmed`: refused `route_locked`; the portal offers a change request (main 328, 329). Changing the lead is allowed until `completed` (main 327). Outcome corrections and Complete are allowed as the table says.

### 5.3 The pure functions
Each has no database or network in it and is pinned by one vector file in `packages/contract/test-vectors/` that both sides read. TypeScript lives in `services/api/src/runs/`, Dart in `apps/mobile/lib/runs/`.

| Vector file | Function | Input | Output | Dart |
|---|---|---|---|---|
| `route-events.json` | `eventEffect` | `route {status, leadUserId, revision, memberIds, everMemberIds, stops[{id, patientId, state, origin, outcome, position}], pendingRequests}`, `actor {userId, isPlanner}`, `event {kind, payload}`, `heldElsewhere: patientId[]` | `{applied: false, reason}` or `{applied: true, patch[]}`; a patch is one of `setStatus`, `setStop`, `addStop`, `setOrder`, `setRequest`, `makeFollowUp`, `runBagCheck`, `notify` | yes |
| `route-events.json` | `applyPatch` | route, patch list | the route after | yes |
| `route-outcome.json` | `resolveOutcome` | `current {eventId, outcome} or null`, `incoming {eventId, outcome, replaces}` | `{outcome, eventId, conflict}` | yes |
| `route-report.json` | `reportBuckets` | stops with outcome and origin, route status, `seenElsewhere: patientId[]` | `{seen, added, notSeen, removed, other, conflicts}` as stop ID lists | yes |
| `bag-check.json` | `bagCheck` | `needs[{itemId, qty}]`, `held[{itemId, qty}]` | `[{itemId, needed, held, short}]`, only where `short > 0`, by `short` descending | yes |
| `route-planning.json` | `rankCandidates` | `[{id, primaryRank, secondaryRanks[], followUpDue, missedRuns, lastSeenOn}]`, `today` | IDs in order | no |
| `route-planning.json` | `followUpColumn`, `missedRunsInRow` | due date and today; a patient's stop outcomes, newest first | one of six column keys; a count | no |
| `confirm-blockers.json` | `confirmBlockers` | `{isLead, status, activeStops, fixableRejections}` | `[]` or codes `not_lead`, `not_assigned`, `no_stops`, `needs_attention` | Dart only |

- `resolveOutcome`: when `incoming.replaces` equals the current event (or both are empty), the incoming outcome shows. Otherwise both stay and the higher of `seen`, `declined`, `other`, `no_response`, `could_not_locate` shows, with `conflict` true. The result does not depend on arrival order.
- `reportBuckets`: `seen` is outcome `seen`. `added` is origin `on_the_fly`. `notSeen` is an active stop with a patient whose outcome is `could_not_locate` or `no_response`, or, on a completed route, none (Not reached); a patient in `seenElsewhere` comes off it (main 119, 148, 151). `removed` is state `removed`. `other` is outcome `other`. Declined is in none of them (main 150).
- `rankCandidates`: primary rank (lowest first, none last), then the best secondary rank, then how many secondary flags, then `missedRuns` of 3 or more, then the earliest due follow-up, then the oldest `lastSeenOn` (main 120, 317, 152). `followUpColumn`: `overdue`, `today`, `tomorrow`, `this_week` (to Sunday), `next_week`, `later` (main 341). `confirmBlockers`: `fixableRejections` counts the person's rejected changes other than permission ones (main 562).

## 6. Sync
### 6.1 `route_event` (create only; no fields)
The create value is `{routeId, kind, ...}` with one shape per kind. For `stop_added` the record ID is the new stop's ID.

| Kind | Rest of the value |
|---|---|
| `contact` | `stopId`, `result` (`confirmed`, `no_response`, `declined`, `rescheduled`), `method` (`call`, `text`, `in_person`), `rescheduledTo` (a date; required exactly when `rescheduled`) |
| `confirm` | `seenRevision` |
| `stop_added` | `origin` (`lead`, `on_the_fly`), `patientId` or `place` (1 to 120) or both, `afterStopId` null |
| `stop_dropped`, `stop_restored` | `stopId` |
| `reorder` | `stopIds` (1 to 60, none twice) |
| `outcome` | `stopId`, `outcome`, `otherReason` (`moved`, `hospital`, `jail`, `death_reported`, `other`; required exactly when `other`), `note` (at most 200), `encounterId` null, `replaces` null |
| `request_answered` | `requestId`, `answer` (`accepted`, `declined`) |
| `complete` | nothing |

Parents: `patientId` and `encounterId` (the existing parent rule holds the event until they exist). A later event for a phone-made stop names that stop's `stop_added` record, so the store's dependent rule holds it while the add waits. Team lock: no; the writer locks the route row (`for update`) and, for an add or restore, checks `holds_patient` across the patient's merged group. No clock pause (as allergies, D35); `clock_verified` is stored.

| Case | Server answer | Mirrored in the fake |
|---|---|---|
| Valid; author holds `routes.view` | Accepted. Receipt details: `{seq, applied, reason}`. The hash covers the value sent, as for every entity | yes |
| The same ID and hash again | Accepted again with the first answer (`on conflict (id) do nothing`, then read) | yes |
| A route rule says no (section 5.2) | **Accepted**, `applied: false`, the reason code; a notice; audit `route.event_kept` | yes, every reason |
| `routeId` unknown to the team | Rejected `route_unknown`; Needs attention; the queue continues | yes |
| `stopId` or `requestId` not on that route | Rejected `stop_unknown` or `request_unknown` | yes |
| The patient or encounter is not on the server yet | Held as a dependent (existing rule) | yes |
| The patient was merged | Stored as sent; reads group by `canonical_id` (D27) | yes |
| The author lacks `routes.view` | Rejected `permission_denied`, audited `access.denied`; quarantine as today | yes |
| The value breaks the wire schema | Rejected by the schema, naming the change (D51) | yes |

### 6.2 `follow_up` (create, and one `set_once` field)
Create value `{patientId, dueDate, note, encounterId}`; field `closed` (`{reason}`: `done`, `cancelled`, `replaced`). Permission `encounters.chart` and a credential whose `chartMedical` is true ("a clinical decision that only a clinician changes", main 341); otherwise `permission_denied`. Parent: the patient, and the encounter when named. Changing a date is close as `replaced` plus a new create. Rows from a Rescheduled contact or a Declined outcome are written by the server in that event's transaction. Read with the chart, in `records` (D30).

### 6.3 What the phone test server must mirror (`apps/mobile/test/sync/fake_server.dart`, level X)
Each is pinned to the API's answer in `fake_parity_test.dart` (D52): both create schemas; the three rejections; `eventEffect` run over the fake's own routes, with the same receipt details for every reason code; the replay of an applied event; `resolveOutcome`; the follow-up made by Rescheduled and Declined; the lock (a planner edit on a confirmed route is refused in the fake's planner helper); `follow_up`'s credential rule and `closed` as `set_once`; the bundle read with its `revision` and `lastSeq`.

### 6.4 What a phone holds
| Data | How it arrives | When it leaves |
|---|---|---|
| The route bundle: for each route the person is on, from yesterday on (`assigned`, `confirmed`, or `completed` in the last 48 hours): the route, its run's name and times, members, stops (IDs, place, note, planned bundles, state, contact, outcome), every event, pending requests, the outing's bags, `needs` per stop and `held` per needed item, and counts of notes not complete. For other team routes of the next 14 days: name, date, lead, members, stop count only | `GET /v1/routes/field-bundle` after each sync, at unlock and on pull to refresh (`RouteBundleRefresher`, an `AfterSyncRefresher`). Stored whole in a new table of the team database, in one local transaction | Replaced whole at each refresh; the team database's wipe. No patient name is in it: names come from the chart or the index |
| Charts of a route's active stops, with allergies, alerts, problems, flags and recent notes | `RouteSource` (a `CacheSource`, kind `route`, `ref` the route ID) given to `ChartCache.reconcile`; D24 batches; the download's audit reason is `route` | 24 hours after the last refresh (refreshed at each sync while the route is live); at Complete, when the route's scopes are dropped; at sign-out (main 533) |
| The person's own route events | The outbox, as every change | After a hash-confirmed receipt **and** a stored bundle whose `lastSeq` is at least the receipt's `seq`. Until then the event stays, so the screen never loses it |
| Follow-ups | With the chart | With the chart (D46) |
| Bags and what they list | Phase 6's field bundle | Phase 6's rule |

The route screen shows `routeView(bundle route, own events not yet in the bundle)`: the bundle's stops, then `eventEffect` and `applyPatch` for each waiting event in device order. A phone that never fetched a bundle shows "Your routes haven’t downloaded yet. Connect to see them." A route assigned for today or tomorrow starts its charts downloading at once, so a lead with no signal on the morning can still confirm and run.

## 7. API routes that only work online
All follow `docs/plan/patterns/api-route.md`. Every refusal is the standard 403 with the key it lacked, logged. Each write carries a client `requestId`; the same one again returns the first answer. No path, query or log line carries a patient ID, a name or search text. Every planner write that changes a route goes through section 5's writer, so it is an event too.

| Route | Key | Request → answer | Refusals | Audit event |
|---|---|---|---|---|
| `GET /v1/runs?from=&to=`, `POST /v1/runs`, `PATCH /v1/runs/{id}` | `routes.view`; `routes.manage` to write | run fields → the run with its routes' headlines | `name_taken`, `run_cancelled` | `run.created`, `run.updated`, `run.cancelled` |
| `POST /v1/routes` | `routes.manage` | `{runId, name, leadUserId, memberIds, bagIds}` → a `draft` route; makes phase 6's outing when bags are given | `team_size` (not 1 to 3), `lead_not_member`, `member_not_field` (lacks `routes.view`), `bag_taken` | `route.created` |
| `GET /v1/routes/{id}` | `routes.view`; stops only with `patients.view` | → route, members, stops, requests, events kept and not applied | | `route.viewed` (`patientIds`) |
| `POST /v1/routes/{id}/stops`, `…/stops/{stopId}/remove`, `…/order`, `PATCH …/stops/{stopId}` | `routes.manage` | add `{patientId or place, plannedBundleIds, note}`; drop; reorder; edit note and bundles → the route | `route_locked`, `patient_on_other_route` (with that route's name and date), `already_on_route` | `route.stop_added`, `.stop_dropped`, `.reordered`, `.stop_updated` |
| `PUT /v1/routes/{id}/team` | `routes.manage` | `{memberIds, bagIds}` → the route | `route_locked`, `team_size`, `lead_not_member`, `bag_taken` | `route.team_changed` |
| `POST /v1/routes/{id}/lead` | `routes.manage` | `{leadUserId, reason}` → the route; push to the old and new lead and the members | `route_closed`, `lead_not_member` | `route.lead_changed` (old, new) |
| `POST /v1/routes/{id}/assign`, `…/cancel` | `routes.manage` | → `assigned` (needs a stop), or `cancelled` with a reason; push to the team | `no_stops`, `route_locked`, `route_closed` | `route.assigned`, `route.cancelled` |
| `POST /v1/routes/candidates` | `routes.manage` and `patients.view` | `{routeId, search, flagIds, followUpDueBy, page}` → ranked patients (preferred name, flags the caller may see, last seen, due follow-up, missed runs), and `hidden: [{routeName, serviceDate, count}]` | | `route.candidates_viewed` (`patientIds`, criteria without the text; D41) |
| `POST /v1/routes/{id}/requests`, `…/requests/{requestId}/withdraw` | `routes.manage` | `{kind, patientId or place, stopId, stopIds}` → the request; push `route_change_request` to the lead | `not_confirmed` (edit directly instead), `patient_on_other_route`, `already_answered` | `route.request_created`, `.request_withdrawn` |
| `POST /v1/routes/{id}/outcomes` | `routes.manage`, or a member with `routes.view` | `{stopId, outcome, otherReason, note, replaces}` → the stop | `stop_unknown` | `route.outcome_set` (old, new) |
| `POST /v1/routes/{id}/complete` | `routes.manage` | → `completed` | `not_confirmed`, `already_completed` | `route.completed` |
| `GET /v1/routes/field-bundle` | `routes.view` | → section 6.4's bundle with `revision` and `lastSeq` per route | | `route.bundle_fetched` (route IDs, `patientIds`) |
| `GET /v1/routes/{id}/bag-check` | `routes.view` on the route, or `routes.manage`; plus `inventory.view` | → `bagCheck` lines now, the stored checks, and the packing list (planned bundles through phase 5's `bundleLines`, summed) | | none (no patient data) |
| `GET /v1/routes/{id}/report` | `routes.manage`, or a member with `routes.view`; plus `patients.view` | → `reportBuckets` with stop details, notes not complete (`noteId`, author, overdue), kept events, counts (seen, new or existing, referrals, supply items), the bag check | | `route.report_viewed` (`patientIds`) |
| `POST /v1/follow-ups/board` | `routes.manage` and `patients.view` | `{today, flagIds, clinicianIds}` → open follow-ups by column, each with flags, clinician, missed runs, and the route that holds the patient if any | | `followups.board_viewed` (`patientIds`) |

`needs` for a stop is worked out by the server: for each `condition_supply_map`, a patient with a problem of a listed code at status New or Ongoing adds `qtyPerPatient` of each line (main 476). `held` is the sum of `stock_balances` over the route's bags. A stop added on a phone has no `needs` until the next bundle.

Push sentences added to phase 6's fixed list (`services/api/src/push/messages.ts`): `route_assigned` "Routes" / "You have a new route."; `route_change_request` "Routes" / "Your route has a change request" (main 330); `route_changed` "Routes" / "Your route changed."; `route_lead_changed` "Routes" / "Your route has a new lead."; `route_bags_short` "Supplies to review" / "A route’s bags need restocking."; `route_report_ready` "Routes" / "A route report is ready."

## 8. Screens
Every screen passes the accessibility checks in Day, Night run and High contrast, reflows at narrow width, and has an offline test. Recipes: `docs/plan/patterns/phone-screen.md`, `portal-page.md`. Portal page titles are generic ("Routes").

### 8.1 Phone (`apps/mobile/lib/features/runs/`)
| Screen | Shows | States and wording |
|---|---|---|
| Schedule tab | "Your routes", then "Team routes" (main 745) | None: "No routes yet." Not downloaded: section 6.4's sentence |
| Home cards | "Your next route" and "Your team’s next route" (main 744); for a lead, "Notes to finish on your routes" with how many are older than a day | Hidden when there is nothing |
| Route | Name, date, lead, team, status chip (Awaiting confirmation, Confirmed, In progress, Completed); active stops in order with contact and outcome chips, the allergy badge and flags; a **Removed** list; "Waiting to sync" on stops with unsent events | A stop with no contact shows "Not yet" (main 117). After a confirm with unseen changes: "This route changed before your confirmation arrived. Check the stops." |
| Stop | The patient bundle: chart summary, last known location, alerts, planned order sets (main 331); the contact log; outcome buttons; "Start encounter" | Chart not on the phone: "This chart isn’t on this phone yet. Connect to download it." The index copy still shows allergies |
| Log contact | Confirmed, No response, Declined, Rescheduled; call, text or in person; the time | Rescheduled asks "New date" (main 336). Declined and Rescheduled say "This stop moves to Removed. You can restore it." |
| Confirm route | The stop list to review, how many charts are on the phone, the bag check, **Confirm route** (main 333) | Blockers from `confirmBlockers`: "Fix the items in Needs attention before you confirm." (main 562). Charts missing warns and does not block. Bag check: "These items are short" with item, needed and held, and **Restock now**; offline it runs from the bundle (main 476). Restock now is phase 6’s restock, online, for a holder of `inventory.manage`; others see "Ask Logistics to restock these bags." |
| Add to route | Search the patient list on this phone, "New patient" (intake), or "A place" | Lead: "Add a stop". Others: "Add someone you met". A patient on another route, for a lead's planned add: "On another route: {route name}. Send them through Logistics." |
| Lead tools | Drop, restore, reorder (up and down buttons, no drag only) | Shown only to the lead |
| Change request | What is asked, **Accept**, **Decline** | "Logistics asks to add a patient", "… drop a stop", "… change the order" |
| Outcome | Seen, Declined, Could not locate, No response, Other (moved, in hospital, in jail, reported to have died, something else) with a note | Starting an encounter from a stop records Seen with that encounter. Two outcomes: "Two outcomes were recorded for this stop." |
| Complete run | Counts from `reportBuckets`; **Complete run** | "{n} stops weren’t reached. They’ll be listed under Patients Not Seen." (main 148) |
| Follow-up (in the chart) | Open follow-ups; "Set a follow-up date" for a clinician | Others see the dates, not the button |

### 8.2 Portal (`apps/portal/src/app/(app)/runs/`, `/follow-ups/`; nav shown with `routes.view`)
| Page | Shows | States and wording |
|---|---|---|
| Runs | Runs by date with their routes, status and lead; "New run" with `routes.manage` | |
| Route builder | Team (one to three), lead, bags; candidates ranked by `rankCandidates` with a search box, flag filters and last seen date; ticked patients arrive from the board or a report | "{n} patients are hidden because they are on another route: {route name}, {date}" (main 340) |
| Route | Stops with contact and outcome, the Removed list, Assign, Cancel, Change lead (reason required) | Once confirmed: "This route is locked to its team. Send the lead a change request." (main 328). "Changes that didn’t apply": each kept event with who, when and why, in plain words per reason code |
| Change requests | Pending and answered requests | `could_not_apply`: "The lead accepted, but the patient was already on another route." |
| Bag check and packing list | Shortfalls now, the check stored at confirm, the packing list (main 476, 478) | "Nothing is short." |
| Report | Seen, Added on the run, **Patients Not Seen**, Notes not complete, Reported changes (Other outcomes; "reported to have died" asks an admin to review the chart’s status), counts; tick boxes and "Add to a route" (main 119, 367) | Before Complete: "This run isn’t complete yet. Stops with no outcome will be listed as Not reached." |
| Run | Before-run and after-run checklists worked out from data (each lead confirmed, bag checks, report read), the summed counts, the narrative box (main 362, 367, 369) | The narrative is the only thing staff type |
| Follow-ups board | Six columns (Overdue, Today, Tomorrow, Later this week, Next week, Later), ranked by flag within each, filters for flag and clinician, tick boxes, "Add to a route" (main 341, 935) | No drag between columns. "Not seen on 3 runs in a row" badge (main 152). A patient on an active route shows the route's name and has no tick box |

## 9. Audit events and the PHI rules that apply
Every event is written in the transaction of the change it records (`ctx.audit`, or the route's transaction). Details carry IDs, counts, codes and booleans only.

| Event | Details |
|---|---|
| `run.created`, `.updated`, `.cancelled`; `route.created`, `.assigned`, `.cancelled`, `.team_changed`, `.lead_changed` | run or route ID, which fields changed (names of fields, not values), member count, old and new lead ID |
| `route.contact_logged` | route, stop, patient ID, result, method, `removed` |
| `route.confirmed` | route, stop count, `unseenChanges`, shortfall count |
| `route.stop_added`, `.stop_dropped`, `.stop_restored`, `.reordered`, `.stop_updated` | route, stop, patient ID, origin, source (`lead`, `planner`, `request`) |
| `route.outcome_set` | route, stop, patient ID, old and new outcome, `conflict`, `afterCompletion` |
| `route.request_created`, `.request_answered`, `.request_withdrawn` | route, request, kind, answer, `failReason` |
| `route.completed` | route, counts per bucket |
| `route.event_kept` | route, event ID, kind, reason code |
| `route.bag_checked` | route, trigger, shortfall count |
| `followup.created`, `.closed` | follow-up, patient ID, source, close reason (never the note or the date's reason) |
| `route.viewed`, `.bundle_fetched`, `.report_viewed`, `.candidates_viewed`, `followups.board_viewed` | `patientIds` (D53), counts, filter IDs; never search text (D41) |

- A read that discloses patients and cannot be logged is refused: the five view events are written before the answer is sent.
- `place`, stop notes, outcome notes, follow-up notes and the run narrative are patient details. They are never in audit details, logs, notices, push text, URLs or `kv`. A notice carries a kind and a route ID only (`route.change_not_applied`, `route.request`, `route.unseen_changes`, `route.death_reported`).
- The bundle holds patient IDs and stop notes, and lives only in the encrypted team database. It holds no legal name and nothing derived from one (D40).
- Secondary flags marked sensitive are left out of candidates, the board and the bundle for a reader without `patients.view_sensitive` (main 121); `currentFlags` already does this. Candidate search text travels in the POST body and is not stored.

## 10. Tests
### 10.1 The Done when
One API test (`services/api/test/routes-done-when.test.ts`), one phone scenario against the fake (`apps/mobile/test/runs/done_when_test.dart`), the same steps in the live job, and the portal steps in an end-to-end test. Demo patients only.

| # | Step | Asserted |
|---|---|---|
| 1 | Logistics makes a run and a route: two members, a lead, one bag, four patients from the candidates list | Candidates come ranked by both tiers; route `draft`; an outing exists for the bag; a patient put on a second route is refused `patient_on_other_route` |
| 2 | Logistics assigns it | `assigned`; every stop `not_yet`, no outcome; `route_assigned` queued for both members; the audit events of steps 1 and 2 |
| 3 | Both phones sync, then go offline | The bundle is stored; four charts hold a `route` scope; nothing about the route is in `kv` |
| 4 | The member logs contact offline: one Confirmed, one Rescheduled with a date | The second stop shows under Removed on that phone |
| 5 | The lead, offline, opens Confirm route with a fixable rejection waiting | Confirm is blocked; after the fix it is allowed. The bag check lists a shortfall from the bundle and does not block |
| 6 | The lead confirms offline; both phones sync | `confirmed`; the member's contacts applied; a follow-up on the Rescheduled date; a stored bag check; a planner stop edit is now refused `route_locked` |
| 7 | Logistics sends an add request; the lead accepts offline, then syncs | Push `route_change_request` with no patient detail; the request `accepted`; a new active stop with origin `request`; a second bag check with trigger `route_changed` |
| 8 | Offline, the member adds a patient they met (a new intake) and charts an encounter from the stop | After sync: a stop with origin `on_the_fly`, outcome `seen`, the encounter ID on its event; the event waited for the patient create |
| 9 | Offline, the lead marks one stop Could not locate; the member marks the same stop Seen; both sync in either order | The stop shows `seen`, `outcome_conflict` true, both events stored |
| 10 | The lead marks another stop Could not locate, taps Complete run, syncs | `completed`; the outing ended; the route's cache scopes dropped; the confirmed events leave the phone only after a bundle that contains them |
| 11 | The member's phone syncs a late outcome and a late `stop_dropped` | The outcome is applied as a correction with old and new in the audit; the drop is kept (`not_lead`), noticed, and shown on the route page |
| 12 | Logistics opens the report | Seen, Added on the run (step 8), Patients Not Seen (step 10's stop, plus any stop left untouched as Not reached), Notes not complete (step 8's draft); `route.report_viewed` names the patients |
| 13 | Logistics ticks the not-located patient and adds them to a new route | The patient is offered (free again) and lands on the new route as a `not_yet` stop |

### 10.2 The test that holds each rule (each is checked to bite: revert the rule, see it fail, restore it)
| Rule | Test |
|---|---|
| Every row of 5.2 | `route-events.json`, read by the TypeScript and Dart tests; a parity test runs each case through the API and the fake |
| The lock is the server's | A confirmed route refuses each planner edit route; a phone holding a stale `assigned` bundle sends a non-lead `stop_dropped` and it is kept, not applied |
| A kept event is never lost | For each reason code: the row exists, `applied` false, a notice exists, the receipt hash matches, the phone purges only after the bundle rule |
| A rejection never stops the queue | A `stop_unknown` event followed by a valid one in one batch: the second is applied |
| Outcomes do not depend on arrival order | `route-outcome.json` runs each pair both ways; the API test syncs two phones in both orders |
| One active route per patient | The index and the writer's group check, with a merged pair on two routes; a lead's offline add of a held patient is kept |
| Audit in the same transaction; a read that can’t be logged is refused | For each event kind, a failing audit insert leaves no event row and no stop change. Each of the five view routes with the audit insert failing answers an error and no data |
| No patient details leak | The bundle, receipts, notices and push payloads are scanned for names, `place` and notes; `kv` is scanned after a full run; the column list of `route_events` is pinned |
| Permissions | One refusal test per route and key; Billing/Data gets nothing; a member without `patients.view` gets a route without stops |
| Replay equals the stored state | The schema test of 4.1, run after the Done when |
| Offline | Each phone screen's action is tested with the transport off, and again after the app is killed between the tap and the sync |
| The follow-up rule | A CHW's `follow_up` create is rejected `permission_denied` and stays in the store; a Rescheduled contact replayed makes one follow-up |
| The fake agrees | `fake_parity_test.dart` and `fake_reads_test.dart` cases for 6.3 |

## 11. Defaults chosen (PLAN-OPEN) and questions for people
| Question | Default | Who decides |
|---|---|---|
| May Logistics log pre-visit contact when not on the route? | Yes, with `routes.manage`; planners often make the calls | Brooke and Mercy |
| May anyone on the route add an on-the-fly patient, or only the lead? | Anyone on the route (main 338, 112); the Build plan's line 104 names the lead | The team |
| Which outcome shows when two disagree? | Seen, Declined, Other, No response, Could not locate, in that order, and the stop is marked | Brooke and Mercy |
| When does a Declined outcome's follow-up fall due? | 7 days after the service date | Brooke and Mercy |
| Who may set a follow-up date? | `encounters.chart` with a credential that may chart Medical; CHWs and Logistics may not | Brooke and Mercy |
| Who is told of a reported death? | Holders of `team.view_audit` (Program Admins), by notice; it is also on the report | Brooke and Mercy |
| Patients Not Seen edge cases (main 147-152) | The plan's defaults (`IMPLEMENTATION_PLAN.md` section 6): Not reached at Complete, Other with a reason, Declined and Rescheduled off the list, seen elsewhere the same day comes off, 3 missed runs raise the patient | Brooke and Mercy |
| What counts as "seen elsewhere"? | Any encounter for the patient's merged group on the service date | Brooke and Mercy |
| When do a route's charts download? | From assignment, when the date is today or tomorrow; main 337 says "starting a route" | Project lead |
| How long does a route stay on the phone after Complete, and how far ahead does Schedule show team routes? | 48 hours, for corrections (its charts leave at Complete); 14 days | Project lead; the team |
| What a stop needs for the bag check | Condition maps only (main 476); planned bundles feed the packing list, not the check | Brooke and Mercy |
| Does the lead see bag counts at confirm? | Needed and held for short items only; phase 6 hides counts during the run | Brooke and Mercy |
| When does a week start on the board, and whose "today" is it? | Monday; the date the portal sends (phones use their corrected clock) | The team; project lead |
| Is every route in a run? | Yes; the builder makes a run in the same step | The team |
| Should recording a patient's presence on a route in the permanent audit log be limited? | Logged with patient IDs, as D53 | Counsel |

Questions with no default: which map provider, and whether maps enter the MVP at all (project lead, counsel for the BAA). Whether a route's place text ("the camp under the bridge") may name a location tied to patients in a push or an export: here it never leaves the encrypted stores (counsel). Whether volunteers who are not users may be listed on a run (Brooke and Mercy).

## 12. Risks, and where the design departs from the PRD or reads it a particular way
1. **A confirm made offline can lock a route the lead did not fully see.** A planner edit made after the lead's last bundle still stands. The route says so, the lead is told, and a stop nobody visits ends on Patients Not Seen, so nobody is dropped. The other choice, refusing the confirm, would leave a team in the field with an unlocked route.
2. **`eventEffect` exists twice** (TypeScript and Dart) and a third time inside the fake. The vectors and the parity tests are the only guard (plan risk 7). Every new reason code is a vector first.
3. **Stored columns can drift from the event log.** The replay test catches it; the writer is the only code that touches them.
4. **Kept events can pile up unread.** They show on the route page, the report and the author's notices; nothing times them out.
5. **The bundle grows with a busy team.** It is bounded by date (yesterday to 14 days) and by the 60-stop limit; measure it on a weak link before the pilot (D24).
6. **This phase leans on three unbuilt phases.** Section 2's lists are the contract. The outing of phase 6 becomes the route's bags; if phase 6 changed it, 4.1's foreign key and "end the outing" change with it.

Departures and readings:
- **Kept, not rejected.** Main 557-560 lists rejection reasons. A route rule here never rejects (decision 3), following lifecycle 48-50.
- **Contact after confirm is allowed.** Main 335 says contact is logged before the lead confirms; main 476 has stops removed as Rescheduled or Declined on a confirmed route. Both hold: contact applies in `assigned` and `confirmed`.
- **"Started" is the confirm.** Main 328 locks a route "once started"; main 333 says confirming starts it. There is no separate start. "In progress" (main 340) is shown from the first outcome. Before it, the lead and Logistics may both edit (main 327 and 328 read together).
- **Charts download before the route starts** (main 337, 533), so that an offline confirm is possible; the 24-hour limit is kept by refreshing. The team index is not narrowed to the route: main 534 keeps it team-wide, and the route scopes the chart cache (main 533; D30).
- **The lead sees counts for short items at confirm**, a narrow exception to phase 6's "no counts on the phone", because main 476 puts the pop-up on the phone, offline.

## 13. Units and a first card list
Unit 1 lands first, alone, with CI green. Then units 2 and 3 run side by side, then 4 and 5, then 6. Each line: title, level, files, needs. A route or schema card regenerates the contract in the same commit. Vector files and the tests for T cards are written first by the planner (card 1.04 and the "tests first" notes).

**Unit 1. Schema, rules and sync** (owns `db/migrations/`, the rule files of `services/api/src/runs/` and `apps/mobile/lib/runs/`, `runs/apply-event.ts`, `services/api/src/sync/`, `apps/mobile/lib/sync/`, the fake)
- 1.01 Migration: runs, routes, members, stops, the outing's foreign key. X. `<n>_runs_routes.sql`. Needs phase 6's outings.
- 1.02 Migration: route events, change requests, bag checks. X. `<n>_route_events.sql`. Needs 1.01.
- 1.03 Migration: follow-ups. X. `<n>_follow_ups.sql`. Needs nothing.
- 1.04 The six vector files and a reader test on each side. X. `packages/contract/test-vectors/*.json`, reader tests. Needs nothing.
- 1.05 `eventEffect` and `applyPatch` in TypeScript. T. `services/api/src/runs/rules.ts`. Needs 1.04.
- 1.06 `eventEffect` and `applyPatch` in Dart. T. `apps/mobile/lib/runs/rules.dart`. Needs 1.04.
- 1.07 `resolveOutcome` in TypeScript. T. `services/api/src/runs/outcome.ts`. Needs 1.04.
- 1.08 `resolveOutcome` in Dart. T. `apps/mobile/lib/runs/outcome.dart`. Needs 1.04.
- 1.09 `reportBuckets` in TypeScript. T. `services/api/src/runs/report-rules.ts`. Needs 1.04.
- 1.10 `reportBuckets` in Dart. T. `apps/mobile/lib/runs/report_rules.dart`. Needs 1.04.
- 1.11 `bagCheck` in TypeScript. T. `services/api/src/runs/bag-check.ts`. Needs 1.04.
- 1.12 `bagCheck` in Dart. T. `apps/mobile/lib/runs/bag_check.dart`. Needs 1.04.
- 1.13 `rankCandidates`, `followUpColumn`, `missedRunsInRow`. T. `services/api/src/runs/planning-rules.ts`. Needs 1.04.
- 1.14 `confirmBlockers`. T. `apps/mobile/lib/runs/confirm_blockers.dart`. Needs 1.04.
- 1.15 Wire schemas and `sync-values.json` cases for both entities. X. `sync/schemas.ts`, `sync/entities/values.ts`. Needs 1.02, 1.03.
- 1.16 The event writer: lock the route, load, `eventEffect`, store the event, apply the patch, follow-up, bag check, notices, audit. X. `services/api/src/runs/apply-event.ts`. Needs 1.05, 1.07, 1.11, 1.15.
- 1.17 `routeEventRules`. X. `sync/entities/route-event.ts`, `sync/entities/index.ts`. Needs 1.16.
- 1.18 `followUpRules`. X. `sync/entities/follow-up.ts`, `sync/entities/index.ts`. Needs 1.15.
- 1.19 Phone registry for both entities, and "keep a route event until a bundle holds it". X. `apps/mobile/lib/sync/entities.dart`, `local_store.dart`. Needs 1.15.
- 1.20 Phone table for the route bundle, and dropping a route's scopes. X. `apps/mobile/lib/sync/local_db.dart`, `local_store.dart`. Needs 1.19.
- 1.21 Fake server: route events and the planner helper, with parity tests. X. `fake_server.dart`, `fake_parity_test.dart`. Needs 1.17, 1.19.
- 1.22 Fake server: follow-ups and the bundle read. X. `fake_server.dart`, `fake_reads_test.dart`. Needs 1.18, 1.21.
- 1.23 Six push sentences. T. `services/api/src/push/messages.ts`. Needs phase 6's list.
- 1.24 Chart download reason `route`. T. `services/api/src/patients/charts.ts`, `services/api/src/patients/schemas.ts`. Needs nothing.
- 1.25 Headings and rejection wording for the new entities. R. `apps/mobile/lib/features/sync/sync_labels.dart`. Needs 1.19.

**Unit 2. Routes API** (owns `services/api/src/routes/runs.ts`, `routes/follow-ups.ts`, the rest of `services/api/src/runs/`, the seed)
- 2.01 Runs: list, create, update, cancel. T. `routes/runs.ts`, `runs/runs.ts`. Needs unit 1.
- 2.02 Routes: create (with the outing), read. T. `routes/runs.ts`, `runs/routes.ts`. Needs 2.01.
- 2.03 Planner stop edits through the writer, refusing `route_locked`. T. `routes/runs.ts`, `runs/planner-edits.ts`. Needs 2.02.
- 2.04 Team and bags, change lead. T. `routes/runs.ts`, `runs/team.ts`. Needs 2.02.
- 2.05 Assign and cancel. T. `routes/runs.ts`, `runs/routes.ts`. Needs 2.03.
- 2.06 Candidates: flags, follow-ups, missed runs, hidden counts. T. `routes/runs.ts`, `runs/candidates.ts`. Needs 2.02.
- 2.07 Change requests: create, withdraw. T. `routes/runs.ts`, `runs/requests.ts`. Needs 2.05.
- 2.08 Outcome correction and Complete from the portal. T. `routes/runs.ts`, `runs/planner-edits.ts`. Needs 2.05.
- 2.09 Stop needs and held counts. T. `services/api/src/runs/needs.ts`. Needs unit 1.
- 2.10 The field bundle. T. `routes/runs.ts`, `runs/field-bundle.ts`. Needs 2.05, 2.09.
- 2.11 Bag check read and the packing list. T. `routes/runs.ts`, `runs/bag-check-read.ts`. Needs 2.09.
- 2.12 The report. T. `routes/runs.ts`, `runs/report.ts`. Needs 2.08.
- 2.13 The follow-ups board. T. `routes/follow-ups.ts`, `runs/board.ts`. Needs unit 1.
- 2.14 Contact attempts on the chart timeline. T. `services/api/src/patients/projection.ts`, `runs/outreach.ts`. Needs unit 1.
- 2.15 Push for assign, request, change, lead change, shortfall. X. One call each in `runs/apply-event.ts`, `runs/requests.ts`, `runs/team.ts`. Needs 1.23, 2.07.
- 2.16 A demo run and route in the seed. S. The seed script and its data module. Needs 2.05.

**Unit 3. Phone route data** (owns `apps/mobile/lib/runs/` except the rule files)
- 3.01 Route bundle: fetch, keep, read, refresher. T. `lib/runs/route_bundle_repository.dart`, `app_providers.dart`. Needs 2.10, 1.20.
- 3.02 `routeView`: the bundle plus waiting events. T. `lib/runs/route_view.dart`. Needs 1.06, 3.01.
- 3.03 `RouteSource` and its wiring into the chart cache. X. `lib/runs/route_source.dart`, `lib/patients/chart_cache.dart`, `app_providers.dart`. Needs 3.01, 1.24.
- 3.04 `RunActions`: one method per event kind, through the store. T. `lib/runs/run_actions.dart`. Needs 1.19.
- 3.05 Follow-up repository: read, create, close. T. `lib/runs/follow_up_repository.dart`. Needs 1.19.
- 3.06 Offline and kill-the-app tests for every action. T. Tests only. Needs 3.04.
- 3.07 The Done when on the phone against the fake. T. Tests only. Needs 3.03, 3.04.

**Unit 4. Phone screens** (owns `apps/mobile/lib/features/runs/`, the Home cards, the Schedule tab in `app.dart`)
- 4.01 Schedule tab and the route list. R. `app.dart`, `features/runs/schedule_screen.dart`. Needs 3.02.
- 4.02 Home cards. R. `features/home/home_screen.dart`, `features/runs/next_route_card.dart`. Needs 3.02.
- 4.03 Route screen: header, stops, Removed. R. `features/runs/route_screen.dart`. Needs 4.01.
- 4.04 Stop screen: the patient bundle and the contact log. R. `features/runs/stop_screen.dart`. Needs 4.03.
- 4.05 Log contact. R. `features/runs/contact_sheet.dart`. Needs 4.04, 3.04.
- 4.06 Confirm route, tests first. R. `features/runs/confirm_route_screen.dart`. Needs 1.12, 1.14, 3.04.
- 4.07 Add to route: patient, new patient, place. R. `features/runs/add_stop_screen.dart`. Needs 3.04.
- 4.08 Lead tools: drop, restore, reorder. R. `features/runs/lead_tools.dart`. Needs 4.03.
- 4.09 Change request sheet. R. `features/runs/request_sheet.dart`. Needs 3.04.
- 4.10 Outcome sheet. R. `features/runs/outcome_sheet.dart`. Needs 4.04.
- 4.11 Start encounter from a stop records Seen. T. Phase 4's encounter start file, `lib/runs/run_actions.dart`. Needs 4.10.
- 4.12 Complete run. R. `features/runs/complete_run_screen.dart`. Needs 1.10, 3.04.
- 4.13 Follow-up in the chart. R. `features/runs/follow_up_section.dart`, `features/patients/patient_screen.dart`. Needs 3.05.
- 4.14 Restock now. R. `features/runs/restock_screen.dart`. Needs 4.06.
- 4.15 Three-theme and narrow-width tests for 4.01 to 4.14. S. Tests only. Needs 4.14.

**Unit 5. Portal** (owns `apps/portal/src/app/(app)/runs/**`, `follow-ups/**`, the nav entries)
- 5.01 Nav entries and the Runs page. R. `(app)/layout.tsx`, `runs/page.tsx`. Needs 2.01.
- 5.02 Run form. R. `runs/RunForm.tsx`, `runs/actions.ts`. Needs 5.01.
- 5.03 Builder: team, lead, bags. R. `runs/routes/[routeId]/build/TeamForm.tsx`, its page. Needs 2.04.
- 5.04 Builder: candidates, search, filters, hidden count. R. `…/build/Candidates.tsx`, its actions. Needs 2.06.
- 5.05 Route page: stops, Removed, assign, cancel, change lead. R. `runs/routes/[routeId]/page.tsx`, `RouteActions.tsx`. Needs 2.05.
- 5.06 Change requests and "Changes that didn’t apply". R. `…/[routeId]/Requests.tsx`, `KeptEvents.tsx`. Needs 2.07.
- 5.07 Bag check and packing list. R. `…/[routeId]/BagCheck.tsx`. Needs 2.11.
- 5.08 Report, with "Add to a route". R. `…/[routeId]/report/page.tsx`, `ReportLists.tsx`. Needs 2.12.
- 5.09 Outcome correction dialog. R. `…/[routeId]/OutcomeDialog.tsx`. Needs 2.08.
- 5.10 Run page: checklists, counts, narrative. R. `runs/[runId]/page.tsx`. Needs 2.12.
- 5.11 Follow-ups board. R. `follow-ups/page.tsx`, `Board.tsx`. Needs 2.13.
- 5.12 End-to-end: the portal steps of the Done when, with the accessibility checks. T. `apps/portal/e2e/routes.spec.ts`. Needs 5.11.

**Unit 6. Close**
- 6.01 The Done when in the live phone-against-API job. X. `apps/mobile/test/sync/live_api_test.dart`, `tools/live-sync.sh`. Needs units 3 and 2.
- 6.02 Compliance mapping, the plan's D-table and phase row, the PR description. S. `docs/compliance/`, `IMPLEMENTATION_PLAN.md`. Needs everything.

**Count: 77 cards. S 3, T 34, R 25, X 15.** The small model takes 62 of them (S, T and R); the 15 X cards are the three migrations, the vectors, the wire schemas, the writer, the two entity modules, the two phone store cards, the two fake cards, the push calls, the cache source and the live job.
