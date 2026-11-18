# Phase 4 (Encounters): the card index

This is the work-list for phase 4. The design is `docs/design/phase-4-encounters.md` and its two
parts, `docs/design/phase-4/forms.md` and `docs/design/phase-4/lifecycle.md`. How cards work is
in `docs/plan/README.md`. Each card is, or will be, one file under `cards/`, named after its ID.

**Status (Nov 16):** in build, by the frontier model with helper agents: the decision and what
it changes are in `docs/design/phase-4-encounters.md`, "How this phase is built". This index is
the work-list: each row's files, needs and order hold. No further cards are written for this
phase. The three written in full (`F6-psychological`, `L0-rules-ts`, `L0-migration-0018`) are
followed where their files are built, and marked Done. Which units are on the branch is in the
design's Status table.

## Where to start

1. Read the Status table in `docs/design/phase-4-encounters.md`: it says which units are on the
   branch and what each has left.
2. Take the next unit in the Order table below whose needs have landed. Build it from the design
   sections its rows point to, tests first, in a worktree of its own (`CLAUDE.md`, "Running units
   with helper agents").
3. Check every rule by removing it and seeing its test fail. Script it, as `CLAUDE.md` says.
4. After each unit: an independent review, the full local CI (`CLAUDE.md`), then push, then
   update the unit's row in the Status table. A migration is pushed only after its review.

How a card is run by the small local model is in `docs/plan/README.md`. Phases 5 on are still
planned that way.

## Levels, and what they mean for this phase

| Level | Cards | Who writes the code | What stands between the code and the branch |
|---|---|---|---|
| S | 38 | The small local model | A machine check. The frontier model reads the diff when the unit is audited. |
| T | 67 | The small local model | Tests the frontier model wrote first (the `tests` card of each unit), then its audit of the diff |
| R | 64 | The small local model | The frontier model's audit of the diff and the screen |
| X | 49 | The frontier model | A second review |

218 cards (220 until wave B made Wound care and MSK one piece each). The table is how the phase
was planned: the small model would have written the code of 169 of them and decided nothing on
any of them. In this phase the frontier model writes the code of every level (see the Status
above). A row's level still says how much judgment it takes: an S or T row is settled by its
machine check or its tests, an R row needs its diff and its screen read, and an X row needs a
second reader before it lands.

## Order

Units own disjoint files, except where a card names an edit to another unit's file. A unit starts
when the units it needs are on the branch with CI green.

| Wave | Units | Why this order |
|---|---|---|
| 1 | **F0** | Everything about forms needs the package, the schema and the checks |
| 2 | **F1**, **L0**, **F3** (migration and install only) | The interpreter and the lifecycle rules are pure functions on vectors; the migrations stand alone |
| 3 | **E**, **F2**, **F6** | The export needs F1. The Dart interpreter needs F1's vectors. Definitions need the export's checks |
| 4 | **L1** with **L3**'s registry, test server and parity cards; **F3** (routes); **F4** | Server sync needs the rules (L0), the interpreter (F1) and stored definitions (F3). A change to the server's sync rules lands with the same change to the phone's test server (`CLAUDE.md`) |
| 5 | **L2**, **L3** (the store cards), **F5** | Routes need L1. The phone's store mirrors L1 and needs F2 and F4. The renderer needs F2 |
| 6 | **L4**, **F7** | The phone's domain layer needs L3 and the generated client from L2 |
| 7 | **L5**, **L6** | Screens need the domain layer and the renderer; the portal needs the routes |
| 8 | **L7** | The Done when, end to end |

Files that more than one unit edits, and the order: `services/api/src/app.ts` (F3-routes, then
L2-read-visit); `services/api/test/permissions.test.ts` (F3-contract, then L2-permissions);
`db/seed/seed.ts` (F3-install, then L2-seed); `apps/mobile/pubspec.yaml` (E-presets, then
L5-location); the generated contract (F3-contract, L1-contract, L2-contract, each after its own
unit's routes or schemas). Wave A's review had L0 edit three files L1 owns:
`services/api/src/sync/entities/note.ts` (the team lock), `services/api/src/sync/review.ts` (a
comment) and `services/api/test/sync.test.ts` (one test's setup); L1 builds on those edits.
Wave B's review had F1 edit two files F0 owns, `forms/src/validate.ts` and
`forms/test/validate.test.ts` (the rules `other_twice`, `normal_conflict`, `handoff_restricted`
and `clears_with_sides`, a wider `condition_reads_restricted`, and `required_never_visible`
counting a field's own clearing flag: forms 2.2, 4.2), and add
`forms/test/interp/one-meaning.test.ts`, which holds the validator and the interpreter to one
meaning of what counts (forms 7.2); and F6 edit one, `forms/src/shape-check.ts` with its test (a
shape file may pin a label, forms 4.2). In wave C, F3-install edited E's `forms/scripts/export.ts`
(the `Preset` type moved to `forms/src/install.ts`), F1's `forms/src/interp/check-answer.ts` and
`vectors/forms-conformance.json` took the rule that a text holding a NUL or half of a surrogate
pair is `wrong_type` (forms 7.1), and F2-golden added a test to E's `forms/test/golden.test.ts`,
the one that writes the phone's golden sample. Wave C's review had F2 add six cases and the
`rules` definition to `vectors/forms-conformance.json`, in place of Dart-only tests (forms 7.2).
In wave D, L1's cards shared more files than their rows planned:
`services/api/src/sync/schemas.ts` (L1-signoff, L1-addendum, L1-correction and L1-referral each
added their entity to `ChangeEntity` and `RecordEntity`; wave D's review, a held item's
`hidden`), `records.ts` and `entities/note.ts` (six cards each), `vectors/sync-note-types.json`
(four cards, and the review), and phase 2's and 3's tests: `api-test/sync.test.ts`,
`sync-concurrency.test.ts` and `sync-patients.test.ts`. L1-note-create built D79 in F3-routes'
`services/api/src/forms/definitions.ts`. L3-registry, L3-fake-encounter and L3-fake-rest changed
the phase 2 phone tests that the new rules refused (`local_store_test.dart`,
`sync_flow_test.dart`, `sync_scenarios_test.dart`). In wave E, L2's review had L2 edit files of
L0, L1 and L3: `api/encounters/rules.ts` (a comment on `cosignEffect`: neither a co-sign nor an
attestation waits for the Red flags note), `api/sync/review.ts` (the sync read calls
`encounters/read.ts`'s rules and keeps no copy of its own), and `phone-test/sync/fake_server.dart`
with `fake_parity_test.dart` and `fake_reads_test.dart` (the same three read rules on the fake: a
correction asked of every state its note has held, a visit's status from the notes shown, no
sign-off's hash over a withheld summary). L3's store cards and their review edited files of L0,
L1, L2 and L5: `api/encounters/rules.ts`, `phone/encounters/rules.dart`,
`vectors/note-lifecycle.json` and `phone-test/encounters/rules_test.dart` (`signoffEffect`'s
`emptyDraft`); `api/sync/entities/{note,note-signoff}.ts`, `api/sync/review.ts` and
`api/sync/schemas.ts` with the contract, and
`api-test/sync-{signoffs,corrections,encounters,reads}.test.ts` (an empty draft's sign-off,
`everSigned`, `hasFinishedNote`, the held sign-off's notice); L2-seed's
`db/test/demo-encounters.test.ts` (the new input); L5-needs-attention's
`phone/features/sync/sync_labels.dart` with `phone-test/features/sync_labels_test.dart` (the
notices of a note's life); and phase 2's `phone-test/sync/local_store_test.dart` and
`live_api_test.dart`.

One landing holds L1 and five cards of L3: L3-registry, L3-fake-encounter, L3-fake-signoff,
L3-fake-rest and L3-parity. The phone's test server mirrors the server's sync rules by hand, so
the two change in one push and never a wave apart (`docs/plan/factory-handoff/`, B 2.3).

## The cards

"Needs" names cards; a unit name means every card of that unit. Paths are short where the folder
is plain: `api/` is `services/api/src/`, `api-test/` is `services/api/test/`, `phone/` is
`apps/mobile/lib/`, `phone-test/` is `apps/mobile/test/`, `forms/` is `packages/forms/`,
`vectors/` is `packages/contract/test-vectors/`, `portal/` is `apps/portal/src/app/(app)/`.

### F0 The forms package (forms 2, 4.2)

| Card | Level | Files | Needs |
|---|---|---|---|
| F0-package | R | `forms/package.json`, `forms/tsconfig.json`, `pnpm-lock.yaml`, `forms/src/index.ts`, `forms/test/import-path.test.ts` (the index stays safe for the API's bundle) | — |
| F0-schema | X | `forms/schema/definition.schema.json`, `forms/src/types.ts`, `forms/test/schema.test.ts` (adds a JSON Schema library; the lockfile changes) | F0-package |
| F0-canonical | X | `forms/src/canonical.ts`, `forms/test/canonical.test.ts`: a copy of `canonicalJson` and `sha256Hex`, pinned by `vectors/canonical-json.json` | F0-package |
| F0-tests | X | The test files of this unit's T cards: `forms/test/{resolve,validate,paths,lock,versions,spec-check,shape-check}.test.ts`. The export's test, `forms/test/export.test.ts`, is written in unit E, which owns the script it tests (E-presets) | F0-schema |
| F0-resolve | T | `forms/src/resolve.ts` (a module, a version or a list that does not exist is the resolver's to report) | F0-tests |
| F0-validate-ids | T | `forms/src/validate.ts` (duplicate and reserved IDs, option codes) | F0-resolve |
| F0-validate-paths | T | `forms/src/paths.ts` (every path a definition can produce: the one copy the validator, the version rules and the interpreter use), `forms/src/validate.ts` (conditions and `mapsTo` name real fields) | F0-validate-ids |
| F0-validate-flags | T | `forms/src/validate.ts` (exclusive in a choose-one, a required field never visible, grid and region rules, limits of 2.4) | F0-validate-paths |
| F0-lock | T | `forms/src/lock.ts`, `forms/src/versions.ts`. After wave D's review a version's resolved line held without its file's line is refused (`lock.resolved_alone`, forms 4.2), so a version is released whole or not at all | F0-resolve |
| F0-spec-check | T | `forms/src/spec-check.ts` | F0-resolve |
| F0-shape-check | T | `forms/src/shape-check.ts` | F0-resolve |

### F1 The interpreter in TypeScript (forms 7)

| Card | Level | Files | Needs |
|---|---|---|---|
| F1-vectors | X | `vectors/forms-conformance.json`, `forms/test/conformance.test.ts` (the Dart reader of the vectors is F2's). After wave D's review the cases hold the handoff's three new rules (no treatment record's recap, no field line of a quick answer Expand carried into a full note, no sensitive diagnosis, given the sensitive list) and a duration's own `max` (forms 2.3, 7.1) | F0-schema |
| F1-field-at | T | `forms/src/interp/field-at.ts` | F1-vectors |
| F1-check-values | T | `forms/src/interp/check-answer.ts` (choice, text, number, flag, date, time, duration) | F1-field-at |
| F1-check-structure | T | `forms/src/interp/check-answer.ts` (unknown paths, grid rows, region, problem, the text of an Other option, entries) | F1-check-values |
| F1-conditions | T | `forms/src/interp/conditions.ts` (the rules every function shares: what counts, entries, conditions) | F1-field-at |
| F1-effective | T | `forms/src/interp/effective.ts`, `forms/test/interp/effective.test.ts` (key order, copies) | F1-conditions |
| F1-finish | T | `forms/src/interp/finish.ts` | F1-effective |
| F1-normal | T | `forms/src/interp/normal.ts` | F1-effective |
| F1-recap | T | `forms/src/interp/recap.ts`, `forms/src/interp/layout.ts` (the items and values the recap, the read model and the handoff share) | F1-effective, F1-visible |
| F1-read-sections | T | `forms/src/interp/read-model.ts` (sections, labels, display values, from `layout.ts`) | F1-recap |
| F1-read-corrections | T | `forms/src/interp/read-model.ts` (corrected values with the old one) | F1-read-sections |
| F1-visible | T | `forms/src/interp/visible.ts`, `forms/src/interp/sensitive-exams.ts` (what a sensitive exam leaves out, which the recap and the handoff read too), `forms/test/interp/visible.test.ts` | F1-effective |
| F1-handoff | T | `forms/src/interp/handoff.ts`, `forms/test/interp/handoff.test.ts`. As built after wave D's review, for every reader: no recap line of a `treatmentRecord` section; no field line of a quick answer Expand carried into a full note of the visit, whose line stands for it; and, taking phase 3's sensitive list as a third argument, nothing of a sensitive diagnosis, its entry or section left out as `visibleAnswers` leaves it (forms 7.1, 10.1 #6). The duration's `max` went into `check-answer.ts`, `paths.ts`, the schema and `types.ts` in the same review (forms 2.3) | F1-visible, F1-recap |
| F1-suggestions | T | `forms/src/interp/suggestions.ts` | F1-effective |
| F1-expand | T | `forms/src/interp/expand.ts`, `forms/test/interp/expand.test.ts` | F1-effective |

### E The export (forms 2.1, 4.2, 7.3)

| Card | Level | Files | Needs |
|---|---|---|---|
| E-presets | T | `forms/scripts/export.ts`, `forms/test/export.test.ts`, `forms/package.json` (the `export` script), `apps/mobile/pubspec.yaml`, and what it writes, `forms/generated/presets.json` and `apps/mobile/assets/forms/presets.json` (runs every check of forms 4.2, stopping after schema problems, since every later check reads files that passed `checkFile`; hands the parsed pieces to `lockOf` and `checkLock`; prints the largest number of answers each note type can hold, and refuses nothing for it, forms 2.4; writes each definition in canonical key order; `--release` refuses a piece, module or list nothing uses, `export.unused_file`, and is all that writes the lock, forms 4.1; since wave D it writes to the presets only the versions the lock releases, noting each draft, and a release writes the lock before the presets, D78, forms 3.2) | F0, F1 |
| E-golden | T | `forms/scripts/golden.ts`, `forms/test/golden.test.ts`, `forms/package.json` (the `golden` script), and what it writes, `forms/generated/golden.json` (answer sets made by rule for each preset, after the export, from the presets it wrote: forms 7.3). After wave D's review, five sets, each case also recording the handoff, the order of the answers that count, three readers' visible answers, the content hash and Expand, with tests of what the sets reach on the real note types; in the same change F2-golden's `phone-test/forms/golden_test.dart` and `golden_sample.json`, and a test in `api-test/note-content-hash.test.ts` that holds the API's content hash to the golden file's | E-presets |
| E-drift | X | `tools/ci-local.sh`, `.github/workflows/ci.yml`, `tools/phi-guard-rules.mjs` (the Forms drift step; `packages/forms/` and the vectors folder join the PHI guard's fixture list); after the review also `forms/scripts/lock-grows.ts`, its cases in `forms/test/export.test.ts` and its script in `forms/package.json` (a line the base commit's lock holds never leaves it or changes, forms 4.2), and `tools/test/phi-guard.test.mjs` (the fixture list's test) | E-golden |

### F2 The interpreter in Dart (forms 7)

One card per file under `phone/forms/`, each level T, each making `conformance_test.dart` pass
for its function, each needing the same card of F1 that it mirrors: F2-field-at,
F2-check-values, F2-check-structure, F2-conditions, F2-effective, F2-finish, F2-normal,
F2-recap, F2-read-sections, F2-read-corrections, F2-visible, F2-handoff, F2-suggestions,
F2-expand. F2-field-at also writes the Dart reader of the vectors,
`phone-test/forms/conformance_test.dart`, which F1-vectors left to this unit. As built, F2-field-at
also wrote `phone/forms/definition.dart` (a resolved definition read, and a shape the validator
would never pass refused by its place) and `phone/forms/paths.dart` (the path model, as
`forms/src/paths.ts`), F2-effective `conditions.dart`, and F2-recap `layout.dart` and
`sensitive_exams.dart`, the files F1 shares between functions. A card that met something the
vectors cannot say wrote a test of its own beside them:
`phone-test/forms/{definition,check_answer,effective,read,visible,handoff,expand}_test.dart`
(forms 7.2). After wave D's review `handoff.dart` holds the same three rules as F1-handoff (it
takes the sensitive list, and shares `sensitiveDiagnoses` with `visible.dart`), and
`check_answer.dart`, `paths.dart` and `definition.dart` a duration's own `max` (a
`DurationHolds`), each run by the shared cases. Then:

| Card | Level | Files | Needs |
|---|---|---|---|
| F2-golden | X | `phone-test/forms/golden_test.dart`; `phone-test/forms/golden_sample.json`, which a test it adds to `forms/test/golden.test.ts` writes as a snapshot, so the check runs before `golden.json` holds the real note types (forms 7.3) | F2 (the fourteen), E-golden |

### F3 Definitions on the server (forms 3)

| Card | Level | Files | Needs |
|---|---|---|---|
| F3-migration | X | `db/migrations/0017_note_type_versions.sql`, `db/test/note-type-versions.test.ts` | — |
| F3-tests | X | `forms/test/install.test.ts`, `forms/test/fixtures/presets.ts` (the fixture note types as presets, since `presets.json` is empty until the definitions are typed), `db/test/install-presets.test.ts` (the installer against 0017, in the db package: the forms tests run where there is no database, and a forms dependency on the db package would make a cycle with the seed's), `api-test/forms-routes.test.ts` | F3-migration |
| F3-install | T | `forms/src/install.ts` (`installPresets`, in the forms package so the seed and the API can both call it; every `preset` row names its `preset_version`, which 0017 checks), `forms/src/index.ts`, `api/routes/owner.ts`, `db/seed/seed.ts`; `db/package.json`, `services/api/package.json` and `pnpm-lock.yaml` (both depend on the forms package); `forms/scripts/export.ts` (the `Preset` type moves to `install.ts`) | F3-tests, E-presets |
| F3-routes | T | `api/forms/definitions.ts`, `api/routes/forms.ts`, `api/app.ts` (the register line, and the one exception to `no-store`: a definition found, matched by its exact header, forms 3.3) | F3-install |
| F3-contract | R | `api-test/permissions.test.ts`, the generated contract, `packages/contract/test/spec.test.ts` (a note type's key and version are the only path parameters that are not IDs, with exactly 0017's patterns) | F3-routes |

### F4 Definitions on the phone (forms 3.4)

| Card | Level | Files | Needs |
|---|---|---|---|
| F4-tests | X | `phone-test/forms/definition_store_test.dart`, `phone-test/forms/forms_api_test.dart`; as built also `phone-test/forms/definition_hooks_test.dart` (where the phone fetches and deletes, with the real session and sync controllers) and `phone-test/forms/forms_fake.dart` (the forms routes, faked in front of the fake sync server), and after wave D's review `phone-test/forms/app_wiring_test.dart` | F2 |
| F4-store | T | `phone/forms/definition_store.dart` | F4-tests |
| F4-fetch | T | `phone/forms/forms_api.dart`, `phone/forms/forms_providers.dart` | F4-store, F3-contract |
| F4-hooks | X | `phone/auth/session_controller.dart`, `phone/sync/sync_controller.dart` (as built: every team's list once the sign-in that read `/v1/me` is unlocked, bound to that sign-in; at each sync the open team's list and the versions its notes name, which L4 supplies as `heldNoteTypes`; the files deleted at every sign-out and with a wiped team: forms 3.4), `phone-test/sync/sync_controller_test.dart` (its fake forwards `afterSignIn`); after wave D's review also `phone/app_providers.dart` (the app's store, in the databases' folder, with the bundled presets) and `phone-test/helpers/app_harness.dart` (the same store, and the fake forms routes) | F4-fetch |

### F5 The renderer (forms 8). Folder: `phone/features/forms/`, tests under `phone-test/features/forms/`

Every card is level R and includes its widget test file. As built, each kind card after the first
seven also wrote its kind's case of the field host and of `field_host_test.dart`, which F5-smoke
applied; the unit's review changed only the unit's own files (forms 8).

| Card | Files | Needs |
|---|---|---|
| F5-field-host | `field_host.dart`. As built after the seven cards below, whose widgets it draws, with the unit's test helper, `phone-test/features/forms/forms_test_helpers.dart`, which F5-info began | F2 |
| F5-info, F5-text, F5-flag, F5-date, F5-time, F5-duration, F5-photo | one file each: `info_field.dart` and so on. As built before F5-field-host. `text_field.dart` also holds what the other widgets share: `TypingSaver` (an answer saved as typing pauses), `limitCodePoints` and `ReadOnlyAnswer` | F5-field-host |
| F5-choice | `choice_field.dart` (chips, exclusive options, blocked pairs, Other with its text). As built the Other text is F5-text's `NoteTextField`, kept at the host's `otherTextPath` | F5-field-host |
| F5-number | `number_field.dart` (range, unit, the second unit, stepper, out of N). As built it saves through F5-text's `TypingSaver` | F5-field-host |
| F5-group | `group_field.dart` (stack, row, collapsed). As built it takes a builder that draws each of its fields, not a value, and holds `Collapsible`, which F5-grid uses; the test helper gained `kindWidget` | F5-field-host |
| F5-grid | `grid_field.dart`. As built it takes a builder for its cell, and uses F5-group's `Collapsible` and F5-choice's `pickedCodes` | F5-choice, F5-number |
| F5-region | `region_field.dart` (the list of regions by front and back). As built one list of regions, with Front or back the surface's own choice (forms 10.1 #3), each part an F5-choice choose-one; built with F5-region-side in one change | F5-choice |
| F5-region-side | `region_field.dart` (side and surface). As built with F5-region | F5-region |
| F5-problem | `problem_field.dart` (search of the problem code list). As built it reads phase 3's `problemCodesProvider`, so the test helper puts every widget in a `ProviderScope` | F5-field-host |
| F5-action | `action_field.dart`. As built with `ActionHandler`, what the screen gives each action to do | F5-field-host |
| F5-form-shell | `note_form.dart` (sections as an accordion). As built the form lays out groups, grids and actions itself and hosts only the fields that store answers, giving the host a grid's `cell` (`field_host.dart` and its test); `note_form_test.dart`; the test helper's `pumpForm` | the widget cards |
| F5-form-recap | `note_form.dart` (a section's header shows its recap line) | F5-form-shell |
| F5-form-repeat | `note_form.dart` (entries: add, remove, titles). As built with `note_form_entries_test.dart` | F5-form-shell |
| F5-form-normal | `note_form.dart` (one-tap Normal). As built per section, per entry and per system (forms 10.3 #7), with `note_form_normal_test.dart` | F5-form-shell |
| F5-read-view | `note_read_view.dart` | F2 |

| Card | Level | Files | Needs |
|---|---|---|---|
| F5-smoke | X | `phone-test/features/forms/presets_smoke_test.dart` (every bundled note type, three themes, 200% text, 320 px). As built also 200% text on a 320 px phone in Day and Night run (`formRuns`, from the unit's review), each note drawn as it opens, answered and read-only, and its read view. It found the host still without the later cards' cases and applied them (`field_host.dart`, `note_form.dart` and their tests) | F5-form-normal, E-presets |

### F6 The definitions (forms 4, 5, 6). Folder: `forms/definitions/`

| Card | Level | Files | Needs |
|---|---|---|---|
| F6-spec-pieces | X | `spec/<piece>.txt` for the 35 pieces, copied from the field specification, with `[left out]` where a line must not be copied. The red flags note type is a piece of its own: `general-2` is lines 29 to 35 and 61 to 62, and `red-flags` lines 36 to 60 (`forms-inventory.md` section 8). Wound care is one piece, `wound` (63 to 119), and so is MSK, `exam-msk` (912 to 1068): a section names one piece, and each is one repeating section (forms 4.1). The pieces and their ranges are `PIECES` in `forms/test/definitions.test.ts` | F0-spec-check |
| F6-shapes-notes | X | `spec/<piece>.shape.json` and `spec/<piece>.diff.json` for the 13 note type pieces, from `forms-inventory.md`. A shape file holds every key of every section and field, the option codes in order, the file it is for (`file`), the note type's header on exactly one shape file per note type, and `outside` for a section that names no piece; a diff file has all four keys, even when a list is empty (forms 4.1, 4.2) | F6-spec-pieces, F0-shape-check |
| F6-shapes-exam-a | X | The shape and diff files of exam pieces 1 to 11 of `forms-inventory-focused-exam.md` section 7 (10 and 11, MSK, being one piece, `exam-msk`), written as F6-shapes-notes says | F6-spec-pieces, F0-shape-check |
| F6-shapes-exam-b | X | The shape and diff files of exam pieces 12 to 23, written as F6-shapes-notes says | F6-spec-pieces, F0-shape-check |
| F6-lists | R | `lists/*.json`: the shared lists of forms 4.4, `surface` (Anterior, Posterior) and Skin's side list (Right, Left, Midline) among them, 17 in all. A list has no shape file: a person reads its codes, order, flags and count against the lines when the unit is reviewed, and `forms/test/definitions.test.ts` pins each list's codes, labels, order and flags. A list no plan uses is removed (`yes_no_unsure` was): the test holds every list to a use | F0-validate-flags |
| F6-red-flags | R | `note-types/red_flags_disposition/v1.json` (field specification lines 36 to 60: the piece `red-flags`, with its own three files) | F6-lists, E-presets, F6-shapes-notes |

The transcription cards, each level S, each one definition file, each needing F6-lists,
E-presets and the shape card of its piece:

| Card | Piece (field specification lines) | Goes into |
|---|---|---|
| F6-general-1 | 5 to 25 | `note-types/general_primary_care/v1.json` |
| F6-general-2 | 29 to 35 and 61 to 62 | the same file, after F6-general-1 |
| F6-wound | 63 to 119 (the treatment a group inside each wound) | `note-types/wound_care/v1.json` |
| F6-harm-reduction | 120 to 148 | `note-types/harm_reduction/v1.json` |
| F6-psychological | 150 to 171 | `note-types/psychological/v1.json` |
| F6-sexrepro-1, -2, -3 | 173 to 203; 204 to 243; 244 to 251 | `note-types/sexual_reproductive/v1.json`, in order |
| F6-social-needs | 252 to 267 | `note-types/social_needs/v1.json` |
| F6-outreach | 268 to 282 | `note-types/outreach/v1.json` |
| F6-quick-1, -2 | 283 to 307; 308 to 332 | `note-types/quick_encounter/v1.json`, in order |
| F6-exam-01 to F6-exam-09, F6-exam-12 to F6-exam-22 | the exam pieces of `forms-inventory-focused-exam.md` section 7 with those numbers | one module each: `modules/exam_<name>/v1.json` |
| F6-exam-msk | 912 to 1068 (pieces 10 and 11, one piece) | `modules/exam_msk/v1.json`: the section `msk`, one entry per region, and `msk_gait`, gait once for the exam |
| F6-exam-picker | 1780 to 1836 and 2032 to 2036 (piece 23) | the `exam` section of the General note type |

Three transcription cards also name another note type, which the export refuses until that note
type exists (`validate.unknown_note_type`), so each needs its card too. F6-wound needs
F6-red-flags: a wound's Urgent infection concern opens the Red flags note. F6-psychological needs
F6-red-flags, for its safety action, and F6-harm-reduction, which its reason Substance use
suggests. F6-outreach needs F6-general-1, F6-psychological and F6-social-needs, which its new
needs Medical, Behavioral and Social suggest (PRD main 433). The Skin and Foot modules open Wound
care; General is checked with them once F6-general-assemble includes them, after F6-wound.

| Card | Level | Files | Needs |
|---|---|---|---|
| F6-general-assemble | R | `note-types/general_primary_care/v1.json`: the 21 includes, typed as `GENERAL_PLAN` in `forms/test/definitions.test.ts` says (version 1 of each exam module, after the `exam` section and before `problems`, in the order of `forms-inventory-focused-exam.md` section 7, and no `showWhen` on an include, the condition being on each module section; the test holds the file to it once the file exists). `mapsTo` on `note-types/quick_encounter/v1.json`, as the differences of `spec/quick-1.diff.json` and `spec/quick-2.diff.json` name them field by field, and each `mapsTo` in those two pieces' shape files, in the same change (the shape check compares every key); then quick-1's difference "No field carries mapsTo yet" goes | every F6 transcription card |
| F6-release | X | `definitions.lock.json` (every released file, the three files of each piece a released definition names, and each released version's `#resolved` hash: `lockOf` with the pieces), the generated files, which hold only what the lock releases (D78) | F6-general-assemble |

Wave D's review changed the plans of many pieces, and `lists/body_region.json` (Feet, Face and
Groin: forms 10.1 #27), before any release, and added `forms/test/real-definitions.test.ts`, which
holds what a clinician meets on the real definitions: what one-tap Normal fills beside answers
already charted, which findings can be held together, and what counts once a finding hands off
(forms 9).

### F7 Flows (forms 6)

| Card | Level | Files | Needs |
|---|---|---|---|
| F7-tests | X | `phone-test/encounters/red_flags_test.dart`, `phone-test/encounters/expand_quick_test.dart` | L4-complete |
| F7-red-flags-auto | T | `phone/encounters/red_flags.dart` (add the Red flags note with the first Medical note; hard stop 5) | F7-tests, F6-red-flags |
| F7-expand | T | `phone/encounters/expand_quick.dart` | F7-tests, F6-general-assemble |
| F7-expand-control | R | `phone/features/forms/note_form.dart` (the Expand control on a quick form part) | F7-expand, F5-form-shell |
| F7-actions | R | `phone/features/forms/action_field.dart`, `phone/features/encounters/note_screen.dart` (`open_note_type`, `add_referral`) | F5-action, L5-note-screen |
| F7-handoff | R | `phone/features/encounters/handoff_screen.dart` (the lines, through `visibleAnswers` for EMS's reader: no note of a sensitive type and no sensitive exam's findings, whoever shows it, D94) | L5-handoff |
| F7-problem-button | R | `phone/features/forms/problem_field.dart` (Add to the problem list) | F5-problem, L4-problems-link |

### L0 Schema and core rules (lifecycle 2, 3.12, 4.5)

| Card | Level | Files | Needs |
|---|---|---|---|
| L0-migration-0018 | X | `db/migrations/0018_encounter_lifecycle.sql`, `db/test/encounter-lifecycle.test.ts`; after the review also `db/test/helpers.ts` (`refusal`, shared by the four lifecycle test files), `api/sync/entities/note.ts` (every note change takes the team lock), `api-test/sync-concurrency.test.ts`, and the setup of one test in `api-test/sync.test.ts` (it signs its note through a sign-off row) | — |
| L0-migration-0019 | X | `db/migrations/0019_note_signoffs.sql`, `db/test/note-signoffs.test.ts` | L0-migration-0018 |
| L0-migration-0020 | X | `db/migrations/0020_note_attestations.sql`, `db/test/note-attestations.test.ts`; after the review also the comment on `patient_of_change` in `api/sync/review.ts` | L0-migration-0019 |
| L0-migration-0021 | X | `db/migrations/0021_referrals.sql`, `db/test/referrals.test.ts`, `api/patients/charts.ts` (the chart table row) | L0-migration-0018 |
| L0-vectors | X | `vectors/note-lifecycle.json`, `signed-under.json`; the readers `api-test/encounter-rules.test.ts`, `phone-test/encounters/rules_test.dart`. The content hash's `vectors/note-content-hash.json` (21 cases, each on a definition of `vectors/forms-conformance.json`) and its readers, `api-test/note-content-hash.test.ts` and `phone-test/encounters/content_hash_test.dart`, wait for F1 and F2 (`effectiveAnswers`). As built, each reader landed with its side's function: the vectors, the API's reader and L0-content-hash-ts after F1, the phone's reader and L0-content-hash-dart after F2-effective (lifecycle 4.5) | — (the content hash: F1-effective, F2-effective) |
| L0-rules-ts | T | `api/encounters/rules.ts` | L0-vectors |
| L0-content-hash-ts | T | `api/encounters/content-hash.ts` (after the review, a missing patient or summary is written as `null`, as the phone writes it, with a test in `api-test/note-content-hash.test.ts`: lifecycle 4.5) | L0-vectors, F1-effective |
| L0-signed-under-ts | T | `api/encounters/signed-under.ts`; after the review also `api/services/memberships.ts` (a restore records the credential and fields it replaced) and `api-test/foundation.test.ts` | L0-vectors |
| L0-rules-dart | T | `phone/encounters/rules.dart` | L0-vectors |
| L0-content-hash-dart | T | `phone/encounters/content_hash.dart` | L0-vectors, F2-effective |

### L1 Server sync (lifecycle 4). Every card is level X. Folder: `api/sync/`

| Card | Files | Needs |
|---|---|---|
| L1-legacy-tests | A test-only note type for the API fixtures, the fake and the phone tests; phase 2's status tests rewritten as sign-offs (`api-test/sync.test.ts`, `api-test/sync-fixtures.ts`, the phone's sync tests). The setup of "a signed note refuses changes" already signs through a sign-off row (L0). As built: two types, `test_note` and `test_medical`, in `vectors/sync-note-types.json`, which later cards grew; `api-test/sync-encounters.test.ts` begun; `phone-test/sync/test_note_types.dart` with its test, and `sync_scenarios_test.dart`. No status test became a sign-off here: the signed note's test kept its setup and now expects a late change kept (L1-note-late-reopen), and the phone's status sets went with L3-registry. Wave D's review added the live job's install of the types (`db/src/cli.ts`, `db/seed/seed.ts`, `db/test/install-presets.test.ts`, `tools/e2e-db.sh`, `tools/live-sync.sh`) and moved `phone-test/sync/live_api_test.dart` onto them (lifecycle 4.4) | L0, F3-install |
| L1-lock-signer-gate | `entities/encounter.ts`, `entities/note.ts`, `api/encounters/signer.ts` (`noteRules.takesTeamLock` is already true, and every note path keeps it; `credentialChangesAfter` reads the `membership_changes` rows of kind `credential` and `restored`, each with its `old_value`). As built it also stores the note's `medical` column at the create and wires the gate into the create's check, ahead of L1-note-create; `api-test/sync-fixtures.ts` gives every credential its fields | L1-legacy-tests |
| L1-encounter-fields | `records.ts`, `entities/encounter.ts` (new fields; `status` removed; `kind` to Medical only). As built also `entities/fields.ts`, and the phase 2 tests that set an encounter's status: `api-test/sync.test.ts`, `api-test/sync-concurrency.test.ts` | L1-lock-signer-gate |
| L1-envelope-lock | `entities/encounter.ts`, `entities/fields.ts` (kept in history after a finished note; a blank patient can be filled; last seen). As built also `records.ts` (the draft rule's `keptInstead` hook, which the note's late change uses too) | L1-encounter-fields |
| L1-note-create | `records.ts`, `entities/note.ts` (the create checks; the `medical` column; a Medical note makes its visit Medical). As built it changed `entities/note.ts` alone, the `medical` column having come with L1-lock-signer-gate; D79 was built with it, in F3-routes' `api/forms/definitions.ts` and `api-test/forms-routes.test.ts` (forms 3.3) | L1-lock-signer-gate, F3-routes |
| L1-note-answers | `entities/note.ts`, `entities/fields.ts`, `apply.ts` (`checkAnswer` after the load; 1,000 answers; `notCounted`; a throw becomes `definition_error`). As built also `records.ts` (`MAX_NOTE_FIELDS`, `DefinitionError`, `byDefinition`, `definitionOf`) and `vectors/sync-note-types.json` (a section for an answer hidden by a condition) | L1-note-create, F1-check-structure |
| L1-note-late-reopen | `entities/note.ts`, `entities/fields.ts` (late changes kept; the reopen table) | L1-note-answers |
| L1-signoff | `entities/note-signoff.ts`, `entities/index.ts`, `entities/values.ts` (the sign-off row first, then the note's `signoff_id`, both from the same loaded note; the database cannot see a sign-off's effect, so a test pins that a note names only a signature). As built also `sync/schemas.ts` (each new entity joins `ChangeEntity` and `RecordEntity`), `entities/note.ts` (who acts as the author; the note's type and answers), `vectors/sync-note-types.json` (a test-only Red flags type) and `api-test/sync-signoffs.test.ts` | L1-note-late-reopen, L0, F1-finish |
| L1-addendum | `entities/note-addendum.ts`, `entities/index.ts`, `entities/values.ts` (the `(encounterId, noteId)` pair is checked before the insert, so a mismatch answers `stale_reference`). As built also `records.ts`, `sync/schemas.ts` and `api-test/sync-corrections.test.ts` | L1-signoff |
| L1-correction | `entities/note-correction.ts`, `entities/index.ts`, `records.ts` (`corrected` history; `appendHistory` returns the row ID; `app.note_correction` set from the loaded row's ID). As built also `entities/values.ts`, `sync/schemas.ts` and `api-test/sync-corrections.test.ts` | L1-signoff |
| L1-referral | `entities/referral.ts`, `entities/index.ts`, `entities/values.ts` (and the check for a visit of another patient; `error_by` written with the entered-in-error mark, which the database needs). As built also `records.ts` (`visitOfOtherPatient`), `sync/schemas.ts` and `api-test/sync-referrals.test.ts`; wave D's review gave the same check to `entities/allergy.ts` and `entities/problem-note.ts` | L1-lock-signer-gate |
| L1-read-filter | `api/routes/sync.ts`, `review.ts`, `records.ts` (hidden content leaves no value, version or mark; the new records' read rule; a note's new attributes; the sensitive check first). As built also `entities/note.ts`, where a note's attributes and its set rules are, `vectors/sync-note-types.json` (the restricted test types), the contract (the route's description) and `api-test/sync-reads.test.ts`. Wave D's review added `apply.ts` and `push.ts` (a retry answered as its sender may see the field) and `sync/schemas.ts` with the contract (a held item's `hidden`) | L1-correction, F1-visible |
| L1-audit-actions | `entities/values.ts` (`ems_handoff.shown`, `notes_to_finish.viewed`) | L1-lock-signer-gate |
| L1-problem-source | `entities/problem.ts` (as built with the check for a visit of another patient) | L1-lock-signer-gate |
| L1-contract | The generated contract and `vectors/sync-values.json`. As built also `api-test/contract-vectors.test.ts` (every value read through the entities' rules), `api-test/sync-patients.test.ts`, and the phone's readers of the vectors, `phone-test/patients/entities_test.dart` and `phone-test/sync/patient_rules_test.dart`, which skipped the phase 4 cases until L3-registry | the L1 cards above |

### L2 Server routes (lifecycle 5, 6). Folder: `api/encounters/`, routes in `api/routes/encounters.ts`

| Card | Level | Files | Needs |
|---|---|---|---|
| L2-tests | X | `api-test/encounters-{read,timeline,cosign,queues,attest,assign,incomplete,counts}.test.ts` (the attest test pins that an attestation names the note's current signature: the database's key cannot see a sign-off's effect). As built also `api-test/encounters-fixtures.ts`, the helpers they share: a team of readers, a visit charted through sync, the team-lock check, and a test-only Medical note type with a sensitive exam, which stays out of the shared vectors since the phone does not need it. After the review its `finish` sends a visit's sign-offs one after another, so the Red flags note's goes first (lifecycle 11.2) | L1 |
| L2-read-visit | T | `routes/encounters.ts`, `encounters/read.ts`, `api/app.ts` (the register line). As built also `api/patients/schemas.ts` (`VisitRead`, `VisitNote`, the views of what hangs off a note, the read model). After the review `read.ts` holds the only copy of each read rule, which the sync read (`api/sync/review.ts`), the timeline, the lists of notes not complete and the queues call (lifecycle 5.1) | L2-tests, F1-read-corrections |
| L2-timeline | R | `api/patients/charts.ts`, `schemas.ts` (`timeline`, `recentVisits`, both optional). As built with L2-timeline-more in one change: `encounters/timeline.ts` builds both, and `projection.ts` did not change (lifecycle 5.2) | L2-read-visit |
| L2-timeline-more | T | `routes/encounters.ts`, `encounters/timeline.ts` | L2-timeline |
| L2-cosign | T | `routes/encounters.ts`, `encounters/cosign.ts`. As built it also holds what co-sign and attest share (the body, the checks of every note named and left out, the refusals, the caller read again under the team lock) and `actNote`, which the queues ask | L2-read-visit |
| L2-queues | T | `routes/encounters.ts`, `encounters/queues.ts`. After the review it exports `queueRows`, the rows without the audit event, which L2-counts counts | L2-cosign, L2-attest (as built: `canAct` is their rules) |
| L2-attest | T | `routes/encounters.ts`, `encounters/attest.ts` | L2-cosign (as built: it runs on co-sign's `secondAct`, and was built before L2-queues) |
| L2-assign | T | `routes/encounters.ts`, `encounters/assign.ts` | L2-read-visit |
| L2-incomplete | T | `routes/encounters.ts`, `encounters/incomplete.ts` | L2-read-visit |
| L2-counts | T | `routes/encounters.ts`, `encounters/counts.ts`. After the review the queues' numbers are the length of `queues.ts`'s `queueRows` (lifecycle 5.6) | L2-incomplete, L2-queues |
| L2-handoff-pdf | R | `routes/encounters.ts`, `encounters/handoff.ts`, `api-test/encounters-handoff.test.ts` (adds a PDF library: `services/api/package.json` and the lockfile change). After the review the file is headed with the patient from their chart, marks each note's state, prints its times in the reader's time zone, and holds what EMS may be sent whoever exports it (lifecycle 5.7) | L2-read-visit, F1-handoff |
| L2-permissions | R | `api-test/permissions.test.ts` | the route cards above |
| L2-contract | S | The generated contract. As built regenerated with each route card, not once after L2-permissions. After the review also `packages/contract/scripts/dart.ts` and `packages/contract/test/dart.test.ts`: an operation whose success answer is not JSON is left out of the Dart client, with a comment, so the phone never decodes the handoff's PDF as JSON (lifecycle 5.7) | each route card, then L2-permissions |
| L2-seed | S | `db/seed/demo-encounters.ts`, `db/seed/seed.ts`. As built also `db/test/demo-encounters.test.ts`, which holds every seeded row to the API's own functions, imported by the test alone (lifecycle 10.2) | L1, F6-release |

### L3 The phone's sync layer (lifecycle 4.8, 4.9). Every card is level X

| Card | Files | Needs |
|---|---|---|
| L3-registry | `phone/sync/entities.dart` (the changed and new entities; the patient of a new record; the referral's date rule; the two audit actions). As built also `phone-test/patients/entities_test.dart` and `phone-test/sync/patient_rules_test.dart` (the phase 4 vectors run), and `phone-test/sync/local_store_test.dart` (two status sets the registry now refuses). After wave D's review a year below 100 is refused, with two cases in `vectors/sync-values.json`; the bound on `noteTypeVersion` is still owed (lifecycle 4.8) | L1 |
| L3-store-finish | `phone/sync/local_store.dart`, `phone-test/sync/store_encounters_test.dart` (`finishNotes`: the hash shown, the fix path, the Red flags note first, hidden answers dropped). As built also the visit as wave D keeps it (`createEncounter` takes `locationText`, `kind` is a field, a visit's status comes from the snapshot, a fixed visit create carries `locationText`) and one test of `phone-test/sync/local_store_test.dart`; the caller passes each note's act and statement version (`NoteToFinish`), a `Signer`, a synchronous `definitionOf` and `redFlagsFinished`. Its review added hard stop 2 (`needs_attention`), a sign-off made and fixed only by `finishNotes`, the answers Complete dropped carried in a note's fixed create, and the settling of every refused sign-off, for which `signoffEffect` gained `emptyDraft` in L0's and L1's files: `api/encounters/rules.ts`, `phone/encounters/rules.dart`, `vectors/note-lifecycle.json`, `phone-test/encounters/rules_test.dart`, `api/sync/entities/note-signoff.ts`, `api/sync/schemas.ts` with the contract, the test server and its parity test, `api-test/sync-{signoffs,corrections}.test.ts`, and L2-seed's `db/test/demo-encounters.test.ts` (lifecycle 3.3, 3.4, 3.12, 4.8) | L3-registry, L0-rules-dart, L0-content-hash-dart; as built also F2-finish (`finishCheck`) |
| L3-store-lock | `phone/sync/local_store.dart` (the lock by effect; reopen gets through; a note on any encounter). As built also `phone-test/sync/store_encounters_test.dart`, the reopen as a call of its own (`reopenNote`), and what hangs off a visit filed under its patient (`patientVia`). Its review, as the coordinator decided, added a note's `everSigned` and a visit's `hasFinishedNote` to the sync read, which the reopen and the envelope lock read, in L1's `api/sync/entities/note.ts`, `api/sync/review.ts` and `api/sync/schemas.ts` with the contract, the test server with `fake_reads_test.dart` and `fake_parity_test.dart`, and `api-test/sync-{reads,encounters}.test.ts`; it refuses on the phone a visit's kind set back from Medical and its patient removed, and refiles what hangs off a visit whenever its patient changes (lifecycle 4.3, 4.4, 4.8) | L3-store-finish |
| L3-store-receipts | `phone/sync/local_store.dart` (receipts settle the effect; a sign-off held for review; the clock guard). As built also `phone-test/sync/store_encounters_test.dart`, and in L5-needs-attention's `phone/features/sync/sync_labels.dart` the sentences of `change_not_applied`, `signoff_not_applied` and `finished_differently`, with `phone-test/features/sync_labels_test.dart`. Its review made the notice that a held sign-off will not reach the chart a kind of its own, naming the sign-off, once per sign-off, in L1's `api/sync/review.ts`, the test server with `fake_parity_test.dart`, and `api-test/sync-signoffs.test.ts`, with a case against the real API in `phone-test/sync/live_api_test.dart` (lifecycle 4.6, 4.8, 9.13) | L3-store-lock |
| L3-fake-encounter | `phone-test/sync/fake_server.dart` (rules 1 to 6 and 13 of lifecycle 4.9). As built with their cases in `fake_parity_test.dart`, and `phone-test/features/sync_flow_test.dart` and `phone-test/sync/sync_scenarios_test.dart` moved onto the test-only type | L3-registry |
| L3-fake-signoff | `phone-test/sync/fake_server.dart` (rules 7 to 10), with their cases in `fake_parity_test.dart` | L3-fake-encounter |
| L3-fake-rest | `phone-test/sync/fake_server.dart` (rules 11, 12 and 14 to 17), with their cases in `fake_parity_test.dart` and `fake_reads_test.dart`. As built also `phone-test/sync/sync_scenarios_test.dart`, whose answers now fit the type's 4,000 characters | L3-fake-signoff |
| L3-parity | `phone-test/sync/fake_parity_test.dart`, `fake_reads_test.dart`. As built, each rule's cases were written with its code by the three cards above, and this card removed each rule to see its cases fail; wave D's review found rules that no case held, and added cases for them (lifecycle 4.9) | L3-fake-rest |

### L4 The phone's domain layer (lifecycle 3, 7, 8). Folder: `phone/encounters/`, tests under `phone-test/encounters/`

| Card | Level | Files | Needs |
|---|---|---|---|
| L4-tests | X | The test files of this unit's T cards | L3 |
| L4-models-read | T | `encounter_models.dart`, `encounter_repository.dart` (read a visit from the store, the read logged) | L4-tests, F4-fetch |
| L4-start | T | `encounter_repository.dart` (start an encounter, add a note, remove a note, switch to Medical). As L3 built the store: Remove this note, on a note whose sign-off was refused, calls `finishNotes` for that note once its answers are blank, so the refusal settles at the next sync (lifecycle 3.4, 4.8) | L4-models-read |
| L4-complete | T | `complete.dart` (hard stops 1 to 4, then `finishNotes` with the hashes shown). As L3 built the store, `finishNotes` checks hard stops 1, 2, 3 and 5 and the hash itself, and throws, writing nothing (`ChartingPaused`, `NoteChanged`, `LocalValidationError` `needs_attention`, `incomplete`, `red_flags_first`, `not_author` or `empty`, `RecordLocked`); this card still works out what stops Complete for the summary screen (lifecycle 9.6), hard stop 4 included, which the store does not check. It passes each note's act and statement version (`NoteToFinish`), a `Signer` from the saved profile, a synchronous `definitionOf` and `redFlagsFinished` when the visit read shows a teammate's finished Red flags note; draws the hashes with `contentHashOf`; shows `NoteChanged` as "This note changed. Read it again."; expects a note whose fix only settles a refusal to be left out of the map; checks `sentForReview` first; and after a reopen while the first sign-off waits reads `RecordLocked` as "the last Complete must sync first" (lifecycle 4.8) | L4-start |
| L4-note-actions | T | `note_actions.dart` (reopen, addendum, correction). As L3 built the store: the reopen is `reopenNote` with the definition of the note's own key and version (`nothing` for a draft; `RecordLocked` for a note finished for good or sent for review; `not_author`); an addendum or a correction on a note the phone does not hold opens the note first (`openServerRecord`), since the store files it under its patient through the note and takes no patient hint (lifecycle 4.8) | L4-complete |
| L4-referrals | T | `referrals.dart` | L4-models-read |
| L4-notes-to-finish | T | `notes_to_finish.dart` (the phone's drafts merged with the server's list; the offline read logged) | L4-models-read |
| L4-online | T | `encounter_api.dart` (the visit read, the queues, co-sign, attest, counts) | L2-contract |
| L4-timeline | T | `timeline.dart` (the chart's list merged with unconfirmed visits) | L4-models-read |
| L4-close-sweep | T | `close_sweep.dart` (close finished notes with nothing waiting, and drafts untouched for 7 days). As L3 built the store: a note `sentForReview` is not closed, so the refresh settles an admin's accept and the notice finds the note (lifecycle 4.8) | L4-complete |
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
| L5-needs-attention | `phone/features/sync/sync_labels.dart`, `phone/features/sync/needs_attention_screen.dart` (the sentences, the notices, the buttons that settle each problem). As L3 built the store, `noticeLabel` already words `change_not_applied`, `signoff_not_applied` and `finished_differently` (lifecycle 9.13). A `signoff_not_applied` notice names a sign-off (`ServerNotices.entityOf` gives `note_signoff`): Open the note finds the note by the sign-off record's `noteId` while this phone holds it; for one it knows nothing of, by the note the notice also names (D104, built first in wave F; lifecycle 4.8). `finished_differently` names the note | L3 |
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
| F6 | 34 | | 3 | 5 | 42 |
| F7 | | 2 | 4 | 1 | 7 |
| L0 | | 5 | | 5 | 10 |
| L1 | | | | 15 | 15 |
| L2 | 2 | 8 | 3 | 1 | 14 |
| L3 | | | | 8 | 8 |
| L4 | | 9 | 2 | 1 | 12 |
| L5 | 1 | | 20 | | 21 |
| L6 | 1 | | 8 | | 9 |
| L7 | | 2 | 1 | 2 | 5 |
| **All** | **38** | **67** | **64** | **49** | **218** |
