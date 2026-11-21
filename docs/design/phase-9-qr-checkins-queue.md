> Draft plan (Nov 14), checked against the reviewed phase 4 design and the designs of the phases before it. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 9: QR IDs, check-ins and the continuity queue

"PRD main N" is a line of the product spec's main tab; "Build plan N" a line of its Build plan tab. Paths are from the repository root. "Next free number" means the lowest unused migration number when the unit starts (phase 4 takes 0017 to 0021, phase 5 0022 and 0023, phase 6 0024 to 0028, phase 7 three more, phase 8 its own). "Lifecycle" and "forms" with a section number are the two parts of the phase 4 design (`docs/design/phase-4/`); "phase 5 design", "phase 7 design" and "phase 8 design" are the files in `docs/design/`. "The plan" is `IMPLEMENTATION_PLAN.md`. Where an earlier phase defines a table, route, record or screen, it owns it: this design uses its names and adds to it.

## 1. Scope and Done when
**Done when** (Build plan 116; the plan, section 4, phase 9 row): scanning a printed card opens the right chart after sign-in, and opens only a sign-in page for anyone else.

| In | PRD |
|---|---|
| Scan ID link with the in-app camera: opens the chart, online or offline | main 285, 267; Build plan 115 |
| Opening the link in a browser: only a sign-in page when signed out; the chart after sign-in | main 285, 287 |
| An old card: "This card was replaced on [date]. Issue a new card?" and no chart | main 296 |
| A card another phone made and has not synced: "Card not active yet, search by name" | main 302 |
| A card the server refused stays blocked on the phone that made it | main 306 |
| Every scan is audited, scans of old cards included | main 295 |
| Quick check-in: type (Medical or Non-medical), staff member, time, location; no encounter is opened | main 308 |
| A check-in moves the patient's last-seen date | main 271; `db/migrations/0009_patients.sql:59` |
| Phase 4's Start (+) tab gains Quick check-in and Scan ID link | main 743; lifecycle 9.2 |
| The continuity-of-care queue: a priority list from the flag criteria, maintained by the continuity group, the input to route planning | main 322, 326, 312 |
| "Could not locate" outcomes raise a patient on the queue | main 369 |

| Out | Who takes it | PRD |
|---|---|---|
| Making the QR image or the printed card | The team's own tool, always | main 281-284 |
| Issuing, copying and regenerating a link, the offline handshake | Built in phase 3 (D31, D39) | main 289-306 |
| Grant report counts from check-ins | Phase 10. This phase stores the rows it counts | main 308; Build plan 120 |
| Taking stock out of a bag at a check-in | Not built. Dispensing stays with phase 6's orders. PLAN-OPEN, section 11 | main 308 |
| GPS coordinates on a check-in; maps | After the MVP list; needs a map provider under a BAA | main 344-356 |
| The link opening the app itself from the phone's camera (app links) | After the pilot host is fixed (the plan, section 6, "The ID link host"). PLAN-OPEN | main 285 |
| The queue on the phone; building a route on the phone | Not in the Build plan. Clinicians feed the queue from the phone through flags (phase 5) and follow-up dates (phase 7) | Build plan 115 |
| New encounter on the Start tab | Phase 4 (lifecycle 9.2) | main 743 |
| Brief call note | Not built: phase 4's PLAN-OPEN (lifecycle 12.1 #14) | main 743 |
| A Home tile or count for check-ins or the queue | Not built: nothing is added to `GET /v1/me/counts` | lifecycle 5.6 |
| Face or photo matching at a scan | Never (no face recognition) | main 262 |

## 2. Ground truth
What the code has today (checked Nov 14 in this branch):

| Fact | Where |
|---|---|
| `patient_id_links`: `token`, `token_hash` (unique across all teams), `status` (`active`, `retired`), `retired_at`, `retired_reason`, `retired_by_link`; one active link per patient row; team policy; no delete | `db/migrations/0012_id_links.sql` |
| Token helpers on both sides: 22 characters, `idLinkTokenHash` (SHA-256 hex), `idLinkTokenRef` (first 12 hex, the only form audit carries), `idLinkUrl` (`{base}/c#<token>`), pinned by `packages/contract/test-vectors/id-link-token.json` | `services/api/src/patients/id-links.ts:19-45`; `apps/mobile/lib/patients/id_link_token.dart` |
| The server only issues and lists links: `GET` and `POST /v1/patients/{patientId}/id-link`. **No route resolves a token. Nothing writes a scan event.** | `services/api/src/routes/patients.ts:169-190` |
| The landing page `/c` is public, the same for everyone, and neither reads nor sends the fragment. Its link goes to `/home`. Its comment names `POST /v1/id-links/resolve` as phase 9's job | `apps/portal/src/app/c/page.tsx`; `apps/portal/src/proxy.ts:9` |
| The portal has no "return here after sign-in": the proxy redirects to `/sign-in` and sign-in ends at the team's home | `apps/portal/src/proxy.ts:55-74` |
| The phone's `id_links` table has `id`, `patient_id`, `token` (nullable), `state` (`pending`, `active`, `retired`, `blocked`, `rejected`). It has **no hash column**. Rows come from cards made here, cached charts, and the index | `apps/mobile/lib/sync/local_db.dart:283-293`; `apps/mobile/lib/patients/id_links.dart`; `apps/mobile/lib/patients/chart_cache.dart:148`, `:224` |
| The team index carries each patient's active links as `{id, effectiveAt}` only, and `lastSeenOn` (newest across a merged group) | `services/api/src/patients/team-index.ts:55-63`, `:86-89`, `:120`; `services/api/src/patients/schemas.ts:418` |
| `patients.last_seen_at` exists with the comment "phase 4 encounters and phase 9 check-ins move it" | `db/migrations/0009_patients.sql:59` |
| `checkins.create` exists ("Log quick check-ins"). The CHW preset holds it with `patients.view`, `patients.edit`, `referrals.create`, `routes.view`. `mayHoldTeamIndex` already admits a role with `patients.view` and `checkins.create` | `services/api/src/auth/permissions.ts:25`, `:55-66`, `:80-92` |
| Offline reads are logged on the phone with `appendAudit` and join the chain at sync. The allowed actions are a fixed list of six; `id_link.scanned` is not one | `apps/mobile/lib/sync/local_store.dart:856`; `services/api/src/sync/entities/values.ts:269-277`; `services/api/src/sync/apply.ts:376` |
| A synced entity is one `EntityRules` object; `id_link` is a create-only example that takes the team lock | `services/api/src/sync/entities/id-link.ts` |
| The phone has no camera or scanner package, and no Start tab ("Start, Schedule and Resources arrive with their phases") | `apps/mobile/pubspec.yaml`; `apps/mobile/lib/app.dart:74` |
| No check-in table, entity, screen or queue exists | `db/migrations/`; `services/api/src/sync/entities/`; `apps/mobile/lib/features/` |

What earlier phases deliver first (designed and checked, not built on Nov 14). Each owns what it names:

| From | Thing | What phase 9 does with it |
|---|---|---|
| lifecycle 9.2 | The Start (+) tab (`start_sheet.dart`) opens one choice, New encounter, and stops it while the clock check fails. Quick check-in and Scan ID link are left to this phase | 8.1 adds the two choices |
| lifecycle 4.3 | An accepted encounter that names a patient, and an applied `patientId` set, move `last_seen_at` to `started_at` when that is later than the value held and not later than the server's clock. It never moves backwards | 5.2 uses the same rule for a check-in; the void rule reads the same encounters |
| lifecycle 5.2, 9.1; D67 | The chart answer's `timeline` (visits and referrals, the first 50) and `recentVisits`, kept in the patient record's `_chart` field (`chart_cache.dart` names its keys by hand); the profile's Timeline section with seven filters; the Timeline on the portal's patient page (card L6-patient-timeline) | The chart answer gains `checkIns`; its rows show in both Timelines under Outreach |
| lifecycle 3.1, 1.3, 4.2; D56 | Medical is a property of a note, through its type (`encounter_notes.medical`). A Non-Medical note is never signed. A visit's kind only goes to Medical. The Medical gate (`chartMedical`) holds a change for a Program Admin | A check-in is not a note and is never signed. Its `kind` is a label for counts. A Medical check-in uses the same credential test and the same hold (6.1) |
| lifecycle 4.1, 4.2, 4.10, 5; D59 | A refusal only for what the worker can fix; anything else is accepted with no effect and a notice (`change_not_applied`); no new reject reason; a missing key on a push is held; a rule that throws is a stored `validation`; every change takes the team lock, and every online writer calls `lockTeamWrites` first | 6.1 and section 7 follow all of it |
| lifecycle 5.6, 6.4, 9.9; D66 | `GET /v1/me/counts` names no patient; `visibleAnswers` decides who reads what in a note; what a reader may not see is absent | No count is added. A check-in copies nothing from a note |
| Phase 5 design 4.4, 4.5, 5.3 | `flag` presets (`tier`, `rank`, `sensitive`), `patient_flag_changes`, `currentFlags`, the chart answer's `flags` | The queue's flag reason and order |
| Phase 7 design 4, 5.3, 6.1, 7, 8.2 | `routes`, `route_stops` (`outcome`, `holds_patient`), the `outcome` kind of `route_event`, `follow_ups`, `followUpColumn`, `missedRunsInRow`, `rankCandidates`, `POST /v1/routes/candidates`, `POST /v1/routes/{id}/stops`, `reportBuckets` with `seenElsewhere`, `RunActions`, the builder's `Candidates.tsx` | The queue's other reasons; "Add to a route"; a check-in from a stop. The follow-up board stays phase 7's |
| Phase 8 design, cards U5-android and U5-ios | The `CAMERA` permission and `NSCameraUsageDescription` | The scanner. Card Q3-camera-text widens the wording to cards, and adds both if phase 8 is not built |

If phase 5 or 7 is missing when this phase starts, the scan cards and the portal's card page (the Done when) can still be built; the check-in migration (its `route_id`) and the queue cards wait.

## 3. The design in one page
1. **Only the token's hash ever leaves the scanner.** The phone and the browser hash the token in memory and send or look up the hash. The plaintext never reaches a request, a log, a table of scans or a URL our code makes. Reason: the server already looks links up by hash only (D31), so the plaintext is never needed.
2. **One online route answers a scan: `POST /v1/id-links/resolve`, inside the open team only.** A card of another team answers exactly as a card that never existed. Reason: a card must not reveal that a person is known to some other team.
3. **Offline scans work from hashes in the team index.** Each index entry's active links gain `tokenHash`. Reason: main 267 says offline search covers QR scans; a hash of 128 random bits cannot be turned back into a card, so a lost phone still cannot print one (D40 is about legal names and is untouched).
4. **What a scan shows is decided by small pure functions** (`parseIdLink`, `localScanState`, `scanDecision`, `serverScanOutcome`), pinned by one vector file. Reason: the five outcomes and their wording are the judgment; the screens only show the result.
5. **A check-in is one immutable, create-only record** with the smallest content that meets main 308: patient, type, what was given (a fixed list), place (short text), source. Who, when and which device come from the change envelope. No free text beyond the place, no clinical field. It is not a note: nothing is signed, co-signed or attested (D56). Reason: it is made offline by the roles with the least access.
6. **A check-in moves one thing: `last_seen_at`, to the later of its own time and the stored value, as phase 4's encounters do (lifecycle 4.3).** It never touches a patient field that has versions. Reason: "the later of" is a sum-like rule, so two phones offline cannot conflict.
7. **A wrong check-in is voided, never edited or deleted:** one set-once field. Reason: nothing is deleted, and both entries stay in the audit log (the rule main 239 sets for problems).
8. **The queue is worked out when read, never stored.** Its reasons come from data other phases already hold (flags, overdue follow-ups, missed runs, could not locate). Reason: lifecycle 3.9's rule and item 10 of phase 7's one page; nothing to keep in step.
9. **The continuity group's own hand is an append-only list of pin and snooze entries,** made online in the portal. Reason: main 322 says the group "maintains" the list; append-only keeps who and why.
10. **No new permission keys (D37).** Scan: `patients.view`. Check-in: `checkins.create`. See the queue: `patients.view` and `routes.view`. Maintain it: `patients.view` and one of `routes.manage`, `encounters.chart`.
11. **Nothing here is refused to a phone (D59).** A check-in cannot be edited, so a worker could fix nothing. A missing key or credential is held for a Program Admin; a void from the wrong person is accepted with no effect and a notice; a fault is a stored rejection. The two online writers take the team lock first.

## 4. Data model
Two migrations, each the next free number, additive, one transaction. Both are level X (policies and a trigger).

### 4.1 `<n>_check_ins.sql`
`check_ins`. Append-only except the three void columns, which are set once together.

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid primary key | Made on the phone |
| `team_id` | uuid not null | FK `teams (id)` |
| `patient_id` | uuid not null | Composite FK `patients (team_id, id)` |
| `kind` | text not null | `medical` or `non_medical` (main 308). A label for counts; not a note's Medical (D56) |
| `services` | text[] not null default `'{}'` | Subset of `food`, `water`, `clothing`, `hygiene`, `wellbeing`, `other`; at most 6; no repeats; empty when `kind = 'medical'` (check constraint) |
| `place` | text | Null, or 1 to 200 characters after trim (as `usual_area`, `0009_patients.sql:53`) |
| `source` | text not null | `scan`, `search` or `route`: how the patient was found |
| `id_link_id` | uuid | The card scanned, when `source = 'scan'` and the server knows it for this patient's group; else null. No FK (a pending card may arrive later) |
| `route_id` | uuid | The route whose stop this was; composite FK to phase 7's `routes`; null when the route is unknown |
| `occurred_at` | timestamptz not null | Clock-corrected device time (`when(c)`, as `id-link.ts:50`) |
| `clock_verified` | boolean not null | From the change |
| `author_user_id` | uuid not null | FK `users (id)`: the staff member (main 308) |
| `device_id` | uuid | FK `devices (id)` |
| `change_id` | uuid not null unique | The change that made it |
| `received_at` | timestamptz not null default `now()` | |
| `voided_at`, `voided_by`, `void_reason` | timestamptz, uuid, text | All null or all set. `void_reason` is `wrong_patient`, `duplicate` or `other` |

- Indexes: `(team_id, patient_id, occurred_at)`; `(team_id, occurred_at)` for phase 10's counts.
- Trigger `check_ins_set_once`: an update may only take the three void columns from null to not null; any other change raises.
- Security block: `enable row level security`; the team policy copied from `0012_id_links.sql:51-53` (`using` and `with check` on `team_id = sineobex.current_team_id() or sineobex.is_platform_scope()`); `revoke delete on sineobex.check_ins from sineobex_app`.
- The same file replaces `sineobex.patient_of_change` with the same body plus `check_in` (the patient is `value->>'patientId'`), as phase 4's 0020 and phase 7's follow-up migration do for their entities.
- `CHART_TABLES` gains `check_ins: 'group'`, so a merged chart shows both sides' check-ins (D27; `services/api/src/patients/charts.ts:24`).

### 4.2 `<n>_queue_entries.sql`
`queue_entries`. **Append-only**: `revoke update, delete`.

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid primary key | Made by the API |
| `team_id`, `patient_id` | uuid not null | Composite FK `patients (team_id, id)` |
| `action` | text not null | `pin`, `unpin`, `snooze`, `unsnooze` |
| `until_date` | date | Set exactly when `action = 'snooze'`; at most 90 days ahead (checked in the API) |
| `reason` | text | 1 to 300 characters; required for `pin` and `snooze`, null otherwise. Patient detail: never copied into audit |
| `author_user_id` | uuid not null | FK `users (id)` |
| `created_at` | timestamptz not null default `now()` | |

Index `(team_id, patient_id, created_at, id)`. Security block: the team policy as above; `revoke update, delete on sineobex.queue_entries from sineobex_app`. Listed in `CHART_TABLES` as `group`.

### 4.3 No other schema change
`patient_id_links` and `patients` are unchanged. The phone's `id_links` table gains `token_hash TEXT` and an index on it (6.4). `AuditAppend` gains one action and three optional fields (6.3). The chart answer gains `checkIns` (section 7); phase 4's `timeline` is unchanged.

## 5. Rules
### 5.1 What a scan shows

| Case | Online (the server answers) | Offline, or no answer in 3 seconds |
|---|---|---|
| The card is active for a patient of the open team | **open**: the chart of the surviving patient | **open**, if the hash is in the index or a cached chart; else **offline_unknown** |
| The card was retired (regenerated, or lost to a newer card) | **replaced**, with the day it was retired (main 296) | **replaced**, if a cached chart holds it; else **offline_unknown** |
| This phone made the card and it is still pending | **open** (the phone's own state wins; main 301) | **open** |
| This phone replaced the card and the new one is pending | **replaced** (main 301) | **replaced** |
| This phone made the card and the server refused it | **reissue** (main 306) | **reissue** |
| A well-formed token the server does not know in this team (pending on another phone, another team's card, or invented) | **not_active** (main 302) | **offline_unknown** |
| The QR code is not `{base}/c#<22 characters>` | **not_a_card**; nothing is sent, nothing is audited | the same |

Who may scan: anyone with `patients.view`. The chart that opens is the one the person's role already sees (the existing projection). "Issue a new card" appears only with `patients.edit`. A merged patient's card opens the survivor (D39).

### 5.2 Check-ins

| Action | Who | Rule |
|---|---|---|
| Create | `checkins.create` | `kind = 'medical'` also needs a credential whose `chartMedical` is true (lifecycle 1.3), because Medical is a clinical claim. The phone does not offer it otherwise; one that still arrives is held for a Program Admin (6.1) |
| Void | The author, or anyone with `patients.correct_identity` | Set once. A reason code is required. From anyone else it has no effect (6.1) |
| See | `patients.view` | With the chart |

What a check-in moves, in the same transaction, under the team lock (D32, D51):
- Create: phase 4's rule for an encounter (lifecycle 4.3), with the check-in's time: `last_seen_at` moves to `occurred_at` when that is later than the value held and not later than the server's clock. It never moves backwards. Reads already take the newest across a merged group (`team-index.ts:62-63`).
- Void: if the patient's `last_seen_at` equals this check-in's `occurred_at`, set it to `newestSeen` of: `registered_at`, the newest check-in not voided, the newest `started_at` of the encounters phase 4 counts for that row (lifecycle 4.3). Otherwise leave it. This is the only way last seen moves back (PLAN-OPEN, section 11).
- Nothing else. Not `usual_area`, not a route stop, not stock. A check-in started from a route stop also sends phase 7's `outcome` event (`seen`, through `RunActions`) as its own `route_event`, in the same local transaction on the phone.

The clock pause does not cover check-ins (D35's rule for intake): the time feeds counts, not care. A check-in made with an unverified clock is stored and flagged.

### 5.3 The queue
A patient is on the queue when `queueReasons` is not empty and the patient is not merged away.

| Reason code | Holds when | PRD |
|---|---|---|
| `pinned` | The patient's last `pin` or `unpin` entry is `pin` | main 322 |
| `flag` | The current primary flag is not the team's lowest-risk level (phase 5's `currentFlags`; rank order main 317) | main 322, 312 |
| `follow_up_overdue` | An open row of phase 7's `follow_ups` whose `followUpColumn` is `overdue` or `today` | main 319 |
| `missed_runs` | `missedRunsInRow` is 3 or more (phase 7; the plan, section 6, "Patients Not Seen") | main 369 |
| `could_not_locate` | The patient's newest `route_stops.outcome` (phase 7) is `could_not_locate` and last seen is not later than that stop's route | main 369 |

Snooze: a patient whose last `snooze` or `unsnooze` entry is a `snooze` with `until_date` after today is left off the main list and shown under "Snoozed". Sensitive flags never make a reason (only the primary flag does), so the list discloses nothing a reader may not see.

Order (`rankQueue`): primary flag rank, lowest first, none last; then pinned; then `could_not_locate`; then the remaining keys of phase 7's `rankCandidates`, in its order (best secondary rank, number of secondary flags, `missed_runs`, earliest follow-up due, oldest last seen). Flags stay the main signal (main 312).

### 5.4 The pure functions
No database or network in any of them. Each is pinned by a vector file in `packages/contract/test-vectors/` that every side named reads. TypeScript lives in `services/api/src/checkins/` and `services/api/src/queue/`; Dart in `apps/mobile/lib/checkins/`; the portal's one function in `apps/portal/src/lib/id-card.ts`.

| Vector file | Function | Input | Output | Sides |
|---|---|---|---|---|
| `scan.json` | `parseIdLink` | `raw` string (at most 2,048 characters), `baseUrl` | `{token}` or `null`. Accepts only `{baseUrl without trailing slashes}/c#` followed by exactly 22 characters of the token pattern. Never throws | Dart, portal TS |
| `scan.json` | `serverScanOutcome` | `link {id, patientId, status, retiredAt}` or `null`, `survivorId`, `mayEdit` | `{outcome: 'open', patientId, linkId}`, `{outcome: 'replaced', replacedOn, patientId or null}` (the ID only when `mayEdit`), or `{outcome: 'not_active'}` | API TS |
| `scan.json` | `localScanState` | `tokenHash`, cards `[{tokenHash, state, patientId, retiredOn}]` | `{state: 'pending_here' \| 'active' \| 'blocked_here' \| 'rejected_here' \| 'retired' \| 'unknown', patientId, retiredOn}` | Dart |
| `scan.json` | `scanDecision` | the local state, the server answer or `null` | `{show: 'open' \| 'replaced' \| 'reissue' \| 'not_active' \| 'offline_unknown', patientId, date, audit: 'server' \| 'local'}` following 5.1 | Dart |
| `check-in.json` | `checkInProblems` | `value {kind, services, place, source}`, `actor {permissions, chartMedical}` | `[]` or codes `no_permission`, `kind_not_allowed`, `services_on_medical`, `unknown_service`, `too_many_services`, `place_too_long` | API TS, Dart |
| `check-in.json` | `newestSeen` | times (ISO strings, nulls allowed) | the newest, or `null` | API TS |
| `check-in.json` | `shownLastSeen` | `indexDay` or `null`, days of this phone's waiting check-ins for the patient | the later day | Dart |
| `queue.json` | `queueState` | entries `[{action, untilDate, createdAt, id}]`, `today` | `{pinned, snoozedUntil}`; entries ordered by `createdAt`, then `id` | API TS |
| `queue.json` | `queueReasons` | `{pinned, primaryRank, lowestRank, followUpDue, missedRuns, lastOutcome, lastOutcomeOn, lastSeenOn}`, `today` | reason codes in the order of 5.3 | API TS |
| `queue.json` | `rankQueue` | rows with the keys of 5.3 | patient IDs in order | API TS |
| `queue.json` | `mayViewQueue`, `mayMaintainQueue` | a permission set | boolean (decision 10) | API TS |

## 6. Sync
### 6.1 `check_in` (create, and one `set_once` field)
Rules object `checkInRules` in `services/api/src/sync/entities/check-in.ts`, shaped as `id-link.ts`: `permission: () => 'checkins.create'`, `takesTeamLock: () => true` (as every entity since phase 4, lifecycle 4.2), parent: the patient (so a check-in for a patient made offline waits for that patient, and is held if the patient is refused). No new reject reason, and no rule here refuses: a check-in cannot be edited, so there is nothing a worker could fix and send again (D59).

Create value: `{patientId: uuid, kind, services: string[], place: string or null, source, idLinkId: uuid or null, routeId: uuid or null}`. Field `voided`, class `set_once`, value `{reason}`.

| Case | The server answers |
|---|---|
| Valid create | `accepted`, `serverVersion` 1; the row, the last-seen move and `check_in.created` in one transaction |
| The same change again | The stored receipt (the core's replay rule) |
| The value breaks the wire schema, or `checkInProblems` gives a shape code (a build fault: the phone runs the same check before it saves) | The wire schema's answer, or a stored `validation` with the code in `details.problem`, as phase 7's entities |
| No `checkins.create`; or Medical without `chartMedical` (lowered while offline; the phone offers neither) | Held for a Program Admin, as every permission failure on a push is (`services/api/src/sync/apply.ts:403-423`; lifecycle 4.2). An accepted hold carries `approvedBy` and passes. Never refused |
| `checkInProblems` or the writer throws | Caught and stored as `validation`, problem `rule_error` (lifecycle 4.1), so the queue continues |
| The patient was merged into another | `accepted`. The row keeps the ID sent; the chart reads by group (D27). Check phase 3 design 2.7 when building |
| `idLinkId` is not a link of the patient's group, or `routeId` is not a route of the team | `accepted`; that column is stored null. A check-in is never refused for its card or its route |
| `voided` set by the author or a holder of `patients.correct_identity` | `accepted`; the three columns, the last-seen rule of 5.2 and `check_in.voided` in one transaction |
| `voided` set by anyone else (the phone does not offer it) | Stored with no effect, problem `not_author`; the sender gets the notice `change_not_applied` (lifecycle 4.1, 4.10) |
| `voided` set a second time | The `set_once` answer the core gives today (phase 3 design 2.4) |

Sync read: `check_in` is served by `/v1/sync/records` to a reader with `patients.view` (lifecycle 6.4, rule 7). Nothing here stops a queue or blocks phase 7's route confirmation: a hold does not block (phase 7 design 5.3).

### 6.2 What the phone test server must mirror (`apps/mobile/test/sync/fake_server.dart`, level X)
Each is pinned to the API's answer in `fake_parity_test.dart` (D52): the create schema; no refusal for any check-in rule; the held change for a missing key or credential; the stored `validation` for a shape code; the nulling of an unknown card or route; the merged-patient acceptance; the last-seen move as "the later of"; `voided` as `set_once`, the no-effect answer and its notice for anyone else, and the last-seen rule on void; `id_link.scanned` accepted as an appended audit action with its three fields, and refused with any other field; the index read carrying `tokenHash`; the chart answer carrying `checkIns` and `tokenHash`; the resolve answers of 5.1 in the fake's online helper.

### 6.3 Offline scans in the audit chain
`AuditAppend` (`values.ts:269`) gains the action `id_link.scanned` and three optional fields, allowed only with that action: `outcome` (`open`, `replaced`, `reissue`, `offline_unknown`), `tokenRef` (12 lowercase hex), `scanSource` (`camera`). `patientId` and `entityId` (the link) are set when known. The phone writes the entry before it shows the result; if it cannot be written, nothing opens (`local_store.dart:850-852`). When the server answered the scan, the server wrote the event and the phone writes none (`scanDecision.audit`).

### 6.4 What a phone holds

| Data | How it arrives | When it leaves |
|---|---|---|
| The hash of every active card of the team's patients | The team index: each `idLinks` item gains `tokenHash` (`team-index.ts:86-89`, `schemas.ts:418`); `importIndexLinks` writes it to `id_links.token_hash` | With the index: replaced whole at each refresh; removed when the role loses the index (phase 3 design 6.3) |
| The hash of cards in a cached chart, retired ones included | `IdLinkSummary` gains `tokenHash`; `importChartLinks` writes it | With the chart (24 hours, D30) |
| The hash of cards made on this phone | Computed when the card is made | With the card's row, as today |
| The person's own check-ins | The outbox | After a hash-confirmed receipt. A copy stays only inside a cached chart, and goes with it |
| A patient's check-ins | The chart answer's `checkIns`, kept in `_chart` as phase 4's `timeline` is (`chart_cache.dart` names its keys by hand and gains this one) | With the chart (24 hours, D30) |
| Offline scan audit entries | `appendAudit` | After a hash-confirmed receipt, as every audit entry |
| The scanned token itself | Never stored. It lives in memory from the camera frame to the hash, then is dropped | |

The queue is not on the phone. A phone with no index (a role without field access) can still scan online.

## 7. API routes that only work online
All follow `docs/plan/patterns/api-route.md`. **Every route that writes a row (the void and the entries routes) calls `lockTeamWrites` as its first statement**, as every online writer does (lifecycle 5), then writes and audits in one transaction. The resolve and queue reads write only their audit event, as every read does. Every refusal is shown to a person who is online and can act on it; none reaches a phone's queue.

| Route | Permission | Request → answer | Refusals | Audit event |
|---|---|---|---|---|
| `POST /v1/id-links/resolve` | `patients.view` | `{tokenHash: 64 hex, source: 'camera' \| 'link'}` → `serverScanOutcome`'s result | 403 without the key; 422 for a malformed hash | `id_link.scanned` on every call, refusals of shape excepted (9) |
| `POST /v1/check-ins/{id}/void` | `patients.correct_identity`, or the author | `{reason}` → the check-in | 404; 409 `already_voided` | `check_in.voided` |
| `POST /v1/queue` | `mayViewQueue` | `{today, flagIds, reasons, snoozed: boolean}` → rows `{patientId, display fields from the projection, flags, reasons, lastSeenOn, followUpDue, missedRuns, pinned, snoozedUntil, onRoute}` in `rankQueue` order, at most 200, with `total` | 403 | `queue.viewed` (`patientIds`, `resultCount`) |
| `GET /v1/patients/{patientId}/queue-entries` | `mayViewQueue` | → the entries with author and time | 403, 404 | `patient.viewed` (the existing chart read's event) |
| `POST /v1/patients/{patientId}/queue-entries` | `mayMaintainQueue` | `{action, untilDate, reason}` → `queueState` after | 403; 404; 422 (`reason_required`, `until_required`, `until_too_far`); 409 `no_change` when the action would not change the state | `queue.pinned`, `queue.unpinned`, `queue.snoozed`, `queue.unsnoozed` |

Changes to existing routes: the index read and the chart read carry `tokenHash` (6.4); the chart answer gains `checkIns` (the merged group's, newest 50, voided ones included), beside phase 4's `timeline` and phase 7's `followUps` and `outreach`; phase 7's `POST /v1/routes/candidates` gains `onQueue` and `reasons` per patient and lists queue patients first, in `rankQueue` order (main 326); phase 7's report puts a patient with a check-in on the service date, not voided, in `seenElsewhere`. `GET /v1/me/counts` is unchanged. The filter body is a POST because the plan keeps criteria out of URLs.

The resolve route looks the hash up with the team policy on, by `token_hash` only. It returns the survivor through `canonical_id`. It never returns a token.

## 8. Screens
Every screen passes the accessibility checks in Day, Night run and High contrast and reflows at narrow width. Names shown in lists are the index's (preferred name, alias, descriptor), never a legal name (D40).

### 8.1 Phone (`apps/mobile/lib/features/scan/`, `apps/mobile/lib/features/checkins/`)

| Screen | Shows | States and wording |
|---|---|---|
| Start tab (phase 4's `start_sheet.dart`, lifecycle 9.2) | "Quick check-in" and "Scan ID link" under phase 4's New encounter (main 743). Quick check-in shows with `checkins.create`; Scan with `patients.view` | While the clock check fails, phase 4 stops New encounter only; these two stay (5.2) |
| Scan ID link | Live camera with a frame, a torch button, "Search by name instead", Close | Asking for the camera. Refused: "Sineobex needs the camera to scan ID cards. Turn it on in Settings." Checking: "Checking this card…" (announced to screen readers) |
| Scan result | One message and its actions; never the token | **replaced**: "This card was replaced on {date}. Issue a new card?" with "Issue a new card" (`patients.edit`; opens the ID card screen) and "Search by name" (main 296). **not_active**: "Card not active yet. Search by name." (main 302). **offline_unknown**: "This phone can’t check this card without a connection. Search by name, or try again when you’re connected." **reissue**: "This card was refused. Issue a new card." (main 306). **not_a_card**: "This isn’t a Street Medicine ID card." **open** shows no message: the chart opens, or the check-in sheet when the scan began from Quick check-in |
| Quick check-in | Step 1: "Scan ID link" or the existing patient picker (`patient_picker.dart`). Step 2: the patient row; Type: "Medical" or "Non-medical" (Medical only with `chartMedical`); "What was given" chips (Food, Water, Clothing, Hygiene items, Wellbeing check, Other), Non-medical only; "Where" (text, filled from the route stop or the usual area); button "Check in" | Saved: "Checked in." with "Open chart" and "Undo". A second check-in for the same patient within 30 minutes on this phone asks: "You checked in this person {n} minutes ago. Check in again?" Offline shows the same; the sync card counts it |
| A row in phase 4's Timeline section (lifecycle 9.1), under the Outreach filter | "Check-in · {type} · {what was given} · {where} · {who} · {time}"; voided rows struck through with "Removed: {reason}" | "Remove check-in" for the author and for `patients.correct_identity`, with the reason: "Wrong person", "Entered twice", "Other" |
| Patient row | Last seen uses `shownLastSeen`, so a check-in shows before it syncs | |

Nothing of a check-in lands in Needs attention as a refusal (6.1). A held check-in shows the existing wording for a change waiting for a Program Admin. `sync_labels.dart` gains the heading "Check-in" and one sentence for the `change_not_applied` notice on a check-in: "Only the person who logged a check-in, or an admin, can remove it. Nothing was changed."

### 8.2 Portal

| Page | Shows | States and wording |
|---|---|---|
| `/c` (public) | The same page as today for everyone. A small client script reads the fragment, hashes it, removes the fragment with `history.replaceState`, and posts the hash to a server action that keeps it in the encrypted session cookie for 10 minutes (`pendingCard`) | Signed out: only the sign-in page and its link (the Done when). Signed in: goes to `/c/open`. No fragment or a malformed one: the page as today |
| `/c/open` (signed in) | Reads and clears `pendingCard`, calls resolve, and redirects to `/patients/{id}` on **open** | **replaced**: "This card was replaced on {date}." with "Open the patient to issue a new card" when the answer carries the patient. **not_active**: "Card not active yet. Search by name." No pending card: "Scan the card again." Without `patients.view`: "Your role can’t open charts. Use Sineobex on your phone." |
| Sign-in completion | When a fresh `pendingCard` exists, sign-in ends at `/c/open` instead of the team's home | |
| Queue (`/queue`, nav with `mayViewQueue`) | The priority list in `rankQueue` order: flags, reason chips, last seen, follow-up due, the route holding the patient; filters for flag and reason; a "Snoozed" view; tick boxes and, with `routes.manage`, "Add to a route" (phase 7's `POST /v1/routes/{id}/stops`, with its refusals) | Reason chips: "Pinned", "Flag", "Follow-up overdue", "Not seen on 3 runs in a row", "Could not locate". Empty: "No one is on the priority list." A patient on an active route has no tick box |
| Pin and snooze dialog | "Add to the priority list" and "Snooze until" with a required reason | "Say why, so the team knows." |
| Chart | Check-ins as rows of phase 4's Timeline on the patient page, under Outreach; the patient's queue entries with who and why; "Remove check-in" for `patients.correct_identity` | |
| Route builder (phase 7's `Candidates.tsx`) | A first section "From the priority list", then everyone else (main 326) | |

## 9. Audit events and the PHI rules that apply

| Event | Written by | Details (IDs, codes and counts only) |
|---|---|---|
| `id_link.scanned` | The resolve route; or the phone, appended at sync | `tokenRef` (12 hex), `outcome`, `source`, `linkId`; `patientId` when a link was found. A scan of an unknown card has no patient |
| `check_in.created` | The check-in writer, in the change's transaction | `patientId`, `kind`, `serviceCount`, `source`, `idLinkId`, `routeId`, `clockVerified` |
| `check_in.voided` | The check-in writer, from a push or the void route | `patientId`, `checkInId`, `reason` code |
| `queue.viewed` | The queue route | `patientIds` (the cap of `AUDIT_MAX_PATIENTS`), `resultCount`, the filter's reason codes and flag IDs |
| `queue.pinned`, `queue.unpinned`, `queue.snoozed`, `queue.unsnoozed` | The entries route | `patientId`, `entryId`, `untilDate` |

Rules that apply here:
- The token is never written anywhere by this phase: not in a log line, an audit row, a crash report, a notice, the phone's key-value store, a navigation route, a page title or a URL. The scanner hands the raw string to `parseIdLink` and keeps only the hash. Debug printing of scanner results is forbidden; a test greps for it.
- The full hash is sent in one POST body and stored nowhere new on the server. Audit carries the 12-character reference only, as phase 3 does.
- The portal removes the fragment from the address bar and the history entry as soon as it is read. The session cookie holds the hash, encrypted, for 10 minutes, and is cleared on first use.
- `place`, `services` and a queue entry's `reason` are patient details: never in audit details, logs or notifications.
- Every scan is audited (main 295), also `replaced`, `not_active` and offline ones. `not_a_card` is not a scan of an ID link and is not audited. A resolve that cannot write its event answers nothing.
- A page opened signed out learns nothing: no team name, no patient, no hint that the card is real.
- This phase adds no Home tile and nothing to `GET /v1/me/counts` (lifecycle 5.6), so opening Home still writes no patient into the audit log. A notice (`user_notices`) holds no text.
- A check-in holds no answer of a note, so `visibleAnswers` (lifecycle 6.4) has nothing to cut. It is read with `patients.view`, as the timeline's visit rows are.

## 10. Tests
### 10.1 The Done when

| # | Step | Asserted |
|---|---|---|
| 1 | The seed holds a made-up patient with an active card. A signed-out browser opens `{base}/c#<token>` | Only the sign-in page shows. No request URL, header or body contains the token. `location.hash` is empty after load. No audit row names the patient |
| 2 | The same person signs in as staff with `patients.view` | They land on that patient's chart. One `id_link.scanned` with `outcome` `open`, the 12-character reference, `source` `link`. The session no longer holds a pending card |
| 3 | A member of another team does steps 1 and 2 | "Card not active yet. Search by name." No patient data in the page or the answer. `id_link.scanned` with `outcome` `not_active` and no patient |
| 4 | The phone, online: the fake scanner yields the card's URL | The chart opens. The request body holds only the hash and the source. The server wrote the audit event; the phone queued none |
| 5 | The phone, offline, index refreshed earlier: the same scan | The chart opens from the index hash. One audit entry waits in the outbox and joins the chain at sync |
| 6 | Staff regenerate the card; the old card is scanned online, then on a second offline phone that cached the chart | "This card was replaced on {date}. Issue a new card?" on both; no chart opens; both scans audited |
| 7 | A second phone makes a card offline; the first phone scans it online before the second syncs | "Card not active yet. Search by name." After the second phone syncs and the first refreshes, the chart opens |
| 8 | A CHW, offline, taps Quick check-in, scans, picks Non-medical and Food, taps Check in; then syncs | The row is on the server with the CHW, the time and the place; `last_seen_at` moved; the phone dropped its copy only after the hash-confirmed receipt |
| 9 | The portal queue is opened by Logistics; two patients with the same primary flag, one pinned and one marked Could not locate on a run, are listed pinned first; both are ticked into a route | `rankQueue` order; `queue.viewed`; the builder holds both |

Steps 1 to 3 and 9 are portal end-to-end tests (axe in three themes, reflow at 320 px). Steps 4 to 8 run against the fake and in `tools/live-sync.sh` against the real API.

### 10.2 The test that holds each rule (each is checked to bite: revert the rule, see it fail, restore it)

| Rule | Test |
|---|---|
| The token never leaves the scanner | Phone: a recording HTTP client and the store's tables are searched for the token after every scan outcome. Portal: the network log of steps 1 to 3. API: captured logs and all audit rows searched for the token and for the full hash |
| Another team's card answers as an unknown card | `id-links-resolve.test.ts`: the two answers are byte-equal |
| Every scan writes its event in the same transaction | The resolve test with a failing audit function: no answer |
| An offline scan that cannot be logged opens nothing | Phone test with a frozen store |
| The five outcomes | `scan.json` on each side |
| A check-in by `checkins.create` alone works offline; a Medical one without `chartMedical`, or any without the key, is held for a Program Admin and never refused | `check-in.json`; `sync-check-in.test.ts`; the phone's offline and kill-the-app test |
| A check-in only moves last seen forward, never past the server's clock; two phones in either order end the same | `sync-check-in.test.ts` with both orders |
| A void is set once and puts last seen back; a void by anyone else is accepted with no effect and a notice | The same file |
| `check_ins` rejects any other update; `queue_entries` rejects update and delete; another team reads nothing | `db/test/check-ins.test.ts` |
| The fake answers as the API | One `fake_parity_test.dart` case per row of 6.2 |
| A held check-in stays on the phone and the queue goes on; a rule that throws is a stored `validation` | Phone test: a held check-in followed by an accepted one; `sync-check-in.test.ts` with a throwing rule |
| The void route and the entries route take the team lock first | `check-ins-void.test.ts`, `queue-entries.test.ts`: each with a push held open on the lock |
| The queue's reasons and order | `queue.json`; `queue.test.ts` for the reads and the two access rules |
| No patient detail in audit details | The audit tests assert the exact key set of each event |

## 11. Defaults chosen (PLAN-OPEN) and questions for people

| Question | Default | Who decides |
|---|---|---|
| What is a check-in's location? | A short place text, filled from the stop or the usual area. No GPS: coordinates tied to a chart are PHI and no map provider is signed (main 344) | Brooke and Mercy; counsel for GPS |
| The list of "what was given" | Food, Water, Clothing, Hygiene items, Wellbeing check, Other. Harm-reduction supplies are left out because they are sensitive | Brooke and Mercy |
| May a role without `chartMedical` log a Medical check-in? | No. The phone does not offer it; one that still arrives is held for a Program Admin, as phase 4's Medical gate is, not refused (D59) | Brooke and Mercy |
| Does voiding a check-in move last seen back? Phase 4's own rule never moves it backwards (lifecycle 4.3) | Yes, and only when the voided check-in set it: a wrong check-in must not hide a patient who was not seen | Brooke and Mercy |
| Which Timeline filter shows check-ins? | Outreach | Brooke and Mercy |
| Does a check-in take stock out of a bag? | No. Dispensing stays with phase 6's rule | Brooke and Mercy |
| A free-text note on a check-in | None: it would be an unreviewed clinical note by the lowest-access role | Brooke and Mercy |
| Who is the continuity group? | `patients.view` with `routes.manage` or `encounters.chart` | Brooke and Mercy |
| Which flags put a patient on the queue? | Every primary level but the lowest-risk one | Brooke and Mercy |
| Snooze length | At most 90 days | The team |
| A card of another team the person also belongs to | Answered as unknown; the person switches team and scans again | The project lead |
| The scanner | A pinned scanner plugin that reads frames in memory, behind a `CardScanner` interface. It must never write a frame to a file (item 8 of phase 8's one page). The other choice is to extend phase 8's native camera code | The project lead |
| Carrying a scan through portal sign-in | The hash, in the encrypted session cookie, for 10 minutes. The fallback is "sign in, then scan again" | The project lead |
| The system camera opening the app from the link | Not built; the link opens the portal page | The team, with the ID link host |
| Does the clock pause cover check-ins and scans? Phase 4 stops New encounter on the Start tab while the clock check fails | No (as intake, D35): the two new choices stay usable | The team |
| Do repeat check-ins on one day count once in grant reports? | Stored as made; phase 10 counts by patient and day | Brooke and Mercy |
| Adding to the queue from the phone | Not built | The project lead |

Questions with no default: (1) counsel: may a non-clinical volunteer role hold the hashes of all the team's cards on a personal phone, or should the index leave them out for roles with only `checkins.create`? (2) Brooke and Mercy: is "Medical" on a check-in ever billed or reported as clinical contact? If yes it needs the encounter rules, not this record.

## 12. Risks, and where the design departs from the PRD or reads it a particular way
1. **The index gains card hashes, which main 271-273 does not list.** Read as required by main 267 ("QR scans" work offline). A hash cannot be turned into a card. Counsel's question 1 above.
2. **"Card not active yet" is also what an invented or another team's card gets.** The server cannot tell them apart without disclosing. The wording is true enough for all three and sends staff to search.
3. **A retired card still names its patient to staff with `patients.edit`** ("Issue a new card?", main 296). Others get the date only. A found old card therefore opens nothing for a role that cannot edit.
4. **A scan made signed out is not audited** until the person signs in: there is no actor and no team. Main 295's "every scan" is read as every scan by staff.
5. **The resolve route sends the hash, not the token** as the comment in `apps/portal/src/app/c/page.tsx` says. The comment is updated by card Q5-card-reader.
6. **The browser's history briefly holds the full link** before the page removes it; a link opened from another app may also be kept by that app. The PRD accepts that the URL passes through third-party apps (main 287); the token alone opens nothing without sign-in.
7. **A scanner plugin is new native code with no iOS build in CI** (plan risk 5). It is behind an interface, level X, and checked on a device before the pilot.
8. **A void is the one thing that moves last seen back.** Phase 4's rule only moves it forward (lifecycle 4.3). The void rule reads the same encounters phase 4 counts (accepted, naming the patient, `started_at` not later than the server's clock). If phase 4 lands a different rule, `newestSeen`'s inputs change; the function does not.
9. **`could_not_locate` and `missed_runs` depend on phase 7's tables.** The queue cards and the check-in table's `route_id` wait for it; the scan cards do not.
10. **Fake fidelity** (plan risk 7): one new entity, one new audit action and two read fields. Each has a parity case.
11. **"Medical" on a check-in is not D56's Medical.** D56 puts Medical on a note's type. A check-in is not a note: its `kind` is the PRD's type (main 308), kept for counts, and is never signed, co-signed or attested. The second question of section 11 decides whether it may stay that light.

## 13. Units and a first card list
Units: Q1 schema, rules and sync; Q2 API; Q3 phone data; Q4 phone screens; Q5 portal; Q6 the Done when and the close. The names share nothing with the units of earlier phases (F, E, L, P, I, W, U). A card's ID is its unit and a short name. Each unit with T cards has one `tests` card (level X) that writes those cards' test files and vectors first. Q1 lands first, alone, with CI green. Then Q2 and Q3 side by side, then Q4 and Q5, then Q6. Levels follow `docs/plan/README.md`: an always-X path is X; a screen, a widget or a page is R; S is kept for a card whose every mistake a machine check catches. A contract card regenerates the contract after its unit's routes or schemas. Files an earlier phase also edits, its cards first: `api/app.ts`, `api/sync/{schemas,apply}.ts`, `api/sync/entities/{values,index}.ts`, `api/routes/{sync,runs}.ts`, `api/auth/permissions.ts`, `api/patients/{team-index,charts,projection,schemas}.ts`, `api/runs/{candidates,report}.ts`, `api-test/permissions.test.ts`, `db/seed/seed.ts`, `phone/sync/{entities,local_store,local_db}.dart`, the fake, `chart_cache.dart`, `id_links.dart`, `app.dart`, `sync_labels.dart`, phase 4's `start_sheet.dart` and `timeline_section.dart`, the portal's patient page and `layout.tsx`, phase 7's `Candidates.tsx`, phase 8's two platform manifests, the generated contract. Short paths: `api/` is `services/api/src/`, `api-test/` is `services/api/test/`, `phone/` is `apps/mobile/lib/`, `phone-test/` is `apps/mobile/test/`, `vectors/` is `packages/contract/test-vectors/`, `portal/` is `apps/portal/src/app/(app)/`, `fake` is `phone-test/sync/fake_server.dart`.

| Card | Level | Files | Needs |
|---|---|---|---|
| Q1-migration-check-ins | X | `db/migrations/<n>_check_ins.sql` (trigger, policy, `patient_of_change`), `api/patients/charts.ts` (`CHART_TABLES`), `db/test/check-ins.test.ts` | phase 7's W1-migration-follow-ups |
| Q1-migration-queue | X | `<n>_queue_entries.sql`, `api/patients/charts.ts`, `db/test/queue-entries.test.ts` | Q1-migration-check-ins |
| Q1-tests | X | `vectors/{scan,check-in,queue}.json` with their TypeScript, Dart and portal readers; `api-test/patients-token-hash.test.ts`; `phone-test/patients/id_link_hash_test.dart` | Q1-migration-queue |
| Q1-scan-ts | T | `api/checkins/scan-rules.ts` (`serverScanOutcome`) | Q1-tests |
| Q1-scan-dart | T | `phone/checkins/scan_rules.dart` (`parseIdLink`, `localScanState`, `scanDecision`) | Q1-tests |
| Q1-scan-portal | T | `apps/portal/src/lib/id-card.ts` (`parseIdLink`, the hash in the browser) | Q1-tests |
| Q1-check-in-ts | T | `api/checkins/rules.ts` (`checkInProblems`, `newestSeen`) | Q1-tests |
| Q1-check-in-dart | T | `phone/checkins/rules.dart` (`checkInProblems`, `shownLastSeen`) | Q1-tests |
| Q1-queue-rules | T | `api/queue/rules.ts` (`queueState`, `queueReasons`, `rankQueue`) | Q1-tests; phase 7's W1-planning |
| Q1-queue-access | X | `api/auth/permissions.ts` (`mayViewQueue`, `mayMaintainQueue`) | Q1-tests |
| Q1-wire | X | `api/sync/schemas.ts`, `api/sync/entities/values.ts`, `api/sync/apply.ts` (`check_in`; `AuditAppend` gains `id_link.scanned`), `vectors/sync-values.json` | Q1-migration-check-ins |
| Q1-writer | X | `api/checkins/write.ts` (team lock, insert, last seen, void, audit), `api-test/check-in-writer.test.ts` | Q1-check-in-ts, Q1-wire |
| Q1-entity | X | `api/sync/entities/check-in.ts`, `api/sync/entities/index.ts`, `api-test/sync-check-in.test.ts` | Q1-writer |
| Q1-read-rule | X | `api/routes/sync.ts` (`check_in` is served with `patients.view`) | Q1-entity |
| Q1-hashes-read | T | `api/patients/team-index.ts`, `api/patients/id-links.ts`, `api/patients/schemas.ts` (`tokenHash` in the index and in a chart's links) | Q1-tests |
| Q1-phone-entities | X | `phone/sync/local_db.dart` (`id_links.token_hash`), `phone/sync/entities.dart`, `phone/sync/local_store.dart` (`appendAudit`'s three fields) | Q1-wire |
| Q1-hashes-phone | T | `phone/patients/id_links.dart`, `phone/patients/chart_cache.dart` (write the hash on import and on making a card) | Q1-hashes-read, Q1-phone-entities |
| Q1-fake-check-in | X | `fake`, `fake_parity_test.dart` (every row of 6.1, the last-seen rules) | Q1-read-rule, Q1-phone-entities |
| Q1-fake-audit | X | `fake`, `fake_parity_test.dart` (`id_link.scanned` appended; `tokenHash` in the index) | Q1-fake-check-in |
| Q1-labels | R | `phone/features/sync/sync_labels.dart` (the heading, and the sentence of 8.1 for the notice) | Q1-phone-entities |
| Q1-contract | S | The generated contract | Q1-wire, Q1-hashes-read |
| Q2-tests | X | `api-test/{id-links-resolve,check-ins-void,chart-check-ins,queue-entries,queue,routes-candidates-queue,routes-report-check-ins}.test.ts` | Q1 |
| Q2-resolve | T | `api/routes/id-links.ts`, `api/checkins/resolve.ts`, `api/app.ts` | Q2-tests, Q1-scan-ts |
| Q2-void | T | `api/routes/check-ins.ts`, `api/app.ts` (the lock first, then Q1's writer) | Q2-tests |
| Q2-chart-check-ins | T | `api/patients/projection.ts`, `api/patients/schemas.ts`, `api/checkins/chart-read.ts` (`checkIns`) | Q2-tests; phase 7's W2-chart-reads |
| Q2-queue-entries | T | `api/routes/queue.ts`, `api/queue/entries.ts`, `api/app.ts` | Q2-tests, Q1-queue-rules, Q1-queue-access |
| Q2-queue-read | T | `api/routes/queue.ts`, `api/queue/read.ts` | Q2-queue-entries; phase 5's P5; phase 7's W2 |
| Q2-candidates | T | Phase 7's `api/runs/candidates.ts`, `api/routes/runs.ts` (`onQueue`, `reasons`, queue first) | Q2-queue-read |
| Q2-report | T | Phase 7's `api/runs/report.ts` (a check-in counts in `seenElsewhere`) | Q2-tests; phase 7's W2-report |
| Q2-permissions | R | `api-test/permissions.test.ts` (a row for each route) | the route cards of Q2 |
| Q2-contract | S | The generated contract | Q2-permissions |
| Q2-seed | S | `db/seed/demo-check-ins.ts`, `db/seed/seed.ts` (demo check-ins, one pinned patient; the PHI guard checks it) | Q1-entity, Q2-queue-entries |
| Q3-tests | X | `phone-test/scan/scan_resolver_test.dart`, `phone-test/checkins/{check_in_repository,offline_actions}_test.dart` (offline, kill the app before sync, the token search) | Q2-contract |
| Q3-fake-reads | X | `fake`, `fake_reads_test.dart` (the resolve helper, `checkIns` and `tokenHash` in the chart answer) | Q2-contract, Q1-fake-audit |
| Q3-scanner | X | `apps/mobile/pubspec.yaml`, `phone/scan/card_scanner.dart` (the interface and a test double), `phone/scan/plugin_card_scanner.dart` | — |
| Q3-camera-text | R | The two platform manifests: the camera permission if phase 8 has not added it, and wording that covers cards | phase 8's U5-android, U5-ios |
| Q3-resolver | T | `phone/scan/scan_resolver.dart`, `phone/app_providers.dart` (parse, hash, local state, the online call with its timeout, the audit entry) | Q3-tests, Q3-fake-reads, Q1-scan-dart, Q1-hashes-phone |
| Q3-check-ins | T | `phone/checkins/check_in_repository.dart` (create, void, waiting days), `phone/patients/chart_cache.dart` (the `checkIns` key) | Q3-tests, Q1-check-in-dart |
| Q3-stop-check-in | T | `phone/checkins/check_in_repository.dart` (a check-in from a stop also sends phase 7's `outcome` event) | Q3-check-ins; phase 7's W3-actions |
| Q4-start | R | `phone/app.dart`, phase 4's `start_sheet.dart` | Q3-resolver; phase 4's L5-start-tab |
| Q4-scan | R | `phone/features/scan/scan_screen.dart` | Q3-scanner, Q3-resolver |
| Q4-scan-result | R | `phone/features/scan/scan_result.dart` | Q4-scan |
| Q4-pick | R | `phone/features/checkins/quick_check_in_screen.dart` | Q4-scan |
| Q4-sheet | R | `phone/features/checkins/check_in_sheet.dart` (with the repeat question) | Q3-check-ins |
| Q4-timeline-row | R | `phone/features/checkins/check_in_row.dart`, phase 4's `timeline_section.dart` | Q3-check-ins; phase 4's L5-profile-timeline |
| Q4-last-seen | R | `phone/features/patients/patient_row.dart` | Q1-check-in-dart |
| Q4-a11y | R | Three-theme, narrow-width and offline tests for the screens of Q4 | the screen cards of Q4 |
| Q5-card-reader | R | `apps/portal/src/app/c/CardReader.tsx`, `apps/portal/src/app/c/page.tsx` | Q1-scan-portal |
| Q5-pending-card | X | `apps/portal/src/lib/auth/types.ts`, `apps/portal/src/app/c/actions.ts`, the sign-in completion file | Q5-card-reader |
| Q5-card-open | R | `portal/c/open/page.tsx` | Q5-pending-card, Q2-contract |
| Q5-queue | R | `(app)/layout.tsx`, `portal/queue/page.tsx`, `actions.ts` | Q2-contract |
| Q5-entry-dialog | R | `portal/queue/EntryDialog.tsx` | Q5-queue |
| Q5-chart | R | Phase 4's `portal/patients/[patientId]/Timeline.tsx` (check-in rows, Remove check-in), `portal/patients/[patientId]/QueueEntries.tsx`, `page.tsx` | Q2-contract; phase 4's L6-patient-timeline |
| Q5-builder | R | Phase 7's `…/build/Candidates.tsx` ("From the priority list") | Q2-contract; phase 7's W5-builder-candidates |
| Q6-portal-card | X | `apps/portal/e2e/id-card.spec.ts` (steps 1 to 3; axe, three themes) | Q5-card-open |
| Q6-portal-queue | X | `apps/portal/e2e/queue.spec.ts`, `a11y.spec.ts` (step 9) | Q5 |
| Q6-phone | X | `phone-test/checkins/done_when_test.dart` (steps 4 to 8 against the fake) | Q3, Q4 |
| Q6-live | X | `phone-test/checkins/live_check_ins_test.dart`, `tools/live-sync.sh` (steps 4, 5 and 8) | Q6-phone |
| Q6-phi-pins | X | `api-test/check-ins-phi.test.ts` (logs and audit rows searched for the token and the full hash; each event's exact key set; no audit row from Home) | Q2 |
| Q6-docs | R | `docs/compliance/`, `IMPLEMENTATION_PLAN.md` (the D-table, section 6 rows), the PR description | all |

**Count: 60 cards. S 3, T 18, R 18, X 21.** By unit: Q1 21, Q2 11, Q3 7, Q4 8, Q5 7, Q6 6. No card changes more than three source files.
