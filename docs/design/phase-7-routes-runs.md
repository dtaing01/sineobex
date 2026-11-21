> Draft plan (Nov 14), checked against the reviewed phase 4 design and the designs of the phases before it. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 7: routes and runs

"PRD main N" is a line of the product spec's main tab; "Build plan N" a line of its Build plan tab. Paths are from the repository root. "Next free number" means the lowest unused migration number when the unit starts (phase 4 takes 0017 to 0021, phase 5 0022 and 0023, phase 6 0024 to 0028, so 0029 to 0031 if nothing lands between). "Lifecycle" and "forms" with a section number are the two parts of the phase 4 design (`docs/design/phase-4/`); "phase 5 design" and "phase 6 design" are the files in `docs/design/`. Where an earlier phase defines a table, route, record or screen, it owns it: this design uses its names and adds to it.

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
| Patients and locations added on the run, attributed to the route. Stop outcomes (Seen, Declined, Could not locate, No response, Other with a reason); corrections after completion, logged old and new. Complete run: untouched stops become Not reached; the route locks | main 118, 112, 338, 365, 119, 148, 149, 342 |
| Post-run report: seen, added on the run, Patients Not Seen, notes not complete, plus counts the app already has | main 99, 119, 367, 369; Build plan 105 |
| Follow-ups: a clinician sets a date from the chart; the board in six columns by due date, filtered by flag and clinician; ticked patients go into the route planner | main 312, 341, 935 |
| Phone Home (your next route, the team's next route) and the Schedule tab. Tasks: a follow-up or a medication delivery task made in one tap from a note's stored answers; the person's open tasks and today's counts on Home | main 744, 745, 384, 418, 433, 958; lifecycle 9.6, 12.3; forms 6.4, 6.8 |
| The route cache: charts of a route's patients kept on the phone, with phase 4's timeline and last three visits | main 337, 533; D30, D67; lifecycle 5.2 |
| The route lead's share of the 24-hour incomplete-note alert, and notes not complete in the report | main 99; lifecycle 3.9, 5.6 |
| Phase 6's outing becomes part of a route: no outing without a route after this phase | phase 6 design 3, 4.1, risk 2 |

| Out | Who takes it | PRD |
|---|---|---|
| Maps, stop order optimisation, heatmaps, stop time windows | After the MVP list; needs a map provider under a BAA (PLAN-OPEN, section 11) | main 344-356, 364 |
| Volunteer roster, emailing volunteers, run sign-up; team chat | V2; chat is deferred past the MVP | main 360, 362, 745, 330 |
| The continuity-of-care priority list and check-ins | Phase 9. Until then the builder ranks by flags, due follow-ups and missed runs | main 322; Build plan 113 |
| Building a route on the phone | Not in the Build plan's phase 7. The lead adds stops on the phone; the builder is portal only | Build plan 102; main 941 |
| "Request supplies", recounts, bag minimums | Phase 6 | main 366, 477 |
| A real push provider; a push for an overdue note or for tasks due | Waits for accounts, and for a scheduled job that does not exist (phase 6 design 7, 9). The sentences are in phase 6's list | main 746 |
| Home's recent patient activity and team members active | Not placed in a phase yet (PLAN-OPEN, section 11) | main 744 |

## 2. Ground truth
What the code has today:

| Fact | Where |
|---|---|
| No route, run, stop or follow-up table. Migrations stop at `0016`. | `db/migrations/` |
| `routes.view` ("See routes and runs") and `routes.manage` ("Build and assign routes; send change requests") exist. Program Admin and Logistics hold both; Healthcare Staff and the CHW preset hold `routes.view` only; Billing/Data holds neither. | `services/api/src/auth/permissions.ts` 27-28, 79-90; `db/migrations/0002_identity_access.sql` 71-97 |
| A synced record type is one `EntityRules` module in `RULES`; `storeCreate` writes the row, the history and the audit event in the change's transaction. Field classes are `draft`, `keep_both`, `identity`, `status`, `set_once`. | `services/api/src/sync/entities/index.ts` 20-30; `services/api/src/sync/records.ts` 422, 445-493 |
| An append-only, create-only entity with one `set_once` field is `patient_allergy`. It is the pattern for both entities of this phase. | `services/api/src/sync/entities/allergy.ts` |
| The phone holds charts in `records` and `fields`, kept by cache scopes. `CacheSource` has one implementation, `OpenedSource`; the comments reserve a `route` kind with the route ID as `ref`. `reconcile(sources)` downloads what a source wants and adds its scope. The store has `addScope` and `scopes()`, and no call that removes a scope before it expires. It holds back a change that names a record whose create is rejected or held. | `apps/mobile/lib/patients/chart_cache.dart` 228-256, 392-420; D30; `apps/mobile/lib/sync/local_store.dart` 1709-1721, 966-994 |
| The team search index (no legal names, D40) stays team-wide, as PRD main 534 says. It gives the lead an offline patient picker. It carries last seen dates. | `apps/mobile/lib/patients/team_index.dart` 10-18; `services/api/src/patients/team-index.ts` 51-63 |
| A chart download is audited per chart with a `reason`. | `services/api/src/patients/charts.ts` 610-629 |
| Phone tabs are Home and Patients; "Start, Schedule and Resources arrive with their phases". Home shows a greeting, the clock card and the sync card. `user_notices` (user, kind, entity, record ID; no text) exists. The portal has `home`, `patients`, `team`, `audit`, `owner`; nothing for routes. | `apps/mobile/lib/app.dart` 74, 202-203; `apps/mobile/lib/features/home/home_screen.dart`; `db/migrations/0004_sync.sql` 160-170; `apps/portal/src/app/(app)/` |

What phases 4, 5 and 6 deliver first (designed and checked, not built on Nov 14). Each owns what it names. If one is missing when this phase starts, it is built first, as its own card.

| From | Thing | What phase 7 does with it |
|---|---|---|
| lifecycle 3.1, 3.10; D56 | Medical is a property of a note, through its type (`encounter_notes.medical`). A Non-Medical note is never signed. A visit's kind only goes to Medical. An empty draft counts for nothing | "Seen elsewhere" and "notes not complete" count notes, never a visit's kind |
| lifecycle 4.1, 4.2; D59 | A refusal only for what the worker can fix; anything else is accepted with no effect and a notice (`change_not_applied`); no new reject reason; a missing key on a push is held for a Program Admin; a rule that throws is a stored `validation`; every change takes the team lock, and every online writer calls `lockTeamWrites` first | Both new entities and every route of section 7 follow all of it (6.1, 6.2) |
| lifecycle 1.3, 3.5, 4.2; D58 | The Medical gate (`chartMedical`); the credential held at a given time (`loadSigner`, `credentialChangesAfter`); "acts as the note's author" | Who may set a follow-up (6.2) |
| lifecycle 3.9, 3.12, 5.6 | `isOverdue`; the list behind `GET /v1/team/incomplete-notes` (key `team.manage_users`), which takes an author filter; `GET /v1/me/counts`, which names no patient | The report and the lead's count read that list on the server (section 7). The route itself keeps its key |
| lifecycle 5.1, 5.2, 6.4; D66, D67 | The chart answer's `timeline` and `recentVisits`, kept in the patient record's `_chart` field (`chart_cache.dart` names its keys by hand); `visibleAnswers`; what a reader may not see is absent | The route cache downloads that chart answer. It gains `followUps` and `outreach` |
| lifecycle 9.1, 9.2, 9.6, 9.9 | The profile's **+ Encounter** (the Who step is skipped); the Start tab; the summary screen, whose item 5 shows the follow-up answers "as recorded"; Home's tiles under Needs attention. Starting a visit has no place for a stop | A stop starts a visit as the profile does, then sends its own `outcome` event with the visit's ID. Section 8 adds to these screens |
| forms 6.4, 6.8; `forms-inventory.md` A6 | Follow-up is asked in five ways and Medication delivery in the Quick encounter; the answers are stored, no task is made; paths and option codes are stable | 5.3's `tasksFromNote` and 6.2 |
| Phase 5 design 4.4, 4.5, 5.3, 6.1 | `flag` presets (`tier`, `rank`, `sensitive`), `patient_flag_changes`, `currentFlags`, the chart answer's `flags`; `bundle` and `bundleLines`; `condition_supply_map` (`codes`, `lines[{itemId, qtyPerPatient}]`); the phone's `presets` table | Ranking, the bag check and the packing list read them. No preset is defined here |
| Phase 6 design 4.1, 4.2, 6.4, 7, 9 | `stock_locations` (a bag's location ID is its preset ID), `bag_outings` (`route_id`, no foreign key), `bag_outing_bags`, `stock_balances`, `encounter_orders.outing_id`; the outing create and end routes and their code in `api/inventory/outings.ts`; `GET /v1/inventory/field-bundle`; "Bags today"; `queuePush` and the fixed sentence list; `POST /v1/inventory/restocks`; `stockAlerts` in `/v1/me/counts` | 4.1 makes the outing part of a route. Phase 6's tables, alerts and order rules stay as they are |

## 3. The design in one page
1. **A route is built online and run from an event log.** Logistics writes the route in the portal. Everything done on a phone is one immutable `route_event` (contact, confirm, add, drop, restore, reorder, outcome, answer, complete). Phones never overwrite a route or a stop, so two phones offline cannot conflict.
2. **One pure function decides what each event does.** `eventEffect(route, actor, event)` holds the whole state table. The server runs it under the team's write lock and then the route's row lock; the phone runs it to show the same result before syncing. Vectors pin both.
3. **The server never refuses an event for a route rule.** An event that arrives too late, from the wrong person or against the lock is stored with `applied = false` and a reason code, shown to the lead and Logistics, and told to its author. Nothing sits in Needs attention that the worker cannot fix (lifecycle 4.1; D59). This phase adds no refusal for a rule; only a fault (a value the wire schema refuses, a rule that throws) is stored as a rejection, as in phase 4.
4. **The lock is the route's status on the server.** After the lead's confirm applies, planner edits are refused online with `route_locked`, and only events from the lead change the plan. The lock does not depend on any phone's copy.
5. **Being the lead is data, not a permission.** Every phone event needs `routes.view`; the planner routes need `routes.manage`. What a lead may do comes from `routes.lead_user_id` (D37: no new keys).
6. **A stop's outcome is resolved, not overwritten.** Outcomes are events. Two people reporting one stop both stay; a fixed order (Seen first) picks what shows, and the report marks the disagreement.
7. **On-the-fly is attribution, not a plan edit.** Anyone on the route adds a patient or a place they met; it always applies, even after Complete, and never takes the patient off another route (main 338).
8. **A phone gets its routes as one bundle, replaced whole,** and the charts of their patients through the existing cache with a `route` scope. Both start arriving when the route is assigned, not when it starts, because the lead may confirm with no signal.
9. **The bag check is a pure function over the bundle.** The server works out each stop's needs and what the route's bags hold; the phone sums them offline (main 476). The server repeats it when the confirm arrives and stores the result.
10. **Reports and the board are worked out when read.** Not reached, Patients Not Seen, missed runs, overdue follow-ups and the lead's overdue notes are never written by a job (lifecycle 3.9's rule).
11. **A route owns its outing.** Phase 6's outing (a day, a lead, bags) stays as the two tables that hold a route's bags, and is made, changed and ended only by the route's writer. Nobody makes an outing by hand any more.
12. **A task is a follow-up row.** One table holds a clinician's follow-up date, the follow-up a note asks for, a medication delivery, and the follow-ups a Rescheduled contact or a Declined outcome make. A row carries a date and a kind, never a note's answer.

## 4. Data model
Three migrations, each the next free number, each **level X**: every table gets the team policy block of `0009_patients.sql` 484-488, two get triggers, and the third replaces `patient_of_change` so it knows `route_event` and `follow_up` (as phase 6's order migration does). IDs are `uuid`; every table has `team_id uuid not null references sineobex.teams (id)` and `created_at timestamptz not null default now()`. Foreign keys to team tables are composite with `team_id`.

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
| `.route_id`, `.patient_id`, `.place` | uuid, uuid null, text null 1-120 | Check: a patient, a place, or both. Unique (`route_id`, `patient_id`). Listed in `CHART_TABLES` as `group` (D27) |
| `.origin` | text | `planned`, `lead`, `request`, `on_the_fly` |
| `.position` | integer | Order among active stops; gaps allowed |
| `.state`, `.removed_reason` | text, text null | `active` or `removed`; `declined`, `rescheduled`, `dropped` |
| `.contact_status` | text default `not_yet` | `not_yet`, `confirmed`, `no_response`, `declined`, `rescheduled`: the last applied contact |
| `.outcome`, `.outcome_event_id`, `.outcome_conflict` | text null, uuid null, boolean | `seen`, `declined`, `could_not_locate`, `no_response`, `other`. Null shows as Not yet, or Not reached once the route is completed |
| `.planned_bundle_ids`, `.note` | uuid[], text null at most 200 | Planned order sets (main 331); a planner's note ("size 9 sneakers", main 366) |
| `.holds_patient` | boolean | True while the stop is active, not on-the-fly, and its route is `assigned` or `confirmed`. Partial unique index (`team_id`, `patient_id`) where true: one active route per patient (main 340) |

**The outing, absorbed** (phase 6 design 4.1, risk 2). The same migration (1) gives every `bag_outings` row that has no `route_id` a run and a route: the outing's name (or "Bags out") and date, its lead as lead and only member, status `completed` when the outing is ended and `assigned` otherwise; (2) sets `route_id` not null, adds the composite foreign key to `routes` and a unique index on it. From then on a route has exactly one outing, made with the route (bags or none), and an outing has exactly one route. `bag_outings.service_date`, `.lead_user_id`, `.name` and `.ended_at` are copies that only section 5's writer sets, in the transaction that changes the route; a schema test compares them. `bag_outing_bags` keeps phase 6's rule of one route a day per bag. Orders, stock alerts and held pushes keep pointing at the outing, so nothing of phase 6's is rewritten.

`routes`, `route_stops` and the outing are written only by section 5's writer; a schema test replays each route's events and compares.

### 4.2 `<n>_route_events.sql`
`route_events` is **append-only** (trigger refusing update and delete, as `patient_consents`).

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid primary key | Made on the phone, or by the API for a portal action |
| `route_id`, `stop_id`, `patient_id` | uuid null, uuid null, uuid null | `route_id` is null only for an event kept as `route_unknown`; `stop_id` is set only when the stop is on the route (the payload keeps what was sent). `patient_id` is set for contact, add and outcome events, so the chart timeline can read them (main 336) |
| `seq` | bigint identity | Server order. Under the team lock it is the order events were applied |
| `kind` | text | `contact`, `confirm`, `stop_added`, `stop_dropped`, `stop_restored`, `reorder`, `outcome`, `request_answered`, `complete`, and from the API only `lead_changed`, `assigned`, `team_changed` |
| `payload` | jsonb | Section 6.1's value for the kind |
| `applied`, `reason` | boolean, text null | What `eventEffect` answered: applied, or kept with a reason code |
| `author_user_id`, `device_id`, `change_id`, `device_time`, `effective_at`, `clock_verified` | | As `patient_consents`. `device_id` and `change_id` are null for the portal |

`route_change_requests`: `route_id`, `kind` (`add`, `drop`, `reorder`), `patient_id` null, `place` null, `stop_id` null, `stop_ids uuid[]` null, `status` (`pending`, `accepted`, `declined`, `withdrawn`, `could_not_apply`), `fail_reason` null, `created_by`, `answered_by`, `answered_at`, `answer_event_id`. A trigger lets `status` change once, from `pending`.

`route_bag_checks` is **append-only**: `route_id`, `event_id`, `trigger` (`confirm`, `route_changed`), `lines jsonb` (`[{itemId, needed, held, short}]`), `short_count integer`.

### 4.3 `<n>_follow_ups.sql`
`follow_ups` (a task): `id` (phone- or API-made), `patient_id`, `kind` (`follow_up`, `delivery`), `due_date date`, `source` (`clinician`, `note`, `rescheduled`, `declined`), `route_event_id` null (unique, so a replayed event makes one row), `encounter_id` null, `note_id` and `source_path` null (set together for source `note`; unique as a pair, so one answer makes one task), `note` text null at most 200 (what it is for, typed by the person; never copied from a note's answer), `author_user_id`, `recorded_at`, `clock_verified`, `device_id`, `change_id`, and the set-once `closed_at`, `closed_by`, `close_reason` (`done`, `cancelled`, `replaced`). Nothing else changes after insert (trigger). Index (`team_id`, `due_date`) where `closed_at is null`. Listed in `CHART_TABLES` as `group` (D27).

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
| `complete` | L, or P | Kept (`not_confirmed`) | Applied: status `completed`; the route's outing is ended by phase 6's own code, which releases its held pushes | Kept (`already_completed`) |

Other rows: a `draft` route keeps every phone event (`not_assigned`); a `cancelled` one keeps them (`route_cancelled`). An event that names a stop or a request the route does not have is kept (`stop_unknown`, `request_unknown`): it happens when the phone's own add was kept. An event for a route the team does not have is kept (`route_unknown`). Wrong actor: `not_lead` where L is needed, `not_on_route` where M is needed. A `Seen` outcome with an encounter, sent by a `not_on_route` author, is still kept and listed on the report, so the visit is not lost from the count. Every kept event writes a notice to its author and shows on the route page (8.2). A Declined outcome makes a follow-up (main 150).

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
| `note-tasks.json` | `tasksFromNote` | `sources[{noteTypeKey, path, kind, when, dueDays or null}]`, a note's type key and its answers that count (`effectiveAnswers`, forms 7.1), `visitDate` | `[{kind, sourcePath, dueDate or null}]` | Dart only |

- `resolveOutcome`: when `incoming.replaces` equals the current event (or both are empty), the incoming outcome shows. Otherwise both stay and the higher of `seen`, `declined`, `other`, `no_response`, `could_not_locate` shows, with `conflict` true. The result does not depend on arrival order. `reportBuckets`: `seen` is outcome `seen`. `added` is origin `on_the_fly`. `notSeen` is an active stop with a patient whose outcome is `could_not_locate` or `no_response`, or, on a completed route, none (Not reached); a patient in `seenElsewhere` comes off it (main 119, 148, 151). `removed` is state `removed`. `other` is outcome `other`. Declined is in none of them (main 150).
- `rankCandidates`: primary rank (lowest first, none last), then the best secondary rank, then how many secondary flags, then `missedRuns` of 3 or more, then the earliest due follow-up, then the oldest `lastSeenOn` (main 120, 317, 152). `followUpColumn`: `overdue`, `today`, `tomorrow`, `this_week` (to Sunday), `next_week`, `later` (main 341). `confirmBlockers`: `fixableRejections` counts the person's open refusals, each of which has a fix (D59); a change held for a Program Admin does not block (main 562).
- `tasksFromNote`: `sources` is a fixed list in the phone's code, keyed by note type key and path as phase 5's mappings are (forms 6.8): the five follow-up questions (`forms-inventory.md` A6) and the Quick encounter's Medication delivery (forms 6.4). `when` has the shape of phase 5's `field_supply_map.when`. A source fires on the answers that count, so a hidden answer makes no task. `dueDate` is `visitDate` plus `dueDays`, null when the option names no time, and `visitDate` for a delivery. A test checks every source path against phase 4's golden file.

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

Parents: `patientId` and `encounterId` (the existing parent rule holds the event until they exist). A later event for a phone-made stop names that stop's `stop_added` record, so the store's dependent rule holds it while the add waits. `takesTeamLock` is true, as for every entity since phase 4 (lifecycle 4.2; D32); under it the writer locks the route row (`for update`) and, for an add or restore, checks `holds_patient` across the patient's merged group. No new reject reason, and no rule refuses: there is nothing here a worker could fix by sending again (D59). No clock pause (as allergies, D35); `clock_verified` is stored.

| Case | Server answer | Mirrored in the fake |
|---|---|---|
| Valid; author holds `routes.view` | Accepted. Receipt details: `{seq, applied, reason}`. The hash covers the value sent, as for every entity | yes |
| The same ID and hash again | Accepted again with the first answer (`on conflict (id) do nothing`, then read) | yes |
| A route rule says no (5.2), or the event names a stop or a request the route does not have | **Accepted**, `applied: false`, the reason code; notice `change_not_applied` (lifecycle 4.10); audit `route.event_kept` | yes, every reason |
| `routeId` unknown to the team (a build fault: a phone sends only for routes in its bundle) | **Accepted** with no effect: stored with `route_id` null, `applied: false`, `route_unknown`; the same notice | yes |
| The patient or encounter is not on the server yet | Held as a dependent (existing rule) | yes |
| The patient was merged | Stored as sent; reads group by `canonical_id` (D27) | yes |
| The author lacks `routes.view` (a role lowered while offline; the phone offers nothing without it) | Held for a Program Admin, as every permission failure on a push is (`services/api/src/sync/apply.ts` 403-423; lifecycle 4.2). Audited `access.denied`. Never refused | yes |
| The value breaks the wire schema | The wire schema's answer, naming the change (D51). The screens cannot send one | yes |
| `eventEffect` or `applyPatch` throws | Caught and stored as `validation`, problem `rule_error` (lifecycle 4.1), so the queue continues. The bag check runs after the event is stored; a throw there stores no check and fails nothing | yes |

Sync read: `/v1/sync/records` gives an entity it has no rule for to anyone with `patients.view` (lifecycle 6.4, rule 7). `route_event` gets a rule that serves nothing (events reach a phone only in the bundle); `follow_up` is served with `patients.view`, without `noteId` and `sourcePath` for a reader who may not read that note.

### 6.2 `follow_up` (create, and one `set_once` field)
Create value `{patientId, kind, dueDate, source (`clinician` or `note`), note, encounterId, noteId, sourcePath}`; field `closed` (`{reason}`: `done`, `cancelled`, `replaced`). `takesTeamLock` is true. Parents: the patient, and the encounter and the note when named. Changing a date is close as `replaced` plus a new create. Rows from a Rescheduled contact or a Declined outcome are written by the server in that event's transaction. Read with the chart: the chart answer gains `followUps`, kept in `_chart` as phase 4's `timeline` is.

| Case | Server answer |
|---|---|
| Source `clinician` (set from the chart), or `closed` by someone other than the task's author: the sender holds `encounters.chart` and held a credential with `chartMedical` at the time (`loadSigner`, D58; "a clinical decision that only a clinician changes", main 341) | Accepted |
| Source `note` (one tap on the summary screen, 8.1): the author holds `encounters.chart` and acts as that note's author; `kind` is `follow_up`, or `delivery` with a `dueDate` | Accepted. The row holds the date, the kind, `noteId` and `sourcePath`, and no answer: a delivery's instructions stay in the note and are read through `visibleAnswers` |
| A second create for the same `noteId` and `sourcePath` (the note was reopened and completed again) | Accepted with no effect; the first row stands |
| Source `note` from someone who does not act as the note's author | Stored with no effect, problem `not_author`, notice `change_not_applied` (lifecycle 4.1) |
| The key or the credential is missing (lowered while offline; the phone never offers the button) | Held for a Program Admin, as phase 4's Medical gate is. Never refused |

### 6.3 What the phone test server must mirror (`apps/mobile/test/sync/fake_server.dart`, level X)
Each is pinned to the API's answer in `fake_parity_test.dart` (D52): both create schemas; no refusal for any route rule; the held change for a missing key; `eventEffect` run over the fake's own routes, with the same receipt details for every reason code; the replay of an applied event; `resolveOutcome`; the follow-up made by Rescheduled and Declined; the lock (a planner edit on a confirmed route is refused in the fake's planner helper); every row of 6.2 and `closed` as `set_once`; both read rules; the bundle read with its `revision` and `lastSeq`; `followUps` and `outreach` in the chart answer; the new numbers of `/v1/me/counts`.

### 6.4 What a phone holds
| Data | How it arrives | When it leaves |
|---|---|---|
| The route bundle: for each route the person is on, from yesterday on (`assigned`, `confirmed`, or `completed` in the last 48 hours): the route, its run's name and times, members, stops (IDs, place, note, planned bundles, state, contact, outcome), every event, pending requests, the outing's bags, `needs` per stop and `held` per needed item, and counts of notes not complete. For other team routes of the next 14 days: name, date, lead, members, stop count only | `GET /v1/routes/field-bundle` after each sync, at unlock and on pull to refresh (`RouteBundleRefresher`, an `AfterSyncRefresher`). Stored whole in a new table of the team database, in one local transaction | Replaced whole at each refresh; the team database's wipe. No patient name is in it: names come from the chart or the index |
| Charts of a route's active stops: the chart answer as phases 4 to 6 leave it (allergies, problems, `flags`, `alerts`, `timeline`, and `recentVisits` with the last three visits and their orders), plus `followUps` and `outreach`, each already cut to what this reader may see (lifecycle 6.4) | `RouteSource` (a `CacheSource`, kind `route`, `ref` the route ID) given to `ChartCache.reconcile`; D24 batches; the download's audit reason is `route` | 24 hours after the last refresh (refreshed at each sync while the route is live); at Complete, when the route's scopes are dropped; at sign-out (main 533) |
| The person's own route events | The outbox, as every change | After a hash-confirmed receipt **and** a stored bundle whose `lastSeq` is at least the receipt's `seq`. Until then the event stays, so the screen never loses it |
| Follow-ups | The chart answer's `followUps`, in `_chart` (`chart_cache.dart` gains the key); own unsynced ones in the outbox | With the chart (D46) |
| Bags and what they list | Phase 6's field bundle, which now lists only outings whose route is `assigned` or `confirmed`. Phase 6's "Bags today" picks the outing of the person's route for the day and asks only when they are on none or several | Phase 6's rule |

The route screen shows `routeView(bundle route, own events not yet in the bundle)`: the bundle's stops, then `eventEffect` and `applyPatch` for each waiting event in device order. A phone that never fetched a bundle shows "Your routes haven’t downloaded yet. Connect to see them." A route assigned for today or tomorrow starts its charts downloading at once, so a lead with no signal on the morning can still confirm and run.

## 7. API routes that only work online
All follow `docs/plan/patterns/api-route.md`. **Every route that writes calls `lockTeamWrites` as its first statement**, as every online writer does (lifecycle 5), then locks the route row, writes and audits in one transaction. Every refusal is the standard 403 with the key it lacked, logged, or a code shown to a person who can fix it at once; none reaches a phone's queue. Each write carries a client `requestId`; the same one again returns the first answer. No path, query or log line carries a patient ID, a name or search text. Every planner write that changes a route goes through section 5's writer, so it is an event too.

| Route | Key | Request → answer | Refusals | Audit event |
|---|---|---|---|---|
| `GET /v1/runs?from=&to=`, `POST /v1/runs`, `PATCH /v1/runs/{id}` | `routes.view`; `routes.manage` to write | run fields → the run with its routes' headlines | `name_taken`, `run_cancelled` | `run.created`, `run.updated`, `run.cancelled` |
| `POST /v1/routes` | `routes.manage` | `{runId, name, leadUserId, memberIds, bagIds}` → a `draft` route with its outing, made by phase 6's outing code | `team_size` (not 1 to 3), `lead_not_member`, `member_not_field` (lacks `routes.view`), phase 6's `bag_taken` and `bag_archived` | `route.created` |
| `GET /v1/routes/{id}` | `routes.view`; stops only with `patients.view` | → route, members, stops, requests, events kept and not applied | | `route.viewed` (`patientIds`) |
| `POST /v1/routes/{id}/stops`, `…/stops/{stopId}/remove`, `…/order`, `PATCH …/stops/{stopId}` | `routes.manage` | add `{patientId or place, plannedBundleIds, note}`; drop; reorder; edit note and bundles → the route | `route_locked`, `patient_on_other_route` (with that route's name and date), `already_on_route` | `route.stop_added`, `.stop_dropped`, `.reordered`, `.stop_updated` |
| `PUT /v1/routes/{id}/team` | `routes.manage` | `{memberIds, bagIds}` → the route; the outing's bags follow | `route_locked`, `team_size`, `lead_not_member`, `bag_taken`, `bag_archived` | `route.team_changed` |
| `POST /v1/routes/{id}/lead` | `routes.manage` | `{leadUserId, reason}` → the route; push to the old and new lead and the members | `route_closed`, `lead_not_member` | `route.lead_changed` (old, new) |
| `POST /v1/routes/{id}/assign`, `…/cancel` | `routes.manage` | → `assigned` (needs a stop), or `cancelled` with a reason (the outing is ended); push to the team | `no_stops`, `route_locked`, `route_closed` | `route.assigned`, `route.cancelled` |
| `POST /v1/routes/candidates` | `routes.manage` and `patients.view` | `{routeId, search, flagIds, followUpDueBy, page}` → ranked patients (preferred name, flags the caller may see, last seen, due follow-up, missed runs), and `hidden: [{routeName, serviceDate, count}]` | | `route.candidates_viewed` (`patientIds`, criteria without the text; D41) |
| `POST /v1/routes/{id}/requests`, `…/requests/{requestId}/withdraw` | `routes.manage` | `{kind, patientId or place, stopId, stopIds}` → the request; push `route_change_request` to the lead | `not_confirmed` (edit directly instead), `patient_on_other_route`, `already_answered` | `route.request_created`, `.request_withdrawn` |
| `POST /v1/routes/{id}/outcomes` | `routes.manage`, or a member with `routes.view` | `{stopId, outcome, otherReason, note, replaces}` → the stop | `stop_unknown` | `route.outcome_set` (old, new) |
| `POST /v1/routes/{id}/complete` | `routes.manage` | → `completed` | `not_confirmed`, `already_completed` | `route.completed` |
| `GET /v1/routes/field-bundle` | `routes.view` | → section 6.4's bundle with `revision` and `lastSeq` per route | | `route.bundle_fetched` (route IDs, `patientIds`) |
| `GET /v1/routes/{id}/bag-check` | `routes.view` on the route, or `routes.manage`; plus `inventory.view` | → `bagCheck` lines now, the stored checks, and the packing list (planned bundles through phase 5's `bundleLines`, summed) | | none (no patient data) |
| `GET /v1/routes/{id}/report` | `routes.manage`, or a member with `routes.view`; plus `patients.view` | → `reportBuckets` with stop details; notes not complete, from the list behind phase 4's `GET /v1/team/incomplete-notes` with its author filter (lifecycle 5.6), cut to drafts by the route's members in visits of its patients on the service date or named by its outcome events: note and visit ID, author, `overdue`, and the note's type only for a reader who may read the note (lifecycle 6.4); kept events, counts (seen, new or existing, referrals, supply items), the bag check | | `route.report_viewed` (`patientIds`) |
| `POST /v1/follow-ups/board` | `routes.manage` and `patients.view` | `{today, flagIds, clinicianIds}` → open follow-ups by column, each with flags, clinician, missed runs, and the route that holds the patient if any | | `followups.board_viewed` (`patientIds`) |

| `GET /v1/me/tasks` | `patients.view` | → the caller's own open follow-ups (main 958): ID, patient ID, kind, due date | | `tasks.viewed` (`patientIds`) |
| `GET /v1/me/counts` (phase 4's, lifecycle 5.6) gains `encountersToday`, `tasksOpen`, `tasksDueToday`, `routeNotesToFinish`, `routeNotesOverdue` | as today | visits the caller started on the date the phone sends; the caller's open tasks; drafts (by `isOverdue` for the second number) on routes the caller leads with a service date in the last 7 days. Names no patient, so it logs none | as today | none |
| `GET /v1/patients/{patientId}` (the chart answer) gains `followUps` and `outreach` | as today | open and closed follow-ups; the merged group's contact and outcome events, newest 50 (main 336) | as today | as today |
| Phase 6's `POST /v1/inventory/outings` and `…/outings/{id}/end` | | Removed: a route makes and ends its outing. `GET /v1/inventory/outings` stays, with the route's ID | | |

`needs` for a stop is worked out by the server: for each `condition_supply_map`, a patient with a problem of a listed code at status New or Ongoing adds `qtyPerPatient` of each line (main 476). `held` is the sum of `stock_balances` over the route's bags. A stop added on a phone has no `needs` until the next bundle.

Push sentences added to phase 6's fixed list (`services/api/src/push/messages.ts`, through `queuePush`; phase 6's `note_incomplete` and `tasks_due` stay unsent, since no scheduled job exists): `route_assigned` "Routes" / "You have a new route."; `route_change_request` "Routes" / "Your route has a change request" (main 330); `route_changed` "Routes" / "Your route changed."; `route_lead_changed` "Routes" / "Your route has a new lead."; `route_bags_short` "Supplies to review" / "A route’s bags need restocking."; `route_report_ready` "Routes" / "A route report is ready."

## 8. Screens
Every screen passes the accessibility checks in Day, Night run and High contrast, reflows at narrow width, and has an offline test. Recipes: `docs/plan/patterns/phone-screen.md`, `portal-page.md`. Portal page titles are generic ("Routes").

### 8.1 Phone (`apps/mobile/lib/features/runs/`)
| Screen | Shows | States and wording |
|---|---|---|
| Schedule tab | "Your routes", then "Team routes" (main 745) | None: "No routes yet." Not downloaded: section 6.4's sentence |
| Home (phase 4's and phase 6's tiles stay, lifecycle 9.9) | Cards "Your next route" and "Your team’s next route", from the bundle (main 744). Today's counts: "{n} encounters today · {n} open tasks". Tiles under Needs attention: **Tasks** ("2 tasks due today") and, for a lead, **Notes to finish on your routes** ("3 notes to finish. 1 is older than a day.") | The numbers come from `GET /v1/me/counts` when online, which names no patient; offline the tiles say "Connect to see these." Hidden when there is nothing |
| Tasks (opened from the tile) | The person's open follow-ups and deliveries by due date, from `GET /v1/me/tasks`; a row opens the chart | Offline: "Connect to see your tasks." |
| Follow-up rows on phase 4's summary screen (lifecycle 9.6, item 5) | One ticked row for each result of `tasksFromNote` over the person's own notes: "Follow up in 1 week", "Medication delivery" | A row with no date asks "When?" before Complete, or the tick is removed. Complete writes one `follow_up` for each ticked row. Never a condition of Complete |
| Route | Name, date, lead, team, status chip (Awaiting confirmation, Confirmed, In progress, Completed); active stops in order with contact and outcome chips, the allergy badge and flags; a **Removed** list; "Waiting to sync" on stops with unsent events | A stop with no contact shows "Not yet" (main 117). After a confirm with unseen changes: "This route changed before your confirmation arrived. Check the stops." |
| Stop | The patient bundle: chart summary, last known location, phase 6's banners, open tasks, the last three visits as phase 4's profile shows them, planned order sets (main 331); the contact log; outcome buttons; "Start encounter" (phase 4's flow from a profile, lifecycle 9.2) | Chart not on the phone: "This chart isn’t on this phone yet. Connect to download it." The index copy still shows allergies |
| Log contact | Confirmed, No response, Declined, Rescheduled; call, text or in person; the time | Rescheduled asks "New date" (main 336). Declined and Rescheduled say "This stop moves to Removed. You can restore it." |
| Confirm route | The stop list to review, how many charts are on the phone, the bag check, **Confirm route** (main 333) | Blockers from `confirmBlockers`: "Fix the items in Needs attention before you confirm." (main 562). Charts missing warns and does not block. Bag check: "These items are short" with item, needed and held, and **Restock now**; offline it runs from the bundle (main 476). Restock now is phase 6’s restock, online, for a holder of `inventory.manage`; others see "Ask Logistics to restock these bags." |
| Add to route | Search the patient list on this phone, "New patient" (intake), or "A place" | Lead: "Add a stop". Others: "Add someone you met". A patient on another route, for a lead's planned add: "On another route: {route name}. Send them through Logistics." |
| Lead tools and change request | Drop, restore, reorder (up and down buttons, no drag only). A request shows what is asked, with **Accept** and **Decline** | Shown only to the lead. "Logistics asks to add a patient", "… drop a stop", "… change the order" |
| Outcome | Seen, Declined, Could not locate, No response, Other (moved, in hospital, in jail, reported to have died, something else) with a note | Starting an encounter from a stop records Seen with that encounter. Two outcomes: "Two outcomes were recorded for this stop." |
| Complete run | Counts from `reportBuckets`; **Complete run** | "{n} stops weren’t reached. They’ll be listed under Patients Not Seen." (main 148) |
| Follow-up (in the chart) | Open tasks; "Set a follow-up date" and "Done" for a clinician | Others see the dates, not the buttons |

### 8.2 Portal (`apps/portal/src/app/(app)/runs/`, `/follow-ups/`; nav shown with `routes.view`)
| Page | Shows | States and wording |
|---|---|---|
| Runs | Runs by date with their routes, status and lead; "New run" with `routes.manage` | |
| Route builder | Team (one to three), lead, bags; candidates ranked by `rankCandidates` with a search box, flag filters, last seen date and a "Delivery due" mark; ticked patients arrive from the board or a report | "{n} patients are hidden because they are on another route: {route name}, {date}" (main 340) |
| Route and its change requests | Stops with contact and outcome, the Removed list, Assign, Cancel, Change lead (reason required); pending and answered requests | Once confirmed: "This route is locked to its team. Send the lead a change request." (main 328). "Changes that didn’t apply": each kept event with who, when and why, in plain words per reason code. `could_not_apply`: "The lead accepted, but the patient was already on another route." |
| Bag check and packing list | Shortfalls now, the check stored at confirm, the packing list with how many deliveries are due (main 418, 476, 478) | "Nothing is short." |
| Phase 6's "Bags out today" page | The same list, read only; each row links to its route. "New" and "End" are gone | "Bags go out with a route. Build one under Runs." |
| Report | Seen, Added on the run, **Patients Not Seen**, Notes not complete, Reported changes (Other outcomes; "reported to have died" asks an admin to review the chart’s status), counts; tick boxes and "Add to a route" (main 119, 367) | Before Complete: "This run isn’t complete yet. Stops with no outcome will be listed as Not reached." |
| Run | Before-run and after-run checklists worked out from data (each lead confirmed, bag checks, report read), the summed counts, the narrative box (main 362, 367, 369) | The narrative is the only thing staff type |
| Follow-ups board | Six columns (Overdue, Today, Tomorrow, Later this week, Next week, Later), ranked by flag within each, filters for flag and clinician, tick boxes, "Add to a route" (main 341, 935) | No drag between columns. "Not seen on 3 runs in a row" badge (main 152). A patient on an active route shows the route's name and has no tick box |

## 9. Audit events and the PHI rules that apply
Every event is written in the transaction of the change it records (`ctx.audit`, or the route's transaction). Details carry IDs, counts, codes and booleans only.

| Event | Details |
|---|---|
| `run.created`, `.updated`, `.cancelled`; `route.created`, `.assigned`, `.cancelled`, `.team_changed`, `.lead_changed` | run or route ID, which fields changed (names of fields, not values), member count, old and new lead ID |
| `route.contact_logged`; `route.confirmed` | route, stop, patient ID, result, method, `removed`; confirm: route, stop count, `unseenChanges`, shortfall count |
| `route.stop_added`, `.stop_dropped`, `.stop_restored`, `.reordered`, `.stop_updated` | route, stop, patient ID, origin, source (`lead`, `planner`, `request`) |
| `route.outcome_set` | route, stop, patient ID, old and new outcome, `conflict`, `afterCompletion` |
| `route.request_created`, `.request_answered`, `.request_withdrawn` | route, request, kind, answer, `failReason` |
| `route.completed`; `route.bag_checked` | route, counts per bucket; bag check: route, trigger, shortfall count |
| `route.event_kept` | route, event ID, kind, reason code |
| `followup.created`, `.closed` | follow-up, patient ID, kind, source, close reason (never the note, the path or the date's reason) |
| `route.viewed`, `.bundle_fetched`, `.report_viewed`, `.candidates_viewed`, `followups.board_viewed`, `tasks.viewed` | `patientIds` (D53), counts, filter IDs; never search text (D41) |

- A read that discloses patients and cannot be logged is refused: the six view events are written before the answer is sent. Home's numbers come from `GET /v1/me/counts`, which names no patient, so opening Home logs none (lifecycle 5.6).
- `place`, stop notes, outcome notes, follow-up notes and the run narrative are patient details. They are never in audit details, logs, notices, push text, URLs or `kv`. A notice carries a kind and a record ID only: phase 4's `change_not_applied`, and the new `route_request`, `route_unseen_changes`, `route_death_reported`.
- The bundle holds patient IDs and stop notes, and lives only in the encrypted team database. It holds no legal name and nothing derived from one (D40).
- A follow-up holds no answer of a note. Notes not complete in the report and in the bundle are IDs, an author and a mark; a note's type and content reach only a reader `visibleAnswers` allows.
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
| 10 | The lead marks another stop Could not locate, taps Complete run, syncs | `completed`; the outing ended by the same transaction; the route's cache scopes dropped; the confirmed events leave the phone only after a bundle that contains them |
| 11 | The member's phone syncs a late outcome and a late `stop_dropped` | The outcome is applied as a correction with old and new in the audit; the drop is kept (`not_lead`), noticed, and shown on the route page |
| 12 | Logistics opens the report | Seen, Added on the run (step 8), Patients Not Seen (step 10's stop, plus any stop left untouched as Not reached), Notes not complete (step 8's draft); `route.report_viewed` names the patients |
| 13 | Logistics ticks the not-located patient and adds them to a new route | The patient is offered (free again) and lands on the new route as a `not_yet` stop |

### 10.2 The test that holds each rule (each is checked to bite: revert the rule, see it fail, restore it)
| Rule | Test |
|---|---|
| Every row of 5.2 | `route-events.json`, read by the TypeScript and Dart tests; a parity test runs each case through the API and the fake |
| No refusal is added (D59) | For each reason code, `route_unknown` and a missing key: the push answers accepted or held, never rejected; a thrown rule is a stored `validation` and the next change applies |
| Every writer takes the team lock first | Two writers on one route, and a route write beside a merge of one of its patients: no deadlock, `seq` in order |
| The lock is the server's | A confirmed route refuses each planner edit route; a phone holding a stale `assigned` bundle sends a non-lead `stop_dropped` and it is kept, not applied |
| A kept event is never lost | For each reason code: the row exists, `applied` false, a notice exists, the receipt hash matches, the phone purges only after the bundle rule |
| A fault never stops the queue | An event the wire schema refuses, then a valid one in one batch: the second is applied |
| Outcomes do not depend on arrival order | `route-outcome.json` runs each pair both ways; the API test syncs two phones in both orders |
| One active route per patient | The index and the writer's group check, with a merged pair on two routes; a lead's offline add of a held patient is kept |
| Audit in the same transaction; a read that can’t be logged is refused | For each event kind, a failing audit insert leaves no event row and no stop change. Each of the six view routes with the audit insert failing answers an error and no data. `GET /v1/me/counts` writes no audit row |
| No patient details leak; what a reader may not see is absent | The bundle, receipts, notices and push payloads are scanned for names, `place` and notes; `kv` is scanned after a full run; the column list of `route_events` is pinned. A reader without the right to a Medical note gets a follow-up without `noteId` and `sourcePath`, and a report row without the note's type; the route cache's chart holds only what `visibleAnswers` gave |
| Permissions | One refusal test per route and key (`services/api/test/permissions.test.ts`); Billing/Data gets nothing; a member without `patients.view` gets a route without stops |
| Offline | Each phone screen's action is tested with the transport off, and again after the app is killed between the tap and the sync |
| The follow-up rules | Every row of 6.2: a CHW's `clinician` follow-up is held for a Program Admin and stays in the store; a non-author's is stored with no effect; the same note and path twice make one row; a Rescheduled contact replayed makes one follow-up. `note-tasks.json`, and every source path exists in phase 4's golden file |
| One outing per route; replay equals the stored state | After the migration every outing has a route; phase 6's create and end routes are gone; Complete and Cancel end the outing; the copies match. Both schema tests of 4.1 run after the Done when |
| The fake agrees | `fake_parity_test.dart` and `fake_reads_test.dart` cases for 6.3 |

## 11. Defaults chosen (PLAN-OPEN) and questions for people
| Question | Default | Who decides |
|---|---|---|
| May Logistics log pre-visit contact when not on the route? | Yes, with `routes.manage`; planners often make the calls | Brooke and Mercy |
| May anyone on the route add an on-the-fly patient, or only the lead? | Anyone on the route (main 338, 112); the Build plan's line 104 names the lead | The team |
| Which outcome shows when two disagree? When does a Declined outcome's follow-up fall due? | Seen, Declined, Other, No response, Could not locate, in that order, and the stop is marked. The follow-up falls due 7 days after the service date | Brooke and Mercy |
| Who may set a follow-up date? | From the chart: `encounters.chart` with a credential that may chart Medical. From a note's own follow-up answer: that note's author, so a CHW's Social needs follow-up becomes a task. Logistics may not | Brooke and Mercy |
| How do the five follow-up questions and Medication delivery become tasks? | One tap: ticked rows on the summary screen, made at Complete; due dates from the option's days; a delivery is due on the visit's date | Brooke and Mercy |
| May Logistics see that a medication delivery is due, and its instructions (main 418)? | That it is due: yes, as any follow-up date (main 341). The instructions: no; they are a Medical note's answer and follow `visibleAnswers` | Brooke and Mercy; counsel |
| May bags go out with no route? | No. An outing is made only with a route; a day with no patient list is a route with one place | The team |
| Which drafts count for the route lead? | Drafts by the route's members in visits of its patients on the service date, for 7 days; shown on Home and in the report, with no push | Brooke and Mercy |
| Home's recent patient activity and team members active (main 744) | Not built in this phase; no phase holds them | Project lead |
| Who is told of a reported death? | Holders of `team.view_audit` (Program Admins), by notice; it is also on the report | Brooke and Mercy |
| Patients Not Seen edge cases (main 147-152). What counts as "seen elsewhere"? | The plan's defaults (`IMPLEMENTATION_PLAN.md` section 6): Not reached at Complete, Other with a reason, Declined and Rescheduled off the list, seen elsewhere the same day comes off, 3 missed runs raise the patient. Seen elsewhere: any encounter for the patient's merged group on the service date that has a note other than an empty draft (lifecycle 3.1) | Brooke and Mercy |
| When do a route's charts download? How long does a route stay on the phone after Complete, and how far ahead does Schedule show team routes? | From assignment, when the date is today or tomorrow; main 337 says "starting a route". 48 hours, for corrections (its charts leave at Complete); 14 days | Project lead; the team |
| What a stop needs for the bag check. Does the lead see bag counts at confirm? | Condition maps only (main 476); planned bundles feed the packing list, not the check. Needed and held for short items only, at confirm and when a confirmed route changes. Phase 6 shows no counts on any phone (its decision 8); this is the one exception, and it needs a yes | Brooke and Mercy |
| When does a week start on the board, and whose "today" is it? Is every route in a run? | Monday; the date the portal sends (phones use their corrected clock). Every route is in a run; the builder makes a run in the same step | The team; project lead |
| Should recording a patient's presence on a route in the permanent audit log be limited? | Logged with patient IDs, as D53 | Counsel |

Questions with no default: which map provider, and whether maps enter the MVP at all (project lead, counsel for the BAA). Whether a route's place text ("the camp under the bridge") may name a location tied to patients in a push or an export: here it never leaves the encrypted stores (counsel). Whether volunteers who are not users may be listed on a run (Brooke and Mercy).

## 12. Risks, and where the design departs from the PRD or reads it a particular way
1. **A confirm made offline can lock a route the lead did not fully see.** A planner edit made after the lead's last bundle still stands. The route says so, the lead is told, and a stop nobody visits ends on Patients Not Seen, so nobody is dropped. The other choice, refusing the confirm, would leave a team in the field with an unlocked route.
2. **`eventEffect` exists twice** (TypeScript and Dart) and a third time inside the fake. The vectors and the parity tests are the only guard (plan risk 7). Every new reason code is a vector first.
3. **Stored columns can drift from the event log.** The replay test catches it; the writer is the only code that touches them. **Kept events can pile up unread.** They show on the route page, the report and the author's notices; nothing times them out.
4. **The bundle grows with a busy team.** It is bounded by date (yesterday to 14 days) and by the 60-stop limit; measure it on a weak link before the pilot (D24).
5. **This phase leans on three unbuilt phases.** Section 2's second table is their designs as they read on Nov 14. This phase adds keys to phase 4's chart answer and `/v1/me/counts`, rows to its summary screen, and takes two routes and a page from phase 6; if a build changes those, the cards that touch them are checked again.
6. **The task sources are a hand-kept list of paths.** A definition's new version can move a follow-up question. The golden-file test catches a path that no longer exists, not a question added without a source.

Departures and readings:
- **Kept, not rejected.** Main 557-560 lists rejection reasons. A route rule here never rejects (decision 3), following lifecycle 4.1 and D59.
- **"Follow-up tasks created in one tap" (main 433) is a ticked row and Complete.** The delivery task (main 418) carries no instructions; the run's list shows that one is due.
- **The outing is kept as the route's bags, not replaced by a view** (phase 6's risk 2). Phase 6's order, alert and push rows point at it, so absorbing it changes no row of theirs.
- **Contact after confirm is allowed.** Main 335 says contact is logged before the lead confirms; main 476 has stops removed as Rescheduled or Declined on a confirmed route. Both hold: contact applies in `assigned` and `confirmed`.
- **"Started" is the confirm.** Main 328 locks a route "once started"; main 333 says confirming starts it. There is no separate start. "In progress" (main 340) is shown from the first outcome. Before it, the lead and Logistics may both edit (main 327 and 328 read together).
- **Charts download before the route starts** (main 337, 533), so that an offline confirm is possible; the 24-hour limit is kept by refreshing. The team index is not narrowed to the route: main 534 keeps it team-wide, and the route scopes the chart cache (main 533; D30).
- **The lead sees counts for short items at confirm**, a narrow exception to phase 6's "no counts on the phone", because main 476 puts the pop-up on the phone, offline (PLAN-OPEN, section 11).

## 13. Units and a first card list
Units: W1 schema, rules and sync; W2 routes API; W3 phone route data; W4 phone screens; W5 portal; W6 the Done when and the close. The names share nothing with the units of phases 4 to 6 (F, E, L, P, I). A card's ID is its unit and a short name. Each unit with T cards has one `tests` card (level X) that writes those cards' test files and vectors first. W1 lands first, alone, with CI green. Then W2 and W3 side by side, then W4 and W5, then W6. Levels follow `docs/plan/README.md`: an always-X path is X, a screen, a widget or a page is R, and S is kept for a card whose every mistake a machine check catches. A contract card regenerates the contract after its unit's routes or schemas. Files an earlier phase also edits, its cards first: `api/app.ts`, `api/routes/{sync,encounters,inventory}.ts`, `api/encounters/counts.ts`, `api/inventory/{outings,field-bundle}.ts`, `api/patients/{charts,projection,schemas}.ts`, `api/push/messages.ts`, `api-test/permissions.test.ts`, `db/seed/seed.ts`, `phone/sync/{entities,local_store,local_db}.dart`, the fake, `chart_cache.dart`, `patient_providers.dart`, `app.dart`, `home_screen.dart`, `patient_screen.dart`, `sync_labels.dart`, phase 4's summary screen, phase 6's Bags today screen and outings page, the generated contract. Short paths: `api/` is `services/api/src/`, `api-test/` is `services/api/test/`, `phone/` is `apps/mobile/lib/`, `phone-test/` is `apps/mobile/test/`, `vectors/` is `packages/contract/test-vectors/`, `portal/` is `apps/portal/src/app/(app)/`, `fake` is `phone-test/sync/fake_server.dart`.

| Card | Level | Files | Needs |
|---|---|---|---|
| W1-migration-routes | X | `db/migrations/<n>_runs_routes.sql` (with the outing's backfill, foreign key and unique index), `db/test/runs-routes.test.ts` | phase 6's I1-migration-locations |
| W1-migration-events | X | `<n>_route_events.sql` (append-only triggers, the request's status trigger), `db/test/route-events.test.ts` | W1-migration-routes |
| W1-migration-follow-ups | X | `<n>_follow_ups.sql` (with `patient_of_change`), `db/test/follow-ups.test.ts` | W1-migration-events; phase 4's L0; phase 6's I1-migration-alerts |
| W1-tests | X | The seven vector files of 5.3 with their TypeScript and Dart readers; the golden-file check of the task sources; new cases for phase 6's push text test | phase 4's F6; phase 6's I1-tests |
| W1-events-ts | T | `api/runs/rules.ts` (`eventEffect`, `applyPatch`) | W1-tests |
| W1-events-dart | T | `phone/runs/rules.dart` | W1-tests |
| W1-small-rules-ts | T | `api/runs/outcome.ts`, `report-rules.ts`, `bag-check.ts` | W1-tests |
| W1-small-rules-dart | T | `phone/runs/outcome.dart`, `report_rules.dart`, `bag_check.dart` | W1-tests |
| W1-planning | T | `api/runs/planning-rules.ts` (`rankCandidates`, `followUpColumn`, `missedRunsInRow`) | W1-tests |
| W1-phone-rules | T | `phone/runs/confirm_blockers.dart`, `phone/runs/note_tasks.dart` (`tasksFromNote` and its source list) | W1-tests |
| W1-push-text | T | `api/push/messages.ts` (six sentences) | W1-tests; phase 6's I1-push-text |
| W1-wire | X | `api/sync/schemas.ts`, `api/sync/entities/values.ts`, `vectors/sync-values.json` (both entities) | W1-migration-follow-ups |
| W1-writer | X | `api/runs/apply-event.ts` (team lock, route lock, `eventEffect`, the event, the patch, the outing, follow-up, bag check, notices, audit), `api-test/route-writer.test.ts` (with the replay check) | W1-events-ts, W1-small-rules-ts, W1-wire; phase 6's I2-outings |
| W1-event-entity | X | `api/sync/entities/route-event.ts`, `api/sync/entities/index.ts`, `api-test/sync-route-events.test.ts` | W1-writer |
| W1-follow-up-entity | X | `api/sync/entities/follow-up.ts`, `api/sync/entities/index.ts`, `api/patients/charts.ts` (`CHART_TABLES`), `api-test/sync-follow-ups.test.ts` | W1-wire; phase 4's L1 (`loadSigner`) |
| W1-read-rules | X | `api/routes/sync.ts` (the read rule of each entity, 6.1) | W1-event-entity, W1-follow-up-entity |
| W1-phone-entities | X | `phone/sync/entities.dart`, `phone/sync/local_store.dart` (keep a route event until a bundle holds it) | W1-wire |
| W1-local-db | X | `phone/sync/local_db.dart` (the `route_bundle` table), `phone/sync/local_store.dart` (drop a route's scopes) | W1-phone-entities |
| W1-fake-events | X | `fake`, `fake_parity_test.dart` (route events, every reason, the planner helper) | W1-read-rules, W1-phone-entities |
| W1-fake-follow-ups | X | `fake`, `fake_parity_test.dart` (every row of 6.2, both read rules) | W1-fake-events |
| W1-chart-reason | T | `api/patients/charts.ts`, `api/patients/schemas.ts` (download reason `route`) | W1-tests |
| W1-labels | R | `phone/features/sync/sync_labels.dart` (headings, and a sentence for each notice and reason code) | W1-phone-entities |
| W1-contract | S | The generated contract | W1-wire, W1-chart-reason |
| W2-tests | X | `api-test/{runs,routes-build,routes-edit,routes-team,routes-assign,routes-candidates,routes-requests,routes-portal-events,routes-needs,routes-bundle,routes-bag-check,routes-report,routes-push,follow-ups-board,me-tasks,chart-follow-ups,me-counts-routes,outings-absorbed}.test.ts` | W1 |
| W2-runs | T | `api/routes/runs.ts`, `api/runs/runs.ts`, `api/app.ts` (list, create, update, cancel) | W2-tests |
| W2-route-create | T | `api/routes/runs.ts`, `api/runs/routes.ts` (create with its outing, read) | W2-runs |
| W2-stop-edits | T | `api/routes/runs.ts`, `api/runs/planner-edits.ts` (through the writer, refusing `route_locked`) | W2-route-create |
| W2-team | T | `api/routes/runs.ts`, `api/runs/team.ts` (team, bags, lead; the outing follows) | W2-route-create |
| W2-assign | T | `api/routes/runs.ts`, `api/runs/routes.ts` (assign, cancel) | W2-stop-edits |
| W2-candidates | T | `api/routes/runs.ts`, `api/runs/candidates.ts` | W2-route-create; phase 5's P5-search |
| W2-requests | T | `api/routes/runs.ts`, `api/runs/requests.ts` (create, withdraw) | W2-assign |
| W2-portal-events | T | `api/routes/runs.ts`, `api/runs/planner-edits.ts` (outcome correction, Complete) | W2-assign |
| W2-needs | T | `api/runs/needs.ts` (stop needs, held counts) | W2-tests |
| W2-bundle | T | `api/routes/runs.ts`, `api/runs/field-bundle.ts` | W2-assign, W2-needs |
| W2-bag-check | T | `api/routes/runs.ts`, `api/runs/bag-check-read.ts` (with the packing list) | W2-needs |
| W2-report | T | `api/routes/runs.ts`, `api/runs/report.ts` (notes not complete through phase 4's `api/encounters/incomplete.ts`) | W2-portal-events; phase 4's L2 |
| W2-board | T | `api/routes/follow-ups.ts`, `api/runs/board.ts`, `api/app.ts` | W2-tests |
| W2-my-tasks | T | `api/routes/follow-ups.ts`, `api/runs/tasks.ts` (`GET /v1/me/tasks`) | W2-board |
| W2-chart-reads | T | `api/patients/projection.ts`, `api/patients/schemas.ts`, `api/runs/outreach.ts` (`followUps`, `outreach`) | W2-tests; phase 6's I2-chart-alerts |
| W2-home-count | T | `api/encounters/counts.ts`, `api/routes/encounters.ts` (the five numbers) | W2-tests; phase 6's I2-home-count |
| W2-outings | T | `api/routes/inventory.ts`, `api/inventory/outings.ts`, `api/inventory/field-bundle.ts` (the two write routes go; the bundle lists live routes' outings) | W2-assign; phase 6's I2-field-bundle |
| W2-push-events | T | One `queuePush` call each in `api/runs/apply-event.ts` (`route_changed`, `route_bags_short`, `route_report_ready`) | W1-push-text, W2-tests |
| W2-push-planner | T | One `queuePush` call each in `api/runs/routes.ts`, `requests.ts`, `team.ts` | W2-requests, W2-team |
| W2-permissions | R | `api-test/permissions.test.ts` (a row for each route) | the route cards of W2 |
| W2-contract | S | The generated contract | W2-permissions |
| W2-seed | S | `db/seed/demo-routes.ts`, `db/seed/seed.ts` (a demo run and route; recipe `seed-data.md`; the PHI guard checks it) | W2-assign |
| W3-tests | X | `phone-test/runs/{route_bundle_repository,route_view,run_actions,follow_up_repository,offline_actions}_test.dart` (offline, and kill the app before sync) | W2-contract |
| W3-fake-reads | X | `fake`, `fake_reads_test.dart` (the bundle, `followUps` and `outreach`, the counts, `GET /v1/me/tasks`) | W2-contract, W1-fake-follow-ups |
| W3-bundle-store | T | `phone/runs/route_bundle_repository.dart`, `route_bundle_refresher.dart`, `phone/patients/patient_providers.dart` | W3-tests, W3-fake-reads, W1-local-db |
| W3-route-view | T | `phone/runs/route_view.dart` | W3-bundle-store, W1-events-dart |
| W3-route-source | X | `phone/runs/route_source.dart`, `phone/patients/chart_cache.dart` (the source; the `followUps` and `outreach` keys), `phone/patients/patient_providers.dart`, `phone-test/runs/route_source_test.dart` | W3-bundle-store, W1-chart-reason |
| W3-actions | T | `phone/runs/run_actions.dart` (one method per event kind, through the store) | W3-tests, W1-phone-entities |
| W3-follow-ups | T | `phone/runs/follow_up_repository.dart` (read from `_chart`, create, close, my tasks) | W3-tests, W3-route-source |
| W4-schedule | R | `phone/app.dart`, `phone/features/runs/schedule_screen.dart` | W3-route-view |
| W4-home | R | `phone/features/home/home_screen.dart`, `phone/features/runs/next_route_card.dart` (cards, counts, two tiles) | W3-route-view; phase 6's I5-home |
| W4-tasks | R | `phone/features/runs/tasks_screen.dart` | W3-follow-ups |
| W4-route | R | `phone/features/runs/route_screen.dart` | W4-schedule |
| W4-stop | R | `phone/features/runs/stop_screen.dart` | W4-route; phase 6's I5-banner-strip |
| W4-sheets | R | `phone/features/runs/contact_sheet.dart`, `outcome_sheet.dart` | W4-stop, W3-actions |
| W4-confirm | R | `phone/features/runs/confirm_route_screen.dart` | W1-small-rules-dart, W1-phone-rules, W3-actions |
| W4-add-stop | R | `phone/features/runs/add_stop_screen.dart` | W3-actions |
| W4-lead-tools | R | `phone/features/runs/lead_tools.dart`, `request_sheet.dart` | W4-route |
| W4-start-visit | R | `phone/features/runs/stop_screen.dart`, `phone/runs/run_actions.dart` (phase 4's start from a profile, then Seen with the visit's ID) | W4-sheets; phase 4's L5 |
| W4-complete | R | `phone/features/runs/complete_run_screen.dart` | W1-small-rules-dart, W3-actions |
| W4-follow-up | R | `phone/features/runs/follow_up_section.dart`, `phone/features/patients/patient_screen.dart` | W3-follow-ups |
| W4-summary-tasks | R | `phone/features/runs/note_task_rows.dart`, phase 4's summary screen | W1-phone-rules, W3-follow-ups; phase 4's L5 |
| W4-restock | R | `phone/features/runs/restock_screen.dart`, phase 6's `bags_today_screen.dart` (the route's outing first) | W4-confirm; phase 6's I4-bags-screen |
| W4-a11y | R | Three-theme, narrow-width and offline tests for the screens of W4 | the screen cards of W4 |
| W5-runs | R | `(app)/layout.tsx`, `portal/runs/page.tsx` | W2-contract |
| W5-run-form | R | `portal/runs/RunForm.tsx`, `actions.ts` | W5-runs |
| W5-builder-team | R | `portal/runs/routes/[routeId]/build/page.tsx`, `TeamForm.tsx` | W5-run-form |
| W5-builder-candidates | R | `…/build/Candidates.tsx`, `actions.ts` | W5-builder-team |
| W5-route | R | `portal/runs/routes/[routeId]/page.tsx`, `RouteActions.tsx` | W5-builder-team |
| W5-requests | R | `…/[routeId]/Requests.tsx`, `KeptEvents.tsx`, `OutcomeDialog.tsx` | W5-route |
| W5-bag-check | R | `…/[routeId]/BagCheck.tsx` | W5-route |
| W5-report | R | `…/[routeId]/report/page.tsx`, `ReportLists.tsx` | W5-route |
| W5-run | R | `portal/runs/[runId]/page.tsx` | W5-report |
| W5-board | R | `portal/follow-ups/page.tsx`, `Board.tsx` | W2-contract |
| W5-outings | R | Phase 6's `portal/inventory/outings/page.tsx` and its `actions.ts` (read only, a link to each route) | W5-route; phase 6's I6-outings |
| W5-e2e | R | `apps/portal/e2e/routes.spec.ts`, `a11y.spec.ts` (the portal steps of the Done when, Playwright and axe, three themes) | the page cards of W5 |
| W6-server | X | `api-test/routes-done-when.test.ts` | W2 |
| W6-phone | X | `phone-test/runs/done_when_test.dart` (against the fake) | W3, W4 |
| W6-live | X | `phone-test/runs/live_routes_test.dart`, `tools/live-sync.sh` | W6-phone |
| W6-phi-pins | X | `api-test/routes-phi.test.ts` (the bundle, receipts, notices and pushes scanned; the column list of `route_events`; no audit row from Home's count) | W2 |
| W6-docs | R | `docs/compliance/`, `IMPLEMENTATION_PLAN.md` (the D-table, section 6 rows), the PR description | all |

**Count: 85 cards. S 3, T 31, R 30, X 21.** By unit: W1 23, W2 23, W3 7, W4 15, W5 12, W6 5. No card changes more than three source files.
