> Draft plan (Nov 14), written before phase 4 was built. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 10: billing export, data export, grant reports

"PRD main N" is a line of the product spec's main tab; "Build plan N" a line of its Build plan tab. Paths are from the repository root. "Next free number" means the lowest unused migration number when the unit starts.

## 1. Scope and Done when
**Done when** (Build plan 121; `IMPLEMENTATION_PLAN.md` section 4, phase 10 row): a month of made-up encounters exports to the agreed format. The format is not agreed yet (PRD main 676), so the test runs against the built-in profile `generic-v1` and a second test profile, to prove a new format is a data change (10.1).

| In | PRD |
|---|---|
| Billing export: patient identifiers and Medicaid ID when known; date of service; place of service 27; ICD-10 and CPT "from order sets and templates"; rendering provider and NPI; attesting physician and NPI; signed note reference and signature time; supplies used | main 651-658, 672 |
| Resident and NP (and, by default, PA) notes enter the billing export only after an attending attests; drafts and unsigned notes stay out | main 99, 211-216, 454, 649 |
| A correction to a note that was already exported flags it for Billing/Data to review | main 462 |
| Full customer data export, CSV and JSON, free, at any time | main 649, 678 |
| Grant report, counts only, as CSV: unique patients, encounters by type, check-ins (medical and non-medical), referrals made, supplies used, service area | main 308, 473, 680 |
| Exports are desktop only, for admins and Billing/Data, after signing in again, watermarked with user and time, and logged; bulk exports show on the audit dashboard | main 600, 602, 625, 634, 639 |
| A Medicaid ID can be recorded for a patient, on the phone, offline | main 653 ("when known"; no field exists today) |

| Out | Taken by | PRD |
|---|---|---|
| Automated claims (837, clearinghouse), a coding function | After the MVP | main 647, 784 |
| FHIR export | Later | main 678 |
| Custom billing fields a team pays for: done by adding a profile file, no screen | Platform work, per team | main 649 |
| Referral completion rate | V2 | main 680, 507-512 |
| The partner FQHC's real format, Michigan payer rules, SB 402 | People (11.2); a profile file when known | main 660-676 |
| Photo and document bytes in the data export (rows and metadata are in) | PLAN-OPEN 11.1 #9; phase 12 at the latest | main 678 |
| Export from a phone | Never ("Not offered on mobile") | main 602 |
| Pricing and charging for exports | Not built | plan section 6 |

## 2. Ground truth
What the code has today:

| Fact | Where |
|---|---|
| Keys `billing.view_codes`, `exports.billing`, `exports.grant`, `exports.data` exist. Program Admin holds all 23 keys. Billing/Data holds `patients.view`, `billing.view_codes`, `inventory.view`, `exports.billing`, `exports.grant`; it does not hold `exports.data`, `patients.view_sensitive` or any field permission. | `services/api/src/auth/permissions.ts:12-37`; `db/migrations/0002_identity_access.sql:86-97` |
| `CAPABILITIES[credential].billingNeedsAttestation` is true for resident, NP and PA (PA is PLAN-OPEN). | `services/api/src/auth/permissions.ts:118-141` |
| `teamScope(c, deps, {permissions, recentAuth})` requires MFA always, and with `recentAuth` a sign-in within 15 minutes (`reauth_required`). `scope.tx(async (tx, audit) => …)` writes the audit event in the caller's transaction. | `services/api/src/auth/context.ts:52, 141-155, 210-215, 277-283` |
| An export-like read exists: the audit search is a POST, runs in `scope.tx`, and logs itself with counts. Copy its shape. | `services/api/src/routes/audit-log.ts:84-145` |
| The audit search finds a patient through `patient_id` and `details.patientIds`. | `services/api/src/routes/audit-log.ts:128-131`; D53 |
| Transactions start in one place, with `sql.begin`. No route sets an isolation level today. | `services/api/src/db/database.ts:36` |
| `encounters` has `kind` (`medical`, `non_medical`), `status`, `patient_id` (nullable), `started_at`, `clock_verified`, `location`. `encounter_notes` has `note_type_key`, `status`, `author_user_id`, `data`. | `db/migrations/0004_sync.sql:33-71` |
| `patients` has legal and preferred names, birth fields, `usual_area`, `canonical_id`. It has no Medicaid ID. | `db/migrations/0009_patients.sql:34-60` |
| `problems` has `code_system` (`icd10cm`), `code`, `sensitive`, `status_encounter_id`; every status observation is a `field_history` row. | `db/migrations/0010_problems.sql:8-20`; D36 |
| Every table with a `patient_id` must be listed in `CHART_TABLES`, or a schema test fails. | `services/api/src/patients/charts.ts:24-37` |
| `teams.settings` is a JSON object for plain team values. No time zone is stored. | `db/migrations/0002_identity_access.sql:15-16` |
| `forbid_mutation()` makes a table append-only; the team policy block is the loop in `0004_sync.sql`. | `db/migrations/0001_base.sql:103-109`; `db/migrations/0004_sync.sql:185-195` |
| The portal has `/audit`, `/patients`, `/team/*` and a `/reauth` page; server actions live in `apps/portal/src/app/actions/`. | `apps/portal/src/app/` |
| The last migration is `0016_merge_review_undo.sql`. Only `packages/contract` exists under `packages/`. | `db/migrations/`; `packages/` |

What earlier phases must have delivered (each is a design today, not code; check before cutting cards):

| Phase | Thing this phase reads | Design |
|---|---|---|
| 4 | `note_signoffs` (`effect`, `signer_name`, `signer_credential`, `signer_npi`, `signed_at`, `received_at`, `clock_verified`, `content_hash`, `needs_attestation`) and `encounter_notes.signoff_id` | `docs/design/phase-4/lifecycle.md` 2.3 |
| 4 | `note_attestations` (`signoff_id`, `attending_name`, `attending_npi`, `attested_at`, `content_hash`); a per-note attestation state with the values `not_needed`, waiting, `attested` | lifecycle 2.4, 3.5 (column name not verified) |
| 4 | `note_corrections` (`outcome`, `created_at`); a server function that gives a note's current content hash; `referrals` (`referred_on`, `status`) | lifecycle 2.3, 2.5, 3.6 |
| 4 | The rule "a note is exported when `status = 'signed'` and attestation is `not_needed` or `attested`" | lifecycle 3.5 |
| 5 | `team_presets` and `team_preset_versions`, `validatePreset`, the preset routes `/v1/admin/presets/{kind}`, the phone's preset download | `docs/design/phase-5-admin-configuration.md` 4.1, 4.2, 7 |
| 6 | `encounter_orders` (`encounter_id`, `item_id`, `quantity`, `bundle_id`, `voided_at`); `stock_movements` (`reason` `dispense`, `void`) | `docs/design/phase-6-orders-inventory-alerts.md` 4.2, 4.3 |
| 7 | `routes` (`name`, `service_date`) and the way an encounter is attributed to a route (for "service area") | `docs/design/phase-7-routes-runs.md` section 4 (the attribution column not verified) |
| 9 | `check_ins` with a `kind` (`medical`, `non_medical`), a time and a patient (PRD main 308) | `docs/design/phase-9-qr-checkins-queue.md` 4.1 (column names not verified) |

If a phase 7 or 9 table is missing when this phase starts, its grant metric is left out of the report and named in the report's notes; nothing else waits on it.

## 3. The design in one page
1. **Every export is a run.** One pipeline serves billing, grant and data: start, build, finish. The run row stores who, the parameters, the profile and code map versions, the cut, the counts and each file's SHA-256. One pattern repeats three times.
2. **Three transactions, in this order.** A: record the run and its audit event. B: read everything in one repeatable-read snapshot and store the files as parts. C: record the result, the patients disclosed and the audit event. No byte leaves before C commits, so a disclosure that can't be logged doesn't happen (CLAUDE.md, "Rules that never bend").
3. **Why B is its own transaction.** The audit chain reads its previous hash under a lock; inside a repeatable-read snapshot it would read a stale head and break the chain (D7). So B writes no audit event, and A and C stay ordinary transactions.
4. **Billing is a mapping over a stable internal model.** A loader builds `BillingEncounter` objects. A profile (a JSON file) names columns by path. The agreed format is a new profile file, not new code.
5. **Codes are worked out at export time, not stored on phones.** ICD-10 comes from the problems observed in the encounter. CPT and HCPCS come from a team code map keyed by bundle, item or note type (PRD main 437, 655). Nothing new syncs for codes, and a wrong map is fixed without touching a signed note.
6. **A note is exported once per content.** The key is (note, content hash). A corrected and re-attested note has a new hash, so it re-enters the next "new" run as a replacement, and the old line is flagged for review (PRD main 462).
7. **"New since the last export" is the default mode, not a calendar month.** A resident's note attested in December for a November visit must still reach the biller (PRD main 216).
8. **An export shows the runner only what the chart would.** Billing/Data does not see sensitive details (PRD main 121; D38), so sensitive diagnosis codes are withheld and counted. The full data export needs every view permission.
9. **Grant reports are counts, with small cells suppressed.** A cell that counts people or visits and is between 1 and 10 is shown as "<11", and a second cell is hidden when one could be worked out by subtraction.
10. **The only thing a phone makes in this phase is a Medicaid ID.** It is an append-only record like an allergy: created, or marked entered in error, never overwritten. Two phones offline cannot conflict.

## 4. Data model
Rules for every migration: plain SQL, additive, one transaction, the next free number, named by what it adds. Every new table gets the team policy block of `db/migrations/0004_sync.sql:185-195` and composite foreign keys on `(team_id, …)` as `0009_patients.sql` does. No migration touches `known_permissions()`, a role row or the audit tables.

### 4.1 `<next>_patient_payer_ids.sql` (level X: policy, trigger, `patient_of_change`)
`patient_payer_ids`: a synced record shaped like `patient_allergies` (`db/migrations/0009_patients.sql:191-218`).

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid primary key | Made on the phone |
| `team_id`, `patient_id` | uuid not null | FK `patients (team_id, id)`; `unique (team_id, id)` |
| `kind` | text not null | `medicaid` only (check). Other payers are a later value |
| `value` | text not null | Normalized by `normalizePayerId` (5.3): `^[A-Z0-9]{4,20}$` |
| `status` | text not null default `active` | `active` or `entered_in_error`; set once |
| `error_reason`, `error_by`, `error_at` | | As on `patient_allergies` |
| `recorded_at`, `clock_verified`, `author_user_id`, `created_device_id` | | As on `patient_allergies` |
| `field_versions`, `field_meta`, `version`, `created_at`, `updated_at` | | The bookkeeping every synced record carries |

Index `(team_id, patient_id, recorded_at desc)`; the touch trigger; no `delete` for the app role. `patient_of_change` is replaced with the same body plus a `patient_payer_id` branch (the value's `patientId`). The same card adds `patient_payer_ids: 'group'` to `CHART_TABLES`.

### 4.2 `<next>_export_runs.sql` (level X: policies, append-only triggers)
| Table | Append-only | Columns |
|---|---|---|
| `export_runs` | Yes | `id` uuid pk default random; `team_id`; `run_no` integer, `unique (team_id, run_no)`, the team's highest plus 1, taken under the audit-chain lock; `kind` (`billing`, `grant`, `data`); `params` jsonb (5.1; dates, mode, format only); `requested_by` uuid FK users; `requested_role` text; `profile_key`, `profile_version` integer, `profile_sha256` (billing only); `code_map_version` integer (billing only); `rerun_of` uuid; `started_at` timestamptz default now(); `expires_at` timestamptz (started plus 24 hours) |
| `export_run_results` | Yes | `run_id` uuid pk, FK `export_runs (team_id, id)`; `team_id`; `outcome` (`completed`, `failed`, `too_large`); `failure_code` text (a code, never a message); `snapshot_at` timestamptz; `audit_seq_at_cut` bigint (the team's newest audit `seq` seen by the snapshot); `counts` jsonb (numbers only; 9); `files` jsonb: `[{part, name, bytes, rows, sha256}]`; `finished_at` |
| `export_parts` | No: insert and delete only | `team_id`, `run_id`, `part` integer, primary key `(run_id, part)`; `name` text; `content` bytea, `octet_length <= 4194304`; `sha256` text, 64 hex; `rows` integer. No `update` grant |
| `billing_export_items` | Yes | `id` uuid pk; `team_id`, `run_id`; `encounter_id`, `note_id`, `signoff_id`; `attestation_id` (null when none was needed); `content_hash`; `patient_id` (canonical at the time); `date_of_service` date; `replaces_run_no` integer; `unique (run_id, note_id)`; index `(team_id, note_id)` |
| `billing_item_reviews` | Yes | `id` uuid pk; `team_id`; `item_id` FK; `correction_id` FK `note_corrections`; `decision` (`will_resend`, `no_action`); `reviewed_by`, `reviewed_at`; `unique (item_id, correction_id)` |

A run's state is not stored. It is worked out: no result row and started under 10 minutes ago is `running`; no result row and older is `did_not_finish`; otherwise the result's `outcome`; `completed` and past `expires_at` is `expired`. `billing_export_items.patient_id` goes into `CHART_TABLES` as `not_chart` with a comment (it is disclosure history, read through the audit log).

### 4.3 `<next>_billing_code_map_kind.sql` (level T: a check constraint only)
Widens the `team_presets.kind` check with `billing_code_map`, and adds `unique (team_id) where kind = 'billing_code_map'` as `settings` has (phase 5 design 4.1). Body, at most 32 KiB:
`{name: "Billing codes", rules: [{source: {kind: "bundle"|"item"|"note_type", ref: <preset id or note type key>}, codes: [{system: "cpt"|"hcpcs", code, units: "one"|"quantity", modifiers: [0 to 4 of two characters]}] (1 to 10)}] (0 to 500)}`. No rule source twice. Code formats: CPT `^[0-9]{4}[0-9A-Z]$`, HCPCS `^[A-V][0-9]{4}$`. No description text is stored for a CPT code (12, risk 6).

### 4.4 Data files, not tables
| File | Holds |
|---|---|
| `packages/contract/data/billing-profiles/generic-v1.json` | The default profile (5.4) |
| `packages/contract/data/billing-profiles/test-alt-v1.json` | A second profile for tests only: other order, one row per procedure, US dates |
| `teams.settings.billingProfile`, `.billingPlaceOfService`, `.timeZone` | Defaults `generic-v1`, `27`, `America/Detroit`. Read with a fallback; no migration |

## 5. Rules
### 5.1 A run: states, transitions, who
| Step | Who | What happens | Refusals |
|---|---|---|---|
| Start (transaction A) | Billing: `exports.billing` + `patients.view` + `billing.view_codes`. Grant: `exports.grant`. Data: `exports.data` + `patients.view` + `patients.view_sensitive` + `patients.view_sensitive_exams`. All: MFA and `recentAuth` | Takes the audit-chain lock; refuses if the team has a `running` run; deletes expired parts; inserts `export_runs`; audit `export.started` | 403 `forbidden`, `mfa_required`, `reauth_required`, `export_needs_full_view`; 409 `export_running`; 422 `invalid` |
| Build (transaction B, repeatable read) | The server | Sets the team scope; loads; renders; splits into parts of at most 4 MiB; inserts `export_parts`. More than 5,000 notes (billing) or 500,000 rows (data): `too_large` | none to the caller yet |
| Finish (transaction C) | The server | Inserts `export_run_results`; for billing, `billing_export_items`; audit `export.completed` and `export.patients_disclosed` (9). On a failed build: result `failed` or `too_large`, audit `export.failed`, and parts deleted | 500 `export_failed`; 422 `too_large` |
| Download | The person who started the run, holding the same permissions, MFA and `recentAuth` | One part per request; audit `export.part_downloaded` in the same transaction as the read | 404; 403; 410 `expired`; 409 `not_ready` |
| Review a flag | `exports.billing` | Inserts `billing_item_reviews`; audit `export.flag_reviewed` | 404; 409 `already_reviewed` |

Billing `params`: `{mode: "new"|"period"|"rerun", from?: date, through?: date, runNo?: integer}`. Grant: `{from, to}`, at most 366 days. Data: `{format: "csv"|"json"}`. Dates are team-local dates (5.3 `periodBounds`).

### 5.2 Which notes are billable
`billable` decides, first match wins. Input: `{encounterKind, hasPatient, noteStatus, signoffEffect, attestation}`. Output: `{include, reason}`.

| # | When | `reason` | In the file | PRD |
|---|---|---|---|---|
| 1 | `encounterKind` is `non_medical` | `non_medical` | No | main 379 |
| 2 | no patient | `no_patient` | No | main 653 |
| 3 | `noteStatus` is `draft` | `draft` | No | main 99 |
| 4 | `noteStatus` is `completed`, or `signoffEffect` is not `signed` | `unsigned` | No (a student's note waiting for a co-signer) | main 213 |
| 5 | `attestation` is waiting | `awaiting_attestation` | No | main 216, 454 |
| 6 | otherwise | `ready` | Yes | |

A `ready` note with something missing is still exported, and the run counts the problem (IDs only): `missing_npi`, `missing_attesting_npi`, `no_diagnosis`, `no_procedure`, `time_not_verified`, `payer_id_conflict` (two active Medicaid IDs that differ). PLAN-OPEN 11.1 #5. The rendering provider is the signer of the note's current sign-off; for a student's note that is the co-signer (PRD main 656). The attesting physician comes from the newest attestation of that sign-off.

### 5.3 The pure functions
All TypeScript, in `services/api/src/exports/` (the folder is not a level X path). Only `normalizePayerId` has a Dart twin (`apps/mobile/lib/patients/payer_id.dart`), because a phone runs no export (PRD main 602). Each vector file is under `packages/contract/test-vectors/` and is read by `services/api/test/contract-vectors.test.ts`.

| Function (file) | Input | Output | Vectors |
|---|---|---|---|
| `billable` (`eligibility.ts`) | 5.2 | `{include, reason}` | `billing-eligibility.json` |
| `deriveProcedures` (`codes.ts`) | code map body; the encounter's orders not voided `[{itemId, bundleId, quantity}]`; `noteTypeKey` | `[{system, code, units, modifiers, source}]`: note type rules first, then bundle (once per bundle), then item (`units: "quantity"` sums quantities); the same code and modifiers twice is merged, units added; sorted by system, code | `billing-codes.json` |
| `validateCodeMap` (`codes.ts`) | body | `[]` or `[{path, code}]`: `bad_code`, `duplicate_source`, `too_many` | `billing-codes.json` |
| `selectForRun` (`selection.ts`) | `mode`; candidates `[{noteId, contentHash, dateOfService}]` (ready only); prior items `[{noteId, contentHash, runNo}]`; `params` | `{items: [{noteId, contentHash, replacesRunNo, firstRunNo}], changedSinceRun}`. `new`: no prior item with the same pair, date up to `through`; `replacesRunNo` is the highest run that holds the note under another hash. `period`: every candidate in the range; `firstRunNo` set when exported before. `rerun`: run `runNo`'s items whose pair is still a candidate; the rest are counted in `changedSinceRun`. Sorted by date, encounter, note | `export-selection.json` |
| `csvCell`, `csvRow` (`csv.ts`) | a value; a delimiter | Text. Quotes when the cell holds the delimiter, a quote or a line break; a cell starting with `=`, `+`, `-`, `@`, tab or carriage return gets a leading `'` (a spreadsheet must never run a patient's text as a formula); null is empty | `csv.json` |
| `renderBilling` (`render.ts`) | profile; `BillingEncounter[]`; run facts | `{text, rows, problems: {code: count}}` | `billing-render.json` |
| `suppressCells` (`suppress.ts`) | `[{key, n}]`; `threshold` (11); `showTotal` | `[{key, n or null, shown}]` and `total`. `0 < n < threshold` gives null and `"<11"`. If exactly one cell is hidden and the total is shown, the smallest other non-zero cell is hidden too. Zero stays 0 | `grant-suppress.json` |
| `serviceDate`, `periodBounds` (`period.ts`) | an instant, an IANA zone; or two local dates and a zone | `YYYY-MM-DD`; or `[start, end)` as instants. Vectors include both clock-change days | `export-period.json` |
| `fileName`, `splitParts`, `buildManifest` (`files.ts`) | kind, run number, period, part, extension; rows and a byte limit; run facts | `sineobex-billing-run-0042-part-01.csv` (never a patient or person detail); parts that each end on a row; the manifest of 5.5 | `export-files.json` |
| `normalizePayerId` (`services/api/src/patients/payer-id.ts`, and Dart) | `kind`, raw text | `{ok: true, value}` (spaces and dashes removed, upper case) or `{ok: false, code: "too_short"|"too_long"|"bad_character"}` | `payer-id.json` |

### 5.4 The internal model and the profile
`loadBillingEncounters(tx, team, items, viewer)` (`billing-load.ts`) returns, for each encounter with at least one selected note:

| Path | From |
|---|---|
| `encounter.id`, `.dateOfService` (`serviceDate(started_at, zone)`), `.startedAt`, `.placeOfService` (the team setting) | `encounters` |
| `patient.id` (canonical), `.legalGivenName`, `.legalFamilyName`, `.preferredName`, `.birthDate`, `.birthPrecision`, `.medicaidId` (newest active `patient_payer_ids` in the group, or null) | `patients`, read through the projection of `services/api/src/patients/projection.ts` for the viewer |
| `diagnoses[n].code`, `.display`; `diagnosesWithheld`; `diagnosesUncoded` | `problems` with a status observation naming this encounter, oldest first. A `sensitive` problem is withheld, and counted, unless the viewer holds `patients.view_sensitive` |
| `supplies[n].itemName`, `.quantity`, `.unit` | `encounter_orders` not voided, joined to the item preset |
| `note.id`, `.typeKey`, `.contentHash`, `.signedAt`, `.receivedAt`, `.clockVerified`, `.replacesRunNo`, `.firstRunNo` | `encounter_notes`, `note_signoffs`. The date used is `signed_at` (plan section 6, first row) |
| `rendering.name`, `.credential`, `.npi`; `attesting.name`, `.npi`, `.attestedAt` | `note_signoffs`, `note_attestations` (the values stored at the time, never today's profile) |
| `procedures[n].system`, `.code`, `.units`, `.modifiers` | `deriveProcedures`. Orders belong to the encounter, so when an encounter has several notes they go on its first selected note only |
| `run.no`, `.id`, `.exportedBy`, `.exportedAt` | the run |

A profile is `{key, version, format: "csv", rowPer: "note"|"procedure", delimiter, lineEnd: "crlf"|"lf", header: true|false, columns: [{header, from?: <path>, const?: <text>, transform?: "date_ymd"|"date_mdy"|"datetime_iso"|"upper"|"digits", join?: <text>, max?: <integer>}]}`. A list path without an index needs `join`. With `rowPer: "procedure"`, `procedure.code` and `procedure.units` name the row's own procedure. An unknown path or transform fails `parseProfile` when the API starts and in a test, never during a run. `generic-v1` is one row per note with these columns: run number, exported by, exported at, patient ID, legal family name, legal given name, date of birth, Medicaid ID, date of service, place of service, diagnosis codes (joined by `;`), procedure codes (code, `*`, units, joined by `;`), rendering name, rendering credential, rendering NPI, attesting name, attesting NPI, attested at, note ID, note type, signed at, time verified, supplies (name, `x`, quantity, joined by `;`), replaces run. The note's text is not in it (11.1 #4).

### 5.5 The other two builders
**Data export.** `EXPORT_TABLES` (`tables.ts`) lists every table in the `sineobex` schema that has a `team_id`, as `{table, orderBy, omit: [columns]}` or `{table, excluded: "<reason>"}`. A schema test fails until a new table is listed (the `CHART_TABLES` pattern). Excluded, with the reason: `export_parts` (its own output), device push tokens and device keys (secrets), ID link tokens and their hashes (a token opens a chart). `sync_changes`, `field_history` and `audit_events` are included (11.1 #8). `dumpTable` reads by keyset pages of 1,000 rows. JSON parts are `{"export": {runNo, exportedBy, exportedAt, table, part}, "rows": [...]}`. CSV parts have a header row, JSON columns as JSON text, and a last column `export_run`. Every run ends with `manifest.json`: run facts, the cut, each file's name, rows and SHA-256, the tables excluded and why, and "Photos and documents: metadata only".

**Grant report.** `loadGrantCounts(tx, team, bounds)` (`grant-load.ts`) returns the cells below; `suppressCells` runs on each breakdown; the parts are `report.json` (for the screen) and `report.csv` (`section,key,value`).

| Section | Cell | Counted from | Suppressed |
|---|---|---|---|
| Unique patients | one cell | distinct `canonical_id` with a finished encounter or a check-in in the period | Yes |
| Encounters by type | Medical, Non-Medical; then by note type name | encounters not `draft`; their notes | Yes |
| Check-ins | Medical, Non-Medical | phase 9's `check_ins` that are not voided, by `occurred_at` | Yes |
| Referrals made | one cell | `referrals`, `status = 'active'`, `referred_on` in the period | Yes |
| Supplies used | per item name | `stock_movements`: minus the sum of `dispense` and `void` quantities | No (they count items, not people) |
| Service area | per route name, and "Not on a route" | encounters, by the route they were made on (phase 7) | Yes |

Breakdowns show their total. An encounter counts in the period of its `started_at`, in the team's time zone.

## 6. Sync
One new synced record type. Everything else in this phase is online only.

| Entity `patient_payer_id` | Rule |
|---|---|
| `create` value (strict) | `patientId`, `kind`, `value`, `recordedAt` |
| `set` field | `status` to `{status: "entered_in_error", reason}` (reason 3 to 200 characters), set once, as an allergy's |
| Permission | `patients.edit` plus `patients.view` |
| Clock pause | Not covered, as allergies are not (D35) |

| Case | The server answers |
|---|---|
| Valid create | `accepted`; audit `payer_id.added` (patient, record ID; never the value) |
| `normalizePayerId` fails, or the value sent is not already normalized | `rejected`, reason `invalid_payer_id` with the code. The worker fixes it in Needs attention; the queue goes on (D42) |
| The patient is unknown or merged | As every patient-side record: the stale-reference and merge rules of phase 3 design 2.6 and 2.7 |
| No permission | `rejected`, `forbidden`, as today; held, never dropped |
| The same value twice for one patient, from two phones | Both `accepted`. The chart shows the value once; the export reads the newest active one |
| Two different active values | Both `accepted`. The chart shows both. A billing run counts `payer_id_conflict` |
| `status` set a second time | The `set_once` answer |
| Removed user's phone | Quarantine, as every change; `patient_of_change` names the patient (4.1) |

`apps/mobile/test/sync/fake_server.dart` must mirror: the strict create shape, the `normalizePayerId` check (through the Dart twin), the permission pair, set-once on `status`, and both audit events. `fake_parity_test.dart` pins each answer to the API's (D52).

**What a phone holds.** A patient's payer IDs arrive with the chart, in the chart read of phase 3, and live in the existing `records` and `fields` tables under the chart's cache scope (D30). They are never in the team index or the search table (D40 covers legal names; an insurance number is treated the same way here). They leave the phone when the chart does (D46). A new ID leaves the outbox only after its hash-confirmed receipt. The phone holds no code map, no profile and no export record.

## 7. API routes that only work online
All under `teamScope`. "Billing" below means `exports.billing` + `patients.view` + `billing.view_codes`.

| Route | Permission | Request, answer | Refusals | Audit |
|---|---|---|---|---|
| `POST /v1/exports/billing/preview` | Billing | `{mode, from?, through?}` gives `{ready, awaitingAttestation, unsigned, drafts, alreadyExported, problems}` (counts) | 403; 422 | `export.billing_previewed` |
| `POST /v1/exports/billing` | Billing, `recentAuth` | 5.1 params give `{runId, runNo, outcome, counts, files}` | 5.1 | `export.started`, then `export.completed` or `export.failed` |
| `POST /v1/exports/grant` | `exports.grant`, `recentAuth` | `{from, to}` gives the same shape | 5.1 | same |
| `POST /v1/exports/data` | `exports.data` + the three view keys, `recentAuth` | `{format}` gives the same shape | 5.1 | same |
| `GET /v1/exports/runs` | any of the three export keys | Runs of the kinds the caller may run, newest first: number, kind, state, who, when, counts | 403 | none (no patient data; counts only) |
| `GET /v1/exports/runs/{runId}` | the run's kind | The run, its result and its file list | 404 | none |
| `GET /v1/exports/runs/{runId}/parts/{part}` | 5.1 Download | The part's bytes; `Content-Disposition` with the part's name; `Cache-Control: no-store` | 5.1 | `export.part_downloaded` |
| `POST /v1/exports/billing/flags/search` | Billing | `{reviewed?: boolean}` gives `[{itemId, runNo, noteId, encounterId, patientId, correctedAt, correctionId}]` | 403 | `export.flags_listed` (count, `patientIds`) |
| `POST /v1/exports/billing/flags/{itemId}/review` | `exports.billing` | `{correctionId, decision}` gives 201 | 404; 409 | `export.flag_reviewed` |
| `/v1/admin/presets/billing_code_map…` | `team.manage_presets` (phase 5's routes, unchanged) | Phase 5 design 7; `validatePreset` calls `validateCodeMap` | Phase 5's | `preset.created`, `preset.updated` |

A flag is worked out when it is read: an item whose note has a `note_corrections` row with `outcome = 'corrected'` made after the item's run started, and no review row for that pair. There is no job to fail. The phone's preset download leaves the kind `billing_code_map` out.

## 8. Screens
**Phone** (two changes, both offline):

| Screen | Shows | States and wording |
|---|---|---|
| Patient edit, after the identity fields | "Medicaid ID (if known)", one text field | Errors: "A Medicaid ID has 4 to 20 letters and numbers." Saved offline: the usual "Saved on this phone" state |
| Chart, Identity section | Each active Medicaid ID, with "Entered in error" behind a reason prompt | Two different values: "Two Medicaid IDs are recorded. Mark the wrong one as entered in error." Hidden from a role without `patients.view` |

**Portal** (online only; every page in Day, Night run and High contrast, reflowing at 320 px). A nav entry "Exports" shows for anyone holding one of the three export keys.

| Page | Shows | States and wording |
|---|---|---|
| `/exports` | One card per export the person may run; the last run of each | A card the role can't use is absent, and its URL is refused by the API and logged |
| `/exports/billing` | Mode (New since the last export; A date range; Run again), the preview counts, Run export, the run history, a link to the flagged list | Preview: "{n} notes ready. {n} waiting for an attending to attest. {n} not signed yet. {n} drafts." With withheld codes: "{n} diagnosis codes are hidden from your role. A Program Admin can run this export with them." Nothing ready: "Nothing new to export." |
| `/exports/billing/flags` | Notes corrected after they were exported: run number, date of service, a link to the chart, the correction's time; "Will send again" and "No action needed" | Empty: "No exported note has been corrected." |
| `/exports/grant` | From and To; Run report; the report as tables; Download CSV | A hidden cell shows "<11" with the footnote "Counts from 1 to 10 are hidden to protect patients’ privacy." A missing metric: "Check-ins are not available yet." |
| `/exports/data` | Format (CSV, JSON); Run export; the run history | "This exports everything your team has stored in Sineobex. Photos and documents are listed, but the files themselves are not included yet." |
| `/exports/runs/[runId]` | Who, when, parameters, counts, each file with size and SHA-256, Download per file | Before any download: "This file holds patient details. Once you download it, it is outside Sineobex. Keep it only where your organization allows." States: Running; Did not finish; Too large ("Choose a shorter date range."); Expired ("Files are kept for 24 hours. Run the export again."); only the person who ran it sees Download |
| `/billing-codes` | The code map: one row per bundle, item and note type with its codes; Add, Edit, Remove; version history | Phase 5's preset page pattern and its stale and invalid wording. "Enter the code only. Sineobex does not store code descriptions." |
| `/audit` | A quick filter "Exports" (`actionPrefix: "export."`) | PRD main 634 |

Downloads go through a portal route handler that calls the API and streams the answer; no file is put in browser storage, and the page title is "Export run {number}". Signing in again uses the existing `/reauth` page and its wording.

## 9. Audit events and the PHI rules that apply
| Event | Entity | Details (IDs and counts only) |
|---|---|---|
| `export.started` | `export_run`, id | `kind`, `runNo`, `params`, `profileKey`, `profileVersion`, `codeMapVersion` |
| `export.completed` | `export_run`, id | `runNo`, `kind`, `counts` (rows, patients, encounters, notes, withheld, problems by code), `files: [{part, bytes, rows, sha256}]`, `auditSeqAtCut` |
| `export.patients_disclosed` | `export_run`, id | `runNo`, `chunk`, `patientIds` (at most 500 per event). Billing and data runs only. This is what makes the patient access report show exports (D53) |
| `export.failed` | `export_run`, id | `runNo`, `failureCode` |
| `export.part_downloaded` | `export_run`, id | `runNo`, `part`, `bytes` |
| `export.files_purged` | | `runs`, `parts` |
| `export.billing_previewed` | | the counts returned |
| `export.flags_listed`, `export.flag_reviewed` | `billing_export_item` | count and `patientIds`; `decision`, `correctionId`, patient |
| `payer_id.added`, `payer_id.retracted` | `patient_payer_id`, id | patient; never the value |

Rules: no name, birth date, Medicaid ID, code, note text or file content in any event, log line, URL, page title or error message. `counts` and `params` are checked by a test that walks every value and accepts only numbers, dates, booleans and listed keywords. File names come from `fileName` only. Failure codes are from a fixed list; a database error's text is never stored. An export file is the one place patient details leave the product, by design (PRD main 602); the manifest and every file name the run.

## 10. Tests
### 10.1 The Done when
The fixture `services/api/test/export-fixtures.ts` builds a team for November 2026 through the same writes the product uses (sync pushes and routes, not raw inserts), with "Demo:" descriptors and Medicaid IDs starting `DEMO`: attending notes, resident and NP notes (some attested, some waiting), a student's note (one co-signed, one not), drafts, Non-Medical encounters, an encounter with no patient, a sensitive problem, a bundle with a mapped code, and one note signed on Dec 1.

| # | Step | Asserted |
|---|---|---|
| 1 | Billing/Data previews "new", through Nov 30 | The counts equal the fixture's: ready, waiting, unsigned, drafts |
| 2 | Billing/Data runs it without a recent sign-in | 403 `reauth_required`; no run row |
| 3 | Runs it after signing in again | `completed`; one row per ready note; no draft, unsigned, waiting, Non-Medical, no-patient or December note; every row has place of service 27, an NPI, a date of service in the team's zone; attested rows carry the attending's NPI; the sensitive code is absent and counted |
| 4 | The file's bytes | Equal a golden file in `services/api/test/golden/`; the SHA-256 equals the one in the result and the audit event |
| 5 | The audit log | `export.started`, `export.completed`, `export.patients_disclosed` naming exactly the patients in the file; a patient search of the audit log finds the run; the chain verifies |
| 6 | The same data with `test-alt-v1` | Other columns and one row per procedure, with no code change |
| 7 | An attending attests a waiting note; "new" runs again | Only that note is in the file |
| 8 | The author corrects an exported note; it is attested again; "new" runs | The flag list shows the old item; the new row has `replaces run`; "rerun" of the first run reports `changedSinceRun: 1` |
| 9 | Program Admin runs the grant report for November | Counts equal the fixture's; a cell of 3 shows `<11` and a second cell is hidden; no patient ID anywhere in the parts |
| 10 | Program Admin runs the data export as JSON, then CSV | Every table of `EXPORT_TABLES` has a part; row counts equal `select count(*)`; no excluded column appears; Billing/Data gets 403 |
| 11 | A portal end-to-end test | Run, download, the warning text, axe clean in three themes |

### 10.2 The test that holds each rule
| Rule | Test |
|---|---|
| Nothing is released unless the result and audit committed | `exports-pipeline.test.ts`: make transaction C fail; the answer is 500, no part can be downloaded, no item row exists. Check it bites by returning the parts before C |
| The build reads one snapshot | The same file: a sync push commits between two loader queries (a hook in the test builder); the file holds none of it |
| The audit chain stays valid across a run | The same file: verify the chain after 20 runs interleaved with pushes |
| One run at a time per team | Two starts in parallel: one 409 `export_running` |
| Held until attested; drafts out | Vectors `billing-eligibility.json`; `exports-billing.test.ts` |
| Exported once per content; replacement; rerun | Vectors `export-selection.json`; steps 7 and 8 |
| Sensitive codes follow the runner's role | `exports-billing.test.ts`: Billing/Data against Program Admin on the same data |
| Permissions, MFA, recent sign-in, download by the requester only | `exports-permissions.test.ts`: every route against every standard role and the CHW preset; each refusal is logged |
| Small cells and subtraction | Vectors `grant-suppress.json`; step 9 |
| No formula in a cell; quoting | Vectors `csv.json` |
| Month edges and clock changes | Vectors `export-period.json` |
| Every team table is exported or excluded with a reason | `exports-tables.test.ts` against the live schema |
| No patient detail in an event or a file name | `exports-audit.test.ts` (the walker of section 9) |
| Expired parts can't be downloaded and are purged | `exports-runs.test.ts` with the clock moved 25 hours |
| Payer ID sync: each answer of section 6; the fake agrees | `sync-payer-ids.test.ts`; phone `payer_id_sync_test.dart`; `fake_parity_test.dart` |
| A payer ID is never in the team index | `patients-index.test.ts` gains a case; phone `team_index_test.dart` |
| Medicaid ID entered and retracted offline | Phone widget test with the network off; `tools/live-sync.sh` gains one scenario |

## 11. Defaults chosen (PLAN-OPEN), and questions for people
### 11.1 Defaults
| # | Question | Default | Why | Who decides |
|---|---|---|---|---|
| 1 | The billing file's format | `generic-v1` (5.4), CSV, one row per note | A biller can open it; the real format is a profile file | The partner FQHC, through the project lead |
| 2 | Small-cell threshold and which cells | Hide 1 to 10 in cells that count people or visits; not supply quantities; hide a second cell against subtraction | The common public-reporting rule; strict is the safe side | Counsel |
| 3 | May Billing/Data export sensitive diagnosis codes? | No: withheld and counted; a Program Admin's run includes them | PRD main 121 says Billing and Data does not see them; 42 CFR Part 2 is with counsel | Counsel, then Brooke and Mercy |
| 4 | Does the biller get the note's text? | No: note ID, type, signature time and content hash only | "Signed note" (PRD main 657) can be read either way; text would carry sensitive sections | The partner FQHC; counsel |
| 5 | A ready note with a missing NPI, diagnosis or procedure | Exported, and counted as a problem on the run page | The file is for a human biller (PRD main 647); holding it back hides work | Brooke and Mercy |
| 6 | Where the visit level (E/M) code comes from | The code map only; nobody picks a level on the phone | PRD main 655 names order sets and templates only | Brooke and Mercy; the partner FQHC |
| 7 | Place of service for every encounter | The team setting, `27` | PRD main 654, 672 | The partner FQHC (shelter and clinic visits) |
| 8 | Is the audit log, sync history and field history part of "all their data"? | Yes; secrets and link tokens are not | The anti-lock-in promise (PRD main 678) | Counsel |
| 9 | Photo and document bytes in the data export | Metadata only in this phase | A bulk file archive needs storage and a job (risk 2) | The project lead |
| 10 | How long export files stay downloadable | 24 hours, to the person who ran it | A file at rest is a second copy of patient data | Counsel |
| 11 | The team's time zone | `teams.settings.timeZone`, else `America/Detroit` | The pilot is in Detroit (PRD main 660) | The team |
| 12 | "Service area" | Encounters by route name | Counts only; ZIP codes need geocoding under a BAA (PRD main 352) | Brooke and Mercy |
| 13 | Medicaid ID format | 4 to 20 letters and digits, no state rule | Michigan's rule is not confirmed; a strict rule would refuse real cards | The partner FQHC |
| 14 | PAs | Held until attested, as today (`permissions.ts:136-137`) | Plan section 6 | The partner FQHC |
| 15 | Watermark | Run number, person and time in every file name, manifest and (by profile) the first columns | PRD main 602 asks for user and time | The project lead |

### 11.2 Questions that need a person and have no default
1. Which FQHC is the partner, and what file does its biller import (PRD main 664, 676, 920)? Blocks the real Done when, not the build.
2. Do MDHHS and each Detroit health plan accept place of service 27, and at what rate (PRD main 672, 676)?
3. Is NP attestation a payer rule or the partner's policy (PRD main 216)?
4. May Sineobex store and export CPT codes without an AMA licence, and may a team type descriptions? Counsel.
5. Is an export to a team's own biller a disclosure that needs an accounting entry beyond the audit log, and how long are run records kept (PRD main 642)? Counsel.
6. The replacement for the referral-completion pilot metric (Build plan 157). The grant report has a free row for it.
7. Do the information blocking rules require file bytes in the export now (PRD main 867)? Counsel.

## 12. Risks, and where the design departs from the PRD or reads it a particular way
1. **A run is built inside one request.** A month of billing is small. A full data export for a large team may pass a request's time limit on the preview's Edge runtime (plan risk 2). The pipeline takes a builder function, so phase 12 can move the build to a job without changing the tables. Until then a too-large run is refused with a clear message, which bends "at any time" (PRD main 678) for very large teams.
2. **"All their data" without file bytes** departs from PRD main 678. It is listed on the page and in the manifest (11.1 #9).
3. **Export files sit in the database for 24 hours.** They are in the same encrypted store as the records they copy, are read only by their requester, and are purged by the next run. A team that never runs another export keeps expired parts until a download is refused; phase 12 adds a scheduled purge.
4. **Withholding sensitive codes from Billing/Data** follows PRD main 121 but makes that role's billing file incomplete for some visits. The count is shown so nothing is silently missing.
5. **Codes derived at export time** read "one tap produces the billing codes" (PRD main 437) as a mapping, not a stored code on the order. A changed code map changes the codes of notes not yet exported; the run stores the map version, and exported rows are never rewritten.
6. **CPT is licensed.** Only codes are stored, never descriptions (11.2 #4).
7. **Repeatable** means: the same items, profile version and note content give the same bytes, pinned by the golden file. After a correction the old bytes cannot be rebuilt; the stored SHA-256 and the flag say so.
8. **The grant report can show "<11" for most cells of a small team.** Funders may want exact numbers. Changing the threshold is one constant, and counsel's call.
9. **The repeatable-read helper is new in `services/api/src/db/database.ts`** (level X). If a pooled connection cannot set the level, the fallback is to hold the team's audit-chain lock for the build, which blocks that team's syncs for the run's length; that is the reason to prefer the snapshot.
10. **Phases 4 to 9 are designs.** Every name in section 2's second table may change; the loaders are the only code that reads them.

## 13. Units and a first card list
Units own disjoint files. A lands first, alone, with CI green. Then B, F and G in parallel; then C and D; then E; H last. Level X units: G1 to G3 and G8 entirely; A1, A2, A4 and B1 inside their units.

**A. Schema, vectors and core rules** (`db/migrations/`, `packages/contract/`, `services/api/src/exports/` pure files)
- A1. Migration: `patient_payer_ids`, `patient_of_change`, `CHART_TABLES`. X. `<next>_patient_payer_ids.sql`, `patients/charts.ts`. Needs phase 4's 0020.
- A2. Migration: the five export tables. X. `<next>_export_runs.sql`, `patients/charts.ts`. Needs A1.
- A3. Migration: the `billing_code_map` kind. T. `<next>_billing_code_map_kind.sql`. Needs phase 5.
- A4. `snapshotRead`: a repeatable-read transaction with the team scope set. X. `db/database.ts`.
- A5. `billable` and its vectors. T. `exports/eligibility.ts`.
- A6. `deriveProcedures`, `validateCodeMap`. T. `exports/codes.ts`.
- A7. `csvCell`, `csvRow`. T. `exports/csv.ts`.
- A8. Profile schema, `parseProfile`, the two profile files. S. `exports/profile.ts`, two data files.
- A9. `renderBilling`. T. `exports/render.ts`. Needs A7, A8.
- A10. `suppressCells`. T. `exports/suppress.ts`.
- A11. `serviceDate`, `periodBounds`. T. `exports/period.ts`.
- A12. `selectForRun`. T. `exports/selection.ts`.
- A13. `fileName`, `splitParts`, `buildManifest`. S. `exports/files.ts`.
- A14. `normalizePayerId` (TypeScript). T. `patients/payer-id.ts`.
- A15. `EXPORT_TABLES` and its schema test. T. `exports/tables.ts`. Needs A2.
- A16. Request and answer schemas; regenerate the contract. S. `routes/schemas.ts`, `routes/exports-schemas.ts`.

**B. Pipeline and billing routes** (`services/api/src/exports/pipeline.ts`, `billing-load.ts`, `routes/exports-*.ts`)
- B1. `runExport`: the three transactions, the running check, the purge, the audit events. X. `exports/pipeline.ts`. Needs A2, A4, A13.
- B2. Loader: encounters, notes, signers, attesting. T. `exports/billing-load.ts`. Needs A5, A11.
- B3. Loader: patient through the projection, Medicaid ID, diagnoses with withholding. T. `exports/billing-load-patient.ts`. Needs B2.
- B4. Loader: supplies and procedures. T. `exports/billing-load-orders.ts`. Needs A6, B2.
- B5. Preview route. T. `routes/exports-billing.ts`. Needs B2, A12.
- B6. Run route for billing, with items. T. `routes/exports-billing.ts`, `exports/billing-build.ts`. Needs B1, B3, B4, A9.
- B7. Run list, run detail, part download. T. `routes/exports-runs.ts`. Needs B1.
- B8. Flag search and review. T. `routes/exports-flags.ts`. Needs B6.
- B9. The audit-details walker test and the permissions matrix test. T. tests only. Needs B7.

**C. Grant report** (`exports/grant-*.ts`, `routes/exports-grant.ts`)
- C1. Counts: patients, encounters. T. `exports/grant-load.ts`. Needs A11.
- C2. Counts: check-ins, referrals. S. `exports/grant-load-events.ts`. Needs phase 9.
- C3. Counts: supplies, service area. S. `exports/grant-load-supplies.ts`. Needs phases 6, 7.
- C4. Report builder (JSON and CSV parts) and route. T. `exports/grant-build.ts`, `routes/exports-grant.ts`. Needs B1, A10, C1.

**D. Data export** (`exports/data-*.ts`, `routes/exports-data.ts`)
- D1. `dumpTable` with keyset pages and omitted columns. T. `exports/data-load.ts`. Needs A15.
- D2. JSON and CSV part writers. S. `exports/data-write.ts`. Needs A7, A13.
- D3. Route, with the full-view check. T. `routes/exports-data.ts`. Needs B1, D1, D2.

**E. Portal** (`apps/portal/src/app/(app)/exports/**`, `billing-codes/**`, `actions/exports.ts`)
- E1. Nav entry and `/exports`. R. Needs B7.
- E2. `/exports/billing` with preview and run. R. Needs B5, B6.
- E3. `/exports/runs/[runId]` and the download route handler. R. Needs B7.
- E4. `/exports/billing/flags`. R. Needs B8.
- E5. `/exports/grant`. R. Needs C4.
- E6. `/exports/data`. R. Needs D3.
- E7. `/billing-codes`. R. Needs F1.
- E8. The "Exports" filter on `/audit`. S. `(app)/audit/page.tsx`.
- E9. End-to-end and axe tests for the pages above. S. `apps/portal/e2e/exports.spec.ts`.

**F. Code map preset** (phase 5's files; one owner at a time)
- F1. `validatePreset` branch for `billing_code_map`. T. Phase 5's validator file. Needs A3, A6.
- F2. Leave the kind out of the phone's preset download. T. Phase 5's read route.

**G. Medicaid ID on the phone** (sync; mostly level X)
- G1. Server sync rules for `patient_payer_id`. X. `services/api/src/sync/**`. Needs A1, A14.
- G2. The fake server's mirror and parity cases. X. `apps/mobile/test/sync/fake_server.dart`. Needs G1.
- G3. The phone store learns the entity. X. `apps/mobile/lib/sync/**`. Needs G1.
- G4. `normalizePayerId` in Dart. T. `apps/mobile/lib/patients/payer_id.dart`. Needs A14.
- G5. Payer IDs in the chart read; none in the team index. T. `patients/projection.ts`, `patients/charts.ts`. Needs A1.
- G6. Phone: the field in patient edit. R. One screen file. Needs G3, G4.
- G7. Phone: the rows in the chart, with Entered in error. R. One screen file. Needs G3.
- G8. A live-sync scenario. X. `tools/live-sync.sh`. Needs G1, G3.
- G9. Portal chart shows the Medicaid ID. R. `(app)/patients/[patientId]`. Needs G5.

**H. Done when and close**
- H1. The November fixture. T. `services/api/test/export-fixtures.ts`. Needs B6, G1.
- H2. Steps 1 to 8 of 10.1, with the golden file. T. tests only. Needs H1, B8.
- H3. Steps 9 and 10. T. tests only. Needs C4, D3.
- H4. Compliance docs: disclosure, minimum necessary, the export controls. S. `docs/compliance/`.

Cards by level: S 9, T 29, R 10, X 8. Total 56.
