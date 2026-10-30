# Phase 3 (Patients): the design the implementation team follows

Basis: branch `claude/modest-feynman-1bz6ws` at `7a39dc3` (phases 0–2 green), the PRD text, and three independent designs (data and sync, privacy and compliance, field workflow and accessibility). This document replaces all three. Where they disagreed, section 0.2 records the choice and why; the sections after it state only the decision. Every "today" claim cites the file it was read from. Nothing here changes code; the units in section 15 do.

Revised after an adversarial review (24 findings, each checked against the code and the PRD) and five decisions by the project lead (D37–D41). Section 0.4 lists what changed; section 17 lists the findings not taken and why.

Done when (Build plan): **a made-up patient is found offline by a misspelled alias, edited, and flagged as a likely duplicate at intake.** Section 13.1 is that test, step by step, against the in-memory server and the real API.

---


> **Project lead amendment (Oct 22), overriding the text below.** "Keep for today" pins are **cut from phase 3**: the PRD doesn't ask for them, and the route cache they stand in for arrives in phase 7 (plan risk 8: cut from the edges). Wherever this design mentions them: `cache_scopes.kind` is `'opened'` or `'route'` (phase 7) only; `FetchCharts.reason` is `'opened' | 'refresh'`; there is no pin action, limit, audit event, UI or test for pins; D30 reads "charts a person opened or worked on". Constant 23 in 14.1 is removed. Everything else stands.

## Status (Oct 30), and how to pick the work up

Read `CLAUDE.md` at the repository root first: environment, commands, the CI lock, conventions.
Then this section, then the design sections the next unit needs. Units are defined in section 15;
this table is their state. Update it as units land.

| Unit | State | On the PR branch | What is left |
|---|---|---|---|
| S0 Contract and schema | Done | migrations 0009–0012, routes, schemas, generated data, seed, `patient-fixtures.ts` | — |
| S1 Sync entity rules | Done | entity registry (`services/api/src/sync/entities/*`), per-entity permissions, savepoint, field classes, redirects, migration 0013 (encounter→patient FK) | — |
| S2 Matching, search, index, charts | Done | scorer and vectors, search, match, charts, history, projection, team index; migration 0015 (pinned `normalize_name`) | — |
| S3 Duplicates and merges | Done | re-match at sync, queue, decisions, merge, undo; `patients-done-when.test.ts` (server half of 13.1) passes | — |
| S4 ID links, corrections, reviews, problem admin | Done | group handshake, online ID cards, corrections and declined amendments, field reviews, problem reversals; migration 0014 | — |
| P0 Phone core | Done | `apps/mobile/lib/patients/{access,recognisable,id_link_token,dob,display,normalize,trigram,matching,match_constants}.dart`, all vectors pass | — |
| W0 Portal shell | Done | navigation, `lib/{labels,dob}.ts`, `/c`, shared e2e helpers | Nav links to W1/W2 pages show "Page not found" until those land |
| **P1 Phone sync layer** | **In progress** (in an agent's worktree; nothing on the branch yet) | — | All of row P1. The fake server must mirror S1's rules: the list is under "As built" below |
| **W1 Portal patients** | **In progress** (in an agent's worktree; nothing on the branch yet) | — | All of row W1, including 13.7's "the merged patient's URL opens the survivor" step (the seeded merge of 9 into 8 fits) |
| W2 Portal duplicates, merges, reversals | Done | `/team/duplicates`, `/team/duplicates/[pairId]` (`SideBySide`), `/team/merges`, `/team/problem-reversals`, `actions/{duplicates,problems}.ts`; `e2e/{duplicates,problems}.spec.ts` and `e2e/phone-records.ts` | — |
| P2 Phone patients domain | Not started; needs P1 | — | All of row P2, including the phone half of the done-when (13.1) against the fake and the live API |
| P3 Phone screens | Not started; needs P2's interfaces | — | All of row P3 |
| D Documents | Partly done | `CLAUDE.md`; D25–D43 and the phase 3 status are in `IMPLEMENTATION_PLAN.md` | Compliance docs (section 15 row D) when the phase closes |
| Review | Not started | — | Adversarial review of the whole phase once P3, W1 and W2 land; then the phase is Done |

Order from here: **P1 and W1 run in parallel** (disjoint files). P2 after P1; P3
after P2 (or against P2's interfaces); the review last.

### As built: where the code departs from, or reads, this design

Later units build on the code, not on the text above, where they differ.

- **Shared (S0).** The phase 2 type `RecordEntityName` stays the encounter pair; the wider type is
  `AnyRecordEntityName`. `PairSide.photo` is `photoId: Uuid | null`; `PairSide.createdHow` has
  `'unknown'` (seeded rows). The Dart generator names its enum fallback `unknownValue`, because
  `unknown` is a real allergy value. `ID_LINK_BASE_URL` is required in pilot and production
  (https), defaults to `http://localhost:3100` in local and test; `/v1/me` returns it.
  Nicknames come from `carltonnorthern/nicknames` (Apache-2.0, pinned commit, licence vendored).
  The 427 ICD-10-CM codes come from a GitHub mirror of the CDC FY2026 tabular (the proxy blocks
  CMS and CDC); a clinician must review the list before the pilot.
- **Sync (S1).** Encounter and note loads lock `FOR NO KEY UPDATE` (with `FOR UPDATE` an encounter
  edit and a problem naming it deadlock). A status confirmation counts as an observation and bumps
  the version; an older observation that didn't see the current version is history only, even when
  it agrees. Redirected writes use history kind `redirected`; a problem's `enteredInError` is
  never redirected. A problem conflict sends no `conflict_resolved` notice. `server_constraint`
  rejections carry `sqlstate`. Alias (20) and allergy (30) caps count per patient record. Links made
  through sync are `made_offline: true`. Sync read rules live in `review.ts`.
- **The rules the phone's fake server must mirror** (S1's list; check each against
  `services/api/src/sync/entities/*`):
  1. Value schemas, strict and never transforming, with `valueProblem` and `parents` /
     `parentsOfSet` (`packages/contract/test-vectors/sync-values.json`).
  2. Per-entity permissions: `patients.edit` for patient, alias, consent, id_link and allergy
     creates; `encounters.chart` for allergy `enteredInError`, problems, problem notes, encounters
     and notes; a problem's `enteredInError` also needs its author or `patients.reverse_resolved`.
     A missing permission is held for review.
  3. Parents of creates and sets: missing → stale reference; the person's own held create →
     `awaiting_review`.
  4. Field classes: keep-both (`not_asked` is blank for `allergyScreen` and `idCardChoice`),
     identity with `ESTIMATE_RANGE`, `nothing_to_recognise` as `history_only`, set-once, "no known
     allergies" against an allergy in both orders, a `resolution` on these classes is
     `nothing_to_resolve`.
  5. Problem status: confirmations bump the version; an unseen older observation is history only;
     the check date never moves back; `resolved_needs_admin` and `status_backwards`; a retracted
     problem gives `history_only` for a status and `problemRetracted` for a note.
  6. Accepted receipts carry `server` and `details`, and replays answer the same; a change that
     follows a kept or redirected change never counts as having seen the chart.
  7. Redirects: patient sets go to the canonical patient with `redirectedTo` and `mergeId`; problem
     status sets follow `merged_into`; children are stored as sent; an ID link for a merged patient
     is `patient_merged` with `survivorId`.
  8. Caps: 20 active aliases, 30 active allergies per patient record; `record_exists` for a taken
     ID, consents included.
  9. `AuditAppend` with up to 50 `patientIds`, `criteria`, `source`, `checkId`.
  10. A patient create re-runs matching: the receipt carries `possibleDuplicate` unless the match was
      already shown (`matchCheck.shown` / `dismissed`).
- **Matching (S2).** `normalize_name` is generated from `packages/contract/data/unaccent-latin.json`
  (migration 0015), never from live `unaccent`; refreshing the map is an explicit generator step
  (`gen-match-vectors.ts --refresh-accent-map`). Rules the vectors pin (and P0 mirrors): match
  reasons are every name pair at or above `MATCH_POSSIBLE` plus the best pair; a token's "how" is a
  reason only at or above `NAME_FLOOR`; a prefix match gives no "how"; weak words are dropped from the
  whole-string trigram; descriptors never get the sound-alike term; ties go by source (preferred,
  legal, alias, descriptor) then text; a year-and-month search against a full date scores
  `DOB_MONTH_YEAR`, `DOB_YEAR` or 0. History leaves out ID link records (their create value holds
  the token). Charts list removed aliases and allergies entered in error with their status. Team
  index aliases are `{id: Uuid | null, alias, kind: 'alias' | 'merged_name'}`: a merged record's
  name has no ID and must never be offered for removal.
- **Duplicates (S3).** A merge supersedes (restorably) open and Not sure pairs naming the merged
  record; the survivor's re-match flags them again, keeping the Not sure note and "Not them". The
  queue lists a pair only while both sides are active. Not sure leaves `decided_at` null.
  `duplicate.decided` is written once per patient. Undo keeps a "none known" fill once the group has
  an allergy, and any fill whose removal would leave nobody recognisable (`keptFields`); it is
  refused while a merge made at the same time or later involves the survivor's group. The staff
  flag needs `patients.edit` and is refused on a pair kept separate (PLAN-OPEN). The re-match limit
  is `CANDIDATE_LIMIT`. Refusal codes for the portal: 409 `pair_changed {versions:{a,b}}`,
  409 `already_decided`, 422 `survivor_not_in_pair`, 422 `same_patient`,
  409 `undo_later_merge_first {mergeIds}`, 409 `already_undone`, 403 `reauth_required`.
- **ID links and admin (S4).** A stale offline card that loses a conflict changes nothing else. An
  online issue with no active card proceeds even when `replacesLinkId` is set. A problem merge's
  comment is its own correction kind, `problem_merge` (migration 0014). Declining a reversal request
  needs a recent sign-in. Patient fields outside sync are read and written through S1's patient
  entity, one implementation.
- **Phone core (P0).** `normalize.dart` holds a copy of the accent map, and its test fails if the
  copy differs from the JSON. Only severe allergies show their severity on the badge. `birthLabel`
  gives the profile header's forms; the search-row form is P3's. Date-of-birth error messages other
  than the February one are worded independently on the phone and in the portal.
- **Portal duplicates (W2).** Every server action re-renders the page (the proxy rewrites the
  session cookie on each request), so a result held in a list item vanishes when the item leaves the
  list: the problem merge offer lives in a provider above the list, and outcome URLs carry the
  answered entry's UUID (`?done=merged&entry=…`). After a pair decision the reviewer returns to the
  queue, whose confirmation heading takes focus and links to the next pair. The pair page sends the
  versions the reviewer saw and re-reads the pair on `pair_changed`, keeping what was typed. Specs
  create their own patients through a phone push (`e2e/phone-records.ts`, one phone per person per
  run), so they never change seeded rows other specs read. The staff flag
  (`POST /v1/team/duplicates`) has no screen in phase 3: the PRD asks only for automatic flagging and
  the queue. A person with several phones gets a numbered wipe section per
  phone (found by W2; axe `landmark-unique`).
- **Portal shell (W0).** `/c` shows signed-in and signed-out visitors the same page and never reads
  the fragment; removing the token from the address bar and history is left to phase 9 (scanning).

### Questions that need a person (each has a default in code, marked PLAN-OPEN)

- **Counsel:** registration consent wording, minors and withdrawal; which diagnosis codes count as
  sensitive; whether search text should ever be kept in the audit log (default: never).
- **Brooke and Mercy:** the curated ICD-10-CM list (and its source); living situation options;
  match thresholds, to tune on pilot data; month-first date entry.
- **The team:** the ID link domain (`ID_LINK_BASE_URL` must be set before the pilot);
  `OFFLINE_AFTER_MINUTES = 10` (when an intake counts as made offline); whether only a reviewer may
  reopen a pair kept separate; per-user rate limiting (recommended at the API gateway in phase 12).

---

## 0. Ground truth and the choices

### 0.1 Facts from the code that shape this design

| Fact | Where | Consequence |
|---|---|---|
| The catalog already holds `patients.view`, `patients.edit`, `patients.correct_identity`, `patients.review_duplicates`, `patients.view_sensitive`, `patients.view_sensitive_exams`, `patients.reverse_resolved`, `encounters.chart`, `checkins.create` and `billing.view_codes` (23 keys). Program Admin's row was inserted as `known_permissions()` evaluated then. | `db/migrations/0002_identity_access.sql`, `services/api/src/auth/permissions.ts` | **Phase 3 adds no key** (PRD module 1: "no new permission types in the MVP (Oct 12)"; D37). Every check maps to these 23 (4.1). No migration touches `known_permissions()` or the role rows, and `foundation.test.ts` passes unchanged. |
| Every non-audit synced change is gated on one flag: `push.ts` sets `ApplyActor.canChart = scope.can('encounters.chart')`, and `decide()` holds the change for review when it is false. The removal hand-over builds the same actor with `canChart: false` (`devices.ts recordAudit`). | `services/api/src/sync/push.ts`, `apply.ts`, `devices.ts` | A CHW (has `patients.edit`, not `encounters.chart`) could not sync a patient. Permission becomes per entity (2.2), and `devices.ts` changes with it (S1). |
| `push.ts` stops the batch at the first change whose transaction throws (`sync.change_failed`, `break`); the phone sends that change first again next time. | `services/api/src/sync/push.ts` | A database constraint that fires inside a push stops that phone's queue for good. The checks run first (2.3), and each change also applies inside a savepoint that turns an integrity error into a stored rejection (2.2 step 5). |
| `set()` writes `parsed.data` (the Zod output), while the receipt carries the hash of the value the phone sent. | `apply.ts` | A transforming schema (`.trim()`) would store a value other than the one confirmed. Value schemas validate and never transform (2.1). |
| `review.ts` throws `conflict(...)` inside `scope.tx`, which rolls back the audit events of that transaction; the "own change" refusal is audited in a second transaction for that reason. | `services/api/src/sync/review.ts` | A 409 carries codes, IDs and versions only, never a chart value or a token (3). |
| `LocalStore._tx` runs `BEGIN IMMEDIATE`; `appendAudit`, `confirm`, `resolveConflict` and the fixes each open their own. | `apps/mobile/lib/sync/local_store.dart` | Composing them inside a caller's transaction would throw on a nested `BEGIN`; `_tx` becomes re-entrant with savepoints (2.9-8). |
| `PRAGMA secure_delete = ON` overwrites freed pages, but deleting rows from an FTS5 table leaves their tokens in the `*_data` segments until FTS5's own `secure-delete` option is on (verified on SQLite 3.45). | `apps/mobile/lib/sync/local_db.dart` | `_v2` turns on FTS5 `secure-delete` for `patient_names` (2.9). |
| `storeReceipt` keeps `details` only for rejections; `toResult` returns only `serverVersion` and `hash` on accept; `followsCurrent` (D16) trusts any accepted receipt whose `serverVersion` equals the field's version. | `apply.ts` | Accepted receipts must carry `details` and `server` (2.5), and D16 must ignore a followed change that was kept as an alternate, or a person's second offline edit would overwrite the chart silently (2.4). |
| `loadRecord`, `fieldSchema`, `writeField`, `resultFromReceipt`, `heldCreate` and the phone's `_createdFields`, `fixRejected`, `_classify` all branch on `encounter` / `encounter_note`. `_classify` knows one parent relation: a note's `encounterId`. | `services/api/src/sync/records.ts`, `apply.ts`; `apps/mobile/lib/sync/local_store.dart` | Both sides get an entity registry; `_classify` learns `parentsOf()` for every entity (2.2, 2.9). |
| `AuditAppend` (offline reads) accepts `patient.viewed`, `patient.searched`, `encounter.viewed`, `note.viewed` with `entity`, `entityId`, `patientId`, `resultCount`, strict. The phone mirrors it in `_auditActions`. | `apply.ts`, `local_store.dart` | Extended, not replaced (2.8). |
| `encounters.patient_id` has no FK; phase 2 tests push encounters naming random patient UUIDs (`services/api/test/sync.test.ts` ~1218, 1278, 1533, all quarantine cases, some later accepted by an admin). | `0004_sync.sql` | A composite FK is added `not valid` in `0013`, which lands with S1, together with the check that answers first and the test edits (1.6, 15); encounter creates must name an existing patient from then on (2.3). |
| `database.ts` sets only `app.team_id`, `app.user_id`, `app.scope` per transaction; it does **not** set `search_path`. On RDS `pg_trgm` and `fuzzystrmatch` live in `sineobex` (created under 0001's search path); on Supabase in `extensions`. | `services/api/src/db/database.ts`, `0001_base.sql` | The `%` and `<%` operators would not resolve from handler SQL. Candidate retrieval is a SQL function with its own `set search_path` (1.2), the pattern `normalize_name` already uses. |
| All pending migrations run in **one transaction**; `create index concurrently` is impossible. | `db/src/migrate.ts` | Plain `create index`; tables are new or small. |
| A foreign-key check runs as the table owner and ignores RLS. | PostgreSQL semantics | Every patient-side FK is composite `(team_id, patient_id)` → `patients (team_id, id)`, so even a buggy handler can't point a row at another team's patient. `encounters` gains `unique (team_id, id)` for the same reason. |
| `append_audit` serializes each team's writes with `pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || team, 0))`, taken at the first audit call; advisory locks are re-entrant within a session. `set()` today takes the record's row lock before its audit call, and `create()` inserts an encounter (whose FK check takes `FOR KEY SHARE` on the patient row) before its audit call. | `0003_audit.sql`, `apply.ts` | Patient-side transactions, and encounter writes that name a patient, take that same lock **first**; merges and undos lock patient rows `FOR NO KEY UPDATE`, which never waits on a `FOR KEY SHARE` (D32). That gives one lock order between a merge and a push, and duplicate matching always sees a concurrent create. |
| The receipt hash is the hash of the value the phone **sent** (`precheck`), not of any stored row. | `apply.ts` | Re-pointing would not break confirmation (one input design claimed it would). Merges still move nothing (D27), for the other reasons given there. |
| The API logger drops any key off its allowlist; the request log records the route pattern only. | `services/api/src/lib/log.ts`, `app.ts` | No new log keys. Search terms, names, tokens and comments never reach a log. |
| `HttpTransport.defaultTimeout` is 20 s and bounds the response read; request bodies get 20 s plus 16 KiB/s (D24). | `apps/mobile/lib/api/transport.dart` | A 1 MB index response would time out on EDGE: the index is paged (6.2). |
| The sync controller ticks every 20 s **only while something is sendable**; a device check runs every 5 minutes. | `apps/mobile/lib/sync/sync_controller.dart` | The index and chart refreshes need their own 15-minute timer (6.2). |
| Sign-out keeps the files when anything is unsynced, and from the lock screen (no key in memory); `_setKept` marks a kept user in the secure store. | `apps/mobile/lib/auth/session_controller.dart` (`signOut`) | Server copies can't be deleted from the lock screen; a per-file secure-store marker makes the next open delete them before any read (6.3). |
| The phone caches each team's permission list in `LocalUser.teams[].permissions` (from `/v1/me`). | `session_controller.dart`, `app_providers.dart` | The phone hides what a role can't use offline; the server still decides. |
| Dart's SDK has no Unicode normalization. | — | The phone's accent map is generated from Postgres `unaccent` (5.1), not NFD. |
| The Dart client generator emits an `unknown('')` member for every enum. | `packages/contract/scripts/dart.ts` | New `ChangeEntity` values don't break older decoders. |
| Portal: `ActionForm` (focus-taking error summary), `TextField`, `SelectField`, `ChoiceField` (nothing preselected) in `components/ActionForm.tsx`; nav built with `can(team, permission)` in `(app)/layout.tsx`; quarantine pages by `afterId`; entity labels in `team/quarantine/page.tsx`, unsynced-category labels in `lib/labels.ts`. | `apps/portal/src/**` | Patterns reused as is. |
| The PHI guard rejects SSN-, phone- (outside 555-01xx), email- and MBI-shaped strings in seed and test files. Names are not checked. | `tools/phi-guard-rules.mjs` | Seed patients have invented names, descriptors start with "Demo:", no phone numbers. |
| `tools/live-sync.sh` runs exactly `test/sync/live_api_test.dart` against the API on the seeded database. | `tools/live-sync.sh` | The phase 3 live file is added to that command (15, P2). |

### 0.2 Where the three designs disagreed, and what this design chose

| Question | Choice | Why |
|---|---|---|
| Merge: move child rows with a move log, or keep them and read by group? | **Move nothing.** Each patient row carries a maintained `canonical_id`; reads group by it; late creates are stored as sent; late field edits are redirected to the survivor. | A merge then writes only patient rows, so it never contends with pushes on child tables; undo is exact by construction, including records that arrived after the merge. The cost (every chart read groups by `canonical_id`) is one indexed join, enforced by a schema test (13.3). |
| Group lookup: recursive `patient_root()` per read, or a stored `canonical_id`? | Stored `canonical_id`, maintained by merge and undo. | One indexed read instead of a walk on every chart and search. |
| ID link for a merged patient arriving at sync: re-point to the survivor, or reject? | **Reject** `stale_reference {problem: 'patient_merged', survivorId}`; the card stays blocked; Needs attention offers "Make a new card from the kept chart". | The PRD says so explicitly, and re-pointing could silently retire the survivor's card in the patient's pocket. |
| Problem status disagreement between phones | **Latest observation wins, but only an admin moves a problem out of Resolved.** A stale backward move from Resolved is a `conflict` with a problem-specific card (Keep Resolved / It came back / Resolved by mistake). | Field statuses have an order and a time; the worker in front of the patient needs a prompt to "add as new" so care and the bag check carry on (PRD), which a silent review would not give. |
| Problem status history: own table or `field_history`? | `field_history` on `(problem, status)`, value `{status, encounterId}`, plus denormalized `status_changed_*` and `status_checked_at` columns. | One append-only history for every field already exists; a parallel table would need keeping consistent. |
| Admin reversal of Resolved: a backward status write, or a request? | The worker adds a **new entry (New) linked `resolvedInErrorOf`**; that entry is the reversal request. The admin reverses in the portal and is offered the merge. | Exactly the PRD's flow ("until the admin acts, the worker adds the ailment as a new entry"), with no backward write on the phone. |
| Problem title and code editable? | No. Wrong entries are marked entered in error and re-added. | An unambiguous clinical history; no reconciliation rule needed. |
| New problem permissions (`problems.view`, `problems.edit`)? | None. Viewing needs `patients.view` and either `encounters.chart` or `billing.view_codes`; adding or changing a problem or a note needs `encounters.chart`; Resolved back to Ongoing needs `patients.reverse_resolved`. | No new permission types in the MVP (Oct 12; D37). |
| Offline index eligibility: explicit permission or derived rule? | **Derived** (D37): `patients.view` plus at least one of `patients.edit`, `encounters.chart`, `checkins.create`, the permissions of people who meet patients in person. | PRD module 1 allows no new permission types (Oct 12). Billing/Data and view-only roles never hold it (D38). |
| Legal names (or their Double Metaphone codes) in the phone index? | **Never** (D40): no legal name, and nothing derived from one (trigram rows, phonetic codes), in the index or the phone's search table. On the phone a legal name appears only inside a chart the person opened or is working on, cached for 24 hours. Intake pre-fills the preferred name from the legal given name. | The PRD's index list excludes legal names; the server's re-run at sync, which sees legal names, catches what the phone misses. |
| Double Metaphone on the phone | Server only. | As above; phone and server scores differ only by that term, and the vectors record both. |
| Index transport | Versioned, keyset-paged (500 per page), staged and swapped in one SQLite transaction; `unchanged` costs one small request. | Survives EDGE (20 s response bound) and dead zones; "replaced whole" still holds because a changed index is always rebuilt from a complete download. |
| Route cache storage | The existing `records`/`fields` tables plus a `cache_scopes` table (`opened`, `today`, `route`), with "local work keeps its patient" as an implicit scope. | Reuses field versions (offline edits need them) and the purge machinery; one condition is added to `_purge`. |
| "Keep for today" pins before routes exist | Yes, per person, at most 50, 24 h. | It is what a route will automate in phase 7, it is user-chosen and audited, and it gives leads a way to prepare a run today. |
| Token encoding | base64url, 22 characters. | Standard in Dart (`base64Url`) and Node (`base64url`); no hand entry is expected (QR). |
| Token storage | Plaintext **and** SHA-256; uniqueness and every lookup on the hash. | Copy ID link must work for anyone on the team at any time (plaintext), while the token never appears in a `where` clause, statement log or audit row (hash). |
| Consent storage | Registration consent inside the patient create (so the server can require it), stored as append-only `patient_consents` rows; later decisions are `patient_consent` creates. | Union semantics need no reconciliation; "consent required" is checkable in the create's transaction. |
| Aliases and allergies at intake: inside the patient create or separate creates? | Separate creates, after the patient create in the same local transaction. | Each is its own union record with a device ID, so it can be removed offline before anything synced, and a fixed patient create (D19) never re-sends them. |
| Field reviews: decided offline through sync, or online? | Online routes, from the portal or the phone when it has signal. | A decision never races a push, and sync keeps exactly one new rule (keep-both). |
| Merge form: per-field choices, or fill blanks and open reviews? | Fill the survivor's blanks; every differing field opens a review on the survivor. | One merge form (decision, survivor, comment); differences are settled by the review machinery that already exists. |
| Undo of a merge that has later merges on top | Refused (`409 undo_later_merge_first`). | Keeps undo exact; the later merge is undone first. |
| ID cards after a merge: retire the merged record's card, or keep every card? | **Keep every card** (D39). Every active token in the merged group opens the surviving chart; the next regeneration retires them all and issues one. Undo gives each record back its own tokens. | The PRD invalidates a token only when staff regenerate it, and the patient may be carrying either card. |
| Clock pause | Applies to problems, problem notes and ID links (and, as today, encounters and notes); **not** to intake, demographics, aliases, allergies or consents. An intake that asks for a card while the clock is off saves without the link and prompts for it later. | ID link conflicts are decided by device time; registering the person in front of you is not medication timing (module 9's reason for the pause). |
| Portal intake and demographic edits | Not in phase 3 (PLAN-OPEN). The portal searches, reads, corrects identity, decides reviews and duplicates, reverses problems and issues ID links. | Consent is given in person; Edit is specified as the phone's intake form; it avoids a second, non-sync write path for demographics. |
| Duplicate warning | Inline panel under the name fields (never steals focus), plus one confirmation sheet on Create only while a likely match was not dismissed. | The check helps while the worker can still ask a question and costs one tap to dismiss. |
| Search rate limit | None in phase 3; the audit dashboard flags bursts later. | Field searches come in bursts at a busy stop; every search is audited with its result IDs. |

### 0.3 Added, or corrected, relative to all three inputs

- **A refused amendment request is recorded.** Module 4 says a patient's amendment request (HIPAA §164.526) is logged "with the request and the decision"; the inputs recorded only accepted corrections. `IdentityCorrection.outcome = 'declined'` stores the requested value and the reason with the chart unchanged (11.6).
- **The phone gets the ID link base URL from the server** (`/v1/me` `idLinkBaseUrl`, cached): an offline phone must build exactly the URL the portal shows, and no input said where it comes from (3.6).
- **Trigram operators need a search path.** One input assumed `database.ts` sets it; it doesn't, so candidate retrieval lives in a SQL function with its own `set search_path` (1.2).
- **Group reads are enforced for later phases.** With merges that move nothing, a phase 4+ child table read by `patient_id = $1` would show half a merged chart; a schema test fails until the table is registered (13.3).

### 0.4 What the review and the project lead changed

| Change | Sections | Source |
|---|---|---|
| No new permission keys; every check uses the existing catalog; the index goes to field roles | 1.1, 4, 6.1, 12.2, 13, 15, D37 | project lead (a); finding 23 |
| Billing/Data sees the chart as the PRD says, without sensitive details; no index | 3.1, 4.3, 14, D38 | project lead (b) |
| A merge retires no card; regeneration retires every active card in the group; undo restores each record's own | 1.4, 1.5, 3.5, 8.4, 8.5, 10.4, D39 | project lead (c); findings 6, 14, 24 |
| No legal name or anything derived from one in the phone's index or search table; cached-chart rows purge with the chart | 2.9, 5.5, 6.1, 7.2, 12.1, D40 | project lead (d); findings 8, 9 |
| Search text never in the audit log (PLAN-OPEN for counsel) | 2.8, 5.6, 14.1, D41 | project lead (e) |
| A change can't leave a patient unrecognisable, and a constraint error is a stored rejection, never a stopped queue | 2.2, 2.3, 2.4, D42 | finding 1 |
| A status `set` checks its encounter as a parent, on both sides | 2.1, 2.2, 2.9, 2.10 | finding 2 |
| Server-listed redirects replace the phone's, whatever their origin | 2.5, 2.9, 6.2, 8.7, 13.6 | finding 3 |
| Candidate retrieval ranks before it cuts; birth year never retrieves on its own | 1.2, 5.4, 5.5 | finding 4 |
| A stale identity fill never writes over a value it didn't see; estimate refinements stay in range | 2.4, 8.4, 11.5, 11.6 | finding 5 |
| Work on a problem marked entered in error is kept, not rejected | 2.3, 2.6, 9.2 | finding 7 |
| Offline audit lists up to 50 patients | 2.8, 5.6 | finding 10 |
| S0 keeps CI green alone; `devices.ts` and the shared fixtures have owners | 1.1, 1.6, 15 | finding 11 |
| Lock order made exact for encounters | 0.1, 2.2, 8.4, D32 | finding 12 |
| Phone FTS query fixed (`min(rank)`) | 5.5 | finding 13 |
| `_tx` re-entrant | 2.9 | finding 15 |
| An allergy overrides "No known allergies", in either order | 2.3, 2.4, 8.4, 12.1 | finding 16 |
| An intake asking for a card while the clock is off still saves | 11.1 | finding 17 |
| 409s carry no chart values or tokens | 3, 3.2, 3.4, 3.5 | finding 18 |
| `merges.viewed` lists its patients; index pages record their exact ID range | 3.1, 3.4, D33 | finding 19 |
| Chart downloads shrink on timeout and are gzipped | 3.1, 7.3 | finding 20 |
| Value schemas validate, never transform | 2.1 | finding 21 |
| Accessibility tests for Add problem, the review sheet and edit mode | 13.5 | finding 22 |

---

## 1. Data model

All tables live in `sineobex`, start with `set search_path = sineobex, public, extensions;`, carry the 0004 RLS policy (`team_id = current_team_id() or is_platform_scope()`, same `with check`), and lose `delete` for `sineobex_app` (patients are never deleted). Every secondary index is led by `team_id`; the one exception (the global token-hash index) is justified in 1.5. Record IDs made on a phone are the primary key exactly as sent. Records that sync can change carry the `encounters` bookkeeping: `field_versions jsonb`, `field_meta jsonb` (`{by, at, changeId}` per field), `version int`, written below as `BOOKKEEPING`.

### 1.1 Migration list

| File | Unit | Holds |
|---|---|---|
| `0009_patients.sql` | S0 | `encounters` `unique (team_id, id)`; `name_codes()`; `patients`; `patient_aliases`; `patient_name_keys` and its triggers; `patient_allergies`; `patient_consents`; `field_reviews`; `field_history.review_id` and wider `kind` check; `patient_corrections`; `team_index_versions` and `bump_team_index()`; `patient_candidates()` and `patient_candidates_by_birth()`; `patient_of_change()`; the audit `patientIds` GIN index; RLS and grants |
| `0010_problems.sql` | S0 | `problems`, `problem_notes`; RLS and grants |
| `0011_duplicates.sql` | S0 | `duplicate_pairs`, `duplicate_decisions`, `patient_merges`; index-version triggers; RLS and grants |
| `0012_id_links.sql` | S0 | `patient_id_links`; index-version trigger; RLS and grants |
| `0013_encounter_patient_fk.sql` | S1 | the composite encounter→patient FK (`not valid`) and `encounters_team_patient` (1.6) |

All additive. The one replaced check constraint (`field_history_kind_check`) only widens, as `0008` did for `quarantine_items_reason_check`. **No migration changes `known_permissions()` or any role row** (D37). `0013` lands with S1 because the FK is only safe once the API answers `patient_missing` before inserting and the phase 2 tests name real patients; landing it in S0 would turn S0's CI red (review finding 11). `db/src/migrate.ts` applies pending files in version order and refuses an edited applied file, so a later fix to any of these is a new file, never an edit.

### 1.2 `0009_patients.sql`

```sql
set search_path = sineobex, public, extensions;

-- Composite FKs from patient-side rows to encounters (phase 4 fills encounter_id columns).
alter table sineobex.encounters add constraint encounters_team_id_key unique (team_id, id);

-- Double Metaphone codes (primary and alternate) of each token of a normalized name, tokens of 2+
-- characters. Immutable so triggers can store it; own search_path because fuzzystrmatch lives in
-- `sineobex` on RDS and `extensions` on Supabase (the normalize_name pattern, 0001).
create function sineobex.name_codes(p_norm text) returns text[]
language sql immutable parallel safe
set search_path = sineobex, public, extensions as $$
  select coalesce(array_agg(distinct c order by c) filter (where c is not null and c <> ''), '{}')
  from unnest(string_to_array(coalesce(p_norm, ''), ' ')) as t(tok),
       lateral (values (dmetaphone(t.tok)), (dmetaphone_alt(t.tok))) as v(c)
  where length(t.tok) >= 2
$$;

create table sineobex.patients (
  id                     uuid primary key,                       -- made on the phone (v4)
  team_id                uuid not null references sineobex.teams (id),
  status                 text not null default 'active' check (status in ('active', 'merged')),
  merged_into            uuid,                                   -- the direct survivor
  canonical_id           uuid not null,                          -- end of the merge chain; itself when active
  preferred_name         text check (preferred_name is null or length(btrim(preferred_name)) between 1 and 80),
  legal_given_name       text check (legal_given_name is null or length(btrim(legal_given_name)) between 1 and 80),
  legal_family_name      text check (legal_family_name is null or length(btrim(legal_family_name)) between 1 and 80),
  visual_descriptor      text check (visual_descriptor is null or length(btrim(visual_descriptor)) between 1 and 200),
  -- Sync field `birth` = {precision, date?, year?}. Null precision: unknown.
  birth_precision        text check (birth_precision in ('day', 'year', 'estimated')),
  birth_date             date check (birth_date >= date '1900-01-01'),
  birth_year             smallint,
  -- Sync field `livingSituation` = {kind, other?}.
  living_situation       text check (living_situation in ('unsheltered', 'vehicle', 'emergency_shelter',
                           'transitional_housing', 'couch_surfing', 'hotel_motel', 'housed', 'institution',
                           'unknown', 'other')),
  living_situation_other text check (living_situation_other is null or length(btrim(living_situation_other)) between 1 and 200),
  usual_area             text check (usual_area is null or length(btrim(usual_area)) between 1 and 200),
  preferred_language     text check (preferred_language is null or preferred_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  allergy_screen         text not null default 'not_asked' check (allergy_screen in ('not_asked', 'none_known')),
  id_card_choice         text not null default 'not_asked' check (id_card_choice in ('not_asked', 'wants', 'declined')),
  profile_photo_id       uuid,          -- phase 8 adds patient_photos and the FK
  priority_flag_key      text,          -- phase 5 adds the team flag table and the FK
  last_seen_at           timestamptz,   -- intake sets it; phase 4 encounters and phase 9 check-ins move it
  registered_at          timestamptz not null,  -- clock-corrected device time of the intake
  clock_verified         boolean not null default false,
  author_user_id         uuid not null references sineobex.users (id),
  created_device_id      uuid references sineobex.devices (id),
  field_versions jsonb not null default '{}', field_meta jsonb not null default '{}',
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (team_id, id),
  foreign key (team_id, merged_into) references sineobex.patients (team_id, id),
  foreign key (team_id, canonical_id) references sineobex.patients (team_id, id),
  check ((status = 'merged') = (merged_into is not null)),
  check (merged_into is distinct from id),
  check ((status = 'active') = (canonical_id = id)),
  check ((birth_precision is null and birth_date is null and birth_year is null)
      or (birth_precision = 'day' and birth_date is not null and birth_year = extract(year from birth_date))
      or (birth_precision in ('year', 'estimated') and birth_date is null and birth_year between 1900 and 2100)),
  check ((living_situation = 'other') = (living_situation_other is not null)),
  -- Someone must be recognisable: a name or what they look like ("man in blue wheelchair").
  -- Fields sync one by one, so the API checks the row it would leave before every write to one
  -- of these four (2.3, `recognisableAfter`); this constraint is the backstop, never the answer.
  constraint patients_recognisable
    check (coalesce(preferred_name, legal_given_name, legal_family_name, visual_descriptor) is not null)
);
create index patients_team_canonical on sineobex.patients (team_id, canonical_id);
create index patients_team_updated on sineobex.patients (team_id, status, updated_at);
create index patients_team_birth_year on sineobex.patients (team_id, birth_year);
create trigger patients_touch before update on sineobex.patients for each row execute function sineobex.touch_updated_at();

-- Street names, one row each, so two phones adding aliases offline union. Removal is one-way.
create table sineobex.patient_aliases (
  id                uuid primary key,
  team_id           uuid not null references sineobex.teams (id),
  patient_id        uuid not null,
  alias             text not null check (length(btrim(alias)) between 1 and 60),
  status            text not null default 'active' check (status in ('active', 'removed')),
  removed_reason    text check (removed_reason is null or length(btrim(removed_reason)) between 3 and 300),
  removed_by        uuid references sineobex.users (id),
  removed_at        timestamptz,
  author_user_id    uuid not null references sineobex.users (id),
  created_device_id uuid references sineobex.devices (id),
  BOOKKEEPING,
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  check ((status = 'removed') = (removed_at is not null and removed_reason is not null))
);
create index patient_aliases_patient on sineobex.patient_aliases (team_id, patient_id, status);

-- Search keys, derived, one row per name-like string. Merged patients keep theirs: search groups
-- by canonical_id, so an alias only the merged record had still finds the survivor.
create table sineobex.patient_name_keys (
  team_id     uuid not null,
  patient_id  uuid not null,
  source      text not null check (source in ('legal', 'preferred', 'alias', 'descriptor')),
  source_id   uuid not null,          -- the patient (legal, preferred, descriptor) or the alias row
  norm        text not null,          -- sineobex.normalize_name(value)
  tokens      text[] not null,        -- string_to_array(norm, ' ')
  dm_codes    text[] not null,        -- name_codes(norm); '{}' for descriptor
  primary key (team_id, patient_id, source, source_id),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id)
);
-- btree_gin (0001) lets each GIN index lead with team_id.
create index patient_name_keys_trgm   on sineobex.patient_name_keys using gin (team_id, norm gin_trgm_ops);
create index patient_name_keys_codes  on sineobex.patient_name_keys using gin (team_id, dm_codes);
create index patient_name_keys_tokens on sineobex.patient_name_keys using gin (team_id, tokens);
-- Triggers: patients_name_keys() after insert or update on patients rebuilds the patient's legal
-- ("given family"), preferred and descriptor rows; aliases_name_keys() after insert or update on
-- patient_aliases rebuilds that alias's row (none once removed). Rows with a null norm are skipped.

-- Allergies: a union, never overwritten (module 9). The only change is entered in error.
create table sineobex.patient_allergies (
  id                uuid primary key,
  team_id           uuid not null references sineobex.teams (id),
  patient_id        uuid not null,
  substance         text not null check (length(btrim(substance)) between 1 and 120),
  category          text not null default 'unknown' check (category in ('drug', 'food', 'environment', 'other', 'unknown')),
  reaction          text check (reaction is null or length(btrim(reaction)) between 1 and 200),
  severity          text not null default 'unknown' check (severity in ('mild', 'moderate', 'severe', 'unknown')),
  encounter_id      uuid,
  status            text not null default 'active' check (status in ('active', 'entered_in_error')),
  error_reason      text check (error_reason is null or length(btrim(error_reason)) between 3 and 300),
  error_by          uuid references sineobex.users (id),
  error_at          timestamptz,
  recorded_at       timestamptz not null,           -- clock-corrected device time
  author_user_id    uuid not null references sineobex.users (id),
  created_device_id uuid references sineobex.devices (id),
  BOOKKEEPING,
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  foreign key (team_id, encounter_id) references sineobex.encounters (team_id, id),
  check ((status = 'entered_in_error') = (error_reason is not null and error_at is not null))
);
create index patient_allergies_patient on sineobex.patient_allergies (team_id, patient_id, status);

-- Consent decisions, append-only (11.2). A changed decision is a new row.
create table sineobex.patient_consents (
  id             uuid primary key,                  -- phone-made, including the rows a patient create carries (2.1)
  team_id        uuid not null references sineobex.teams (id),
  patient_id     uuid not null,
  kind           text not null check (kind in ('care_and_record', 'privacy_notice')),
  decision       text not null,
  method         text not null check (method in ('verbal', 'written', 'not_applicable')),
  script_version text not null check (script_version ~ '^[a-z0-9_.-]{1,40}$'),
  language       text not null check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  reason         text check (reason is null or length(btrim(reason)) between 3 and 300),
  recorded_by    uuid not null references sineobex.users (id),
  recorded_at    timestamptz not null,              -- clock-corrected device time
  clock_verified boolean not null,
  device_id      uuid references sineobex.devices (id),
  change_id      uuid,
  created_at     timestamptz not null default now(),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  check ((kind = 'care_and_record' and decision in ('given', 'unable'))
      or (kind = 'privacy_notice' and decision in ('acknowledged', 'declined', 'unable', 'not_offered'))),
  check (decision not in ('unable', 'not_offered') or reason is not null)
);
create index patient_consents_patient on sineobex.patient_consents (team_id, patient_id, kind, recorded_at);
create trigger patient_consents_append_only before update or delete on sineobex.patient_consents
  for each row execute function sineobex.forbid_mutation();

-- "Two edits to the same field keep both values and flag the record for review" (module 9).
-- The competing values are field_history rows (kind 'kept_both') carrying review_id.
create table sineobex.field_reviews (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references sineobex.teams (id),
  patient_id        uuid not null,                  -- the record's patient (canonical when opened)
  entity            text not null check (entity in ('patient')),
  record_id         uuid not null,
  field             text not null,
  needs             text not null check (needs in ('patients.edit', 'patients.correct_identity')),
  status            text not null default 'open' check (status in ('open', 'decided', 'obsolete')),
  opened_at         timestamptz not null default now(),
  opened_by_change  uuid,                           -- null when a merge opened it
  merge_id          uuid,
  decided_at        timestamptz,
  decided_by        uuid references sineobex.users (id),
  decision          jsonb,                          -- {kept: 'current' | 'alternate', historyId}
  comment           text check (comment is null or length(btrim(comment)) between 3 and 500),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  check ((status = 'open') = (decided_at is null))
);
create unique index field_reviews_one_open on sineobex.field_reviews (team_id, entity, record_id, field) where status = 'open';
create index field_reviews_queue on sineobex.field_reviews (team_id, status, needs, opened_at, id);
create index field_reviews_patient on sineobex.field_reviews (team_id, patient_id, status);

alter table sineobex.field_history add column review_id uuid references sineobex.field_reviews (id);
alter table sineobex.field_history drop constraint field_history_kind_check;
alter table sineobex.field_history add constraint field_history_kind_check check (kind in (
  'created', 'set', 'filled_blank', 'replaced_after_review', 'kept_both',
  'confirmed',          -- the same problem status observed again (9.2)
  'redirected',         -- an edit sent to a merged record, applied to its survivor (2.6)
  'corrected',          -- an admin identity correction (11.6)
  'review_decided',     -- an alternate chosen in a field review
  'merge_fill',         -- a survivor blank filled by a merge (reverted by undo)
  'merge_undone',       -- a merge_fill reverted
  'cleared_by_allergy', -- allergyScreen 'none_known' set back to 'not_asked' by an allergy (2.3)
  'entered_in_error'));  -- an allergy, problem or status marked entered in error

-- Every change made "with a reason": identity corrections, declined amendment requests, problem
-- reversals, review decisions on identity fields, merge undo. Old and new values are also in
-- field_history; this row holds the reason. Append-only.
create table sineobex.patient_corrections (
  id                   uuid primary key default gen_random_uuid(),
  team_id              uuid not null references sineobex.teams (id),
  patient_id           uuid not null,
  kind                 text not null check (kind in ('identity', 'amendment_declined', 'problem_reversal',
                         'reversal_declined', 'review_decision', 'merge_undo')),
  entity               text not null,
  record_id            uuid not null,
  field                text,
  old_value            jsonb,
  new_value            jsonb,
  reason               text not null check (length(btrim(reason)) between 3 and 500),
  requested_by_patient boolean not null default false,   -- HIPAA 164.526 amendment request
  history_id           bigint references sineobex.field_history (id),
  decided_by           uuid not null references sineobex.users (id),
  decided_at           timestamptz not null default now(),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id)
);
create index patient_corrections_patient on sineobex.patient_corrections (team_id, patient_id, decided_at);
create trigger patient_corrections_append_only before update or delete on sineobex.patient_corrections
  for each row execute function sineobex.forbid_mutation();

-- Moves whenever anything a team index entry shows changes (6.2). Statement-level triggers with a
-- transition table named `changed` (column lists are not allowed with transition tables).
create table sineobex.team_index_versions (
  team_id     uuid primary key references sineobex.teams (id),
  version     bigint not null default 0,
  updated_at  timestamptz not null default now()
);
create function sineobex.bump_team_index() returns trigger language plpgsql as $$
begin
  insert into sineobex.team_index_versions (team_id, version)
  select distinct team_id, 1 from changed
  on conflict (team_id) do update set version = sineobex.team_index_versions.version + 1, updated_at = now();
  return null;
end $$;
-- after insert / after update ... referencing new table as changed for each statement, on:
-- patients, patient_aliases, patient_allergies, field_reviews (0011: duplicate_pairs; 0012: patient_id_links).

-- One event may disclose several patients (a search, a match check). Their IDs go in
-- details.patientIds; this lets a patient's access report find them (module 10).
create index audit_events_patient_ids on sineobex.audit_events using gin (team_id, (details -> 'patientIds'));
```

Candidate retrieval, a function so the trigram operators resolve on both hosts and the threshold is set beside the query (5.4). **It ranks before it cuts** (review finding 4): each branch is limited separately in order of similarity or overlap, groups are ordered by their best name rank, and a birth year only breaks ties. A birth year never retrieves anyone on its own: a same-year patient whose name doesn't match can't reach `MATCH_POSSIBLE` (`DOB_ONLY_CAP`) or `SEARCH_MIN`, and at pilot sizes the year range alone (about 200 of 2,000 patients for an estimated age) would push the real match past the limit.

```sql
create function sineobex.patient_candidates(
  p_norms text[],          -- normalized query strings (each name, each alias)
  p_tokens text[],         -- query tokens plus their nickname partners
  p_year_lo int, p_year_hi int,   -- the query's birth year range, or nulls: orders ties, never retrieves
  p_sources text[],        -- key sources the caller may search (4.3)
  p_trgm real, p_word_trgm real,
  p_branch_limit int,      -- CANDIDATE_BRANCH_LIMIT: per query string (trigrams), and for tokens/codes
  p_limit int)             -- CANDIDATE_LIMIT
returns table (canonical_id uuid, name_rank real, year_in_range boolean)
language plpgsql volatile                  -- security invoker: RLS applies
set search_path = sineobex, public, extensions as $$
declare v_codes text[];
begin
  perform set_config('pg_trgm.similarity_threshold', p_trgm::text, true);
  perform set_config('pg_trgm.word_similarity_threshold', p_word_trgm::text, true);
  select coalesce(array_agg(distinct c), '{}') into v_codes
    from unnest(p_norms) as q(n), unnest(sineobex.name_codes(q.n)) as c;
  return query
  with trgm as (            -- spelling: the best keys for each query string. The mean of whole-string
                            -- and word similarity: word similarity alone rates "smity" as close to
                            -- "smit abcde" as to "smitty" (0.667 each), and a tie would cut by ID.
    select c.patient_id, c.r from unnest(p_norms) as q(n)
    cross join lateral (
      select k.patient_id, ((similarity(k.norm, q.n) + word_similarity(q.n, k.norm)) / 2)::real as r
      from sineobex.patient_name_keys k
      where k.team_id = sineobex.current_team_id() and k.source = any (p_sources)
        and (k.norm % q.n or q.n <% k.norm)                     -- GIN (team_id, norm gin_trgm_ops)
      order by 2 desc, k.patient_id limit p_branch_limit) c
  ),
  toks as (                 -- a whole token or nickname partner (0.8), else a sound-alike code (0.4),
                            -- plus a fifth of the key's best spelling similarity, so ties break by spelling
    select k.patient_id,
           ((case when k.tokens && p_tokens then 0.8 else 0.4 end)
            + 0.2 * (select max(similarity(k.norm, q.n)) from unnest(p_norms) as q(n)))::real as r
    from sineobex.patient_name_keys k
    where k.team_id = sineobex.current_team_id() and k.source = any (p_sources)
      and k.source <> 'descriptor'
      and (k.tokens && p_tokens or k.dm_codes && v_codes)        -- GIN, or the team-led PK (5.4)
    order by 2 desc, k.patient_id limit p_branch_limit
  ),
  ranked as (
    select p.canonical_id, max(h.r)::real as name_rank,
           coalesce(bool_or(p.birth_year between p_year_lo and p_year_hi), false) as year_in_range
    from (select * from trgm union all select * from toks) h
    join sineobex.patients p on p.team_id = sineobex.current_team_id() and p.id = h.patient_id
    group by p.canonical_id
  )
  select r.canonical_id, r.name_rank, r.year_in_range from ranked r
  order by r.name_rank desc, r.year_in_range desc, r.canonical_id
  limit p_limit;
end $$;

-- A search by a full birth date and nothing else (5.2 requires the full date). Exact dates first,
-- then day and month swapped, then year-only or estimated births within p_range years; bounded.
create function sineobex.patient_candidates_by_birth(p_date date, p_range int, p_limit int)
returns table (canonical_id uuid)
language sql stable                         -- security invoker: RLS applies
set search_path = sineobex, public, extensions as $$
  with q as (select extract(year from p_date)::int as y,
                    -- day and month swapped, only when the day could be a month (SQL doesn't
                    -- promise to short-circuit an OR, so make_date must never see a day > 12)
                    case when extract(day from p_date) <= 12
                         then make_date(extract(year from p_date)::int, extract(day from p_date)::int,
                                        extract(month from p_date)::int) end as swapped)
  select p.canonical_id from sineobex.patients p, q
  where p.team_id = sineobex.current_team_id()
    and p.birth_year between q.y - p_range and q.y + p_range           -- (team_id, birth_year)
    and (p.birth_date = p_date
         or p.birth_date = q.swapped
         or p.birth_date is null)
  group by p.canonical_id
  order by min(case when p.birth_date = p_date then 0 when p.birth_date is not null then 1
                    when p.birth_year = q.y then 2 else 3 end), p.canonical_id
  limit p_limit
$$;
```

`sineobex.patient_of_change(p_entity text, p_record uuid, p_value jsonb) returns uuid` (`language plpgsql stable`, invoker): `patient` → `p_record`; `patient_alias`, `patient_allergy`, `patient_consent`, `problem`, `id_link` → the row's `patient_id`, else `p_value ->> 'patientId'` when it is a UUID; `problem_note` → its problem's patient (row, or a held problem create's value); `encounter`, `encounter_note` → today's lateral logic from `review.ts listQuarantine`. `listQuarantine` calls it instead of its joins.

RLS loop (0004 pattern) over `patients, patient_aliases, patient_name_keys, patient_allergies, patient_consents, field_reviews, patient_corrections, team_index_versions`. Grants: `revoke delete` on all except `patient_name_keys` (derived, rebuilt by trigger); `revoke update, delete` on `patient_consents, patient_corrections`.

### 1.3 `0010_problems.sql`

```sql
set search_path = sineobex, public, extensions;

create table sineobex.problems (
  id                    uuid primary key,
  team_id               uuid not null references sineobex.teams (id),
  patient_id            uuid not null,
  title                 text not null check (length(btrim(title)) between 1 and 200),
  code_system           text check (code_system in ('icd10cm')),
  code                  text check (code is null or code ~ '^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$'),
  code_display          text check (code_display is null or length(code_display) <= 300),
  sensitive             boolean not null,
  -- Sync field `status` = {status, encounterId}; history is field_history on (problem, status).
  status                text not null check (status in ('new', 'ongoing', 'resolved')),
  status_encounter_id   uuid,
  status_changed_at     timestamptz not null,      -- when the current status was observed (corrected time)
  status_changed_by     uuid not null references sineobex.users (id),
  status_checked_at     timestamptz not null,      -- last set or re-confirmation: module 5's 90-day check
  recurrence_of         uuid,                      -- an earlier Resolved entry that came back
  resolved_in_error_of  uuid,                      -- the Resolved entry this one stands in for (9.4)
  reversal_request      text check (reversal_request in ('open', 'reversed', 'declined')),
  merged_into           uuid,                      -- absorbed into another entry after a reversal
  error_reason          text check (error_reason is null or length(btrim(error_reason)) between 3 and 300),
  error_by              uuid references sineobex.users (id),
  error_at              timestamptz,
  source                text not null default 'manual' check (source in ('manual', 'encounter')),
  created_encounter_id  uuid,
  onset_date            date,
  author_user_id        uuid not null references sineobex.users (id),
  created_device_id     uuid references sineobex.devices (id),
  BOOKKEEPING,
  unique (team_id, id),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  foreign key (team_id, recurrence_of) references sineobex.problems (team_id, id),
  foreign key (team_id, resolved_in_error_of) references sineobex.problems (team_id, id),
  foreign key (team_id, merged_into) references sineobex.problems (team_id, id),
  foreign key (team_id, status_encounter_id) references sineobex.encounters (team_id, id),
  foreign key (team_id, created_encounter_id) references sineobex.encounters (team_id, id),
  check ((code is null) = (code_system is null)),
  check (num_nonnulls(recurrence_of, resolved_in_error_of) <= 1),
  check ((resolved_in_error_of is null) = (reversal_request is null)),
  check (merged_into is distinct from id),
  check ((error_reason is null) = (error_at is null))
);
create index problems_patient on sineobex.problems (team_id, patient_id, status);
-- The bag check (phases 6-7): coded New and Ongoing problems still on the list.
create index problems_open_code on sineobex.problems (team_id, code)
  where status in ('new', 'ongoing') and merged_into is null and error_reason is null;
create index problems_reversals on sineobex.problems (team_id, reversal_request, created_at) where reversal_request = 'open';

-- Notes on a problem. Append-only: a wrong note is followed by a correcting note.
create table sineobex.problem_notes (
  id                uuid primary key,
  team_id           uuid not null references sineobex.teams (id),
  problem_id        uuid not null,
  text              text not null check (length(btrim(text)) between 1 and 4000),
  encounter_id      uuid,
  written_at        timestamptz not null,           -- clock-corrected device time
  author_user_id    uuid not null references sineobex.users (id),
  created_device_id uuid references sineobex.devices (id),
  change_id         uuid,
  created_at        timestamptz not null default now(),
  foreign key (team_id, problem_id) references sineobex.problems (team_id, id),
  foreign key (team_id, encounter_id) references sineobex.encounters (team_id, id)
);
create index problem_notes_problem on sineobex.problem_notes (team_id, problem_id, written_at);
create trigger problem_notes_append_only before update or delete on sineobex.problem_notes
  for each row execute function sineobex.forbid_mutation();
-- RLS loop; revoke delete on problems; revoke update, delete on problem_notes.
```

### 1.4 `0011_duplicates.sql`

```sql
set search_path = sineobex, public, extensions;

-- A likely pair (patient_a < patient_b). Never merged automatically.
create table sineobex.duplicate_pairs (
  id                       uuid primary key default gen_random_uuid(),
  team_id                  uuid not null references sineobex.teams (id),
  patient_a                uuid not null,
  patient_b                uuid not null,
  score                    numeric(4, 3) not null check (score between 0 and 1),
  reasons                  text[] not null default '{}',       -- MatchReason values, never names
  sources                  text[] not null,                    -- 'sync', 'edit', 'merge_rematch', 'correction', 'staff_report'
  creator_dismissed        boolean not null default false,     -- the creator saw this match and said "Not them"
  status                   text not null default 'open'
                             check (status in ('open', 'not_sure', 'keep_separate', 'merged', 'superseded')),
  note                     text check (note is null or length(btrim(note)) between 3 and 200), -- the latest Not sure comment, shown to field staff
  superseded_by_merge      uuid,
  status_before_superseded text,
  first_flagged_at         timestamptz not null default now(),
  last_flagged_at          timestamptz not null default now(),
  decided_at               timestamptz,
  decided_by               uuid references sineobex.users (id),
  check (patient_a < patient_b),
  unique (team_id, patient_a, patient_b),
  foreign key (team_id, patient_a) references sineobex.patients (team_id, id),
  foreign key (team_id, patient_b) references sineobex.patients (team_id, id)
);
create index duplicate_pairs_queue on sineobex.duplicate_pairs (team_id, status, last_flagged_at, id);
create index duplicate_pairs_a on sineobex.duplicate_pairs (team_id, patient_a);
create index duplicate_pairs_b on sineobex.duplicate_pairs (team_id, patient_b);

-- Every decision with its required comment (Oct 12), who and when. Append-only.
create table sineobex.duplicate_decisions (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references sineobex.teams (id),
  pair_id     uuid not null references sineobex.duplicate_pairs (id),
  decision    text not null check (decision in ('merge', 'keep_separate', 'not_sure', 'undo_merge', 'flagged_by_staff')),
  comment     text not null check (length(btrim(comment)) between 3 and 500),
  survivor_id uuid,
  merge_id    uuid,
  decided_by  uuid not null references sineobex.users (id),
  decided_at  timestamptz not null default now()
);
create index duplicate_decisions_pair on sineobex.duplicate_decisions (team_id, pair_id, decided_at);
create trigger duplicate_decisions_append_only before update or delete on sineobex.duplicate_decisions
  for each row execute function sineobex.forbid_mutation();

create table sineobex.patient_merges (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references sineobex.teams (id),
  pair_id         uuid not null references sineobex.duplicate_pairs (id),
  survivor_id     uuid not null,
  merged_id       uuid not null,
  filled_fields   jsonb not null default '{}',   -- {field: version} written as merge_fill or cleared_by_allergy
  reviews_opened  uuid[] not null default '{}',
  -- A merge retires no ID link (D39). Undo fills this with the links it gave back (8.5).
  restored_link_ids uuid[] not null default '{}',
  decision_id     uuid not null references sineobex.duplicate_decisions (id),
  merged_by       uuid not null references sineobex.users (id),
  merged_at       timestamptz not null default now(),
  undone_at       timestamptz,
  undone_by       uuid references sineobex.users (id),
  undo_decision_id uuid references sineobex.duplicate_decisions (id),
  check (survivor_id <> merged_id),
  check ((undone_at is null) = (undone_by is null)),
  foreign key (team_id, survivor_id) references sineobex.patients (team_id, id),
  foreign key (team_id, merged_id) references sineobex.patients (team_id, id)
);
create unique index patient_merges_one_live on sineobex.patient_merges (team_id, merged_id) where undone_at is null;
create index patient_merges_survivor on sineobex.patient_merges (team_id, survivor_id, merged_at);
create index patient_merges_list on sineobex.patient_merges (team_id, merged_at, id);
-- bump_team_index triggers on duplicate_pairs (the index shows the duplicate hint).
-- RLS loop; revoke delete on all three; revoke update on duplicate_decisions.
```

### 1.5 `0012_id_links.sql`

```sql
set search_path = sineobex, public, extensions;

create table sineobex.patient_id_links (
  id                  uuid primary key,                -- made on the phone, or by the API online
  team_id             uuid not null references sineobex.teams (id),
  patient_id          uuid not null,
  token               text not null check (token ~ '^[A-Za-z0-9_-]{22}$'),   -- 128 bits, base64url
  token_hash          text not null check (token_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 of the token's ASCII
  status              text not null check (status in ('active', 'retired')),
  reason              text not null check (reason in ('first_card', 'lost', 'damaged', 'stolen', 'patient_request', 'other')),
  replaces_link_id    uuid,                            -- the link the issuer saw as active
  effective_at        timestamptz not null,            -- corrected device time (offline) or server time (online): decides conflicts
  clock_verified      boolean not null,
  made_offline        boolean not null,
  -- Only staff retire a token, by regenerating (module 2). A merge never does (D39).
  retired_reason      text check (retired_reason in ('regenerated', 'superseded_by_newer')),
  retired_by_link     uuid,
  retired_at          timestamptz,
  restored_at         timestamptz,                     -- a merge undo gave this record its token back (8.5)
  restored_by_merge   uuid,                            -- that patient_merges row
  issued_by           uuid not null references sineobex.users (id),
  issued_device_id    uuid references sineobex.devices (id),
  change_id           uuid,
  received_at         timestamptz not null default now(),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  check ((status = 'retired') = (retired_at is not null and retired_reason is not null))
);
-- Global, not team-led: a token must be unique across every team, because phase 9 resolves a card
-- before the scanner's team is known to match. Inserts use `on conflict (token_hash) do nothing`,
-- so a taken hash is a validation rejection, never an error inside a push.
create unique index patient_id_links_token_hash on sineobex.patient_id_links (token_hash);
-- One active token per patient RECORD (row). See the note below for the merged group.
create unique index patient_id_links_one_active on sineobex.patient_id_links (team_id, patient_id) where status = 'active';
create index patient_id_links_patient on sineobex.patient_id_links (team_id, patient_id, received_at);
-- bump_team_index trigger (the index shows the group's active link ids). RLS loop; revoke delete.
```

**One active token per patient, and merged groups (D39).** The partial unique index holds the PRD's "only one token per patient is active at a time" for every patient **record**: issuing never adds a second active link to a row. A merge moves nothing and retires nothing, so a merged group (the survivor and every record whose `canonical_id` is it) may hold one active link per record that had a card, and every one of them opens the surviving chart, because every read resolves a link's `patient_id` through `canonical_id` (the PRD: "invalidated only when staff regenerate the link"; the patient may be carrying either card). Every issue, online or offline, is made on the canonical record and, in the same transaction under the team lock, retires **every** active link in the group (10.4), so from the first regeneration after a merge the group has exactly one active token. No trigger enforces "one per group": a merge legitimately leaves two. The API tests assert the group invariant after every issue (13.3).

### 1.6 `0013_encounter_patient_fk.sql` (S1), and no permission migration

```sql
set search_path = sineobex, public, extensions;

-- Encounters name a real patient of the same team. NOT VALID: phase 2 preview and test rows may name
-- patients that never existed; every new or changed row is checked. The API checks first and answers
-- stale_reference (2.3), so the constraint never fires inside a push; if it ever did, the change's
-- savepoint (2.2 step 5) stores a rejection instead of stopping the phone's queue.
alter table sineobex.encounters add constraint encounters_patient_fk
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id) not valid;
create index encounters_team_patient on sineobex.encounters (team_id, patient_id, started_at);
```

S1 lands this file in the same PR as the encounter rule in `entities/encounter.ts` and the edits to `services/api/test/sync.test.ts` (~1218, 1278, 1533) that create a patient before pushing an encounter on it.

There is **no** permission migration: `known_permissions()`, the standard role rows and `CHW_PRESET` are unchanged (D37). `permissions.ts` gains three pure functions over the existing keys, used by routes, sync, the projection and the phone's cached permission list alike (4.1):

```ts
// services/api/src/auth/permissions.ts (no new keys)
export const FIELD_PERMISSIONS = ['patients.edit', 'encounters.chart', 'checkins.create'] as const;
export const hasFieldAccess = (p: ReadonlySet<Permission>) => FIELD_PERMISSIONS.some((k) => p.has(k));
export const mayHoldTeamIndex = (p: ReadonlySet<Permission>) => p.has('patients.view') && hasFieldAccess(p);
export const mayViewProblems = (p: ReadonlySet<Permission>) =>
  p.has('patients.view') && (p.has('encounters.chart') || p.has('billing.view_codes'));
```

The phone mirrors them in `apps/mobile/lib/patients/access.dart` over `LocalUser.teams[].permissions`, pinned by `packages/contract/test-vectors/access.json` (permission sets → expected answers).

---

## 2. Sync: patient-side records through the existing change protocol

The wire format (`SyncChange`, `SyncPush`, `SyncResult`) keeps its shape. Three additive changes: `ChangeEntity` and `RecordEntity` gain seven names; an **accepted** `SyncResult` may now carry `server` and `details` (2.5); `AuditAppend` gains actions and fields (2.8). Every hardened phase 2 rule (idempotency by change ID, hash-confirmed receipts, D16 follows, D17 quarantine, D19 fix folding, D21 hand-over, D24 batching) applies to patients unchanged.

### 2.1 Entities, operations, fields

| Entity | `create` value | Settable fields (`set`) and class (2.4) | Permission (2.2) | Parents that must exist | Phone category | Clock pause |
|---|---|---|---|---|---|---|
| `patient` | `PatientCreate` | `preferredName`, `visualDescriptor`, `livingSituation`, `usualArea`, `preferredLanguage`, `allergyScreen`, `idCardChoice`: **keep-both**. `legalName`, `birth`: **identity** | `patients.edit` | — | `patients` | no |
| `patient_alias` | `AliasCreate {patientId, alias}` | `removal` `{reason}`: **set-once** | `patients.edit` | patient | `patients` | no |
| `patient_allergy` | `AllergyCreate {patientId, substance, category?, reaction?, severity?, encounterId?}` | `enteredInError` `{reason}`: **set-once** | create `patients.edit`; set `encounters.chart` | patient, encounter if given | `patients` | no |
| `patient_consent` | `ConsentCreate {patientId, kind, decision, method, scriptVersion, language, reason?}` | none (**union**) | `patients.edit` | patient | `patients` | no |
| `problem` | `ProblemCreate` | `status` `{status, encounterId}`: **status**. `enteredInError` `{reason}`: **set-once** (author, or `patients.reverse_resolved`) | `encounters.chart` | patient; encounter, `recurrenceOf` or `resolvedInErrorOf` if given; a `status` set: its value's `encounterId` if not null | `problems` | yes |
| `problem_note` | `ProblemNoteCreate {problemId, text, encounterId?}` | none (**union**) | `encounters.chart` | problem, encounter if given | `problems` | yes |
| `id_link` | `IdLinkCreate {patientId, token, replacesLinkId, reason}` | none (the handshake is the create, 10.4) | `patients.edit` | patient | `patients` | yes |
| `encounter` (phase 2) | unchanged | `patientId` must now name a patient of the team (2.3) | `encounters.chart` | patient if given, on the create and on a `set patientId` | `encounters` | yes |
| `audit` | `AuditAppend`, extended (2.8) | — | any member | — | `activity` | no |

`ChangeEntity = ['encounter', 'encounter_note', 'audit', 'patient', 'patient_alias', 'patient_allergy', 'patient_consent', 'problem', 'problem_note', 'id_link']`; `RecordEntity` gains the same seven. Value schemas live in `services/api/src/sync/entities/values.ts` and are **not** registered as OpenAPI components (values travel as `value: unknown`, as `EncounterCreate` does today); the phone mirrors them in `lib/sync/entities.dart`, and `packages/contract/test-vectors/sync-values.json` (valid and invalid examples with the expected `details.problem` or Zod paths, and for each valid change the `parents` both registries must derive from it) pins Zod, the Dart validators and the fake to each other.

**Schemas validate and never transform** (review finding 21). `set()` and every `insert` store `parsed.data`, while the receipt confirms the hash of the value the phone sent (`precheck`); a `.trim()` would store a different string than the one confirmed. A string with leading or trailing whitespace is refused (`Trimmed`), and the phone trims every text input before it builds and hashes the value. `sync-values.json` holds `" Del"`, `"Del "` and `"Del\n"` as invalid.

```ts
// services/api/src/sync/entities/values.ts (all .strict(); no transforms; '' refused; null clears where allowed)
const Trimmed = (min: number, max: number) =>
  z.string().min(min).max(max).refine((s) => s === s.trim(), { message: 'untrimmed' });
const Name80 = Trimmed(1, 80);
const Text200 = Trimmed(1, 200);
const SyncReason = Trimmed(3, 300);   // the routes' shared Reason trims (a transform), so sync values use this
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate);
const LanguageTag = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
const ScriptVersion = z.string().regex(/^[a-z0-9_.-]{1,40}$/);
export const LegalName = z.object({ given: Name80.nullable(), family: Name80.nullable() }).strict()
  .refine((v) => v.given !== null || v.family !== null);
export const Birth = z.discriminatedUnion('precision', [
  z.object({ precision: z.literal('day'), date: IsoDate }).strict(),                  // 1900-01-01 .. server today + 1 day
  z.object({ precision: z.literal('year'), year: z.number().int().min(1900) }).strict(),       // .. current year
  z.object({ precision: z.literal('estimated'), year: z.number().int().min(1900) }).strict(),  // from an age
]);
export const LivingSituation = z.object({
  kind: z.enum(['unsheltered', 'vehicle', 'emergency_shelter', 'transitional_housing', 'couch_surfing',
                'hotel_motel', 'housed', 'institution', 'unknown', 'other']),
  other: Text200.optional(),                                                          // required iff kind = 'other'
}).strict();
export const RegistrationConsent = z.object({
  id: Uuid, decision: z.enum(['given', 'unable']), method: z.enum(['verbal', 'written', 'not_applicable']),
  reason: SyncReason.optional(),                                                      // required iff 'unable'
  scriptVersion: ScriptVersion, language: LanguageTag,
}).strict();
export const PrivacyNotice = z.object({
  id: Uuid, decision: z.enum(['acknowledged', 'declined', 'unable', 'not_offered']), reason: SyncReason.optional(),
}).strict();
export const MatchCheck = z.object({
  checkId: Uuid, where: z.enum(['phone', 'server', 'both']), indexVersion: z.string().max(40).nullable(),
  shown: z.array(Uuid).max(10), dismissed: z.array(Uuid).max(10),
}).strict();
export const PatientCreate = z.object({
  preferredName: Name80.nullable().optional(), legalName: LegalName.nullable().optional(),
  visualDescriptor: Text200.nullable().optional(), birth: Birth.nullable().optional(),
  livingSituation: LivingSituation.nullable().optional(), usualArea: Text200.nullable().optional(),
  preferredLanguage: LanguageTag.nullable().optional(),
  allergyScreen: z.enum(['not_asked', 'none_known']).optional(),
  idCardChoice: z.enum(['not_asked', 'wants', 'declined']).optional(),
  consent: RegistrationConsent, privacyNotice: PrivacyNotice, matchCheck: MatchCheck.optional(),
}).strict();
export const ProblemCode = z.object({
  system: z.literal('icd10cm'), code: z.string().regex(/^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/),
  display: Trimmed(1, 300).optional(),
}).strict();
export const ProblemCreate = z.object({
  patientId: Uuid, title: Text200, code: ProblemCode.nullable().optional(),
  status: z.enum(['new', 'ongoing']), sensitive: z.boolean().optional(),
  encounterId: Uuid.nullable().optional(), onsetDate: IsoDate.nullable().optional(),
  recurrenceOf: Uuid.optional(), resolvedInErrorOf: Uuid.optional(),                 // at most one
}).strict();
export const ProblemStatusValue = z.object({
  status: z.enum(['new', 'ongoing', 'resolved']), encounterId: Uuid.nullable(),
}).strict();
export const IdLinkCreate = z.object({
  patientId: Uuid, token: z.string().regex(/^[A-Za-z0-9_-]{22}$/), replacesLinkId: Uuid.nullable(),
  reason: z.enum(['first_card', 'lost', 'damaged', 'stolen', 'patient_request', 'other']),
}).strict();
export const Retraction = z.object({ reason: SyncReason }).strict();                   // removal, enteredInError
```

Aliases, allergies and an ID link typed at intake are **separate creates**, appended after the patient create in the same SQLite transaction (sequence order), never inside it.

### 2.2 The server pipeline (`services/api/src/sync/`)

`records.ts` becomes a registry: one module per entity in `services/api/src/sync/entities/` (`encounter.ts`, `note.ts`, `patient.ts`, `alias.ts`, `allergy.ts`, `consent.ts`, `problem.ts`, `problem-note.ts`, `id-link.ts`, `index.ts`), each exporting

```ts
export interface EntityRules<C> {
  entity: RecordEntityName;
  auditPrefix: string;                 // 'patient', 'alias', 'allergy', 'consent', 'problem', 'problem_note', 'id_link'
  permission(op: 'create' | 'set', field?: string): Permission;   // an existing catalog key (D37)
  takesTeamLock(change: SyncChangeInput): boolean;   // every patient-side change; an encounter create or
                                                     // `set patientId` naming a patient (D32)
  create: z.ZodType<C>;
  parents(value: C): ParentRef[];      // {entity, id}: must exist in the team (any status), or be held
  parentsOfSet(field: string, value: unknown): ParentRef[];   // problem status → its encounterId;
                                                              // encounter patientId → the patient
  insert(tx: Tx, input: CreateInput, value: C): Promise<Record<string, unknown> | null>;  // initial fields; null if ID taken
  fieldClass(field: string): FieldClass | null;   // 'draft' | 'keep_both' | 'identity' | 'status' | 'set_once'
  fieldSchema(field: string): z.ZodType | null;
  load(tx: Tx, id: string, lock: boolean): Promise<StoredRecord | null>;
  write(tx: Tx, rec: StoredRecord, field: string, value: unknown, version: number, meta: FieldMeta): Promise<number>;
  redirect?(tx: Tx, rec: StoredRecord): Promise<StoredRecord | null>;   // patient: canonical; problem: merged_into
  afterAccepted?(tx: Tx, audit: AuditFn, ctx: AfterCtx): Promise<Record<string, unknown> | void>;  // rematch, handshake
}
```

Changes, in code-path order:

1. **Permission per entity.** `ApplyActor.canChart: boolean` becomes `permissions: ReadonlySet<Permission>`, plus `isAuthor(record)` for the "author or admin" rule. `push.ts` passes `scope.team.permissions`; `review.ts decideQuarantine` passes the full catalog (the admin's accept is the approval, as `canChart: true` is today); `devices.ts recordAudit` (the removal hand-over, which only records audit entries) passes `new Set()` where it passes `canChart: false` today. `decide()` holds the change for review (`hold(..., 'permission')`) exactly where it checks `canChart` today. Every key named is an existing one (4.1).
2. **Team lock first.** In `processOne`, right after the change-ID lock and before any read or insert, a change for which `rules.takesTeamLock(change)` is true calls `lockTeamWrites(tx, teamId)` (`services/api/src/sync/locks.ts`: `select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || $1, 0))`, the exact key `append_audit` uses). That is every patient-side change, and an encounter create or `set patientId` whose value names a patient: inserting such an encounter takes `FOR KEY SHARE` on the patient row through the FK, which must not happen before the audit lock while a merge holds the audit lock and waits on that row (review finding 12; D32). Online routes that touch patient-side rows call it as their first statement, and `decideQuarantine` calls it before locking a patient-side item.
3. **`create()`**: parse with `rules.create`; check each `rules.parents(value)` exists in the team (any status, merged included); a missing parent is `stale_reference {problem: '<entity>_missing'}`, turned into `awaiting_review` when `heldCreate` (now looping over the change's parents) finds the person's own create of that parent pending in quarantine. Then `insert`, `created` history rows, audit `${prefix}.created`, `afterAccepted`.
4. **`set()`**: `load(id, lock: true)`; missing → `stale_reference {problem: 'record_missing'}` (or `awaiting_review`). Then every `rules.parentsOfSet(field, value)` must exist in the team, exactly as for a create: a problem `status` set whose `encounterId` the server doesn't have answers `stale_reference {problem: 'encounter_missing'}`, or `awaiting_review` when that encounter's create is the person's own, held (review finding 2). The `problems.status_encounter_id` and `encounters_patient_fk` constraints are therefore never what refuses a set. If `redirect()` returns another record (a merged patient's canonical, a merged problem's `merged_into`), the change applies there with `saw = false` and history kind `redirected` (2.7). Then the field class decides (2.4).
5. **A savepoint per change.** `processOne` runs `applyChange` inside `tx.savepoint(...)`. An integrity-constraint error (SQLSTATE class `23`: not null, foreign key, unique, check) rolls back to the savepoint and the change is stored as `rejected`, `validation {problem: 'server_constraint', constraint: <constraint name>}`, with its receipt and a `sync.rejected` audit event (the constraint name is schema, never a value). A check this design missed then costs one rejection the worker sees in Needs attention, never a phone queue stopped behind a change that fails the same way on every retry (review finding 1). Any other error (a deadlock, a lost connection) still aborts the transaction and stops the batch, as today, because it may succeed on retry and must not be stored. `push.ts` gains no log key. The helper (`applyInSavepoint` in `apply.ts`) is shared: `decideQuarantine` answers `409 cannot_apply` on the same class of error instead of a 500.
6. **Receipts.** `storeReceipt` stores `details` for accepted outcomes that carry any. `toResult` returns `server` and `details` on accept. `resultFromReceipt` returns the stored details and, for `kept_both` and `history_only`, reloads the record through the registry and returns the current `FieldState`, so a retry gets the answer the first attempt got.
7. **D16 exception.** `followsCurrent` returns false when the followed receipt's `details.outcome` is `kept_both` or `history_only`, or it has `redirectedTo`: that change never reached the chart, so the person never saw the chart's value. Without this, a person's second offline edit of a field whose first edit was kept as an alternate would match `serverVersion` and overwrite the chart.
8. `REJECT_MESSAGES` stay fixed strings; `details.problem` names the case and the phone maps it to plain text (`sync_labels.dart`).
9. `review.ts listQuarantine` resolves each item's patient with `sineobex.patient_of_change(...)`.

`push.ts` changes the actor and wraps each change in its savepoint. `devices.ts` changes only its actor (step 1): it quarantines everything else without applying.

### 2.3 Server rules per entity

All run inside `processOne`'s single transaction with the receipt and the audit event.

- **patient create.** Parse; `nothing_to_recognise` if preferred name, legal name and descriptor are all empty (checked before insert, so `patients`' check constraint never raises inside a push); `birth_in_future` against server today plus one day. Insert with `canonical_id = id`, `registered_at = when(c)`, `last_seen_at = registered_at`, the two consent rows (ids from the value), one `created` history row per given field. Re-run matching (8.2) under the team lock already held, marking `creator_dismissed` for IDs in `matchCheck.dismissed`. Audit `patient.created {changeId, clockVerified, matchCheckId}`. Accepted; `details.possibleDuplicate = true` when a pair was flagged against a patient the creator was not shown.
- **patient set**: the field classes (2.4). An accepted change to `preferredName`, `legalName` or `birth` re-runs matching (`edit`).
- **Someone must stay recognisable** (review finding 1). `patients_recognisable` spans four fields that sync one by one, so two phones that each clear a different one, both from version 1, each pass the field rules. Before **any** write to `preferredName`, `visualDescriptor` or `legalName` (a sync set, a redirected set, a field review decision, a merge undo reverting a fill), the server computes `recognisableAfter(rec, field, value)` on the locked row. A sync change that would leave nothing is **accepted `history_only`** with `details {outcome: 'history_only', problem: 'nothing_to_recognise'}` and `server` = the current value: the clear is kept in history, the chart keeps its value, and the phone shows a notice ("Kept the name: this person would have had no name or description left"). It is not a rejection, because the worker can't fix a race with another phone and it must not hold up a route confirmation. A review decision answers `409 nothing_to_recognise`; a merge undo keeps that fill and lists it in `keptFields`. The phone refuses locally to clear the last recognisable field it can see (a hard-stop mirror), so only a race reaches the server.
- **patient_alias create**: patient must exist; at most 20 active (`too_many_aliases`); an alias equal (normalized) to an active one is stored anyway and shown once. Audit `alias.created`; re-run matching. **removal**: set-once; audit `alias.removed`; re-run matching.
- **patient_allergy create**: at most 30 active (`too_many_allergies`); never merged by text ("PCN" and "penicillin" both show: safer than guessing). Audit `allergy.created`. If the group's canonical patient has `allergy_screen = 'none_known'`, the same transaction sets it to `not_asked` (field version + 1, history kind `cleared_by_allergy`, `changed_by` the allergy's author, the allergy's change ID), so "No known allergies" never stands beside an allergy whichever arrives first, and if that allergy is later marked entered in error the badge says "Allergies not asked yet" rather than reviving an older answer (review finding 16). **enteredInError**: needs `encounters.chart` (held for review otherwise), set-once; audit `allergy.entered_in_error`.
- **patient_consent create**: insert; audit `consent.recorded {kind, decision}`.
- **problem create**: `recurrenceOf` / `resolvedInErrorOf` must name a Resolved problem of the same patient group (`not_resolved` otherwise); `sensitive = value.sensitive || code in SENSITIVE_CODE_RANGES` (14.1); `status_changed_* = status_checked_at = when(c)`; `reversal_request = 'open'` when `resolvedInErrorOf` is set. Audit `problem.created` (and `problem.reversal_requested`). **status**: 9.2, after its encounter is checked as a parent (2.2 step 4). **enteredInError**: needs `encounters.chart`, and the author or `patients.reverse_resolved`, else held for review; set-once. A later status `set` on a problem marked entered in error is **accepted `history_only`**: the observation is kept in history and the problem stays retracted (review finding 7).
- **problem_note create**: problem must exist (`problem_missing` / `awaiting_review`). A note on a problem marked entered in error is **stored as sent** and shown with the retracted problem in its history; the accepted receipt carries `details {problemRetracted: true}`, and the phone tells the author "Your note was saved on a problem someone marked entered in error. If it belongs to another problem, add it there." A real clinical note written offline is never refused for something the worker couldn't see (review finding 7). A merged problem is fine too (stored as sent, shown on the survivor). Audit `problem_note.created`.
- **id_link create**: the handshake (10.4).
- **encounter create / set `patientId`**: takes the team lock first when it names a patient (2.2 step 2); the patient must exist in the team (any status), else `stale_reference {problem: 'patient_missing'}` or `awaiting_review`. The phase 2 tests that push random patient IDs create a patient first (S1 edits them with `0013`).

### 2.4 Field classes: the reconciliation rules

Notation: `cur` = the field's `FieldState` on the (redirected) record; `saw` = `baseVersion == cur.version || followsCurrent(...)`, always false for a redirected change; `same` = canonical-JSON equality; `fills(cur, v)` = `v` keeps every recorded part of `cur` and only adds to it (legal name: a null part gets a value; birth: none → any; `year` → `day` of the same year; `estimated` → `year` or `day` **only when the year is within `ESTIMATE_RANGE` of the estimate**, review finding 5).

| Class | Fields | Rule | Answer |
|---|---|---|---|
| **draft** (D9, unchanged) | encounter, note | as today | accepted / `conflict` |
| **keep-both** | patient `preferredName`, `visualDescriptor`, `livingSituation`, `usualArea`, `preferredLanguage`, `allergyScreen`, `idCardChoice` | `same` → no-op. `saw` or `isBlank(cur)` → write (`set` / `filled_blank`), unless the write would leave the patient unrecognisable (2.3: `history_only`, `nothing_to_recognise`). Otherwise keep both: history row `kept_both` (`value` = incoming, `previous_value` = `cur.value`, `review_id`), open or reuse the field's `field_reviews` row (`needs = 'patients.edit'`), audit `patient.field_contested {field, reviewId, changeId}`; the chart keeps its value. Special case: `allergyScreen = 'none_known'` while an active allergy exists in the group is `history_only` (the allergy wins; no review); the other order is handled by the allergy create (2.3). | accepted at `cur.version`; when not applied, `server` = `cur` and `details {outcome: 'kept_both', reviewId}` or `{outcome: 'history_only'}` |
| **identity** | `legalName`, `birth` | `same` → no-op. `isBlank(cur)` → write (`filled_blank`), whether or not `saw`: a blank holds nothing to overwrite. **`saw` and `fills(cur, v)`** → write (`filled_blank`); the person saw the current value, an admin's correction included, and only added a missing part. `saw`, an `estimated` birth refined outside `ESTIMATE_RANGE` → keep both with `needs = 'patients.correct_identity'` (the phone warns and sends it). `saw` and anything else → `validation {problem: 'identity_admin_only'}` (the phone never sends it: a hard stop mirror). **Not `saw` and `cur` not blank → keep both** with `needs = 'patients.correct_identity'`, even when `v` would fill `cur`: a stale offline fill never lands on a value it didn't see, so it can't undo an admin's correction (11.6, Oct 19) or replace an estimate with a date nobody compared (review finding 5). | as keep-both |
| **status** | problem `status` | 9.2; a `keep_server` resolution of a status conflict takes D9's existing path (the person's value kept as `kept_both`); a set on a problem marked entered in error is `history_only` | accepted / `conflict` / `validation` |
| **set-once** | alias `removal`, allergy `enteredInError`, problem `enteredInError` | Not yet set → write and change the row's status. Already set → `history_only` (kept in history). Never un-set: re-adding is a new record. | accepted |
| **union** | alias, allergy, consent, problem note *records* | every create is its own row; two phones never touch the same row | accepted |

Why the chart keeps its current value rather than the newest: "a field that already holds a different value is never overwritten silently" (Oct 19) still holds, every phone shows "Two values recorded" (the index and the chart carry open reviews), and a person who knows the patient picks (3.2). A keep-both or history-only outcome is **accepted**: the server holds that exact value (in `field_history`, hash-matched), so the phone lets go of it, it never becomes a Needs attention item and it never blocks a route confirmation. D9's side-by-side conflict stays for drafts, where the person editing is the author.

### 2.5 Accepted receipts that carry more

| `details` | `server` | Meaning | The phone |
|---|---|---|---|
| `{outcome: 'kept_both', reviewId}` | current `FieldState` | Stored as the other value of an open review | Confirm on hash match; the field takes `server.value` at `server.version` unless a newer local change to it waits; local notice "Two values recorded for Usual area. Someone who knows this person will choose." |
| `{outcome: 'history_only'}` | current `FieldState` | Kept in history, not applied (a stale observation, a second retraction, NKA over an allergy, a status on a retracted problem) | Confirm; take `server` the same way |
| `{outcome: 'history_only', problem: 'nothing_to_recognise'}` | current `FieldState` | The clear would have left no name or description (2.3) | Confirm; take `server`; local notice "Kept the name: this person would have had no name or description left." |
| `{redirectedTo, mergeId}` | — | The record was merged; applied to the survivor | Confirm; upsert `patient_redirects (from → to, origin 'receipt')`, a provisional hint that the next index or chart refresh replaces (2.9) |
| `{linkOutcome: 'active' \| 'retired', activeLinkId, retiredLinkIds}` | — | ID link handshake (10.4) | Confirm; update `id_links` (every retired ID); notice when `retired` |
| `{possibleDuplicate: true}` | — | The server flagged a pair the creator wasn't shown | Confirm; local notice "A reviewer will check whether this person already has a chart." |
| `{problemRetracted: true}` | — | A note stored on a problem marked entered in error (2.3) | Confirm; local notice to the author |

`SyncResult.server`'s description changes from "On conflict" to "On conflict, or when the value was kept but not applied". The hash rule is untouched: nothing is confirmed unless `r.hash == e.valueHash`.

### 2.6 Rejection, quarantine, stale reference

| Situation | Server answer | Phone | Who resolves |
|---|---|---|---|
| Schema or rule failure: `nothing_to_recognise` (a create), `birth_in_future`, `living_other_text`, `too_many_aliases`, `too_many_allergies`, `not_resolved`, `identity_admin_only`, `resolved_needs_admin`, `status_backwards`, `record_exists`, an untrimmed string | `rejected`, `validation`, `details.problem` (+ Zod paths, no values) | Needs attention; the fix is a new change with `supersedes` (D19 folds the record's later edits) | the worker |
| An integrity error no check caught (2.2 step 5) | `rejected`, `validation`, `{problem: 'server_constraint', constraint}`; stored, so the queue moves on | Needs attention "This entry has a problem"; the fix is a new change; the devices page counts it, so a missed check shows up as a bug report, not a stuck phone | the worker (and a bug fix) |
| `token_taken` (2⁻¹²⁸) | `rejected`, `validation` | Card stays blocked; Needs attention "Make a new card": a new link create with `supersedes` | the worker |
| A parent that doesn't exist in the team (or is in another team: RLS hides it) and isn't held, including the encounter a problem status `set` names | `rejected`, `stale_reference`, `patient_missing` / `problem_missing` / `encounter_missing` / `record_missing` | Needs attention "Attach to another patient" (search, then the fix); dependants held by `_classify` | the worker |
| A status `set` or a note on a problem marked entered in error | **not a rejection**: `history_only` / stored as sent with `problemRetracted` | Confirmed; notice for a note | nobody |
| A clear that would leave a patient with nothing to recognise | **not a rejection**: `history_only`, `nothing_to_recognise` | Confirmed; notice | nobody |
| A parent whose create is the same person's change held in quarantine | `rejected`, `awaiting_review`, `quarantined: true`, hash | Confirmed, listed as in review (D21) | admin, record first |
| A child create naming a **merged** patient or problem | **not a rejection**: stored as sent, shown on the survivor by group | Confirmed | nobody |
| A `set` on a merged patient's field or a merged problem's status | **redirected** to the survivor under the field's class with `saw = false` | Confirmed; redirect recorded | review if values differ |
| `id_link` for a merged patient | `rejected`, `stale_reference`, `{problem: 'patient_merged', survivorId}` | Token stays blocked; "This chart was merged. Make a new card from the kept chart." (a new create on the survivor with `supersedes`; `settle()` already follows `supersedes` across records) | the worker |
| Missing entity permission (CHW pushing a problem; role changed offline; not the author of a problem marked in error) | held for review (`permission`, `quarantined: true`, hash), as today | Confirmed, "sent to a Program Admin to review" (D17) | admin |
| User removed | hand-over to quarantine (D21), unchanged | | admin |
| Problem status moved backward from Resolved by a later observation | `conflict` with the server's status | The problem conflict card (9.3) | the worker |
| Hash mismatch | `rejected`, `hash_mismatch`, nothing stored (as today) | retried | |

So: **validation** is what the worker can fix; **stale_reference** is a parent the server never had (or a card for a merged chart); **awaiting_review** and **permission** go to quarantine because the worker can't fix them; a **merge** is not a stale reference, which is how the server "re-points it to the surviving record when it can" without changing a stored value.

### 2.7 Merges and phones that still hold the merged ID

Merges are online decisions (3.4); phones learn them at their next index refresh (`redirects`) or chart refresh. Until then a phone keeps sending changes that name the merged patient P2 (survivor P1):

| Late change naming P2 | Stored | Receipt | Shown |
|---|---|---|---|
| `encounter` create / `set patientId` = P2 | `patient_id = P2`, as sent | accepted, hash of the sent value | under P1 (group) |
| `patient_alias`, `patient_allergy`, `patient_consent`, `problem` create with `patientId` P2 | `patient_id = P2` | accepted | under P1 |
| `problem_note` on a problem of P2 | as sent | accepted | under P1 |
| `set` on P2's patient field | applied to P1's field under its class (blank fills, same is a no-op, different is keep-both), history kind `redirected` with `details {from: P2, changeId}` | accepted, `details.redirectedTo = P1` (+ `outcome` when kept both) | P1 |
| `set` on a record that belongs to P2 (alias removal, allergy entered in error, problem status) | applied to that record (it is part of the group) | accepted | under P1 |
| `id_link` create for P2 | rejected `patient_merged` (2.6) | rejected | |
| `patient` create whose ID is P2 (a retry) | the stored receipt (idempotent) | as stored | |

Chains (P3 → P2 → P1) need nothing extra: the merge rewrites `canonical_id` for every row whose `canonical_id` was the merged patient, so a lookup is one indexed read. Undo recomputes `canonical_id` down the undone patient's subtree (`with recursive` over `merged_into`), so everything stored with P2's ID goes back with P2, late arrivals included. A late `set` that was redirected to P1 stays on P1; the undo answer lists those changes (`field_history.kind = 'redirected'` with `from = P2` since `merged_at`) for the admin to move by hand: the one thing undo can't decide.

### 2.8 Offline audit entries (`AuditAppend`, extended)

```ts
const AuditAppend = z.object({
  action: z.enum(['patient.viewed', 'patient.searched', 'patient.match_checked', 'id_link.copied',
                  'encounter.viewed', 'note.viewed']),
  entity: z.string().regex(/^[a-z_]{1,40}$/).optional(),
  entityId: Uuid.optional(),
  patientId: Uuid.optional(),
  patientIds: z.array(Uuid).max(50).optional(),        // results or candidates shown, in order: SEARCH_MAX
  resultCount: z.number().int().min(0).max(100_000).optional(),
  criteria: z.array(z.enum(['name', 'birth_full', 'birth_year', 'descriptor'])).max(4).optional(),  // never the terms
  source: z.enum(['team_index', 'cache', 'local', 'server']).optional(),
  checkId: Uuid.optional(),                            // links a match check to the create that followed
}).strict();
```

The server writes one event per entry with `details.patientIds` (found by the new GIN index), `offline: true` and the change ID, as `decide()` does today. `local_store.dart appendAudit` mirrors the same rules, so an entry the server would refuse never enters the outbox. The limit is `SEARCH_MAX` (50) because **Show more** displays up to 50 patients offline and what can't be logged can't be shown (review finding 10); `sync-values.json` holds a valid entry with 50 IDs and an invalid one with 51, read by Zod, `entities_test.dart` and the fake. **Search text never enters an audit entry, online or offline** (D41; PLAN-OPEN for counsel, 14.1).

### 2.9 Phone store changes (`apps/mobile/lib/sync/`)

`LocalDatabase.schemaVersion` becomes 2; `_migrate` runs `_v2` in one transaction on a `user_version = 1` file, so phones holding phase 2 work keep it.

```sql
-- _v2 (additive)
ALTER TABLE records ADD COLUMN patient_id TEXT;      -- patient-side records: the patient they belong to
CREATE INDEX records_patient ON records (patient_id);

-- Why a server copy of a chart may stay on this phone (section 7). 'route' arrives in phase 7.
CREATE TABLE cache_scopes (
  patient_id TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('opened', 'today', 'route')),
  ref        TEXT NOT NULL DEFAULT '',                 -- the route ID in phase 7
  added_at   INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (patient_id, kind, ref)
);
CREATE INDEX cache_scopes_expiry ON cache_scopes (expires_at);

-- Merged patients this phone knows of (index, chart refresh, receipts). Never rewrites the outbox.
-- The server's lists are authoritative: the index swap and each chart bundle replace the rows they
-- cover, whatever their origin; 'receipt' rows are provisional hints until then (review finding 3).
CREATE TABLE patient_redirects (
  merged_id   TEXT PRIMARY KEY,
  survivor_id TEXT NOT NULL,
  merged_at   INTEGER,
  origin      TEXT NOT NULL CHECK (origin IN ('index', 'chart', 'receipt'))
);

-- The team search index (section 6): server data, replaced whole.
CREATE TABLE team_index (
  patient_id  TEXT PRIMARY KEY,
  entry_json  TEXT NOT NULL,              -- IndexEntry as received
  preferred   TEXT,                       -- for list rows and sorting
  birth_year  INTEGER,
  birth_date  TEXT,                       -- 'YYYY-MM-DD' when day precision
  last_seen   TEXT
);
CREATE TABLE team_index_staging (
  after        TEXT PRIMARY KEY,          -- the cursor the page was asked with ('' for the first)
  version      TEXT NOT NULL,
  entries_json TEXT NOT NULL,
  staged_at    INTEGER NOT NULL
);
-- Names for fuzzy search: the index, cached charts and patients made here. name is normalized (5.1).
-- source is 'preferred', 'alias' or 'descriptor': never a legal name, and nothing derived from one,
-- whatever the origin (D40). Rows of origin 'cache' and 'local' go with their chart (2.9-6).
CREATE VIRTUAL TABLE patient_names USING fts5(
  name, patient_id UNINDEXED, source UNINDEXED, origin UNINDEXED, tokenize = 'trigram'
);
-- PRAGMA secure_delete does not reach FTS5 segments: a deleted row's trigrams stay in
-- patient_names_data until this option is on (persistent; SQLite >= 3.42, checked at open).
INSERT INTO patient_names(patient_names, rank) VALUES ('secure-delete', 1);
-- ID links made or known here (10.5). Deleted with the chart (2.9-6).
CREATE TABLE id_links (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,                -- the record it was issued on; shown under its canonical patient
  token      TEXT,                        -- only links made here, or from a chart for patients.edit
  state      TEXT NOT NULL CHECK (state IN ('pending', 'active', 'retired', 'blocked', 'rejected')),
  replaces   TEXT,
  change_id  TEXT,
  effective_at INTEGER,
  updated_at INTEGER NOT NULL
);
-- Things to tell the person that are not rejections (kept-both, link outcomes, possible duplicate).
CREATE TABLE local_notices (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, patient_id TEXT, record_id TEXT,
  created_at INTEGER NOT NULL, read_at INTEGER
);
```

`kv` gains `index.version`, `index.refreshedAt`, `index.projection`, `index.count`, `intake.draft`.

`local_store.dart` (generic; patient specifics live in `lib/patients/`, section 15):

1. **Entity registry** `lib/sync/entities.dart`: per entity the local validators (the API's value schemas, as `_checkField` does today), `createdFields(value)` (replaces `_createdFields`), `parentsOf(entry)`, `patientOf(entry)`, `category`, `pausesWithClock`, and `mergeIntoCreate(fields, fixedValue)` (replaces the encounter and note branches of `fixRejected`). Categories: `patients` (patient, alias, allergy, consent, id_link) and `problems` (problem, problem_note), beside `encounters`, `notes`, `activity`. `parentsOf` agrees with the server's `parents` plus `parentsOfSet`, pinned by the `parents` lists in `sync-values.json`.
2. **`_classify` parents.** A change waits when any of `parentsOf(e)` is a blocked record or is created later in the outbox (`createdLater`), for every entity and for sets as well as creates. `parentsOf`: encounter create → `patientId`; encounter `set patientId` → the value; alias, allergy, consent, problem, id_link create → `patientId`; problem create → also `recurrenceOf`, `resolvedInErrorOf`, `encounterId`; **problem `set status` → the value's `encounterId`** (review finding 2: phase 4 fills it, and an encounter whose create was rejected must hold the status set behind it rather than let the server refuse it); problem_note create → `problemId`, `encounterId`; allergy create → `encounterId`. A held create blocks its own dependants (as today), so a rejected patient create holds its aliases, allergies, consents, problems and their notes, its ID link and any encounter on it; the fix releases them in the next batch.
3. **Clock pause per entity.** `setField` and creates call `_guardCharting()` only when `pausesWithClock(entity)` (problem, problem_note, id_link, encounter, encounter_note). Other changes are stamped (unverified while the clock is off) and never paused. `freeze()` (D21) still stops everything.
4. **`confirm(e, {serverVersion, server, details})`**: with `server` (kept both, history only), the field takes `server.value` and `server.version` unless its `pending_change` is a newer change; with `redirectedTo`, an upsert of `patient_redirects` (`origin 'receipt'`, on conflict of `merged_id` replace); `linkOutcome`, `possibleDuplicate`, `problemRetracted` and `nothing_to_recognise` call the hooks registered by `lib/patients/` (`onConfirmed`), all in the same transaction as the outbox delete.
5. **`replaceRejected(changeId, entity, newRecordId, value)`**: a fix that is a **new record** (a card for the survivor, "add as new problem"): appends the create with `supersedes = changeId` and marks the rejected entry superseded; `_deleteSettled` already follows the link.
6. **Purge.** A patient-side record (`records.patient_id` not null) is out of use when it is not open **and** no unexpired `cache_scopes` row covers its patient or the patient's survivor (through `patient_redirects`) **and** no local work references that patient (an open record, or an outbox entry whose `patientOf` is it): D23 generalized from "a note keeps its encounter" to "local work keeps its patient's chart". Then confirmed fields go, as today. `expireScopes()` runs inside `_purge`. **In the same transaction, for every patient whose chart is out of use, `_purge` deletes its `patient_names` rows of origin `cache` and `local` and every `id_links` row for it** (tokens included), so nothing of a chart, a name fragment or a token outlives the 24-hour scope on a phone that never signs out or lets its index expire (review finding 9; the FTS5 `secure-delete` option makes those deletes real on disk, finding 8). Index rows (`origin 'index'`) are the index's and go only with it. Encounter and note records keep their phase 2 rule.
7. **`clearServerData()`**: deletes `team_index`, `team_index_staging`, `patient_names` rows of origin `index` and `cache` and of origin `local` for patients no local work references, every `patient_redirects` row, every `cache_scopes` row, `id_links` rows of patients no local work references, and every server-origin patient-side record no local work references. Called at sign-out, at the 7-day expiry, on a 403 `index_not_permitted`, and first thing at open when the file's `serverCopiesStale` marker is set (6.3).
8. **`transaction(fn)`** made public, so `lib/patients/` writes a patient, its aliases, allergies, consents, ID link, FTS rows and scope in one SQLite transaction. **`_tx` becomes re-entrant** (review finding 15): the outermost call runs `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` as today; a nested call runs `SAVEPOINT tx_<depth>` / `RELEASE` and, on a throw, `ROLLBACK TO` and `RELEASE` before rethrowing. `appendAudit`, `confirm`, `resolveConflict`, `fixRejected` and `replaceRejected` can then run inside `transaction(fn)` (the search audit with its read, 5.6; the problem card's choice with its new problem, 9.3), and a throw anywhere undoes the whole outer transaction.
9. **`importServerRecord(r, {open, patientId})`**: chart imports use `open = 0`, `origin = 'server'`, governed by scopes; existing callers (a teammate's draft) keep `open = 1`. A field with a local edit waiting keeps the person's value (unchanged rule).
10. **Local creates and edits** of patient-side records add or extend an `opened` scope to 24 h from now, so the chart the worker stands in front of never goes half-blank after Update and save.
11. **Where a legal name may live on the phone** (D40): only in the `fields` of a patient record held by a scope or by local work (a chart the person opened, kept for today, or is working on), and in the outbox values of their own intake or edits until confirmed. Never in `team_index`, `patient_names`, `kv`, `local_notices` or a log. A store test walks every table after an intake, a chart download, the purge and `clearServerData()` and finds the seeded legal name only where this list allows.

`sync_engine.dart`: passes `r.server` and `r.details` to `confirm`; after `_refreshOpenRecords()` it runs the after-sync refreshers registered by the controller (`TeamIndexRefresher`, `ChartCacheRefresher`, section 6 and 7), best effort, skipped while frozen or with a wipe order. `fetchRecords` (server) checks each reference against its entity's read rule (4.3) instead of requiring `encounters.chart` for the whole call, and projects the snapshot.

### 2.10 What `FakeSyncServer` must mirror (`apps/mobile/test/sync/fake_server.dart`, plan risk 7)

1. The seven entities' value schemas, `.strict()` key sets and bounds (untrimmed strings refused), through the shared `sync-values.json` vectors, including each valid change's `parents`.
2. Per-entity permissions with existing keys only (`cannotChart` becomes `permissionsOf(userId)`, a set of catalog keys), the author-or-admin rule, held for review when missing; index eligibility through the same `access.json` vectors as the API.
3. Parent existence for every entity, for creates and for sets (`parentsOfSet`: a problem status's `encounterId`, an encounter's `patientId`), and `awaiting_review` through a generalized `_heldCreate` over parents; encounter `patientId` must name a known patient.
4. The field classes of 2.4 with their outcomes: `server` and `details.outcome` on accepted results, the identity rule (a fill only when `saw`, the `ESTIMATE_RANGE` limit, keep-both for a stale fill), the recognisability rule (`nothing_to_recognise` as `history_only`), the allergy-screen rule in both orders (`cleared_by_allergy`), and the D16 exception.
5. The problem status rules of 9.2, including the backward conflict, `resolved_needs_admin`, and `history_only` / `problemRetracted` on a problem marked entered in error.
6. Merges as test hooks (`merge(mergedId, intoId)`, `undoMerge(mergeId)`), canonical resolution, redirected sets with `details.redirectedTo`, children stored as sent, `patient_merged` for ID links, **no card retired by a merge**, and the complete redirect list on the index's first page and in chart bundles.
7. Duplicate flagging on patient create and identity edits, using the phone's own Dart scorer (`lib/patients/matching.dart`) without the phonetic term, with pairs suppressed after a `keepSeparate(a, b)` hook. The live test proves the server's scorer flags the same pair on the same data.
8. The ID link handshake over the canonical group: the phone's `replacesLinkId` must be active somewhere in the group; a winner retires every active link in the group; newer effective time wins a conflict; token-hash uniqueness; both `linkOutcome` receipts with `retiredLinkIds`; notices; undo restoring each record's own links.
9. Routes `/v1/patients/index` (pages, `have` → `unchanged`, redirects, 403 for a role without `patients.view` and a field permission), `/v1/patients/charts`, `/v1/patients/match`, `/v1/patients/search`, `/v1/team/notices`.
10. `AuditAppend`'s new actions and fields, `patientIds` up to 50.

Every rule above has one scenario in `sync_scenarios_test.dart` or `test/patients/patient_scenarios_test.dart`; the starred ones in 13.6 also run live.

---

## 3. API routes

Conventions (all already true of the app, `app.ts`, `auth/context.ts`): every route goes through `teamScope` (MFA, acknowledgements, membership); permissions are its `permissions` option ("all of"), or the new `scope.requireAny(perms, route)` helper in `auth/context.ts`, which logs a refusal as `access.denied` exactly as `require` does; work and audit commit in one `scope.tx`; `Cache-Control: no-store` app-wide. Phase 3 adds:

- **Names, birth dates and search text travel only in POST bodies.** Paths carry UUIDs; query strings carry cursors, status enums and field names only. `packages/contract/test/spec.test.ts` fails the build if any `parameters[]` entry in `openapi.json` is anything else.
- Admin decisions (corrections, review decisions on identity fields, duplicate decisions, undo, problem reversal and merge) use `recentAuth: true`, like member and quarantine decisions.
- Every patient read is projected by `projectChart(scope, ...)` / `projectSummary(scope, ...)` in `services/api/src/patients/projection.ts` (4.3). A field the role can't see is **absent**, never null.
- **Audit details never carry names, birth dates, search text, tokens or free text.** They carry IDs, counts, field names, versions, a `tokenRef` (first 12 hex of the token's SHA-256) and, for comments and reasons, the row ID plus `commentSha256`; the text lives in its own table under the same access controls as the chart.
- **A refusal discloses nothing** (review finding 18). In this codebase `conflict()` is thrown inside `scope.tx`, which rolls back that transaction's audit events (`review.ts` audits its own refusal in a second transaction for this reason). So every 409 carries a code plus IDs and versions only, never a field value, a summary or a token; the client re-reads what it needs through the audited GET. `spec.test.ts` asserts that no 409 response schema in `openapi.json` references `FieldState`, `PatientSummary`, `PatientChart` or `IdLinkView`.
- **Every permission is an existing catalog key** (D37); a route that needs a combination uses `requireAny` or the helpers of 1.6, and refuses with `access.denied` logged.
- Schemas: `services/api/src/patients/schemas.ts`, each registered with `.openapi(Name)`. Routes: `services/api/src/routes/{patients.ts, problems.ts, duplicates.ts}`, registered in `app.ts` after `registerSyncRoutes`. Keyset paging with an opaque `afterId` (or `after` for the index), fixed page sizes, no offsets.

### 3.1 Search, match, read, charts, index, history

| Method, path | Permission | Request → response | Audit (same transaction) |
|---|---|---|---|
| `POST /v1/patients/search` | `patients.view` | `PatientSearch {name?: string 1–100, birth?: BirthQuery {year, month?, day?}, limit?: 1–50 = 20, surface: 'portal' \| 'phone'}`; a name, or a full birth date; a year needs a name (no browsing by year) → `PatientSearchResult {hits: PatientHit[], truncated}`. Not paged: past 50 the screen asks for more letters or a birth year | `patient.searched {resultCount, patientIds (shown, in order), criteria, surface}`, `patient_id` null |
| `POST /v1/patients/match` | `patients.edit` | `PatientMatchRequest {preferredName?, legalName?: LegalName, aliases?: string[] ≤ 10, birth?: Birth, excludePatientId?, surface}` → `PatientMatchResult {checkId, candidates: PatientHit[] ≤ 5}` | `patient.match_checked {checkId, patientIds}` |
| `GET /v1/patients/{patientId}` | `patients.view` | → `PatientChart`. A merged ID answers the survivor's chart with `redirectedFrom` | `patient.viewed {source: 'portal' \| 'phone'}`, `patient_id` = canonical |
| `POST /v1/patients/charts` | `patients.view` | `FetchCharts {patientIds: uuid[1–50], reason: 'opened' \| 'today' \| 'refresh'}` (phase 7 adds `'route'` with `routeId`) → `ChartBundle {charts: PatientChart[], missing: uuid[], redirects: PatientRedirect[]}`; `redirects` is **every** live redirect into or out of the requested IDs and the returned groups, so the phone can replace what it holds for them (2.9). gzip (`hono/compress`), like the index: a bundle reflects only chart text that team members wrote, and anyone who can write it can already read the chart | one `patient.viewed {source: 'cache', reason}` per chart |
| `POST /v1/patients/index` | `patients.view` and at least one of `patients.edit`, `encounters.chart`, `checkins.create` (`mayHoldTeamIndex`, D37; else 403 `index_not_permitted`, logged) | `TeamIndexRequest {have?: string, after?: uuid, limit?: 100–1000 = 500}` → `TeamIndexPage {status: 'unchanged' \| 'page', version, projection, generatedAt, entries: IndexEntry[], next: uuid \| null, redirects: PatientRedirect[]}`; the first page carries the team's **complete** current redirect list (IDs and dates only), which the swap treats as authoritative. gzip on this route and the charts route only (nothing attacker-controlled is reflected) | per page `patient.index_downloaded {version, after, next, count}` (the page's exact ID range, D33); nothing on `unchanged` |
| `GET /v1/patients/{patientId}/history?field=&afterId=` | `patients.view` | → `FieldHistoryPage {entries: FieldHistoryEntry[], nextAfterId}`; `FieldHistoryEntry {id, entity, recordId, field, version, value, previousValue, kind, changedBy: UserRef, approvedBy: UserRef \| null, deviceTime, recordedAt, reviewId, correctionId}`; entries projected like the chart (problems need `mayViewProblems`, sensitive ones `view_sensitive`) | `patient.history_viewed {field}` |

`PatientHit {patientId (canonical), score, band: 'likely' | 'possible' | 'weak', reasons: MatchReason[], summary: PatientSummary}`; `PatientSummary {preferredName?, legalName?, aliases?: string[] ≤ 5, visualDescriptor?, birth?: BirthView, ageYears?, usualArea?, lastSeenOn?, allergy?: {screen, count, severe}, duplicateHint?: boolean}`, keys present per projection. **`legalName` is left out when `surface` is `'phone'`**: on the phone a legal name appears only inside a chart the person opened (D40), never in a result list or the duplicate panel. Search and match return canonical patients only; a merged patient's names still find its survivor. `MatchReason` is a closed enum (`name`, `alias`, `legal_name`, `descriptor`, `typo`, `nickname`, `sounds_like`, `initial`, `dob_exact`, `dob_swapped`, `dob_month_year`, `dob_year_slip`, `dob_year`, `dob_estimate`), so screens say why in plain words without the server sending prose.

`PatientChart {patient: RecordSnapshot, canonicalId, redirectedFrom?, mergedFrom: [{patientId, mergedAt, mergeId}], aliases: RecordSnapshot[], allergies: RecordSnapshot[], consents: ConsentView[], problems?: RecordSnapshot[], problemHistory?: ProblemStatusEvent[], problemNotes?: ProblemNoteView[], idLinks: IdLinkSummary[], reviews: FieldReviewView[], duplicate: {status, note} | null, projection}`. Snapshots are the shape `importServerRecord` already reads, so a chart keeps field versions for later offline edits. The group's aliases, allergies, consents, problems and **active ID links** are listed (everything whose patient has this `canonical_id`); `idLinks` is usually one entry, and holds one per merged record that had a card until the next regeneration (D39).

Small shared schemas: `BirthView {precision, date?, year?}`, `BirthQuery {year, month?, day?}`, `PatientRedirect {mergedId, survivorId, mergedAt}`, `ConsentView {id, kind, decision, method, recordedAt, recordedBy: UserRef}`, `IdLinkSummary {id, issuedOn (the record's ID), status, effectiveAt, madeOffline, url? (patients.edit only)}`, `ProblemNoteView {id, problemId, text, encounterId, writtenAt, author: UserRef}`, `IndexEntry` (6.1).

### 3.2 Identity corrections and field reviews

| Method, path | Permission | Request → response | Audit |
|---|---|---|---|
| `POST /v1/patients/{patientId}/corrections` | `patients.correct_identity`, recent sign-in | `IdentityCorrection {field: 'legalName' \| 'birth', value: LegalName \| Birth, baseVersion, reason: Reason, requestedByPatient: boolean, outcome: 'corrected' \| 'declined'}` (`declined` only with `requestedByPatient`: a HIPAA 164.526 amendment request refused, recorded with the requested value, chart unchanged) → `PatientChart`. Stale `baseVersion` → `409 field_changed {field, version}` (no value: the portal re-reads the chart through the audited GET); the same value → 200 no-op | `patient.identity_corrected {field, version, correctionId, requestedByPatient}` or `patient.amendment_declined {field, correctionId}` |
| `GET /v1/team/field-reviews?status=open&afterId=` | any of `patients.edit`, `patients.correct_identity` (rows filtered to what the caller may decide) | → `FieldReviewPage {reviews: FieldReviewView[], nextAfterId}` (50); `FieldReviewView {id, patientId, field, needs, current: FieldState, alternates: [{historyId, value, by: UserRef, deviceTime}], openedAt, status}` | `field_review.viewed {count}` + `patient.viewed {source: 'field_review'}` per patient on the page |
| `POST /v1/team/field-reviews/{reviewId}/decision` | the review's `needs`; recent sign-in when `needs` is `patients.correct_identity` | `DecideFieldReview {keep: 'current' \| 'alternate', historyId?, comment?: Reason (required for identity fields), baseVersion}` → `FieldReviewView`; stale `baseVersion` → `409 field_changed {field, version}`; an alternate that would leave the patient with no name or description → `409 nothing_to_recognise` (2.3) | `field_review.decided {reviewId, kept, historyId, version}` |

Keeping an alternate writes it to the chart (history kind `review_decided`, `approved_by` the decider; identity fields also write a `patient_corrections` row of kind `review_decision`), after the recognisability check (2.3), re-runs matching when the field identifies, and closes the review. Keeping the current value writes nothing to the chart and closes the review. Phones and the portal both call this route; offline, the phone shows the review read-only.

### 3.3 Problems (online admin actions; everything else is sync)

| Method, path | Permission | Request → response | Audit |
|---|---|---|---|
| `GET /v1/team/problem-reversals?afterId=` | `patients.reverse_resolved` | → `ReversalRequestPage {requests: [{request: ProblemView, original: ProblemView, patient: PatientSummary, requestedBy, requestedAt}], nextAfterId}` (50) | `problem.reversals_viewed {count}` + `patient.viewed {source: 'reversal_queue'}` per patient |
| `POST /v1/problems/{problemId}/reverse` | `patients.reverse_resolved`, recent sign-in | `ReverseResolved {reason: Reason, requestProblemId?}` → `ReverseResolvedResult {problem: ProblemView, mergeCandidates: ProblemView[]}` (this patient's New or Ongoing entries created after the resolution with the same code or normalized title, the request first) | `problem.reversed {historyId, correctionId}` |
| `POST /v1/team/problem-reversals/{problemId}/decline` | `patients.reverse_resolved` | `DeclineReversal {reason: Reason}` → `ProblemView` (the request stays a separate problem) | `problem.reversal_declined {correctionId}` |
| `POST /v1/problems/{problemId}/merge` | `patients.reverse_resolved`, recent sign-in | `MergeProblems {intoProblemId, comment: Reason}` → `ProblemView` (the survivor, both histories and notes) | `problem.merged {mergedId, intoId}` |

`ProblemView {id, title, code, codeDisplay, status, sensitive, statusHistory: ProblemStatusEvent[], notes: ProblemNoteView[], recurrenceOf, resolvedInErrorOf, reversalRequest, mergedInto, enteredInError: {reason, by, at} | null, createdAt, author: UserRef}`; `ProblemStatusEvent {historyId, status, encounterId, by: UserRef, at, kind}`.

### 3.4 Duplicates and merges

| Method, path | Permission | Request → response | Audit |
|---|---|---|---|
| `GET /v1/team/duplicates?status=&afterId=` | `patients.review_duplicates` | `status`: `open` (default; open and not sure), `not_sure`, `decided` → `DuplicatePage {pairs: DuplicatePairSummary[], nextAfterId}` (50, oldest flagged first, keyset on `(last_flagged_at, id)`). Pairs whose sides now share a canonical patient are not listed | `duplicates.viewed {status, count, patientIds}` |
| `GET /v1/team/duplicates/{pairId}` | `patients.review_duplicates` | → `DuplicatePairDetail {pair, a: PairSide, b: PairSide, compared: [{field, same: boolean}], decisions: DecisionView[]}`; `PairSide {chart: PatientChart, version, recentEncounters: [{id, startedAt, kind}] ≤ 5 (dates and kinds only), photo: null (phase 8), createdHow: 'phone_offline' \| 'phone', createdBy: UserRef}` | `duplicate.pair_viewed {pairId}` **once per patient** (`patient_id` set), so each patient's access report shows it |
| `POST /v1/team/duplicates/{pairId}/decision` | `patients.review_duplicates`, recent sign-in | `DecideDuplicate {decision: 'merge' \| 'keep_separate' \| 'not_sure', comment: Reason, survivorId? (merge), fieldNote?: string ≤ 200 (not sure), versions: {a: int, b: int}}` → `DuplicateDecisionResult {pair: DuplicatePairSummary, merge: MergeView \| null}`. Either patient changed since the reviewer loaded it, or no longer canonical → `409 pair_changed {versions: {a, b}}` (versions only; the page re-reads the pair); a decided pair → `409 already_decided` unless `not_sure` | `duplicate.decided {pairId, decision, decisionId, commentSha256}`; on merge also `patient.merged {mergeId, survivorId, mergedId}` once per patient |
| `POST /v1/team/duplicates` | `patients.edit` | `FlagDuplicate {patientA, patientB, comment: Reason}` → `DuplicatePairSummary` (staff who know two charts are one person; source `staff_report`) | `duplicate.flagged {pairId, sources}` with both IDs in `patientIds` |
| `GET /v1/team/merges?afterId=` | any of `patients.review_duplicates`, `patients.correct_identity` | → `MergePage {merges: MergeView[], nextAfterId}` (50, newest first); `MergeView {id, pairId, survivor: PatientSummary, merged: PatientSummary, comment, mergedBy, mergedAt, undone: {by, at, comment} \| null, undoable: boolean}` (`undoable` only for a caller with `patients.correct_identity`) | `merges.viewed {count, patientIds}`: both patients of every listed merge, so each one's access report finds the listing (review finding 19, D33) |
| `POST /v1/team/merges/{mergeId}/undo` | `patients.correct_identity` (undoing a merge is an identity correction; admin-only by default, D37), recent sign-in | `UndoMerge {comment: Reason}` → `UndoMergeResult {merge: MergeView, revertedFields: string[], keptFields: string[], reviewsClosed: number, redirectedEdits: [{historyId, field, at, by}], restoredLinks: [{linkId, tokenRef, issuedOn}], linksIssuedWhileMerged: [{linkId, tokenRef, issuedOn, reason, effectiveAt}]}`; a later merge on the group → `409 undo_later_merge_first` | `patient.merge_undone {mergeId, decisionId, commentSha256}` once per patient; `id_link.restored` per restored link |

### 3.5 ID links (online issue; the phone uses the `id_link` sync create, online or not)

| Method, path | Permission | Request → response | Audit |
|---|---|---|---|
| `GET /v1/patients/{patientId}/id-link` | `patients.edit` | → `IdLinkState {active: IdLinkView[], history: IdLinkView[]}` for the patient's whole group (a merged ID answers its survivor's); `active` is one link, or one per merged record that had a card until the next regeneration (D39); `IdLinkView {id, issuedOn, url (active only), tokenRef, status, reason, effectiveAt, issuedBy: UserRef, madeOffline, retiredAt, retiredReason, replacedBy, restoredAt}` | `id_link.viewed {linkId, tokenRef}` per active link shown |
| `POST /v1/patients/{patientId}/id-link` | `patients.edit` | `IssueIdLink {linkId: uuid (client-made, idempotency), replacesLinkId: uuid \| null, reason}` → `IdLinkState`. The server makes the token and issues it on the canonical record, retiring **every** active link in the group (10.4). `replacesLinkId` not active anywhere in the group (or null while one is) → `409 link_changed {activeLinkIds}`; a merged `patientId` → `409 patient_merged {survivorId}`. Neither 409 carries a URL or token: the portal re-reads through the audited GET, shows the current cards and asks again | `id_link.generated {linkId, tokenRef, reason, offline: false}`, and `id_link.retired {linkId, tokenRef, replacedBy, reason: 'regenerated'}` for each retired link |
| `GET /c` (portal, public, static) | none | the landing page (10.3); the server never sees the token | none |

Phase 9 adds `POST /v1/id-links/resolve {token}` (body, never a path); phase 3 reserves the name and the `tokenRef` convention.

### 3.6 Changes to existing routes

- `GET /v1/me` gains `idLinkBaseUrl` (from the new config `ID_LINK_BASE_URL`, https outside local and test), cached in `LocalUser`, so a phone builds the same URL offline.
- `POST /v1/sync/records` accepts the new `RecordEntity` values, checks each reference against its entity's read rule (4.3), projects the snapshot, and audits `patient.viewed {source: 'sync'}` for patient-side records.
- `GET /v1/team/notices` returns the new kinds (10.4, 9.4): `id_link_superseded`, `id_link_kept`, `id_link_conflict`, `problem_reversal_decided`. Kind, entity and record ID only.
- `GET /v1/team/devices` and the quarantine queue need no route change; their labels learn the new categories and entities (W0).

---

## 4. Permissions

### 4.1 Every check, mapped to the existing catalog (no new keys)

PRD module 1: custom roles use "any combination of the existing permissions; no new permission types in the MVP (Oct 12)". Phase 3 therefore adds **no permission key** (D37): no `known_permissions()` change, no role-row update, no new entry in `PERMISSIONS`, `CHW_PRESET`, the Roles page or `GET /v1/permissions`. Every check below uses the 23 keys of `0002_identity_access.sql`. Combinations are the three helpers of 1.6 (`hasFieldAccess`, `mayHoldTeamIndex`, `mayViewProblems`), mirrored on the phone.

| Action | Needs | Notes |
|---|---|---|
| Search, read a chart, charts for the cache, history | `patients.view` | the projection (4.3) decides what each part shows |
| Hold the **team search index** on a phone | `patients.view` **and** at least one of `patients.edit`, `encounters.chart`, `checkins.create` (`mayHoldTeamIndex`) | the field roles: Program Admin, Logistics, Healthcare Staff, the CHW preset, and any custom role that meets patients in person. Billing/Data never holds it (D38) |
| Intake, demographics, aliases, allergies (add), consents, ID links, flagging a pair, deciding ordinary field reviews, the match check | `patients.edit` | |
| Mark an allergy entered in error | `encounters.chart` | a clinical safety judgment |
| **View the problem list** (titles, codes, statuses, status history, notes) | `patients.view` and either `encounters.chart` or `billing.view_codes` (`mayViewProblems`) | Billing/Data sees codes, per the PRD. The CHW preset (demographics, check-ins and referrals, no clinical notes) sees no problem list |
| **Add or change a problem** (create, status, entered in error) or **add a problem note** | `encounters.chart` | entered in error also needs the author or `patients.reverse_resolved` |
| Move a problem from **Resolved back to Ongoing**; decline a reversal; merge two problem entries | `patients.reverse_resolved` | |
| **Review duplicates** (queue, compare, Merge, Keep separate, Not sure) | `patients.review_duplicates` | |
| **Undo a merge** | `patients.correct_identity` | undoing a merge is an identity correction; admin-only by default |
| **Correct a legal name or date of birth**; decline an amendment request; decide an identity field review | `patients.correct_identity` | |
| See sensitive problems (and, phase 5, sensitive secondary flags) | + `patients.view_sensitive` | Oct 19 |

No standard role's permission list changes, so the PRD's role table and every team's custom roles keep their meaning; a team that wants clinicians to review duplicates still creates "Healthcare Staff + Review duplicates" (module 2). A team can't deny the index to a field role except by taking away all three field permissions; that is the cost of no new permission types (14.2, PLAN-OPEN 14.1).

### 4.2 Standard roles and the CHW preset (unchanged) and what they get in phase 3

| Can | Program Admin | Logistics | Healthcare Staff | Billing/Data | CHW preset |
|---|---|---|---|---|---|
| Search and read charts (`patients.view`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Intake and demographics (`patients.edit`) | ✓ | ✓ | ✓ | – | ✓ |
| Team index on the phone (derived) | ✓ | ✓ | ✓ | – | ✓ (`patients.edit`, `checkins.create`) |
| Sensitive details (`patients.view_sensitive`) | ✓ | ✓ (Oct 19) | ✓ | – | – |
| See problems (derived) | ✓ | ✓ | ✓ | ✓ (`billing.view_codes`) | – |
| Add and change problems and notes (`encounters.chart`) | ✓ | ✓ | ✓ | – | – |
| Resolved back to Ongoing (`patients.reverse_resolved`) | ✓ | – | – | – | – |
| Review duplicates (`patients.review_duplicates`) | ✓ | via a custom role | via a custom role | – | – |
| Undo a merge; correct legal name and DOB (`patients.correct_identity`) | ✓ | – | – | – | – |

### 4.3 What each role sees (the projection)

Billing/Data follows the PRD's role table: "View charts, ICD-10/CPT codes and supply logs; run exports", and does not see sensitive details (Oct 19; D38). Nothing narrows it further: minimum necessary is met by the role table itself, and no PRD text gives a reason to hide aliases, allergies or consents from a role whose job is the chart.

| Part of the chart | Needs | PA | Log | HS | Billing | CHW |
|---|---|---|---|---|---|---|
| ID, status, merged-from, preferred name, legal name, birth, living situation, aliases, visual descriptor, usual area, language, last seen, ID card choice | `patients.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Allergies and allergy screen; consent records; open field reviews; duplicate hint | `patients.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| ID link status | `patients.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| ID link URL (Show link, Copy) | `patients.edit` | ✓ | ✓ | ✓ | – | ✓ |
| Problems: title, code, status, status history, notes | `mayViewProblems` | ✓ | ✓ | ✓ | ✓ | – |
| Sensitive problems (and, phase 5, sensitive secondary flags) | + `patients.view_sensitive` | ✓ | ✓ | ✓ | – | – |
| Team index on a phone | `mayHoldTeamIndex` | ✓ | ✓ | ✓ | – | ✓ |
| Legal name on the **phone** | inside a chart held under a scope only (D40) | ✓ | ✓ | ✓ | (no index; opened charts only) | ✓ |

Rules: **a role searches only by what it can see** (`patient_candidates` takes `p_sources` from the projection; with every part above open to `patients.view` it is all four sources for everyone in phase 3, and the parameter stays for later projections); **sensitive items are hidden, not counted** (no "1 hidden problem"); a sensitive problem the role can't see answers the same 404 as a missing one. Logistics' access to sensitive details follows Oct 19; its minimum-necessary reason goes in `docs/compliance/access-policy.md` (D unit).

Where checks happen: routes through `teamScope` options or `requireAny` (refusals logged `access.denied`); sync per entity in `decide()` (refusals held for review); responses through the projection functions, each with a unit test per role asserting the exact key set; RLS (team only) and composite FKs as the second and third lines.

---

## 5. Search and matching

One formula, implemented twice: `services/api/src/patients/matching.ts` and `apps/mobile/lib/patients/matching.dart`. Postgres and FTS5 only **find candidates**; the formula **scores** them. Shared vectors in `packages/contract/test-vectors/` pin the two implementations to each other and to Postgres (13.1), the way `canonical-json.json` pins canonical JSON today.

### 5.1 Normalization

| Step | Server | Phone | Pinned by |
|---|---|---|---|
| Accents, case, punctuation | `sineobex.normalize_name()` (0001): `lower(unaccent(...))`, every run of non-`[a-z0-9]` becomes one space, trimmed, `null` when empty | `normalize()`: a character map **generated from Postgres** (`select chr(c), unaccent(chr(c))` over U+00C0–U+024F, U+0300–U+036F, U+1E00–U+1EFF) into `packages/contract/data/unaccent-latin.json`, then ASCII lower case and the same regex | `normalize.json` (accents, ligatures, decomposed marks, `O'Brien`, `Mary-Kate`, `  big   MIKE `) produced by Postgres |
| Tokens | split on spaces; `WEAK_TOKENS` (`mr mrs ms miss dr big lil little old young jr sr ii iii the`, in `packages/contract/data/weak-tokens.txt`) are dropped for scoring unless nothing else is left ("Big Mike" finds "Mike"; "Big" alone still searches) | same list, generated | `match.json` |
| Nicknames | `packages/contract/data/nicknames.csv`: one line per given name and its nicknames, from `carltonnorthern/nicknames` at a pinned commit, plus `nicknames-local.csv` (Spanish diminutives: José/Pepe, Francisco/Paco/Pancho, Jesús/Chuy, Guadalupe/Lupe, Ignacio/Nacho, Enrique/Kike; transliterations: Mohammed/Muhammad/Mohamed/Mohamad, Ahmed/Ahmad, Hussein/Husayn). Two tokens are equivalent when they share a line. Generated into `services/api/src/patients/generated/nicknames.ts` and `apps/mobile/lib/patients/generated/nicknames.dart` by `pnpm contract:generate` (drift-checked). Expanded at query time only, so changing the list never needs a reindex | same | `match.json` |
| Sound-alike | Double Metaphone (`fuzzystrmatch`) via `name_codes()`; stored per key for retrieval, computed per token for scoring | **none** (PLAN-OPEN: a Dart port with Postgres-generated vectors, if pilot data shows offline misses) | `match.json` records `phoneScore` and `serverScore` separately |
| Trigrams | `pg_trgm` similarity: each word padded with two leading spaces and one trailing, set of 3-character windows, `|A∩B| / |A∪B|` | `trigramSimilarity()` in Dart, same definition (also in TS for scoring) | `trigram.json` generated from Postgres `similarity()` |

Non-Latin scripts are dropped by `normalize_name` today (risk 14.2-7).

### 5.2 The score

```
tokSim(q, c)  [normalized tokens; q from the query, c from a stored string]
  q == c                                                → 1.0
  otherwise the max of
    nickname(q, c)                                       ? NICKNAME_SIM : 0
    min(|q|,|c|) >= 3                                    ? 1 − osa(q, c) / max(|q|,|c|) : 0     -- optimal string alignment
    trigramSimilarity(q, c)
    (|q| == 1 && c starts with q) or (|c| == 1 && q starts with c) ? INITIAL_SIM : 0
    SEARCH ONLY: |q| >= 3 && c starts with q             ? PREFIX_SIM : 0                      -- typing "smi"
    SERVER ONLY: min(|q|,|c|) >= 3 && dm(q) ∩ dm(c) ≠ ∅  ? PHONETIC_SIM : 0

coverage(Q, C) = mean over q ∈ Q of max over c ∈ C of tokSim(q, c)          -- every typed token is found
symSim(A, B)   = (Σ_a max_b tokSim(a, b) + Σ_b max_a tokSim(b, a)) / (|A| + |B|)
nameSim(a, b)  = max(trigramSimilarity(norm a, norm b), symSim(tokens a, tokens b))

dobSim(x, y): absent if either is unknown, else
  both day:      equal 1.00 | day and month swapped (both ≤ 12, d ≠ m, same year) DOB_SWAPPED
                 | same year and month DOB_MONTH_YEAR | same month and day, years 1, 10 or 100 apart or with two digits
                 transposed (1946/1964) DOB_YEAR_SLIP | same year only DOB_YEAR | otherwise 0 (a conflicting DOB)
  day or year vs year:   same year YEAR_SAME | 1 apart YEAR_NEAR | otherwise 0
  either estimated:      |Δyear| ≤ ESTIMATE_RANGE → ESTIMATE_NEAR | otherwise 0
```

**Search** (Patients tab, portal): for each candidate group (a canonical patient and everything merged into it), `text = max` over its strings the caller may search (legal, preferred, each active alias, and the descriptor × `DESCRIPTOR_WEIGHT`) of `coverage(query tokens, string tokens)`. With a birth date in the query, `score = (1 − SEARCH_DOB_WEIGHT) · text + SEARCH_DOB_WEIGHT · dobSim` (or `text` when the candidate has none); a birth-date-only search scores `dobSim` and needs a full date. Shown when `score ≥ SEARCH_MIN`. `reasons` name the best string's source and how it matched.

**Match** (intake before saving, server re-run at sync): with every name string on each side (legal "given family", preferred, aliases; for a stored patient, the whole group; never the descriptor):

```
N     = max over pairs (a, b) of nameSim(a, b) · w(a, b)     -- w = 1 for name/name, ALIAS_WEIGHT if either is an alias
D     = max over the group's births of dobSim(new, stored)
total = D absent ? N · NO_DOB_FACTOR : W_NAME · N + W_DOB · D
if D absent and the best pair is one token on each side: total = min(total, SINGLE_NAME_CAP)
if both births are day precision and D == 0:             total = min(total, DOB_CONFLICT_CAP)
if N < NAME_FLOOR:                                        total = min(total, DOB_ONLY_CAP)
band  = total ≥ MATCH_LIKELY ? 'likely' : total ≥ MATCH_POSSIBLE ? 'possible' : none
```

A matching birth date alone never flags anyone (`DOB_ONLY_CAP`); two people known only as "Smitty" are a possible match at intake, never a queue item (`SINGLE_NAME_CAP`); aliases count slightly less than names because street names are shared.

### 5.3 Named constants

One file per platform (`services/api/src/patients/match-constants.ts`, `apps/mobile/lib/patients/match_constants.dart`), each constant marked `// PLAN-OPEN: tune on pilot data (module 2)`. `match.json` lists them under `constants`, and a test on each side fails if its values differ.

| Constant | Default | Meaning |
|---|---|---|
| `SEARCH_MIN` | 0.50 | lowest search score shown |
| `SEARCH_LIMIT`, `SEARCH_MAX` | 20, 50 | results per search, and with Show more |
| `MATCH_POSSIBLE` | 0.60 | intake shows "Possible match" |
| `QUEUE_THRESHOLD` | 0.70 | the server queues the pair |
| `MATCH_LIKELY` | 0.80 | intake shows "Likely the same person" and asks again on Create |
| `MATCH_LIMIT` | 5 | candidates per match |
| `CANDIDATE_LIMIT` | 200 server, 300 phone | candidates scored per query, cut only after ranking (5.4, 5.5) |
| `CANDIDATE_BRANCH_LIMIT` | 100 | keys per query string from the trigram branch, and from the token and code branch, each in order of similarity or overlap |
| `CANDIDATE_TRGM`, `CANDIDATE_WORD_TRGM` | 0.30, 0.50 | `pg_trgm` thresholds for retrieval |
| `NICKNAME_SIM`, `INITIAL_SIM`, `PREFIX_SIM`, `PHONETIC_SIM` | 0.90, 0.50, 0.80, 0.80 | token similarities |
| `ALIAS_WEIGHT`, `DESCRIPTOR_WEIGHT` | 0.90, 0.80 | string weights |
| `W_NAME`, `W_DOB`, `SEARCH_DOB_WEIGHT`, `NO_DOB_FACTOR` | 0.65, 0.35, 0.30, 0.85 | weights |
| `DOB_SWAPPED`, `DOB_MONTH_YEAR`, `DOB_YEAR_SLIP`, `DOB_YEAR` | 0.85, 0.60, 0.60, 0.40 | partial birth dates |
| `YEAR_SAME`, `YEAR_NEAR`, `ESTIMATE_NEAR`, `ESTIMATE_RANGE` | 0.60, 0.30, 0.40, 3 | year-only and estimated |
| `SINGLE_NAME_CAP`, `DOB_CONFLICT_CAP`, `NAME_FLOOR`, `DOB_ONLY_CAP` | 0.60, 0.45, 0.35, 0.40 | caps |

Worked examples (each is a vector):

| Query | Stored | N or text | D | Score | Result |
|---|---|---|---|---|---|
| search "Smity" | alias "Smitty" | `1 − 1/6 = 0.833` (trigram 0.625) | — | 0.83 | found through the alias (the done-when) |
| intake: preferred "Smitty", legal given "Del", born typed `7/3/46` (July 3, 1946) | preferred "Del", alias "Smitty", born 1946-03-07 | max(del/del 1.0, smitty/smitty 1.0 × 0.90) = 1.0 | swapped 0.85 | 0.65 + 0.30 = **0.95** | likely (the done-when) |
| Jon Smith, 1946-03-14 | John Smith, 1946-03-14 | (0.90 + 1 + 0.90 + 1) / 4 = 0.95 | 1.0 | 0.97 | likely |
| Mike, no DOB | Michael Jones | (0.90 + 0.90 + 0.20) / 3 = 0.67 (jones/mike by edit distance 0.20) | — | 0.57 | not warned; search still finds him |
| alias Smitty only, no DOB | alias Smitty | 0.90 | — | min(0.77, 0.60) = 0.60 | possible, not queued |
| different names, same DOB | | < 0.35 | 1.0 | ≤ 0.40 | nothing |

### 5.4 Server SQL (candidates only)

In the route's or push's transaction: `select canonical_id from sineobex.patient_candidates($norms, $tokens, $yearLo, $yearHi, $sources, CANDIDATE_TRGM, CANDIDATE_WORD_TRGM, CANDIDATE_BRANCH_LIMIT, CANDIDATE_LIMIT)` (1.2). `$norms` are the normalized query strings, `$tokens` the query tokens plus their nickname partners, `$sources` from the projection. `$yearLo`/`$yearHi` come from the query's birth (search) or the new patient's birth (match), and only order ties: neither search nor match retrieves by year alone. A search by a full birth date and no name calls `patient_candidates_by_birth($date, ESTIMATE_RANGE, CANDIDATE_LIMIT)` instead. Both functions order before they limit, so the true match is never cut at random (review finding 4); `patients-search.test.ts` and `duplicates.test.ts` hold it with 2,000 keys in a team where the target shares its birth year with 300 others. Each `lateral` applies `%` / `<%` to one constant, so the trigram GIN index can be used (a single `% any(...)` could not). Rechecked on Postgres 16 during the review, with ten teams of 2,000 keys: for the `%`-or-`<%` test, and for `&&` on codes and tokens, the planner reads the team-led primary key and filters within the team (`patient_name_keys_trgm` serves a bare `%`), which is bounded at these sizes. The same run checked the ranking: with 300 patients sharing the target's birth year and 160 decoys ("smit…", "smith…", "smitts…") that `word_similarity` rates as close to "smity" as "smitty" is (0.667), the target, given the UUID that sorts last, ranks first (0.646 against 0.487) for the search and for the intake match; an earlier draft that ranked by `word_similarity` alone, or let the token branch saturate at 1.0, put it 101st or left it to the ID tie-break. Then one query loads the groups:

```sql
select p.canonical_id, p.id, p.birth_precision, p.birth_date, p.birth_year, p.last_seen_at, k.source, k.norm
from sineobex.patients p
join sineobex.patient_name_keys k on k.team_id = p.team_id and k.patient_id = p.id
where p.team_id = sineobex.current_team_id() and p.canonical_id = any ($1::uuid[]) and k.source = any ($2::text[]);
```

and the server-only phonetic term reads per-token codes in one call (`select t, sineobex.name_codes(t) from unnest($1::text[]) t` over every distinct token involved). TypeScript scores, sorts by `score desc, last_seen_at desc nulls last, canonical_id`, and cuts. For matching it excludes the patient's own group and suppressed pairs (8.6). `team_id` is in every predicate, and RLS filters again.

### 5.5 Phone FTS5 (candidates only)

```sql
-- ≥ 3 characters: an OR of the query tokens' trigrams and their nickname partners' (≤ 60 terms); normalized
-- text is [a-z0-9 ] only, so double-quoting each trigram needs no escaping. An FTS5 auxiliary function
-- can't be used inside an aggregate (bm25() there fails with "unable to use function bm25 in the
-- requested context", verified on SQLite 3.45); the hidden rank column can (review finding 13).
SELECT patient_id, min(rank) AS r, group_concat(DISTINCT origin) AS origins FROM patient_names
WHERE patient_names MATCH '"smi" OR "mit" OR "ity"' GROUP BY patient_id ORDER BY r LIMIT 300;
-- 1–2 characters ("Al", "Jo"): FTS5 scans for short LIKE patterns, fine at a few thousand rows.
SELECT patient_id, group_concat(DISTINCT origin) AS origins FROM patient_names
WHERE name LIKE 'al%' OR name LIKE '% al%' GROUP BY patient_id ORDER BY patient_id LIMIT 300;
-- A full birth date and no name: day precision on that date or swapped, then year-only or estimated
-- births within ESTIMATE_RANGE, exact first; never a year alone (review finding 4).
SELECT patient_id FROM team_index WHERE birth_year BETWEEN ? AND ?
  AND (birth_date = ? OR birth_date = ? OR birth_date IS NULL)
ORDER BY (birth_date = ?) DESC, (birth_date IS NOT NULL) DESC, abs(birth_year - ?), patient_id LIMIT 300;
```

A trigram *phrase* match is substring search (the verified probe matched 'mitt' inside 'Smitty'), not typo tolerance ("smity" is not a substring of "smitty"), so the OR retrieves and the Dart scorer decides. A birth date in a name search never adds candidates; it orders ties and enters the score. Candidates are mapped through `patient_redirects`, grouped by patient (index, cached chart and local rows de-duplicated, local work winning), scored without the phonetic term, filtered by `SEARCH_MIN`, sorted like the server, and cut. Origins: `index` (team index), `cache` (cached charts: preferred name, aliases, descriptor), `local` (patients made here, not yet in the index: the same three). `fts_search_test` runs exactly these statements.

**Legal names offline** (D40). No legal name, and no trigram or phonetic code of one, is ever written to `patient_names`. A typed legal name is still useful offline: the search and the intake match also score, in memory, the legal names held in the `fields` of the charts this phone keeps under a scope or local work (at most the 50 kept for today, the charts opened in the last 24 hours, and patients made here), read by `patient_search.dart` straight from `records`/`fields` at query time. Results and the duplicate panel never display a legal name; the reason reads "Close to the legal name on a chart you opened". A 2,000-patient search is two indexed queries, one bounded scan of cached charts and a few hundred score calls; the CI benchmark (13.3) asserts it stays under 100 ms on the test runner.

### 5.6 What counts as one search, and its audit

A **search run** is a result list displayed after 600 ms without typing, or on submit. Each run is audited **before** its results render (D21's rule: what can't be logged can't be shown; a frozen store shows nothing):

- Online (phone or portal): `POST /v1/patients/search` (the server's own event), merged on the phone with patients made on this phone and not yet synced. The phone does not log twice.
- Offline, or when the server hasn't answered in 3 s: the local search, with `appendAudit('patient.searched', patientIds, resultCount, criteria, source)` in the same SQLite transaction as the read (`transaction(fn)` with the re-entrant `_tx`, 2.9-8).
- **Show more** is a run of its own: it displays up to `SEARCH_MAX` (50) and is audited, before it renders, with every patient it displays (≤ 50, the `AuditAppend` limit, 2.8).

Match checks follow the same rule (`patient.match_checked`, with `checkId`). Events carry who, when, the criteria, the result count and which patients were shown; **never the terms** (D41: search text is not stored in the audit log; PLAN-OPEN for counsel, 14.1).

---

## 6. The team search index on the phone

### 6.1 Contents, per role

Eligibility (D37): `patients.view` plus at least one of `patients.edit`, `encounters.chart`, `checkins.create` (`mayHoldTeamIndex`): Program Admin, Logistics, Healthcare Staff, the CHW preset, and any custom role whose holders meet patients in person. Billing/Data (D38) and any other role get `403 index_not_permitted`; the phone deletes any index it holds on that answer and searches only charts it has opened. The phone checks the same rule on its cached permission list first and doesn't ask when it fails.

`IndexEntry` (one per canonical, active patient):

| Field | Content | Why |
|---|---|---|
| `patientId` | canonical ID | what offline work attaches to |
| `preferredName` | preferred name | module 2 list |
| `aliases` | `[{id, alias}]`, active aliases of the whole group plus the preferred names of patients merged into it (≤ 20) | offline search; IDs so an alias can be removed offline |
| `visualDescriptor` | | recognition |
| `birth` | `{precision, date?, year?}` | full date when known: swapped day and month need it |
| `usualArea` | text only, never coordinates | recognition |
| `lastSeenOn` | date only | module 2 list |
| `allergyScreen`, `allergies` | `[{id, substance, category, severity}]`, active only; reactions stay on the server | the allergy hard stop (phase 6) for a patient matched off-route |
| `idLinks` | `[{id, effectiveAt}]` of the group's active links (usually one; one per merged record that had a card until the next regeneration, D39), or empty. **No token, no hash** | lets an offline regeneration name a link it replaces (the newest); phase 9 decides what scanning needs |
| `duplicate` | `{status: 'open' \| 'not_sure', note}` or null | "Possible duplicate under review"; the reviewer's Not sure note ("check ID card at next visit") shows at the visit |
| `reviews` | field names with an open review | "Two values recorded" offline |
| `versions` | `{preferredName, visualDescriptor, usualArea, allergyScreen}` field versions | an offline edit from the index carries a real `baseVersion` |
| `flags` | reserved: primary flag, secondary flags (phase 5; sensitive ones only with `patients.view_sensitive`) | absent in phase 3 |
| thumbnail | reserved (phase 8; team setting, off by default) | absent |

**Not in the index**, by design (module 2, §164.502(b)): legal names and anything derived from them (no trigram rows in `patient_names`, no phonetic codes; D40), living situation, language, consents, problems, notes, encounters, ID link tokens, history. The index holds only the PRD's list (patient ID, preferred name, alias, visual descriptor, DOB or year, usual area, priority flag, last-seen date, allergies) plus the bookkeeping above (versions, open reviews, the duplicate hint, active link IDs). Every eligible role gets the same fields in phase 3 (projection key `idx1`; phase 5 adds `idx1+sens`). `patients-index.test.ts` asserts the exact key set, and that no seeded legal name or its normalized form appears anywhere in a page's JSON.

### 6.2 Refresh: replaced whole, versioned, paged

- **Version** = `"<team_index_versions.version>.<projection>"`. The statement-level triggers (1.2) bump the counter on any change an entry shows (patients, aliases, allergies, links, open reviews, duplicate pairs, merges and undos through them). A role change changes the projection key, so it always forces a download.
- **When.** At the end of every `syncAll` that reached the server (at most every `INDEX_MIN_INTERVAL = 2 min`); every `INDEX_CHECK_INTERVAL = 15 min` while unlocked and online, on its own `SyncController` timer (sync ticks only while something is sendable); at unlock when older than 15 minutes; on pull-to-refresh on the Patients tab. Skipped while the store is frozen (D21) or a wipe is ordered.
- **Protocol.** `POST /v1/patients/index {have: kv('index.version')}`. `unchanged` → `index.refreshedAt = server time` (the server confirmed the copy is current). Otherwise the phone pages by keyset on patient ID, `limit` 500, halved after a timeout down to 100 and doubled back after each answer (the D24 pattern). Pages are staged in `team_index_staging`; a download cut off by a dead zone resumes from its last staged page; staging older than one hour is discarded.
- **Swap.** After the last page, one SQLite transaction: delete `team_index` rows and `patient_names` rows of origin `index`, insert the new rows and their names (preferred name, each alias, descriptor; normalized; never a legal name), delete `local` names of patients now in the index, **replace `patient_redirects` with the first page's complete list: delete every row, of any origin, whose `merged_id` the list doesn't hold, and upsert the list on `merged_id` with `origin 'index'`** (a receipt-learned redirect for a merge since undone goes here, so search and new work name the restored patient again; review finding 3), write `index.version` (the **first** page's version), `index.refreshedAt`, `index.projection`, `index.count`, clear staging; then re-key `cache_scopes` of merged patients to their survivors and purge. A change during the download bumps the version, so the next check downloads again: the index converges, and a search never sees half of one.
- "Replaced whole at each sync" (module 9) holds: whenever anything changed the phone receives an entire new copy, never a patch; when nothing changed, the copy it holds is the current whole.

### 6.3 Expiry and removal

- **7 days** after `index.refreshedAt` (`INDEX_LIFETIME`), checked at open, on every timer tick and before every search, against clock-corrected time; a phone clock earlier than the refresh counts as expired, so winding the clock back can't keep an index. Expired: `clearServerData()`; the Patients tab says "The patient list on this phone was more than 7 days old and was removed. Connect to download it again."
- **Sign-out**: with the key in memory (sign-out while unlocked, "Log out anyway" included), `clearServerData()` runs on every team database of the user before the session is forgotten; it deletes server copies only, never outbox work (D20 keeps local work, not server data). From the lock screen (no key), `SessionController.signOut` writes the secure-store marker `serverCopiesStale:<database file>` for each of the user's files; `SyncController._open` checks it first and runs `clearServerData()` before anything reads the file, then clears the marker.
- **403 `index_not_permitted`** (role changed, or a field permission removed): `clearServerData()` for the index.
- **Remote wipe and the tenth wrong PIN**: the file is deleted (existing).
- **Removal hand-over** (D21): the store is frozen; the index is neither refreshed nor searched (searching would need an audit entry, which a frozen store refuses), and goes with the wipe.

### 6.4 Size

About 350 bytes of JSON per entry: 2,000 patients ≈ 700 KB raw, ≈ 150 KB gzipped, four pages (each within the 20 s response bound at 30 kbit/s); on disk ≈ 1.5 MB with the FTS trigram index. A 10,000-patient team is twenty pages. `test/patients/team_index_test.dart` builds a 2,000-entry index from generated demo names and asserts the staged size and the swap time.

### 6.5 Attaching offline work to the right patient

- A hit from the index carries the canonical ID at download time; whatever the worker does next (alias, allergy, consent, edit, a new card, and in phase 4 the encounter) names that ID. If the patient was merged since, the server stores the work as sent or redirects it (2.7), and the next refresh teaches the phone the redirect.
- Opening an index-only patient offline imports the entry as a partial server copy (`records`/`fields` holding only the index fields at the index's versions, `attributes.partial = true`, an `opened` scope) and audits `patient.viewed {source: 'team_index'}`. The profile shows the index fields and "The full chart opens when the phone reconnects." Edit offers only the versioned index fields, alias add and remove, allergy add, consent, and the ID card; everything else says "This needs the full chart. Connect to download it."
- A patient made on this phone and not yet confirmed carries its device ID; `_classify` holds the work behind the patient's create, so it never arrives first, and a rejected create holds all of it. It appears in search at once (origin `local`, "Not synced yet").
- A patient the index doesn't have (made on another phone since the last refresh) is not findable offline. The worker makes a new patient; the server's re-run at sync queues the pair (8.2). This is the case the merge queue exists for.
- Work attached to the wrong patient (the wrong Mike) is undone the same way it was done: the alias removed or the allergy marked entered in error with reason "Wrong patient", and added to the right one.

---

## 7. The route-scoped cache, before routes exist

### 7.1 What phase 3 downloads

Module 9's route cache is "downloaded when a route starts … deleted at route end, at logout, or 24 hours after download". Phase 3 has no routes and no assignments, so it caches only charts a person chose to open or keep:

| Scope | Added when | Expires |
|---|---|---|
| `opened` | the worker opens a chart online (one `POST /v1/patients/charts {reason: 'opened'}` shows it and caches it), or creates or edits a patient-side record here (2.9-10) | 24 h after that download or edit |
| `today` | **Keep for today** on a profile, or on several selected search results (a lead preparing a run), at most 50 per person | 24 h after it was pinned |
| local work (implicit) | any open record or unconfirmed change references the patient | when that work is confirmed and closed; then the other scopes decide |
| `route` (phase 7) | the person's route starts | route end, or 24 h after download |

Nothing else is pre-downloaded: no caseload, no "my patients" (module 2: "Not caching full team history is deliberate"). Contents: the role-projected `PatientChart` (patient fields with versions, legal name included, aliases, allergies, consents, problems with history and notes if the role sees them, the group's active ID links with their tokens for `patients.edit`, open reviews, the duplicate hint). This is the only place a legal name rests on the phone besides the person's own unsynced work (D40). Phase 4 adds recent encounters and notes for `today` and `route`.

### 7.2 Expiry, refresh and purge

- A refresh never extends an expiry; opening the chart again online, or editing it, does.
- At the 15-minute index cadence, the phone re-downloads (`reason: 'refresh'`) only charts with a `today` scope or local work, so a teammate's edits reach a chart someone is relying on. `opened` charts simply expire, which keeps background disclosures (and their audit events) down.
- The purge (2.9-6) deletes a chart's confirmed fields and records once no scope is live and no local work references the patient, and in the same transaction its `patient_names` rows (origin `cache` and `local`) and its `id_links` rows with their tokens; FTS5 `secure-delete` removes the trigrams from the file (review findings 8 and 9).
- Sign-out, wipe and the hand-over treat cached charts like the index (6.3). A chart whose patient was merged is re-keyed to the survivor by the next index or chart refresh.

### 7.3 The seam phase 7 plugs into

```dart
// apps/mobile/lib/patients/chart_cache.dart
abstract interface class CacheSource {
  String get kind;                       // 'opened' | 'today' | 'route'
  String get ref;                        // '' or a route ID
  Set<String> patientIds();
  DateTime expiresAt(DateTime downloadedAt);
}
class ChartCache { Future<void> reconcile(List<CacheSource> sources); ... }
```

`ChartCache.reconcile` downloads what a source wants and the phone lacks (`POST /v1/patients/charts`, `reason` = the source kind) and lets the rest expire. Batches follow D24 (review finding 20): the first request asks for 10 charts, a timeout halves the next request down to 1, and each answer doubles it back up to 50; the response is gzipped (3.1). A 50-chart bundle with problem notes is far over the ~75 KB that fits the 20 s response bound at 30 kbit/s, so a fixed 50 would never finish on EDGE. Each answered batch is imported (and audited by the server) on its own, so a dead zone keeps what already arrived; a single chart that still times out is retried with the sync backoff after the others, and the profile says "Part of this chart hasn't downloaded yet" rather than showing it half-blank. Phase 7 adds `RouteSource` (expiry `min(route end, download + 24 h)`) and `FetchCharts {reason: 'route', routeId}`, which the server checks against route membership, so the audit dashboard's "charts viewed for patients not on the user's route" flag has its data. The purge needs no change (it only asks whether a live scope covers the patient), search needs no change (route patients are in the index; cached charts are searchable as origin `cache`), and "Staff can add a patient from the route screen" (Oct 19) is the same intake with an optional `routeId` added to `PatientCreate` then.

---

## 8. Duplicates, end to end

### 8.1 Before saving, online and offline

- **When.** Each time a name, alias or birth field loses focus, and again on **Create patient**. The local check (team index, cached charts, patients made here; 5.5) answers in milliseconds. Online, `POST /v1/patients/match` runs in parallel (it also sees legal names, sound-alikes and patients not yet in this phone's index); the lists merge by patient, keeping the higher score. The phone never waits more than 3 s; then the local list stands and the panel says "Checked against the patient list on this phone (updated 2 hours ago). The server checks again when this syncs." Each displayed candidate set is audited by whoever produced it (5.6).
- **Where.** An inline panel under the name fields, not a dialog: one card per candidate at or above `MATCH_POSSIBLE` (likely ones first), with what the role may see (preferred name, aliases, age and birth, usual area, descriptor, last seen; never a legal name on the phone, D40) and the reasons in words ("Street name matches · Birth date: day and month swapped"). Announced politely ("1 possible match"); focus stays where the worker is typing.
- **Two 48 px buttons per card.** **This is them** opens that chart and offers **Add what you typed**: each typed alias becomes an alias create, typed usual area or living situation become edits (keep-both handles any difference); the half-filled intake is discarded after one confirmation. Nothing is created, which is how most duplicates never happen. **Not them** folds the card to one line ("Not Del · Undo") and records the dismissal.
- **On Create.** If a `likely` candidate is still showing undismissed, a bottom sheet asks once: "Is this Del, born March 7, 1946, usually by the Elm St underpass?" with **Open Del's chart** and **No, create a new patient**. If every likely card was dismissed, no sheet. Create is never disabled.
- **What travels.** `patient.match_checked` (offline: appended before the candidates show, so the disclosure is logged even if the intake is abandoned), and in the create `matchCheck {checkId, where, indexVersion, shown, dismissed}`.

### 8.2 The server re-run at sync

`rematchPatient(tx, audit, patientId, source)` in `services/api/src/patients/duplicates.ts` runs inside the transaction of every accepted patient create (`source: 'sync'`), every accepted change to `preferredName`, `legalName`, `birth` or an alias (`'edit'`), every correction and identity review decision (`'correction'`), and for the survivor after a merge (`'merge_rematch'`). It retrieves and scores candidates (5.2–5.4), skips the patient's own group and suppressed pairs (8.6), and upserts every candidate at or above `QUEUE_THRESHOLD`:

- no row: insert `open` with `score`, `reasons`, `sources`, `creator_dismissed` (the candidate was in `matchCheck.dismissed`); audit `duplicate.flagged {pairId, score, sources}` with both IDs in `patientIds`;
- `open` or `not_sure`: keep the higher score, add the source, move `last_flagged_at`;
- `keep_separate`, `merged`, `superseded`: untouched.

A creator's "Not them" never suppresses the pair: a person reviews every pair at or above the threshold, and the reviewer sees "Jordan saw this match at intake and said it was someone else". The team lock (D32) is held, so two phones registering the same person at the same moment produce a pair: the second create's matching sees the first. A replayed change ID returns its receipt and runs nothing.

### 8.3 The queue

Portal `/team/duplicates` (12.2) lists open and not-sure pairs, oldest first, with both preferred names, birth years, the band, the reasons in words, the sources, "Creator said not the same" when set, and the Not sure note. A pair whose sides now share a canonical patient is set `superseded` when touched and not listed. The pair page shows both records side by side: photo (phase 8: "No photo yet"), preferred name, legal name, aliases, birth date, descriptor, usual area, living situation, allergies, problems (role permitting), ID card status, who created each record and how, last seen, recent encounters (dates and kinds; "No encounters yet" until phase 4), and **Same** or **Differs** in text on every row.

### 8.4 Decisions

Every decision needs a comment (`Reason`, 3–500 characters), records who and when (`duplicate_decisions`, append-only), needs a sign-in within 15 minutes, and carries the row versions the reviewer saw (`409 pair_changed` if either changed or is no longer canonical).

- **Not sure**: `status = 'not_sure'`, the pair stays in the queue. An optional `fieldNote` (≤ 200 characters, "check ID card at next visit") becomes the pair's `note`, shown to field staff on both charts and in the index; the form says "Shown to field staff on both charts. Don't include details of the other record."
- **Keep separate**: `status = 'keep_separate'`; suppression starts (8.6). Nothing on either chart changes.
- **Merge** (`survivorId` required; the form defaults to the older record). One transaction, team lock first:
  1. Lock both patient rows `FOR NO KEY UPDATE` (never `FOR UPDATE`: it would wait on the `FOR KEY SHARE` an encounter or allergy insert's FK check holds, D32); both active and canonical, versions as seen.
  2. `merged.status = 'merged'`, `merged_into = survivor`; `canonical_id = survivor` for every row whose `canonical_id` was the merged patient (the merged patient included).
  3. Fill the survivor's blank fields from the merged record (`fills`, 2.4, with its `ESTIMATE_RANGE` limit; identity fields too: filling a blank is not an overwrite), history kind `merge_fill`, `approved_by` the reviewer, recorded in `filled_fields`. If the survivor's `allergyScreen` is `none_known` and the merged record has an active allergy, the screen goes to `not_asked` (history `cleared_by_allergy`, recorded in `filled_fields` so undo restores it), as an allergy create would do (2.3).
  4. Every field holding different values on the two records opens a field review on the survivor with the merged record's value as the alternate (a `kept_both` history row attributed to that value's last writer; `needs` per 2.4; `merge_id` set). **Nothing is overwritten.**
  5. **ID links: nothing changes** (D39). Every active link of either record stays active and opens the survivor's chart, because the patient may be carrying either card and the PRD invalidates a token only when staff regenerate it. The next regeneration for the group, online or offline, retires them all and issues one (10.4).
  6. Open reviews on the merged record become `obsolete` (their values stay in history; step 4 re-raises real differences).
  7. Other open or not-sure pairs whose two sides now share a canonical patient → `superseded` (`status_before_superseded`, `superseded_by_merge`); `rematchPatient(survivor, 'merge_rematch')`.
  8. Insert `patient_merges` and the decision row; pair `merged`; audit `duplicate.decided` and `patient.merged` once per patient. The index version moves through the triggers.

Merging is never automatic, and nothing on a phone can merge.

### 8.5 Undo

`POST /v1/team/merges/{mergeId}/undo`, `patients.correct_identity` (an identity correction, admin-only by default; D37), recent sign-in, comment. Refused (`409 undo_later_merge_first`) while a later live merge involves the survivor's group: undo the later one first, so every undo is exact. One transaction, team lock first, patient rows locked `FOR NO KEY UPDATE`:

1. Merged patient back to `active`, `merged_into = null`; `canonical_id` recomputed for its subtree (`with recursive` down `merged_into` from it): everything stored with its ID, or with IDs merged into it earlier, goes back with it, including records that arrived after the merge, and every ID link issued on one of its rows.
2. Each `merge_fill` (or `cleared_by_allergy`) field still at the version the merge wrote goes back to its value before the merge (history `merge_undone`), unless that would leave the survivor with no name or description (2.3); fields edited since, and fills kept for that reason, stay and are listed as `keptFields`.
3. Reviews the merge opened and still open → `obsolete`; decided ones stay decided and are listed.
4. **ID links: each record gets its own tokens back, as they stood when the merge was made** (D39). A merge retired nothing, so without a regeneration since, there is nothing to do. When a regeneration on the group retired links while the merge was live, every such link issued on a row of the undone subtree (`retired_at ≥ merged_at`, `retired_by_link` issued on a row outside the subtree) becomes `active` again (`retired_*` cleared, `restored_at`, `restored_by_merge`; `id_link.restored` audited; listed as `restoredLinks` and in `patient_merges.restored_link_ids`). No subtree row can have gained an active link meanwhile (issuing always targets the canonical record and a merged ID is refused), so the per-record unique index holds. The link issued while merged stays on the record it was issued on, the survivor, and is listed as `linksIssuedWhileMerged`, so the admin can check which person carries that card (PLAN-OPEN 14.1).
5. Pairs this merge superseded return to `status_before_superseded`; the merged pair returns to `open` with an `undo_merge` decision row (it must be decided again).
6. Audit `patient.merge_undone` once per patient. The answer lists `redirectedEdits` (2.7) for the admin to move by hand, and `patient_corrections` records the undo's comment (`merge_undo`).

### 8.6 "Not the same person" suppression

A candidate pair (x, y) is suppressed when a `keep_separate` pair (a, b) has `{canonical(a), canonical(b)} = {canonical(x), canonical(y)}`, evaluated at match time with one `exists` over `duplicate_pairs` joined to `patients` twice. Suppression therefore survives merges ("A ≠ C" and "B = A" means "B ≠ C") and comes back correctly after an undo, with no decision row rewritten. Keep separate is never re-opened automatically (PLAN-OPEN: whether a corrected birth date should re-open it).

### 8.7 What every phone holding either record sees afterwards

| The phone holds | Until its next sync | After its next index or chart refresh |
|---|---|---|
| The merged patient in its index | finds it as before; new work names the merged ID and is stored as sent or redirected (2.7) | the entry is gone; the survivor's entry lists the merged record's preferred name and aliases; `patient_redirects` maps merged → survivor, so local links (an open allergy, a pending alias) show the survivor |
| A cached chart of either | unchanged | the merged chart is replaced by the survivor's, under the same scopes |
| The merged chart open on screen | unchanged | banner "This chart was merged into another on Oct 21. Open the combined chart." Editing from it is off |
| Unsynced work naming the merged patient | never rewritten (hashed) | sent as is; receipts carry `redirectedTo` |
| A pending ID link for the merged patient | | rejected `patient_merged`: "This chart was merged. Make a new card from the kept chart." The old card stays blocked here |
| A card made for either record | opens the chart it was made for | keeps working and opens the combined chart; the ID card screen lists "2 cards open this chart" until the next new card retires both |
| A pair decided Keep separate | the hint stays until refresh | no hint |
| A pair decided Not sure | | the hint shows the reviewer's note on both charts |
| A merge undone | as before the undo | both entries are back; the index swap deletes the redirect whatever its origin (a `receipt` row included), so a search for the restored patient finds it and new offline work (an alias, an allergy) names it, not the survivor; each record shows its own cards |

---

## 9. Problem list

### 9.1 Statuses and the phone's buttons

New, Ongoing, Resolved (Oct 12). Only New and Ongoing count toward the bag check (phases 6–7, `problems_open_code`). On the phone a problem shows its status in words with an icon and offers only the forward moves (New → Ongoing, New or Ongoing → Resolved). **Resolved asks once**: "Mark as Resolved? It stops counting toward route supplies, and only a Program Admin can undo it." On a Resolved problem the only action is **Still has this?** (9.4). Confirming the current status at a visit ("Still ongoing") is offered too, because module 5's 90-day status check needs the date someone last looked.

### 9.2 Who, when, which encounter: the server's status rule

Every status change is a `set` of `status` with `{status, encounterId}` (null outside an encounter, as in phase 3; phase 4 fills it). A non-null `encounterId` is a parent: it must exist in the team or the set answers `encounter_missing` / `awaiting_review` before anything is written, and the phone holds the set behind that encounter's create (2.2 step 4, 2.9-2). The `field_history` row records who (`changed_by`), when (`device_time`, clock-corrected `field_meta.at`), at which encounter (the value) and how (`kind`); `problems.status_changed_*` and `status_checked_at` are kept in step. Rank: new 0, ongoing 1, resolved 2. `cur` = current status observed at `T` (`field_meta.at`); the change observes `I` at `t` (`when(c)`).

| The phone… | Case | Result |
|---|---|---|
| saw the current version | `I = cur` | history `confirmed`, `status_checked_at = t`; accepted |
| | rank(I) > rank(cur) | applied (`set`) |
| | `cur` = resolved, `I` ≠ resolved | `validation {problem: 'resolved_needs_admin'}` (the phone never offers it) |
| | `cur` = ongoing, `I` = new | `validation {problem: 'status_backwards'}` |
| did not see it (stale) | `I = cur` | history `confirmed`; accepted |
| | `t < T` (an older observation) | history `kept_both`, not applied; accepted `{outcome: 'history_only'}` with `server` |
| | `t ≥ T`, rank(I) > rank(cur) | applied: progress, not disagreement |
| | `t ≥ T`, `cur` = resolved, `I` ≠ resolved | **`conflict`** with the server's status (9.3) |
| | `t ≥ T`, `cur` = ongoing, `I` = new | history only |
| any | problem entered in error | history `kept_both`, not applied; accepted `{outcome: 'history_only'}` with `server` (the observation is kept; nothing for the worker to fix) |
| any | problem merged into another | redirected to the survivor problem, then this table |

So the latest observation sets the status, nothing is lost (every observation is a history row with who, when and which encounter), and only a person with `patients.reverse_resolved` ever moves a problem out of Resolved.

### 9.3 The problem conflict card

In Needs attention, specific to problems because "Use mine" (reverse a Resolved) is not the worker's to choose:

> **Burn, left forearm** · Sam Okafor marked it **Resolved** on Oct 20 at 10:05. You marked it **Ongoing** on Oct 20 at 14:30 (offline).
> **Keep Resolved** · **It came back: add as a new problem** · **Resolved by mistake: ask an admin**

All three send `keep_server` on the conflict (`resolveConflict(keepMine: false)`: the person's value stays in history as `kept_both`, the conflict settles). The second also creates a problem (New, `recurrenceOf` the original); the third creates one (New, `resolvedInErrorOf` the original), which is the reversal request (9.4). Both in the same SQLite transaction as the choice: `transaction(() { resolveConflict(...); createProblem(...); })`, which the re-entrant `_tx` allows (2.9-8).

### 9.4 Resolved back to Ongoing: admin only, "entered in error", then the offer to merge

1. On the phone, **Still has this?** on a Resolved problem asks: "It came back (a new episode)" → a new problem, New, `recurrenceOf`; or "It never went away (marked Resolved by mistake)" → a new problem, New, `resolvedInErrorOf`, which sets `reversal_request = 'open'` and lists it in the portal's **Problems marked Resolved by mistake**. Either way care and the bag check carry on at once (module 2).
2. In the portal (`/team/problem-reversals`) the admin sees the original's history and the new entry, and chooses **Reverse** (reason required): `POST /v1/problems/{originalId}/reverse` sets the original to Ongoing as a `field_history` row of kind `entered_in_error` (`previous_value` the Resolved value, `approved_by` the admin), writes a `patient_corrections` row (`problem_reversal`, the reason), marks the request `reversed`, and sends the requester a `problem_reversal_decided` notice. Nothing is deleted; the audit log keeps both entries. Or **Decline** (reason required): the request becomes a separate problem (`reversal_request = 'declined'`).
3. After Reverse the portal offers at once: **Merge the new entry into the original?** (comment required). `POST /v1/problems/{newId}/merge` sets `merged_into`; its history and notes show in the original's timeline (read as a union), it leaves every list and the bag check, and a later status change from a phone that still holds its ID is redirected to the original (9.2). No undo for a problem merge in phase 3 (PLAN-OPEN); the rows are never lost.

An admin can also reverse a Resolved problem directly from the patient page, without a request.

### 9.5 Adding by hand, notes, recurrence, entered in error

- **Add problem** (Oct 19): title (required), code (optional), status New or Ongoing (chips, nothing preselected; Resolved is not offered at creation), onset date (optional), Sensitive (shown only to `patients.view_sensitive`; on and locked for sensitive codes). `source = 'manual'`; phase 4 adds `'encounter'`.
- **Code system: ICD-10-CM.** It is what the billing export carries (module 11) and it is public domain (SNOMED CT needs a UMLS licence and a billing map). The server checks the shape only, so a code-set update never becomes a sync rejection; phase 10 validates against the code set for billing. The phone ships a curated list of about 400 street-medicine codes (wounds and burns by site, cellulitis, abscess, frostbite, scabies, diabetes, hypertension, COPD, asthma, seizure disorder, hepatitis C, substance use disorders), generated from `packages/contract/data/icd10cm-curated.csv` into `apps/mobile/assets/problem_codes.json`, searchable by code and plain words ("burn" → "Burn of left forearm, first degree (T22.112A)"). A problem may be saved without a code; its row says "No code: won't add supplies to route bags". PLAN-OPEN: the list (Brooke and Mercy), and a full online code search later.
- **Sensitive by default** for codes in `SENSITIVE_CODE_RANGES` (`packages/contract/data/sensitive-code-ranges.csv`): F01–F99, O00–O9A, Z30–Z39, B20, Z21, A50–A64, Z71.4x. PLAN-OPEN with counsel (42 CFR Part 2 may widen it).
- **Notes**: `problem_note` creates, append-only, 1–4,000 characters, optional encounter; a wrong note is followed by a correcting note (addenda arrive in phase 4). Shown newest first with author and time, in one timeline with the status history.
- **Recurrence**: a real recurrence is a new entry, New, `recurrenceOf` the earlier one, which stays Resolved; "Came back · earlier episode resolved Mar 3". A second, different burn is a new entry with no link.
- **Entered in error** (whole problem): `encounters.chart`, and the author or `patients.reverse_resolved`, with a reason; hidden from lists, kept in history. Work that arrives for it afterwards from a phone that didn't know is kept, never refused: a status becomes history (`history_only`), a note is stored on the retracted problem and its author told (2.3).
- **Who sees and changes problems** (D37): seeing the list, its history and notes needs `patients.view` and either `encounters.chart` or `billing.view_codes`; adding a problem, changing its status, marking it entered in error and adding a note need `encounters.chart`; Resolved back to Ongoing needs `patients.reverse_resolved`. The CHW preset sees no problem list; the phone hides the section and the server never sends it.
- Title and code are not editable after creation (a wrong one is entered in error and re-added), which keeps the clinical history unambiguous.

---

## 10. ID links

### 10.1 Token

16 bytes from a cryptographically secure generator (`Random.secure()` on the phone, `crypto.getRandomValues` on the server), base64url without padding: 22 characters, `^[A-Za-z0-9_-]{22}$`. Never derived from a patient ID, name or time. A link has its own UUID (made on the phone for offline issue), so receipts and audit events name a link without repeating its token. `tokenRef` = the first 12 hex characters of `SHA-256(token)`, used in audit events and notices.

### 10.2 Storage: plaintext and hash, and why

The server stores the token (`patient_id_links.token`) and its SHA-256 (`token_hash`). Plaintext, because cards are often printed later, at the office, by someone other than the worker who met the patient: **Copy ID link** must work for anyone with `patients.edit` at any time, and a hash-only store would make regeneration (which kills the card in the patient's pocket) the only way to get the link again. The token is a pointer, not a credential: opening a chart from it (phase 9) needs a signed-in, MFA'd member of the patient's team with `patients.view`, who could find the patient by name anyway. The hash is what uniqueness, every lookup and phase 9's resolve use, so the plaintext appears in exactly one insert and the reads that build a URL for `patients.edit`, never in a `where` clause, a statement log or an audit row. Encrypted at rest (KMS on RDS; SQLCipher on the phone). PLAN-OPEN for the phase 12 risk analysis: app-layer encryption of the column, which changes no lookup.

On the phone, tokens exist only for links made here and in cached charts for `patients.edit`, and go with the chart (2.9-6); the index carries the active links' IDs only, so a lost phone can't print anyone's card.

### 10.3 URL and the landing page

`{ID_LINK_BASE_URL}/c#<token>` (PLAN-OPEN: the host, chosen before the pilot and kept registered for as long as cards circulate).

- The token is in the **fragment**, which browsers and QR scanners never send to a server: it can't reach a CDN, load balancer, WAF or portal access log, or a `Referer` header, whichever third-party tool opens it. The URL has no patient ID, name or team (a team's name can itself disclose care).
- `/c` is a static, public portal page (`apps/portal/src/app/c/page.tsx`, let through by `src/proxy.ts` without a session): generic title "Sineobex", `noindex`, `Referrer-Policy: no-referrer`, the portal's CSP and `no-store`, no third-party resources, one heading and one button: "This is a Street Medicine ID card. Staff: sign in to open the chart." It neither reads nor sends the fragment in phase 3; phase 9 adds the signed-in path. Text goes through the §1557 translation table.
- Beside **Copy link**: "Print only the code and your team's contact line. Don't print the person's name, birth date or health details on the card."

### 10.4 Lifecycle: one active link, online issue, offline issue and the handshake

**One active token per patient** (module 2), read with merges in mind (D39, 1.5). Per patient **record**, `patient_id_links_one_active` allows one active link. A merge retires nothing, so a merged **group** keeps every card its records had, and each opens the surviving chart: the PRD invalidates a token only when staff regenerate it, and the patient may be carrying either card. Every issue, online or offline, is made on the group's canonical record and retires **every** active link in the group, so after the first regeneration following a merge the group has exactly one active token. Undo gives each record back its own tokens as they stood (8.5). Nothing regenerates a link by itself; staff do, on request, with a reason (Lost, Damaged, Stolen, Patient asked, Other; "First card" for the first).

**The phone uses one path, online or not**: the `id_link` sync create, which simply confirms within seconds when there is signal.

1. Profile → **ID card** shows: "Active since Oct 3 · Copy link", "2 cards open this chart (two records were merged) · Copy either link · Making a new card stops both", "No card yet · Make a card", "Pending: works on this phone now; other phones learn it after this phone syncs", "Not valid: another card was made", "Blocked: make a new card", "Make the card once the phone's clock is right" (an intake that chose a card while charting was paused, 11.1), or "Declined a card" (Make a card then asks "They declined a card. Make one anyway?").
2. **Card lost or damaged? Make a new card** opens a sheet with the reason chips (a radio group, nothing preselected) and one sentence: "The old card stops working on this phone now, and on every phone after this syncs" ("Both old cards stop working…" when the group has two). Clock check applies (ID link conflicts are decided by device time).
3. One SQLite transaction: make the token; append the create `{patientId (canonical), token, replacesLinkId, reason}` (`replacesLinkId` = the newest active link this phone sees for the group, from the cached chart's `idLinks` or the index's `idLinks`; null when it sees none); insert the local `id_links` row `pending`; mark **every** active link of the group `blocked` here. The new card works at once on this phone and can be copied and printed on the spot. Other phones keep the old links until they refresh (phase 9 scanning there says "Card not active yet, search by name").
4. **Copy link** goes through `secureCopy` on the existing native channel (`org.sineobex.field/device`): on iOS a local-only pasteboard item that expires after 60 s; on Android a clip marked sensitive (`ClipDescription.EXTRA_IS_SENSITIVE`) and cleared when the app goes to the background. The screen announces "Link copied. It clears in 60 seconds." and appends `id_link.copied`.

**The handshake** (server, in the create's transaction, with the receipt and the audit events; module 2's "in one transaction"), under the team lock taken first (2.2):

1. `patients.edit`, or held for review (the old card stays blocked on the phone: "Sent for admin review. If the new card doesn't open the chart, make another once this is sorted"). The patient exists (`patient_missing` / `awaiting_review`) and is canonical (`patient_merged`, 2.6). The token is well formed. The link ID is not taken in the team (`select 1 … where id = $1` → `record_exists`; an ID in another team is the 2⁻¹²² case the change savepoint covers).
2. Lock the group's active links: `select l.* from sineobex.patient_id_links l join sineobex.patients p on p.team_id = l.team_id and p.id = l.patient_id where p.team_id = $team and p.canonical_id = $patient and l.status = 'active' for update of l`. Call this set `A`: empty, one link, or one per merged record that had a card.
3. Decide, before writing anything (review finding 14):
   - `A` is empty, or **`replacesLinkId` is in `A`** (the old token this phone named is still active somewhere in the group: module 2's "the old token is still the active one", read for groups): the new link wins, and every link in `A` retires (`regenerated`, `retired_by_link` = the new link).
   - otherwise another card was made since this phone looked (`replacesLinkId` null while `A` isn't empty, or no longer active): **the newer by `effective_at` wins** against `N`, the newest link in `A` (clock-corrected device time offline, server time online; a tie goes to the later receipt). If the new one is newer it wins and every link in `A` retires (`superseded_by_newer`); otherwise it loses. `user_notices`: `id_link_superseded` to the losing issuer, `id_link_kept` to the winning issuer, `id_link_conflict` to every member with `team.manage_users`; kind, entity `id_link` and the link ID only, and the app shows, after unlock and from its own data, "Two new cards were made for one patient. The card made on Oct 21 at 14:05 is the valid one." When either clock was unverified, the admin's notice says so (PLAN-OPEN: whether an unverified clock should lose a near-tie).
4. Write, inside a savepoint: retire the losers in `A` (when the new link won), then insert the new link on the canonical record **with its final status**: `active`, or `retired` with `retired_reason = 'superseded_by_newer'`, `retired_by_link = N.id` and `retired_at` (the row check needs both). `insert … on conflict (token_hash) do nothing returning id`: no row means the hash is taken in some team → roll back to the savepoint (the retirements with it) and answer `validation {problem: 'token_taken'}`. There is one conflict target only, so the per-record active index is never swallowed: when the insert runs, nothing in the group is active any more (the winner) or the new row isn't active (the loser).
5. Audit `id_link.generated {linkId, tokenRef, reason, offline}`, `id_link.retired {linkId, tokenRef, replacedBy, reason}` for each link that retired, and `id_link.conflict_resolved {winner, loser, effectiveAts, clockVerified}` on a conflict.
6. Receipt: **accepted** with the hash of the sent value (which contains the token: module 2's "receipt with the token's hash") and `details {linkOutcome: 'active' | 'retired', activeLinkId, retiredLinkIds}`. A losing link is accepted, not rejected: the server did store it (retired), so the phone may let go of it, and a rejection would sit in Needs attention with nothing the worker could fix. What the worker needs is the message, first on the ID card screen: "Another new card for Del was made at 2:14 PM, after yours at 1:50 PM. That card is the valid one; the card you printed won't open the chart. **Copy the valid link** · **Make a new card**".

After every issue the group has exactly one active link; `id-links.test.ts` asserts it after each case, including merge → regenerate (online and offline) and two concurrent pushes.

**Online issue from the portal** (`POST /v1/patients/{id}/id-link`) runs the same steps with server time, except that a `replacesLinkId` not active in the group (or null while one is) answers `409 link_changed {activeLinkIds}` (the portal re-reads, shows the current cards and asks again; only offline phones need the device-time rule).

**Rejections** (`validation`, `stale_reference`): the token stays **rejected** on the phone (never copyable) and in Needs attention with "Make a new card"; the fix is a new link (new record, `replaceRejected`, 2.9-5).

**Phase 9** resolves a token by its hash to the link, then the link's `patient_id` through `canonical_id`, so a card made for a merged record opens the combined chart, and after an undo opens its own record again.

### 10.5 The phone's link states

`id_links.state`: `pending` (made here, not confirmed), `active` (confirmed, or downloaded with a chart), `retired` (lost a conflict, or replaced), `blocked` (an old link this phone replaced, until the handshake), `rejected` (refused by the server). Rows are deleted with their chart (2.9-6). Phase 9 scanning reads this table first, so a card replaced on this phone is reported as replaced even before sync.

### 10.6 Audit events

`id_link.generated` (patient, user, device, time, link ID, `tokenRef`, reason, offline), `id_link.retired` (which link, replaced by which, who, why; one per link a regeneration retires), `id_link.conflict_resolved`, `id_link.restored` (merge undo gave a record its token back), `id_link.viewed` (portal and phone online reads of the URL), `id_link.copied` (phone, through `appendAudit`), and in phase 9 `id_link.scanned` for every scan, retired and unknown tokens included.

---

## 11. Intake and edit

### 11.1 Fields, in the order the phone asks

One scrolling form, nothing hidden behind "More"; a sticky **Create patient** button above the keyboard. Keyboard Next moves field to field. PHI text fields set `autocorrect: false`, `enableSuggestions: false` and `enableIMEPersonalizedLearning: false`, so names never enter the keyboard's learned words.

| # | Field | Required | Input | Sync |
|---|---|---|---|---|
| 1 | Consent (11.2) | yes | **Agrees** / **Unable to consent now** (reason chips) / **Declines** (ends intake) | `consent`, `privacyNotice` in the create |
| 2 | What do they go by? | one of 2, 4, 6 | text | `preferredName` |
| 3 | Street names | no | text + **Add**, a list with a 48 px **Remove** per row, up to 20 | `patient_alias` creates |
| 4 | Legal name, if given | one of 2, 4, 6 | given and family, side by side (stacked at large text) | `legalName`; pre-fills #2 with the given name when #2 is empty |
| 5 | Date of birth / Age | no | segmented **Date of birth \| Age**, one field, read-back (11.3) | `birth` |
| 6 | What they look like | one of 2, 4, 6 | text; hint "Lasting things help most: height, tattoos, a wheelchair, a scar. Clothes change." | `visualDescriptor` |
| 7 | Usually found | no | text (phase 7 may add a map pin; the words stay) | `usualArea` |
| 8 | Living situation (11.4) | no | chips, single choice; Other opens a required text box and moves focus to it | `livingSituation` |
| 9 | Preferred language | no | list, common local languages first | `preferredLanguage` |
| 10 | Allergies | asked | **Not asked yet** (default) / **No known allergies** / **Add allergy** (substance, category chips, severity chips, reaction) | `allergyScreen`, `patient_allergy` creates |
| 11 | Street Medicine ID card | no | **Wants a card** (makes the link at once, 10.4; while charting is paused for the clock, the chip says "The card can be made once the phone's clock is right" and no link is made) / **Declines** / **Ask later** | `idCardChoice`, `id_link` create |
| — | Profile photo | — | slot laid out, "Coming soon", excluded from semantics (phase 8) | — |

The duplicate panel (8.1) appears under fields 4–5 as matches arrive. Fastest complete intake: Agrees, a name, a birth year or date (plus one tap when the read-back asks), Create.

**Atomic.** Create writes in one SQLite transaction: the patient create, each alias, each allergy, the ID link, the FTS rows (origin `local`: preferred name, aliases, descriptor; never the legal name, D40) and the `opened` scope (`patient.match_checked` was appended when the candidates showed). **The clock never fails an intake** (review finding 17): ID links pause with the clock (D35), so when charting is paused and the person wants a card, the transaction records `idCardChoice = 'wants'` and makes no link; the profile and the ID card screen then say "Make the card once the phone's clock is right", and Make a card works as soon as the clock check passes. Nothing else in the intake pauses. A killed app never leaves half an intake. A form left before Create is kept as a draft in the encrypted database (`kv` `intake.draft`), never in plain storage; the Patients tab offers "Continue the patient you were adding?"; the draft goes on Create, on Discard, and with the database.

### 11.2 Consent: what exactly is consented to, and how it is recorded

What the person agrees to: **that this team keeps a record of their visits, used by the team and the health partners it works with to care for them.** Not treatment (HIPAA allows treatment without written consent; each encounter is its own act), not photos (phase 8 asks separately), not research or sharing beyond care. The same step offers the team's Notice of Privacy Practices and records the good-faith acknowledgement attempt (HIPAA §164.520(c)(2)(ii)), because a street visit is usually the first service delivery.

The script is short enough to read aloud in 15 seconds, versioned (`lib/patients/consent_script.dart`; version `2026-10-1`), and shown in large type in the person's language when a translation exists (§1557):

> "We keep a record of your visits so our team can take care of you. Only our team and the clinics we work with see it. Is that OK? We also have a paper about your privacy rights. Would you like it?"

Recorded in the create as two `patient_consents` rows:

- `care_and_record`: **given** (`method` verbal or written), or **unable** (unconscious, intoxicated, in crisis, language; reason required). The chart is created either way; "unable" puts a banner on it, "Consent not recorded yet. Ask at the next visit", until a later `patient_consent` create records `given` (**Record consent now** on the profile).
- `privacy_notice`: acknowledged, declined, unable, or not offered (with a reason). Recorded, never blocking.

**Declines**: no record is created. The screen says so and that care can still be given; phase 4 charts an encounter without a patient (`patientId` null, which encounters already allow). Who and when come from the change entry; `script_version` and `language` say what was read. PLAN-OPEN (counsel; Brooke and Mercy): the wording, whether verbal suffices, minors (a birth date under 18 shows the team's minor-consent guidance), and what a later withdrawal means.

### 11.3 The date-of-birth rule and its confirmation

`parseBirth(input, mode, today)` in `apps/mobile/lib/patients/dob.dart` and `apps/portal/src/lib/dob.ts`, both pinned by `packages/contract/test-vectors/dob.json` (fixed `today`). Clients send only the structured `Birth`; the API never parses typed dates and checks ranges only (a real date, not in the future, not before 1900).

| Typed (Date of birth mode) | Understood | Read back |
|---|---|---|
| `3/7/46`, `03-07-46`, `030746` | 1946-03-07 | "March 7, 1946 · age 80" + **Yes, that's right** |
| `3/7/1946` | 1946-03-07 | "March 7, 1946 · age 80" + confirm (day and month both ≤ 12) |
| `12/25/26` (on 2026-10-22) | 1926-12-25 (2026-12-25 is in the future) | "December 25, 1926 · age 99" + confirm |
| `1946` | year only | "Born in 1946 · about 80 (year only)" |
| `46` | year only, 1946 | "Born in 1946 · about 80 (year only)" + confirm |
| `2/30/80` | refused | "February has 28 or 29 days." |
| a future date, before 1900, a 3-digit year | refused | a specific message |
| Age mode: `46` | estimated, born about 1980 | "About 46 years old · born around 1980" |

- **The rule (Oct 19):** a two-digit year always means the past: the latest year ending in those digits whose full date is not after today; for a year alone, the latest such year before the current one. "46" becomes 1946.
- **Always read back**, month spelled out, never `03/07` (ambiguous), in a polite live region when the field loses focus or after 800 ms without typing.
- **One extra tap only when the phone guessed**: a two-digit year was expanded, day and month were both 12 or less and different, or the age is under 14 or over 100. The **Yes, that's right** toggle must be on before Create or Update and save; changing the input turns it off. A tap, not a dialog: the worker confirms while the patient is still there to correct them.
- **Age mode** exists so "46" heard as an age can't silently become a birth year; it stores `{precision: 'estimated', year}`, matched loosely (5.2).
- Month first (US pilot). PLAN-OPEN: a team setting.

### 11.4 Living situation

Chips, single choice: Unsheltered (street or outdoors) · Vehicle · Emergency shelter · Transitional housing · **Couch surfing** (was "Doubled up", Oct 19) · Hotel or motel (self-paid) · Housed · In an institution (hospital, jail, treatment) · **Unknown** (stays, Oct 19) · **Other** (opens a required 200-character text box, which takes focus). Stored as one field `{kind, other}` so the choice and its text change together, mapped to two columns so grant reports count it. Any imported "Doubled up" maps to `couch_surfing`. PLAN-OPEN: confirm against the Google Doc Contents tab, which owns option lists.

### 11.5 Edit: the intake form with Update and save

**Edit** on the profile opens the same widget filled from the cached chart (or the index fields, 6.5), titled "Edit details", with **Update and save** in place of **Create patient** (Oct 19). Differences:

- **Legal name and birth date**: blank parts are editable ("Not recorded yet. Add it if they give it.": a fill, 2.4). An estimated birth ("about 46") can be replaced by a year or a date the patient gives; within `ESTIMATE_RANGE` of the estimate it is a fill, and further away the form says "That's more than 3 years from the estimate. A Program Admin will check it." and sends it (the server keeps both and opens an identity review, 2.4). Recorded ones are read-only with a lock icon and "Only a Program Admin can correct this."
- **Someone must stay recognisable**: the form refuses to clear the last of preferred name, legal name and description it shows ("Keep a name or a description so the team can recognise them"); a race with another phone is settled by the server (2.3).
- **Consent** shows the decisions on record and offers **Record consent now** when it was "unable".
- Update and save sends one `set` per **changed** field, each with the version the form loaded, plus alias adds and removals (removal asks for a reason) and allergy adds; unchanged fields send nothing. The record is `open` while the form is on screen, so nothing is purged under it; Update and save closes it and the `opened` scope keeps the chart for 24 h.

### 11.6 Admin corrections with a reason

Portal only in phase 3, on the patient page, for `patients.correct_identity`: **Correct legal name or birth date** goes through the existing `/reauth` gate, shows the current value, takes the new value (same DOB parser and read-back), a required reason, and "The patient asked for this change" (a HIPAA §164.526 amendment). An amendment request can also be **declined** with a reason: recorded, chart unchanged. One transaction, team lock first: check `baseVersion`; write the field (history `corrected`, `previous_value`, `approved_by` the admin); a `patient_corrections` row; close any open review on that field as decided; re-run matching (`correction`); audit `patient.identity_corrected` (field name and correction ID, never the values). Phones see the new value at their next index or chart refresh; a pending staff fill of the same field, made before the phone saw the correction, arrives later as a kept alternate with an identity review (2.4: a change that didn't see the current value never writes over it), never over the correction.

### 11.7 Every edit logs the old and the new value

Every accepted write is a `field_history` row with `value` and `previous_value`, who, device, device time and kind; kept alternates, history-only observations, review decisions, corrections, merge fills and undos, redirects and problem reversals each have their own kind, plus a `patient_corrections` row where a reason is required. `GET /v1/patients/{id}/history` shows them; the profile's **History** (online) opens it per field: "Usually found: 'Elm St underpass' → 'Library steps' · Jordan Lee · Oct 21, 2:14 PM · phone, offline".

---

## 12. Screens

Rules for every screen, phone and portal: Day, Night run and High contrast themes (`lib/design/theme.dart`, the portal's tokens); 48 px targets (56 px for a screen's main action); text scaling to 200% with no clipping or horizontal scroll; state never by colour alone (every chip and badge has words and an icon); no patient detail in titles, app-bar text the OS task switcher shows, notifications, toasts ("Saved", never "Saved Smitty"), logs or URLs (UUIDs in portal paths and in-app routes only, D12); errors are fixed strings keyed by code. The one hi-vis element stays reserved for phase 4's Start button, so **New patient** uses the accent colour.

### 12.1 Phone (`apps/mobile/lib/features/patients/`)

**Navigation.** A bottom `NavigationBar` with **Home** and **Patients** in a go_router `ShellRoute` (`lib/app.dart`); Start, Schedule and Resources arrive with their phases. Routes: `/patients`, `/patients/new`, `/patients/:id`, `/patients/:id/edit`, `/patients/:id/card`, `/patients/:id/problems/new`, `/patients/:id/problems/:problemId`. The existing `sessionRoute` redirect keeps all of them closed while locked.

| Screen | What it does | Accessibility |
|---|---|---|
| **Patients** (`patients_screen.dart`) | Status line: "Patient list updated 2 hours ago · 1,204 patients", "Offline · searching the list on this phone (updated yesterday)", or the expiry message (6.3); pull to refresh online. Search field "Search by name, street name or what they look like" (focused when the tab is opened from the bar) and a **Born** chip (year or date, same parser). Results per search run (5.6): preferred name, "aka Smitty", "born 1946 · 80", usual area, last seen, allergy badge, "Possible duplicate" chip, "On this phone only" for an unsynced patient, and why it matched in words ("Close to street name Smitty"); never a legal name (D40); 20, then **Show more** (50, audited as its own run). Empty query: **Kept for today** and **Opened recently on this phone**. No results: "No one found on this phone." and **New patient with this name** (carries the typed name into intake). **Select** in the app bar turns rows into checkboxes for **Keep for today (3)**; nothing is long-press only. Sticky **New patient** in thumb reach | Polite live region "4 patients found on this phone" per run, never per keystroke; each row one button whose label reads the whole row ("Del, also known as Smitty, born 1946, age 80, usually by the Elm St underpass, last seen October 3. Allergy: penicillin, severe. Matched: close to street name Smitty"); the field keeps focus while results update; chips wrap at 200% |
| **New patient** (`intake_screen.dart`) | 11.1–11.4; consent card first; the DOB read-back and its **Yes, that's right** toggle; Back with anything typed asks "Keep this as a draft?" | Each section a heading; consent chips are a radio group (`Semantics(inMutuallyExclusiveGroup: true, selected:)`); errors listed at the top in the existing `ErrorMessage` live region, linked to their fields, focus to the first; the read-back is one sentence; "Other, selected, text box below"; the two legal-name fields stack at 200%; the focused field scrolls above the keyboard (`MediaQuery.viewInsets`) |
| **Duplicate panel and sheet** (`duplicate_panel.dart`, `same_person_sheet.dart`) | 8.1 | Cards announced politely, never taking focus; the comparison reads row by row ("Date of birth: July 3, 1946; existing record: March 7, 1946, differs"); the Create sheet takes focus on its heading, **Open Del's chart** first, **No, create a new patient** second, both full width; Back closes it with nothing done |
| **Profile** (`patient_screen.dart`) | Header (module 13): photo slot (phase 8; "blurred until tapped" later), preferred name, age and birth as recorded ("80 · born Mar 7, 1946" / "born 1946" / "about 46"), descriptor, **allergy badge** ("Allergies: penicillin (severe), peanuts" / "No known allergies" / "Allergies not asked yet"), derived from the group's active allergies first: any active allergy shows, whatever the allergy screen says, so a pending or late-arriving allergy is never hidden behind "No known allergies" (review finding 16); the index row and search results use the same precedence (`allergyBadge()` in `lib/patients/`, one function), flag slot (phase 5), living situation, team, last seen. Banners, most urgent first: merged; consent not recorded; possible duplicate or the reviewer's Not sure note; "Two values for Usually found · Choose" (online, 3.2); "List only: the full chart opens when you're online"; "Not synced yet". Quick actions: **Copy ID link** (a choice of two when a merge left two cards), **Edit**, **Keep for today** (a toggle that says its state); phase 4 adds **+ Encounter** first. Sections: Problems (New and Ongoing, then "Resolved (3)" collapsed; **Add problem** with `encounters.chart`; hidden without `mayViewProblems`, so never on the CHW preset), Allergies (add; **Entered in error** with a reason for `encounters.chart`), Street names, Consent, **History** (online) | Header read first as one summary ("Del, 80, allergies: penicillin, severe"), then field by field; the allergy badge is announced right after the name; empty photo and flag slots are excluded from semantics; section headings; quick actions 48 px |
| **Edit** (`intake_screen.dart`, edit mode) | 11.5 | Locked fields announced "Legal name, Delbert Smithfield, locked. Only a Program Admin can correct this." |
| **ID card** (`id_card_screen.dart`) | 10.4; states as sentences with an icon; the conflict message first when it applies; printing guidance | Reason chips a radio group, nothing preselected; the confirmation states the consequence in text; Copy announces "Link copied. It clears in 60 seconds." |
| **Problem** (`problem_screen.dart`) | Status in words; buttons only for allowed moves; the Resolved confirmation; **Still has this?**; timeline of status changes (who, when, which encounter or "from the patient profile") and notes; **Add note** (multi-line, 4,000-character counter announced at 90%) | Timeline a list with dates read in full; status control a radio group |
| **Add problem** (`add_problem_screen.dart`) | 9.5; code search over the bundled list; "No code" allowed and explained; the recurrence question when a Resolved problem of the patient matches the title or code ("Is this the same problem coming back?") | Results are buttons labelled "Burn of left forearm, first degree, code T22.112A"; status chips nothing preselected |
| **Field review sheet** (`field_review_sheet.dart`) | "Which is right?": each value a radio card with who and when; **Save choice** (online, 3.2). Identity reviews say "A Program Admin will check this." | Radio group with the values as labels |
| **Needs attention** (`lib/features/sync/needs_attention_screen.dart`, `sync_labels.dart`) | Texts for every `details.problem` of 2.6 (`server_constraint`: "This entry has a problem the app can't explain. Edit it and send it again; your team's admin has been told."); the problem conflict card (9.3); `patient_missing` → **Attach to another patient** (search, then the fix); `encounter_missing` on a status → the same, for the encounter; `patient_merged` → **Make a new card from the kept chart**; `token_taken` → **Make a new card**; local notices (kept-both, `nothing_to_recognise`, a note on a retracted problem, link outcomes, possible duplicate) as non-blocking items | Existing patterns; no values in titles |
| **Home** | One line in the sync card: "Patient list: updated 2 hours ago" or "Patient list: not on this phone" | — |

Sign-out progress (`sign_out_dialog.dart`) and the devices page show the new categories in words: "Patients: 2 of 5", "Problems: 1".

### 12.2 Portal (`apps/portal/src/app/(app)/`)

Server components and server actions only; the API is called with the user's token; `no-store`; nothing in browser storage; **every PHI input has `autocomplete="off"`**, so names and birth dates never enter the browser's form history. Nav entries from `can(team, ...)`, existing keys only (D37): **Patients** (`patients.view`), **Reviews** (`patients.edit` or `patients.correct_identity`), **Duplicates** (`patients.review_duplicates`), **Merges** (`patients.review_duplicates` or `patients.correct_identity`), **Problem reversals** (`patients.reverse_resolved`).

| Page (title) | Contents | Accessibility |
|---|---|---|
| `/patients` ("Patients") | `ActionForm` with `TextField` "Name, street name or description" and day, month, year fields; a server action POSTs to `/v1/patients/search`; results render from the action state as a table (Name, Also known as, Born, Usually found, Last seen, Why it matched) linking to `/patients/{uuid}`. The URL never changes, so names never reach history | Error summary takes focus; result count in `role="status"`; table caption "Search results"; links name the person ("Open chart: Del, born 1946") |
| `/patients/[patientId]` ("Patient") | The projected profile: header, details, aliases, allergies, consents, problems with history in a disclosure, ID card panel (every active card in the group, usually one, two after a merge until the next new card; for `patients.edit`, **Show link** (a logged read), then **Copy** and **Make a new card** with a reason and a confirmation step that says which cards stop working), merge history and the merged banner, open reviews with a decide form, links to **History** and **Correct identity** | Headings per section; disclosures with `aria-expanded`; each review a fieldset, values as `ChoiceField` radios, comment required for identity |
| `/patients/[patientId]/correct` ("Correct identity") | 11.6, behind `/reauth` | The DOB read-back as a confirmation step with its own heading; reason required; error summary |
| `/patients/[patientId]/history` ("History") | Field, old value, new value, who, when, how (phone offline, phone, portal, merge, correction, review) | Table with caption and row headers |
| `/team/reviews` ("Reviews") | Open field reviews the person may decide, both values with who and when | As the profile's review forms |
| `/team/duplicates` ("Duplicates") | The queue, tabs Open / Not sure / Decided (`?status=`, not PHI), "Next 50" | Caption; fixed order; each row link names both records |
| `/team/duplicates/[pairId]` ("Compare records") | The side-by-side `<table>` (caption "Two records that may be the same person"; column headers "Record A, made Oct 3 by Jordan Lee on a phone, offline" and "Record B, …"; a row header per field; a third column **Same** / **Differs** in text, any icon `aria-hidden`); which parts matched; earlier decisions with comments. Decision form: `ChoiceField` Merge / Keep separate / Not sure (nothing preselected), "Which chart is kept?" when Merge, required comment, optional field note for Not sure; a Merge confirmation step lists what happens ("2 fields differ and will open reviews; the other ID will point to the kept chart; both ID cards keep opening the kept chart until a new card is made") with a `danger` **Merge records** button | Real table semantics (1.3.1); "Differs" in text (1.4.1); below 640 px the rows become stacked blocks, row header first, no horizontal scroll at 320 px (1.4.10); after deciding, focus moves to the confirmation heading and a link to the next pair |
| `/team/merges` ("Merges") | Recent merges; **Undo** (with `patients.correct_identity`, behind `/reauth`) opens a confirmation with the required comment; the result lists reverted and kept fields, redirected edits, the cards given back to each record and any card made while merged ("Check which person carries this card") | As above |
| `/team/problem-reversals` ("Problem reversals") | Requests: the original's history beside the new entry; **Reverse** (reason) or **Decline** (reason); after Reverse, the merge offer | Fieldsets; reason required; focus to the result |
| `/team/roles` (existing) | No change: phase 3 adds no permission (D37) | Existing |
| `/team/quarantine`, `/team/devices` (existing) | Labels for the seven new entities and the `patients` / `problems` categories (`ENTITY` map, `lib/labels.ts`) | Existing |
| `/c` (public) | 10.3 | One heading, one button; axe in all three themes |

---

## 13. Tests

### 13.1 The done-when, end to end

**"A made-up patient is found offline by a misspelled alias, edited, and flagged as a likely duplicate at intake."** One script, three runners:

| Runner | File | Server | Unit |
|---|---|---|---|
| Phone against the fake | `apps/mobile/test/patients/done_when_test.dart` | `FakeSyncServer` (P1 owns it), with `seedPatient(...)` and a Healthcare Staff member (`permissionsOf` = the standard Healthcare Staff list) | P2 |
| Phone against the live API | `apps/mobile/test/patients/live_patients_test.dart`, run by `tools/live-sync.sh` after `live_api_test.dart` | the real API on the seeded e2e database, signed in as `clinician@example.com` (Healthcare Staff); "airplane mode" is the existing `test/sync/uplink.dart` cut | P2 |
| Server half | `services/api/test/patients-done-when.test.ts` | Vitest against Postgres, with the phone's changes as JSON built from the same fixture | S3 |

**One fixture** pins all three to the seed: `packages/contract/test-vectors/done-when.json` (S0) holds P1 (a fixed UUID; preferred name "Del"; alias "Smitty"; legal name "Delbert Smithfield"; born 1946-03-07, day precision; descriptor "Demo: tall, grey beard, red cap"; usually "Demo: by the made-up Elm St underpass"; allergy penicillin, drug, severe), the search text `"Smity"`, the edit (`usualArea` → "Demo: by the library steps"), the intake (preferred "Smitty", legal given "Del", typed birth `7/3/46` in Date of birth mode) and the expected results (search reasons `alias`, `typo`; match band `likely` with reasons `name`, `alias`, `dob_swapped`; phone score 0.9475 to 1e-9; server score ≥ `QUEUE_THRESHOLD`). `db/seed/seed.ts` inserts P1 from it; the fake's `seedPatient` and the API test read the same file.

Steps and assertions (the same in both phone runners unless marked):

1. **Online sync.** The Healthcare Staff phone syncs; the index arrives in one page. `kv index.version` is set; `team_index` holds P1 with its allergy and `idLinks: []`; `patient_names` holds P1's `del`, `smitty` and `demo tall grey beard red cap` (origin `index`) and **no row containing `delbert` or `smithfield`** (D40). The server has `patient.index_downloaded {version, after: null, next: null, count}`.
2. **Airplane mode** (`fake.offline = true`; live: the uplink cut).
3. **Search "Smity".** P1 is the first result, with reasons `alias` and `typo` (alias "Smitty", `1 − 1/6 = 0.833`); the row's label holds no legal name. The outbox holds one `audit` entry, `patient.searched {patientIds: [P1, …], criteria: ['name'], source: 'team_index', resultCount}`, written before the list rendered, and no outbox `value_json` contains `smit` (the search text was never stored, D41).
4. **Open and edit P1** (index only). The partial import and `patient.viewed {source: 'team_index'}` are written; the profile says "The full chart opens when the phone reconnects." Edit **Usually found** → "Demo: by the library steps"; Update and save appends exactly one `set` (`patient`, P1, `usualArea`) with `baseVersion` = the index's `versions.usualArea` (1).
5. **New patient, still offline.** Agrees; "What do they go by?" **Smitty**; legal given name **Del**; born **7/3/46**. The read-back says "July 3, 1946 · age 80" and Create stays disabled until **Yes, that's right** is on (two-digit year; day and month both ≤ 12). The panel shows P1 as **Likely the same person**, score 0.9475 from the Dart scorer (`N` = del/del 1.0, `D` = swapped 0.85), reasons name, alias, birth date day and month swapped, and no legal name. Tap **Not them**; Create shows no sheet. The outbox holds `patient.match_checked {checkId, patientIds: [P1]}`, then the patient create (`matchCheck {checkId, where: 'phone', dismissed: [P1]}`, consent and privacy notice). P2's `patient_names` rows are `smitty` only (origin `local`): **its legal given name "Del" is not in the search table** (D40).
6. **Kill the app.** Close the store and reopen it from the same file and key (`harness.restart()`): the outbox is identical (same change IDs and hashes).
7. **Reconnect and sync.** Every change is confirmed by hash (`r.hash == e.valueHash`) and the outbox is empty. Phone runners check through the API: `GET /v1/patients/{P1}/history?field=usualArea` (as the clinician) shows the old and new value; `GET /v1/team/duplicates` (as `admin@example.com`) lists the pair (P1, P2) `open`, "Creator said not the same", reasons including `dob_swapped`. The server half also asserts in SQL: P1's `usual_area` at field version 2 with a `set` history row holding the old value; P2 active and canonical with two `patient_consents` rows; `duplicate_pairs` (P1, P2) `open`, `creator_dismissed`, score ≥ `QUEUE_THRESHOLD`; P2's receipt has no `possibleDuplicate` (P1 was shown); the audit chain holds the phone's `patient.searched`, `patient.viewed` and `patient.match_checked` (`offline: true`, device times), `patient.created`, `patient.updated`, `duplicate.flagged` with both IDs in `patientIds`; no `audit_events.details` contains `smit` or `delbert`; `verify_audit_chain` passes.
8. **Next index refresh.** Both entries carry `duplicate: {status: 'open'}` and the "Possible duplicate" chip; P2 is an index entry and its `local` FTS rows are gone. Advancing the clock 25 hours (fake: `now`; live: the store's injected clock) runs the purge: the partial P1 chart and P2's records go with their `cache`/`local` FTS rows and `id_links` rows, the index rows stay, and `patient_names_data` holds no trigram of a name that was only in a purged row (FTS5 `secure-delete`).
9. **Portal.** `apps/portal/e2e/duplicates.spec.ts` shows a seeded equivalent pair in the queue with axe clean in Day, Night run and High contrast.

### 13.2 Shared vectors (`packages/contract/test-vectors/`)

| File | Made by | Used by |
|---|---|---|
| `normalize.json`, `trigram.json` | `services/api/scripts/gen-match-vectors.ts` against Postgres (`normalize_name`, `similarity`) | `matching.test.ts`, `normalize_test.dart`, `trigram_test.dart` |
| `match.json` (pairs and searches with `phoneScore`, `serverScore`, `band`, `reasons`; the `constants` block) | the same script: Double Metaphone codes from Postgres, scores from the TS scorer | TS to `serverScore`, Dart to `phoneScore`, both to 1e-9; both constants files |
| `dob.json` (input, mode, today, expected value or error, needs confirmation) | hand-written | `dob_test.dart`, `apps/portal/src/lib/dob.test.ts` |
| `sync-values.json` (valid and invalid values per entity, expected `details.problem`; untrimmed strings; for each valid change its `parents`, including a problem status set's `encounterId`; `AuditAppend` with 50 and 51 `patientIds`) | hand-written | API `sync-patients.test.ts`, `entities_test.dart`, the fake |
| `access.json` (permission sets → `hasFieldAccess`, `mayHoldTeamIndex`, `mayViewProblems`: the five standard roles and presets, plus custom sets such as `patients.view` + `checkins.create` and `patients.view` alone) | hand-written | `permissions.test.ts`, `access_test.dart`, the fake |
| `done-when.json` (P1, the search, the edit, the intake, the expected scores and reasons; 13.1) | hand-written | `db/seed/seed.ts`, the fake, `done_when_test.dart`, `live_patients_test.dart`, `patients-done-when.test.ts` |
| `id-link-token.json` (token shape, hash, `tokenRef`) | hand-written | both |
| `canonical-json.json` (existing) gains patient, alias, allergy, consent, problem and link values | | hashes agree across Dart and TS |
| `packages/contract/data/unaccent-latin.json` | the vectors script against Postgres | both normalizers |

CI regenerates the generated files and fails on a diff, like the contract drift check. `packages/contract/test/spec.test.ts` gains "no route takes a name, birth date or search text outside a POST body" and "no 409 response schema carries `FieldState`, `PatientSummary`, `PatientChart` or `IdLinkView`".

### 13.3 API (`services/api/test/`, Vitest against Postgres 16 and 17)

Every new route: refused without its permission with `access.denied` logged; its audit event asserted in the same transaction (the existing helper, extended as `expectAudit(action, {patientId?})`; a forced audit failure returns 500 and no data); `Cache-Control: no-store`; a log-sink spy asserting no seeded name, alias, birth date, token or search text in any line. A schema test asserts every table with a `patient_id` column is read through the group (`CHART_TABLES` registry in `services/api/src/patients/charts.ts`), so a later phase can't add a child table that half a merged chart forgets.

| File | Covers |
|---|---|
| `sync-patients.test.ts` (S1) | Each entity's create and set, replay (same receipt), `record_exists`, every `details.problem` in `sync-values.json`, untrimmed strings refused and nothing stored. Permission per entity, existing keys only: a CHW's patient, alias, allergy, consent and ID link accepted; a CHW problem held for review; Billing's patient held. Parents and `awaiting_review` for a whole held intake. Encounter `patientId` must exist. **Parent of a set**: a problem status set naming an unknown encounter → `encounter_missing`; naming the person's own held encounter → `awaiting_review`; neither reaches `problems.status_encounter_id`. Keep-both: two devices set `usualArea` from version 1 → first applied, second accepted with `server` and `outcome: 'kept_both'`, review open, chart unchanged, both in history; replay → same answer. D16 exception: a device's second edit following its kept first edit is kept too. **Recognisable**: a patient with only a preferred name and a descriptor; phone A clears the descriptor and phone B the preferred name, both from version 1 → A applied, B accepted `history_only` with `nothing_to_recognise`, the row still recognisable, both phones' next pushes accepted (the queue moves). Identity: blank filled whether or not seen; a seen `fills` (given → given + family; year → day of the same year; estimated 1980 → 1982 day) written; estimated 1980 → 1970 seen → identity review; `identity_admin_only` on a seen non-blank; **a stale fill after an admin correction** ({Delbert, Smith} corrected to {Delbert, null}, then a phone that filled "Smith" before seeing it) → kept both with `needs = patients.correct_identity`, the correction stands; two fills of one blank → identity review. Allergy screen both orders: NKA after an allergy → `history_only`; an allergy after NKA → screen `not_asked`, history `cleared_by_allergy`. Problem marked entered in error: a later status set → `history_only`; a note → stored, `problemRetracted`. Set-once. Union (two phones add different aliases → both active). Redirects (merge P2 into P1; push an encounter on P2 → stored with P2, P1's chart lists it; `set` on P2's field → applied to P1 with `redirectedTo`; chain P3 → P2 → P1 in one read). Team lock: two parallel patient creates of the same person → exactly one pair. Composite FK refuses another team's patient. **Savepoint**: a test-only check constraint added in the test's transaction makes one change fail with class `23`: that change is stored `rejected` with `server_constraint` and its audit event, and the next change in the same push is applied. A removed CHW's intake is handed over and accepted record first. Phase 2's `sync.test.ts` passes, its encounters now naming existing patients |
| `sync-concurrency.test.ts` (S1) | Two connections: a merge of P2 into P1 holding the team lock, and a push creating an encounter on P2 (and one setting an encounter's `patientId` to P2) → both finish, no `40P01`, in either start order (review finding 12); the encounter path takes the team lock before its insert |
| `problems-sync.test.ts`, `problems-admin.test.ts` (S1, S4) | Every row of the 9.2 table through push; the conflict and its three resolutions; `not_resolved`; sensitive by code range; notes append-only (trigger refuses update); entered in error needs `encounters.chart` and the author or `patients.reverse_resolved`; reversal requests, reverse with recent sign-in (history `entered_in_error`, both entries kept, correction row), decline, merge offer and merge, a late status change on a merged entry redirected; a Billing/Data member reads problems and codes but every write is refused or held; a CHW reads no problems |
| `permissions.test.ts` (S0) | `access.json` through `hasFieldAccess`, `mayHoldTeamIndex`, `mayViewProblems`; `PERMISSIONS` still has exactly the 23 keys of 0002 |
| `matching.test.ts` (S2) | The vectors, both constant sets, nickname, typo, sound-alike (Kathryn / Catherine, server only), swapped DOB, year-only, conflicting-DOB cap, single-name cap, DOB-only cap |
| `patients-search.test.ts` (S2) | Misspelled alias found; Billing/Data finds by alias too (it sees aliases, D38); a merged patient's alias finds the survivor; another team's similar name never appears; caps and order; **ranking before the cut**: 2,000 keys in a team, the target "Smitty" born 1946 among 300 patients born 1946 and 200 similar names, found first by "Smity" + 1946 and by the match; a birth-date-only search returns exact dates first and never more than the limit; `surface: 'phone'` hits carry no `legalName`; POST only; audit has `patientIds` and no query text |
| `patients-index.test.ts` (S2) | Eligibility through `mayHoldTeamIndex`: Program Admin, Logistics, Healthcare Staff and the CHW preset 200; Billing/Data 403 (logged); a custom role with `patients.view` + `checkins.create` 200; `patients.view` alone 403; removing a member's last field permission turns the next request into 403; exact JSON key set (no legal name or its normalized form anywhere in the page, no living situation, problems, token or hash); `have` → `unchanged`; any shown field bumps the version, a role change changes the projection; keyset pages; the first page's complete redirect list, which drops a redirect after an undo; `patient.index_downloaded {after, next}` per page |
| `patients-charts.test.ts` (S2) | Projection per role: Billing/Data gets the whole non-sensitive chart (aliases, descriptor, allergies, consents, ID link status, problems with history and notes) and no sensitive problem; CHW gets no problems; the ID link URL only for `patients.edit`; a sensitive problem invisible without `view_sensitive`, with the same 404 as missing; `missing`, the complete `redirects` for the requested IDs; gzip; one `patient.viewed` per chart; history route projected |
| `duplicates.test.ts` (S3) | Re-run on create, edits, corrections and merge; `creator_dismissed`; keep separate never re-flagged, including after one side is merged into a third patient; Not sure stays queued with its note in the index; decisions need a comment and a recent sign-in; `409 pair_changed` with versions only; merge fills blanks (estimate refinements within range only), opens reviews for differences, **retires no ID link**, clears NKA when the merged record has an allergy, supersedes other pairs; merge locks rows `FOR NO KEY UPDATE`; pair views write one event per patient |
| `merges.test.ts` (S3) | Undo restores fills still at the merge's version, keeps the rest (and a fill whose revert would leave nobody recognisable), closes merge reviews, returns superseded pairs, reopens the pair, lists redirected edits; late children return with the merged patient; **ID links**: with no regeneration while merged nothing changes; after a regeneration on the group, the merged record's retired card is active again (`restoredLinks`, `id_link.restored`), the survivor keeps the new card, `linksIssuedWhileMerged` lists it; `409 undo_later_merge_first`; allowed only with `patients.correct_identity` (a member with `patients.review_duplicates` alone is refused, logged); `merges.viewed` lists both patients of each merge |
| `id-links.test.ts` (S4) | Token shape and hash; online issue and `409 link_changed {activeLinkIds}` with no URL or token in the body; handshake active; `replacesLinkId` stale → newer `effective_at` wins both ways; notices to both issuers and to admins; the loser accepted `retired` with `retired_by_link`; `token_taken` rolls back the retirements; `patient_merged`; **after a merge both cards stay active and both resolve to the survivor; a regeneration naming either card (online, and offline through the handshake) leaves exactly one active link in the group**; one active per group after two concurrent pushes; the receipt hash equals the phone's canonical hash; no token or URL in any log line or `audit_events.details` |
| `corrections.test.ts`, `field-reviews.test.ts` (S4) | Recent sign-in, reason, stale `baseVersion` → `409 field_changed {field, version}` with no value, history `corrected` with old and new, declined amendment recorded with the chart unchanged, matching re-run; review decisions by `needs`, alternate written as `review_decided`, `409 nothing_to_recognise` |
| `foundation.test.ts` (existing, unchanged) | The catalog and `known_permissions()` agree, still 23 keys: phase 3 adds none |

### 13.4 Database

`db/test/patients.test.ts` (S0): 0009–0012 apply on a database holding phase 2 rows; RLS hides every new table across teams; append-only triggers refuse update and delete; `patient_name_keys` follows inserts, name edits and alias removal; `name_codes` is stable; `patient_candidates` and `patient_candidates_by_birth` return nothing for another team, order before they limit (the 5.4 fixture: the target with the last-sorting UUID still ranks first), never evaluate `make_date` on a day above 12, and `explain` over ten teams of 2,000 keys shows every branch bounded by a team-led index (the trigram GIN or the primary key) and no sequential scan; the `canonical_id` checks hold; `patients_recognisable` refuses a direct update that would clear the last name; `known_permissions()` returns exactly what 0002 defined and no role row changed. `db/test/encounter-patient-fk.test.ts` (S1): `0013` applies over phase 2 rows naming unknown patients and leaves them; a new or changed encounter naming an unknown patient is refused.

### 13.5 Phone

- **Unit** (`test/patients/`): `normalize_test`, `trigram_test`, `matching_test` (vectors and constants), `dob_test`, `id_link_token_test` (22 base64url characters from `Random.secure`, hash, `tokenRef`), `access_test` (`access.json`), `entities_test` (`sync-values.json`, `parents` included), `fts_search_test` (the exact statements of 5.5 on the bundled SQLite: "Smity" finds Smitty, "mitt" finds Smitty, "Al" by prefix, `min(rank)` grouping with origins, a birth date that orders but never adds candidates, a date-only search, caps and order; **a 60-patient index where "Mike" matches 55: 20 shown and audited, Show more shows 50 and appends a second `patient.searched` listing all 50, each entry accepted by the `AuditAppend` mirror**; a legal name typed offline matches a cached chart in memory and never an index row), `team_index_test` (staged pages swap atomically; a cut-off download resumes; `unchanged` refreshes the clock; 7-day expiry by corrected time; a clock wound back counts as expired; the 2,000-entry size and the swap budget with FTS5 `secure-delete` on; the 403 clears it; the swap replaces `patient_redirects` of every origin with the first page's list), `chart_cache_test` (each scope's expiry; local work keeps a chart past expiry; refresh never extends; redirects re-key scopes; batches start at 10, halve on a timeout down to 1 and double after each answer; **after a scope expires, a legal-name search finds nothing, the chart's `cache` and `local` FTS rows and its `id_links` rows (tokens) are gone, and `patient_names_data` holds no trigram of a removed name**), `id_links_test` (pending copyable; every active link of the group blocked; both outcomes with `retiredLinkIds`; rejection keeps it unusable; two cards after a merge both copyable).
- **Store** (`test/sync/local_store_test.dart`): `_classify` holds aliases, allergies, consents, problems, notes, the ID link and an encounter behind a rejected patient create and releases them after the fix in one sync; **a problem status set naming an encounter whose create is rejected, or later in the outbox, is held**; `confirm` with `server` shows the chart's value and keeps a newer local edit pending; `replaceRejected`; purge keeps a chart while a scope or local work covers it and drops it after, with its FTS rows and tokens; `clearServerData` deletes server copies, every redirect row and the FTS rows and tokens of charts without local work, and never an outbox entry; **FTS5 `secure-delete`: after the purge, after `clearServerData` at sign-out, after the 7-day expiry and after a 403, `patient_names_data` holds no trigram of a removed name**; the walk of 2.9-11 finds a seeded legal name only where allowed; **re-entrant `_tx`**: `appendAudit` and `resolveConflict` inside `transaction(fn)` commit together, and a throw after them rolls both back; the `serverCopiesStale` marker clears at open before any read; the clock pause blocks problems and links, not intake, and an intake with Wants a card while paused saves the patient with `idCardChoice = 'wants'` and no link; v1 → v2 upgrade keeps phase 2 outbox rows; `_v2` refuses to run on SQLite older than 3.42.
- **Widget** (`test/features/patients/`), each in Day, Night run and High contrast with `expectGuidelines(tester)`, and again at `TextScaler.linear(2.0)` asserting no overflow: Patients tab (row labels, live count, no legal name in any row), intake (consent radio group, read-back live region, the confirm toggle gating Create, the panel never stealing focus, the Create sheet's focus order, the card chip's clock sentence), **intake in edit mode** (`intake_screen_edit_test.dart`: title "Edit details", Update and save, locked identity fields announced, the estimate-refinement warning, refusing to clear the last name), profile (allergy badge words and precedence, banners, two cards after a merge), ID card (copy announcement), problem (Resolved confirmation, allowed moves only), **Add problem** (`add_problem_screen_test.dart`: code results as labelled buttons, status chips with nothing preselected, the recurrence question, "No code" explained), **field review sheet** (`field_review_sheet_test.dart`: radio group with values as labels, identity reviews' admin sentence, Save choice offline disabled with a reason), Needs attention problem card and notices; every PHI `TextField` has `enableIMEPersonalizedLearning == false` (found by a key convention); `test/design/contrast_test.dart` gains the new chip and badge colours.

### 13.6 Scenarios against the fake, then the real API

`apps/mobile/test/patients/patient_scenarios_test.dart` (fake) and the starred ones also in `live_patients_test.dart` (real API; `tools/live-sync.sh` runs both live files):

1. ★ The done-when (13.1).
2. ★ Two phones register the same person offline; both sync; one pair; both phones' next index shows the hint.
3. ★ Two phones edit Usually found offline; both confirm; one review; neither has a Needs attention item.
4. ★ A patient P2 is merged into P1 while a phone is offline with pending work on P2 (an alias, an allergy, a `usualArea` set); everything confirms, the set with `redirectedTo` (a `receipt` redirect row); after refresh the phone shows the survivor. Undo (live: `POST /v1/team/merges/{id}/undo` as `admin@example.com`; fake: `undoMerge`); after the next index refresh `patient_redirects` holds no row for P2, whatever its origin; offline, a search for P2's preferred name returns P2 (not P1), and an alias added to P2 is a create with `patientId` P2 that the server stores on P2 (review finding 3).
5. ★ Two phones make a new card offline; the newer wins; the loser's phone shows the notice and Copy gives the valid link after refresh; a card for a merged patient is rejected and blocked. **Cards and merges** (D39): P1 and P2 each have a card; merge; both tokens stay active and both resolve to P1's chart; a phone that cached P1's chart regenerates offline naming P2's link (the newest); after sync the group has exactly one active link and both old ones are retired; undo gives P2 its old card back and leaves the new one on P1.
6. A problem resolved on one phone and set Ongoing later on another: the conflict card; "It came back" creates a recurrence; "Resolved by mistake" creates a request that the API reverses and merges.
7. Intake in airplane mode, app killed mid-sync, reconnect on a slow uplink (D24): every change confirmed once, nothing duplicated, the index download resumes.
8. A week offline: the index expires and is deleted; search still covers cached charts and local work; the cache expires except the chart with unsynced work.
9. Sign-out deletes the index and server copies (FTS rows and tokens included) and keeps outbox work; sign-out from the lock screen marks the file and the next open clears it first; a role change to Billing/Data deletes the index at the next sync.
10. A CHW removed while offline: the intake goes to quarantine with its aliases in order; the admin accepts the patient first.
11. ★ Two phones each clear a different one of a patient's two recognisable fields offline (preferred name, description); both confirm, one as `history_only` with the notice; the patient still has a name; neither phone has a Needs attention item and both keep syncing (review finding 1).
12. ★ No known allergies and an allergy, in both orders, from two phones: every phone's badge shows the allergy after sync, the chart's screen reads `not_asked` when the allergy came second, and no Needs attention item (review finding 16).
13. A problem marked entered in error online while a phone offline sets it Resolved and adds a note: both confirm (`history_only`, `problemRetracted`), the note is in the retracted problem's history, and the author sees the notice (review finding 7).
14. Weak signal: 30 cached charts with problem notes refresh over an uplink that times out every response above 40 KB; batches shrink to a size that fits and every chart arrives (review finding 20).
15. A role change on a phone holding the index: removing a CHW's `patients.edit` and `checkins.create` (keeping `patients.view`) → the next index request is 403 and the index, its FTS rows and the cached charts without local work are deleted.

### 13.7 Portal (`apps/portal/e2e/`, Playwright with axe in Day, Night run and High contrast)

- `patients.spec.ts`: search by a misspelled alias finds the seeded patient; after searching the URL is still `/patients` and the title "Patients · Sineobex" (no name in the URL, title or history); Billing/Data's profile shows the chart read-only (aliases, allergies, problems with codes) without sensitive problems, Edit, Correct identity or Show link; PHI inputs have `autocomplete="off"`; History shows old and new values; a field review decided; keyboard-only paths.
- `corrections.spec.ts`: the reauth gate, the read-back, reason required (error summary takes focus), a declined amendment.
- `duplicates.spec.ts`: the queue lists the seeded pair; the side-by-side is a captioned table with row headers and Same/Differs text and reflows at 320 px; no decision or no comment shows the focused error summary; Not sure keeps it queued with its note; Merge through the confirmation (which says both ID cards keep opening the kept chart); the merged patient's URL opens the survivor with the banner and its ID card panel lists both cards; undo as Program Admin; a custom "Healthcare Staff + Review duplicates" reviewer (no `patients.correct_identity`) sees no Undo and the API refuses it (logged).
- `problems.spec.ts`: a reversal request reversed with a reason, then the merge offer.
- `id-card.spec.ts`: Show link, Copy, Make a new card with a reason; with a stale card shown (a second browser made a new card), Make a new card gets `409 link_changed`, re-reads and shows the current card; `/c#<token>` renders only the sign-in text and no network request carries the token.
- `a11y.spec.ts`: the "pages behind sign-in redirect" list gains `/patients`, `/team/duplicates`, `/team/reviews`, `/team/merges`, `/team/problem-reversals`. `admin.spec.ts` is unchanged: the Roles page lists the same 23 permissions (D37).

### 13.8 The non-negotiable rules, and the test that holds each

| Rule | Held by |
|---|---|
| No PHI in logs, URLs, titles, notifications, crash reports | log-sink spies in every API test file; `spec.test.ts` (POST bodies); portal URL and title assertions; notices carry kind and IDs only (API test); phone error texts are fixed strings (existing `error_redaction_test.dart` extended) |
| Every action writes its audit event in the same transaction, searches and views included | `expectAudit` on every new route; offline audit entries in the done-when; `verify_audit_chain` after the scenarios |
| Data leaves the phone only after a hash-confirmed receipt | engine unchanged; store tests for `confirm` with `server`; the hash check in `id-links.test.ts` and the live scenarios |
| Rejected changes are never dropped; dependents held | `_classify` store tests; scenario 7; `replaceRejected` |
| Offline paths tested, not only online | scenarios 1–10 run offline-first; the live job |
| Accessibility in three themes | widget tests and Playwright with axe on every new screen |
| Demo data only | seed guard (existing), PHI guard on fixtures, "Demo:" descriptors |
| Permissions in the API, RLS second | per-route refusal tests; RLS and composite-FK tests in `db/test/patients.test.ts` |
| Minimum necessary for the phone | index key-set test per role (no legal name or its normalized form); `mayHoldTeamIndex` per role (Billing/Data 403); the store walk of 2.9-11; purge of FTS rows and tokens with the chart; FTS5 `secure-delete` shadow-table checks; 7-day expiry, sign-out and lock-screen marker tests |
| No new permission types (Oct 12) | `foundation.test.ts` unchanged (23 keys); `permissions.test.ts`; `db/test/patients.test.ts` (`known_permissions()` and role rows untouched) |
| A rejection never stops a phone's queue | the savepoint test; the recognisability and parent-of-set tests; scenario 11 |

---

## 14. Defaults, risks, and where this design departs from the PRD

### 14.1 Defaults chosen (each a `PLAN-OPEN:` marker in code with its question; rows for plan section 6)

Questions the project lead has decided are no longer here; they are D37–D40 (permissions, Billing/Data's view, cards after a merge, legal names on the phone).

| # | Open question | Default built | Why |
|---|---|---|---|
| 1 | Consent wording; is verbal enough; minors; what withdrawal means | Script `2026-10-1` (11.2), verbal allowed, "unable" allowed with a reason, "declines" creates no record, privacy-notice acknowledgement recorded and never blocking, under-18 guidance shown | HIPAA needs the notice-acknowledgement attempt (164.520); treatment consent is state law; counsel decides |
| 2 | Living situation options | The ten in 11.4 | The PRD gives only the changes; the Google Doc Contents tab owns option lists |
| 3 | Nickname data | `carltonnorthern/nicknames` at a pinned commit (licence to confirm before vendoring) plus a reviewed Spanish and Arabic supplement | Detroit's patients; one file to change |
| 4 | Match weights and thresholds | 5.3 (including `CANDIDATE_BRANCH_LIMIT`) | Module 2: "tuned on pilot data"; every pair stores its score and reasons, so tuning is measurable without names |
| 5 | Problem code system and list | ICD-10-CM, shape-checked, ~400 curated codes on the phone, uncoded problems allowed and labelled | Billing export uses ICD-10; public domain; SNOMED CT needs a licence |
| 6 | Which codes are sensitive | F01–F99, O00–O9A, Z30–Z39, B20, Z21, A50–A64, Z71.4x | Mirrors `patients.view_sensitive`; 42 CFR Part 2 may widen it (counsel) |
| 7 | ID link host; do the team's QR tools keep the fragment | A dedicated host chosen before the pilot; token in the fragment | No log sees the token; cards never expire, so the host is forever; TinyPrint must be checked |
| 8 | Does an unverified clock decide a link conflict | Yes, newer `effective_at` wins; the admin's notice says which clock was unverified | The PRD's rule; anyone can issue again |
| 9 | **Search terms in the audit log** (counsel; D41) | **Never.** Who, when, criteria, result count and which patients were shown; no search text, online or offline | Minimum necessary; the chain is permanent and can't be redacted. If counsel wants terms, they go in a separate restricted column with its own retention, never in `details` |
| 10 | Double Metaphone on the phone | No | Vectors record the difference; the server re-runs at sync |
| 11 | A way for a team to keep the index off a field role | None in phase 3; the index follows `patients.view` plus a field permission (D37) | No new permission types (Oct 12); a later team setting (not a permission) could add it |
| 12 | May staff fill a blank legal name or birth date | Yes, when they saw the current value; changing a recorded one is an admin correction; refining an estimated age within `ESTIMATE_RANGE` (3 years) is a fill, further is an identity review | Patients give names and dates over several visits; a fill overwrites nothing; a large jump from an estimate may be another person |
| 13 | Who marks an allergy entered in error | `encounters.chart`, with a reason | A clinical safety judgment |
| 14 | Does a corrected DOB re-open Keep separate | Never | The PRD: "so it isn't flagged again" |
| 15 | Undo limits | Latest merge on a group only; redirected edits listed, not moved; no undo for problem merges | Keeps undo exact and auditable |
| 16 | **Cards at undo**: is a card a regeneration retired while two records were merged given back | Yes, every one, "as they stood" (D39); the card made while merged stays with the survivor; the undo answer lists both so the admin can check which person carries which card (a card reported stolen can then be regenerated) | The PRD retires a token only by regeneration; the regeneration may have been asked for by the other person |
| 17 | A clear that would leave a patient with no name or description, arriving from a second phone | Accepted `history_only` with a notice; the chart keeps the value | The worker can't fix a race, and a rejection would block their next route confirmation (module 9) |
| 18 | Who decides a field review | `patients.edit` for ordinary fields, `patients.correct_identity` for identity fields | People who know the patient by sight; Oct 19 for identity |
| 19 | Portal intake and demographic edits | Not in phase 3 | Consent is given in person; one write path for demographics |
| 20 | Day-month order in typed dates | Month first | US pilot; a team setting later |
| 21 | DOB range that asks for confirmation | Age under 14 or over 100 | Catches "24" meaning 1924 and "26" meaning 2026 |
| 22 | Index timing and lifetime | After syncs (at most every 2 min), every 15 min while unlocked; pages of 500; 7 days | Module 9; cheap `unchanged` answers |
| 23 | Keep for today | Per person, at most 50, 24 h | Team-shared lists are what routes are (phase 7) |
| 24 | Search rate limit | None; the audit dashboard flags bursts later | Field searches come in bursts |
| 25 | "The admin" told of a link conflict | Members with `team.manage_users` | Program Admins by default |
| 26 | Merge survivor default | The older record | It usually holds more history; cards no longer depend on the choice (D39) |
| 27 | App-layer encryption of stored tokens | Not in phase 3 | A pointer, not a credential; KMS at rest; revisit in the phase 12 risk analysis |
| 28 | A human-readable chart number | None; the UUID is the "auto-generated patient ID" | A sequence can't be assigned offline; revisit with billing |
| 29 | Contact phone, gender identity, pronouns | Not in phase 3 (phase 7 adds a contact phone with its consent kind for pre-visit contact) | Not in module 2's record; additive later |
| 30 | Demo patients | Invented, realistic names (a shared "(demo)" token would distort every score); descriptors start "Demo:"; no phone numbers | The PHI guard and the Demo data only banner mark them |
| 31 | An intake that wants a card while the clock is off | Saved without the link; "Make the card once the phone's clock is right" | The clock never blocks registering the person in front of you (D35) |

### 14.2 Risks

1. **The index puts every active patient's identity and allergies on every field phone.** Mitigations: only roles with `patients.view` and a field permission get it (Billing/Data and view-only roles never do), no legal names or anything derived from them, no tokens, SQLCipher with FTS5 `secure-delete`, 7-day expiry, deletion at sign-out, remote wipe. The residual risk is its own line in `docs/compliance/risk-analysis.md`.
2. **No per-role switch for the index.** With no new permission types, a team can't give a role `patients.edit` without the index. PLAN-OPEN 11; a team setting can add it later without a permission.
3. **Untuned matching** floods the queue or misses duplicates. Pairs store score and reasons; a pilot report of pairs per band and decisions tunes the constants.
4. **The fake mirrors seven more entities by hand** (plan risk 7 grows), and two scorers must agree. Mitigations: `sync-values.json`, `access.json`, `done-when.json`, the match vectors, scenarios that also run live. Rule: any change to `services/api/src/sync/**` or `services/api/src/patients/matching.ts` comes with the same change to `fake_server.dart` or the vectors.
5. **The registry refactor touches the most reviewed code** (plan risk 3). S1 keeps encounter and note behaviour bit for bit (phase 2 suites pass unchanged apart from patient IDs that must now exist) and gets a second reviewer.
6. **A missed check becomes a stored rejection.** The savepoint keeps a phone's queue moving, but a worker then sees an error they didn't cause. `server_constraint` rejections are counted on the devices page and audited with the constraint name, so each one is a bug report with a precise location.
7. **Group reads.** A later child table read by `patient_id = $1` would show half a merged chart; the `CHART_TABLES` schema test fails the build until it is registered.
8. **Two cards per merged group until a regeneration** (D39). Both open the combined chart; both are listed on the ID card screen and the portal panel; the next new card retires both.
9. **Reviews nobody settles.** Keep-both is quiet by design; chips on every chart and the Reviews count in the portal nav are the mitigation.
10. **Non-Latin names** are dropped by `normalize_name`; if staff start recording them, a `normalize_name_v2` and a key rebuild.
11. **A 7-day-old index can miss a new allergy.** Phase 6's hard stop must say "based on the patient list from …" when it relies on the index.
12. **The ID link host can't change** once cards are printed; `ID_LINK_BASE_URL` is decided before the pilot.
13. **The device-time rule trusts clocks**; the clock check keeps skew under 5 minutes and the notice flags unverified clocks.
14. **Clipboard on Android before 13** has no sensitive flag; the link is cleared on background and is not PHI on its own.
15. **`encounters_patient_fk` is NOT VALID**; validate it on the fresh RDS database (phase 12), where no unchecked rows exist.
16. **The team lock** holds per-team patient writes, and encounter writes that name a patient, for the length of matching (milliseconds); the audit lock already serializes them. Measured in the API tests.
17. **Audit volume** (searches, views, match checks, index pages) is fine at pilot scale; per-team chain serialization (D7) is the bottleneck to watch. Index pages record a range, not a list of IDs, for this reason (D33).
18. **Plaintext tokens**: a database dump maps tokens to patients; the dump already holds the charts.

### 14.3 Where this design departs from the PRD, or reads it a particular way

1. **"Only one token per patient is active at a time" is read per patient record** (D39). After a merge, each record's card stays valid and opens the combined chart until staff regenerate, because the PRD also says a token "is invalidated only when staff regenerate the link" and the patient may carry either card. Regeneration retires every card in the group; undo gives each record its own back. A deliberate reading, decided by the project lead.
2. **The team index needs no permission of its own**: field roles (`patients.view` plus `patients.edit`, `encounters.chart` or `checkins.create`) hold it, because custom roles may use only the existing permissions (Oct 12). Billing/Data, whose work is at a desk, does not.
3. **Searches are logged without their terms** (D41). "Every query is logged" is met with who, when, the criteria and which patients were shown. PLAN-OPEN for counsel.
4. **A pair the creator dismissed is still queued** at or above the threshold: "a person decides", and hurried dismissals are how duplicates are made.
5. **The token is in the URL fragment**, not the path; the PRD only requires a URL with a random token.
6. **Staff may fill blank identity fields**; the PRD makes legal name and DOB admin-only *corrections*, and a fill made by someone who saw the current value is not a correction. A fill that didn't see it goes to an admin.
7. **Stale problem observations become history, and the latest observation sets the status**; the PRD covers the deliberate reversal, and offline staleness needed its own rule. Work arriving for a problem marked entered in error is kept in its history.
8. **"Offline, search covers the route cache and QR scans only"** (module 2) is superseded by the Oct 6 team index.
9. **The clock pause does not apply to intake** (D35); a card asked for while the clock is off is made later.
10. **"Replaced whole at each sync"** holds in effect, not in bytes: an unchanged index is confirmed, not re-downloaded, so the outbox isn't starved on EDGE.
11. **A losing offline regeneration is an accepted receipt** (stored, retired), not a rejection; the PRD's outcome (one card valid, both people and the admin told) is kept.
12. **"Re-points it to the surviving record"** is logical for creates (stored as sent, shown on the survivor, kept by undo) and physical only for field edits.
13. **Shared patient fields follow module 9's keep-both rule, not Oct 19's side-by-side choice**, which was written for drafts.
14. **"Assigned staff" and "last known location"** (module 2) are left to phase 7; there is nothing to assign yet, and a location needs the map provider.
15. **"46 becomes 1946"** is kept exactly; an age-range confirmation catches the rule's two bad cases ("24", "26").
16. **"A Program Admin can undo a merge"** is `patients.correct_identity`, which only Program Admin holds by default; a team that gives it to a custom role gives undo with it, because undoing a merge is an identity correction.

---

## 15. Work breakdown

Units in dependency order. Each owns its files outright; **no two units that can run at the same time edit the same file**, and shared test helpers have one owner each (below). A unit that needs another's function codes against the signature S0 wrote. Generated files (`packages/contract/openapi.json`, `packages/contract/src/generated/**`, `apps/mobile/lib/api/generated/**`, the generated nickname, weak-token, code and accent modules) are only regenerated (`pnpm contract:generate`), never hand-edited; after S0, a schema change needs the S0 owner's agreement and a regeneration in the same PR. A migration is never edited once merged (`migrate.ts` refuses it); a fix is a new file.

```
S0 ─┬─ S1 ──┐
    ├─ S2 ──┼── server complete ─────────────────────┐
    ├─ S3 ──┤                                        │
    ├─ S4 ──┘                                        │
    ├─ P0 ── P1 ── P2 ── P3      (P2's live tests and the done-when need the server complete)
    ├─ W0 ──┬─ W1                (e2e green once the server is complete)
    │       └─ W2
    └──────────────────────────────────────────────── D (last)
```

**Shared test helpers, one owner each.** `services/api/test/patient-fixtures.ts` (S0: `createPatient`, `memberWith(permissions)`, `mergeDirect` for tests that need a merged pair before S3 lands, `expectAudit`, the log-sink spy) is read-only for S1–S4. `services/api/test/sync-fixtures.ts` and `harness.ts` stay S1's and unchanged by S2–S4. `apps/mobile/test/sync/phone_harness.dart` and `fake_server.dart` are P1's; P2 and P3 only import them. `apps/portal/e2e/helpers.ts` is W0's; W1 and W2 only import it.

| Unit | Scope | Owns (creates or edits) | Needs | Done when |
|---|---|---|---|---|
| **S0 Contract and schema** (first, alone) | migrations 0009–0012; the access helpers; config; every Zod route schema; route definitions with handlers delegating to module functions (stubs answering 501); sync value schemas; the recognisability rule; generated data and contract; seed; shared API test helpers | `db/migrations/0009_patients.sql` … `0012_id_links.sql`; `db/test/patients.test.ts`; `db/seed/seed.ts` (≈ 40 made-up patients: the done-when's P1 from `done-when.json`, near-duplicates, a pre-flagged pair, problems in each status, an ID link, a merge, a similar name in a second team; a CHW preset member `chw@example.com`); `services/api/src/auth/{permissions.ts (the three helpers, no keys), context.ts (requireAny)}`; `services/api/src/config.ts`, `routes/me.ts`; `services/api/src/sync/{schemas.ts, locks.ts}`; `services/api/src/sync/entities/values.ts`; `services/api/src/patients/{schemas.ts, recognisable.ts}` (complete); `services/api/src/routes/{patients.ts, problems.ts, duplicates.ts}`; `services/api/src/app.ts`; stub signatures in `services/api/src/patients/{projection,search,match,charts,team-index,history,duplicates,merges,id-links,corrections,field-reviews,problems-admin}.ts`; `services/api/test/{patient-fixtures.ts, permissions.test.ts, recognisable.test.ts}`; `packages/contract/data/{nicknames.csv, nicknames-local.csv, weak-tokens.txt, icd10cm-curated.csv, sensitive-code-ranges.csv}`; `packages/contract/scripts/gen-patient-data.ts` and its outputs (`services/api/src/patients/generated/*`, `apps/mobile/lib/patients/generated/*`, `apps/mobile/assets/problem_codes.json`); `packages/contract/test-vectors/{sync-values,id-link-token,dob,access,done-when}.json`; `packages/contract/test/spec.test.ts`; regenerated `packages/contract/openapi.json`, `src/generated/**`, `apps/mobile/lib/api/generated/**` | phase 2 | **CI is green with S0 alone**: migrations apply on 16 and 17; every existing suite passes unchanged (API, DB, phone, portal unit and e2e, the live sync job), because S0 adds no FK on `encounters.patient_id`, no permission key and no behaviour behind the new routes; `foundation.test.ts` unchanged; contract drift green; the new S0 tests pass |
| **S1 Sync entity rules** | registry, per-entity permission, team lock (encounters naming a patient included), parents of creates and sets and holds, the change savepoint, field classes with recognisability, accepted receipts with details, D16 exception, redirects, `patient_of_change` in the queue, the encounter→patient FK | `services/api/src/sync/{apply.ts, records.ts, push.ts, review.ts, devices.ts}`, `services/api/src/sync/entities/*.ts` (not `values.ts`); `db/migrations/0013_encounter_patient_fk.sql`; `db/test/encounter-patient-fk.test.ts`; `services/api/test/{sync.test.ts, sync-fixtures.ts, sync-patients.test.ts, problems-sync.test.ts, sync-concurrency.test.ts}` | S0 (calls S3's `rematchPatient` and S4's `idLinkHandshake` by signature) | 13.3 sync rows green; phase 2 suites green with the FK in place |
| **S2 Matching, search, index, charts** | normalize, trigram, scorer, constants, candidates (ranked), search, match, index pages with the complete redirect list, chart bundles (gzip), history, projection, vectors script | `services/api/src/patients/{normalize.ts, trigram.ts, matching.ts, match-constants.ts, candidates.ts, search.ts, match.ts, team-index.ts, charts.ts, history.ts, projection.ts}`; `services/api/scripts/gen-match-vectors.ts`; `packages/contract/test-vectors/{normalize,trigram,match}.json`, `packages/contract/data/unaccent-latin.json` (generated); `services/api/test/{matching,patients-search,patients-index,patients-charts}.test.ts` | S0 | vectors generated and checked; 13.3 rows green |
| **S3 Duplicates and merges** | rematch, queue, decisions, merge (no card retired, `FOR NO KEY UPDATE`), undo (links given back), suppression; the API done-when | `services/api/src/patients/{duplicates.ts, merges.ts}`; `services/api/test/{duplicates,merges,patients-done-when}.test.ts` | S0 (S2's scorer by signature) | 13.3 rows green (done-when once S1 and S2 land) |
| **S4 ID links, corrections, reviews, problem admin** | the group handshake (used by S1 and the online route), notices, corrections and declined amendments, field reviews, reversals, problem merge | `services/api/src/patients/{id-links.ts, corrections.ts, field-reviews.ts, problems-admin.ts}`; `services/api/test/{id-links,corrections,field-reviews,problems-admin}.test.ts` | S0 | 13.3 rows green |
| **P0 Phone core** (pure Dart) | normalize, trigram, scorer, constants, DOB parser, token, access helpers, recognisability, the allergy badge rule | `apps/mobile/lib/patients/{normalize.dart, trigram.dart, matching.dart, match_constants.dart, dob.dart, id_link_token.dart, access.dart, recognisable.dart, display.dart}`; `apps/mobile/test/patients/{normalize,trigram,matching,dob,id_link_token,access,display}_test.dart` | S0; S2's vectors for the scorer | vectors pass |
| **P1 Phone sync layer** | local DB v2 (FTS5 `secure-delete`), entity registry with parents of sets, `_classify`, clock pause per entity, `confirm` with server and details, `replaceRejected`, re-entrant `_tx`, scopes and purge (FTS rows and tokens with the chart), `clearServerData`, authoritative redirects, the stale marker, refresher hooks, the fake | `apps/mobile/lib/sync/{local_db.dart, local_store.dart, entities.dart, sync_engine.dart, sync_controller.dart}`; `apps/mobile/lib/auth/session_controller.dart` (sign-out clearing and marker); `apps/mobile/test/sync/**` (fake, scenarios, store, harness; `sync_scenarios_test.dart` seeds a patient before its encounter); `apps/mobile/test/patients/entities_test.dart` | S0, P0 (the fake's flags use the Dart scorer) | 13.5 store tests; phase 2 scenarios green |
| **P2 Phone patients domain** | repository (intake, edit, aliases, allergies, consents, problems, notes, links), index refresher and swap, FTS search with the in-memory legal-name scan, chart cache with `CacheSource` and adaptive batches, ID links over groups and `secureCopy`, done-when and scenarios, live tests | `apps/mobile/lib/patients/{patient_repository.dart, team_index.dart, patient_search.dart, chart_cache.dart, id_links.dart, problems.dart, consent_script.dart, patient_providers.dart}`; `apps/mobile/lib/security/secure_copy.dart`; `apps/mobile/android/app/src/main/kotlin/**/MainActivity.kt`, `apps/mobile/ios/Runner/AppDelegate.swift` (`secureCopy`); `apps/mobile/test/patients/{fts_search,team_index,chart_cache,id_links}_test.dart`, `done_when_test.dart`, `patient_scenarios_test.dart`, `live_patients_test.dart`; `tools/live-sync.sh` (runs the second live file) | P0, P1; S1–S4 for live | 13.1 and 13.6 green against the fake and live |
| **P3 Phone screens** | navigation shell, Patients tab, intake and edit, duplicate panel and sheet, profile, ID card, problem, add problem, review sheet, Needs attention texts and notices, Home line | `apps/mobile/lib/features/patients/**`; `apps/mobile/lib/app.dart`; `apps/mobile/lib/app_providers.dart`; `apps/mobile/lib/features/home/home_screen.dart`; `apps/mobile/lib/features/sync/{needs_attention_screen.dart, sync_labels.dart, sign_out_dialog.dart}`; `apps/mobile/lib/design/widgets/{allergy_badge.dart, status_chip.dart, birth_field.dart}`; `apps/mobile/pubspec.yaml` (asset); `apps/mobile/test/features/patients/**` (including `add_problem_screen_test.dart`, `field_review_sheet_test.dart`, `intake_screen_edit_test.dart`); `apps/mobile/test/design/contrast_test.dart`; `apps/mobile/test/helpers/app_harness.dart` | P2's public API (can start against its interfaces) | 13.5 widget tests in three themes and at 200% |
| **W0 Portal shell** | nav (existing keys), labels, DOB parser, `/c`, proxy, helpers | `apps/portal/src/app/(app)/layout.tsx`; `apps/portal/src/lib/{labels.ts, dob.ts, dob.test.ts}`; `apps/portal/src/app/(app)/team/quarantine/page.tsx`; `apps/portal/src/app/(app)/team/devices/page.tsx`; `apps/portal/src/app/c/page.tsx`; `apps/portal/src/proxy.ts`; `apps/portal/e2e/{helpers.ts, a11y.spec.ts}` | S0 | `/c` and labels pass axe |
| **W1 Portal patients** | search, profile (all active cards), ID card panel, corrections, history, reviews | `apps/portal/src/app/(app)/patients/**`; `apps/portal/src/app/(app)/team/reviews/**`; `apps/portal/src/app/actions/{patients.ts, reviews.ts}`; `apps/portal/src/components/{PatientHeader.tsx, FieldHistory.tsx, BirthField.tsx, ReviewForm.tsx, IdCardPanel.tsx}`; `apps/portal/e2e/{patients,corrections,id-card}.spec.ts` | W0; S1, S2, S4 for e2e | 13.7 rows green |
| **W2 Portal duplicates, merges, reversals** | queue, side by side, decisions, merges and undo (`patients.correct_identity`), problem reversals | `apps/portal/src/app/(app)/team/{duplicates,merges,problem-reversals}/**`; `apps/portal/src/app/actions/{duplicates.ts, problems.ts}`; `apps/portal/src/components/SideBySide.tsx`; `apps/portal/e2e/{duplicates,problems}.spec.ts` | W0; S3, S4 for e2e | 13.7 rows green |
| **D Documents** (last) | plan decisions D25–D42, the phase 3 status, section 6 rows (14.1), risks (14.2); compliance mapping | `IMPLEMENTATION_PLAN.md`; `docs/compliance/{access-policy.md (new: the projection table, the Logistics sensitive-details reason, Billing/Data per the PRD, index eligibility), hipaa-security-rule.md (164.502(b), 164.312(b), 164.520, 164.526 rows), accessibility.md (new screens), risk-analysis.md (risks 1, 2, 8, 11, 18)}` | all | second-person review (plan risk 3) |

Phase 3 is done when the done-when scenario passes against the fake (P2) and against the real API in CI's live job (P2), the server half passes (S3), the portal shows the flagged pair with axe clean in three themes (W2), and every phase 2 suite still passes.

---

## 16. Decisions for the plan

Rows for `IMPLEMENTATION_PLAN.md` section 2's table, in its style. D37–D41 record the project lead's decisions of Oct 22; D42 and the amended D26, D27, D29–D33 come from the adversarial review.

| # | Decision | Why |
|---|---|---|
| D25 | Patient-side records ride the existing change protocol as **seven entities** (`patient`, `patient_alias`, `patient_allergy`, `patient_consent`, `problem`, `problem_note`, `id_link`), and **the permission is checked per entity** (`ApplyActor.permissions`, existing keys only) instead of one `encounters.chart` flag. Parents are checked for creates and for sets whose value names a record (a problem status's encounter, an encounter's patient), on the server and in `_classify`. | Every rule the phase 2 reviews hardened (receipts, fix chains, holds, hand-over) applies to patients unchanged, and a CHW can register patients without being able to chart. A parent the server lacks must be a stale reference or a hold, never a constraint firing inside a push. |
| D26 | **Reconciliation is chosen by field class.** Drafts keep D9's side-by-side conflict. Patient demographics **keep both values**: the change is accepted, the other value is kept in history, a field review opens, and the receipt carries the chart's value. Legal name and birth date accept a fill only from someone who saw the current value (or into a blank); a stale fill is kept as an alternate for an admin, and an estimate is refined only within `ESTIMATE_RANGE`. Aliases, allergies, consents and problem notes are union records; retractions are set-once; work arriving for a problem marked entered in error is kept in its history. A followed change that was kept rather than applied never counts as "saw current" (D16 exception). | Module 9 names a different rule for shared patient fields than Oct 19 does for drafts, and a disagreement about someone's usual area must not sit in Needs attention or block a route. A fill that never saw an admin's correction must not undo it (Oct 19). Without the D16 exception, a second offline edit would overwrite the chart silently. |
| D27 | **A merge moves nothing.** Each patient row keeps a maintained `canonical_id`; every chart read groups by it, and a schema test lists every table with a `patient_id`. Late creates naming the merged ID are stored as sent; late field edits are redirected to the survivor; undo recomputes `canonical_id` and is refused while a later merge sits on top. **The server's redirect lists are authoritative on the phone**: the index's first page carries the complete list and each chart bundle the list for its IDs, and they replace receipt-learned rows, so an undo reaches every phone. | A merge writes only patient rows, so it never contends with pushes on child tables, and undo is exact by construction, records that arrived after the merge included. A redirect learned from a receipt would otherwise outlive an undo and attach new work to the wrong person. |
| D28 | **One match formula, implemented in TypeScript and Dart, pinned by vectors generated from Postgres.** SQL (`patient_candidates` over trigram, Double Metaphone and token GIN indexes led by `team_id`) and the phone's FTS5 trigram table only retrieve candidates, **ranked before they are cut**; a birth year orders ties and never retrieves on its own. Double Metaphone is server-only; nicknames and the accent map are generated data. | Search and duplicate warnings must agree between phone and server, and that must be a test. An unordered cut drops the real match at random once a year range alone fills the limit. |
| D29 | **The team index goes to roles with `patients.view` and a field permission, holds no legal name, nothing derived from one, no token and no clinical content, and is versioned, keyset-paged, staged and swapped in one SQLite transaction.** It expires 7 days after its last refresh and is deleted at every sign-out (a secure-store marker covers sign-out from the lock screen) and on a 403. FTS5 `secure-delete` is on, so deleted names leave no trigrams in the file. | Minimum necessary for the largest PHI store on a phone, and a download that survives EDGE and dead zones without ever exposing half an index. SQLite's `secure_delete` pragma does not reach FTS5 segments. |
| D30 | **The route cache is the existing `records`/`fields` plus `cache_scopes` (`opened`, `today`, later `route`), with local work as an implicit scope.** Phase 3 caches only charts a person opened, pinned (at most 50) or worked on, for 24 hours; the purge removes a chart's search rows and ID link tokens with it. Charts download in D24-style batches (10, halved on a timeout to 1, doubled after each answer, up to 50), gzipped. | Offline edits need field versions, the purge needs one more condition, phase 7 adds a `route` source without touching the purge, and nothing of a chart outlives its 24 hours. A fixed 50-chart bundle never finishes on EDGE. |
| D31 | **ID link tokens are 128 random bits, base64url, stored as plaintext and SHA-256 (every lookup by hash) and carried in the URL fragment.** The phone issues links through the `id_link` sync create, online or offline. The handshake locks the patient group's active links, accepts when the phone's `replacesLinkId` is still active anywhere in the group, retires every active link in the group for the winner, and inserts the new link with its final status (`on conflict (token_hash)` only). A conflict goes to the newer `effective_at`; the loser is accepted as retired and both issuers and the admins are told. A link for a merged patient is rejected. | Copy ID link must keep working for anyone on the team; the fragment keeps the token out of every server log; one code path on the phone; the PRD's conflict and merged-patient rules; a multi-target `on conflict do nothing` would have swallowed the one-active index. |
| D32 | **Patient-side writes, and encounter writes that name a patient, take the team's audit-chain advisory lock first; merges and undos lock patient rows `FOR NO KEY UPDATE`.** | It is the lock every audited write already takes, so it adds no contention; an encounter insert's FK check holds `FOR KEY SHARE` on the patient, which `FOR NO KEY UPDATE` never waits on, so a merge and a push have one lock order and can't deadlock; duplicate matching always sees a concurrent create. |
| D33 | **Every patient read goes through one projection; a role searches only by fields it can see; audit details carry IDs, counts and hashes, never names, birth dates, search terms, tokens or comment text; events that disclose several patients list them in `details.patientIds` (GIN-indexed)**, including offline searches (up to 50) and `merges.viewed`. The one exception is an index page, which records its exact ID range (`after`, `next`, version) instead of up to 1,000 IDs: a patient's access report finds every page whose range held its ID after it was registered. A refusal (409) carries codes, IDs and versions only. | Minimum necessary becomes a function, not a screen rule, and each patient's access report finds the searches, match checks, listings and index downloads that showed them, without multiplying audit volume by the team size on every refresh. A 409 thrown inside the transaction rolls back its audit, so it must disclose nothing. |
| D34 | **Registration consent is required in the patient create and stored append-only (`patient_consents`); "unable to consent" creates the chart with a banner; "declines" creates nothing.** | The server enforces consent in the create's transaction, later decisions union without reconciliation, and care is never blocked. |
| D35 | **The clock pause covers problems, problem notes and ID links (and, as before, encounters and notes), not intake, demographics, aliases, allergies or consents.** An intake that asks for a card while the clock is off saves without the link. | ID link conflicts are decided by device time; registering the person in front of you is not medication timing. |
| D36 | **Problem status: the latest observation by corrected device time wins, every observation is a history row, and only `patients.reverse_resolved` moves a problem out of Resolved.** A worker who disagrees adds a new entry (a recurrence, or a reversal request) that an admin reverses and merges in the portal. | The PRD's flow, with no backward write from a phone, and the bag check stays right while the admin decides. |
| D37 | **No new permission keys** (project lead). Every check maps to the 23 keys of `0002`: the team index on a phone needs `patients.view` plus one of `patients.edit`, `encounters.chart`, `checkins.create`; undoing a merge needs `patients.correct_identity`; viewing the problem list needs `patients.view` plus `encounters.chart` or `billing.view_codes`; adding or changing a problem or a note needs `encounters.chart`; Resolved back to Ongoing needs `patients.reverse_resolved`; reviewing duplicates needs `patients.review_duplicates`; legal name and DOB corrections need `patients.correct_identity`. The CHW preset therefore sees no problem list. | PRD module 1: custom roles use "any combination of the existing permissions; no new permission types in the MVP (Oct 12)". Undoing a merge is an identity correction, admin-only by default. |
| D38 | **Billing/Data follows the PRD**: it views charts, ICD-10/CPT codes and supply logs and runs exports; it does not see sensitive details (Oct 19), and gets no team index on the phone. Nothing narrows it further. | The PRD's role table; no PRD text gives a reason to hide more, and Billing/Data holds no field permission. |
| D39 | **A merge retires no card** (project lead). Every active token in the merged group keeps opening the surviving chart; the partial unique index keeps one active token per patient record. Regenerating, online or offline, retires every active token in the group and issues one, so from then on the group has one; the handshake accepts when the old token the phone named is still active anywhere in the group. Undoing a merge gives each record back its own tokens as they stood. A deliberate reading of module 2. | The PRD invalidates a token only when staff regenerate it, and the patient may be carrying either card. |
| D40 | **No legal name on the phone outside a chart** (project lead). The team index and the phone's search table hold no legal name and nothing derived from one (no trigram rows, no phonetic codes), only the PRD's list. A legal name appears on the phone only inside a chart the person opened, kept for today or is working on (24-hour expiry), never in a result list or the duplicate panel; the chart's search rows purge with it. | Module 2's index list, and minimum necessary for a lost phone. |
| D41 | **Search text is not stored in the audit log**, online or offline; the log records which patients a search disclosed, with who, when, the criteria and the count. PLAN-OPEN for counsel. | Minimum necessary; the chain is permanent and can't be redacted. |
| D42 | **A rejection never stops a phone's queue.** Rules that span fields (someone must stay recognisable) are checked on the row the write would leave, and a race the worker can't fix is accepted as history with a notice. Every change also applies inside a savepoint: an integrity-constraint error becomes a stored `server_constraint` rejection, while a transient error still stops the batch for a retry. | `push.ts` stops at a throwing change and the phone resends it first, so one constraint error would block that phone forever; module 9 also makes any rejection a hard stop on the next route confirmation. |

---

## 17. Review findings not taken

Each of the 24 findings was checked against the design, the code at `7a39dc3` and the PRD. All 24 hold; every one is fixed above (0.4 maps them). Where only part of a finding's proposed fix was taken, the part left out is listed here with the reason.

| Finding | Part not taken | Why |
|---|---|---|
| 5 (identity `fills`) | "Never fill over a value whose last history kind is `corrected` or `review_decided`" | It would block a legitimate fill by someone who saw the corrected value (an admin corrects to {Delbert, —} and a worker later adds the family name the patient gives). The rule taken instead, "a fill only when `saw`", already stops a stale fill from undoing a correction, which is the harm the finding describes. |
| 7 (problem entered in error) | Keeping the rejection and giving each `details.problem` a defined resolution through `replaceRejected` | The finding's first fix (accept as history, store notes) is simpler and loses nothing; a rejection would still be a hard stop on route confirmation until the worker acted. |
| 10 (audit limit) | A done-when assertion for a 50-result offline search | The assertion is in `fts_search_test` (13.5) with a 60-patient fixture. The done-when follows the Build plan's sentence, and the seed doesn't hold 50 patients sharing a name. |
| 17 (clock pause at intake) | Exempting first-card links from the clock pause | Two phones can each make a "first card" offline for the same patient, and that conflict is decided by device time too, so a first card needs the clock as much as a regeneration does. |
| 19 (bulk reads) | Listing up to 1,000 patient IDs in every `patient.index_downloaded` event | Each changed index is downloaded by every field phone; listing every ID would multiply audit rows by the team size on every refresh. The finding's alternative, a documented exception in D33, is taken, made exact by recording each page's ID range. |
| 23 (new permission keys) | Recording the departure in 14.3 and keeping `patients.search_offline` | Superseded by the project lead's decision (a): no new keys at all (D37). |
| 24 (merge retires a card) | Letting the reviewer choose which card stays valid in the merge form | Superseded by the project lead's decision (c): a merge retires no card (D39), so there is no choice to make. |
