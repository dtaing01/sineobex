> Draft plan (Nov 14), checked against the reviewed phase 4 design and the designs of the phases before it. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 10: billing export, data export, grant reports

"PRD main N" is a line of the product spec's main tab; "Build plan N" a line of its Build plan tab. Paths are from the repository root. "Next free number" means the lowest unused migration number when the unit starts.

## 1. Scope and Done when
**Done when** (Build plan 121; `IMPLEMENTATION_PLAN.md` section 4, phase 10 row): a month of made-up encounters exports to the agreed format. The format is not agreed yet (PRD main 676), so the test runs against the built-in profile `generic-v1` and a second test profile, to prove a new format is a data change (10.1).

| In | PRD |
|---|---|
| Billing export: patient identifiers and Medicaid ID when known; date of service; place of service 27; ICD-10 and CPT "from order sets and templates"; rendering provider and NPI; attesting physician and NPI; signed note reference and signature time; supplies used | main 651-658, 672 |
| Resident and NP (and, by default, PA) notes enter the billing export only after an attending attests; drafts, unsigned notes and Non-Medical notes stay out | main 99, 211-216, 379, 454, 649 |
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
| `encounters` has `kind` (`medical`, `non_medical`), `status`, `patient_id` (nullable), `started_at`, `clock_verified`, `location`. `encounter_notes` has `note_type_key`, `status`, `author_user_id`, `data`; it has no `medical` column yet. | `db/migrations/0004_sync.sql:33-71` |
| `patients` has legal and preferred names, birth fields, `usual_area`, `canonical_id`. It has no Medicaid ID. | `db/migrations/0009_patients.sql:34-60` |
| `problems` has `code_system` (`icd10cm`), `code`, `sensitive`, `status_encounter_id`; every status observation is a `field_history` row. | `db/migrations/0010_problems.sql:8-20`; D36 |
| Every table with a `patient_id` must be listed in `CHART_TABLES`, or a schema test fails. | `services/api/src/patients/charts.ts:24-37` |
| `teams.settings` is a JSON object for plain team values. No time zone is stored. | `db/migrations/0002_identity_access.sql:15-16` |
| `forbid_mutation()` makes a table append-only; the team policy block is the loop in `0004_sync.sql`. | `db/migrations/0001_base.sql:103-109`; `db/migrations/0004_sync.sql:185-195` |
| The portal has `/audit`, `/patients`, `/team/*` and a `/reauth` page; server actions live in `apps/portal/src/app/actions/`. | `apps/portal/src/app/` |
| The last migration is `0016_merge_review_undo.sql`. Only `packages/contract` exists under `packages/`. | `db/migrations/`; `packages/` |

What earlier phases must have delivered (each is a design today, not code; phase 4's is reviewed, and 5 and 6 are checked against it; check before cutting cards). "lifecycle" and "forms" with a section number are the two parts of the phase 4 design (`docs/design/phase-4/`).

| Phase | Thing this phase reads | Design |
|---|---|---|
| 4 | `encounter_notes` gains `medical` (set from the note type, never changed), `signoff_id` (set exactly when `status = 'signed'`), `attestation` (`not_needed`, `waiting`, `attested`) and `first_signed_at`. A Non-Medical note (Social needs, Outreach) is never signed, co-signed or attested, in any visit, and carries no billing codes. A visit's `kind` only goes from Non-Medical to Medical and decides nothing about a note | lifecycle 2.2, 3.1; D56 |
| 4 | `note_signoffs`, append-only (`act`, `effect`, `signer_name`, `signer_credential`, `signer_npi` (null when the credential has none), `signed_at`, `received_at`, `clock_verified`, `content_hash`, `needs_attestation`): the credential is the one held at the time (D58) | lifecycle 2.3, 3.5 |
| 4 | `note_attestations`, append-only (`note_id`, `signoff_id`, `attending_name`, `attending_npi` not null, `attested_at`, `content_hash`); a note attested again after a correction gets a second row | lifecycle 2.4 |
| 4 | `note_corrections` (`changes`: one to ten answers; `outcome`: `corrected`, `declined`, `no_change`, `draft_edit`, `not_author`; `corrector_credential`; `corrected_at` device time; `created_at` server receipt). Phase 4 stores no billing flag: the correction row and its time are what this phase reads. A resident's, NP's or PA's correction sets `attestation` to `waiting` again; a student's sets the note back to `completed` | lifecycle 2.3, 2.6, 3.6 |
| 4 | `noteContentHash` over the answers that count (`effectiveAnswers`), the patient and the summary; a finished note holds only those answers | lifecycle 4.5; D57 |
| 4 | The rule "a note is exported when `status = 'signed'` and `attestation` is `not_needed` or `attested`" | lifecycle 3.5 |
| 4 | `visibleAnswers(definition, answers, reader)`: a Medical note needs `patients.view` with `encounters.chart` or `billing.view_codes`; sensitive note types need `patients.view_sensitive`; treatment sections also a clinical credential; sensitive exams `patients.view_sensitive_exams`. What a reader may not see is absent | lifecycle 6.4; D66 |
| 4 | A diagnosis is a `problem` answer of a note (`code`, `label`), one repeating entry each; "Add to the problem list" is a separate, optional act. The Red flags note is its own Medical note type, `red_flags_disposition`, once per Medical visit | forms 2.3, 6.2; lifecycle 8.3 |
| 4 | `referrals` (`referred_on`, `status`); `lockTeamWrites` first in every online route that writes; the chart answer's `timeline` and `recentVisits`, kept in `_chart` | lifecycle 2.5, 5, 5.2 |
| 5 | `team_presets` and `team_preset_versions` (eight kinds), body schemas and `validatePreset` in `packages/presets/src/`, the admin routes `/v1/admin/presets/{kind}`, the phone's pull `GET /v1/presets`, the portal pages under `/team/presets`, `note_types.title` | `docs/design/phase-5-admin-configuration.md` 4.1 to 4.4, 5.3, 7, 8.1 |
| 6 | `encounter_orders` (`encounter_id`, `item_id`, `item_version`, `quantity`, `source`, `bundle_id`, `voided_at`); `stock_movements` (signed `quantity`, `reason` `dispense`, `void`); `device_push_tokens` | `docs/design/phase-6-orders-inventory-alerts.md` 4.2, 4.3, 4.5 |
| 7 | `routes` (`name`, `service_date`) and the way an encounter is attributed to a route (for "service area") | `docs/design/phase-7-routes-runs.md` section 4 (the attribution column not verified) |
| 9 | `check_ins` with a `kind` (`medical`, `non_medical`), a time and a patient (PRD main 308) | `docs/design/phase-9-qr-checkins-queue.md` 4.1 (column names not verified) |

If a phase 7 or 9 table is missing when this phase starts, its grant metric is left out of the report and named in the report's notes; nothing else waits on it.

## 3. The design in one page
1. **Every export is a run.** One pipeline serves billing, grant and data: start, build, finish. The run row stores who, the parameters, the profile and code map versions, the cut, the counts and each file's SHA-256. One pattern repeats three times.
2. **Three transactions, in this order.** A: take the team write lock, record the run and its audit event. B: read everything in one repeatable-read snapshot and store the files as parts. C: take the lock again, record the result, the patients disclosed and the audit event. No byte leaves before C commits, so a disclosure that can't be logged doesn't happen (CLAUDE.md, "Rules that never bend").
3. **Why B is its own transaction.** The audit chain reads its previous hash under the team write lock; inside a repeatable-read snapshot it would read a stale head and break the chain (D7). So B writes no audit event and holds no lock, and A and C stay ordinary transactions that take the lock first, as every online writer does.
4. **Billing is a mapping over a stable internal model.** A loader builds `BillingEncounter` objects. A profile (a JSON file) names columns by path. The agreed format is a new profile file, not new code.
5. **Codes are worked out at export time, not stored on phones.** ICD-10 comes from the signed note's own diagnosis answers, then from the problems observed in the encounter. CPT and HCPCS come from a team code map keyed by bundle, item or note type (PRD main 437, 655). Nothing new syncs for codes, and a wrong map is fixed without touching a signed note.
6. **The note is the unit, as in phase 4 (D55, D56).** Only a Medical note that is signed, and attested where that is needed, is a row; a Non-Medical note never is, in any visit. A note is exported once per content: the key is (note, content hash). A corrected and re-attested note has a new hash, so it re-enters the next "new" run as a replacement, and the old line is flagged for review (PRD main 462).
7. **"New since the last export" is the default mode, not a calendar month.** A resident's note attested in December for a November visit must still reach the biller (PRD main 216).
8. **An export shows the runner only what the chart would**, through phase 4's one function, `visibleAnswers` (D66). Billing/Data does not see sensitive details (PRD main 121; D38), so a sensitive diagnosis code or a note of a sensitive type is absent and counted, never blanked. The full data export needs a runner who may read everything.
9. **Grant reports are counts, with small cells suppressed.** A cell that counts people or visits and is between 1 and 10 is shown as "<11", and a second cell is hidden when one could be worked out by subtraction.
10. **The only thing a phone makes in this phase is a Medicaid ID.** It is an append-only record like an allergy: created, or marked entered in error, never overwritten. Two phones offline cannot conflict. Its one refusal is one the worker can fix (D59).
11. **No new permission keys** (D37).

## 4. Data model
Rules for every migration: plain SQL, additive, one transaction, the next free number (phases 4 to 6 take 0017 to 0028), named by what it adds. Every new table gets the team policy block of `db/migrations/0004_sync.sql:185-195` and composite foreign keys on `(team_id, …)` as `0009_patients.sql` does. No migration touches `known_permissions()`, a role row or the audit tables.

### 4.1 `<next>_patient_payer_ids.sql` (level X: policy, trigger, `patient_of_change`)
`patient_payer_ids`: a synced record shaped like `patient_allergies` (`db/migrations/0009_patients.sql:191-218`).

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid primary key | Made on the phone |
| `team_id`, `patient_id` | uuid not null | FK `patients (team_id, id)`; `unique (team_id, id)` |
| `kind` | text not null | `medicaid` only (check). Other payers are a later value |
| `value` | text not null | Normalized by `normalizePayerId` (5.3): `^[A-Z0-9]{4,20}$` |
| `status` | text not null default `active` | `active` or `entered_in_error`; set once, through the field `enteredInError` (section 6) |
| `error_reason`, `error_by`, `error_at` | | As on `patient_allergies` |
| `recorded_at`, `clock_verified`, `author_user_id`, `created_device_id` | | As on `patient_allergies` |
| `field_versions`, `field_meta`, `version`, `created_at`, `updated_at` | | The bookkeeping every synced record carries |

Index `(team_id, patient_id, recorded_at desc)`; the touch trigger; no `delete` for the app role. `patient_of_change` is replaced with the body of its newest version (phase 4's 0020, phase 5's 0023 and phase 6's orders migration each replace it) plus a `patient_payer_id` branch (the value's `patientId`). The same card adds `patient_payer_ids: 'group'` to `CHART_TABLES`.

### 4.2 `<next>_export_runs.sql` (level X: policies, append-only triggers)
| Table | Append-only | Columns |
|---|---|---|
| `export_runs` | Yes | `id` uuid pk default random; `team_id`; `run_no` integer, `unique (team_id, run_no)`, the team's highest plus 1, taken under the team write lock (5.1); `kind` (`billing`, `grant`, `data`); `params` jsonb (5.1; dates, mode, format only); `requested_by` uuid FK users; `requested_role` text; `profile_key`, `profile_version` integer, `profile_sha256` (billing only); `code_map_version` integer (billing only); `rerun_of` uuid; `started_at` timestamptz default now(); `expires_at` timestamptz (started plus 24 hours) |
| `export_run_results` | Yes | `run_id` uuid pk, FK `export_runs (team_id, id)`; `team_id`; `outcome` (`completed`, `failed`, `too_large`); `failure_code` text (a code, never a message); `snapshot_at` timestamptz; `audit_seq_at_cut` bigint (the team's newest audit `seq` seen by the snapshot); `counts` jsonb (numbers only; 9); `files` jsonb: `[{part, name, bytes, rows, sha256}]`; `finished_at` |
| `export_parts` | No: insert and delete only | `team_id`, `run_id`, `part` integer, primary key `(run_id, part)`; `name` text; `content` bytea, `octet_length <= 4194304`; `sha256` text, 64 hex; `rows` integer. No `update` grant |
| `billing_export_items` | Yes | `id` uuid pk; `team_id`, `run_id`; `encounter_id`, `note_id`, `signoff_id`; `attestation_id` (null when none was needed); `content_hash`; `patient_id` (canonical at the time); `date_of_service` date; `replaces_run_no` integer; `unique (run_id, note_id)`; index `(team_id, note_id)` |
| `billing_item_reviews` | Yes | `id` uuid pk; `team_id`; `item_id` FK; `correction_id` FK `note_corrections`; `decision` (`will_resend`, `no_action`); `reviewed_by`, `reviewed_at`; `unique (item_id, correction_id)` |

A run's state is not stored. It is worked out: no result row and started under 10 minutes ago is `running`; no result row and older is `did_not_finish`; otherwise the result's `outcome`; `completed` and past `expires_at` is `expired`. `billing_export_items.patient_id` goes into `CHART_TABLES` as `not_chart` with a comment (it is disclosure history, read through the audit log).

### 4.3 `<next>_billing_code_map_kind.sql` (level T: a check constraint and an index; no policy, no trigger)
Phase 5 owns `team_presets` and its versions, routes, revision and archive rules (phase 5 design 4.1, 4.2, 7); this adds a ninth kind and nothing else. It widens the `team_presets.kind` check with `billing_code_map`, and adds `unique (team_id) where kind = 'billing_code_map'` as `settings` has. The body's zod schema joins phase 5's in `packages/presets/src/` (4.4 there). A rule may name an archived bundle or item: old orders still carry it. Body, at most 32 KiB:
`{name: "Billing codes", rules: [{source: {kind: "bundle"|"item"|"note_type", ref: <phase 5 preset id or note type key>}, codes: [{system: "cpt"|"hcpcs", code, units: "one"|"quantity", modifiers: [0 to 4 of two characters]}] (1 to 10)}] (0 to 500)}`. No rule source twice. Code formats: CPT `^[0-9]{4}[0-9A-Z]$`, HCPCS `^[A-V][0-9]{4}$`. No description text is stored for a CPT code (12, risk 6).

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
| Start (transaction A) | Billing: `exports.billing` + `patients.view` + `billing.view_codes`. Grant: `exports.grant`. Data: `exports.data` and the full view: `patients.view`, `encounters.chart` or `billing.view_codes`, `patients.view_sensitive`, `patients.view_sensitive_exams`, and a credential that charts Medical (11.1 #17). All: MFA and `recentAuth` | Calls `lockTeamWrites` first (the team's write lock, which is also the audit chain's lock); refuses if the team has a `running` run; deletes expired parts; inserts `export_runs`; audit `export.started` | 403 `forbidden`, `mfa_required`, `reauth_required`, `export_needs_full_view`; 409 `export_running`; 422 `invalid` |
| Build (transaction B, repeatable read) | The server | Takes no lock (11.1 #19). Sets the team scope; loads; renders; splits into parts of at most 4 MiB; inserts `export_parts`, its only write. More than 5,000 notes (billing) or 500,000 rows (data): `too_large` | none to the caller yet |
| Finish (transaction C) | The server | Calls `lockTeamWrites` first. Inserts `export_run_results`; for billing, `billing_export_items`; audit `export.completed` and `export.patients_disclosed` (9). On a failed build: result `failed` or `too_large`, audit `export.failed`, and parts deleted | 500 `export_failed`; 422 `too_large` |
| Download | The person who started the run, holding the same permissions, MFA and `recentAuth` | One part per request; audit `export.part_downloaded` in the same transaction as the read | 404; 403; 410 `expired`; 409 `not_ready` |
| Review a flag | `exports.billing` | Calls `lockTeamWrites` first. Inserts `billing_item_reviews`; audit `export.flag_reviewed` | 404; 409 `already_reviewed` |

Billing `params`: `{mode: "new"|"period"|"rerun", from?: date, through?: date, runNo?: integer}`. Grant: `{from, to}`, at most 366 days. Data: `{format: "csv"|"json"}`. Dates are team-local dates (5.3 `periodBounds`).

### 5.2 Which notes are billable
Medical is a property of the note (D56), so the rule reads the note, never the visit's kind. `billable` decides, first match wins. Input: `{noteMedical, noteTypeKey, hasPatient, noteStatus, attestation, readable}`, where the first five are `encounter_notes.medical`, `.note_type_key`, the encounter's patient, `.status` and `.attestation`, and `readable` is false when `visibleAnswers` hides the whole note from the runner. Output: `{include, reason}`.

| # | When | `reason` | In the file | PRD |
|---|---|---|---|---|
| 1 | `noteMedical` is false (Social needs, Outreach, in any visit) | `non_medical` | No: never signed, no billing codes | main 379; lifecycle 3.1 |
| 2 | `noteTypeKey` is `red_flags_disposition` | `visit_support` | No (11.1 #16) | forms 6.2 |
| 3 | no patient | `no_patient` | No | main 653 |
| 4 | `noteStatus` is `draft` | `draft` | No | main 99 |
| 5 | `noteStatus` is `completed` | `unsigned` | No (waiting for a co-signer) | main 213 |
| 6 | `attestation` is `waiting` | `awaiting_attestation` | No | main 216, 454 |
| 7 | `readable` is false | `hidden_from_runner` | No, and no item row, so a later runner who may read it exports it (11.1 #3) | main 121; lifecycle 6.4 |
| 8 | otherwise (`signed`, and `not_needed` or `attested`: lifecycle 3.5) | `ready` | Yes | |

A `ready` note with something missing is still exported, and the run counts the problem (IDs only): `missing_npi` (`signer_npi` is null), `no_diagnosis`, `no_procedure`, `time_not_verified`, `payer_id_conflict` (two active Medicaid IDs that differ). PLAN-OPEN 11.1 #5. The rendering provider is the signer of the sign-off that `encounter_notes.signoff_id` names; for a student's note that is the co-signer (PRD main 656). The attesting physician comes from the newest attestation of the note. A correction can take a note out of `ready` again (a resident's makes it `waiting`; a student's makes it `completed`: lifecycle 3.6), and it comes back when it is attested or co-signed again.

### 5.3 The pure functions
All TypeScript, in `services/api/src/exports/` unless a row says otherwise (the folder is not a level X path). Only `normalizePayerId` has a Dart twin (`apps/mobile/lib/patients/payer_id.dart`), because a phone runs no export (PRD main 602). Each vector file is under `packages/contract/test-vectors/` and is read by `services/api/test/contract-vectors.test.ts`.

| Function (file) | Input | Output | Vectors |
|---|---|---|---|
| `billable` (`eligibility.ts`) | 5.2 | `{include, reason}` | `billing-eligibility.json` |
| `deriveProcedures` (`codes.ts`) | code map body; the encounter's orders not voided `[{itemId, bundleId, quantity}]`; `noteTypeKey` | `[{system, code, units, modifiers, source}]`: note type rules first, then bundle (once per bundle), then item (`units: "quantity"` sums quantities); the same code and modifiers twice is merged, units added; sorted by system, code | `billing-codes.json` |
| `validateCodeMap` (`packages/presets/src/billing-codes.ts`, beside phase 5's schemas, so `validatePreset` can call it) | body | `[]` or `[{path, code}]`: `bad_code`, `duplicate_source`, `too_many` | `billing-codes.json` |
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
| `diagnoses[n].code`, `.display`; `diagnosesWithheld`; `diagnosesUncoded` | First the note's own `problem` answers (forms 2.3: `code` and `label`), in entry order, as `visibleAnswers` gives them to the viewer (lifecycle 6.4). Then `problems` with a status observation naming this encounter whose code is not already listed, oldest first; a `sensitive` one needs `patients.view_sensitive`. What the viewer may not see is absent and counted |
| `supplies[n].itemName`, `.quantity`, `.unit` | Phase 6's `encounter_orders` not voided, joined to the item preset at the order's `item_version` (phase 5 design 6.4) |
| `note.id`, `.typeKey`, `.contentHash`, `.signedAt`, `.receivedAt`, `.clockVerified`, `.replacesRunNo`, `.firstRunNo` | `encounter_notes`, and the `note_signoffs` row its `signoff_id` names. The date used is `signed_at` (plan section 6, first row). The hash is `noteContentHash` over what the server holds now (lifecycle 4.5); it is left empty in the file when anything of the note was withheld (lifecycle 6.4 rule 4) |
| `rendering.name`, `.credential`, `.npi`; `attesting.name`, `.npi`, `.attestedAt` | `note_signoffs` (`signer_*`), and the newest `note_attestations` row of the note: the values stored at the time, never today's profile (D58) |
| `procedures[n].system`, `.code`, `.units`, `.modifiers` | `deriveProcedures`. Orders belong to the encounter, not to a note. They go on one row per encounter: its first note in this run, and only when no earlier run holds a note of that encounter, so a visit whose notes are exported in two runs is not billed twice |
| `run.no`, `.id`, `.exportedBy`, `.exportedAt` | the run |

A profile is `{key, version, format: "csv", rowPer: "note"|"procedure", delimiter, lineEnd: "crlf"|"lf", header: true|false, columns: [{header, from?: <path>, const?: <text>, transform?: "date_ymd"|"date_mdy"|"datetime_iso"|"upper"|"digits", join?: <text>, max?: <integer>}]}`. A list path without an index needs `join`. With `rowPer: "procedure"`, `procedure.code` and `procedure.units` name the row's own procedure. An unknown path or transform fails `parseProfile` when the API starts and in a test, never during a run. `generic-v1` is one row per note with these columns: run number, exported by, exported at, patient ID, legal family name, legal given name, date of birth, Medicaid ID, date of service, place of service, diagnosis codes (joined by `;`), procedure codes (code, `*`, units, joined by `;`), rendering name, rendering credential, rendering NPI, attesting name, attesting NPI, attested at, note ID, note type, signed at, time verified, supplies (name, `x`, quantity, joined by `;`), replaces run. The note's text is not in it (11.1 #4).

### 5.5 The other two builders
**Data export.** `EXPORT_TABLES` (`tables.ts`) lists every table in the `sineobex` schema that has a `team_id`, as `{table, orderBy, omit: [columns]}` or `{table, excluded: "<reason>"}`. A schema test fails until a new table is listed (the `CHART_TABLES` pattern). Excluded, with the reason: `export_parts` (its own output), phase 6's `device_push_tokens` and device keys (secrets), ID link tokens and their hashes (a token opens a chart). `sync_changes`, `field_history` and `audit_events` are included (11.1 #8). Rows are dumped whole, which is why the runner must be someone `visibleAnswers` hides nothing from (5.1). `dumpTable` reads by keyset pages of 1,000 rows. JSON parts are `{"export": {runNo, exportedBy, exportedAt, table, part}, "rows": [...]}`. CSV parts have a header row, JSON columns as JSON text, and a last column `export_run`. Every run ends with `manifest.json`: run facts, the cut, each file's name, rows and SHA-256, the tables excluded and why, and "Photos and documents: metadata only".

**Grant report.** `loadGrantCounts(tx, team, bounds)` (`grant-load.ts`) returns the cells below; `suppressCells` runs on each breakdown; the parts are `report.json` (for the screen) and `report.csv` (`section,key,value`).

| Section | Cell | Counted from | Suppressed |
|---|---|---|---|
| Unique patients | one cell | distinct `canonical_id` with a finished encounter or a check-in in the period | Yes |
| Encounters by type | Medical, Non-Medical (the encounter's `kind`); then finished notes by note type title (phase 5's `note_types.title`) | encounters whose `status` is not `draft`; their notes that are not drafts | Yes |
| Check-ins | Medical, Non-Medical | phase 9's `check_ins` that are not voided, by `occurred_at` | Yes |
| Referrals made | one cell | `referrals`, `status = 'active'`, `referred_on` in the period | Yes |
| Supplies used | per item name | `stock_movements`: minus the sum of `dispense` and `void` quantities | No (they count items, not people) |
| Service area | per route name, and "Not on a route" | encounters, by the route they were made on (phase 7) | Yes |

Breakdowns show their total. An encounter counts in the period of its `started_at`, in the team's time zone.

## 6. Sync
One new synced record type. Everything else in this phase is online only. It follows lifecycle 4.1 and 4.2 as phases 5 and 6 do: no new reject reason (a refused rule is `validation` with a `details.problem`); `takesTeamLock` is true (D32); a refusal is kept for what the worker can fix (D59), and there is one; a throw inside the rule is caught and stored as a rejection, so no fault here stops a queue.

| Entity `patient_payer_id` | Rule |
|---|---|
| `create` value (strict) | `patientId`, `kind`, `value`, `recordedAt` |
| One settable field | `enteredInError`, class `set_once`, with the value `{reason}` (3 to 200 characters) the allergy uses (`services/api/src/sync/entities/allergy.ts`) |
| Permission | `patients.edit` plus `patients.view`, for the create and for `enteredInError` |
| Sync read | `patients.view`: the default rule of `/v1/sync/records` for an entity with no rule of its own |
| Clock pause | Not covered, as allergies are not (D35) |

| Case | The server answers |
|---|---|
| Valid create | `accepted`; audit `payer_id.added` (patient, record ID; never the value) |
| `normalizePayerId` fails, or the value sent is not already normalized (a build fault: the phone checks with the Dart twin before it saves) | Refused `validation`, problem `invalid_payer_id` with the code. The fix: **Enter the ID again**; the store call `resendPayerId` sends the same record with the value entered. The check runs before the insert, so the column's check never throws. The queue goes on (D42) |
| The patient is unknown to the server yet | Held as a dependent of the patient create (the existing parent rule) |
| The patient was merged | Stored as sent; reads group by `canonical_id` (D27) |
| The sender lacks a key (a role lowered while offline; the phone never offers the field) | Held for a Program Admin, as every permission failure on a push is (`services/api/src/sync/apply.ts:403-423`). Never refused: the worker has nothing to fix |
| The same value twice for one patient, from two phones | Both `accepted`. The chart shows the value once; the export reads the newest active one |
| Two different active values | Both `accepted`. The chart shows both. A billing run counts `payer_id_conflict` |
| `enteredInError` set | `accepted`; audit `payer_id.retracted`. A second set: the `set_once` answer, as an allergy's |
| The value fails the wire schema | The wire schema's answer, naming the change (D51). The screens cannot send one |
| Removed user's phone | Quarantine, as every change; `patient_of_change` names the patient (4.1) |

`apps/mobile/test/sync/fake_server.dart` must mirror every row: the strict create shape, the `normalizePayerId` check (through the Dart twin) with the same problem name, the held permission failure, set-once on `enteredInError`, and both audit events. `fake_parity_test.dart` pins each answer to the API's (D52).

**What a phone holds.** A patient's payer IDs arrive with the chart, as phase 5's flag changes do: records through `/v1/sync/records`, and the chart answer's new `payerIds`, kept in the patient record's `_chart` field beside phase 4's `timeline` and `recentVisits` (`chart_cache.dart` gains the key). They are never in the team index or the search table (D40 covers legal names; an insurance number is treated the same way here). They leave the phone when the chart does (D46). A new ID leaves the outbox only after its hash-confirmed receipt. The phone holds no code map, no profile and no export record.

## 7. API routes that only work online
All under `teamScope`. "Billing" below means `exports.billing` + `patients.view` + `billing.view_codes`, which is also what reading a Medical note asks (lifecycle 6.4). Every route that writes a row calls `lockTeamWrites` as its first statement, as every online writer does (lifecycle 5): the run routes in transactions A and C, and the flag review. Every refusal here is shown to a person at a desk; none reaches a phone's queue.

| Route | Permission | Request, answer | Refusals | Audit |
|---|---|---|---|---|
| `POST /v1/exports/billing/preview` | Billing | `{mode, from?, through?}` gives `{ready, awaitingAttestation, unsigned, drafts, hiddenFromRole, alreadyExported, problems}` (counts) | 403; 422 | `export.billing_previewed` |
| `POST /v1/exports/billing` | Billing, `recentAuth` | 5.1 params give `{runId, runNo, outcome, counts, files}` | 5.1 | `export.started`, then `export.completed` or `export.failed` |
| `POST /v1/exports/grant` | `exports.grant`, `recentAuth` | `{from, to}` gives the same shape | 5.1 | same |
| `POST /v1/exports/data` | `exports.data` + the full view of 5.1, `recentAuth` | `{format}` gives the same shape | 5.1 | same |
| `GET /v1/exports/runs` | any of the three export keys | Runs of the kinds the caller may run, newest first: number, kind, state, who, when, counts | 403 | none (no patient data; counts only) |
| `GET /v1/exports/runs/{runId}` | the run's kind | The run, its result and its file list | 404 | none |
| `GET /v1/exports/runs/{runId}/parts/{part}` | 5.1 Download | The part's bytes; `Content-Disposition` with the part's name; `Cache-Control: no-store` | 5.1 | `export.part_downloaded` |
| `POST /v1/exports/billing/flags/search` | Billing | `{reviewed?: boolean}` gives `[{itemId, runNo, noteId, encounterId, patientId, correctedAt, correctionId}]` | 403 | `export.flags_listed` (count, `patientIds`) |
| `POST /v1/exports/billing/flags/{itemId}/review` | `exports.billing` | `{correctionId, decision}` gives 201 | 404; 409 | `export.flag_reviewed` |
| `/v1/admin/presets/billing_code_map…` | `team.manage_presets` (phase 5's routes, unchanged) | Phase 5 design 7; `validatePreset` calls `validateCodeMap` | Phase 5's | Phase 5's `preset.*` events |

A flag is worked out when it is read: an item whose note has a `note_corrections` row with `outcome = 'corrected'` that the server received (`created_at`) after the run's `snapshot_at`, and no review row for that pair. The server's receipt time is used, not the phone's `corrected_at`: a correction made offline before the run and synced after it was not in the file. A flag's values are never shown, only that the note changed. There is no job to fail. Phase 5's `GET /v1/presets` leaves the kind `billing_code_map` out, so no phone holds it.

## 8. Screens
**Phone** (two changes, both offline; both on phase 3's patient screens):

| Screen | Shows | States and wording |
|---|---|---|
| Patient edit, after the identity fields | "Medicaid ID (if known)", one text field | Errors: "A Medicaid ID has 4 to 20 letters and numbers." Saved offline: the usual "Saved on this phone" state |
| The patient profile, Identity section | Each active Medicaid ID, with "Entered in error" behind a reason prompt | Two different values: "Two Medicaid IDs are recorded. Mark the wrong one as entered in error." Absent for a role without `patients.view` |
| Needs attention | A refused Medicaid ID, with **Enter the ID again** (section 6) | "This Medicaid ID wasn’t saved. Check it and enter it again." |

**Portal** (online only; every page in Day, Night run and High contrast, reflowing at 320 px). A nav entry "Exports" shows for anyone holding one of the three export keys.

| Page | Shows | States and wording |
|---|---|---|
| `/exports` | One card per export the person may run; the last run of each | A card the role can't use is absent, and its URL is refused by the API and logged |
| `/exports/billing` | Mode (New since the last export; A date range; Run again), the preview counts, Run export, the run history, a link to the flagged list | Preview: "{n} notes ready. {n} waiting for an attending to attest. {n} not signed yet. {n} drafts." With withheld content: "{n} notes and {n} diagnosis codes are hidden from your role. A Program Admin can run this export with them." Nothing ready: "Nothing new to export." |
| `/exports/billing/flags` | Notes corrected after they were exported: run number, date of service, a link to phase 4's visit page, the correction's time; "Will send again" and "No action needed" | Empty: "No exported note has been corrected." |
| `/exports/grant` | From and To; Run report; the report as tables; Download CSV | A hidden cell shows "<11" with the footnote "Counts from 1 to 10 are hidden to protect patients’ privacy." A missing metric: "Check-ins are not available yet." |
| `/exports/data` | Format (CSV, JSON); Run export; the run history | "This exports everything your team has stored in Sineobex. Photos and documents are listed, but the files themselves are not included yet." Refused: "Only someone who can read every part of every note can run this export. Ask a Program Admin who is a clinician." |
| `/exports/runs/[runId]` | Who, when, parameters, counts, each file with size and SHA-256, Download per file | Before any download: "This file holds patient details. Once you download it, it is outside Sineobex. Keep it only where your organization allows." States: Running; Did not finish; Too large ("Choose a shorter date range."); Expired ("Files are kept for 24 hours. Run the export again."); only the person who ran it sees Download |
| `/team/presets/billing-codes` | The code map: one row per bundle, item and note type with its codes; Add, Edit, Remove; version history. Linked from phase 5's presets hub | Phase 5's preset page pattern, parts and stale and invalid wording (phase 5 design 8.1). "Enter the code only. Sineobex does not store code descriptions." |
| `/audit` | A quick filter "Exports" (`actionPrefix: "export."`) | PRD main 634 |

Downloads go through a portal route handler that calls the API and streams the answer; no file is put in browser storage, and the page title is "Export run {number}". Signing in again uses the existing `/reauth` page and its wording.

## 9. Audit events and the PHI rules that apply
| Event | Entity | Details (IDs and counts only) |
|---|---|---|
| `export.started` | `export_run`, id | `kind`, `runNo`, `params`, `profileKey`, `profileVersion`, `codeMapVersion` |
| `export.completed` | `export_run`, id | `runNo`, `kind`, `counts` (rows, patients, encounters, notes, codes withheld, notes withheld, problems by code), `files: [{part, bytes, rows, sha256}]`, `auditSeqAtCut` |
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
The fixture `services/api/test/export-fixtures.ts` builds a team for November 2026 through the same writes the product uses (sync pushes and routes, not raw inserts), with "Demo:" descriptors and Medicaid IDs starting `DEMO`: attending notes, resident and NP notes (some attested, some waiting), a student's note (one co-signed, one not), drafts, Non-Medical encounters, a Social needs note inside a Medical visit, the Red flags note of every Medical visit, a visit with two Medical notes and one order, a note of a sensitive type, an encounter with no patient, a sensitive problem, a bundle with a mapped code, and one note signed on Dec 1.

| # | Step | Asserted |
|---|---|---|
| 1 | Billing/Data previews "new", through Nov 30 | The counts equal the fixture's: ready, waiting, unsigned, drafts, hidden from the role |
| 2 | Billing/Data runs it without a recent sign-in | 403 `reauth_required`; no run row |
| 3 | Runs it after signing in again | `completed`; one row per ready note; no draft, unsigned, waiting, Non-Medical, Red flags, no-patient or December note; the note of a sensitive type is absent, counted, and has no item row; the visit's order is on one row only; every row has place of service 27, an NPI, a date of service in the team's zone; attested rows carry the attending's NPI; the sensitive code is absent and counted |
| 4 | The file's bytes | Equal a golden file in `services/api/test/golden/`; the SHA-256 equals the one in the result and the audit event |
| 5 | The audit log | `export.started`, `export.completed`, `export.patients_disclosed` naming exactly the patients in the file; a patient search of the audit log finds the run; the chain verifies |
| 6 | The same data with `test-alt-v1` | Other columns and one row per procedure, with no code change |
| 7 | An attending attests a waiting note; "new" runs again | Only that note is in the file |
| 8 | A resident corrects an exported note; it waits, and is attested again; "new" runs | While it waits, "new" leaves it out; the flag list shows the old item; the new row has `replaces run`; "rerun" of the first run reports `changedSinceRun: 1` |
| 9 | Program Admin runs the grant report for November | Counts equal the fixture's; a cell of 3 shows `<11` and a second cell is hidden; no patient ID anywhere in the parts |
| 10 | A Program Admin who is an attending runs the data export as JSON, then CSV | Every table of `EXPORT_TABLES` has a part; row counts equal `select count(*)`; no excluded column appears; Billing/Data gets 403, and so does a Program Admin with no clinical credential |
| 11 | A portal end-to-end test | Run, download, the warning text, axe clean in three themes |

### 10.2 The test that holds each rule
| Rule | Test |
|---|---|
| Nothing is released unless the result and audit committed | `exports-pipeline.test.ts`: make transaction C fail; the answer is 500, no part can be downloaded, no item row exists. Check it bites by returning the parts before C |
| The build reads one snapshot | The same file: a sync push commits between two loader queries (a hook in the test builder); the file holds none of it |
| The audit chain stays valid across a run; A and C take the team lock first | The same file: verify the chain after 20 runs interleaved with pushes; a push that holds the team lock makes a start wait |
| One run at a time per team | Two starts in parallel: one 409 `export_running` |
| Held until attested; drafts, Non-Medical notes and the Red flags note out | Vectors `billing-eligibility.json`; `exports-billing.test.ts` |
| Exported once per content; replacement; rerun; orders on one row per visit | Vectors `export-selection.json`; steps 3, 7 and 8 |
| What the runner may not read is absent | `exports-billing.test.ts`: Billing/Data against a Program Admin on the same data, through `visibleAnswers` |
| Permissions, MFA, recent sign-in, download by the requester only, the full view for the data export | `exports-permissions.test.ts`: every route against every standard role and the CHW preset; each refusal is logged |
| Small cells and subtraction | Vectors `grant-suppress.json`; step 9 |
| No formula in a cell; quoting | Vectors `csv.json` |
| Month edges and clock changes | Vectors `export-period.json` |
| Every team table is exported or excluded with a reason | `exports-tables.test.ts` against the live schema |
| No patient detail in an event or a file name | `exports-audit.test.ts` (the walker of section 9) |
| Expired parts can't be downloaded and are purged | `exports-runs.test.ts` with the clock moved 25 hours |
| Payer ID sync: each answer of section 6, the fix included; a throwing rule is a stored rejection; the fake agrees | `sync-payer-ids.test.ts`; phone `payer_id_sync_test.dart`; `fake_parity_test.dart` |
| A payer ID is never in the team index | `patients-index.test.ts` gains a case; phone `team_index_test.dart` |
| Medicaid ID entered and retracted offline | Phone widget tests with the network off; `tools/live-sync.sh` gains one scenario |

## 11. Defaults chosen (PLAN-OPEN), and questions for people
### 11.1 Defaults
| # | Question | Default | Why | Who decides |
|---|---|---|---|---|
| 1 | The billing file's format | `generic-v1` (5.4), CSV, one row per note | A biller can open it; the real format is a profile file | The partner FQHC, through the project lead |
| 2 | Small-cell threshold and which cells | Hide 1 to 10 in cells that count people or visits; not supply quantities; hide a second cell against subtraction | The common public-reporting rule; strict is the safe side | Counsel |
| 3 | May Billing/Data export what its role cannot read in the chart? | No. A sensitive diagnosis code is withheld and counted. A note of a sensitive type is left out whole, counted, and stays unexported until someone who may read it runs the export | PRD main 121 says Billing and Data does not see them; lifecycle 6.4 makes hidden content absent everywhere; 42 CFR Part 2 is with counsel | Counsel, then Brooke and Mercy |
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
| 16 | Is the Red flags note (forms 6.2) a billing line? | No. It is a Medical note of every Medical visit, but it is never a row and never carries the orders | One visit would give two rows, one with no diagnosis (D65) | The partner FQHC; Brooke and Mercy |
| 17 | Who may run the full data export | Someone for whom `visibleAnswers` hides nothing: `exports.data`, the view keys, and a credential that charts Medical (for substance use treatment sections). Others are refused | An export shows the runner only what the chart would; a file with silent gaps is not "all their data"; PRD main 145 | Counsel |
| 18 | Where a row's diagnosis codes come from | The note's own `problem` answers first, then problems whose status was observed in the visit | The note's answers are what the signer signed (D57); the problem list alone would miss a diagnosis nobody added to it | Brooke and Mercy |
| 19 | Does the build (transaction B) take the team write lock? | No. The route takes it first in A and in C; B reads one snapshot and writes only its own run's parts | Holding it would stop the team's phones syncing for the length of a build | The project lead |

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
4. **Withholding what the runner may not read** follows PRD main 121 and lifecycle 6.4, but makes the Billing/Data role's file incomplete: a sensitive diagnosis code is missing from a row, and a note of a sensitive type is missing whole. The counts are shown so nothing is silently missing, and a withheld note stays unexported for a runner who may read it. The data export goes the other way: it is refused unless the runner may read everything (11.1 #17), which bends "at any time" for a team whose admins hold no clinical credential.
5. **Codes derived at export time** read "one tap produces the billing codes" (PRD main 437) as a mapping, not a stored code on the order. A changed code map changes the codes of notes not yet exported; the run stores the map version, and exported rows are never rewritten.
6. **CPT is licensed.** Only codes are stored, never descriptions (11.2 #4).
7. **Repeatable** means: the same items, profile version and note content give the same bytes, pinned by the golden file. After a correction the old bytes cannot be rebuilt; the stored SHA-256 and the flag say so.
8. **The grant report can show "<11" for most cells of a small team.** Funders may want exact numbers. Changing the threshold is one constant, and counsel's call.
9. **The repeatable-read helper is new in `services/api/src/db/database.ts`** (level X). The build holds no lock (5.1). If a pooled connection cannot set the level, the fallback is to hold the team's write lock for the build, which blocks that team's syncs for the run's length; that is the reason to prefer the snapshot.
10. **Phases 4 to 9 are designs.** Phase 4's is reviewed, and 5 and 6 are checked against it. Phases 7 and 9 were not read for this check. Every name in section 2's second table may change; the loaders are the only code that reads them.

## 13. Units and a first card list
Units: B0 schema, vectors and core rules; B1 the pipeline and billing routes; B2 the grant report and the data export; B3 the Medicaid ID; B4 portal; B5 the Done when and the close. The names share nothing with the units of earlier phases. A card's ID is its unit and a short name. Each unit with T cards has one `tests` card (level X) that writes those cards' test files and vectors first. B0 lands first, alone, with CI green. Then B1 and B3 side by side, then B2, then B4, then B5. Levels follow `docs/plan/README.md`: an always-X path is X, a screen, a widget or a page is R, and S is kept for a card whose every mistake a machine check catches. A contract card regenerates the contract after its unit's routes. Files an earlier phase also edits, its cards first: `api/app.ts`, `api/patients/{charts,projection,schemas}.ts`, `api/routes/presets.ts`, `api/sync/schemas.ts`, `api/sync/entities/{values,index}.ts`, `api-test/permissions.test.ts`, `presets/src/{schemas,validate}.ts`, `phone/sync/{entities,local_store}.dart`, the fake, `chart_cache.dart`, `patient_screen.dart`, `sync_labels.dart`, `(app)/layout.tsx`, phase 5's presets hub, the `/audit` page, `tools/live-sync.sh`, the generated contract. Short paths: `api/` is `services/api/src/`, `api-test/` is `services/api/test/`, `phone/` is `apps/mobile/lib/`, `phone-test/` is `apps/mobile/test/`, `presets/` is `packages/presets/`, `vectors/` is `packages/contract/test-vectors/`, `portal/` is `apps/portal/src/app/(app)/`, `fake` is `phone-test/sync/fake_server.dart`.

| Card | Level | Files | Needs |
|---|---|---|---|
| B0-migration-payer | X | `db/migrations/<n>_patient_payer_ids.sql` (with `patient_of_change`), `db/test/patient-payer-ids.test.ts`, `api/patients/charts.ts` (`CHART_TABLES`) | The newest earlier migration that replaces `patient_of_change` (phase 6's I1-migration-orders, or a later phase's) |
| B0-migration-runs | X | `<n>_export_runs.sql` (policies, append-only triggers), `db/test/export-runs.test.ts`, `api/patients/charts.ts` | B0-migration-payer; phase 4's L0 |
| B0-snapshot | X | `api/db/database.ts` (`snapshotRead`), `api-test/snapshot-read.test.ts` | — |
| B0-tests | X | The nine vector files of 5.3 with their readers (`api-test/contract-vectors.test.ts`, `presets/test/billing-codes.test.ts`, `phone-test/patients/payer_id_test.dart`), `db/test/billing-code-map-kind.test.ts`, `api-test/exports-tables.test.ts` | B0-migration-runs; phase 5's P0-tests |
| B0-migration-kind | T | `<n>_billing_code_map_kind.sql` | B0-tests; phase 5's P0-migration |
| B0-eligibility | T | `api/exports/eligibility.ts` | B0-tests |
| B0-codes | T | `api/exports/codes.ts` (`deriveProcedures`) | B0-tests |
| B0-code-map | T | `presets/src/billing-codes.ts` (the body schema, `validateCodeMap`), `presets/src/schemas.ts`, `presets/src/validate.ts` (the kind's branch) | B0-tests, B0-migration-kind; phase 5's P0-validate |
| B0-csv | T | `api/exports/csv.ts` | B0-tests |
| B0-profile | T | `api/exports/profile.ts` (`parseProfile`), the two profile files of 4.4 | B0-tests |
| B0-render | T | `api/exports/render.ts` | B0-csv, B0-profile |
| B0-suppress | T | `api/exports/suppress.ts` | B0-tests |
| B0-period | T | `api/exports/period.ts` | B0-tests |
| B0-selection | T | `api/exports/selection.ts` | B0-tests |
| B0-files | T | `api/exports/files.ts` | B0-tests |
| B0-payer-id-ts | T | `api/patients/payer-id.ts` | B0-tests |
| B0-tables | T | `api/exports/tables.ts` (`EXPORT_TABLES`) | B0-tests |
| B1-tests | X | `api-test/exports-{pipeline,billing,runs,flags,audit}.test.ts`; a new case in phase 5's `presets-pull.test.ts` | B0 |
| B1-pipeline | X | `api/exports/pipeline.ts` (`runExport`: the three transactions, the team lock, the running check, the purge, the audit events) | B1-tests |
| B1-load-notes | T | `api/exports/billing-load.ts` (encounters, notes, signers, attesting; `billable`) | B1-tests; phase 4's L1 and L2 |
| B1-load-patient | T | `api/exports/billing-load-patient.ts` (the projection, the Medicaid ID, diagnoses through `visibleAnswers`, what is withheld) | B1-load-notes |
| B1-load-orders | T | `api/exports/billing-load-orders.ts` (supplies, procedures) | B1-load-notes, B0-codes; phase 6's I1 |
| B1-preview | T | `api/routes/exports-billing.ts`, `api/routes/exports-schemas.ts`, `api/app.ts` | B1-load-patient, B0-selection |
| B1-run | T | `api/routes/exports-billing.ts`, `api/exports/billing-build.ts` (with the item rows) | B1-pipeline, B1-preview, B1-load-orders, B0-render |
| B1-runs | T | `api/routes/exports-runs.ts`, `api/routes/exports-schemas.ts`, `api/app.ts` (list, detail, part download) | B1-pipeline |
| B1-flags | T | `api/routes/exports-flags.ts`, `api/exports/flags.ts`, `api/app.ts` (search, review) | B1-run |
| B1-preset-pull | T | `api/routes/presets.ts` (the phone's pull leaves `billing_code_map` out) | B1-tests; phase 5's P1-pull |
| B1-permissions | R | `api-test/permissions.test.ts` (a row for each route of B1) | The route cards of B1 |
| B1-contract | S | The generated contract | B1-permissions |
| B2-tests | X | `api-test/exports-{grant,data,permissions}.test.ts` | B1-pipeline |
| B2-grant-patients | T | `api/exports/grant-load.ts` (patients, encounters, notes by type) | B2-tests, B0-period |
| B2-grant-events | T | `api/exports/grant-load-events.ts` (check-ins, referrals; a missing table leaves its metric out) | B2-tests; phase 4's L0; phase 9 |
| B2-grant-supplies | T | `api/exports/grant-load-supplies.ts` (supplies, service area) | B2-tests; phase 6's I1; phase 7 |
| B2-grant-route | T | `api/exports/grant-build.ts`, `api/routes/exports-grant.ts`, `api/app.ts` | The three grant cards above, B0-suppress |
| B2-data-dump | T | `api/exports/data-load.ts` (`dumpTable`) | B2-tests, B0-tables |
| B2-data-write | T | `api/exports/data-write.ts` (JSON and CSV parts, the manifest) | B2-tests, B0-csv, B0-files |
| B2-data-route | T | `api/routes/exports-data.ts`, `api/exports/full-view.ts` (`seesEverything`), `api/app.ts` | B2-data-dump, B2-data-write |
| B2-permissions | R | `api-test/permissions.test.ts` (the grant and data routes) | B2-grant-route, B2-data-route |
| B2-contract | S | The generated contract | B2-permissions |
| B3-tests | X | `api-test/sync-payer-ids.test.ts`, a new case in `patients-index.test.ts`, `phone-test/patients/payer_ids_test.dart`, `phone-test/sync/payer_id_sync_test.dart`, a new case in `team_index_test.dart` | B0 |
| B3-wire | X | `api/sync/schemas.ts`, `api/sync/entities/values.ts`, `vectors/sync-values.json` | B0-migration-payer |
| B3-entity | X | `api/sync/entities/patient-payer-id.ts`, `api/sync/entities/index.ts` | B3-tests, B3-wire, B0-payer-id-ts |
| B3-phone-entity | X | `phone/sync/entities.dart`, `phone/sync/local_store.dart` | B3-wire |
| B3-payer-id-dart | T | `phone/patients/payer_id.dart` | B0-tests |
| B3-fake | X | `fake`, `fake_parity_test.dart` (every row of section 6) | B3-entity, B3-phone-entity, B3-payer-id-dart |
| B3-chart-read | T | `api/patients/projection.ts`, `api/patients/schemas.ts` (`payerIds`; none in the team index) | B3-tests, B3-entity |
| B3-contract | S | The generated contract | B3-chart-read |
| B3-chart-cache | R | `phone/patients/chart_cache.dart`, its test (keeps `payerIds`) | B3-contract |
| B3-store | T | `phone/patients/payer_ids.dart` (`addPayerId`, `retractPayerId`, `resendPayerId`) | B3-tests, B3-phone-entity, B3-payer-id-dart |
| B3-labels | R | `phone/features/sync/sync_labels.dart` (the problem `invalid_payer_id` and its fix) | B3-store |
| B3-edit-field | R | The patient edit screen, its widget test (offline, three themes, narrow) | B3-store |
| B3-chart-rows | R | `phone/features/patients/payer_id_rows.dart`, `patient_screen.dart`, their widget test | B3-store, B3-chart-cache |
| B3-portal-chart | R | `portal/patients/[patientId]/page.tsx` (the Medicaid ID) | B3-contract |
| B3-live | X | `phone-test/patients/live_payer_id_test.dart`, `tools/live-sync.sh` | B3-fake, B3-store |
| B4-hub | R | `portal/exports/page.tsx`, `(app)/layout.tsx` (the nav entry), `apps/portal/src/lib/exports.ts` | B1-contract |
| B4-billing | R | `portal/exports/billing/page.tsx`, its `actions.ts` (preview, run) | B4-hub |
| B4-run | R | `portal/exports/runs/[runId]/page.tsx`, `portal/exports/runs/[runId]/parts/[part]/route.ts` (the download handler) | B4-hub |
| B4-flags | R | `portal/exports/billing/flags/page.tsx`, its `actions.ts` | B4-billing |
| B4-grant | R | `portal/exports/grant/page.tsx`, its `actions.ts` | B4-hub, B2-contract |
| B4-data | R | `portal/exports/data/page.tsx`, its `actions.ts` | B4-hub, B2-contract |
| B4-codes | R | `portal/team/presets/billing-codes/page.tsx`, its `actions.ts`, phase 5's hub page (the link) | B0-code-map; phase 5's P3-parts and P3-history |
| B4-audit-filter | R | `portal/audit/page.tsx` (the "Exports" filter) | B1-contract |
| B4-e2e | R | `apps/portal/e2e/exports.spec.ts` (step 11 of 10.1; Playwright and axe, three themes) | The page cards of B4 |
| B5-fixture | X | `api-test/export-fixtures.ts` (the November team) | B1, B3-entity; phases 4 to 6 on the branch |
| B5-billing | X | `api-test/exports-done-when.test.ts` (steps 1 to 8), the golden files | B5-fixture |
| B5-reports | X | `api-test/exports-done-when-reports.test.ts` (steps 9 and 10) | B5-fixture, B2 |
| B5-docs | R | `docs/compliance/` (disclosure, minimum necessary, the export controls), `IMPLEMENTATION_PLAN.md` (the D-table, section 6 rows), the PR description | all |

**Count: 67 cards. S 3, T 31, R 17, X 16.** By unit: B0 17, B1 12, B2 10, B3 15, B4 9, B5 4. No card changes more than three source files.
