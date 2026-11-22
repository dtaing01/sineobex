> Reviewed on Nov 21 against the PRD and against the code as built (`c307a0b`, phase 4 closed) by four reviewers, and revised from the review: each of the 104 findings was applied, or refuted with evidence. Sections 1 to 12 are revised; section 13, the units and the card list, follows them.

# Phase 5: Admin configuration
PRD citations are `main.md:<line>` and `build-plan.md:<line>` (the saved copies of the product spec). Code citations are paths at `c307a0b`. "forms" and "lifecycle" with a section number are the two parts of the phase 4 design (`docs/design/phase-4/`).

## How this phase is built (decided Nov 21)
The project lead decided on Nov 21 that the frontier model builds this phase with helper agents, from the card index, as phase 4 was built (`docs/design/phase-4-encounters.md`, "How this phase is built (decided Nov 16)"). The cloud container has no model runner or GPU. What that changes:

- **The card list of section 13 stays the work-list.** Each row's files, needs and order hold. No card is written in full, and `tools/card-run.mjs` is not used: the plan's "Which model" trial (`docs/plan/README.md`) moves to the first phase built from cards.
- **A unit is built from the design sections its rows point to**, tests first, by one agent in its own worktree (`CLAUDE.md`, "Running units with helper agents"). Each unit's commits are also pushed to `claude/p5-wip-<unit>`, never merged; the project lead deletes those branches when the phase lands.
- **What a card's checks gave is replaced.** Every rule is removed by a script to see its test fail. Each unit gets an independent review, each confirmed finding shown by a failing test before it is fixed. The whole-phase adversarial review at the end is unchanged.
- **Levels still say where review is strictest.** An X row gets the coordinator's second review. What only a small model needs (a card's length, how much it may read, line ranges a driver fetches) does not apply here; unit order, who owns each file and each rule, which units run side by side, and each row's needs do.
- **Nothing is asked of a person mid-build** (the project lead, Nov 21: "everything that needs human decision making should be called out in a document for review after full mvp creation"). Wherever a choice needs a person, the default of section 11 is built, marked `PLAN-OPEN` in the code where the PRD leaves it open, and listed in `docs/decisions-for-review.md` with who decides, the default built, the recommendation, what a later change costs and where it lives. That document is published for review once the MVP (phases 5 to 10) is built.
- **This method is the default for phases 6 to 10**, and is listed in that document for review too.

## 1. Scope and Done when
**Done when** (`build-plan.md:91`, `IMPLEMENTATION_PLAN.md:239`): an admin adds a Labs item, a bundle and a secondary flag, and a phone sees all three after its next sync.

| In | PRD |
|---|---|
| Admins own every team preset, on desktop. Every write asks for a recent sign-in and a reason, and is logged | `main.md:185-192`, `:198-199`, `:600`; reasons `:930`, `:951`, `:955` |
| Note types: use as is, edit, remove, add (blank or from an existing type; offered for Medical, Non-Medical or both; with its sections); edits versioned; used ones archived; a platform update never overwrites a team copy | `main.md:387`, `:945`, `:952` |
| Bundles: use, edit, remove, add; core and optional lines; Medical or Non-Medical tag; a clinical prompt asked before the bundle | `main.md:128`, `:437-448`, `:445` |
| Item catalog; each item counted in its dispensing unit, set at creation; no conversions | `main.md:127`, `:469`, `:472` |
| Orders categories: OTC, Rx, Labs and others the admin adds; a Labs item records a result | `main.md:104` |
| Item mappings: from a field's answer, firing on the action field, and from a note type ("wound care" → 1 bandage) | `main.md:188`, `:424-431`, `:470` |
| Condition-to-supply mappings with a quantity per patient | `main.md:476` |
| The problem status check: a window (default 90 days), and a New or Ongoing problem not checked within it marked for a status check | `main.md:476` |
| Two-tier flags: primary risk levels placed at a rank, with criteria text, shown as a pill with the colour's name and a word ("Red · High"); secondary condition flags; sensitive flags hidden from Billing and Data | `main.md:120-121`, `:316-320`, `:945` |
| Flags on a patient: set and cleared with a reason, offline on the phone and in the portal, at intake too; who and why recorded; searched and filtered by both tiers. This is the flag half of stage 11, moved here (12.2) | `main.md:120`, `:316`, `:320`, `:944`; `build-plan.md:102`, `:113` |
| Bag minimums: per bag, a template for new bags, a bag copied from another, on or off per team | `main.md:477`, `:930` |

| Out | Taken by |
|---|---|
| Stock counts, the Orders tab, suggest then confirm, deduction, the restock reminder itself, bag owners, the allergy check; asking a bundle's prompt before it is applied | Phase 6 (`build-plan.md:93-98`) |
| The bag check and the route packing list (they read this phase's mappings and the status-check window); ranking the route builder and the continuity queue by flags | Phases 7 and 9 (`main.md:476`, `:478`; `build-plan.md:102`, `:113`) |
| Billing codes for bundles, items and note types (`main.md:437`) | Phase 10, as a ninth preset kind, `billing_code_map` (phase 10 design 4.3). The kind check of 4.1, the routes of 7 and `validatePreset` take a kind added later; the phone's pull leaves that kind out |
| Alert rules (`main.md:190`): the PRD defines none | Not built in the MVP (PLAN-OPEN, section 11). Geofence radius and resource directory settings are V2 (`main.md:190-191`) |
| The other team settings the PRD names: the phone's idle time (`main.md:600`), rooted or jailbroken phones (`:603`), the unsynced banner's hours (`:574`), index thumbnails (`:273`) | The phase that builds each. Each joins the settings body then, optional with its default (4.4) |
| A flag about substance use | Not shipped until counsel answers whether 42 CFR Part 2 covers it (`main.md:435`; section 11) |
| A free-form form builder (conditions, layout, new kinds of field); barcode scanning; pack-to-unit conversion | V2 or deferred (`main.md:479`, `:127`). Phase 5 edits note types through a fixed list of operations (5.4) |

## 2. Ground truth
What the code has at `c307a0b`. Phase 4 is done (`docs/design/phase-4-encounters.md`, "Status"), so everything below is built; where this phase changes it, the section that does so is named.

### 2.1 What phases 1 to 3 built that this phase uses
| Fact | Where |
|---|---|
| `team.manage_presets` exists: "Change note types, bundles, the item catalog, flags, mappings and alert rules". Among the standard roles only Program Admin holds it. Program Admin, Logistics and Healthcare Staff hold `patients.view_sensitive`; Billing/Data does not | `services/api/src/auth/permissions.ts:14`; `db/migrations/0002_identity_access.sql:87-97` |
| Migrations end at `0022_notice_note.sql`: phase 4 took 0017 to 0022. This phase's are `0023_team_presets.sql` and `0024_patient_flag_changes.sql` | `db/migrations/` |
| `patients.priority_flag_key text` is never read or written. Its line comment says "phase 5 adds the team flag table and the FK", and a merged migration is never edited | `db/migrations/0009_patients.sql:58` |
| `teams.settings jsonb not null default '{}'`, commented "Team presets that are plain values (phone auto-lock minutes, unsynced-banner hours, ...)". Nothing writes it. `teamScope` reads it into `TeamContext.teamSettings`, which nothing reads | `0002_identity_access.sql:16`; `services/api/src/auth/context.ts:29`, `:340`, `:359` |
| `encounter_notes` stores `note_type_key` and a nullable `note_type_version` | `db/migrations/0004_sync.sql:60-61` |
| A problem has an optional ICD-10-CM `code` with a format check, and `status_checked_at`, "module 5's 90-day check". Every status set moves it forward, never back, a confirmation of the same status included (Still ongoing, Still new on the problem screen, which shows "Last checked"). The chart carries it as `statusCheckedAt` | `db/migrations/0010_problems.sql:13-14`, `:22`; `services/api/src/sync/entities/problem.ts:238-251`; `services/api/src/patients/charts.ts:214`, `:252`; `apps/mobile/lib/features/patients/problem_screen.dart:254-266` |
| The team policy block (row-level security on `team_id`) and the revoke of update and delete on history tables | `0004_sync.sql:185-198` |
| An admin write opens `teamScope(c, deps, {permissions, recentAuth: true})` and writes inside `scope.tx(async (tx, audit) => …)`, auditing in that transaction. A missing key writes `access.denied` with the permission and the route; a stale sign-in answers 403 `reauth_required`, which is not logged (D98) | `services/api/src/routes/roles.ts:141`, `:161`; `services/api/src/auth/context.ts:154`, `:228-257`, `:374` |
| `lockTeamWrites(tx, teamId)` is the audit chain's own advisory lock (D32). Patient-side writes, encounter writes and the online routes that touch patient-side rows take it as their first statement. Role, member and device writes, team creation and the note type list's install do not | `services/api/src/sync/locks.ts:3-20`; its callers under `services/api/src/patients/`, `encounters/` and `sync/` |
| A synced entity is registered in `services/api/src/sync/entities/index.ts`, named in `sync/schemas.ts` (the entity lists the contract and the Dart client are generated from) and given a value schema and parents in `sync/entities/values.ts`. `patient_of_change` is replaced whole by each migration that adds an entity, 0020's being the newest | `services/api/src/sync/schemas.ts:31-63`; `db/migrations/0020_note_attestations.sql:49-111` |
| Every table with a `patient_id` is listed in `CHART_TABLES` | `services/api/src/patients/charts.ts:25-38` |
| The chart is built in `charts.ts` (`loadGroupCharts`, `loadChart`; `getChart` adds the timeline, `fetchCharts` the timeline and recent visits). `projection.ts` only removes parts: `Projection.sensitive` is `mayViewProblems` and `patients.view_sensitive`, and its comment says sensitive flags join it in phase 5 | `charts.ts:323`, `:555`, `:596`, `:617`; `services/api/src/patients/projection.ts:20-48` |
| The team index has one projection, `idx1`, for every eligible role. Phase 3 reserved its `flags` (sensitive ones only for a reader who may see them) and the key `idx1+sens`. A version that differs from the phone's replaces the phone's copy whole | `services/api/src/patients/team-index.ts:6-10`; `docs/design/phase-3-patients.md` 6.1, 6.2 |
| The portal's patient search is a POST whose answer lives only in the form's state: the address stays `/patients` | `apps/portal/src/app/(app)/patients/SearchForm.tsx:66-69` |
| The phone refreshes server data after each sync through `AfterSyncRefresher`s, made per team in `appRefreshers`; the team index (`TeamIndexRefresher`) is the model | `apps/mobile/lib/sync/sync_engine.dart:89`; `apps/mobile/lib/app_providers.dart:148-167`; `apps/mobile/lib/patients/team_index.dart:330` |
| The phone's team database is at schema version 2 (`_v1`, `_v2`). Its server copies go through `LocalStore.clearServerData`: at every sign-out, Log out anyway included, first at the next open of a file marked stale, at the index's 7-day expiry and on its 403 (D29). It keeps local work | `apps/mobile/lib/sync/local_db.dart:21`, `:101-112`; `apps/mobile/lib/sync/local_store.dart:2960`; `apps/mobile/lib/sync/sync_controller.dart:454`, `:755-776` |
| Phase 3's intake is one screen; `PatientRepository.createPatient` writes the patient and its aliases and allergies in one transaction, each a create whose parent is the patient | `apps/mobile/lib/features/patients/intake_screen.dart`; `apps/mobile/lib/patients/patient_repository.dart:685-720` |
| CI runs the packages' tests by an explicit filter list. The PHI guard reads `packages/forms/` and the shared vectors as fixtures. The contract's test lets exactly two path parameters that are not IDs through, a note type's key and version, on one path | `tools/ci-local.sh:17`; `.github/workflows/ci.yml:88`; `tools/phi-guard-rules.mjs:4-15`; `packages/contract/test/spec.test.ts:69-73` |
| Shared vectors live in `packages/contract/test-vectors/` (15 files). The seed (`db/seed/`) cannot import the API, so anything the seed installs lives in a package | `packages/contract/test-vectors/`; forms 11 |

### 2.2 What phase 4 built, by file, and what this phase does with it
| File | As built | What phase 5 does with it |
|---|---|---|
| `packages/forms/src/types.ts`, `resolve.ts` | A resolved definition (`ResolvedNoteType`): sections and fields by `id` (a path is a section id, then field ids), options by `code`; lists and modules copied in; `renames` left out. Marks: `sensitiveExam`, `treatmentRecord`, `needs`, `required`, `noNormal`; on the type `kinds` (Medical exactly when it is `['medical']`, D56), `group`, `sensitivity`, `quick`, `auto`. No `locked` or `hidden` mark. `MAX_DEFINITION_BYTES` is 256 KiB | Edits resolved definitions only; what may not be edited is worked out from the marks (5.4) |
| `packages/forms/generated/presets.json` | Nine note types released at version 1 (D78): `general_primary_care`, `harm_reduction` (sensitive), `outreach`, `psychological` (sensitive), `quick_encounter` (quick), `red_flags_disposition` (auto), `sexual_reproductive` (sensitive), `social_needs`, `wound_care` | The platform's note types: used as is, edited, copied from (5.4); its fields are what mappings name (4.6) |
| `packages/forms/src/install.ts` | `installPresets(sql: InstallSql, teamId, {presets?, onDiffer?})` answers `{installed, differing}`. It inserts every key and version the team lacks, `origin = 'preset'`, `preset_version` = the version, and reads no `origin`. A held key and version with another hash is `PresetDiffers`: thrown, or with `onDiffer: 'skip'` that key is skipped. It takes no lock and writes no audit event: its callers audit. **Skipping a key the team edited is not built**: a platform version 3 installed after a team's own version 2 would become what the team offers | P4-install makes it decide each key by 5.2 and write the team's next version |
| `services/api/src/routes/owner.ts:147`, `db/seed/seed.ts:169`, `:208` | Team creation (throws on a difference) and the seed (both seeded teams) call it | The preset installer runs beside it (5.2) |
| `services/api/src/forms/definitions.ts` | `listNoteTypes` installs with `onDiffer: 'skip'` (a difference is logged by count as `forms.preset_differs`, never by key), audits `forms.presets_installed` when it wrote, and offers each key at its highest version. `definitionFor` checks each row once: its hash, and that the definition's own `key` and `version` are the row's (D79, review finding NOT-8), else `DefinitionMismatch`: the one-version route answers 500, and a sync rule stores `definition_error` for every note on that version | The list reads `note_types` (4.3). Every row this phase writes names its own key and version (4.3) |
| `packages/forms/src/versions.ts`, `validate.ts`, `schema.ts` | `versionProblems(earlier, next, {renames})` compares a version with every earlier one; `validate(definition, context)`; `checkFile` (Ajv) is a separate entry, `@sineobex/forms/schema`, kept out of the API's edge bundle by `packages/forms/test/import-path.test.ts` | A publish calls `validate`, `versionProblems` and the size limit; `checkFile` runs in tests only (5.4) |
| `packages/forms/src/interp/` | `fieldAt`, `effectiveAnswers`, `visibleAnswers` and the rest of forms 7.1 | `validatePreset` reads `fieldAt`; `suggestSupplies` reads `visibleAnswers` (5.3) |
| `services/api/src/sync/read-rules.ts` | The one copy of the sync read rules (D99): `readNeed` (by default `patients.view`), `readsEntity`, `readsRecord` (a sensitive problem's rule), `sensitiveHidden`. `routes/sync.ts` (`requireRead`), the review queue and the value sent back to a phone all call it | Gains the flag rule (6.2) |
| `services/api/src/sync/review.ts` | `shownChange` (the queue's listing and every accept, `:167-200`) ends `default: return shown`; `fetchRecords`' `asRead` (`:632-681`) ends `default: return record`: a new entity is filtered by neither until it is named. A held sign-off or correction that will not reach the chart tells its sender (`signoff_not_applied`, `correction_not_applied`, `:318-377`) | Both gain a `patient_flag_change` case; a held flag change that will not reach the chart tells its sender (6.2) |
| `services/api/src/sync/apply.ts` | `decide` (`:471-534`) holds a change whose entity key the sender lacks, and a create whose check answers `rejected('permission')`; a hold is audited `sync.quarantined` with reason `permission` (`:547-561`). `applyInSavepoint` stores a class 23 error or a `DefinitionError` as a rejection; any other error stops the push (`:370-385`). `fieldForAnswer` (`:178-184`) sends back only what `readsRecord` lets through | The flag change uses all three as they are (6.2) |
| `services/api/src/sync/records.ts`, `sync/entities/encounter.ts` | A change's time is `when(c)`: the corrected time, else the device time (`records.ts:670`). `receivedAtOf` is when the server first received a change, a held one's hold time (`:585-589`). `storeCreate` writes each created field to `field_history` (`:720`). A visit moves its patient's last seen to the earlier of its start and the server's clock, so a clock set ahead never sets a time in the future (D90; `encounter.ts:178-191`) | A flag change's time follows the same rule (4.5) |
| `db/migrations/0021_referrals.sql`, `sync/entities/referral.ts` | A referral is created once and may be marked entered in error once, with a reason of 3 to 300 characters: the `set_once` field `enteredInError` (`0021:16-34`; `referral.ts:82-133`) | A flag change is marked entered in error the same way (4.5) |
| `db/migrations/0022_notice_note.sql` | `user_notices.note_id`: a notice names the note it is about (D104) | 0024 adds `patient_id` the same way (4.5) |
| `apps/mobile/lib/forms/definition_store.dart`, `forms_api.dart`; `apps/mobile/test/forms/forms_fake.dart` | The phone keeps each team's list and definitions per person, fetched for every team at sign-in and for the open team at each sync, deleted at every sign-out (D84). `keep` refuses a definition that names another key or version (`definition_store.dart:156`, `:177`); a list naming a version the phone cannot read is refused whole. The phone's tests serve the forms routes from `forms_fake.dart` | Nothing changes on the phone; the fake learns the archived-key rule (6.3) |
| `apps/mobile/lib/patients/chart_cache.dart` | Keeps ids and worked-out views in the patient record's `_chart` (`ChartMeta`, `:40-61`); records the phone may change against come in as record snapshots, imported by `importServerRecord` (`:184-192`) | Keeps the flag changes' ids and the flags view (6.1) |
| `apps/mobile/lib/encounters/refusal_fixes.dart`; `features/sync/needs_attention_screen.dart`, `sync_labels.dart`; `sync/local_store.dart:2169` | Needs attention settles each refusal through the store's `fixRejected`: the predicates (`settledByVisit`, `settledByPatient`, `settledByRemoving`), the buttons, the sentences (D121). `unknown_note_type` is settled by Remove this note | The model for Choose a flag and Change the reason (6.2) |
| `apps/mobile/lib/features/patients/sheet_gate.dart`; `design/widgets/private_box.dart`; `features/patients/patient_widgets.dart:337`; `test/security/dialog_gates_test.dart` | Every sheet that shows a chart's details sits in `SheetGate`, every dialog that names one in `DialogGate` (D125), and the test fails on one neither gated nor listed. Every box that takes a patient's details is a `PrivateBox` (D126). `askReason(…, gate:)` asks for 3 to 300 characters | The flags sheet and intake's reason follow them (8.2) |
| `apps/mobile/lib/features/patients/patient_screen.dart` | The patient profile, with phase 4's timeline and quick actions | Gains the flag pills and the flags sheet (8.2) |
| `apps/portal/src/app/(app)/team/` | Eleven pages: `attestation`, `cosign`, `devices`, `duplicates`, `incomplete-notes`, `members`, `merges`, `problem-reversals`, `quarantine`, `reviews`, `roles`; none for presets. The nav is `(app)/layout.tsx:14-45`. The patient page's header is `components/PatientHeader.tsx`. Acts that must keep what the person sees are route handlers (D115); refusal wording is `apps/portal/src/lib/refusals.ts`. The end-to-end helpers are `expectAccessible`, `expectReflow` (320 px) and `expectNothingStored` (`e2e/helpers.ts`), with an address check in `attestation.spec.ts` (`expectOnlyIds`) and the sweep in `e2e/a11y.spec.ts` | The presets pages, the flag pills and panel, and the search filters (8.1) |
| lifecycle 4.1, 4.2, D59 | A refusal only for what the worker can fix; a permission failure on a push is held for a Program Admin; a rule that throws is a stored rejection; every change takes the team lock | The flag change follows all four (6.2) |

## 3. The design in one page
1. **Every setting is a preset: a head row plus append-only versions with a JSON body.** One pair of tables holds eight kinds (phase 10 adds a ninth). One shape means one set of rules, one route file and one portal pattern, repeated. Note types keep phase 4's table and gain a head of the same shape.
2. **Presets are written only online, in the portal, never through the change protocol.** Admins work on desktop (`main.md:185`), so no phone can hold a refused preset change. Every write asks for a recent sign-in (`main.md:600`) and a reason, takes the team write lock first, and takes its revision from one function.
3. **A phone gets presets from one read route, by revision, after every sync, and keeps them in its team database with the team's other server copies.** They go with those copies at every sign-out. Everything works offline from that copy.
4. **Nothing is deleted. Remove means archive.** Old notes, orders and reports can always resolve an id. This is stricter than the PRD, which archives only what was used (`main.md:387`). Archiving a flag never takes it off a patient.
5. **What a count, a rank or a reader means never changes after creation**: an item's unit, a category's behaviour, a flag's tier and whether it is sensitive. To change one, archive and add. A platform update never changes one either.
6. **Records made against an older version are kept, never refused.** A record stores the preset id and the version it was made on. A phone offline cannot know about an edit or an archive.
7. **A platform update touches only copies the team never edited.** An edited copy gets an offer the admin may take. An archived copy stays archived.
8. **Note types are edited by a fixed list of operations, applied by one pure function on the server.** The server never accepts a definition built by a browser. No operation writes a mark that phase 4's rules read (who may read, what is required, what is Medical). Every stored definition names its own row's key and version, and passes phase 4's validator and version rules before it is stored.
9. **A patient's flags are changes made once; the current flags are worked out from them.** Two phones offline cannot conflict, and "who set it and why" (`main.md:320`) is the record itself. A clear takes off only the flag it names. A change's time is never later than when the server received it. A change made on the wrong patient is marked entered in error, once. No flag change is refused for something its sender cannot fix (D59).
10. **One rule says who may see a sensitive flag**, in `read-rules.ts`, and every read and every act calls it: the sync read, the review queue, the value sent back, the chart, the team index, search and the flag route.
11. **No new permission keys.** Writing presets needs `team.manage_presets`. Flagging a patient needs `patients.edit`. Seeing a sensitive flag needs what a sensitive problem needs.

## 4. Data model
Two migrations, the next free numbers after phase 4's 0022. Both are plain SQL, additive, one transaction. Both add policies, so both are level X.

| File | Adds |
|---|---|
| `0023_team_presets.sql` | `team_presets`, `team_preset_versions`, `team_preset_events`, `team_preset_state` (with a row for every existing team); the note type head `note_types` (4.3), filled from the versions present |
| `0024_patient_flag_changes.sql` | `patient_flag_changes` (4.5); `patient_of_change` replaced whole, with 0020's body plus a `patient_flag_change` arm; `user_notices.patient_id`; the team index trigger on `patient_flag_changes`; the column comment on `patients.priority_flag_key` |

### 4.1 `team_presets` (head; the API may update, never delete)
| Column | Type | Meaning and constraint |
|---|---|---|
| `team_id` | uuid not null | FK `teams`. `unique (team_id, id)` so later tables can point here with a composite key |
| `id` | uuid primary key | Made by the server |
| `kind` | text not null | One of `order_category`, `item`, `bundle`, `flag`, `field_supply_map`, `condition_supply_map`, `bag`, `settings`; a later phase widens the check (phase 10 adds `billing_code_map`). Never changes. One `settings` row per team: `unique (team_id) where kind = 'settings'` |
| `name` | text not null | Copy of `body.name`, 1 to 80 characters. Unique per `(team_id, kind, lower(name))` where `state = 'active'` |
| `state` | text not null | `active` or `archived` |
| `current_version` | integer not null | At least 1; equals the newest row in `team_preset_versions` |
| `origin_key` | text | The platform preset this came from, for example `bundle.basic_wound_care`. Null for a team's own. Unique per `(team_id, origin_key)` |
| `origin_version` | integer | The platform version this copy was last taken from |
| `platform_latest` | integer | The newest platform version the installer has seen. Greater than `origin_version` means an update is on offer |
| `customized` | boolean not null default false | True once the team edits, archives or restores it |
| `revision` | bigint not null | The team revision at this row's last change (4.2) |
| `created_by`, `updated_by` | uuid | Null for the platform installer |
| `created_at`, `updated_at` | timestamptz not null | Server time |

### 4.2 `team_preset_versions`, `team_preset_events` (both append-only) and `team_preset_state`
`team_preset_versions`:

| Column | Type | Meaning and constraint |
|---|---|---|
| `team_id`, `preset_id` | uuid not null | Composite FK to `team_presets (team_id, id)` |
| `version` | integer not null | Primary key `(team_id, preset_id, version)`; starts at 1, no gaps |
| `body` | jsonb not null | The shape for the kind (4.4). At most 32 KiB |
| `source` | text not null | `team` or `platform` |
| `created_by` | uuid | Null when `source = 'platform'` |
| `created_at` | timestamptz not null | Server time |

`team_preset_events`, one row for every act on a preset or a note type, so a reason is kept for each (`main.md:930`, `:951`, `:955`) and the version history can show it:

| Column | Type | Meaning and constraint |
|---|---|---|
| `team_id`, `id` | uuid not null | Primary key `id`, made by the server |
| `preset_id`, `note_type_key` | uuid, text | Exactly one is set: the preset (composite FK to `team_presets`) or the note type (composite FK to `note_types`) |
| `act` | text not null | `created`, `updated`, `archived`, `restored`, `update_taken`, `reordered`, `installed`, `platform_updated` |
| `version` | integer not null | The version the act made, or stood on |
| `reason` | text | Trimmed, 3 to 300 characters. Null exactly when `created_by` is null (the platform installer's acts). Admin text: never in audit details or logs |
| `created_by` | uuid | Null for the installer |
| `created_at` | timestamptz not null | Server time |

`team_preset_state`: `team_id uuid primary key` (FK `teams`), `revision bigint not null default 0`, `epoch uuid not null default gen_random_uuid()`. 0023 inserts a row for every existing team; a team made later gets its row at its first write.

**One function takes a revision**: `takeRevision(sql, teamId)` in `packages/presets/src/revision.ts`. It takes the team's write lock with the exact statement of `lockTeamWrites` (the package cannot import the API, section 2), then `insert … values (teamId, 1) on conflict (team_id) do update set revision = team_preset_state.revision + 1 returning revision`. Every writer calls it once per transaction and stamps every head it changed with the answer: the admin routes, the note type publish, both installers and the seed. None writes the revision itself. A route also takes `lockTeamWrites` as its first statement, for one lock order (D32); the second take is free, since advisory locks are re-entrant. With the lock held to commit, revisions commit in order with no gaps, which is what the phone's pull relies on (6.1). `db/test/preset-revision.test.ts` holds both statements to `append_audit`'s key.

`epoch` is renewed after a database restore (a step of the restore procedure, which phase 12 writes; until then the step is `update sineobex.team_preset_state set epoch = gen_random_uuid()`), so a phone whose copy came from before the restore replaces it (6.1).

Security block for all four: the team policy of `0004_sync.sql:185-195`; `revoke delete` on all four; `revoke update` and the `forbid_mutation` trigger on `team_preset_versions` and `team_preset_events`.

### 4.3 Note types
Phase 4 owns `note_type_versions` (forms 3.1) and this phase changes none of its columns. A team's edit, and a team's copy, is a new row with `origin = 'team'` and `preset_version` null. A platform version installed or taken is a row with `origin = 'preset'` and `preset_version` the platform's number (5.2).

**Every stored definition names its own row** (D79, review finding NOT-8: `definitionFor` refuses any other, and the phone's store refuses a definition that names another key or version). Before the hash is taken, the definition's `key` and `version` are set to the row's: an edit sets `version` to the next version; a copy sets `key` to the new key and `version` to 1; a platform version installed or taken as the team's version N has its `version` rewritten to N. Where N is not the platform's own number, the hash is not the bundled preset's, so the phone downloads that definition rather than reading the bundle (`definition_store.dart` reads the bundle by hash). `hash = sha256Hex(canonicalJson(definition))`. Every row any path of this phase writes is read back through `definitionFor` in its tests.

`0023_team_presets.sql` adds the head phase 4 left to this phase: `note_types (team_id, key, title, state, current_version, platform_latest, customized, revision, updated_by, updated_at)`, primary key `(team_id, key)`. 0023 fills it from the versions present: `title` from the newest definition, `platform_latest` from the newest `preset` row's `preset_version`, `customized` false. From then on the note type installer upserts the head of every key it installs or updates. `title` is a copy of the definition's `title`. The head shares `team_preset_state.revision`; its acts are rows of `team_preset_events` with `note_type_key`. A key the team makes is `t_` and 12 hex characters, made by the server; it fits 0017's key pattern and the contract's.

### 4.4 Body shapes (zod schemas in `packages/presets/src/schemas.ts`; `id` fields are preset ids of the same team)
| Kind | Body | Fixed after creation |
|---|---|---|
| `order_category` | `{name, behaviour: 'supply' \| 'medication' \| 'lab', sort: int}` | `behaviour` |
| `item` | `{name, categoryId, unit: text 1-20, medical: bool, captureLot: bool, result: null \| {type:'choice', options: text[2..12]} \| {type:'number', unit: text}}` | `unit`, `result.type`. So `categoryId` may change, but never into or out of a `lab` category |
| `bundle` | `{name, medical: bool, prompt: text 0-300 (default ''), lines: [{itemId, qty: int 1-99, core: bool}] (1-40, no item twice)}`. `prompt` is asked before the bundle is applied (`main.md:445`); phase 6 asks it. Empty means none | none |
| `flag` | `{name, tier: 'primary' \| 'secondary', criteria: text 0-500 (default ''), color: one of 8 palette names, rank: int, sensitive: bool}`. Each palette entry has a plain colour name, and a pill reads "Red · High": the colour's name, then the flag's (`main.md:945`) | `tier`, `sensitive` |
| `field_supply_map` | `{name, noteTypeKey, path?, when?, lines: [{itemId, qty: int 1-99 \| {fromPath: path}}] (1-10)}`. `path` and `when` are both there or both left out; left out, the map fires once for every note of the type (`main.md:188`, `:470`). `when` is `{equals: value} \| {includes: optionCode} \| {answered: true}`. A path is written without an entry part, as `mapsTo` is (forms 2.2) | `noteTypeKey`, `path` |
| `condition_supply_map` | `{name, codes: text[1..20] (ICD-10-CM, the format of 0010_problems.sql:14), lines: [{itemId, qtyPerPatient: int 1-99}] (1-10)}` | none |
| `bag` | `{name, minimums: [{itemId, min: int 1-999}] (0-200, no item twice)}` | none |
| `settings` | `{name: 'Team settings', bagMinimumsOn: bool, newBagMinimums: [{itemId, min}] (0-200), problemCheckDays: int 7-365}` | none |

**The settings preset is the one store of this phase's team settings**: versioned, audited and sent to phones like every preset. `teams.settings` (`0002_identity_access.sql:16`) stays unused: nothing writes or reads it (section 2), and it is neither versioned, nor audited change by change, nor sent to phones. The other team settings the PRD names (section 1's Out table) join this body in the phase that builds each, optional with a default, so an older phone and an older body read the same (12.1, risk 3).

Rules the schema cannot hold are in `validatePreset` (5.3):

- An item's category exists. `result` is set exactly when the category's behaviour is `lab`. `medical` is true when the behaviour is `medication` or `lab`, so the switch is free only in a `supply` category (section 11, row 15).
- A bundle holding a `medication` item is `medical` (`main.md:447`).
- A `primary` flag is never `sensitive`.
- A field map's path names, in the note type's current version, what `fieldAt` (forms 7.1) points at as a field or as a grid cell (`<grid>.<row code>`, or `<grid>.<row code>.<child>` for a group cell), of kind `choice`, `number` or `flag`; with `{answered: true}`, also `text`, `date` or `duration`. A row code of a grid whose rows are picked is an option of the picking field. `equals` and `includes` name a code the field holds. `fromPath` names a number in the same entry, or the same row.
- **`sensitive_path`**: a field map is refused when its path, or for a map with no path its note type, lies anywhere `visibleAnswers` may take out for some reader: a section marked `sensitiveExam` or `treatmentRecord`; an option, a row or a region marked `sensitiveExam`; a section that holds a diagnosis (a `problem` field), as forms 2.2's condition rule reads it; or a note type whose `sensitivity` is `sensitive`. A supply line is read by people with `inventory.view` and `billing.view_codes`, and would tell them what was found (D77's reason). The PRD's naloxone example is in the harm reduction note type, which is sensitive, so it cannot be mapped (12.2).
- A condition map may name codes on phase 3's sensitive list. Phases 6 and 7 count such a code only for a reader who may see sensitive problems.
- Every id names a preset of the same team and of the right kind; on create, edit and restore, none is archived (`reference_archived`). One `settings` row.

### 4.5 `patient_flag_changes` (a synced entity: created once, marked entered in error at most once)
| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid primary key | Made on the phone, or by the API for a portal change. `unique (team_id, id)` |
| `team_id`, `patient_id` | uuid not null | Composite FK to `patients (team_id, id)`. Listed in `CHART_TABLES` as `group`, so a merged chart shows both sides' flags (D27) |
| `flag_id` | uuid not null | Composite FK to `team_presets (team_id, id)`. The rule checks `kind = 'flag'` before the insert |
| `action` | text not null | `set` or `clear` |
| `reason` | text not null | Trimmed, 1 to 500 code points, counted the same way in TypeScript and Dart (`sync-values.json`). Patient detail: never in audit details, logs or notices |
| `effective_at` | timestamptz not null | The change's time, never later than when the server received it: the earlier of `when(c)` (the corrected time when the clock is verified, else the device time, `records.ts:670`) and `receivedAtOf` (a held change's hold time). Phase 4's rule for last seen (D90). Set by the server |
| `device_time`, `clock_verified` | timestamptz, boolean | As on `encounters` (`0004_sync.sql:33-52`) |
| `author_user_id`, `created_device_id`, `change_id` | uuid | Who, from which phone (null for the portal), and the sync change that carried it (null for the portal) |
| `approved_by` | uuid | The Program Admin who accepted it from review, as on `note_signoffs` |
| `status` | text not null default `active` | `active` or `entered_in_error` |
| `error_reason`, `error_by`, `error_at` | text, uuid, timestamptz | Trimmed, 3 to 300 characters; all three set exactly when `status = 'entered_in_error'` (the check of `0021_referrals.sql:33-34`) |
| `version`, `field_versions`, `field_meta` | | The bookkeeping of a record with one field that can be set, as on `referrals` |
| `received_at`, `updated_at` | timestamptz not null | Server receipt; the touch trigger |

Index `(team_id, patient_id, effective_at, id)`. Security block: the team policy; `revoke delete`; a guard trigger that refuses every update but the one that marks the change entered in error, once, with its bookkeeping (the `set_once` rule of 6.2, held in the database too).

0024 also: replaces `patient_of_change` whole, 0020's body plus an arm for `patient_flag_change` (the value's `patientId`); adds `user_notices.patient_id uuid` with a composite FK `(team_id, patient_id)` to `patients`, as 0022 added `note_id`, so a notice can name the patient a held change was about (6.2); adds the statement-level triggers after insert and update on `patient_flag_changes` that call `bump_team_index` (0009), since the team index carries flags (6.1); and sets `comment on column sineobex.patients.priority_flag_key` to say it is unused because a patient's flags are worked out from `patient_flag_changes` (12.2). 0009's line comment stays as merged.

### 4.6 Platform data (`packages/presets/data/platform.json`)
Each entry is `{originKey, platformVersion, kind, body}`, and a body names other entries by `originKey`. The contents come from the PRD's own words, the field specification's among them (the released definitions' labels, `main.md:406`), and nothing is invented beyond them. Every entry below is listed for Brooke and Mercy (section 11, rows 5, 15, 31 and 32).

- **Categories**: OTC and Rx (`medication`), Labs (`lab`), Supplies (`supply`) (`main.md:104`; section 11, row 3).
- **Flags**: primary Red · High, Yellow · Medium and Green · Low, ranked in that order, highest risk first (`main.md:317`, `:945`). Each carries as its criteria text the six suggested starting criteria of `main.md:319`, in the PRD's words, headed "Suggested starting criteria. Rewrite them for your team and say which put a patient at this level:", since the PRD does not say which criterion goes with which level. Secondary: Frost risk and Dehydration risk (`main.md:316`, `:318`) and Pregnancy, sensitive (`main.md:121`). No flag about substance use until counsel answers (`main.md:435`).
- **Settings**: bag minimums off, no template lines, problem check after 90 days (`main.md:476`, `:477`).
- **Items**:

| Item | Category | Counted in | From |
|---|---|---|---|
| Pregnancy test | Labs | test; result a choice of Positive or Negative | `main.md:104`, `:417` |
| Glucose test | Labs | test; result a number in mg/dL | `main.md:104` |
| Doxycycline 100 mg | Rx | tablet | `main.md:127` |
| Acetaminophen | OTC | tablet | `main.md:443` |
| Hydrocortisone cream | OTC | each | `main.md:476` |
| Naloxone kit | OTC | kit | `main.md:428`, `:442`; section 11, row 15 |
| Electrolyte packet | Supplies | packet | `main.md:127` |
| Gauze, Bandage | Supplies | each | `main.md:427`, `:437` |
| Xeroform, Mepilex, ABD, Hydrocolloid, Aquacel, Compression: the other options of `wound_care`'s `wound.treatment.dressing`, by label | Supplies | each | `main.md:427` ("the dressing type chosen") |
| Flu, COVID, Tdap, Hep A, Hep B, Pneumococcal, HPV and Shingles vaccine: the rows of `general_primary_care`'s `preventive.vaccine_status` | Rx, lot and expiry captured | dose | `main.md:426` |
| Food kit, Hygiene kit | Supplies | kit | `main.md:429`, `:446` |
| Socks, Handwarmers | Supplies | each | `quick_encounter`'s `social.support` |
| A kit named after each bundle below with no contents in the PRD | Supplies; OTC for the Allergy and Cold and flu kits, which hold a medication (`main.md:447`) | kit | `main.md:439`, `:442` |

- **Bundles**, the 18 of `main.md:439`. Every line is core but the antibiotic in Basic wound care, which is optional, so no antibiotic is pre-checked:

| Bundle | Tag | Lines | From |
|---|---|---|---|
| Basic wound care | Medical | Gauze, Bandage, Doxycycline 100 mg (optional) | `main.md:437` ("gauze, bandages and antibiotics") |
| General pain | Medical | Acetaminophen | `main.md:443`, `:447` |
| Overdose response | Medical | Naloxone kit | `main.md:428` |
| Summer/dehydration | Non-Medical | Electrolyte packet; prompt "Check for signs of heat illness before giving this bundle." | `main.md:127`, `:445` |
| Winter/frostbite | Non-Medical | Socks, Handwarmers; prompt "Check for frostbite before giving this bundle." | `main.md:445` |
| Cold/flu | Medical | Cold and flu kit; prompt "Ask about respiratory symptoms before giving this bundle." | `main.md:445`, `:447` |
| Allergy | Medical | Allergy kit | `main.md:447` |
| Hygiene | Non-Medical | Hygiene kit | `main.md:446`, `:447` |
| Menstrual care, Foot protection | Non-Medical | the kit named after it | `main.md:447` |
| Safe smoking, Safer crack use, Injection | Non-Medical | the kit named after it | `IMPLEMENTATION_PLAN.md:285` |
| Advanced wound care, Abscess/drainage, Sexual health, Foot fungus, Dry skin/chafing | Medical | the kit named after it | `main.md:439` |

- **Mappings**, each on a field of a released definition that records something given, the PRD's own examples first (`main.md:424-431`):

| Map | Note type and path | When | Lines | From |
|---|---|---|---|---|
| A vaccine given, one map per row | `general_primary_care`, `preventive.vaccine_status.<row>` | equals `given_today` | that row's vaccine, 1 | `main.md:426` |
| A dressing applied | `wound_care`, `wound.treatment.dressing`; `quick_encounter`, `wound.dressing` | answered | Gauze 1, Bandage 1 | `main.md:427` |
| The dressing type chosen, one map per option but Gauze and Other | the same two paths | includes the option | its item, 1 | `main.md:427` |
| Food or hygiene given | `outreach`, `outreach.support` (`food`, `hygiene`); `quick_encounter`, `social.support` (`food`, `hygiene_kit`) | includes the option | Food kit 1, or Hygiene kit 1 | `main.md:429`, `:431`: support given is the action field, not the needs asked about |
| Socks or handwarmers given | `quick_encounter`, `social.support` | includes `socks`, or `handwarmers` | Socks 1, or Handwarmers 1 | the field records what was given |
| Rash or dermatitis (a condition map) | codes R21 and L30.9 | | Hydrocortisone cream, 1 per patient | `main.md:476` |

Not shipped: naloxone accepted (harm reduction is a sensitive note type, so `sensitive_path`); "Social needs tapped" on `social_needs`' `needs.needs`, which asks what is needed and gives nothing (`main.md:431`); a map for every wound care note, "wound care → 1 bandage" (`main.md:470`), which would count the bandage twice beside the dressing map.

## 5. Rules
### 5.1 States of a preset and of a note type
An archived preset is never offered for new work. It stays readable everywhere, with its name. Every act a person makes carries a reason of 3 to 300 characters, kept in `team_preset_events` (4.2).

| Act | From | To | Who | Refused when (code) |
|---|---|---|---|---|
| Create | none | `active`, version 1 | `team.manage_presets` | body invalid (`invalid`); name in use (`name_taken`); it points at an archived preset (`reference_archived`) |
| Edit | `active` | `active`, version + 1, `customized` | same | `invalid`; `name_taken`; `reference_archived`; a fixed field changed (`fixed_field`); base version is not current (`stale`); body unchanged (`no_change`) |
| Remove | `active` | `archived`, `customized` | same | an active preset points at it (`referenced`, with counts by kind); `stale`; it is the `settings` row (`not_removable`). A flag patients carry is archived all the same and stays on them (below) |
| Restore | `archived` | `active` | same | `name_taken`; `reference_archived` |
| Take the platform update | `active`, update on offer | version + 1 with the platform body, `customized = false`, `origin_version = platform_latest` | same | `stale`; no update on offer (`no_update`); the update changes a fixed field (`fixed_field`: take it as a new preset) |
| Take the platform update as a new preset | `active` or `archived`, update on offer | the old one `archived` if it was active, and no longer the platform's (`origin_key` null); a new preset, version 1, with the platform body and the `origin_key` | same | `stale`; `no_update`; `referenced`, when the old one is active and an active preset points at it |
| Reorder a tier's flags | `active` flags | each flag whose rank changes gets version + 1 | same | `ids` are not exactly the tier's active flags (`ids_mismatch`) |
| Platform install or update | see 5.2 | | the installer, no user | never refuses; it skips |

**An archived flag stays on every patient who carries it.** Archiving is never refused for that, and never takes the flag off anyone: `currentFlags` keeps it (5.3), and every screen shows it with its name and "No longer on the team’s list". It can be cleared, and is never offered to be set again: the portal refuses a set (7), and a set sent by a phone that was offline is accepted (6.2), as every record made against an older state is (point 6).

### 5.2 A platform update (`main.md:387`, `:439`)
`platformUpdateEffect({exists, state, customized, originVersion, platformVersion, changesFixed})` returns one of:

| Case | Result |
|---|---|
| The team has no row with this `origin_key` | `install`: head plus version 1, `source = 'platform'` |
| Row exists, `platformVersion <= originVersion` | `skip` |
| Row is `active`, not customized, the platform is newer, and the new body changes no fixed field | `update`: version + 1, `source = 'platform'`, `origin_version` moves |
| Row is customized or archived, or the new body changes a fixed field, and the platform is newer | `offer`: only `platform_latest` moves. The body is untouched |

It lives in `packages/forms/src/platform-effect.ts`. `@sineobex/presets` imports `@sineobex/forms` (for `fieldAt` and `visibleAnswers`), so forms never imports presets; both installers call this one function, and both packages' tests read `platform-update.json`.

The preset installer is `installTeamPresets(sql: InstallSql, teamId)` in `packages/presets/src/install.ts`: a package, because the seed calls it, and one that imports no database library, as phase 4's installer. It runs where phase 4's `installPresets` runs (section 2.2): when a team is created, in the seed for both seeded teams, and at the start of `GET /v1/presets`, so a team gets a platform update the first time a phone asks. It works out its plan from the heads. With nothing to write it returns. If it would write, it takes the team's write lock, works the plan out again under the lock (a second pull that read "no row" now sees the first one's rows and writes nothing), writes each entry with `on conflict do nothing`, takes one revision for all of them (`takeRevision`, 4.2), and answers its counts. It writes no audit event: the caller audits `preset.platform_installed` in the same transaction. An entry it cannot write (a body `validatePreset` refuses against the team's presets, such as a bundle whose item the team archived) is skipped and counted, and the route logs the count, as `forms.preset_differs` is logged, never a key: the log's allowlist has none, and a throw would fail every phone's pull. Platform data is `packages/presets/data/platform.json` (4.6), checked in CI by `packages/presets/test/platform-data.test.ts`: every entry passes its schema and `validatePreset`, every `originKey` it names exists, names are unique per kind, and a new `platformVersion` that changes a fixed field is reported, since every team will get it as an offer.

Note types follow the same table through phase 4's `installPresets`, which card P4-install changes. For each key it calls `platformUpdateEffect` with `originVersion` from the newest `origin = 'preset'` row's `preset_version` (no such row: `install`) and `state` and `customized` from the `note_types` head; a fixed field here is `kinds`, `group`, `sensitivity`, `quick` or `auto`. `install` and `update` write the team's next version (1 for a new key, else one more than the newest row) with `origin = 'preset'`, `preset_version` the platform's number, and the definition's `version` rewritten to the row's (4.3). `offer` moves only `note_types.platform_latest`. `PresetDiffers` is raised only for an `origin = 'preset'` row with the platform's `preset_version` whose definition, read with its `version` set to that row's, is not the platform's. A team's own version can then never be overtaken by a platform one (`main.md:387`): forms 3.2's rule ("skips a key whose newest row has `origin = 'team'`") with the archived case added. An install that may write takes `lockTeamWrites` first, since a publish writes the next version too and the two would collide on 0017's primary key; the list route works out its plan, then locks and works it out again, as above. Its callers keep auditing `forms.presets_installed`.

### 5.3 The pure functions
Each has no database or network in it. TypeScript lives in `packages/presets/src/` (and `platformUpdateEffect` in `packages/forms/src/`), Dart in `apps/mobile/lib/presets/`. Each is pinned by one vector file in `packages/contract/test-vectors/` that both sides read, as `access.json` is today.

| Vector file | Function | Input | Output | Dart |
|---|---|---|---|---|
| `preset-bodies.json` | the schemas of 4.4 | kind, body | accepted, or the failing paths | parsers `parsePreset(kind, json)` accept every valid sample, skip a kind they do not know and ignore a field they do not know |
| `preset-validate.json` | `validatePreset` | kind, body, `refs` (id to kind, state and the few fields rules read), the current definition of each note type key a map names | `[]` or `[{path, code}]` | no |
| `preset-rules.json` | `presetWriteEffect` | `{act, state, baseVersion, currentVersion, changedFixed, sameBody, referencedBy, archivedRefs, nameTaken, updateOnOffer, updateChangesFixed}` | `{refuse: code}` or `{stateAfter, versionAfter, customizedAfter}` | no |
| `preset-rules.json` | `reorderRanks` | current `[{id, rank}]`, ordered ids | `[{id, rank}]` for flags whose rank changes (rank = position times 10) | no |
| `platform-update.json` | `platformUpdateEffect` | 5.2 | `install`, `skip`, `update`, `offer` | no |
| `flag-current.json` | `currentFlags` | changes `[{id, flagId, action, effectiveAt, enteredInError}]`, flags by id `{tier, rank, name, sensitive, state}`, `hidden(flag)` (the reader's rule, 6.2) | `{primary: id or null, secondary: id[] by rank then name}` | yes |
| `supply-suggest.json` | `suggestSupplies` | active maps, items by id, the note's type key and definition, the answers the suggesting person may see (`visibleAnswers`, forms 7.1) | `[{itemId, qty, mapId}]`, summed per item | yes |
| `supply-suggest.json` | `bundleLines` | bundle body, items by id, multiplier | `[{itemId, qty, checked}]`; lines whose item is archived are left out | yes |
| `note-type-edit.json` | `applyNoteTypeEdit` (5.4) | a resolved definition, one operation, the ids and codes every earlier version used (and, for a copy, the source definition) | `{definition, renames}`, or `{refuse: code}` | the phone's `NoteTypeDef.fromJson` reads every result |
| `problem-check.json` | `problemCheckDue` | `{status, statusCheckedAt}`, now, `problemCheckDays` | true or false | yes |

`currentFlags`:
- A change marked entered in error is left out. So is a change whose flag is not among the team's flags, and one whose flag `hidden` hides from this reader.
- Changes are ordered by `effectiveAt` (4.5), then `id`.
- **Primary**: the primary-tier changes are folded in that order. A `set` makes its flag the primary. A `clear` makes the primary none only when its flag is the primary at that point; otherwise it changes nothing. So a clear of Yellow from a phone that never saw Red set takes nothing off (`flag-current.json` holds that two-phone case).
- **Secondary**: a flag is carried when its own last change is `set`.
- An archived flag is answered as any other (5.1); the screens mark it.

`suggestSupplies`: a map fires when the note's type matches and, for a map with no path, once for the note; otherwise when the answer at `path` equals the value, includes the option code, or is present. Answers are read from what the suggesting person may see, so an answer hidden from them, or in a hidden field, never fires a map. In a repeating section a map fires once for each entry (each wound). `{fromPath}` reads a whole number from 0 to 99 from the answers, in the same entry or row; anything else gives 0, and a line with 0 is left out. A map that names an archived item skips that line. Phase 6 calls it; phase 5 pins it.

`problemCheckDue`: true when the problem is New or Ongoing and its status was last checked more than `problemCheckDays` days before now (`main.md:476`); never for a Resolved problem or one entered in error. Phase 7's bag check reads the same window.

### 5.4 Note type edits
`PUT` sends `{baseVersion, reason, ops}`. The server loads every row of the key, oldest first, applies each operation in order with `applyNoteTypeEdit` to the newest definition, and collects the renames the operations yield. It sets the result's `version` to the next version (4.3) and checks it with phase 4's `validate` (its note type lookup answering the team's newest version of each other key), `versionProblems(every earlier version, next, {renames})` and `MAX_DEFINITION_BYTES` (256 KiB). It stores no renames: the resolved definition leaves them out of its hash (forms 2.6). It inserts the result as the next version with `origin = 'team'`. A released row is never changed. `rename_label` and `rename_option` yield one rename each; any other label change is refused by the version rules (`versions.label_changed`). The JSON Schema check cannot run in the API's edge bundle (section 2.2), so `applyNoteTypeEdit` builds only shapes the schema takes, and `packages/forms/test/edit.test.ts` runs `checkFile` from `@sineobex/forms/schema`, and the phone's `NoteTypeDef.fromJson`, on every result in `note-type-edit.json`: the phone refuses a whole list that names a version it cannot read (D84).

| Operation | Refused when |
|---|---|
| `rename_type {title}` | empty or over 80 characters |
| `set_hidden {path, hidden}`: hidden leaves a section or field out of the new version; shown copies it back, unchanged, from the last version that had it | the target is protected (`protected`); another field's `showWhen` or `mapsTo` names it (`in_use`) |
| `rename_label {path, label}` | `protected` |
| `add_option {path, label}`, `rename_option {path, code, label}`, `retire_option {path, code}`, `move_option` | the field is protected; the option carries `exclusive`, `normal`, `unable`, `other`, `suggests` or `sensitiveExam` (`protected`); a retire would leave no option. Each field the operation reaches through `mapsTo` (rule 5) is checked the same way, and a protected one refuses the whole operation (`protected`, naming that note type) |
| `add_field {sectionId, kind: 'text' \| 'choice' \| 'number', label, …}` (Yes or No is a `choice` with two options) | over 40 team fields in a type; the section has `needs` |
| `add_section {title, afterSectionId}` | over 10 team sections |
| `copy_section {fromKey, sectionId, afterSectionId}`: one section copied unchanged, with its fields, ids, options and marks, from the newest released version of a platform note type (`generated/presets.json`, so a module the platform resolved in comes with it) or from the current version of another of the team's note types (`main.md:945`) | the source type's `kinds`, `group`, `sensitivity`, `quick` or `auto` is not the target's, or the section has `needs` (`not_copyable`): a copy would change what the type is or who may read what it holds; the section's id, or an id or code in it, was used in any version of the target (`id_taken`); the result fails phase 4's validator, such as a condition naming a section the target lacks (`invalid`) |

**Protected**, worked out from phase 4's marks (forms 2.2), since a definition has no `locked` mark: every part of a note type with `auto` (Red flags, disposition and follow-up, `main.md:409`); a field with `required` or `noNormal` (the red-flag question, sensitive-exam consent and chaperone, `main.md:415`); a section with `needs`; a field of kind `action`, `problem`, `photo` or `info`. One function in the forms package decides it, and every operation calls it. A copied section keeps its marks, so what they protect stays protected.

Five rules hold in every case, each pinned in `note-type-edit.json`:
1. **No operation writes a mark.** `sensitiveExam`, `treatmentRecord`, `needs`, `required`, `noNormal`, `showWhen`, `handoff`, `mapsTo` and an option's marks are copied as they are. A field added to a marked section is covered by the section's mark, because `visibleAnswers` reads the section (lifecycle 6.4).
2. **`kinds`, `group`, `sensitivity`, `quick` and `auto` never change after creation.** Medical is a property of the note through its type (D56), and a reader's rights follow `sensitivity`.
3. **An id or a code the server makes (`t_` and a number) is never reused in that note type**, hidden or retired ones included, and a copied section keeps the source's ids only where the target never used them, so a mapping or a report never reads a new meaning under an old key.
4. **A note is read on its own version** (forms 2.6), so what is hidden or retired stays readable in every note that has it.
5. **One master list per field** (`main.md:410`). The database holds resolved definitions, with no list to edit once. So an option operation on a field is also applied to every field of the team's note types that `mapsTo` it, and to the field it maps to; each note type changed gets its next version in the same transaction (section 11, row 17). An `auto` note type is never reached.

Add a note type: a copy of an existing one (a new key, version 1; its `kinds`, `group`, `sensitivity` and marks come with it; `auto` and `quick` types cannot be copied), or a blank one with a title, `kinds` (`medical`, `non_medical` or both: `main.md:952`) and a timeline group. A blank one starts with one section, Notes, holding one text field, Notes, since a definition has no empty lists (forms 2.2; section 11, row 36); the admin then adds or copies sections. A type is Medical exactly when `kinds` is `['medical']` (forms 2.2, D56). Remove and restore follow 5.1 on `note_types.state`, a reason each; a team's own unused note type is archived too (point 4); an active field map that names the type refuses its removal (`referenced`). The `auto` note type cannot be removed (`not_removable`): the server refuses to finish a Medical note without it (lifecycle 3.3). A platform update that changes a note type's fixed field is offered, never taken in place: the admin copies the platform's type instead.

## 6. Sync
### 6.1 What a phone holds, how it gets it, when it leaves
| Data | How it arrives | Held in | Leaves when |
|---|---|---|---|
| Every preset of the team at its current version, archived ones included (for names); never a kind the phone does not use (phase 10's `billing_code_map`) | `GET /v1/presets?since=<revision>&epoch=<epoch>` after each sync that reached the server, at open and on pull to refresh, through `PresetsRefresher`, an `AfterSyncRefresher` made with the team's others in `appRefreshers` (`app_providers.dart`) | Table `presets (kind, id, version, state, origin_key, body_json)` and the `kv` keys `presets.revision` and `presets.epoch` in the team database: an additive step `_v3` in `local_db.dart`, `schemaVersion` 3 | With the team's other server copies: `clearServerData` deletes the `presets` rows and both keys in its one transaction, so they go at every sign-out, Log out anyway included, first thing at the next open of a file marked stale, and whenever the index's expiry or its 403 clears the server copies (the next pull then asks for everything, as no revision is kept). Also on a 403 from `GET /v1/presets`, and with the team database. Never purged by age otherwise: they hold no patient data |
| Note type versions | Phase 4's routes and fetches (D84). An archived type leaves the list | Phase 4's files (`definition_store.dart`) | Phase 4's rule (D84) |
| A patient's flag changes | With the chart, as problems are: the chart answer's `flagChanges`, record snapshots imported with `importServerRecord` and their ids kept in `_chart` as `flagChangeIds`; and its `flags`, the worked-out view with each flag's name, tier, colour and rank as the flag is now (section 7), kept in `_chart`, so the profile draws even where the presets are not held. Also through `/v1/sync/records`. A change made on this phone waits in the outbox | `records` (D30), filed under the patient (`records.patient_id`) | With the chart (the 24-hour cache rule); a change made here, never before its own hash-confirmed receipt |
| Each indexed patient's current flags | The team index (`POST /v1/patients/index`): each entry gains `flags: {primary, secondary[]}`, flag ids worked out by `currentFlags` with the reader's flag rule (6.2), under phase 3's index rules; 0024's trigger moves the index version at every flag change. The projection is `idx1+sens` for a reader who sees sensitive flags, as phase 3 reserved | `team_index` | With the index (D29) |

**The pull.** It answers `{revision, epoch, presets: [{id, kind, state, version, originKey, body}]}`: every head whose `revision > since`, with `revision` the greatest revision among them, read in the same statement (`since` itself when none is sent back). Every write takes the team lock before it takes a revision and holds it to commit (4.2), so once a revision is seen no lower one can commit later. `since` absent means everything. If `since` is greater than the server's revision, or `epoch` is not the server's (a restored database, 4.2), the answer is `{reset: true, …}` with everything, and the phone replaces the table. The phone writes the rows, the revision and the epoch in one local transaction, so a pull cut short is repeated whole. An answer is written only into the team database it was asked for, and only while that database is still the one the controller holds open, not frozen, for the same sign-in; any other answer is dropped, as phase 3's review (P3) made the index's downloads do.

**A team first opened offline** has no presets until it is opened online, as it has no team index (D29): the presets are a server copy of the team database, fetched for the open team. Team setup, the flags sheet and intake's risk level then say "Your team’s setup hasn’t downloaded yet. Connect to finish." (12.1, risk 12).

**The phone's current flags for a patient** are `currentFlags` over the cached chart's flag changes plus this phone's own changes not yet confirmed or held, with the person's flag rule. A held change shows only as "Sent for review", and a refused one only in Needs attention. Names and colours come from the presets, or from the chart's `flags` for a flag the presets do not hold.

### 6.2 The new synced entity: `patient_flag_change`
| Setting | Value |
|---|---|
| Permission | `patients.edit`, for the create and for `enteredInError`. `mayChange`: the mark is the change's author's, or a Program Admin's (`team.manage_users`, as phase 4's assign reads it; section 11, row 24) |
| Parents | The patient (create) |
| Fields | `enteredInError`, `set_once`, a retraction `{reason}` of 3 to 300 characters, as a referral's (`entities/referral.ts:82-83`) |
| Clock pause | `pausesWithClock: true`: changes are ordered by their time, as ID link conflicts are (D35). Intake saves without the risk level while the clock is paused, as it saves without a card's link |
| Outbox category | `patients` |
| Team lock | `takesTeamLock: true`, as for every phase 4 entity (lifecycle 4.2) |
| Audit | `patient_flag.changed` for the create, `patient_flag.entered_in_error` for the mark (section 9) |
| Read | `readNeed`'s default arm (`patients.view`), then the flag rule below |

**The flag rule, one copy.** `flagHidden(permissions, flag)` in `services/api/src/sync/read-rules.ts` (D99) is true when the flag is not one of the team's flags, or is sensitive and the reader's projection does not see sensitive things (`projectionFor`'s `sensitive` in `projection.ts`: `mayViewProblems` and `patients.view_sensitive`, as for a sensitive problem). Beside it, `flagChangeShown(permissions, readerId, change, flag)` answers nothing when the flag is hidden; the change without its reason and its error reason when it is entered in error and the reader is neither its author nor a holder of `team.manage_users`; else the change. `readsRecord` gains a `patient_flag_change` branch that loads the flag head by `flag_id`; `fetchRecords`' `asRead` in `review.ts` gains a case through `flagChangeShown`; `shownChange` gains a case that loads a held create's `flagId`, so a held change whose flag is hidden from the reviewer is neither listed nor accepted by them (D87); `fieldForAnswer` follows `readsRecord`, so a value sent back on a retry holds nothing of a hidden flag (D86). The chart (`projectChart`), the team index, `POST /v1/patients/search` and `POST /v1/patients/{id}/flags` call the same two functions. A hidden flag and every history row of it are absent, its reason included, never blanked.

| Case | Server answer | Mirror in the phone test server |
|---|---|---|
| Valid; the author holds `patients.edit` (checked per entity, D25) | Accepted; receipt with the hash. The same id and hash again is accepted again, as for every entity. `effective_at` is set by the server (4.5) | yes |
| The flag is archived, or archived since | Accepted and kept: an archived flag stays on the patient (5.1) | yes |
| `flag_id` is not a flag of this team (a build fault: the phone offers only flags the server sent) | Refused `validation`, problem `unknown_flag`. The fix is **Choose a flag**: Needs attention opens the gated flags sheet with the refused change's reason shown and editable, and the store sends the refused create again with the flag and reason chosen, through `fixRejected`, once the clock allows, as Choose a patient does (D121). With no active flag of the refused change's tier to choose, the card says "This flag can’t be set on this phone. Tell a Program Admin." and nothing is sent. The rule checks this before the insert, so the foreign key never throws, and reads the flag with `coalesce(body -> 'sensitive' = 'true'::jsonb, false)` and no casts, since a cast error (class 22) would stop the push at every retry (lifecycle 4.1). The queue continues | yes |
| `reason`, trimmed, is empty or over 500 code points | Refused `validation`, problem `reason_invalid`. The fix is **Change the reason**: the same record sent again with the new reason, through `fixRejected`. The sheet cannot send one; the wire schema does not refuse it, since a change the wire schema refuses stays on the phone for good (D51) | yes |
| The patient is unknown to the server yet (intake's risk level among them) | Held as a dependent of the patient create (the existing parent rule) | yes |
| The patient was merged | Stored as sent; reads group by `canonical_id` (D27) | yes |
| The author lacks `patients.edit` (a role lowered while offline) | Held for a Program Admin by `decide` (`services/api/src/sync/apply.ts:504-509`), audited `sync.quarantined` with reason `permission`, as every hold is. Never refused: the worker has nothing to fix | yes |
| The author sets or clears a flag `flagHidden` hides from them (a role lowered while offline; the phone never offers one) | The create's check answers `rejected('permission')`, which `decide` holds (`apply.ts:525-527`), audited `sync.quarantined` | yes |
| A held flag change is rejected, or refused when accepted | Its sender is told: a `flag_change_not_applied` notice naming the change and its patient (`user_notices.patient_id`, 4.5), once per change, with no text, as D89's notices are; the phone lets go of a change once it is held | the notice's shape, yes; the review itself, no (6.3) |
| `enteredInError` set by the author or a Program Admin | Accepted once; a second set gets the `set_once` answer every such field gets. By anyone else: `rejected('permission')`, held | yes |

### 6.3 Rules the phone test server must mirror (`apps/mobile/test/sync/fake_server.dart`, level X)
The fake mirrors `GET /v1/presets` (`since`, the revision of 6.1, `reset` and `epoch`, archived rows included, membership only); every row of 6.2 with the same answers and problems; the chart answer's `flagChanges` and `flags` (the flag rule, archived flags kept, an entered-in-error change's reason shown only to its author and Program Admins); `flagIds` in search; the index entries' `flags`; and the server's `effective_at`. The forms fake (`apps/mobile/test/forms/forms_fake.dart`) learns that an archived key leaves the list while every stored version still serves. Each has a case of the same name in `fake_parity_test.dart` or `fake_reads_test.dart` (lifecycle 4.9). Not mirrored, and said in the fake's header: the installers and platform updates, the admin routes, the review queue.

### 6.4 Records written against an older version
| Record | Stores | When the preset changed or was archived meanwhile |
|---|---|---|
| A note (phase 4) | `note_type_key`, `note_type_version` | It is read, completed and corrected on its own version, always (forms 2.6). The rows stay, so the server never answers `unknown_note_type` for an archived type or an older version. An archived note type leaves the list, so no new note starts on it once a phone has synced; open drafts finish |
| An order or a dispense line (phase 6) | `item_id`, `item_version`; for a lab, the result | Accepted. The count means the same, because the unit is fixed |
| A bundle that was applied (phase 6) | `bundle_id`, `bundle_version`, and its lines as item lines | Accepted. The lines are what count; the bundle is provenance |
| A suggestion from a mapping (phase 6) | `map_id` on the line | Accepted. A map whose path is hidden or whose option is retired no longer fires on notes of the new version, and still fires on notes of an older one |
| A flag change | `flag_id` | Accepted (6.2). An archived flag stays on the patient and in the history (5.1) |

## 7. API routes that only work online
The phone's pull is in `services/api/src/routes/presets.ts`, the admin preset routes in `routes/presets-admin.ts`, the note type routes in `routes/note-types-admin.ts`, and the patient's flag routes in `routes/patients.ts`; each opens `teamScope` as `routes/roles.ts:141` does. "Admin" below means `team.manage_presets`.

- **Every admin route that writes asks for a recent sign-in** (`main.md:600`: "sign-in again for exports and admin actions"): `teamScope(c, deps, {permissions: ['team.manage_presets'], recentAuth: true})`, as every admin write built so far does. A stale sign-in answers 403 `reauth_required`, which is not logged (D98); the portal sends the admin to `/reauth` and back. The reads do not ask.
- **Every write takes a reason**: `reason`, trimmed, 3 to 300 characters, required in the body, stored in `team_preset_events` (4.2), shown in the version history, never in audit details or logs.
- **Every write takes the team lock first** (`lockTeamWrites` as its first statement, D32), then its revision from `takeRevision` (4.2), and audits in the same transaction.
- Every refusal here is shown to the person at a desk who can fix it; none reaches a phone's queue. A refusal for a missing key writes `access.denied` (`auth/context.ts:228-257`).
- Ids in paths are preset ids and note type keys, never a name. `{kind}` and `{key}` are path parameters that are not ids, so the contract's test (`packages/contract/test/spec.test.ts:69-73`) lets each through on these paths only: `{kind}` as the enum of the kinds, `{key}` with 0017's key pattern, which a team's `t_` key fits.

| Route | Key | Request and answer | Refusals | Audit event |
|---|---|---|---|---|
| `GET /v1/presets?since=&epoch=` | active membership | `{revision, epoch, presets[]}` or `{reset: true, …}` (6.1), never a `billing_code_map`. Names no patient. Runs the installer first (5.2) | not a member: 403 | none (section 11, row 9); `preset.platform_installed` when the installer wrote |
| `GET /v1/admin/presets/{kind}` | Admin | `[{id, name, state, version, customized, updateOnOffer, updateChangesFixed, referencedBy, body}]` | 403 | none |
| `POST /v1/admin/presets/{kind}` | Admin, recent sign-in | `{body, reason}` gives 201 `{id, version: 1, revision}` | 422 `invalid` with paths (`sensitive_path` among them); 409 `name_taken`, `reference_archived` | `preset.created` |
| `PUT /v1/admin/presets/{kind}/{id}` | Admin, recent sign-in | `{baseVersion, body, reason}` gives `{version, revision}` | 409 `stale` with `currentVersion`, `archived`; 422 `invalid`, `fixed_field`, `no_change` | `preset.updated` |
| `POST /v1/admin/presets/{kind}/{id}/archive` | Admin, recent sign-in | `{baseVersion, reason}` gives `{revision}` | 409 `referenced` with counts by kind, `stale`, `not_removable` | `preset.archived` |
| `POST /v1/admin/presets/{kind}/{id}/restore` | Admin, recent sign-in | `{reason}` gives `{revision}` | 409 `name_taken`, `reference_archived` | `preset.restored` |
| `POST /v1/admin/presets/{kind}/{id}/take-update` | Admin, recent sign-in | `{baseVersion, reason, asNew}` gives `{id, version, revision}`; with `asNew` the platform body becomes a new preset and the old one is archived (5.1) | 409 `stale`, `no_update`, `fixed_field` (without `asNew`), `referenced` (with it) | `preset.platform_update_taken` |
| `GET /v1/admin/presets/{kind}/{id}/history` | Admin | `[{act, version, source, by, at, reason, body}]`: every event of 4.2, with the body of each version | 404 | none |
| `POST /v1/admin/preset-order/flag` | Admin, recent sign-in | `{tier, ids, reason}` gives `{changed}` | 422 `ids_mismatch` unless `ids` is exactly the tier's active flags | `preset.reordered` |
| `GET /v1/admin/note-types` | Admin | heads with the current resolved definition and, for each section, field and option, whether it is protected (5.4). The portal reads definitions only here (forms 3.5) | 403 | none |
| `POST /v1/admin/note-types` | Admin, recent sign-in | `{title, copyOf, reason}` or `{title, kinds, group, reason}`, `kinds` one or both of `medical` and `non_medical`, gives 201 `{key, version: 1}` | 409 `name_taken`; 404 `copyOf`; 422 `not_copyable` | `note_type.created` |
| `PUT /v1/admin/note-types/{key}` | Admin, recent sign-in | `{baseVersion, ops, reason}` gives `{version, alsoPublished: keys}` | 409 `stale`, `archived`; 422 `{opIndex, code}`, or `invalid` from phase 4's validator and version rules | `note_type.published`, one per type |
| `POST /v1/admin/note-types/{key}/archive`, `/restore`, `/take-update` | Admin, recent sign-in | as for presets, each with `reason` | as for presets | `note_type.archived`, `.restored`, `.platform_update_taken` |
| `GET /v1/forms/note-types` (phase 4's, forms 3.3) | as today | lists only keys whose `note_types.state` is `active`; `/{key}/{version}` still serves every stored version | as today | as today |
| `POST /v1/patients/{id}/flags` | `patients.view` and `patients.edit`; the flag must not be one `flagHidden` hides from the caller | `{id, flagId, action, reason}` gives 201 `{id}`. `id` is made once per form by the page, so a retry after a dropped connection gets the first answer, not a second history row (D115) | 404 patient; 422 `unknown_flag`, `reason_invalid`; 409 `archived` for a set of an archived flag (a clear is allowed, 5.1); a hidden flag: 403, logged `access.denied` with the permission and the patient (D98 as amended) | `patient_flag.changed` |
| `POST /v1/patients/{id}/flag-changes/{changeId}/entered-in-error` | `patients.edit`; the change's author or a holder of `team.manage_users` | `{reason}` gives `{version}` | 404; 409 `already_marked`; 403, logged `access.denied` | `patient_flag.entered_in_error` |
| `POST /v1/patients/search` (exists) gains `flagIds` (`PatientSearch`, `services/api/src/patients/schemas.ts:293-317`) | as today | filters by current flags, both tiers (`main.md:120`), in the request's body, never the address | a flag id `flagHidden` hides from the caller: 403, logged `access.denied` | the existing search event, plus the count of flag ids |
| `POST /v1/patients/index` (exists) | as today | each entry gains `flags` (6.1) | as today | as today |

The flag routes and the sync entity share one function that checks a change (`unknown_flag`, the kind, the reason, the flag rule) and inserts it with its audit event, so the online and offline paths cannot drift (D99's reason). The chart answer gains, in `charts.ts` `loadGroupCharts` (`PatientChart` in `schemas.ts`), beside phase 4's `timeline` and `recentVisits`:

- `flagChanges`: the group's flag changes as record snapshots, for the phone (6.1).
- `flags: {primary, secondary[], history[]}`, worked out on the server by `currentFlags`, so the portal holds no rule of its own (D114). Each flag is `{flagId, name, tier, color, colorName, rank, archived}` as the flag is now. Each history row is `{changeId, flagId, name, tier, action, effectiveAt, authorName, reason, enteredInError: {byName, at, reason} or null}`.
- On each problem, `statusCheckDue` (`problemCheckDue` with the team's window, 5.3).

`projectChart` removes from both what `flagHidden` and `flagChangeShown` hide: a hidden flag and every history row of it are absent, never blanked, and an entered-in-error row keeps its reasons only for its author and Program Admins.

## 8. Screens
Every screen passes the accessibility checks in Day, Night run and High contrast and reflows at 320 px, and every phone screen is tested offline. A flag is never shown by colour alone: its pill reads "Red · High", the colour's name and then the flag's (`main.md:945`).

### 8.1 Portal, under `/team/presets` (in the nav, `(app)/layout.tsx`, only with `team.manage_presets`; the server refuses a typed URL)
On every page that writes:

- **A Reason box**, required, 3 to 300 characters, `autoComplete="off"`, with "Don’t put patient names here." under it, as under every free-text box.
- A write answered `reauth_required` sends the admin to `/reauth` and back to the page.
- Forms post through server actions in `apps/portal/src/app/actions/presets-<area>.ts`, their fields drawn by components, as phase 3's pages do; the refusal sentences join `apps/portal/src/lib/refusals.ts`. The note type editor holds operations not yet sent until Publish, which a re-render would lose, so it is a client component whose Publish posts to a route handler (D115).

| Page | Shows | States and wording |
|---|---|---|
| `/team/presets` | One card per area with its count and an "Update available" badge | Loading; error |
| `/categories` | OTC, Rx, Labs and the team's own (`main.md:104`); add with name and what it holds (Supplies, Medications, Tests) | "What it holds can’t be changed later." |
| `/items`, `/items/[id]` | Items grouped by category, A–Z, with a search box; form: Name, Category, Counted in, Medical, Capture lot and expiry, Result (for Labs) | Under Counted in: "1 means one of these, for example 1 tablet or 1 packet. This can’t be changed later." (`main.md:127`) |
| `/bundles`, `/bundles/[id]` | Name, Medical or Non-Medical, lines with item, quantity and Core (`main.md:441`, `:447`), and Ask before applying, the prompt (`main.md:445`) | Refusal: "This bundle holds a medication, so it must be Medical." Under the prompt: "Asked before the bundle is used, so a bundle never stands in for an assessment." |
| `/flags`, `/flags/[id]` | Two lists: Risk level (primary; Red · High, Yellow · Medium, Green · Low by default, highest risk first) and Conditions (secondary). Move up, Move down, Add, criteria text, colour, Sensitive (`main.md:316-318`) | "Sensitive flags are hidden from Billing and Data. Whether a flag is sensitive can’t be changed later." On Remove: "Patients who have this flag keep it until someone clears it." |
| `/field-supplies` | Note type, then a field and the answer, or Every note of this type; items and quantities (`main.md:424-431`, `:470`) | Hint: "Map the answer that means something was given, not the question that asks about it." Warning row when the field is hidden or the option retired. Refusal for `sensitive_path`: "Only some people may read this answer, so it can’t suggest supplies." |
| `/condition-supplies` | Condition codes, items, quantity per patient; "Check problems not updated in [90] days" (`main.md:476`) | |
| `/bag-minimums` | The page name is the PRD's (`main.md:477`): a switch for the team, the template for new bags, each bag with its minimums, Add bag. Add bag fills the new bag's minimums from the template, or from a bag chosen under Copy from (`main.md:930`), and the server stores what is sent | "Bag minimums are off. Nobody is reminded to restock." |
| `/note-types`, `/note-types/[key]` | List with Use as is, Edit, Remove, Add. Add asks for a note type to copy, or for Medical, Non-Medical or both and a timeline group (`main.md:952`). The editor lists sections, fields and options with Hide, Show again, Rename, Retire, Add, and Copy a section (from a platform note type or another of the team's); Publish | Protected rows say "This part can’t be changed." A note type can’t change between Medical and Non-Medical: "Add a new note type instead." A section that can't be copied: "This section comes from a note type for other visits or other readers, so it can’t be copied here." After Publish: "Version 4 is live. Notes already started stay on the version they began on." |

Shared on every page: the Removed list with Restore; the history (who, when, platform or team, and the reason); the update offer "Sineobex updated this preset. Your edited copy hasn’t changed." with Review and Replace with the new version; an update that changes what can't be changed in place: "This update changes something that can’t be changed here. Add it as a new one: this one is removed, and kept in the history." with Add as new; the stale refusal "Someone else changed this while you were editing. Reload to see their version."; and the referenced refusal "Still used by 2 bundles and 1 mapping. Take it out of those first."

**The patient page** (`patients/[patientId]/page.tsx`): its header (`components/PatientHeader.tsx`) shows the primary pill and the secondary pills; an archived flag's pill adds "No longer on the team’s list". A Flags panel lists the history (flag, set or cleared, who, when, why; a change entered in error says so, with who and when, and only its author and Program Admins see its reasons) and has a form: flag, reason (required, `autoComplete="off"`), Save. Save posts to a route handler with an id made once per form (D115); an archived flag is offered only to clear. The change's author and a Program Admin see Entered in error, which asks for a reason. The problem list marks "Status check due" on each problem the chart answers `statusCheckDue` for. The patient search (`SearchForm.tsx`) gains Risk level and Conditions as fields of its existing POST form, so neither reaches the address. Sensitive flags are absent for a reader the flag rule hides them from. Each presets page's test and the patient page's test check that nothing is stored in the browser (`expectNothingStored`) and that addresses carry only ids (as `attestation.spec.ts`'s `expectOnlyIds` does), and every new page joins the sweep in `e2e/a11y.spec.ts`.

### 8.2 Phone
| Screen | Shows | States |
|---|---|---|
| Team setup (a row on Home, `home_screen.dart`, below phase 4's tiles, with its own route; read only; names no patient, so opening it audits nothing) | Orders items by category, bundles with their lines, flags by tier, "Updated 10:42" | Not downloaded yet (6.1); offline shows the held copy |
| The patient profile's header (`patient_screen.dart`, lifecycle 9.1) | The primary pill and the secondary pills, beside phase 4's quick actions. Names and colours from the presets, else the chart's `flags` (6.1); an archived flag adds "No longer on the team’s list" | No flags: nothing shown. A change of this phone's held for review: "Sent for review" |
| Change flags sheet (`features/patients/flag_sheet.dart`) | Risk level (one, or None) and Conditions (several); the history (flag, set or cleared, who, when, why); a reason box, required; Save. Entered in error on a change of the person's own | Opened through `SheetGate.patients` (D125), its choosers through `DialogGate`; the reason box is a `PrivateBox` (D126). Works offline. Shown only with `patients.edit`. Save is disabled until a reason is typed. A sensitive flag is listed only where the flag rule lets the person see it; an archived flag only when the patient carries it, and only to clear. Save announces "Flags saved." in a live region keyed to each press and returns focus to the flags row. While the clock is paused (D35) Save is off and the sheet says "Flags can be changed once the phone’s clock is right." Once the store freezes, nothing of the sheet is drawn, and what was typed goes with it |
| Intake (phase 3's `intake_screen.dart`; a new patient only, not Edit) | Risk level, optional, None by default; once one is picked, a Reason box, required (`PrivateBox`). Conditions are not offered | Saved with the patient, in `createPatient`'s transaction, as a flag change whose parent is the patient create. Where the presets are not held the row says "Your team’s setup hasn’t downloaded yet. Connect to finish."; while the clock is paused, "A risk level can be set once the phone’s clock is right.", as the card's sentence does; either way the patient saves without one |
| Patients (`patients_screen.dart`) | Each index row shows its primary pill; Risk level and Conditions filters, offline, from the index (6.1) | No flags: nothing shown |
| Problems (the profile's list and `problem_screen.dart`) | "Status check due" beside a New or Ongoing problem not checked within the team's window (`problemCheckDue`, offline from the settings preset) | Nothing where the presets are not held |
| Needs attention (lifecycle 9.13) | `sync_labels.dart` gains: `unknown_flag`, "This flag isn’t on your team’s list. Choose a flag.", button Choose a flag, or, with no flag of its tier to choose, "This flag can’t be set on this phone. Tell a Program Admin."; `reason_invalid`, "The reason is empty or too long. Change the reason.", button Change the reason; the notice `flag_change_not_applied`, "A flag you set wasn’t applied. Open the patient to set it again.", button Open patient | A held change shows "Sent for review", as phase 4's do. Once the store freezes, only how many changes are on the phone (D125) |

The sheet, intake and Needs attention write through one domain class, `apps/mobile/lib/patients/flags.dart`, never the store: recording a change (through `createRecord`, refused while the store is frozen or the clock paused), the patient's current flags (6.1), marking one entered in error, and the two fixes (through `fixRejected`).

## 9. Audit events and the PHI rules
| Event | Entity, id | Details |
|---|---|---|
| `preset.created`, `.updated`, `.archived`, `.restored`, `.platform_update_taken` | `preset`, preset id | `kind`, `version`, `revision`, changed top-level field names; never a value, never the reason |
| `preset.reordered` | `preset`, none | `tier`, count changed |
| `preset.platform_installed` | `team`, team id | counts of `install`, `update`, `offer` and skipped entries, by kind; the member whose request ran the installer is the actor, as for phase 4's `forms.presets_installed`, which note types keep |
| `note_type.created`, `.published`, `.archived`, `.restored`, `.platform_update_taken` | `note_type`, key | `version`, operation names and count; never the reason |
| `patient_flag.changed` | `patient_flag_change`, the change's id, with the patient | `action`, `tier`, and the flag id only when the flag is not sensitive; never the reason. Written in the change's transaction, from a push and from the route |
| `patient_flag.entered_in_error` | `patient_flag_change`, the change's id, with the patient | `tier`, and the flag id only when the flag is not sensitive; never a reason |
| `sync.quarantined` | as today | a held flag change, reason `permission`, as every hold (6.2) |
| `access.denied` | as today | permission and route; for a flag route refused over a hidden flag, the permission and the patient (D98 as amended) |

A stale sign-in (`reauth_required`) is not logged (D98).

- A flag id names its flag to every member, through `GET /v1/presets`, and the audit chain cannot be redacted (D41); a reader of the audit log need not hold `patients.view_sensitive`. So a change of a sensitive flag is logged without its flag id, as phase 3's `problem.created` carries no code.
- Preset bodies and reasons are admin text, not patient data, but an admin can type anything. Audit details carry field names and counts only. A preset's reason lives only in `team_preset_events`. The portal warns under every free-text box (8.1).
- A flag change's reason, and an entered-in-error reason, is patient detail. It lives in `patient_flag_changes`, in `field_history` (`storeCreate` writes every created field there), in `quarantine_items` while a change is held, and in the phone's encrypted store. It is never in audit details, logs, notices, URLs or page titles, and an entered-in-error change's reasons are shown only to its author and Program Admins (6.2).
- A sensitive flag on a patient is a sensitive detail (`main.md:121`), hidden by the one flag rule (6.2) wherever it is read: the sync read, the review queue, a value sent back, the chart, the team index and search.
- Team setup, `GET /v1/presets` and the note type routes name no patient, so none writes a patient into the audit log (as phase 4's Home counts). The phone's `presets` table and its two keys hold no patient data and nothing derived from a legal name (D40). The installers log counts, never a preset's key.
- Platform and seed presets pass the PHI guard, which reads `packages/presets/` as a fixture tree as it reads `packages/forms/` (`tools/phi-guard-rules.mjs`); demo additions start "Demo:".
- A reason and a search by flag travel in POST bodies.

## 10. Tests
### 10.1 The Done when
One shared story, `packages/contract/test-vectors/presets-done-when.json`, written before any test that walks it, gives the steps and the names. It runs as `services/api/test/presets-done-when.test.ts` (steps 2 to 5), `apps/mobile/test/presets/done_when_presets_test.dart` (steps 1, 6, 7 and 8, against the fake), `live_presets_test.dart` (steps 1 to 8 against the real API, in `tools/live-sync.sh`, under the lock), a run of steps 7 and 8 on the screens in the three themes and at 200% text, and the portal's `apps/portal/e2e/presets.spec.ts`.

| Step | Asserts |
|---|---|
| 1. A phone signs in, syncs, then goes offline | It holds the platform presets and revision R |
| 2. A Program Admin, signed in within the last 15 minutes, adds the item "Demo: Glucose test" in Labs, counted in "test", result a number in mg/dL, with a reason | 201, version 1; `preset.created` in the same transaction, without the reason; the reason in `team_preset_events`; revision R+1 |
| 3 and 4. The admin adds the bundle "Demo: Foot check" with that item as a core line, then the secondary flag "Demo: Frost risk", each with a reason | 201 each; revision R+2, then R+3 |
| 5. A Healthcare Staff member tries step 2; then the admin tries it with a sign-in older than 15 minutes | 403 with `access.denied` written; then 403 `reauth_required`, not logged; the revision unchanged |
| 6. The phone comes online and syncs | One pull with `since=R` returns exactly the three; the phone holds revision R+3 |
| 7. The phone goes offline; Team setup is opened | The Labs item under Labs, the bundle with its line, the flag under Conditions |
| 8. Still offline, staff set "Demo: Frost risk" on a made-up patient with a reason; then sync | Accepted with a hash-matched receipt; the portal's chart shows the flag; `patient_flag.changed` carries no reason |

The portal's half adds the three through the pages, then asks `GET /v1/presets?since=R` as a phone member would and finds exactly the three, by the names in the story, so what the portal adds is what a phone's pull returns (`build-plan.md:91`). Step 8's portal check, the flag on the patient page, reads the same story in the patient page's spec.

### 10.2 The test that holds each rule (each is checked to bite: the rule is removed by a script and its test must fail)
| Rule | Test |
|---|---|
| Shapes, validation (`sensitive_path`, grid cells and whole-note maps among them), write effects, platform updates, current flags, suggestions, note type edits, the status check | The vector files of 5.3, read by Vitest and by `flutter test` |
| The platform data is valid: every entry passes its schema and `validatePreset`, every `originKey` it names exists, names are unique per kind, a fixed-field change is reported | `packages/presets/test/platform-data.test.ts` |
| Versions and events are append-only; no delete; team isolation; a flag change is changed only by its one mark, once | `db/test`: update and delete as the app role fail; a second team sees nothing; the guard trigger refuses any other update |
| The revision is taken by one function, under the team lock: it moves once per write, with no gap, under two writers at once; a writer that commits between a pull's two reads is never skipped; an install and a publish of one key at once never collide; every write audits in its transaction (a failed audit rolls the write back) | `db/test/preset-revision.test.ts` (its lock is `append_audit`'s), `presets-revision.test.ts`, `presets-audit.test.ts` |
| Every admin route refuses without `team.manage_presets` and logs it; every admin write refuses a stale sign-in with `reauth_required` and logs nothing | the `ROUTES` table of `services/api/test/permissions.test.ts`, one row per route; a stale-sign-in case per write route |
| Every write needs a reason, keeps it in `team_preset_events`, shows it in the history and never puts it in audit details | `presets-routes.test.ts` |
| A platform update never overwrites an edited or archived copy, and never changes a fixed field; the installer is idempotent, leaves a second team alone, and plans again under the lock | `db/test/install-team-presets.test.ts`: install, skip, update, offer; edit, raise the platform version, install, compare bodies |
| The note type installer as changed: a team's version 2, then platform versions 2 and 3, installed twice: nothing thrown, no row added, `platform_latest` 3; every row any path writes passes `definitionFor` | `packages/forms/test/install-update.test.ts`, `db/test/install-presets.test.ts` |
| A fixed field cannot change; a referenced preset cannot be archived; every body's ids point at presets of the same team; a bag made from the template or from another bag holds those minimums | `presets-routes.test.ts`; `presets-refs.test.ts` (a walk over all kinds) |
| A draft begun on version 1 completes, and is later corrected, on version 1 after version 2 is published; another phone can open it; after a publish, `definitionFor(team, key, newVersion)` answers the definition and a note created on it is accepted; an archived type leaves the list and its drafts finish | `note-type-versions.test.ts`; phone `note_type_version_test.dart` |
| No operation changes a mark, `kinds`, `group` or `sensitivity`; a protected part cannot be hidden or reworded, also when an option operation reaches it through `mapsTo`; a copied section keeps its marks and is refused from a type of other kinds, group, sensitivity or flags; no id or code is reused; every result passes phase 4's validator, version rules, the JSON Schema check and the phone's reader; what `visibleAnswers` gives each reader of forms 7.1 is the same before and after any edit | `note-type-edit.json`, one case per mark; `packages/forms/test/edit.test.ts`; `note-types-admin.test.ts` |
| Every route that writes takes the team lock first | `presets-revision.test.ts` (two writers); `patients-flags-route.test.ts` |
| A flag change is never refused for what its sender cannot fix: a lowered role is held, a hidden flag is held, an unknown flag is settled by Choose a flag, a bad reason by Change the reason; a held change that will not apply tells its sender | `sync-flag-change.test.ts`; `fake_parity_test.dart`; the phone's Needs attention test |
| A clear takes off only the flag it names; a change's time is never later than its receipt; a change entered in error drops out of the current flags, and its reasons reach only its author and Program Admins; an archived flag stays | `flag-current.json`; `sync-flag-change.test.ts` |
| Two phones offline flag the same patient: both changes kept; a clear of another flag takes nothing off | `sync_scenarios_test.dart`, new scenario |
| A sensitive flag never reaches a reader the flag rule hides it from: the sync read, the review queue (neither listed nor accepted), the value sent back on a retry, the chart, the team index, search and the flag route | `patients-flags-sensitive.test.ts` |
| A flag set on another phone appears after one index refresh; a sensitive one is missing from the index of a reader without it | `patients-index.test.ts`; the phone's index test |
| A pull cut short leaves the old copy whole; `reset` and a new epoch replace it; `clearServerData` deletes the presets and both keys, so the next pull has no `since`; a sign-out that keeps work leaves no presets; an answer arriving after a sign-out or a team switch writes nothing | `presets_refresher_test.dart`; `local_store` tests |
| A version 2 database file keeps its work through `_v3` | `local_db_test.dart` |
| Screens | Playwright with axe in the three themes and at 320 px for each page, `expectNothingStored` and the address check, and the sweep in `e2e/a11y.spec.ts`; phone widget tests in the three themes, at 200% text and at 320 px, offline, and for roles without `patients.edit` or without sight of sensitive flags; the flags sheet with the store frozen while it is open draws nothing; `test/security/dialog_gates_test.dart` passes with the new sheets |

## 11. Defaults chosen (PLAN-OPEN) and questions for people
| # | Question the PRD leaves open | Default | Who decides |
|---|---|---|---|
| 1 | Is an unused preset deleted or archived? | Always archived: one rule, and a platform update can’t bring it back | Project lead |
| 2 | Can an item’s unit change later? | No. Archive and add a new item, so old counts keep their meaning | Brooke and Mercy |
| 3 | Which category holds gauze and kits? | A fourth platform category, Supplies | Brooke and Mercy |
| 4 | What can a Labs result be? | A choice from a list, or a number with a unit | Brooke and Mercy |
| 5 | Which flags ship? | Primary: Red, Yellow, Green. Secondary: the six suggested criteria of `main.md:319`, plus Pregnancy (sensitive) | Brooke and Mercy |
| 6 | Are criteria rules the app runs, or text for people? | Text. Nothing flags a patient automatically in V1 | Brooke and Mercy |
| 7 | Which colours can a flag have? | Eight named colours that pass contrast in all three themes; no free colour picker | The team |
| 8 | Who may flag a patient? Must clearing give a reason? | `patients.edit`; yes | Brooke and Mercy |
| 9 | Is reading presets audited, and who may read? | Any active member; not audited, as it shows no patient | Counsel |
| 10 | Do preset writes need a recent sign-in, as user changes do? | No | Project lead |
| 11 | Does a draft move to a new note type version? | No. It stays on the version it began on | Brooke and Mercy |
| 12 | Which fields may be mapped to supplies? | Any choice, yes or no, or number field; the platform’s own mappings use action fields only | Brooke and Mercy |
| 13 | Does a condition mapping match a code family (L30 and all below it)? | No, exact codes only | Brooke and Mercy |
| 14 | Are bags defined in this phase? | Yes: a name and minimums. Phase 6 adds stock and owners | Project lead |
| 15 | Naloxone and safer-use supplies: Medical or not? | The item’s `medical` switch (`IMPLEMENTATION_PLAN.md:207`) | Brooke and Mercy |
| 16 | Is flagging patients part of this phase? | Yes (unit P5). It can move to the start of phase 7 without touching units P0 to P4 | Project lead |
| 17 | How does a team's edit keep "one master list per field" (`main.md:410`) when stored definitions have no lists? | An option edit follows `mapsTo` between the quick form and the full modules (5.4, rule 5). Other fields that shared a list are edited one by one | Project lead; Brooke and Mercy |
| 18 | May an admin hide a required field, a consent or chaperone field, or anything in the Red flags note? May an edit change who may read a section? | No to both: these parts are protected and no operation writes a mark (5.4). A note type never changes between Medical and Non-Medical, nor its timeline group or sensitivity; add a new one (D56) | Brooke and Mercy; counsel |
| 19 | A flag change from someone whose role was lowered while offline | Held for a Program Admin, never refused (D59) | Project lead |

Questions with no default; each blocks only the card named:

1. The contents of the 18 platform bundles and the starter item list (`main.md:439` gives names only). Brooke and Mercy. Blocks card P0-data-catalog; until then it ships the items the PRD names.
2. Which field in each note type is the action field for the default mappings (`main.md:431`). Brooke and Mercy. Blocks card P0-data-maps.
3. Whether a flag about substance use falls under 42 CFR Part 2 (`main.md:435`). Counsel. Until answered the platform ships no such flag.

## 12. Risks and departures from the PRD
### 12.1 Risks
1. **Ids inside a JSON body have no foreign key.** Only the API checks them. `presets-refs.test.ts` walks every body, and `referenced` stops an archive from leaving a dangling id.
2. **Phase 4 is designed, not built.** Unit P4 and cards P0-data-maps, P2-setup-screen and P5-phone-sheet depend on what section 2 lists. If the build changes a mark, the validator or `installPresets`, unit P4 is checked again; units P0 to P3 do not depend on them.
3. **Body shapes will grow.** A new field must be optional with a default in both parsers. A phone skips a kind it does not know and ignores a field it does not know (pinned in `preset-bodies.json`).
4. **A phone offline for days works from old presets.** By design (decision 6). Team setup shows when the copy was last updated.
5. **The fake can drift from the API** (plan risk 7). Every row of 6.2 and 6.3 is a parity case.
6. **A custom role may lack the key the PRD implies.** The standard Logistics role holds `patients.view_sensitive` (`0002_identity_access.sql:90-92`), so it sees a pregnancy flag as `main.md:121` says. A custom role without the key does not; the design keeps to the key.
7. **An admin can type a patient’s name into criteria or a bag name.** The hint is the only guard; audit details never carry the text.
8. **One option edit can publish several note types at once** (5.4, rule 5). One transaction, one audit event per type, one revision step.
9. **A team's edit is the one place a definition is not checked against the specification by machine** (D64). The fixed operations, the protected parts and phase 4's validator are the defence; the edit vectors hold one case per mark.

### 12.2 Departures and readings
- "Archived rather than deleted" applies to used note types (`main.md:387`); this design archives everything (decision 4). "Edit" a note type is read as the operations of 5.4, not a free form builder. A protected part stays (`main.md:409`, `:415`). Phase 4 lets a new platform version remove anything (forms 2.6); a team's edit may remove less.
- "Remove" a bundle (`main.md:128`) is refused while a mapping or another preset points at it; the admin removes those first.
- Bags are defined here though shared bags are phase 6 (`build-plan.md:95`), because bag minimums need a bag to hang on.
- `patients.priority_flag_key` (`0009_patients.sql:58`) is left unused. Flags are worked out from changes, so there is no value two phones could overwrite. The commit that lands unit P5 corrects the comment in a new migration, not in 0009.
- The build plan lists flags as configuration only. This design also lets staff flag a patient (default 16), because a flag nobody can set is not visible to anyone.
- Mappings fire "on the action field" (`main.md:431`); the app cannot tell which field that is, so it is guidance on the page plus the platform’s own choices.

## 13. Units and first card list
Units: P0 schema and core rules, P1 API, P2 phone cache, P3 portal presets, P4 note type editing, P5 flags on patients, P6 the Done when and the close. The names share nothing with phase 4's units (F, E, L). A card's ID is its unit and a short name. Each unit with T cards has one `tests` card (level X) that writes those cards' test files and vectors first. P0 lands first, alone, with CI green. Then P1. Then P2 and P3 together. P4 after P1 and phase 4's F3. P5 after P1, P2 and phase 4's L2 and L5. P6 last. Levels follow `docs/plan/README.md`: an always-X path is X, a screen or a page is R, and S is kept for a card whose every mistake a machine check catches. A contract card regenerates the contract after its unit's routes. Files phase 4 also edits, phase 4's cards first: `api/app.ts`, `api/routes/owner.ts`, `db/seed/seed.ts`, `api-test/permissions.test.ts`, `forms/src/install.ts`, `api/forms/definitions.ts`, `api/patients/projection.ts` and `schemas.ts`, the fake, `home_screen.dart`, `patient_screen.dart`, `chart_cache.dart`, `sync_labels.dart`, the generated contract. Short paths: `api/` is `services/api/src/`, `api-test/` is `services/api/test/`, `phone/` is `apps/mobile/lib/`, `phone-test/` is `apps/mobile/test/`, `forms/` is `packages/forms/`, `presets/` is `packages/presets/`, `vectors/` is `packages/contract/test-vectors/`, `portal/` is `apps/portal/src/app/(app)/team/presets/`, `parts/` is `apps/portal/src/components/presets/`.

| Card | Level | Files | Needs |
|---|---|---|---|
| P0-migration | X | `db/migrations/0022_team_presets.sql`, `db/test/team-presets.test.ts` | phase 4's F3-migration |
| P0-package | R | `presets/package.json`, `presets/tsconfig.json`, `pnpm-lock.yaml` | — |
| P0-tests | X | `vectors/{preset-bodies,preset-validate,preset-rules,platform-update,supply-suggest}.json`, their readers under `presets/test/`, `presets/test/install.test.ts` | P0-package |
| P0-schemas-catalog | T | `presets/src/schemas.ts` (category, item, bundle) | P0-tests |
| P0-schemas-rest | T | `presets/src/schemas.ts` (flag, both mappings, bag, settings) | P0-schemas-catalog |
| P0-validate | T | `presets/src/validate.ts` | P0-schemas-rest |
| P0-rules | T | `presets/src/rules.ts` (`presetWriteEffect`, `reorderRanks`) | P0-schemas-catalog |
| P0-platform | T | `presets/src/platform.ts` | P0-tests |
| P0-supplies | T | `presets/src/supplies.ts` (`suggestSupplies`, `bundleLines`) | P0-schemas-rest |
| P0-data-catalog | R | `presets/data/platform.json` (categories, flags, settings, starter items, 18 bundles) | P0-validate; question 1 |
| P0-data-maps | R | `presets/data/platform.json` (default mappings) | P0-data-catalog; question 2; phase 4's F6 |
| P0-install | T | `presets/src/install.ts`, `api/routes/owner.ts`, `db/seed/seed.ts` | P0-migration, P0-platform, P0-data-catalog |
| P1-tests | X | `api-test/presets-{store,pull,routes,revision,audit,install,refs}.test.ts` | P0 |
| P1-store | T | `api/presets/store.ts` (load refs, write a version, bump the revision after the team lock) | P1-tests |
| P1-pull | T | `api/routes/presets.ts`, `api/app.ts` (the register line) | P1-store |
| P1-create | T | `api/routes/presets.ts` (admin list and create) | P1-store |
| P1-edit | T | `api/routes/presets.ts` | P1-create |
| P1-archive | T | `api/routes/presets.ts`, `api/presets/store.ts` (archive, restore) | P1-create |
| P1-update | T | `api/routes/presets.ts` (take update, versions) | P1-edit |
| P1-order | T | `api/routes/presets.ts` (flag order) | P1-edit |
| P1-permissions | R | `api-test/permissions.test.ts` | the route cards above |
| P1-contract | S | The generated contract | P1-permissions |
| P1-seed | S | `db/seed/demo-presets.ts`, `db/seed/seed.ts` (recipe `seed-data.md`; the PHI guard checks it) | P1-create |
| P2-tests | X | `phone-test/presets/{models,preset_store,presets_refresher,supplies}_test.dart` | P1-contract |
| P2-local-db | X | `phone/sync/local_db.dart` (the `presets` table) | P1-contract |
| P2-fake | X | `phone-test/sync/fake_server.dart`, `fake_parity_test.dart` (`GET /v1/presets`) | P1-contract |
| P2-models | T | `phone/presets/models.dart` | P2-tests |
| P2-store | T | `phone/presets/preset_store.dart`, `presets_refresher.dart`, `phone/patients/patient_providers.dart` | P2-local-db, P2-fake, P2-models |
| P2-supplies | T | `phone/presets/supplies.dart` | P2-models, P0-supplies |
| P2-setup-screen | R | `phone/features/presets/team_setup_screen.dart`, `phone/features/home/home_screen.dart`, their widget test | P2-store |
| P3-hub | R | `portal/page.tsx`, `(app)/layout.tsx`, `apps/portal/src/lib/presets.ts` | P1-contract |
| P3-parts | R | `parts/ItemLines.tsx`, `RemovedList.tsx`, `refusals.ts` | P3-hub |
| P3-categories | R | `portal/categories/page.tsx`, `actions.ts` | P3-parts |
| P3-items | R | `portal/items/page.tsx`, `actions.ts` | P3-categories |
| P3-item-edit | R | `portal/items/[id]/page.tsx` | P3-items |
| P3-bundles | R | `portal/bundles/page.tsx`, `actions.ts` | P3-items |
| P3-bundle-edit | R | `portal/bundles/[id]/page.tsx` | P3-bundles |
| P3-flags | R | `portal/flags/page.tsx`, `actions.ts` (Move up, Move down) | P3-parts |
| P3-flag-edit | R | `portal/flags/[id]/page.tsx` | P3-flags |
| P3-field-supplies | R | `portal/field-supplies/page.tsx`, `actions.ts` | P3-items; phase 4's F3 |
| P3-condition-supplies | R | `portal/condition-supplies/page.tsx`, `actions.ts` | P3-items |
| P3-bag-minimums | R | `portal/bag-minimums/page.tsx`, `actions.ts` | P3-items |
| P3-history | R | `parts/UpdateOffer.tsx`, `VersionHistory.tsx` | P3-parts |
| P3-e2e | R | `apps/portal/e2e/presets.spec.ts` (the portal half of the Done when, with axe) | P3-items, P3-bundles, P3-flags |
| P4-tests | X | `vectors/note-type-edit.json`, `forms/test/{edit,install-update}.test.ts`, `api-test/{note-types-admin,note-type-versions}.test.ts`, `phone-test/forms/note_type_version_test.dart` | phase 4's F3 and L1; P1-store |
| P4-edit-basic | T | `forms/src/edit.ts` (rename, hide and show, relabel, the protected rule) | P4-tests |
| P4-edit-options | T | `forms/src/edit-options.ts` | P4-edit-basic |
| P4-edit-add | T | `forms/src/edit-add.ts` | P4-edit-basic |
| P4-install | T | `forms/src/install.ts` (5.2: `platformUpdateEffect`, `preset_version`, `platform_latest`) | P4-tests, P0-platform |
| P4-offered | T | `api/forms/definitions.ts` (the list reads `note_types`) | P4-tests |
| P4-publish | T | `api/presets/note-types.ts`, `api/routes/note-types-admin.ts`, `api/app.ts` (list, publish, the `mapsTo` fan-out) | P4-edit-options, P4-edit-add |
| P4-lifecycle | T | `api/presets/note-types.ts`, `api/routes/note-types-admin.ts` (add, archive, restore, take update) | P4-publish, P4-install |
| P4-permissions | R | `api-test/permissions.test.ts` | P4-lifecycle |
| P4-contract | S | The generated contract | P4-permissions |
| P4-list-page | R | `portal/note-types/page.tsx`, `actions.ts` | P4-contract, P3-parts |
| P4-editor | R | `portal/note-types/[key]/page.tsx`, `actions.ts` (sections and fields) | P4-list-page |
| P4-editor-options | R | `portal/note-types/[key]/OptionEditor.tsx`, `AddField.tsx` | P4-editor |
| P5-migration | X | `db/migrations/0023_patient_flag_changes.sql`, `db/test/patient-flag-changes.test.ts` | P0-migration |
| P5-tests | X | `vectors/flag-current.json`, its two readers, `api-test/{sync-flag-change,patients-flags-route,patients-flags-sensitive}.test.ts`, the new scenario in `sync_scenarios_test.dart` | P5-migration |
| P5-current-ts | T | `presets/src/flags.ts` | P5-tests |
| P5-current-dart | T | `phone/presets/flags.dart` | P5-tests, P2-models |
| P5-entity | X | `api/sync/entities/patient-flag-change.ts`, `api/sync/entities/index.ts`, `api/patients/charts.ts` (`CHART_TABLES`) | P5-tests |
| P5-read-rule | X | `api/routes/sync.ts` (the entity's read rule, 6.2) | P5-entity |
| P5-phone-entity | X | `phone/sync/entities.dart`, `phone-test/sync/fake_server.dart`, `fake_parity_test.dart` | P5-read-rule |
| P5-chart-read | T | `api/patients/projection.ts`, `schemas.ts` (`flags`, with the sensitive filter) | P5-current-ts, P5-entity |
| P5-route | T | `api/routes/patients.ts`, `api/patients/flags.ts` (`POST …/flags`) | P5-entity |
| P5-search | T | `api/patients/search.ts`, `api/routes/patients.ts` | P5-chart-read |
| P5-permissions | R | `api-test/permissions.test.ts` | P5-route, P5-search |
| P5-contract | S | The generated contract | P5-permissions |
| P5-chart-cache | R | `phone/patients/chart_cache.dart`, its test (keeps `flags`) | P5-contract |
| P5-phone-sheet | R | `phone/features/patients/flag_sheet.dart`, `patient_screen.dart`, `phone/features/sync/sync_labels.dart` | P5-current-dart, P5-phone-entity, P5-chart-cache, P2-store |
| P5-portal-panel | R | `parts/FlagsPanel.tsx`, `patients/[patientId]/page.tsx`, its `actions.ts` | P5-contract |
| P5-portal-filters | R | `patients/page.tsx`, `SearchForm.tsx` | P5-contract |
| P6-vectors | X | `vectors/presets-done-when.json` | P0 |
| P6-server | T | `api-test/presets-done-when.test.ts` (steps 2 to 5) | P1, P6-vectors |
| P6-phone | T | `phone-test/presets/done_when_presets_test.dart` (steps 1, 6, 7, 8, against the fake) | P2, P5-phone-sheet |
| P6-live | X | `phone-test/presets/live_presets_test.dart`, `tools/live-sync.sh` | P6-phone |
| P6-recipe | R | `docs/plan/patterns/preset-kind.md` | P1, P2, P3 |
| P6-docs | R | `docs/compliance/`, `IMPLEMENTATION_PLAN.md` (the D-table, section 6 rows), the PR description | all |

**Count: 79 cards. S 4, T 31, R 30, X 14.** By unit: P0 12, P1 11, P2 7, P3 14, P4 13, P5 16, P6 6. No card changes more than three source files.
