> Draft plan (Nov 14), written before phase 4 was built. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 9: QR IDs, check-ins and the continuity queue

"PRD main N" is a line of the product spec's main tab; "Build plan N" a line of its Build plan tab. Paths are from the repository root. "Next free number" means the lowest unused migration number when the unit starts (phase 4 reserves 0017 to 0021; phases 5 to 8 take more). "Lifecycle" is `docs/design/phase-4/lifecycle.md`; "phase 5 design" and "phase 7 design" are the files in `docs/design/`. "The plan" is `IMPLEMENTATION_PLAN.md`.

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
| Start (+) gains Quick check-in and Scan ID link | main 743 |
| The continuity-of-care queue: a priority list from the flag criteria, maintained by the continuity group, the input to route planning | main 322, 326, 312 |
| "Could not locate" outcomes raise a patient on the queue | main 369 |

| Out | Who takes it | PRD |
|---|---|---|
| Making the QR image or the printed card | The team's own tool, always | main 281-284 |
| Issuing, copying and regenerating a link, the offline handshake | Built in phase 3 (D31, D39) | main 289-306 |
| Grant report counts from check-ins | Phase 10. This phase stores the rows it counts | main 308; Build plan 120 |
| Taking stock out of a bag at a check-in | Not built. Phase 6 dispenses with `encounters.chart` (phase 6 design, line 340). PLAN-OPEN, section 11 | main 308 |
| GPS coordinates on a check-in; maps | After the MVP list; needs a map provider under a BAA | main 344-356 |
| The link opening the app itself from the phone's camera (app links) | After the pilot host is fixed (the plan, section 6, "The ID link host"). PLAN-OPEN | main 285 |
| The queue on the phone; building a route on the phone | Not in the Build plan. Clinicians feed the queue from the phone through flags (phase 5) and follow-up dates (phase 7) | Build plan 115 |
| Brief call note, New encounter in the Start sheet | Phase 4 | main 743 |
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

What earlier phases must have delivered first:

| Phase | Thing | Used by |
|---|---|---|
| 4 | The Start (+) sheet and the chart timeline on the phone and the portal; `encounters.started_at` as an accepted encounter's time; the rule that an accepted encounter moves `last_seen_at` (lifecycle, line 72) | 8.1, 8.2; the void rule in 5.2 |
| 5 | `patient_flag_changes`, `team_presets` rows of kind `flag`, and `currentFlags` (phase 5 design 4.5, 5.3) | The queue's flag reason and order |
| 7 | `routes`, `route_stops` and their outcomes, `follow_ups`, `missedRunsInRow`, `rankCandidates`, the candidates route and the route builder page, `seenElsewhere` in the report (phase 7 design 4, 5.3, 7, 8.2) | The queue's other reasons; "Add to a route"; a check-in from a stop |
| 8 | The `CAMERA` permission and its usage text in the Android manifest and `Info.plist` (phase 8 design, line 330) | The scanner. If phase 8 is not built, card 3.01 adds them |

If phase 5 or 7 is missing when this phase starts, units 1 to 4 and the portal's card page (the Done when) can still be built; unit 5's queue cards wait.

## 3. The design in one page
1. **Only the token's hash ever leaves the scanner.** The phone and the browser hash the token in memory and send or look up the hash. The plaintext never reaches a request, a log, a table of scans or a URL our code makes. Reason: the server already looks links up by hash only (D31), so the plaintext is never needed.
2. **One online route answers a scan: `POST /v1/id-links/resolve`, inside the open team only.** A card of another team answers exactly as a card that never existed. Reason: a card must not reveal that a person is known to some other team.
3. **Offline scans work from hashes in the team index.** Each index entry's active links gain `tokenHash`. Reason: main 267 says offline search covers QR scans; a hash of 128 random bits cannot be turned back into a card, so a lost phone still cannot print one (D40 is about legal names and is untouched).
4. **What a scan shows is decided by small pure functions** (`parseIdLink`, `localScanState`, `scanDecision`, `serverScanOutcome`), pinned by one vector file. Reason: the five outcomes and their wording are the judgment; the screens only show the result.
5. **A check-in is one immutable, create-only record** with the smallest content that meets main 308: patient, type, what was given (a fixed list), place (short text), source. Who, when and which device come from the change envelope. No free text beyond the place, no clinical field. Reason: it is made offline by the roles with the least access.
6. **A check-in moves one thing: `last_seen_at`, to the later of its own time and the stored value.** It never touches a patient field that has versions. Reason: "the later of" is a sum-like rule, so two phones offline cannot conflict.
7. **A wrong check-in is voided, never edited or deleted:** one set-once field. Reason: nothing is deleted, and both entries stay in the audit log (the rule main 239 sets for problems).
8. **The queue is worked out when read, never stored.** Its reasons come from data other phases already hold (flags, overdue follow-ups, missed runs, could not locate). Reason: lifecycle 3.9's rule and phase 7 decision 10; nothing to keep in step.
9. **The continuity group's own hand is an append-only list of pin and snooze entries,** made online in the portal. Reason: main 322 says the group "maintains" the list; append-only keeps who and why.
10. **No new permission keys (D37).** Scan: `patients.view`. Check-in: `checkins.create`. See the queue: `patients.view` and `routes.view`. Maintain it: `patients.view` and one of `routes.manage`, `encounters.chart`.

## 4. Data model
Two migrations, each the next free number, additive, one transaction. Both are level X (policies and a trigger).

### 4.1 `<n>_check_ins.sql`
`check_ins`. Append-only except the three void columns, which are set once together.

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid primary key | Made on the phone |
| `team_id` | uuid not null | FK `teams (id)` |
| `patient_id` | uuid not null | Composite FK `patients (team_id, id)` |
| `kind` | text not null | `medical` or `non_medical` (main 308) |
| `services` | text[] not null default `'{}'` | Subset of `food`, `water`, `clothing`, `hygiene`, `wellbeing`, `other`; at most 6; no repeats; empty when `kind = 'medical'` (check constraint) |
| `place` | text | Null, or 1 to 200 characters after trim (as `usual_area`, `0009_patients.sql:53`) |
| `source` | text not null | `scan`, `search` or `route`: how the patient was found |
| `id_link_id` | uuid | The card scanned, when `source = 'scan'` and the server knows it for this patient's group; else null. No FK (a pending card may arrive later) |
| `route_id` | uuid | The route whose stop this was; FK to phase 7's `routes`; null when the route is unknown |
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
- The same file replaces `sineobex.patient_of_change` with the same body plus `check_in` (the patient is `value->>'patientId'`), as phase 4's 0020 does for its entities.
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
`patient_id_links` and `patients` are unchanged. The phone's `id_links` table gains `token_hash TEXT` and an index on it (6.4). `AuditAppend` gains one action and three optional fields (6.3).

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
| Create | `checkins.create` | `kind = 'medical'` also needs a credential whose `chartMedical` is true (`permissions.ts:98-99`), because Medical is a clinical claim. Otherwise `permission_denied` |
| Void | The author, or anyone with `patients.correct_identity` | Set once. A reason code is required |
| See | `patients.view` | With the chart |

What a check-in moves, in the same transaction, under the team lock (D32, D51):
- Create: `update patients set last_seen_at = greatest(coalesce(last_seen_at, occurred_at), occurred_at)` on the row the check-in names. Reads already take the newest across a merged group (`team-index.ts:62-63`).
- Void: if the patient's `last_seen_at` equals this check-in's `occurred_at`, set it to `newestSeen` of: `registered_at`, the newest check-in not voided, the newest accepted encounter's `started_at` (phase 4). Otherwise leave it.
- Nothing else. Not `usual_area`, not a route stop, not stock. A check-in started from a route stop also records phase 7's `seen` outcome as its own `route_event`, in the same local transaction on the phone.

The clock pause does not cover check-ins (D35's rule for intake): the time feeds counts, not care. A check-in made with an unverified clock is stored and flagged.

### 5.3 The queue
A patient is on the queue when `queueReasons` is not empty and the patient is not merged away.

| Reason code | Holds when | PRD |
|---|---|---|
| `pinned` | The patient's last `pin` or `unpin` entry is `pin` | main 322 |
| `flag` | The current primary flag is not the team's lowest-risk level (phase 5's `currentFlags`; rank order main 317) | main 322, 312 |
| `follow_up_overdue` | An open follow-up is due today or earlier (phase 7's `follow_ups`) | main 319 |
| `missed_runs` | `missedRunsInRow` is 3 or more (phase 7; the plan, section 6, "Patients Not Seen") | main 369 |
| `could_not_locate` | The newest stop outcome for the patient is `could_not_locate` and nothing has seen them since | main 369 |

Snooze: a patient whose last `snooze` or `unsnooze` entry is a `snooze` with `until_date` after today is left off the main list and shown under "Snoozed". Sensitive flags never make a reason (only the primary flag does), so the list discloses nothing a reader may not see.

Order (`rankQueue`): primary flag rank, lowest first, none last; then pinned; then `could_not_locate`; then phase 7's remaining keys in its order (best secondary rank, number of secondary flags, `missed_runs`, earliest follow-up due, oldest last seen). Flags stay the main signal (main 312).

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
Rules object `checkInRules` in `services/api/src/sync/entities/check-in.ts`, shaped as `id-link.ts`: `permission: () => 'checkins.create'`, `takesTeamLock: () => true`, parent: the patient (so a check-in for a patient made offline waits for that patient, and is held if the patient is refused).

Create value: `{patientId: uuid, kind, services: string[], place: string or null, source, idLinkId: uuid or null, routeId: uuid or null}`. Field `voided`, class `set_once`, value `{reason}`.

| Case | The server answers |
|---|---|
| Valid create | `accepted`, `serverVersion` 1; the row, the last-seen move and `check_in.created` in one transaction |
| The same change again | The stored receipt (the core's replay rule) |
| The value fails the schema, or `checkInProblems` gives a shape code | `rejected`, `validation`, with the code in `details.problem` |
| No `checkins.create`; or Medical without `chartMedical` | `rejected`, `permission_denied`, `details.problem` `no_permission` or `kind_not_allowed` |
| The patient was merged into another | `accepted`. The row keeps the ID sent; the chart reads by group (D27). Check phase 3 design 2.7 when building |
| `idLinkId` is not a link of the patient's group, or `routeId` is not a route of the team | `accepted`; that column is stored null. A check-in is never refused for its card or its route |
| `voided` set by the author or a holder of `patients.correct_identity` | `accepted`; the three columns, the last-seen rule of 5.2 and `check_in.voided` in one transaction |
| `voided` set by anyone else | `rejected`, `permission_denied` |
| `voided` set a second time | The `set_once` answer the core gives today (phase 3 design 2.4) |

No rejection here stops the queue, and each lands in Needs attention with the fix the worker has: change the type, or ask an admin (D42).

### 6.2 What the phone test server must mirror (`apps/mobile/test/sync/fake_server.dart`, level X)
Each is pinned to the API's answer in `fake_parity_test.dart` (D52): the create schema; `checkInProblems` with both rejection kinds and their `details.problem`; the nulling of an unknown card or route; the merged-patient acceptance; the last-seen move as "the later of"; `voided` as `set_once` with its permission rule and the last-seen rule on void; `id_link.scanned` accepted as an appended audit action with its three fields, and refused with any other field; the index read carrying `tokenHash`; the resolve answers of 5.1 in the fake's online helper.

### 6.3 Offline scans in the audit chain
`AuditAppend` (`values.ts:269`) gains the action `id_link.scanned` and three optional fields, allowed only with that action: `outcome` (`open`, `replaced`, `reissue`, `offline_unknown`), `tokenRef` (12 lowercase hex), `scanSource` (`camera`). `patientId` and `entityId` (the link) are set when known. The phone writes the entry before it shows the result; if it cannot be written, nothing opens (`local_store.dart:850-852`). When the server answered the scan, the server wrote the event and the phone writes none (`scanDecision.audit`).

### 6.4 What a phone holds

| Data | How it arrives | When it leaves |
|---|---|---|
| The hash of every active card of the team's patients | The team index: each `idLinks` item gains `tokenHash` (`team-index.ts:86-89`, `schemas.ts:418`); `importIndexLinks` writes it to `id_links.token_hash` | With the index: replaced whole at each refresh; removed when the role loses the index (phase 3 design 6.3) |
| The hash of cards in a cached chart, retired ones included | `IdLinkSummary` gains `tokenHash`; `importChartLinks` writes it | With the chart (24 hours, D30) |
| The hash of cards made on this phone | Computed when the card is made | With the card's row, as today |
| The person's own check-ins | The outbox | After a hash-confirmed receipt. A copy stays only inside a cached chart, and goes with it |
| Other people's check-ins for a patient | With the chart, through `/v1/sync/records` (D30) | With the chart |
| Offline scan audit entries | `appendAudit` | After a hash-confirmed receipt, as every audit entry |
| The scanned token itself | Never stored. It lives in memory from the camera frame to the hash, then is dropped | |

The queue is not on the phone. A phone with no index (a role without field access) can still scan online.

## 7. API routes that only work online

| Route | Permission | Request → answer | Refusals | Audit event |
|---|---|---|---|---|
| `POST /v1/id-links/resolve` | `patients.view` | `{tokenHash: 64 hex, source: 'camera' \| 'link'}` → `serverScanOutcome`'s result | 403 without the key; 422 for a malformed hash | `id_link.scanned` on every call, refusals of shape excepted (9) |
| `POST /v1/check-ins/{id}/void` | `patients.correct_identity`, or the author | `{reason}` → the check-in | 404; 409 `already_voided` | `check_in.voided` |
| `POST /v1/queue` | `mayViewQueue` | `{today, flagIds, reasons, snoozed: boolean}` → rows `{patientId, display fields from the projection, flags, reasons, lastSeenOn, followUpDue, missedRuns, pinned, snoozedUntil, onRoute}` in `rankQueue` order, at most 200, with `total` | 403 | `queue.viewed` (`patientIds`, `resultCount`) |
| `GET /v1/patients/{patientId}/queue-entries` | `mayViewQueue` | → the entries with author and time | 403, 404 | `patient.viewed` (the existing chart read's event) |
| `POST /v1/patients/{patientId}/queue-entries` | `mayMaintainQueue` | `{action, untilDate, reason}` → `queueState` after | 403; 404; 422 (`reason_required`, `until_required`, `until_too_far`); 409 `no_change` when the action would not change the state | `queue.pinned`, `queue.unpinned`, `queue.snoozed`, `queue.unsnoozed` |

Changes to existing routes: the index read and the chart read carry `tokenHash` (6.4); the chart read carries check-ins in its timeline; phase 7's candidates route gains `onQueue` and `reasons` per patient and lists queue patients first, in `rankQueue` order (main 326); phase 7's report counts a check-in that day as `seenElsewhere`. The filter body is a POST because the plan keeps criteria out of URLs.

The resolve route looks the hash up with the team policy on, by `token_hash` only. It returns the survivor through `canonical_id`. It never returns a token.

## 8. Screens
Every screen passes the accessibility checks in Day, Night run and High contrast and reflows at narrow width. Names shown in lists are the index's (preferred name, alias, descriptor), never a legal name (D40).

### 8.1 Phone (`apps/mobile/lib/features/scan/`, `apps/mobile/lib/features/checkins/`)

| Screen | Shows | States and wording |
|---|---|---|
| Start sheet | "Quick check-in" and "Scan ID link" beside phase 4's entries (main 743). Quick check-in shows with `checkins.create`; Scan with `patients.view` | |
| Scan ID link | Live camera with a frame, a torch button, "Search by name instead", Close | Asking for the camera. Refused: "Sineobex needs the camera to scan ID cards. Turn it on in Settings." Checking: "Checking this card…" (announced to screen readers) |
| Scan result | One message and its actions; never the token | **replaced**: "This card was replaced on {date}. Issue a new card?" with "Issue a new card" (`patients.edit`; opens the ID card screen) and "Search by name" (main 296). **not_active**: "Card not active yet. Search by name." (main 302). **offline_unknown**: "This phone can’t check this card without a connection. Search by name, or try again when you’re connected." **reissue**: "This card was refused. Issue a new card." (main 306). **not_a_card**: "This isn’t a Street Medicine ID card." **open** shows no message: the chart opens, or the check-in sheet when the scan began from Quick check-in |
| Quick check-in | Step 1: "Scan ID link" or the existing patient picker (`patient_picker.dart`). Step 2: the patient row; Type: "Medical" or "Non-medical" (Medical only with `chartMedical`); "What was given" chips (Food, Water, Clothing, Hygiene items, Wellbeing check, Other), Non-medical only; "Where" (text, filled from the route stop or the usual area); button "Check in" | Saved: "Checked in." with "Open chart" and "Undo". A second check-in for the same patient within 30 minutes on this phone asks: "You checked in this person {n} minutes ago. Check in again?" Offline shows the same; the sync card counts it |
| Chart timeline row | "Check-in · {type} · {what was given} · {where} · {who} · {time}"; voided rows struck through with "Removed: {reason}" | "Remove check-in" for the author and for `patients.correct_identity`, with the reason: "Wrong person", "Entered twice", "Other" |
| Patient row | Last seen uses `shownLastSeen`, so a check-in shows before it syncs | |

Needs attention wording for a refused check-in (`sync_labels.dart`): `kind_not_allowed` "Your role can’t log a Medical check-in. Change it to Non-medical."; `no_permission` "Your role can’t log check-ins. Ask an admin."

### 8.2 Portal

| Page | Shows | States and wording |
|---|---|---|
| `/c` (public) | The same page as today for everyone. A small client script reads the fragment, hashes it, removes the fragment with `history.replaceState`, and posts the hash to a server action that keeps it in the encrypted session cookie for 10 minutes (`pendingCard`) | Signed out: only the sign-in page and its link (the Done when). Signed in: goes to `/c/open`. No fragment or a malformed one: the page as today |
| `/c/open` (signed in) | Reads and clears `pendingCard`, calls resolve, and redirects to `/patients/{id}` on **open** | **replaced**: "This card was replaced on {date}." with "Open the patient to issue a new card" when the answer carries the patient. **not_active**: "Card not active yet. Search by name." No pending card: "Scan the card again." Without `patients.view`: "Your role can’t open charts. Use Sineobex on your phone." |
| Sign-in completion | When a fresh `pendingCard` exists, sign-in ends at `/c/open` instead of the team's home | |
| Queue (`/queue`, nav with `mayViewQueue`) | The priority list in `rankQueue` order: flags, reason chips, last seen, follow-up due, the route holding the patient; filters for flag and reason; a "Snoozed" view; tick boxes and "Add to a route" (phase 7's builder) | Reason chips: "Pinned", "Flag", "Follow-up overdue", "Not seen on 3 runs in a row", "Could not locate". Empty: "No one is on the priority list." A patient on an active route has no tick box |
| Pin and snooze dialog | "Add to the priority list" and "Snooze until" with a required reason | "Say why, so the team knows." |
| Chart | Check-ins in the timeline; the patient's queue entries with who and why; "Remove check-in" for `patients.correct_identity` | |
| Route builder (phase 7) | A first section "From the priority list", then everyone else (main 326) | |

## 9. Audit events and the PHI rules that apply

| Event | Written by | Details (IDs, codes and counts only) |
|---|---|---|
| `id_link.scanned` | The resolve route; or the phone, appended at sync | `tokenRef` (12 hex), `outcome`, `source`, `linkId`; `patientId` when a link was found. A scan of an unknown card has no patient |
| `check_in.created` | The sync apply | `patientId`, `kind`, `serviceCount`, `source`, `idLinkId`, `routeId`, `clockVerified` |
| `check_in.voided` | The sync apply or the void route | `patientId`, `checkInId`, `reason` code |
| `queue.viewed` | The queue route | `patientIds` (the cap of `AUDIT_MAX_PATIENTS`), `resultCount`, the filter's reason codes and flag IDs |
| `queue.pinned`, `queue.unpinned`, `queue.snoozed`, `queue.unsnoozed` | The entries route | `patientId`, `entryId`, `untilDate` |

Rules that apply here:
- The token is never written anywhere by this phase: not in a log line, an audit row, a crash report, a notice, the phone's key-value store, a navigation route, a page title or a URL. The scanner hands the raw string to `parseIdLink` and keeps only the hash. Debug printing of scanner results is forbidden; a test greps for it.
- The full hash is sent in one POST body and stored nowhere new on the server. Audit carries the 12-character reference only, as phase 3 does.
- The portal removes the fragment from the address bar and the history entry as soon as it is read. The session cookie holds the hash, encrypted, for 10 minutes, and is cleared on first use.
- `place`, `services` and a queue entry's `reason` are patient details: never in audit details, logs or notifications.
- Every scan is audited (main 295), also `replaced`, `not_active` and offline ones. `not_a_card` is not a scan of an ID link and is not audited. A resolve that cannot write its event answers nothing.
- A page opened signed out learns nothing: no team name, no patient, no hint that the card is real.

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
| A check-in by `checkins.create` alone works offline; Medical needs `chartMedical` | `check-in.json`; `sync-check-in.test.ts`; the phone's offline and kill-the-app test |
| Last seen only moves forward; two phones in either order end the same | `sync-check-in.test.ts` with both orders |
| A void is set once, by the right people, and puts last seen back | The same file |
| `check_ins` rejects any other update; `queue_entries` rejects update and delete; another team reads nothing | `db/test/check-ins.test.ts` |
| The fake answers as the API | One `fake_parity_test.dart` case per row of 6.2 |
| A refused check-in stays on the phone and the queue goes on | Phone test: a refused check-in followed by an accepted one |
| The queue's reasons and order | `queue.json`; `queue.test.ts` for the reads and the two access rules |
| No patient detail in audit details | The audit tests assert the exact key set of each event |

## 11. Defaults chosen (PLAN-OPEN) and questions for people

| Question | Default | Who decides |
|---|---|---|
| What is a check-in's location? | A short place text, filled from the stop or the usual area. No GPS: coordinates tied to a chart are PHI and no map provider is signed (main 344) | Brooke and Mercy; counsel for GPS |
| The list of "what was given" | Food, Water, Clothing, Hygiene items, Wellbeing check, Other. Harm-reduction supplies are left out because they are sensitive | Brooke and Mercy |
| May a role without `chartMedical` log a Medical check-in? | No | Brooke and Mercy |
| Does a check-in take stock out of a bag? | No. Dispensing stays with phase 6's rule | Brooke and Mercy |
| A free-text note on a check-in | None: it would be an unreviewed clinical note by the lowest-access role | Brooke and Mercy |
| Who is the continuity group? | `patients.view` with `routes.manage` or `encounters.chart` | Brooke and Mercy |
| Which flags put a patient on the queue? | Every primary level but the lowest-risk one | Brooke and Mercy |
| Snooze length | At most 90 days | The team |
| A card of another team the person also belongs to | Answered as unknown; the person switches team and scans again | The project lead |
| The scanner | A pinned scanner plugin that reads frames in memory, behind a `CardScanner` interface. The other choice is to extend phase 8's native camera code | The project lead |
| Carrying a scan through portal sign-in | The hash, in the encrypted session cookie, for 10 minutes. The fallback is "sign in, then scan again" | The project lead |
| The system camera opening the app from the link | Not built; the link opens the portal page | The team, with the ID link host |
| Does the clock pause cover check-ins? | No (as intake, D35) | The team |
| Do repeat check-ins on one day count once in grant reports? | Stored as made; phase 10 counts by patient and day | Brooke and Mercy |
| Adding to the queue from the phone | Not built | The project lead |

Questions with no default: (1) counsel: may a non-clinical volunteer role hold the hashes of all the team's cards on a personal phone, or should the index leave them out for roles with only `checkins.create`? (2) Brooke and Mercy: is "Medical" on a check-in ever billed or reported as clinical contact? If yes it needs the encounter rules, not this record.

## 12. Risks, and where the design departs from the PRD or reads it a particular way
1. **The index gains card hashes, which main 271-273 does not list.** Read as required by main 267 ("QR scans" work offline). A hash cannot be turned into a card. Counsel's question 1 above.
2. **"Card not active yet" is also what an invented or another team's card gets.** The server cannot tell them apart without disclosing. The wording is true enough for all three and sends staff to search.
3. **A retired card still names its patient to staff with `patients.edit`** ("Issue a new card?", main 296). Others get the date only. A found old card therefore opens nothing for a role that cannot edit.
4. **A scan made signed out is not audited** until the person signs in: there is no actor and no team. Main 295's "every scan" is read as every scan by staff.
5. **The resolve route sends the hash, not the token** as the comment in `apps/portal/src/app/c/page.tsx` says. The comment is updated by card 5.01.
6. **The browser's history briefly holds the full link** before the page removes it; a link opened from another app may also be kept by that app. The PRD accepts that the URL passes through third-party apps (main 287); the token alone opens nothing without sign-in.
7. **A scanner plugin is new native code with no iOS build in CI** (plan risk 5). It is behind an interface, level X, and checked on a device before the pilot.
8. **The void rule reads phase 4's encounters.** If phase 4 lands a different "seen" rule, `newestSeen`'s inputs change; the function does not.
9. **`could_not_locate` and `missed_runs` depend on phase 7's tables.** The queue cards wait for it; nothing else does.
10. **Fake fidelity** (plan risk 7): one new entity, one new audit action and one read field. Each has a parity case.

## 13. Units and a first card list
Unit 1 lands first, alone, with CI green. Then units 2 and 3 side by side, then 4 and 5, then 6. Each line: title, level, files, needs. A route or schema card regenerates the contract in the same commit. The vector files and the tests for T cards are written first by the planner.

**Unit 1. Schema, rules and sync** (owns `db/migrations/`, the rule files, `services/api/src/sync/`, `apps/mobile/lib/sync/`, `services/api/src/auth/`, the fake)
- 1.01 Migration: `check_ins`, its trigger and policy, `patient_of_change`. X. `<n>_check_ins.sql`, `db/test/check-ins.test.ts`. Needs phase 7's `routes`.
- 1.02 Migration: `queue_entries`. X. `<n>_queue_entries.sql`. Needs nothing.
- 1.03 The three vector files and a reader test on each side. X. `packages/contract/test-vectors/scan.json`, `check-in.json`, `queue.json`. Needs nothing.
- 1.04 `serverScanOutcome` in TypeScript. T. `services/api/src/checkins/scan-rules.ts`. Needs 1.03.
- 1.05 `parseIdLink`, `localScanState`, `scanDecision` in Dart. T. `apps/mobile/lib/checkins/scan_rules.dart`. Needs 1.03.
- 1.06 `checkInProblems`, `newestSeen` in TypeScript. T. `services/api/src/checkins/rules.ts`. Needs 1.03.
- 1.07 `checkInProblems`, `shownLastSeen` in Dart. T. `apps/mobile/lib/checkins/rules.dart`. Needs 1.03.
- 1.08 `queueState`, `queueReasons`, `rankQueue`. T. `services/api/src/queue/rules.ts`. Needs 1.03.
- 1.09 `mayViewQueue`, `mayMaintainQueue`. X. `services/api/src/auth/permissions.ts`. Needs 1.03.
- 1.10 Wire schema and `sync-values.json` cases for `check_in`; `AuditAppend` gains `id_link.scanned`. X. `sync/entities/values.ts`, `sync/schemas.ts`, `sync/apply.ts`. Needs 1.01.
- 1.11 The check-in writer: insert, last-seen move, void, audit. X. `services/api/src/checkins/write.ts`. Needs 1.06, 1.10.
- 1.12 `checkInRules`. X. `sync/entities/check-in.ts`, `sync/entities/index.ts`. Needs 1.11.
- 1.13 `tokenHash` in the index and chart reads; `check_ins` and `queue_entries` in `CHART_TABLES`. T. `patients/team-index.ts`, `patients/schemas.ts`, `patients/charts.ts`. Needs 1.01.
- 1.14 Phone: `id_links.token_hash`, the registry entry for `check_in`, `appendAudit`'s three fields. X. `apps/mobile/lib/sync/local_db.dart`, `entities.dart`, `local_store.dart`. Needs 1.10.
- 1.15 Phone: write the hash on import and on making a card. T. `apps/mobile/lib/patients/id_links.dart`. Needs 1.13, 1.14.
- 1.16 Fake server: `check_in`, the void, the audit action, the index hash, the resolve helper, with parity tests. X. `fake_server.dart`, `fake_parity_test.dart`, `fake_reads_test.dart`. Needs 1.12, 1.14.
- 1.17 Headings and rejection wording for `check_in`. R. `apps/mobile/lib/features/sync/sync_labels.dart`. Needs 1.14.

**Unit 2. API** (owns `services/api/src/routes/id-links.ts`, `routes/check-ins.ts`, `routes/queue.ts`, the rest of `services/api/src/checkins/` and `queue/`, the seed)
- 2.01 `POST /v1/id-links/resolve`, tests first. T. `routes/id-links.ts`, `checkins/resolve.ts`. Needs 1.04.
- 2.02 `POST /v1/check-ins/{id}/void`. T. `routes/check-ins.ts`. Needs 1.11.
- 2.03 Check-ins in the chart timeline read. T. `patients/projection.ts`, `patients/schemas.ts`. Needs 1.13.
- 2.04 Queue entries: read and write. T. `routes/queue.ts`, `queue/entries.ts`. Needs 1.02, 1.08, 1.09.
- 2.05 The queue read. T. `routes/queue.ts`, `queue/read.ts`. Needs 2.04, phases 5 and 7.
- 2.06 Candidates route: `onQueue`, `reasons`, queue first. T. `services/api/src/runs/candidates.ts`. Needs 2.05.
- 2.07 Report: a check-in counts as seen elsewhere. T. `services/api/src/runs/report.ts`. Needs 1.01.
- 2.08 Demo check-ins and one pinned patient in the seed. S. The seed script and its data module. Needs 1.12, 2.04.

**Unit 3. Phone data** (owns `apps/mobile/lib/checkins/` except the rule files, `apps/mobile/lib/scan/`)
- 3.01 The scanner plugin, the `CardScanner` interface and a fake for tests; camera permission text if phase 8 has not added it. X. `pubspec.yaml`, `lib/scan/card_scanner.dart`, the two platform manifests. Needs nothing.
- 3.02 `ScanResolver`: parse, hash, local state, the online call with its timeout, the audit entry. T. `lib/scan/scan_resolver.dart`, `app_providers.dart`. Needs 1.05, 1.15, 2.01.
- 3.03 `CheckInRepository`: create, void, waiting days. T. `lib/checkins/check_in_repository.dart`. Needs 1.07, 1.14.
- 3.04 Check-in from a stop also records the `seen` outcome. T. `lib/checkins/check_in_repository.dart`. Needs 3.03, phase 7's `RunActions`.
- 3.05 Offline and kill-the-app tests for scan and check-in; the token search. T. Tests only. Needs 3.02, 3.03.

**Unit 4. Phone screens** (owns `apps/mobile/lib/features/scan/`, `features/checkins/`)
- 4.01 Start sheet entries and routes. R. `app.dart`, phase 4's start sheet file. Needs 3.02.
- 4.02 Scan screen. R. `features/scan/scan_screen.dart`. Needs 3.01, 3.02.
- 4.03 Scan result messages. R. `features/scan/scan_result.dart`. Needs 4.02.
- 4.04 Quick check-in: pick the patient. R. `features/checkins/quick_check_in_screen.dart`. Needs 4.02.
- 4.05 Quick check-in: the sheet and the repeat question. R. `features/checkins/check_in_sheet.dart`. Needs 3.03.
- 4.06 Timeline row and Remove check-in. R. `features/checkins/check_in_row.dart`, phase 4's timeline file. Needs 3.03.
- 4.07 Last seen on the patient row. S. `features/patients/patient_row.dart`. Needs 1.07.

**Unit 5. Portal** (owns `apps/portal/src/app/c/`, `(app)/queue/`, `src/lib/id-card.ts`)
- 5.01 `parseIdLink` and the hash in the browser; the client script on `/c`. T. `src/lib/id-card.ts`, `app/c/CardReader.tsx`, `app/c/page.tsx`. Needs 1.03.
- 5.02 `pendingCard` in the session, its server action, and sign-in ending at `/c/open`. X. `src/lib/auth/types.ts`, `app/c/actions.ts`, the sign-in completion file. Needs 5.01.
- 5.03 `/c/open`. R. `app/(app)/c/open/page.tsx`. Needs 5.02, 2.01.
- 5.04 Queue page. R. `app/(app)/queue/page.tsx`, its actions file. Needs 2.05.
- 5.05 Pin and snooze dialog. R. `app/(app)/queue/EntryDialog.tsx`. Needs 2.04.
- 5.06 Chart: check-ins, queue entries, Remove check-in. R. `app/(app)/patients/[patientId]/` (two files). Needs 2.02, 2.03.
- 5.07 Route builder: "From the priority list". R. Phase 7's builder page. Needs 2.06.

**Unit 6. The Done when and the close**
- 6.01 Portal end-to-end: steps 1 to 3. T. `apps/portal/e2e/id-card.spec.ts`. Needs 5.03.
- 6.02 Portal end-to-end: step 9. T. `apps/portal/e2e/queue.spec.ts`. Needs 5.04, 5.07.
- 6.03 Phone: steps 4 to 8 against the fake. T. Tests only. Needs unit 4.
- 6.04 Steps 4, 5 and 8 in the live job. X. `tools/live-sync.sh` and its Dart driver. Needs 6.03.
- 6.05 Compliance mapping and the plan's D-table and section 6 rows. S. `docs/compliance/`, `IMPLEMENTATION_PLAN.md`. Needs everything.

Cards by level: S 3, T 22, R 12, X 12. Total 49.
