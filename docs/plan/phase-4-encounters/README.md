# Phase 4 (Encounters): the card index

This is the work-list for phase 4. The design is `docs/design/phase-4-encounters.md` and its two
parts, `docs/design/phase-4/forms.md` and `docs/design/phase-4/lifecycle.md`. How cards work is
in `docs/plan/README.md`. Each card is, or will be, one file under `cards/`, named after its ID.

**Status (Nov 14):** the design is reviewed. Nothing is built. Three cards are written in full,
as models for the rest: `F6-psychological` (level S), `L0-rules-ts` (level T) and
`L0-migration-0018` (level X). A card is written in full when the cards it needs have landed, so
that the files and line ranges it names exist.

## Where to start

Nothing here can be given to the small model on day one. The first cards are level X, and the
level T cards need their tests written first. In order:

1. The frontier model does **F0-schema**, **F0-canonical** and **F0-tests**; the small model can
   do **F0-package** before them. From then on the small model can do the seven T cards of F0,
   one at a time.
2. In parallel, the frontier model does **L0-vectors** and the four **L0-migration** cards, then
   **F1-vectors** and **F3-migration**. The small model can then do the five T cards of L0 and
   the fourteen of F1.
3. The frontier model writes each card in full just before it is handed out, from this index,
   the design section the row points to, and the model card of the same level. A card is at most
   90 lines. `node tools/card-check.mjs` checks the result, and `node tools/card-run.mjs <card>
   --dry-run` shows what the small model will be sent.
4. The small model's cards are run with `tools/card-run.mjs` (`docs/plan/README.md`, "Running a
   card"). A row below names files; the full card says for each whether it is new, written again
   whole, or changed by line range. A file that several cards add to (`api/routes/encounters.ts`
   is named by nine) is changed by line range once it is long.
5. After each unit: the full local CI (`CLAUDE.md`), then push, then tick the unit in
   `docs/design/phase-4-encounters.md`.

## Levels, and what they mean for this phase

| Level | Cards | Who writes the code | What stands between the code and the branch |
|---|---|---|---|
| S | 40 | The small local model | A machine check. The frontier model reads the diff when the unit is audited. |
| T | 67 | The small local model | Tests the frontier model wrote first (the `tests` card of each unit), then its audit of the diff |
| R | 64 | The small local model | The frontier model's audit of the diff and the screen |
| X | 49 | The frontier model | A second review |

220 cards. The small model writes the code of 171 of them and decides nothing on any of them: the
decisions are in the design, in the tests written first, and in each card's tables. The frontier
model writes the 49 level X cards, writes the tests of the level T cards, writes each card just
before it is handed out, and audits every card and every unit (`docs/plan/README.md`, "The
audit").

## Order

Units own disjoint files, except where a card names an edit to another unit's file. A unit starts
when the units it needs are on the branch with CI green.

| Wave | Units | Why this order |
|---|---|---|
| 1 | **F0** | Everything about forms needs the package, the schema and the checks |
| 2 | **F1**, **L0**, **F3** (migration and install only) | The interpreter and the lifecycle rules are pure functions on vectors; the migrations stand alone |
| 3 | **E**, **F2**, **F6** | The export needs F1. The Dart interpreter needs F1's vectors. Definitions need the export's checks |
| 4 | **L1**, **F3** (routes), **F4** | Server sync needs the rules (L0), the interpreter (F1) and stored definitions (F3) |
| 5 | **L2**, **L3**, **F5** | Routes need L1. The phone's sync layer mirrors L1 and needs F2 and F4. The renderer needs F2 |
| 6 | **L4**, **F7** | The phone's domain layer needs L3 and the generated client from L2 |
| 7 | **L5**, **L6** | Screens need the domain layer and the renderer; the portal needs the routes |
| 8 | **L7** | The Done when, end to end |

Files that more than one unit edits, and the order: `services/api/src/app.ts` (F3-routes, then
L2-read-visit); `services/api/test/permissions.test.ts` (F3-contract, then L2-permissions);
`db/seed/seed.ts` (F3-install, then L2-seed); `apps/mobile/pubspec.yaml` (E-presets, then
L5-location); the generated contract (F3-contract, L1-contract, L2-contract, each after its own
unit's routes or schemas).

## The cards

"Needs" names cards; a unit name means every card of that unit. Paths are short where the folder
is plain: `api/` is `services/api/src/`, `api-test/` is `services/api/test/`, `phone/` is
`apps/mobile/lib/`, `phone-test/` is `apps/mobile/test/`, `forms/` is `packages/forms/`,
`vectors/` is `packages/contract/test-vectors/`, `portal/` is `apps/portal/src/app/(app)/`.

### F0 The forms package (forms 2, 4.2)

| Card | Level | Files | Needs |
|---|---|---|---|
| F0-package | R | `forms/package.json`, `forms/tsconfig.json`, `pnpm-lock.yaml` | — |
| F0-schema | X | `forms/schema/definition.schema.json`, `forms/src/types.ts`, `forms/test/schema.test.ts` (adds a JSON Schema library; the lockfile changes) | F0-package |
| F0-canonical | X | `forms/src/canonical.ts`, `forms/test/canonical.test.ts`: a copy of `canonicalJson` and `sha256Hex`, pinned by `vectors/canonical-json.json` | F0-package |
| F0-tests | X | The test files of this unit's and unit E's T cards: `forms/test/{resolve,validate,lock,versions,spec-check,shape-check,export}.test.ts` | F0-schema |
| F0-resolve | T | `forms/src/resolve.ts` | F0-tests |
| F0-validate-ids | T | `forms/src/validate.ts` (duplicate and reserved IDs, option codes) | F0-resolve |
| F0-validate-paths | T | `forms/src/validate.ts` (every path a definition can produce; conditions and `mapsTo` name real fields; lists exist) | F0-validate-ids |
| F0-validate-flags | T | `forms/src/validate.ts` (exclusive in a choose-one, a required field never visible, grid and region rules, limits of 2.4) | F0-validate-paths |
| F0-lock | T | `forms/src/lock.ts`, `forms/src/versions.ts` | F0-resolve |
| F0-spec-check | T | `forms/src/spec-check.ts` | F0-resolve |
| F0-shape-check | T | `forms/src/shape-check.ts` | F0-resolve |

### F1 The interpreter in TypeScript (forms 7)

| Card | Level | Files | Needs |
|---|---|---|---|
| F1-vectors | X | `vectors/forms-conformance.json`, `forms/test/conformance.test.ts`, `phone-test/forms/conformance_test.dart` | F0-schema |
| F1-field-at | T | `forms/src/interp/field-at.ts` | F1-vectors |
| F1-check-values | T | `forms/src/interp/check-answer.ts` (choice, text, number, flag, date, time, duration) | F1-field-at |
| F1-check-structure | T | `forms/src/interp/check-answer.ts` (unknown paths, grid rows, region, problem, the text of an Other option, entries) | F1-check-values |
| F1-conditions | T | `forms/src/interp/conditions.ts` | F1-field-at |
| F1-effective | T | `forms/src/interp/effective.ts` | F1-conditions |
| F1-finish | T | `forms/src/interp/finish.ts` | F1-effective |
| F1-normal | T | `forms/src/interp/normal.ts` | F1-effective |
| F1-recap | T | `forms/src/interp/recap.ts` | F1-effective |
| F1-read-sections | T | `forms/src/interp/read-model.ts` (sections, labels, display values) | F1-effective |
| F1-read-corrections | T | `forms/src/interp/read-model.ts` (corrected values with the old one) | F1-read-sections |
| F1-visible | T | `forms/src/interp/visible.ts` | F1-effective |
| F1-handoff | T | `forms/src/interp/handoff.ts` | F1-visible, F1-recap |
| F1-suggestions | T | `forms/src/interp/suggestions.ts` | F1-effective |
| F1-expand | T | `forms/src/interp/expand.ts` | F1-effective |

### E The export (forms 2.1, 4.2, 7.3)

| Card | Level | Files | Needs |
|---|---|---|---|
| E-presets | T | `forms/scripts/export.ts`, `apps/mobile/pubspec.yaml` (writes `generated/presets.json` and the phone asset; runs every check of forms 4.2) | F0, F1 |
| E-golden | T | `forms/scripts/golden.ts` (writes `generated/golden.json`) | E-presets |
| E-drift | X | `tools/ci-local.sh`, `.github/workflows/ci.yml`, `tools/phi-guard-rules.mjs` (the Forms drift step; `packages/forms/` and the vectors folder join the PHI guard's fixture list) | E-golden |

### F2 The interpreter in Dart (forms 7)

One card per file under `phone/forms/`, each level T, each making `conformance_test.dart` pass
for its function, each needing the same card of F1 that it mirrors: F2-field-at,
F2-check-values, F2-check-structure, F2-conditions, F2-effective, F2-finish, F2-normal,
F2-recap, F2-read-sections, F2-read-corrections, F2-visible, F2-handoff, F2-suggestions,
F2-expand. Then:

| Card | Level | Files | Needs |
|---|---|---|---|
| F2-golden | X | `phone-test/forms/golden_test.dart` | F2 (the fourteen), E-golden |

### F3 Definitions on the server (forms 3)

| Card | Level | Files | Needs |
|---|---|---|---|
| F3-migration | X | `db/migrations/0017_note_type_versions.sql`, `db/test/note-type-versions.test.ts` | — |
| F3-tests | X | `forms/test/install.test.ts`, `api-test/forms-routes.test.ts` | F3-migration |
| F3-install | T | `forms/src/install.ts` (`installPresets`, in the forms package so the seed and the API can both call it), `api/routes/owner.ts`, `db/seed/seed.ts` | F3-tests, E-presets |
| F3-routes | T | `api/forms/definitions.ts`, `api/routes/forms.ts`, `api/app.ts` (the register line) | F3-install |
| F3-contract | R | `api-test/permissions.test.ts`, the generated contract | F3-routes |

### F4 Definitions on the phone (forms 3.4)

| Card | Level | Files | Needs |
|---|---|---|---|
| F4-tests | X | `phone-test/forms/definition_store_test.dart`, `phone-test/forms/forms_api_test.dart` | F2 |
| F4-store | T | `phone/forms/definition_store.dart` | F4-tests |
| F4-fetch | T | `phone/forms/forms_api.dart`, `phone/forms/forms_providers.dart` | F4-store, F3-contract |
| F4-hooks | X | `phone/auth/session_controller.dart`, `phone/sync/sync_controller.dart` (fetch after `/v1/me` and at each sync; delete the cache at sign-out and wipe) | F4-fetch |

### F5 The renderer (forms 8). Folder: `phone/features/forms/`, tests under `phone-test/features/forms/`

Every card is level R and includes its widget test file.

| Card | Files | Needs |
|---|---|---|
| F5-field-host | `field_host.dart` | F2 |
| F5-info, F5-text, F5-flag, F5-date, F5-time, F5-duration, F5-photo | one file each: `info_field.dart` and so on | F5-field-host |
| F5-choice | `choice_field.dart` (chips, exclusive options, blocked pairs, Other with its text) | F5-field-host |
| F5-number | `number_field.dart` (range, unit, the second unit, stepper, out of N) | F5-field-host |
| F5-group | `group_field.dart` (stack, row, collapsed) | F5-field-host |
| F5-grid | `grid_field.dart` | F5-choice, F5-number |
| F5-region | `region_field.dart` (the list of regions by front and back) | F5-choice |
| F5-region-side | `region_field.dart` (side and surface) | F5-region |
| F5-problem | `problem_field.dart` (search of the problem code list) | F5-field-host |
| F5-action | `action_field.dart` | F5-field-host |
| F5-form-shell | `note_form.dart` (sections as an accordion) | the widget cards |
| F5-form-recap | `note_form.dart` (a section's header shows its recap line) | F5-form-shell |
| F5-form-repeat | `note_form.dart` (entries: add, remove, titles) | F5-form-shell |
| F5-form-normal | `note_form.dart` (one-tap Normal) | F5-form-shell |
| F5-read-view | `note_read_view.dart` | F2 |

| Card | Level | Files | Needs |
|---|---|---|---|
| F5-smoke | X | `phone-test/features/forms/presets_smoke_test.dart` (every bundled note type, three themes, 200% text, 320 px) | F5-form-normal, E-presets |

### F6 The definitions (forms 4, 5, 6). Folder: `forms/definitions/`

| Card | Level | Files | Needs |
|---|---|---|---|
| F6-spec-pieces | X | `spec/<piece>.txt` for the 36 pieces, copied from the field specification, with `[left out]` where a line must not be copied | F0-spec-check |
| F6-shapes-notes | X | `spec/<piece>.shape.json` and `spec/<piece>.diff.json` for the 13 note type pieces, from `forms-inventory.md` | F6-spec-pieces, F0-shape-check |
| F6-shapes-exam-a | X | The shape and diff files of exam pieces 1 to 11 | F6-spec-pieces, F0-shape-check |
| F6-shapes-exam-b | X | The shape and diff files of exam pieces 12 to 23 | F6-spec-pieces, F0-shape-check |
| F6-lists | R | `lists/*.json`: the shared lists of forms 4.4 | F0-validate-flags |
| F6-red-flags | R | `note-types/red_flags_disposition/v1.json` (field specification lines 36 to 60) | F6-lists, E-presets |

The transcription cards, each level S, each one definition file, each needing F6-lists,
E-presets and the shape card of its piece:

| Card | Piece (field specification lines) | Goes into |
|---|---|---|
| F6-general-1 | 5 to 25 | `note-types/general_primary_care/v1.json` |
| F6-general-2 | 29 to 35 | the same file, after F6-general-1 |
| F6-wound-1 | 63 to 103 | `note-types/wound_care/v1.json` |
| F6-wound-2 | 104 to 119 | the same file, after F6-wound-1 |
| F6-harm-reduction | 120 to 148 | `note-types/harm_reduction/v1.json` |
| F6-psychological | 150 to 171 | `note-types/psychological/v1.json` |
| F6-sexrepro-1, -2, -3 | 173 to 203; 204 to 243; 244 to 251 | `note-types/sexual_reproductive/v1.json`, in order |
| F6-social-needs | 252 to 267 | `note-types/social_needs/v1.json` |
| F6-outreach | 268 to 282 | `note-types/outreach/v1.json` |
| F6-quick-1, -2 | 283 to 307; 308 to 332 | `note-types/quick_encounter/v1.json`, in order |
| F6-exam-01 to F6-exam-22 | the 22 exam pieces of `forms-inventory-focused-exam.md` section 7 | one module each: `modules/exam_<name>/v1.json` |
| F6-exam-picker | 1780 to 1836 (piece 23) | the `exam` section of the General note type |

| Card | Level | Files | Needs |
|---|---|---|---|
| F6-general-assemble | R | `note-types/general_primary_care/v1.json` (the 22 includes); `mapsTo` on `note-types/quick_encounter/v1.json` | every F6 transcription card |
| F6-release | X | `definitions.lock.json`, the generated files | F6-general-assemble |

### F7 Flows (forms 6)

| Card | Level | Files | Needs |
|---|---|---|---|
| F7-tests | X | `phone-test/encounters/red_flags_test.dart`, `phone-test/encounters/expand_quick_test.dart` | L4-complete |
| F7-red-flags-auto | T | `phone/encounters/red_flags.dart` (add the Red flags note with the first Medical note; hard stop 5) | F7-tests, F6-red-flags |
| F7-expand | T | `phone/encounters/expand_quick.dart` | F7-tests, F6-general-assemble |
| F7-expand-control | R | `phone/features/forms/note_form.dart` (the Expand control on a quick form part) | F7-expand, F5-form-shell |
| F7-actions | R | `phone/features/forms/action_field.dart`, `phone/features/encounters/note_screen.dart` (`open_note_type`, `add_referral`) | F5-action, L5-note-screen |
| F7-handoff | R | `phone/features/encounters/handoff_screen.dart` (the lines, through `visibleAnswers`) | L5-handoff |
| F7-problem-button | R | `phone/features/forms/problem_field.dart` (Add to the problem list) | F5-problem, L4-problems-link |

### L0 Schema and core rules (lifecycle 2, 3.12, 4.5)

| Card | Level | Files | Needs |
|---|---|---|---|
| L0-migration-0018 | X | `db/migrations/0018_encounter_lifecycle.sql`, `db/test/encounter-lifecycle.test.ts` | — |
| L0-migration-0019 | X | `db/migrations/0019_note_signoffs.sql`, `db/test/note-signoffs.test.ts` | L0-migration-0018 |
| L0-migration-0020 | X | `db/migrations/0020_note_attestations.sql`, `db/test/note-attestations.test.ts` | L0-migration-0019 |
| L0-migration-0021 | X | `db/migrations/0021_referrals.sql`, `db/test/referrals.test.ts`, `api/patients/charts.ts` (the chart table row) | L0-migration-0018 |
| L0-vectors | X | `vectors/note-lifecycle.json`, `note-content-hash.json`, `signed-under.json`; the readers `api-test/encounter-rules.test.ts`, `phone-test/encounters/rules_test.dart`, `phone-test/encounters/content_hash_test.dart` | — |
| L0-rules-ts | T | `api/encounters/rules.ts` | L0-vectors |
| L0-content-hash-ts | T | `api/encounters/content-hash.ts` | L0-vectors, F1-effective |
| L0-signed-under-ts | T | `api/encounters/signed-under.ts` | L0-vectors |
| L0-rules-dart | T | `phone/encounters/rules.dart` | L0-vectors |
| L0-content-hash-dart | T | `phone/encounters/content_hash.dart` | L0-vectors, F2-effective |

### L1 Server sync (lifecycle 4). Every card is level X. Folder: `api/sync/`

| Card | Files | Needs |
|---|---|---|
| L1-legacy-tests | A test-only note type for the API fixtures, the fake and the phone tests; phase 2's status tests rewritten as sign-offs (`api-test/sync.test.ts`, `api-test/sync-fixtures.ts`, the phone's sync tests) | L0, F3-install |
| L1-lock-signer-gate | `entities/encounter.ts`, `entities/note.ts`, `api/encounters/signer.ts` | L1-legacy-tests |
| L1-encounter-fields | `records.ts`, `entities/encounter.ts` (new fields; `status` removed; `kind` to Medical only) | L1-lock-signer-gate |
| L1-envelope-lock | `entities/encounter.ts`, `entities/fields.ts` (kept in history after a finished note; a blank patient can be filled; last seen) | L1-encounter-fields |
| L1-note-create | `records.ts`, `entities/note.ts` (the create checks; the `medical` column; a Medical note makes its visit Medical) | L1-lock-signer-gate, F3-routes |
| L1-note-answers | `entities/note.ts`, `entities/fields.ts`, `apply.ts` (`checkAnswer` after the load; 1,000 answers; `notCounted`; a throw becomes `definition_error`) | L1-note-create, F1-check-structure |
| L1-note-late-reopen | `entities/note.ts`, `entities/fields.ts` (late changes kept; the reopen table) | L1-note-answers |
| L1-signoff | `entities/note-signoff.ts`, `entities/index.ts`, `entities/values.ts` | L1-note-late-reopen, L0, F1-finish |
| L1-addendum | `entities/note-addendum.ts`, `entities/index.ts`, `entities/values.ts` | L1-signoff |
| L1-correction | `entities/note-correction.ts`, `entities/index.ts`, `records.ts` (`corrected` history; `appendHistory` returns the row ID) | L1-signoff |
| L1-referral | `entities/referral.ts`, `entities/index.ts`, `entities/values.ts` (and the check for a visit of another patient) | L1-lock-signer-gate |
| L1-read-filter | `api/routes/sync.ts`, `review.ts`, `records.ts` (hidden content leaves no value, version or mark; the new records' read rule; a note's new attributes; the sensitive check first) | L1-correction, F1-visible |
| L1-audit-actions | `entities/values.ts` (`ems_handoff.shown`, `notes_to_finish.viewed`) | L1-lock-signer-gate |
| L1-problem-source | `entities/problem.ts` | L1-lock-signer-gate |
| L1-contract | The generated contract and `vectors/sync-values.json` | the L1 cards above |

### L2 Server routes (lifecycle 5, 6). Folder: `api/encounters/`, routes in `api/routes/encounters.ts`

| Card | Level | Files | Needs |
|---|---|---|---|
| L2-tests | X | `api-test/encounters-{read,timeline,cosign,queues,attest,assign,incomplete,counts}.test.ts` | L1 |
| L2-read-visit | T | `routes/encounters.ts`, `encounters/read.ts`, `api/app.ts` (the register line) | L2-tests, F1-read-corrections |
| L2-timeline | R | `api/patients/charts.ts`, `projection.ts`, `schemas.ts` (`timeline`, `recentVisits`) | L2-read-visit |
| L2-timeline-more | T | `routes/encounters.ts`, `encounters/timeline.ts` | L2-timeline |
| L2-cosign | T | `routes/encounters.ts`, `encounters/cosign.ts` | L2-read-visit |
| L2-queues | T | `routes/encounters.ts`, `encounters/queues.ts` | L2-read-visit |
| L2-attest | T | `routes/encounters.ts`, `encounters/attest.ts` | L2-queues |
| L2-assign | T | `routes/encounters.ts`, `encounters/assign.ts` | L2-read-visit |
| L2-incomplete | T | `routes/encounters.ts`, `encounters/incomplete.ts` | L2-read-visit |
| L2-counts | T | `routes/encounters.ts`, `encounters/counts.ts` | L2-incomplete, L2-queues |
| L2-handoff-pdf | R | `routes/encounters.ts`, `encounters/handoff.ts`, `api-test/encounters-handoff.test.ts` (adds a PDF library; the lockfile changes) | L2-read-visit, F1-handoff |
| L2-permissions | R | `api-test/permissions.test.ts` | the route cards above |
| L2-contract | S | The generated contract | L2-permissions |
| L2-seed | S | `db/seed/demo-encounters.ts`, `db/seed/seed.ts` | L1, F6-release |

### L3 The phone's sync layer (lifecycle 4.8, 4.9). Every card is level X

| Card | Files | Needs |
|---|---|---|
| L3-registry | `phone/sync/entities.dart` (the changed and new entities; the patient of a new record; the referral's date rule; the two audit actions) | L1 |
| L3-store-finish | `phone/sync/local_store.dart`, `phone-test/sync/store_encounters_test.dart` (`finishNotes`: the hash shown, the fix path, the Red flags note first, hidden answers dropped) | L3-registry, L0-rules-dart, L0-content-hash-dart |
| L3-store-lock | `phone/sync/local_store.dart` (the lock by effect; reopen gets through; a note on any encounter) | L3-store-finish |
| L3-store-receipts | `phone/sync/local_store.dart` (receipts settle the effect; a sign-off held for review; the clock guard) | L3-store-lock |
| L3-fake-encounter | `phone-test/sync/fake_server.dart` (rules 1 to 6 and 13 of lifecycle 4.9) | L3-registry |
| L3-fake-signoff | `phone-test/sync/fake_server.dart` (rules 7 to 10) | L3-fake-encounter |
| L3-fake-rest | `phone-test/sync/fake_server.dart` (rules 11, 12 and 14 to 17) | L3-fake-signoff |
| L3-parity | `phone-test/sync/fake_parity_test.dart`, `fake_reads_test.dart` | L3-fake-rest |

### L4 The phone's domain layer (lifecycle 3, 7, 8). Folder: `phone/encounters/`, tests under `phone-test/encounters/`

| Card | Level | Files | Needs |
|---|---|---|---|
| L4-tests | X | The test files of this unit's T cards | L3 |
| L4-models-read | T | `encounter_models.dart`, `encounter_repository.dart` (read a visit from the store, the read logged) | L4-tests, F4-fetch |
| L4-start | T | `encounter_repository.dart` (start an encounter, add a note, remove a note, switch to Medical) | L4-models-read |
| L4-complete | T | `complete.dart` (hard stops 1 to 4, then `finishNotes` with the hashes shown) | L4-start |
| L4-note-actions | T | `note_actions.dart` (reopen, addendum, correction) | L4-complete |
| L4-referrals | T | `referrals.dart` | L4-models-read |
| L4-notes-to-finish | T | `notes_to_finish.dart` (the phone's drafts merged with the server's list; the offline read logged) | L4-models-read |
| L4-online | T | `encounter_api.dart` (the visit read, the queues, co-sign, attest, counts) | L2-contract |
| L4-timeline | T | `timeline.dart` (the chart's list merged with unconfirmed visits) | L4-models-read |
| L4-close-sweep | T | `close_sweep.dart` (close finished notes with nothing waiting, and drafts untouched for 7 days) | L4-complete |
| L4-chart-cache | R | `phone/patients/chart_cache.dart`, its test (keeps `timeline`, `recentVisits` and the referral snapshots) | L2-timeline |
| L4-problems-link | R | `phone/patients/problems.dart`, its test (a problem made or changed in a visit carries its ID) | L1-problem-source |

### L5 The phone's screens (lifecycle 9). Folder: `phone/features/encounters/`

Every card is level R, except L5-labels, and includes its widget test file under
`phone-test/features/encounters/`.

| Card | Files | Needs |
|---|---|---|
| L5-labels (level S) | `encounter_labels.dart` | — |
| L5-start-tab | `phone/app.dart`, `start_sheet.dart` | L4-start |
| L5-new-encounter | `new_encounter_screen.dart` (who, where) | L5-start-tab |
| L5-kind | `kind_screen.dart` (Medical or Non-Medical; Switch to Medical) | L5-new-encounter |
| L5-encounter-screen | `encounter_screen.dart` (the visit's notes; Remove this note) | L5-kind |
| L5-note-type-list | `note_type_list.dart` | L5-encounter-screen, F4-fetch |
| L5-note-screen | `note_screen.dart` (the frame around a note's form) | L5-note-type-list, F5-form-normal |
| L5-summary-recap | `summary_screen.dart` (recaps, the assessment, suggestions, follow-up) | L5-note-screen |
| L5-summary-complete | `summary_screen.dart` (what stops Complete, the signing sentence, the buttons) | L5-summary-recap, L4-complete, F7-red-flags-auto |
| L5-visit-envelope | `visit_screen.dart` (the envelope and the notes, from a read model) | L4-models-read, L4-online, F5-read-view |
| L5-visit-trail | `visit_screen.dart` (sign-offs, attestations, addenda in time order) | L5-visit-envelope |
| L5-visit-actions | `visit_screen.dart` (Add addendum, Correct, Reopen, Co-sign, Attest) | L5-visit-trail, L4-note-actions |
| L5-correction-sheet | `correction_sheet.dart` (one to ten answers, a reason, a patient's request) | L5-visit-actions |
| L5-addendum-sheet | `addendum_sheet.dart` | L5-visit-actions |
| L5-handoff | `handoff_screen.dart` (the full-screen page; no copy, no share) | L5-note-screen |
| L5-notes-to-finish | `notes_to_finish_screen.dart`, `phone/features/home/home_screen.dart` | L4-notes-to-finish |
| L5-queues | `queue_screen.dart`, `phone/features/home/home_screen.dart` | L4-online, L5-visit-actions |
| L5-referrals | `referrals_sheet.dart` | L4-referrals |
| L5-profile-timeline | `timeline_section.dart`, `phone/features/patients/patient_screen.dart` (+ Encounter, + Referral, the timeline, Show earlier visits) | L4-timeline, L4-chart-cache, L5-referrals |
| L5-needs-attention | `phone/features/sync/sync_labels.dart`, `phone/features/sync/needs_attention_screen.dart` (the sentences, the notices, the buttons that settle each problem) | L3 |
| L5-location | `location_field.dart`, `apps/mobile/pubspec.yaml` (Use my location) | L5-new-encounter |

### L6 The portal (lifecycle 9.11 to 9.14). Folder: `portal/`

| Card | Level | Files | Needs |
|---|---|---|---|
| L6-visit-page | R | `encounters/[encounterId]/page.tsx`, `encounters/[encounterId]/NoteView.tsx` | L2-contract |
| L6-patient-timeline | R | `patients/[patientId]/Timeline.tsx`, `patients/[patientId]/page.tsx` | L2-contract |
| L6-queues | R | `team/cosign/page.tsx`, `team/attestation/page.tsx` | L2-contract |
| L6-sign-actions | R | `apps/portal/src/app/actions/encounters.ts`, `encounters/[encounterId]/SignActions.tsx` | L6-visit-page |
| L6-incomplete | R | `team/incomplete-notes/page.tsx`, `home/page.tsx` | L2-contract |
| L6-assign | R | `encounters/[encounterId]/AssignForm.tsx`, `apps/portal/src/app/actions/encounters.ts` | L6-sign-actions |
| L6-nav-counts | R | `layout.tsx` (the links, shown by credential), `home/page.tsx` (the attending's count) | L6-queues |
| L6-handoff-link | S | `encounters/[encounterId]/page.tsx` | L6-visit-page, L2-handoff-pdf |
| L6-e2e | R | `apps/portal/e2e/encounters.spec.ts`, `apps/portal/e2e/attestation.spec.ts` | the L6 cards above |

### L7 The Done when (lifecycle 11.1)

| Card | Level | Files | Needs |
|---|---|---|---|
| L7-vectors | X | `vectors/encounters-done-when.json` | L0 |
| L7-server | T | `api-test/encounters-done-when.test.ts` | L2 |
| L7-phone | T | `phone-test/encounters/done_when_test.dart` | L4, F7-red-flags-auto |
| L7-live | X | `phone-test/encounters/live_encounters_test.dart`, `tools/live-sync.sh` | L7-phone |
| L7-screens | R | `phone-test/features/encounters/done_when_flow_test.dart` | L5 |

## Counts by unit

| Unit | S | T | R | X | Cards |
|---|---|---|---|---|---|
| F0 | | 7 | 1 | 3 | 11 |
| F1 | | 14 | | 1 | 15 |
| E | | 2 | | 1 | 3 |
| F2 | | 14 | | 1 | 15 |
| F3 | | 2 | 1 | 2 | 5 |
| F4 | | 2 | | 2 | 4 |
| F5 | | | 21 | 1 | 22 |
| F6 | 36 | | 3 | 5 | 44 |
| F7 | | 2 | 4 | 1 | 7 |
| L0 | | 5 | | 5 | 10 |
| L1 | | | | 15 | 15 |
| L2 | 2 | 8 | 3 | 1 | 14 |
| L3 | | | | 8 | 8 |
| L4 | | 9 | 2 | 1 | 12 |
| L5 | 1 | | 20 | | 21 |
| L6 | 1 | | 8 | | 9 |
| L7 | | 2 | 1 | 2 | 5 |
| **All** | **40** | **67** | **64** | **49** | **220** |
