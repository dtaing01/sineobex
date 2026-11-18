> **Reviewed (Nov 14).** Four reviewers checked this design and the lifecycle part against the PRD, the code, the rules that never bend and the task-card rules; their 95 findings are applied. Section 10 lists what a person still has to decide. In build since Nov 16: which units are on the branch is in the Status table of `docs/design/phase-4-encounters.md`, and the sections marked "as built" say what the code does where it says more than the design did.

# Phase 4 design, part 1: forms and note types

This part covers the forms: the definition format, how definitions reach the API, the phone and
the portal, how the field specification becomes definitions, the rules that read a definition,
the renderer, and the tests. The other part (`docs/design/phase-4/lifecycle.md`) covers how an
encounter is stored, completed, signed, attested, corrected and synced.

Who builds from this: a small local model, one task card at a time (`docs/plan/README.md`). The
design puts the judgment in four places the small model does not write: the format, the
generator and its checks, one small interpreter written twice and pinned by shared vectors, and
one widget per kind of field. After that, a note type is data, and adding one is transcription.

Names used:

- **SPEC** is the field specification, the PRD's Google Doc Contents tab
  (`prd/google-doc-contents.md`). `SPEC 63` means line 63 of the Markdown export taken on Nov 14.
- **PRD main** is the PRD's main tab (`prd/main.md`), cited the same way.
- **The inventories** are `forms-inventory.md` (SPEC 1 to 332) and
  `forms-inventory-focused-exam.md` (SPEC 333 to 2,036), beside this file. They list every note
  type, section and field with line ranges, and every ambiguity with a suggested default. This
  design does not repeat them.

## The design in one page

1. **A note type is one JSON file per version.** Once released, a version file is never edited,
   like a migration. A change is a new version file. A lock file of hashes fails the build if a
   released file changes.
2. **Fourteen kinds of field cover the specification** (2.3), with one thing left for later: the
   link from a skin finding to an earlier one (6.8). A new option, field or section is a data
   change. A new kind of field is the only thing that needs code.
3. **Answers are a flat map from a path to a value**, as phase 2 already stores them. A path has
   at most four parts. Repeating entries (wounds, skin findings) get their own path part, so two
   phones adding entries offline never touch the same field.
4. **Definitions live in the database, per team and per version** (D13), and are installed from
   the files in this repository. Phase 5 adds editing; nothing here has to change for it.
5. **A phone only starts a note on a version the server listed for its team.** The app bundles
   the presets so it rarely has to download one, and checks each by hash.
6. **One interpreter, written twice.** Eleven small pure functions read a definition and a
   note's answers: what is visible, what stops Complete, what one-tap Normal fills, the recap,
   who may see what. TypeScript runs them on the server, Dart on the phone. One vector file pins
   both, and a generated golden file pins both on every real note type.
7. **The portal has no interpreter.** The API hands it a note already laid out for reading.
8. **Transcription is checked by a machine.** Each piece of SPEC is copied into the repository
   beside the definition made from it, and a script compares the two. The auditor reads only the
   differences that were declared on purpose.
9. **Red flags, disposition and follow-up are one short note per Medical encounter**, not a
   section repeated in every Medical form (6.2).
10. **The Focused Exam is sixteen systems, written as modules included in the General note
    type.** A module is a file of its own, one per piece of the specification, so each is one
    transcription card.

## 1. Ground truth: what the code has today

| Fact | Where | What it means |
|---|---|---|
| `packages/forms` does not exist. The root `package.json:19` already has the script `forms:export`, which calls `pnpm --filter @sineobex/forms export`. | `package.json`; `ls packages` shows only `contract` | The package is new. Its export script must be named `export`. |
| D13: "Form definitions are data. `packages/forms` holds the eight categories as typed definitions; they are seeded into `note_type_versions` as platform presets, and the phone downloads the team's versions at sync (bundling the presets for first-run offline)." | `IMPLEMENTATION_PLAN.md:83` | This design follows it, and reads "first-run offline" narrowly (10.3 #1). |
| A note stores `note_type_key`, `note_type_version` (a nullable integer) and `data`, a JSON object of answers keyed by path. | `db/migrations/0004_sync.sql:54-73` | The storage is right as it is. |
| A note type key matches `^[a-z][a-z0-9_]{1,60}$`. An answer path matches `^[a-z][a-zA-Z0-9_]{0,60}(\.[a-z][a-zA-Z0-9_]{0,60}){0,3}$`: one to four parts, each starting with a lower-case letter. | `services/api/src/sync/records.ts:42-43` | Paths in this design fit that pattern. The wire format does not change. |
| One value is at most 64 KiB. One note has at most 300 answers. The file's header says "Phase 4 replaces the open `data.<path>` rule with the team's versioned note type definitions". | `services/api/src/sync/records.ts:17-31` | The definition becomes the rule. The 300 limit must rise (2.4). |
| Each answer is its own change, with its own version, history row and receipt. Two people's edits merge field by field. | `services/api/src/sync/entities/note.ts`; `services/api/src/sync/entities/fields.ts:173-218` | A field must be small enough that a conflict on it is easy to read side by side. |
| Generated data already flows from one script to TypeScript modules, Dart modules and a phone asset. | `packages/contract/scripts/gen-patient-data.ts:182-211`; `apps/mobile/pubspec.yaml:45-46` (`assets/problem_codes.json`) | The forms export copies this shape. |
| CI fails when generated files drift. | `tools/ci-local.sh:23-25`; the Contract drift job in `.github/workflows/ci.yml:131` | A Forms drift step sits beside it. |
| The problem code list is on the phone, offline. | `apps/mobile/assets/problem_codes.json` | The diagnosis search in the General note uses it. |
| The phone has shared widgets for a text field that holds patient details, a section heading and choose-one chips. | `apps/mobile/lib/features/patients/patient_widgets.dart:24`, `:113`, `:138` | The field widgets build on these. |
| The portal has a side-by-side component and a field history component. | `apps/portal/src/components/SideBySide.tsx`, `FieldHistory.tsx` | The visit page reuses them. |
| No table holds note types. | `db/migrations/` | Migration `0017` is new (3.1). |

## 2. The form definition format

### 2.1 Files

```
packages/forms/
  definitions/
    lists/<name>.json                  shared option lists (wound_type, side, pulse_scale, ...)
    modules/<name>/v<N>.json           a block of sections included by note types (one per exam piece)
    note-types/<key>/v<N>.json         one note type, one version
    spec/<piece>.txt                   the lines of SPEC a definition was transcribed from
    spec/<piece>.diff.json             the differences from SPEC made on purpose, each with its reason
    spec/<piece>.shape.json            the planner's decisions for the piece: its sections and fields (4.2)
  definitions.lock.json                the hashes of every released file, of the piece files a released
                                       definition names, and of each released version's resolved definition
  schema/definition.schema.json        the JSON Schema of the three file kinds
  src/                                 the path model, resolver, validator, lock, version rules, spec and shape
                                       checks, the installer (3.2) and the interpreter (TypeScript)
  scripts/                             export.ts, golden.ts and lock-grows.ts (4.1, 4.2, 7.3)
  generated/presets.json               every released note type version, with includes and lists resolved,
                                       and its hash (D78: a draft is never a preset)
  generated/golden.json                what the interpreter says about each preset (7.3)
apps/mobile/assets/forms/presets.json  the same bytes as generated/presets.json, written by the export
```

A **resolved** definition has no include and no list reference: every module and list is copied
in. The API, the database and the phone only ever see resolved definitions.

As built (unit F0):

- **A module file** is `{ name, version, sections }`, at `modules/<name>/v<N>.json`. It holds
  sections only, never an include: nothing in SPEC needs a module inside a module, and the
  resolver stays one pass.
- **A shared list file** is `{ name, options }`, at `lists/<name>.json`, with no version. Once
  released the lock holds it like any other file, so a list that must change after release is a
  new list under a new name.
- The resolver (`src/resolve.ts`) checks that each file's content names the key or name, and the
  version, that its path gives (`resolve.misplaced_file`): otherwise a module could be included
  under one name while saying it is another.
- **In a resolved definition a region's `side` and `surface` are option lists**, copied from the
  shared lists they name (2.2), because the interpreter and the phone are handed a definition and
  no lists. `renames` (2.6) is left out, so the hash the server stores does not depend on it.
- **A resolved definition is made only by `resolve()`**, from files that passed the schema check,
  and is then checked by `validate()`. Nothing stores a definition that did not go through those
  three, so the resolved form has no JSON Schema of its own: it does not fit the file schema (a
  region's side is a list of options, not a list's name), and the types in `src/resolve.ts` are its
  description.
- **The package's index is safe for the API's bundle.** `src/index.ts` reaches only pure modules
  that import no package, and a test scans every source file it reaches for an import outside the
  package, `Buffer`, `process`, `require(`, a dynamic `import(` and `Function(`. The schema check
  uses a JSON Schema library that builds code at run time, so it is reached only through
  `@sineobex/forms/schema`, by the export and the tests.

### 2.2 The shape

Written as TypeScript types here; `schema/definition.schema.json` is the same thing as a JSON
Schema, and `src/types.ts` is generated from neither: it is written by hand once and tested
against the schema.

```ts
type NoteType = {
  key: string;                       // ^[a-z][a-z0-9_]{1,60}$
  version: number;                   // 1, 2, 3, ...
  title: string;                     // "Wound care"
  kinds: ('medical' | 'non_medical')[];   // which encounters offer it; offered for Medical only = a Medical note type
  group: 'clinical' | 'psych' | 'social' | 'outreach' | 'harm_reduction' | 'wound';   // its timeline filter
  sensitivity: 'none' | 'sensitive'; // 'sensitive': needs patients.view_sensitive to read
  quick?: true;                      // the Quick encounter
  auto?: 'medical';                  // added by itself with the first Medical note of an encounter (6.2)
  sections: (Section | Include)[];
  renames?: Rename[];                // labels this version rewords on purpose (2.6); not resolved
};

type Rename = { path: string; code?: string; from: string; to: string };   // 2.6

type Module = { name: string; version: number; sections: Section[] };      // modules/<name>/v<N>.json
type OptionList = { name: string; options: Option[] };                     // lists/<name>.json

type Include = { include: string; version: number; showWhen?: Condition };   // a module

type Section = {
  id: string;                        // first part of every path in it
  title: string;
  showWhen?: Condition;
  sensitiveExam?: true;              // needs patients.view_sensitive_exams to read
  treatmentRecord?: true;            // substance use treatment: needs a clinical credential to read
  needs?: 'orderMedications';        // shown to, and changed by, a credential with this capability only
  normal?: true;                     // offers one-tap Normal
  repeat?: { max: number; itemTitle: string };   // "Wound {n}"; entries are added one at a time
  fields: Field[];
  spec?: string;                     // the piece under definitions/spec/ it was transcribed from
};

type Common = {
  id: string;                        // one path part
  label: string;                     // may be a full question
  help?: string;
  showWhen?: Condition;
  required?: true;                   // stops Complete while it is visible and empty
  sides?: true;                      // recorded once for right and once for left
  noNormal?: true;                   // one-tap Normal never fills it (chaperone, consent)
  recap?: false;                     // left out of the recap
  handoff?: true;                    // goes into the EMS handoff summary
  mapsTo?: string;                   // "<note type key>:<path>": the full module's field, without any entry part (6.4)
};

type Field = Common & (
  | { kind: 'choice'; many: boolean; options: Option[] | { list: string };
      excludes?: [string, string][] }                       // pairs that can't be held together
  | { kind: 'text'; lines: 'one' | 'many'; maxLength: number }
  | { kind: 'number'; min: number; max: number; decimals: 0 | 1 | 2; unit?: string;
      altUnit?: { unit: string; perUnit: number };          // inches: 2.54 cm each; stored in cm
      display?: 'box' | 'stepper' | 'outOf';
      normal?: number }                                     // what one-tap Normal fills (strength: 5)
  | { kind: 'flag'; clears?: string[] }                     // a tick; while set, these sibling fields do not count and are disabled
  | { kind: 'date'; range: 'past' | 'future' | 'any' }
  | { kind: 'time' }
  | { kind: 'duration'; max?: number }                      // weeks and days, stored as days; max in whole days, 1 to 36,525
  | { kind: 'group'; layout: 'stack' | 'row'; collapsed?: true; fields: Field[] }   // collapsed: closed until tapped
  | { kind: 'grid'; rows: Option[] | { list: string } | { pickedIn: string }; cell: Field;
      collapsed?: true }                                    // one cell per row; see 2.3
  | { kind: 'region'; options: Option[] | { list: string }; side?: string; surface?: true }   // a body region
  | { kind: 'problem' }                                     // one diagnosis from the problem code list: its code and label
  | { kind: 'photo'; max: number }                          // phase 8; shown as a placeholder until then
  | { kind: 'action'; action: 'show_handoff' | 'add_referral' }
  | { kind: 'action'; action: 'open_note_type'; noteType: string }
  | { kind: 'info' }                                        // the label is guidance; nothing is stored
);

type Option = {
  code: string;                      // stable, ^[a-z][a-z0-9_]{0,40}$; never reused for a new meaning
  label: string;                     // exactly as SPEC writes it
  exclusive?: true;                  // picking it clears the others (None, Normal, No)
  other?: true;                      // needs a short text, stored beside the answer
  normal?: true;                     // set by one-tap Normal
  unable?: true;                     // "Unable to assess": neither normal nor abnormal
  icon?: string;                     // a design-system icon name (PRD main 419)
  suggests?: string;                 // a note type key to suggest on the summary screen
  sensitiveExam?: true;              // in the exam picker: a system whose name is itself sensitive (6.6)
};

type Condition =
  | { field: string; is: string | string[] }   // a choice at this path holds one of these codes
  | { field: string; filled: true }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition };
```

A condition's `field` is a path inside the same note type. Inside a repeating section a field of
the same entry is written relative to the entry, starting with `./`. Inside the cell of a grid,
`./` means the row.

**Conditions, as built.** The validator holds them to these rules, which the interpreters (F1,
F2) can then rely on:

- **A condition names an answer path (2.3), not a field.** A field with sides is named at
  `<path>.right` or `<path>.left`, a region at `.region`, `.side` or `.surface`, a problem at
  `.code` (or `.label`), one row of a grid at `<grid's path>.<row code>` (and
  `<grid's path>.<row code>.<child>` when the cell is a group). A condition that names such a
  field without its part, or `filled` on a group, a region or a problem as a whole, names no
  answer (`validate.condition_unknown_field`; the message names the paths the field stores at).
  `is` is allowed only where a code is stored (`validate.condition_not_a_choice`), and only with a
  code that is there (`validate.condition_unknown_code`).
- **`./` is the only way to name a field of the same entry.** An absolute path into a repeating
  section names no one entry and is refused from anywhere (`validate.path_into_repeat`). `./`
  where there is no entry or row, the repeating section's own `showWhen` included, is refused
  too (`validate.relative_outside_entry`).
- **Inside the cell of a grid `./` is the row**, in a repeating section as well, so a cell
  cannot read a field of its own entry. The grid's own `showWhen` is read from the entry and can.
  This is accepted as a limit: a condition that needs the entry goes on the grid.
- A grid's `pickedIn` is read as a condition is, and must name a choose-many answer
  (`validate.picked_in_unknown_field`, `validate.picked_in_not_choose_many`).
- **A condition never reads what a reader may not see.** A condition, or a grid's picked rows,
  in a section without `sensitiveExam` may not read an answer inside a section that has it, nor
  test an option code marked `sensitiveExam`; the same for `treatmentRecord`
  (`validate.condition_reads_restricted`, reported at the condition). What it shows would tell a
  reader without the key what was found. `needs` is not covered: lifecycle 6.4 hides no `needs`
  section from any reader; `needs` decides who may change an answer (rule 5). As built since
  wave B's review, the rule covers everything `visibleAnswers` takes out (lifecycle 6.4), so
  what a reader sees counts by itself:
  - **What a sensitive exam leaves in an open field.** From outside a sensitive exam a condition
    may not test `filled` (or not filled) on a code answer that has a marked option, since the
    marked codes may be all that fills it; any test of the Other text of a marked Other option;
    any test of a cell in a fixed row marked `sensitiveExam`, unless it is read from that same
    row of the same grid; or the side or surface of a region one of whose regions is marked.
    `is` on codes that are not marked stays allowed: it reads the same once the marked codes are
    taken out. Picked rows may not be picked among options of which one is marked. A condition in
    a grid's cell is checked in every row, so an absolute path into another row is caught.
  - **A section that holds a diagnosis.** A condition or picked rows outside a section that does
    not repeat and holds a `problem` field may not read any answer of that section, not only the
    diagnosis's code. A sensitive diagnosis takes its whole section with it for a reader without
    `patients.view_sensitive`, so a field elsewhere that one of its answers shows would say a
    diagnosis is there. A repeating section is out of reach already (`path_into_repeat`).
- No field's showing may depend on its own answer, through conditions, the sections, groups and
  grids around it, picked rows or a clearing flag (`validate.condition_cycle`). The interpreters
  can then work conditions out in dependency order.

**What the schema and the validator add to the types, as built.** The schema check is
`checkFile(kind, file)` in `src/schema.ts`. It is told the kind of file rather than guessing it
from the keys, where a misspelt key would give a misleading kind.

- **Patterns.** A note type key, a module's name, a list's name, and every `include`, `list`,
  `suggests`, `noteType` and region `side` that names one: `^[a-z][a-z0-9_]{1,60}$`. A section's
  or field's `id`, and each entry of `clears`: one path part, `^[a-z][a-zA-Z0-9_]{0,60}$`. An
  option code, and each code of `is` and of `excludes`: `^[a-z][a-z0-9_]{0,40}$`. A condition's
  `field` and a grid's `pickedIn`: one to four path parts, with an optional leading `./`.
  `mapsTo`: `<key>:<path>`. `spec`: a piece's name, `^[a-z0-9][a-z0-9-]{0,60}$`, so it cannot be
  a path. A version: a whole number from 1 to 2,147,483,647 (the table's `int`). A title, label,
  help, unit, icon or `itemTitle`: at least one character that is not a space, and no control
  character below U+0020, no DEL and no half of a surrogate pair.
- **No empty lists**: `kinds`, `sections`, a section's or a group's `fields`, options and rows
  written out, `excludes`, `clears`, `renames`, `is: []`, `all: []` and `any: []`. An empty `all`
  is true and an empty `any` false only by a convention both interpreters would have to share,
  and a choice with no options can never be answered. No code twice in `kinds`, `is` or `clears`;
  each pair of `excludes` is exactly two codes; `perUnit` is above 0; `photo.max` is at least 1.
- **`group` is required** on every note type: the timeline and the visit read need it for every
  note (lifecycle 5.2).
- **`noteType` goes with `open_note_type` only**: required there, refused on the other actions.
- **A region's `side` names any shared list** (`side` has Bilateral, `side_rl` does not, Skin's
  has Midline). `surface: true` asks for the shared list named `surface`: Anterior and Posterior
  (SPEC 1258). The resolver copies both in as option lists, so a condition may test
  `<path>.surface` with `is`. A region's options, side and surface may have no Other and no
  exclusive option (`validate.region_option_flag`).
- **`collapsed`** is allowed on a group and on a grid. It changes no path.
- **A number's `normal`** is what one-tap Normal fills (focused-exam default 28: strength 5 of
  5). It must lie inside `min` and `max`, at the field's `decimals` (`validate.number_normal`).
  There is no `step`: a value in half units is written with `decimals: 1` and a box.
- **`required`** is refused on a group, a grid, a region, a problem, a photo, an action and an
  info (`validate.required_not_allowed`): the last three store nothing and would block Complete
  for ever, and for the first four "filled" has no one meaning.
- **`renames`** (2.6) is a key of a note type file only.
- **A date's `range` is the picker's bound only.** `past` is today or earlier and `future` is
  today or later: both include today. `checkAnswer` has no clock and does not check it (7.1): an
  answer made in range must still be taken when it syncs days later.

Added in wave B's review, each so that the interpreter can rely on it (7.1):

- **One Other option to a field** (`validate.other_twice`). A field's Other options would share
  one text (2.3), which could not say which of them it is for.
- **What one-tap Normal fills can be held as one answer** (`validate.normal_conflict`). A
  choose-one has at most one normal option. In a choose-many no exclusive option is marked normal
  beside another normal option, and no two normal options are a blocked pair. Normal puts every
  normal option of a field in at once, and `checkAnswer` would refuse what it offered.
- **No `handoff` inside a section marked `sensitiveExam` or `treatmentRecord`**
  (`validate.handoff_restricted`): the handoff summary goes to EMS (lifecycle 5.7), who may not
  read those.
- **A flag with sides clears nothing** (`validate.clears_with_sides`). It is ticked for one side,
  and the fields beside it have no side to match, so a tick on the right would stop a length
  charted on the left from counting.

### 2.3 The fourteen kinds, what each stores, and where

| Kind | Stores | At | Covers (inventory construct) |
|---|---|---|---|
| `choice`, one | a code | the field's path | choose-one buttons, scales, sides |
| `choice`, many | a list of codes, in the definition's order | the field's path | choose-many buttons, exclusive options, blocked pairs |
| the text of an Other option | a string of at most 200 characters | the field's path with `_other` added to its last part | "Other" with a text box |
| `text` | a string | the field's path | text boxes |
| `number` | a number in the base unit | the field's path | cm, mm, seconds, doses, counts, scores out of a maximum, the stepper |
| `flag` | `true` | the field's path | "Unable to measure", "Approximate" |
| `date` | `YYYY-MM-DD` | the field's path | dates |
| `time` | `HH:MM` | the field's path | "Time EMS called" |
| `duration` | a whole number of days, at most the field's `max` (whole days, 1 to 36,525), or without one 36,525 (a hundred years) | the field's path | weeks and days |
| `group` | nothing itself | its children add a path part | the vitals row, blood pressure as two numbers, a heading with several fields |
| `grid` | one cell value per row | the field's path, then the row's code. The cell's own ID is not a path part, unless the cell is a `group`: then its children's IDs follow the row's code. With `rows: { pickedIn }`, a row whose option is no longer picked does not count. | pulses by site, reflexes, a status for each vaccine picked, findings for each node group picked |
| `region` | codes | the field's path, then `region` (a code from its options), `side` (a code from the shared list it names: `side` has Bilateral, `side_rl` does not, Skin's has Midline), `surface` (a code from the shared list `surface`: Anterior or Posterior) | the body map |
| `problem` | a code and a label | the field's path, then `code` and `label`. What the note asks about the diagnosis (its status, the interventions) are ordinary fields beside it, and the section repeats, one entry per diagnosis. | the diagnosis search |
| `photo`, `action`, `info` | nothing in phase 4 | | photos, buttons, guidance |

`sides: true` adds a last path part, `right` or `left`.

A `flag` with `clears` does not write to the fields it names. While the flag is set those fields
do not count (`effectiveAnswers` leaves them out) and their widgets are disabled. Two phones can
then never leave a note with "Unable to measure" ticked and a length that counts.

A **repeating section** adds a second path part, the entry's ID: the letter `e` and seven
characters from `a-z0-9`, made on the phone. An entry exists when its `entryAt` answer does: the
time it was added, which also gives the order. Removing an entry sets its `entryRemoved` answer
to `true`; its other answers stop counting. Two phones that each add a wound offline write to
different paths, so nothing conflicts. `entryAt` and `entryRemoved` are reserved: no field may
use them as an ID. (A path part must start with a lower-case letter,
`services/api/src/sync/records.ts:43`, so these cannot start with an underscore.)

Every path has at most four parts, and every part matches the pattern of
`services/api/src/sync/records.ts:43`. The validator works out every path a definition can
produce and refuses a definition with a part that does not match, or with a fifth part: a grid with sides inside a repeating section, for example. Nothing in SPEC
needs one.

As built:

- **The Other text of a field with sides** is at `<field>_other.right` and `<field>_other.left`:
  `_other` goes on the field's own part, before the side. In a grid's cell it is at
  `<grid's path>.<row code>_other`.
- **A field with sides has one condition for both sides.** A follow-up that shows for one side
  only ("Location, when that lung is not Clear") is written as two fields, one for each side,
  each with its own condition.
- **One copy of these rules.** `src/paths.ts` works the paths out (`pathModel`, `leafAt`,
  `pathsOf`); the validator and the version rules use it, and the interpreter (F1) will. It is
  exported from the package's index and imports nothing, so the API's bundle can load it.
- Besides a part that does not match (`validate.bad_path_part`) and a fifth part
  (`validate.path_too_long`), the validator refuses two paths that collide
  (`validate.path_collision`): an ID or a row code that equals another's `_other` path, or an
  answer whose path is also the start of another's. `entryAt` and `entryRemoved` are refused as
  the ID of any field at any depth, a grid's cell included (`validate.reserved_id`).

As built by the interpreter (unit F1, 7.1):

- **`null` clears an answer**, at any path that stores one. A flag and `entryRemoved` store only
  `true`, so unticking a flag, or undoing a removal, writes `null`, never `false`.
- **Characters are Unicode code points**, as Postgres counts them: a `maxLength`, the 200 of an
  Other text and the 300 of a problem label count an emoji as one. The phone's text widgets count
  the same way.
- **`entryAt` is a UTC time**, `YYYY-MM-DDTHH:MM:SS`, then optionally a dot and one to nine
  digits, then `Z`, as the phone writes it (`toUtc().toIso8601String()`). Entries are in the order
  of that time as an instant, and two entries added in one instant in the order of their IDs.

### 2.4 Limits

- `MAX_NOTE_FIELDS` rises from 300 to 1,000 (`services/api/src/sync/records.ts:31`). A General
  note with every exam system charted can pass 300. The definition bounds the paths a note can
  have, and `repeat.max` bounds its entries, so the purpose of the limit (no unbounded history)
  still holds. This change is part of lifecycle card L1-note-answers.
- A `text` field's `maxLength` is at most 4,000. A resolved definition is at most 256 KiB.
- A section's `repeat.max` is at most 20. The phone holds to it. The server checks one answer at
  a time and does not count entries; the 1,000 limit is its bound.
- As built, the validator checks the three limits again on the resolved definition
  (`validate.text_too_long`, `validate.repeat_too_many`, `validate.too_large`). The 256 KiB are
  the UTF-8 bytes of the definition's canonical JSON, as the server hashes it.
- **How many answers a note can hold is printed, not refused.** No definition is refused for the
  number of answers a note on it could hold (every path, each repeating section at its
  `repeat.max`). The export prints that number for each note type, so whoever sets
  `MAX_NOTE_FIELDS` sees how near a form comes to it: the review counted about 540 for Wound care
  at 20 wounds, and a General note with every system charted can pass 1,000 on paper.

### 2.5 One complete small example

```json
{
  "key": "harm_reduction_demo",
  "version": 1,
  "title": "Harm reduction (example)",
  "kinds": ["medical"],
  "group": "harm_reduction",
  "sensitivity": "sensitive",
  "sections": [
    {
      "id": "naloxone",
      "title": "Naloxone",
      "spec": "harm-reduction",
      "fields": [
        {
          "id": "offer",
          "kind": "choice",
          "many": false,
          "label": "Naloxone",
          "options": [
            { "code": "accepted", "label": "Accepted" },
            { "code": "declined", "label": "Declined" },
            { "code": "has_supply", "label": "Already has supply" }
          ]
        },
        {
          "id": "doses",
          "kind": "number",
          "label": "Doses",
          "min": 0,
          "max": 20,
          "decimals": 0,
          "unit": "doses",
          "display": "stepper",
          "showWhen": { "field": "naloxone.offer", "is": "accepted" }
        }
      ]
    }
  ]
}
```

A note written on it could hold `{ "naloxone.offer": "accepted", "naloxone.doses": 2 }`.

### 2.6 Versions

- A note keeps the key and version it was created on (`note_type_version`). It is always read,
  completed and corrected against that version. Nothing migrates a note to a newer version.
- A new version may add, remove or reword anything. It may never reuse a path or an option code
  for a different meaning: reports and supply mappings read codes across versions. The validator
  compares each new version with the one before it and refuses a path whose kind changed or a
  code whose label changed to something the declared `renames` list does not cover.
- A draft started on version 2 stays on version 2 after version 3 is released. New notes use the
  newest version the server lists.

As built (`src/versions.ts`, `checkVersions`):

- **Each version is compared with every earlier version**, not only the one before it: a path
  dropped in version 2 still has version 1's meaning when version 3 brings it back. A version
  that does not resolve is skipped; the resolver says why.
- The rules: a path whose kind of answer changed (`versions.kind_changed`); **a number whose unit
  changed** (`versions.unit_changed`), since a number is stored in its field's unit and the same
  path in another unit is another meaning (dropping a unit, or naming one for the first time,
  passes: the unit compared is the last one a version named); an option's label, or **a field's
  own label at a path it kept**, that changed with no rename declared (`versions.label_changed`);
  and a declared rename that covers no change (`versions.rename_unused`), so the declarations stay
  true.
- **Renames are declared in the version's own file**, as `renames`: a list of
  `{ path, code?, from, to }`. `path` is an answer path of this version without the entry part
  (for a row of a grid, the grid's own path; for an option in a cell, each row's path); `code` is
  an option code there, left out when the entry declares a change of the field's own label;
  `from` is the label in the version before and `to` the label now. A field's own label is named
  at its own path: without a side, without a region's or a problem's part, and once for each row
  in a cell. Group labels and section titles store nothing and are not compared. The resolved
  definition leaves `renames` out, so the hash the server stores does not depend on it.
- Phase 4 ships version 1 of every note type, so these rules first bite in phase 5's editor.

## 3. How definitions reach the API, the phone and the portal

### 3.1 The table: `0017_note_type_versions.sql` (level X)

| Column | Type | Meaning |
|---|---|---|
| `team_id` | `uuid not null` references `teams` | Definitions are per team (PRD main 387) |
| `key` | `text not null`, the key pattern | |
| `version` | `int not null`, 1 or more | |
| `definition` | `jsonb not null` | The resolved definition |
| `hash` | `text not null`, 64 hex characters | `sha256Hex(canonicalJson(definition))` |
| `origin` | `text not null`, `preset` or `team` | Phase 4 writes `preset` only |
| `preset_version` | `int` | The platform version a `preset` row was installed from |
| `created_at` | `timestamptz not null default now()` | |

Primary key `(team_id, key, version)`. Append-only (the `forbid_mutation` trigger of
`0001_base.sql`). The team policy block of `0004_sync.sql:185-195`. No foreign key from
`encounter_notes`: a note's key and version are checked by the sync rules, and phase 2 preview
notes have a null version.

Phase 5 adds its own table for which note types a team offers, archives or has removed, and
writes `origin = 'team'` rows here. Phase 4 offers every installed key.

As built, 0017 has three checks the column list above does not show: `definition` is a JSON
object (`jsonb_typeof`), as every `jsonb` column of the schema is; `preset_version` is 1 or more;
and **a row with `origin = 'preset'` names its `preset_version`**
(`note_type_versions_preset_names_version`), so `installPresets` (3.2) sets it on every row it
writes, to the row's own version, and a `team` row may leave it null. Beside the `forbid_mutation`
trigger the app role loses `update` and `delete` on the table (`revoke`), as every append-only
table has both. `insert ... on conflict do nothing` works for the app role. The row-level policy
also lets a platform-scope request write and read a row of any team, as the policy of 0004 does.
**The hash is checked for its form only** (64 lower-case hex characters): nothing in the database
ties it to the definition. The export computes it (4.1), and the installer writes it as the
export wrote it.

### 3.2 Installing the presets

`installPresets(tx, teamId)` in `packages/forms/src/install.ts` inserts every version in
`@sineobex/forms`'s `generated/presets.json` that the team does not have, with
`on conflict do nothing`. If a row exists with a different hash it throws: a released version
was edited, which the lock file should have stopped. It lives in the forms package because the
seed calls it as well as the API (11).

It runs in three places, each inside a transaction that already exists:

1. When a team is created (`services/api/src/routes/owner.ts`, the team creation route).
2. In the seed (`db/seed/seed.ts`).
3. At the start of `GET /v1/forms/note-types` (3.3), so a team gets a new platform version the
   first time one of its phones asks, with no deploy step. The write is idempotent. When it
   inserts a row it writes the audit event `forms.presets_installed` (the key and version) in
   the same transaction. Here a row with a different hash is logged and that key is skipped: a
   throw would fail the route for the whole team at every sync.

"A later platform update to a preset never overwrites a team's edited copy" (PRD main 387):
from phase 5 on, `installPresets` skips a key whose newest row has `origin = 'team'`.

As built (unit F3):

- **The signature** is `installPresets(sql, teamId, { presets?, onDiffer? })`, which answers
  `{ installed, differing }`, each a list of `{ key, version }`. `sql` is the caller's
  transaction as a tagged template (a postgres.js transaction is one). The installer never opens
  a transaction of its own: the package imports no database library, and the API is bundled for
  an edge runtime. The transaction must be allowed to write the team's rows: the team's own scope
  or platform scope, the two arms of 0017's policy. `presets` is `PRESETS` when left out, the
  export's `generated/presets.json` imported as JSON. The tests install the fixture note types
  instead (passed in, or put in that file's place for the API's tests), since the real file is
  empty until the definitions are released (D78, below).
- **What it does.** It reads the key, version and hash of every row the team holds, then writes
  every preset the team lacks in one statement (`insert ... select ... from
  jsonb_to_recordset(...) on conflict do nothing returning key, version`), each row
  `origin = 'preset'`. The rows travel as one text cast to `jsonb`: a parameter typed `jsonb`
  would be written as one JSON string. Two installs of one team at once write nothing twice: the
  second waits on the first's rows. A version the statement did not write was written by another
  transaction after the read; it is read again, and must hold the preset's hash too. With no
  presets it asks the database nothing.
- **A row with another hash is never overwritten, and never passed over in silence.** By default
  the installer throws `PresetDiffers`, which names each key and version and nothing else, and
  the caller's transaction writes nothing. With `onDiffer: 'skip'` it installs none of that key's
  versions and answers them in `differing`.
- **Team creation** installs in the platform-scope transaction that creates the team and, when
  it installed anything, writes `forms.presets_installed` (`{ installed }`) in the team's audit
  chain. A new team holds no row, so nothing can differ; a failure fails the creation, and no
  team, role or audit event is left.
- **The seed** installs in both seeded teams, the demo team and its neighbour, in platform scope,
  and logs how many versions each got; a second seed writes nothing. It takes `presets` as an
  option, so a test can seed the fixture note types.
- **The list route** installs with `onDiffer: 'skip'` in the team's own transaction, before it
  reads the list (`listNoteTypes`, `services/api/src/forms/definitions.ts`), and writes
  `forms.presets_installed` when it wrote a row, the member whose request wrote it being the
  actor. A differing key is logged as `forms.preset_differs` (level error, with the request, the
  team and how many versions) and is not named: the log's allowlist has no key for it, and the
  team's rows name it. The list still answers, with the row the team holds for that key.

**Decided Nov 17 (D78), built in wave D (`ed3da5b`): a draft is never a preset.** As built in
wave C, the export wrote every version it resolved to `generated/presets.json`, drafts included,
and the installer keeps what it is given for good. A draft installed in a team and then changed,
as a draft may be (4.2), would be reported as "a released version was edited": the list route
would skip every version of that key in each team holding the old draft, and a second seed would
throw. So a version a team holds must never change, and then `PresetDiffers` means what it says.
A released flag on each preset was the other way out; it would put one rule in two places, the
installer and the phone.

As built:

- **The export still checks every version**, drafts included, and writes to the presets, and so
  to the phone's copy and the golden file, only those whose `<file>#resolved` line the lock holds.
  The lock holds that line only with the file's own (`lock.resolved_alone`, 4.2). Every other
  version is printed as a note: "is a draft: the lock does not hold its resolved line, so it is
  checked and not written to the presets".
- **A release run** works out the lock (`lockOf`), writes it, and only then writes the presets,
  from that lock: every version it releases is a preset in the same run, and the presets never
  name a version the lock on disk does not hold. The command's last line counts the released
  versions it wrote, and on a release says so first: "Released the tree in
  definitions.lock.json; wrote generated/presets.json and the phone's copy: N released note type
  version(s)."
- **Until F6-release** the tree has no lock, so the presets, the phone's copy and `golden.json`
  are `[]` though every note type is typed. A test that needs presets releases a fixture tree
  first.

### 3.3 Routes

| Route | Key | Answer |
|---|---|---|
| `GET /v1/forms/note-types` | any member of the team | For each key the team offers: its newest version, title, kinds, sensitivity, `quick`, `auto` and hash |
| `GET /v1/forms/note-types/{key}/{version}` | any member of the team | The resolved definition. It never changes, so it is served with a long cache lifetime |

Neither holds patient data. Neither is audited as a patient read; the install of 3.2 is audited
when it writes.

On the server, `definitionFor(tx, teamId, key, version)` reads one row and keeps it in memory.
Rows never change, so the cache never goes stale. The sync rules and the visit read use it.

As built (unit F3):

- **Both routes are in `services/api/src/routes/forms.ts`**, their work in
  `services/api/src/forms/definitions.ts`. Each takes the team scope, as every team route does:
  an active member of the team named in `X-Team-Id`, whatever their role. No permission key
  guards them, since a definition holds no patient data; `permissions.test.ts` lets every role
  through, one with no permission among them, and refuses a member of another team. Without a
  sign-in the answer is 401, without a team 400 `team_required`, for another team 403
  `not_a_member`. Since wave D the team scope, which every team route takes, logs that refusal,
  and `team_suspended`, as `access.denied` in the platform audit chain, with the rule, the route's
  pattern and the team tried (`services/api/src/auth/context.ts`).
- **The list** answers `{ noteTypes }`, one entry per key the team holds, ordered by key:
  `{ key, version, title, kinds, sensitivity, quick, auto, hash }` of its newest version, read
  from that row's definition (`quick` false and `auto` null where the definition leaves them
  out). It installs first (3.2). Its query names the team itself, so even a platform-scope
  transaction, which row-level security lets read every team's rows, lists one team's. It is
  `no-store`, as every response is but a definition found (below), and is not audited.
- **One version** answers `{ key, version, hash, definition }`, the row the team holds. A key
  outside the key pattern, or a version that is not plain digits from 1 with no leading zero
  (`0`, `01`, `1.5` and `-1` are refused), is 422, so one version has one URL. A version the
  team does not hold is 404 `not_found`, `no-store`, since it may be installed later. A definition
  found is sent with `Cache-Control: private, max-age=31536000, immutable` and
  `Vary: Authorization, X-Team-Id`: private, because from phase 5 two teams may hold different
  definitions at one URL. It is not audited. Its key and version are the only path parameters in
  the contract that are not IDs: they name a form, never a patient, and the contract's test that
  keeps patient details out of URLs (`packages/contract/test/spec.test.ts`) lets exactly these
  two through on exactly this path, with exactly 0017's patterns.
- **The one exception to `no-store`.** The app sets `Cache-Control: no-store` and
  `Pragma: no-cache` on every response (`services/api/src/app.ts`), and leaves one alone only when
  its `Cache-Control` is exactly the definition's value. A handler that sets any other lifetime
  still gets `no-store`.
- **`definitionFor`** answers `{ key, version, hash, definition }`, or undefined, frozen through
  and through, so no caller can change the copy another holds. As built in wave C it kept each
  row it read in a map with no bound, keyed by team, key and version, one copy of the same preset
  for each team; D79 replaced that map (below). A missing row is not kept: it may be installed
  later. The caller's transaction must be in that team's scope, as every team-scope transaction
  is: a kept definition is answered without a read, so the team ID is what keeps teams apart. The
  one-version route and the sync rules (lifecycle 4.4) call it; the visit read (lifecycle 5.1)
  will.

**D79, decided Nov 17, built with its first sync caller (unit L1, wave D).** 0017 checks a hash's
form and not what it hashes (3.1), so `definitionFor` checks each row it reads
(`services/api/src/forms/definitions.ts`):

- **The check, on every read of a row.** The SHA-256 of the row's canonical definition must be
  the row's hash, and the definition's own `key` and `version` must be the row's. The second half
  came from wave D's review (finding NOT-8): one hash is then one key and version, and a row filed
  under another key or version, written by hand or a team's own type from phase 5, cannot answer
  another row's definition. A row that fails throws `DefinitionMismatch`, which names no key, and
  nothing is kept, so it fails the same way every time. A row is checked even when another team's
  row with the same hash is kept already: no definition is answered under a hash it does not have,
  or for a row that does not hold it.
- **Two bounded maps**, each dropping the entry used least recently: one frozen definition per
  hash, at most 64 (`MAX_DEFINITIONS`), so every team holding a preset shares one copy; and team,
  key and version to a hash, at most 4,096 (`MAX_DEFINITION_NAMES`). Rows are append-only (0017),
  so neither map goes stale. A row read again once either map has dropped it is read and checked
  again.
- **What a failing row answers.** The one-version route answers 500 with the app's generic error,
  `no-store`, and never the definition; the log names `DefinitionMismatch` and no key. A sync rule
  turns it into a `DefinitionError` (`definitionOf`, `services/api/src/sync/records.ts`), stored
  as the change's rejection, `definition_error`, so the phone's queue moves on (lifecycle 4.1).
  The phone's test server keeps definitions by key and version and reads no rows; its `forged`
  set stands for a row that fails (lifecycle 4.9).
- **The tests** are in `services/api/test/forms-routes.test.ts`: the route's 500 for a row under
  another's hash, sent twice; a row checked on its first read and never kept; a row filed under a
  key or version its definition does not hold, before and after its hash is kept; one frozen copy
  per hash, shared between teams; and each bound, with the entry it drops.

### 3.4 The phone

- Right after `/v1/me`, and at each sync, the phone asks for the team's list.
- For each entry it needs the definition with that hash. It looks in the bundled
  `assets/forms/presets.json` first, then in its cache, then downloads it.
- The cache is plain JSON files under the app's support directory, one per team, key and
  version, written by `apps/mobile/lib/forms/definition_store.dart`. Definitions hold no patient
  data. They are not in the key-value store. Sign-out and wipe delete them.
- **A phone starts a note only on a key and version from the team's list.** Without a list for
  the team, Start says "Connect once to load your team's note types." This cannot happen after a
  normal sign-in, which is online.
- The phone keeps the definition of every note it holds, whatever its version, so an old draft
  opens offline.

As built (units E and F2): the bundled asset is `apps/mobile/assets/forms/presets.json`, listed
under the assets of `apps/mobile/pubspec.yaml`. The export writes it with the same bytes as
`packages/forms/generated/presets.json`, in the same run, and the Forms drift step fails CI when
either differs from what the export writes (4.2). Each entry is
`{ key, version, hash, definition }`, in key and version order, the definition in canonical key
order. It is an empty list until the definitions are released (D78, 3.2). The phone reads a
definition with `NoteTypeDef.fromJson` (`apps/mobile/lib/forms/definition.dart`), which refuses
a shape the validator would never pass with a `FormatException` that names its place, never a
cast error deep in a screen. The golden test holds each bundled preset's hash to its
definition's (7.3).

As built (unit F4, with the changes of wave D's review):

- **The files** (`DefinitionStore`, `apps/mobile/lib/forms/definition_store.dart`) are in
  `<databases>/forms`, inside the databases' folder, so backups leave them out as they do the
  databases. Under it is one folder per person, named as the databases name the person (the first
  16 hex characters of the SHA-256 of the user ID), so no one is named on disk and one person's
  files go at their sign-out. In it is one folder per team, holding `list.json`, the team's list
  as last kept (each key, version and hash: what Start reads offline), and a
  `<key>.<version>.json` for each version the team listed or the phone downloaded. A version file
  names the hash the team gave that version, and holds the definition only where no bundled
  preset has that hash: a preset is read from the bundle, never copied, and a team's own version
  that shares a key and version with a preset is told apart from it by hash (3.2 never
  overwrites a row with another hash). A file is written whole, through a temporary file. A key,
  version or team ID that could name another folder is refused.
- **What it keeps.** `keep` refuses a definition (`DefinitionRefused`, nothing written) whose hash
  is not the one listed, that names another key or version, or that `NoteTypeDef.fromJson`
  cannot read. `keepList` keeps a list only once every version it names is held, so the phone
  never keeps a list Start cannot use; until then the list kept before stays. A bundled preset
  whose hash is not its definition's is not used. A file changed on disk is ignored and deleted,
  and the next fetch writes it again. Every version a team ever listed stays readable
  (`definition`), and `TeamNoteTypes.startable` offers only the listed one.
- **When it fetches** (`apps/mobile/lib/forms/forms_api.dart`; the calls in
  `lib/auth/session_controller.dart` and `lib/sync/sync_controller.dart`):
  - *After sign-in*, every team's list, one team after another (`LocalData.afterSignIn`), once
    the sign-in that read `/v1/me` is unlocked: when the PIN is set, or when it is entered on a
    phone that already holds the person's vault. The fetch needs the session's token, and a
    sign-in left at the PIN screen leaves nothing on disk. Every team, not only the one chosen,
    so a team first opened offline has its list. The fetch belongs to its sign-in: each team's
    generation is taken before the first request, and the loop stops once the person is no
    longer the one unlocked, so a sign-out part way asks for nothing more and writes nothing back,
    even with the next person's token.
  - *At each sync*, through `DefinitionRefresher`, first among the open team's refreshers, so it
    also runs at open, on the 15-minute timer and on pull to refresh, with no throttle: one small
    `no-store` request each time. It fetches the open team's list, and then, whether the list came
    or not, each version the team's notes name that the phone does not hold
    (`SyncController.heldNoteTypes`: the phone domain layer's query, which L4 supplies; until
    then the app passes none). Its failure never becomes the sync's outcome, and the next run
    tries again.
  - *A fetch* asks for the list, downloads each version neither the presets nor the files hold,
    keeps it only as the listed key, version and hash, and keeps the list last. A fetch that
    fails part way, or brings a definition the phone refuses, leaves the list it had; what
    checked out stays. Two fetches for one team at once are one, but a fetch begun after a
    sign-out is never joined to one begun before it. `fetchVersion`, for a version no list
    names, keeps an answer only when its definition has the hash the server gives, names the key
    and version asked, and can be read.
- **What goes, and when.** Every file of the person's (`forgetUser`) at every sign-out: with
  nothing unsynced and at the tenth wrong PIN (`eraseUser`), at "Log out anyway"
  (`clearServerCopies`), and at a sign-out from the lock screen (`markServerCopiesStale`: plain
  files need no key). A team's folder (`forgetTeam`) with the team's database: at a remote wipe,
  and the wipe that ends a removal's hand-over (`_wipe`); when an unfinished wipe is completed at
  the next device check or at the team's open; and when the team's device ID is gone
  (`_wipeTeam`). Each forget changes the store's generation for that person and team (a
  sign-out, every team's), and `keep` and `keepList` write nothing for a fetch begun before it; a
  wipe of one team stops no fetch of another. A team the person was removed from and never
  opened keeps its folder until they sign out: the phone learns of such a removal only from the
  next sign-in, which a sign-out comes before.
- **The screens** read `teamNoteTypesProvider`, the open team's listed versions with their
  definitions, or null where the phone holds no list and Start shows `connectOnceMessage`; and
  `noteTypeDefinitionProvider`, one key and version, listed or not, for a note the phone holds.
  Both recompute when the open team changes or the store keeps or forgets something, so a screen
  waiting on an old draft's version opens it once the version is kept.
- **The wiring.** `syncControllerProvider` passes `appDefinitionStore()`
  (`apps/mobile/lib/app_providers.dart`), with the presets from the asset bundle. Its folder is
  asked for once, since each call of `databaseDirectory` goes through the platform's backup
  exclusion, and asked again after a failure. The app harness (`test/helpers/app_harness.dart`)
  wires the same store with the presets read from the file (an asset bundle decodes a large file
  on another isolate, which a widget test's fake clock never waits for), and puts the fake forms
  routes (`test/forms/forms_fake.dart`) in front of the fake sync server. Each harness team lists
  the bundled presets, and a team that is not the person's is refused with 403 `not_a_member`, as
  the API refuses it. `SyncController.ready()` does not wait for the sign-in's fetch, which
  starts in the zone that unlocked, a widget test's fake clock; tests wait with
  `definitionsFetched()`.
- **Where this departs from the bullets above, decided in wave D.** The fetch comes once the
  sign-in is unlocked, not right after `/v1/me`, and covers every team. "At each sync" is a
  refresher, with no throttle. The definitions go at every sign-out, "Log out anyway" included,
  though drafts stay, so the phone does not keep the definition of every note it holds: a draft
  on a version the list no longer names opens offline again only once its version is fetched
  back, at the team's first open online after the next sign-in (once L4 supplies the query
  above). A team not opened online after that sign-in lacks such versions until it is. A list
  that names a version this app cannot read is refused whole (PLAN-OPEN, 10.1 #33). Whether a
  note should carry its definition's hash, so that `fetchVersion` could check an old version
  against what the note was charted on, is still open.

### 3.5 The portal

The portal does not read definitions. `GET /v1/encounters/{encounterId}` (lifecycle 5.1) carries,
for each note, `read`: the note laid out for reading by the interpreter's `readModel` (7.1). The
portal draws sections, labels, values and struck-through corrections from it. The EMS handoff PDF
is built from `handoffLines` on the server (lifecycle 5.7).

## 4. From the field specification to definitions

### 4.1 The steps

1. A piece of SPEC (one row of an inventory's work-list) is saved as
   `definitions/spec/<piece>.txt`, exactly as exported. A line that must not be copied (the
   example that names a real organization, SPEC 263 to 265) is replaced by the marker
   `[left out]`, which the spec check skips. The PHI guard's list of fixture folders gains
   `packages/forms/` and `packages/contract/test-vectors/`
   (`tools/phi-guard-rules.mjs:4-14`), so copied text and made-up people in vectors are scanned.
2. Its definition is written by hand as JSON, following the recipe
   `docs/plan/patterns/form-definition.md`.
3. Every place the definition differs from the text on purpose is listed in
   `definitions/spec/<piece>.diff.json`, with the reason and where the decision comes from: an
   Oct 19 change, a rule in PRD main, or a default from an inventory's ambiguity list. The file
   has three lists: `notOptions` (bracketed words in the lines that are not options), `added`
   (option labels that are not in the lines) and `differences`
   (`docs/plan/patterns/form-definition-example.md` shows one). The planner writes this file
   and the piece's shape file (4.2) before the card is handed out. The implementer writes only
   the definition.
4. `pnpm forms:export` resolves, validates and writes the generated files.

As built:

- A piece's name is lower-case letters, digits and hyphens (`^[a-z0-9][a-z0-9-]{0,60}$`), and
  any other file under `spec/` fails (`spec.unknown_file`). A section names its piece with
  `spec`; as soon as one does, all three of the piece's files must exist (`spec.missing_text`,
  `spec.missing_diff`, `shape.missing_file`). The `.txt` keeps blank lines, so a line number can
  be found again; a line that holds `[left out]` is skipped whole and still counts as a line.
- **A section names one piece**, so a repeating section whose parts SPEC writes in two places is
  one piece. From wave B on, Wound care (SPEC 63 to 119, the piece `wound`) and MSK (SPEC 912 to
  1068, `exam-msk`) are each one: each wound holds its own treatment (inventory A26), and each
  MSK entry the parts of its region (6.3). That makes 35 pieces: 13 for the note types and 22 for
  the exam (`forms-inventory.md` section 8, `forms-inventory-focused-exam.md` section 7).
- **The diff file has exactly four keys**, all of them there even when a list is empty: `piece`
  (its name), `notOptions`, `added` and `differences` (each `{ line, what, why }`, exactly those
  keys, `line` a line of the `.txt` counted from 1, `what` and `why` not empty). Entries are
  written as the check reads a word: no brackets, one space between words, no entry twice
  (`spec.bad_diff`). **Nothing is declared just in case**: a `notOptions` word that is no word of
  the piece, or that is an option after all, fails (`spec.not_option_unused`,
  `spec.not_option_is_option`), and so does an `added` label that no option has, or that is a word
  of the piece (`spec.added_unused`, `spec.added_in_piece`). `differences` are checked for their
  form only: they are for a person.
- The export runs the schema check on every file first and **stops after schema problems**:
  every later check reads files that passed `checkFile`, without looking again, and says so in
  its header. Then each note type is resolved and validated, and the lock, the version rules,
  the spec check and the shape check run over the whole tree. Each note type that includes a module or
  names a list finds that file's faults again, so the export drops a problem it has already
  printed (same file, place and rule).

As built (unit E, `packages/forms/scripts/export.ts`, run as `pnpm forms:export`):

- **What it reads.** Every file under `definitions/`. A file under `spec/` is a piece's, and the
  spec check reads its name. Any other file must sit where a note type version, a module version
  or a shared list lives (`note-types/<key>/v<N>.json`, `modules/<name>/v<N>.json`,
  `lists/<name>.json`), or it fails as `export.unknown_file`, since nothing would read it; a file
  that does not parse fails as `export.bad_json`. Each is held to the schema of its kind. Any
  problem so far stops the run.
- **The order after that.** Each note type version is resolved once, and validated with the
  newest version of each key as the note types it may name (`mapsTo`, `suggests`,
  `open_note_type`). Then the lock (handed the parsed pieces), the version rules, the spec check
  and the shape check run over the whole tree.
- **Nothing is written while any problem stands**, so the generated files only ever hold
  definitions that passed every check, which is all the server and the phone trust. Each problem
  is printed once, as its file, its place, its rule and its message, then a count; the command
  exits 1.
- **What it writes**, when nothing fails: `generated/presets.json` and the phone's copy, the same
  text in the same run. It holds every released note type version (D78, 3.2: a draft is checked
  and never written), as `{ key, version, hash, definition }`, ordered by key and then by version
  as a number (10 after 2). `hash` is `sha256Hex(canonicalJson(definition))`, as the server
  stores it (3.1), and `definition` is that canonical JSON read back, so its keys are in canonical
  order: a file with its keys in another order writes the same bytes, as the lock and the hash
  read it. With no version released it writes `[]`.
- **Notes fail nothing.** Before any problem it prints, each as `note`, its file and its message:
  a piece no definition names yet, a module or list no note type uses yet (known only when every
  note type resolved), for each note type version the most answers a note on it can hold (2.4),
  and each version that is a draft (3.2). The local drift step (`tools/ci-local.sh`) leaves the
  notes out of what it prints.
- **The release mode**, `pnpm forms:export --release` (card F6-release). A released file can
  never change again, so nothing is released that nothing checks or uses: what the notes call
  unused becomes a problem, `export.unused_file`, and nothing is written. When every check
  passes it writes `definitions.lock.json` (`lockOf` with the pieces) over every file present:
  each note type version, module, list and piece file, and each version's `#resolved` hash. Then
  it writes the presets, from that lock (3.2). Without `--release` the lock is never written, so
  nothing is released by accident. Any other argument is refused.
- **The golden file is a command of its own**, `pnpm --filter @sineobex/forms golden`
  (`scripts/golden.ts`, 7.3), run after the export, whose presets it reads.

### 4.2 What the export checks (each failure names the file and the rule)

| Check | What it catches |
|---|---|
| The JSON Schema (`src/schema.ts`, `checkFile`) | A misspelt key, a missing label, a wrong type, a pattern or a limit of 2.2 and 2.4 |
| The resolver (`src/resolve.ts`) | A note type file that is not there (`resolve.missing_file`); an include of a module or version that does not exist (`resolve.unknown_module`); a list that does not exist, the `surface` list a region asks for included (`resolve.unknown_list`); a file whose content names another key, name or version than its path (`resolve.misplaced_file`) |
| The semantic validator (`src/validate.ts`) | Two fields with one ID; a reserved ID (`entryAt`, `entryRemoved`); a condition that names no field; a path of five parts, or a path part the server would refuse; an option code used twice; an exclusive option in a choose-one field; a `required` field that can never be visible; a `mapsTo` that names no field. Every rule, with its name, is listed below the table. |
| The lock (`definitions.lock.json`, `src/lock.ts`) | A released version file, module, list or piece file whose content changed (`lock.changed`) or that is gone (`lock.missing`); a released version whose resolved definition's hash changed while its files did not (`lock.changed`, at the version's file); a released file that includes, names or is checked against a part that is not released, or a released version whose resolved hash the lock does not hold (`lock.unreleased_part`); a version's resolved hash held without its file's own line (`lock.resolved_alone`, at the lock's line) |
| Version rules (2.6, `src/versions.ts`) | A path or code reused for another meaning: a kind or a unit that changed, or a label that changed with no rename declared, against every earlier version |
| The spec check (`src/spec-check.ts`) | For each file whose sections name a piece: a word of the piece that is no option label of those sections, and an option label there that is no word of the piece, unless `<piece>.diff.json` declares it; a declaration that nothing needs |
| The shape check (`src/shape-check.ts`) | A definition whose structure differs from `definitions/spec/<piece>.shape.json`, which the planner writes for each piece: every key of every section and field (path, kind, label, choose-one or choose-many, which options carry which flag, `showWhen`, `required`, `sides`, `noNormal` and the rest), the option codes in order, the order of sections and fields, the file the piece is for and the note type's header (below). So a wrong choose-one, a wrong condition, a missing flag or a crossed code fails the export. |
| Drift | Generated files that differ from what the export writes (`git diff --exit-code`, as the contract does); a released line that left the lock or changed (`lock-grows`, below) |

**The spec check** reads the bracketed tokens of the piece (`[ New concern ]`, with SPEC's
escapes undone as inventory 1 describes) and the plain list lines, and compares them with the
option labels of the sections that name that piece. It checks the words.

**The shape check** checks everything else. The choices the specification does not make
(choose-one or choose-many, what is required, which option is exclusive, what opens what) are
made by the planner, from the inventories, and written down once as the piece's shape file. A
transcription card shows that file as its Decisions table. The small model types the options;
the two checks together leave it nothing to decide and nothing it can get wrong unseen. That is
what lets a transcription card be level S.

**The spec check, as built** (`checkSpec`, `specWords`):

- It reads three kinds of word in a piece's lines: every bracketed word, anywhere in a line
  (`\[ New concern \]`, `&#91; YES \]`; empty brackets are skipped); every bullet line (`•` or
  `◦`) that holds no bracket, as the whole line after the bullet; and every numbered line (`N.`
  or `N)`) with no bracket in it or in the lines that continue it and nothing nested under it, as
  the whole line after the number. Nothing else is a word: a heading, a numbered line with lines
  nested under it, `1\. Eyes`, `A. Part`, a scale written `0 / 1+ / 2+`, a `Label: ___` line. A
  word has SPEC's escapes undone (`&#NN;`, a backslash before a character or at the end of a
  line, the no-break space), no space at its ends and one space between its parts.
- **It works per file**: each file whose sections name a piece must hold all of the piece's
  words, not the union of every definition. A later version that departs from the piece on
  purpose names a piece of its own, with its own three files.
- Words are compared exactly, capitals included, as one set per piece, with the option labels of
  those sections: a choice's options, a grid's rows and its cell's options, a region's options,
  its side list and its surface list, and options from shared lists. The check does not know
  which field a word belongs to, or how often it appears: the shape check does.
- A line with a bracket that has no partner fails (`spec.unclosed_bracket`) and stops the
  comparison for that piece.
- A label that reaches a definition only through `added`, because the check cannot read it as a
  word on its line (an Other written as a heading over its text box, `Status: New, Chronic,
  Improving, Worse`, a scale line, a button with an emoji), is named with its line in the diff
  file's `differences`, so the auditor reads those few labels against the lines.

**The shape check, as built** (`checkShapes`):

- **A shape file** has the keys `piece`, `file`, `sections` and `fields`, and `header` and
  `outside` where they are needed. `file` names the definition file the piece is typed into, by
  its path under `definitions/`. **Exactly one shape file for a note type carries `header`**:
  every top-level key of the note type but `sections` and `renames`, compared key by key
  (`shape.missing_header`, `shape.header_differs`). A module has none.
- `sections` lists each section that names the piece, in order, as the definition writes it
  without `fields` and `spec`; `fields` lists every field at every depth, in written order, with
  `path` (the ids from the section down, joined by dots; a group's child after the group, a
  grid's cell after the grid) in place of `id`, and with no `fields` and no `cell`. **Every other
  key is compared exactly, both ways**: labels and titles, `help`, ranges, units, `display`,
  `action`, `clears`, `excludes`, `mapsTo`, `repeat`, `sensitiveExam` and the rest, so the shape
  file is the Sections and Decisions tables in machine form. A key absent from the entry must be
  absent from the definition.
- **Options are their codes in order.** A field's `options`, and a grid's written-out `rows`, are
  the list of the options' codes. A plain code must be the recipe's code rule applied to its
  label (`codeOf`); where the planner gives a code the rule would not make, the entry is
  `{ "code": …, "label": … }`. A code crossed with its label, invented, typed twice, moved to
  another field or put out of order is found. `{ "list": … }` and `{ "pickedIn": … }` stay as
  written. `flags` names, for each key an option carries beside its code and label, the codes
  that carry it. As built since wave B, an entry may also be `{ code, label }` where the rule
  makes the code, to pin the label: the lines spell some words two ways (quick-2's Referral Yes
  and No, its Delivery YES and NO), the rule makes one code of both, and the spec check reads only
  the set of words, so a swap of the two rows' labels would pass. The definition's label is then
  held to the pinned one.
- **Sections and fields are compared in order**: `shape.missing_section`, `shape.extra_section`,
  `shape.section_order`, `shape.section_differs`, `shape.missing_field`, `shape.extra_field`,
  `shape.field_order` (within its section) and `shape.field_differs`, whose path ends in the key
  and whose message gives both values. A problem is placed in the definition, where it is mended.
- **No definition is checked against nothing.** Once the file a shape file names exists, a piece
  that no section of it names is `shape.missing_section`, and a section of it that names no piece
  is `shape.unnamed_section` unless a shape file for that file lists its id under `outside`. A
  piece whose file is not yet written is not looked for, so pieces can land before their
  definitions.
- **Shared lists have no shape.** A person reads each list's codes, order, flags and count
  against the lines in the unit's review. As built (unit F6), the definitions test
  (`packages/forms/test/definitions.test.ts`) also pins each list's codes, labels, order and
  flags, and holds every list to a use (4.4).

**The lock, as built.** `definitions.lock.json` is a flat object from a path under
`definitions/` to the SHA-256 of the file's content (its canonical JSON; a piece's `.txt` as
text), so a file reformatted or written with its keys in another order is the same file. It
holds every released note type version, module version and list; the three files of every piece
a released definition names; and, at `<the version's file>#resolved`, the hash of each released
version's resolved definition, computed as the server computes it. A change to the resolver that
changes a released definition then fails the export, at the version's file, even though no file
changed. A file is released by adding its line; a file with no line is a draft and may change.
The export writes each preset's definition in canonical key order too (4.1), so the generated
files do not change either when a file's keys are reordered.

**A version is released whole, as built** (wave D's review). The `#resolved` line is what makes
a version a preset (3.2). Held without the file's own line, in a lock written by hand, it would
make a preset of a version whose file and parts are checked as a draft: they could change, or
the file go and the version leave the presets, with nothing said. So `checkLock`
refuses such a line as `lock.resolved_alone`, at the line, and a version is released with both
lines or not at all. A version whose file is gone with both lines still held is `lock.missing`,
from its file's line.

**The lock only grows, as built** (wave C's review). The export holds the tree to whatever lock it
finds, so a lock deleted or emptied would release nothing and every check would pass. The drift
step therefore also runs `pnpm --filter @sineobex/forms lock-grows <base>`
(`packages/forms/scripts/lock-grows.ts`): every line of the lock at the base commit must still be
there, with the same hash (`lock.removed`, `lock.rehashed`, at the lock's line). A line added is
a release, and passes; a base with no lock passes; a base git cannot read fails the step, so the
check never passes without looking. It is not a rule of the export, which cannot know what was
released before. The base is the merge base with `origin/main` in `tools/ci-local.sh`; in CI it is
the pull request's base, else the commit before the push, else `origin/main`, and the job fetches
the whole history. A run started by hand on `main` compares the lock with itself, and checks
nothing.

**The branch's own earlier state (found in wave D's review, closed).** On a pull request's
branch every base is a commit of `main`, and `main` holds no lock until a release is merged.
While the release sits on the branch, a released version could be edited and released again
with every check green. So `lock-grows` runs a second time, against the branch's own earlier
state: in CI against the commit before the push (`github.event.before`, which a pull request's
update and a push carry), skipped with a printed note when there is none (all zeros, or a pull
request just opened) or the clone cannot read it (a force push); locally against `origin/<the
branch>` when HEAD is on a branch that has one, and against the ref `LOCK_BASE` names when it is
set. A scratch repository showed it: a release, then outreach v1 edited and released again,
passes against the merge base with `main` and fails against the release commit with three
`lock.rehashed` lines. The preview deploy, which seeds the released forms, runs only from `main`:
a run dispatched from another branch skips every job.

**The drift step, as built** (`tools/ci-local.sh` and the `forms` job of
`.github/workflows/ci.yml`): the export, the golden script (7.3), `lock-grows` against the base
and against the branch's earlier state, then a failure when `packages/forms/generated/` or
`apps/mobile/assets/forms/` differs from what is committed, or holds a file that was never
committed, which `git diff` does not see (`git status --porcelain`). So a contributor who changes a definition or the interpreter runs
`pnpm forms:export` and then the golden script, and commits what they write.

**The validator's rules, as built.** Each is reported as `validate.<rule>`, in the file and at
the place it was written (through the resolver's origins), once:

| Group | Rules |
|---|---|
| IDs and codes | `duplicate_section_id`, `duplicate_field_id`, `reserved_id`, `duplicate_code`, `excludes_unknown_code`, `excludes_same_code`, `excludes_in_choose_one` |
| Paths (2.3) | `path_too_long`, `bad_path_part`, `path_collision` |
| Conditions (2.2) | `condition_unknown_field`, `condition_unknown_code`, `condition_not_a_choice`, `relative_outside_entry`, `path_into_repeat`, `condition_cycle`, `condition_reads_restricted`; picked rows: `picked_in_unknown_field`, `picked_in_not_choose_many` |
| Other note types (6.4, 6.7) | `unknown_note_type` (a `mapsTo`, `suggests` or `open_note_type` that names none), `maps_to_unknown_field`, `maps_to_mismatch`, `maps_to_in_grid`, `maps_to_twice`, `maps_to_from_repeat`, `maps_to_not_quick`, `maps_to_needs` |
| What a key means where it is written | `exclusive_in_choose_one`, `region_option_flag`, `row_option_flag` (an Other or exclusive option among a grid's fixed rows), `sides_not_allowed`, `required_not_allowed`, `grid_in_grid`, `grid_cell_stores_nothing`, `clears_unknown_field` (a flag clears a sibling, never itself), `number_range_empty` (min above max, or no value at the field's decimals between them), `number_normal`; added in wave B's review (2.2): `other_twice`, `normal_conflict`, `handoff_restricted`, `clears_with_sides` |
| Visibility | `required_never_visible`, `visibility_too_complex` |
| Limits (2.4) | `text_too_long`, `repeat_too_many`, `too_large` |

- `required_never_visible` searches every answer a required field's showing depends on: the
  conditions of its section and of the groups and grid around it, picked rows, exclusive options,
  blocked pairs and clearing flags, reading only answers that count (a hidden or cleared answer
  does not, 7.1). The flags that clear the field itself are among them, so a required field shown
  only while the flag that clears it is set is never visible: the interpreter would never ask for
  it. A choose-many is tried one asked code at a time, only when a condition needs it. A search
  past 20,000 tries, or a chain of follow-ups more than 200 deep, is refused as
  `visibility_too_complex` and never passed; the message names the limit hit. When a module's
  field can show only without the condition of the include that brought it in, the fault, or a
  cycle that condition makes, is reported at the include's `showWhen` in the note type's file.
- `maps_to_mismatch`: the full field must take every answer the quick field can store, or Expand
  would write an answer the server refuses: the same kind; choose-one or choose-many alike; codes
  a subset, with every blocked pair and exclusive option of the full field held in the quick one
  too; text no longer; a number in the same unit, inside the range, at no more decimals; a date
  range that fits; the same sides, region parts and Other text. The other `mapsTo` rules are in
  6.4.
- **Header keys that make no sense where they are written stay allowed**: `auto` on a note type
  offered for Non-Medical encounters too, `quick` with no `mapsTo`, an `itemTitle` without `{n}`,
  a problem field outside a repeating section. Neither interpreter nor the renderer depends on
  them.
- **A grid with sides whose cell is, or holds, a region or a problem is refused (D80, decided
  Nov 17, built in wave D, `282c155`).** As built in wave C, `sides_not_allowed` refused `sides`
  on a region or a problem, and on a cell whose grid has sides, but not on such a grid. It passed,
  and that cell stored no side: a region has a side of its own, and the path model of both
  interpreters gives the cell none (2.3). Now `sides_not_allowed` is reported at the grid's
  `sides` when its cell is a region or a problem, or is a group holding one at any depth. Refusing
  it keeps one path model; giving such a cell sides would need a second side part and new
  `fieldAt` vectors for a shape no piece's plan holds (the seven grids with sides in the plans,
  and the two in the fixtures and vectors, have a choice or a number in their cell). A group cell
  is refused twice: every field in it already has a path of five parts (`path_too_long`), and the
  grid's own problem says what is wrong with the grid.

### 4.3 How one piece of SPEC maps to data

The recipe gives this table in full, with one worked example for each row.

| SPEC writes | The definition gets |
|---|---|
| `Buttons: [ A ] [ B ]` | A `choice` with one option per button. `many` is what the inventory says for that line. |
| A button named None, No or None known in a choose-many row | That option gets `exclusive: true` |
| A button named Other | That option gets `other: true` |
| `Text box titled X` | A `text` with label X, `lines: 'many'`, `maxLength: 2000` |
| `[ ___ cm ]` | A `number` with `unit: 'cm'`, `decimals: 1`, and `altUnit` inches |
| `If [YES]:` and the fields under it | Each of those fields gets `showWhen` naming the question's path and the code |
| `[ WOUND 1 ] [ WOUND 2 ] [ + ADD WOUND ]` | The section gets `repeat` |
| `Status (for each vaccine)` | A `grid` with `rows: { pickedIn: <the vaccines field> }` |
| A scale used for several rows (pulses, reflexes) | A `grid` whose `cell` is a `choice` on a shared list |
| Right and left recorded separately | `sides: true` |
| A note to the builder, an example value, "V2" | Nothing. It goes in `<piece>.diff.json` as left out, with the line. |

### 4.4 Shared lists

"One master list per field" (PRD main 410). A list that appears in more than one place is one
file under `definitions/lists/`. Inventory section 5 (both files) names them. The cards for lists
come before the cards that use them. The lists this phase needs at least: `wound_type` (PRD main
410 gives it in full), `body_region`, `side` (Right, Left, Bilateral), `side_rl` (Right, Left),
`pulse_scale` (0, 1+, 2+, 3+, unable to assess; PRD main 414), `reflex_scale` (0 to 4+),
`drainage_amount`, `dressing`, `needs`, `yes_no_unknown`.

As built, a region's `side` names any of these lists, and two more are needed: `surface`
(Anterior, Posterior; SPEC 1258), which every region with `surface: true` takes, and Skin's side
list, Right, Left and Midline (focused-exam inventory, default 24). A list has no version and no
shape file: the lock freezes it once released, so a list that must change is a new list under a
new name, and a person reads its codes, order, flags and count against the lines when the unit
is reviewed.

As built (unit F6) there are 17: the ten above, `surface`, `side_rlm` (Skin's), and `yes_no`,
`lung_findings`, `range_of_motion`, `capillary_refill` and `special_test_result`, which the
inventories' section 5 call the same everywhere. Labels are as SPEC writes them; where the code
rule makes no valid code (`0`, `1+`) the list gives one (`zero`, `one_plus`). `needs` has no icons
yet (10.1 #17). **A list no plan uses is removed**, as `yes_no_unsure` was: the definitions test
holds every list to a use, named by the plan of some piece as a field's options, a grid's rows or
a region's side or surface, and pins each list's codes, labels, order and flags, so a change to
what one-tap Normal records fails a test.

## 5. The inventory, and the decisions that shape it

The inventories are the work-list. This section holds only the decisions that are not plain
transcription.

| Decision | Why | Source |
|---|---|---|
| Nine note types ship: `general_primary_care`, `wound_care`, `harm_reduction`, `psychological`, `sexual_reproductive`, `social_needs`, `outreach`, `quick_encounter`, `red_flags_disposition` | Eight categories (PRD main 408). Outreach is split from Social needs so staff can add either alone (inventory A8). Red flags get their own note (6.2). The Focused Exam is not a note type: it lives inside General (PRD main 414). | inventories |
| Medical note types, offered in Medical encounters only: General, Wound care, Harm reduction, Psychological, Sexual and reproductive, Quick encounter, Red flags. Non-Medical note types, offered in every encounter: Social needs and Outreach. | PRD main 379, 409. A Non-Medical note is never signed (lifecycle 3.1). Harm reduction is the open one (PRD main 447). | inventory A7 |
| Sensitive note types: `harm_reduction`, `psychological`, `sexual_reproductive`. The treatment section of Harm reduction (SPEC 139 to 148) is also marked `treatmentRecord`. | PRD main 435, 121; PRD main 145 for treatment records | lifecycle 6.4 |
| Timeline groups: General, Quick encounter, Red flags and Sexual and reproductive are `clinical`; Wound care is `wound`; Harm reduction is `harm_reduction`; Psychological is `psych`; Social needs is `social`; Outreach is `outreach` | The PRD's seven filter names, the seventh being referrals (PRD main 725) | lifecycle 9.1 |
| Sensitive exam sections: GU, Breast, Rectal. Each gets Performed, Chaperone present and Patient consented, the last `required`, all three `noNormal`. | PRD main 415. SPEC gives chaperone and consent for GU only (focused-exam inventory, section 6). | PRD main 415 wins |
| Every ambiguity in the inventories takes the default written beside it | 60 or so small choices that need the clinical team. Each default is one line in a `.diff.json`, so changing one later is a data change and a new version. | 10.1 |
| The Oct 19 field changes (PRD main 103) are applied in the definitions, each declared in its piece's `.diff.json` | SPEC still shows the old version for most of them (inventory section 6, both files) | PRD main 103 |
| The worked example at SPEC 1838 to 2030 is not transcribed | It is an illustration | focused-exam inventory, section 7 |
| MSK special tests ship for the shoulder only | "The clinical team supplies the test list for each region (the tab only gives the shoulder)" (PRD main 414) | 10.2 |

## 6. Flows and special rules

Each is data in a definition plus one behaviour in the renderer. None needs code for one form.

### 6.1 Medical or Non-Medical, and several note types in one encounter

The list of note types offered comes from `kinds` (lifecycle 9.4). An encounter holds any number
of notes. Nothing in a definition knows about another note, with two exceptions: `mapsTo` (6.4)
and the `open_note_type` action (6.7).

### 6.2 Red flags, disposition and follow-up

"The quick form ... keeps red flags and disposition, like every Medical form" (PRD main 409).
SPEC writes them once, inside General (SPEC 36 to 60). Copying that section into every Medical
note type would ask the same question three times in a three-note visit. (The Encounter Summary
text box that follows, SPEC 61 to 62, is the visit's assessment, lifecycle 9.6, and not a field
of any note.)

So they are one note type, `red_flags_disposition`, with `auto: 'medical'`:

- The phone adds it for a person when they create a Medical note on a visit that has no finished
  Red flags note and none of their own. It shows last on the encounter screen and on the summary
  screen. Until it has an answer it is an empty draft, and an empty draft counts for nothing
  (lifecycle 3.1).
- When its author completes a Medical note, this note is completed first and is not skipped as
  empty. Its red-flag question is `required`, so the finish check asks for it. The server
  refuses to finish a Medical note on a visit with no finished Red flags note (lifecycle 3.3,
  hard stop 5; 4.6).
- A second clinician on a visit whose Red flags note is already finished is not asked again.
- Red flags answered Yes opens the EMS branch by `showWhen`: EMS activated, patient agrees to
  transport, the reason if not, and the time EMS was called (PRD main 413). The time is
  `required` while EMS activated is Yes.
- Disposition is choose-many with `excludes` pairs (PRD main 102). Inventory A21 lists the pairs
  built by default.
- **Follow-up is the visit's, and is asked here**: when (Next street clinic, Specific date or
  PRN), the date, required for a Specific date, and Follow-up details, a text box shown once a
  follow-up is picked. Phase 7's follow-up task reads this note's. As planned in wave B, the
  Quick encounter's own follow-up lines (SPEC 328 to 332) are not typed (6.4): asked twice, the
  two could disagree. As built, their text box is this note's Follow-up details, so the quick
  form's follow-up note still has a home (10.1 #40). Two Medical note types keep a follow-up of
  their own beside this one, which can differ from it and which phase 7 does not read: each
  wound's, in Wound care, and Sexual and reproductive health's (Results needed, Referral, PCP)
  (10.1 #41).

### 6.3 The Focused Exam

"It lives only inside General / primary care, after Vitals. The picker asks 'What did you
examine?' and shows all 16 systems at once ... Only the selected systems open ... Each system has
a one-tap Normal" (PRD main 414).

- The picker is a choose-many field, `exam.systems`, in the General definition, with one option
  per system.
- Each system is a module: one or more sections, each with
  `showWhen: { field: 'exam.systems', is: '<system>' }` and `normal: true`. HEENT is four
  sections (eyes, ears, nose, mouth and throat), as SPEC 390 makes each its own screen.
- One-tap Normal calls the interpreter's `normalAnswers` for the section and writes each answer
  it returns. It fills only fields that have no answer, so a finding already charted is never
  overwritten. It never fills a `noNormal` field.
- "Details appear only when an answer calls for them" is `showWhen`. "Left and right are recorded
  where it matters" is `sides`. Pulses and reflexes are grids on shared scales.
- MSK is a repeating section, one entry per region examined (focused-exam inventory, default
  16). Each entry has its region, the parts that follow it, and one tests grid per region, each
  shown by `showWhen: { field: './region', is: '<region>' }`. Only the shoulder's grid exists
  (10.2). One-tap Normal takes the entry it is tapped in.
- One-tap Normal fills visible fields only: the cranial nerve groups that stay hidden while the
  screen is "Grossly intact" are not filled.
- What the format gained for the exam, as built: Neurologic reflexes are an optional table
  recorded by side (focused-exam inventory, default 25 and construct 26), so a grid can be
  `collapsed` like a group, at no cost in path parts; motor strength is a number whose `normal`
  is 5, what one-tap Normal fills (default 28); Skin's side list has Midline (default 24), so a
  region's `side` names any shared list.

As planned in wave B (unit F6; the plans are the shape files under `definitions/spec/`):

- **One module per exam piece**, 21 in all: HEENT four (`exam_heent_eyes`, `_ears`, `_nose`,
  `_mouth`), Cardiovascular two, Neurologic two, and one for every other system. A module is
  named after its piece, with underscores, at version 1. Each holds one section, except Skin (the
  overall skin, and Skin finding, which repeats, at most 20) and MSK (below). Every section shows
  only while its system is picked, and offers Normal exactly where something in it has a normal
  to fill: Skin finding does not, since no option of a finding is normal. Normal stays per
  section, as the pieces split a system: HEENT has four (default 11), Cardiovascular two (heart
  and perfusion), Neurologic two, and MSK one in each region's entry and one for Gait. The PRD
  gives each system one Normal (PRD main 414): the renderer (F5) offers one per system, which runs
  `normalAnswers` on every section of that system, each entry of a repeating one included
  (10.3).
- **The picker** has the 16 systems' codes (the focused-exam inventory's section 2 ids), in
  SPEC's picker order, and Other, which opens `exam.other_findings`, a text of up to 2,000
  characters. GU, breast and rectal carry `sensitiveExam`.
- **General includes the modules** after its `exam` section and before `problems`, version 1 of
  each, in the order of the focused-exam inventory's section 7, and **no include carries
  `showWhen`**: the condition is on each module section, and the resolver would join a second,
  equal one to it. The shape files cannot hold an include, so the plan of General's sections is
  `GENERAL_PLAN` in `packages/forms/test/definitions.test.ts`, which holds the General file to it
  once the file exists.
- **MSK is one piece and one module, `exam_msk`**, so that it can be one repeating section: its
  section `msk` has one entry per region examined, at most 10 (10.1 #19), each titled Region
  {n}. The region is choose-one, so another region is another entry. Every part after it shows
  once `./region` is filled; Side (the shared list `side`) shows for every region but Head / Neck
  and Back (default 4); the shoulder tests show for `./region` is the shoulder. Gait belongs to the
  whole person, so it is one answer for the exam, in a second section of the module, `msk_gait`,
  shown while MSK is picked: a condition outside the repeating section cannot name `msk.region`
  (`validate.path_into_repeat`). One-tap Normal in an entry does nothing until its region is
  picked (default 29 asks).
- **One-tap Normal leaves an optional part alone**: it fills nothing in a group or grid marked
  `collapsed`, even once it is opened and partly charted, since only the clinician says it was
  examined (10.1 #25). The reflex table is collapsed. Cardiovascular's and Peripheral vascular's
  pulse sites are two grids each: Pulses, the sites a routine exam palpates (Radial, DP and PT),
  which Normal fills with 2+ (default 28), and a collapsed More pulse sites, which it does not.
- **One-tap Normal never hides an answer that counts**: a normal that would hide a finding
  already charted, a detail under a screen that is not intact for example, is not filled (7.1).
  It also never answers a field that opens a hand-off (6.7).
- **`range_of_motion`'s Unable is exclusive**, as is every Unable option of a choose-many field
  (tympanic membrane, neurologic gait and coordination, MSK gait): neither normal nor abnormal, it
  clears the rest. The shoulder tests' normal is Not performed (10.1 #18).

As built in wave D, the modules are `modules/exam_<piece, with underscores>/v1.json`, included in
General as planned. One-tap Normal stays per section, so Cardiovascular has two (heart rate,
rhythm and sounds; perfusion, edema and JVD) and MSK one in each region's entry and one for gait;
as built, the renderer adds one for a whole system, over its sections (10.3 #7). The review
changed the plans before release:

- **MSK strength is two numbers**, Strength, right and Strength, left, each shown only for the
  side the entry examines (Right or Bilateral; Left or Bilateral; both for Head / Neck and Back,
  which have no side), so one-tap Normal never records 5 for a limb that was not examined.
- **Five normal options are no longer exclusive**: Normal S1/S2, Patent, Supple, No mass and
  Intact skin are each held beside the findings they do not rule out, excluding only their
  opposites; and PERRLA clears the other pupil findings as PERRL does (10.1 #23). A capillary
  refill time is asked only while the refill is Greater than 2 seconds (10.1 #36). Neurologic,
  Diabetic foot and Peripheral vascular end with a Notes box, which says the side of a finding
  the choices cannot (10.1 #34).

### 6.4 The Quick encounter

"Staff can expand any part of a quick encounter into its full module partway through without
re-entering what they filled in" (PRD main 409).

- `quick_encounter` is a Medical note type with `quick: true`. Its fields use the same shared
  lists as the full modules (PRD main 410).
- Each of its fields that has a twin in a full module carries `mapsTo`.
- **Expand** on a part of the quick form creates the full note type in the same encounter and
  writes each mapped answer into it. The interpreter's `expandQuick` returns the answers; the
  phone writes them as ordinary changes. The quick form's own answers stay.
- A full module's field can sit in a repeating section (a wound). `mapsTo` then names the path
  without the entry part. The phone makes the new entry's ID and passes it to `expandQuick`,
  which returns the entry's `entryAt` answer with the rest. A pure function cannot make an ID.
- HPI is Yes, No or Unknown, and Yes opens a text box (PRD main 409, 422).
- Its Medication section "needs an ordering credential" (PRD main 409). The section is marked
  `needs: 'orderMedications'`: the renderer shows it only to a credential that may order, and
  the server holds a change to it from anyone else (lifecycle 6.4, rule 5).
- Medication delivery set to Yes "creates a delivery task" (PRD main 418). The answer is
  recorded now. The task is created in phase 7, which builds tasks.
- **What the validator holds `mapsTo` to, as built.** Only a note type with `quick: true` maps
  (`validate.maps_to_not_quick`). No two fields map to one target (`validate.maps_to_twice`):
  Expand would write two answers to one path. A field inside a repeating section does not map
  (`validate.maps_to_from_repeat`): it has an answer for each entry, and Expand has one full field
  to write them to. A cell of a grid does not map; the grid does (`validate.maps_to_in_grid`). A
  target in a section with `needs` needs the same `needs` on the source's section
  (`validate.maps_to_needs`): Expand by anyone without the capability would be a held change. A
  target shown only under a condition is allowed. The full field must take every answer the quick
  field can hold (`validate.maps_to_mismatch`, 4.2).
- **The checks against the target** (`unknown_note_type` for a `mapsTo`, `maps_to_unknown_field`,
  `maps_to_needs`, `maps_to_mismatch`) **run only for the newest version of the quick note type,
  against the newest version of the target note type.** A released older quick version is not
  checked again: it can no longer be edited, and the newest full version may have moved on.
- **Expand from a draft written on an older quick version** (PLAN-OPEN 10.1 #12) reads the
  draft's own version, writes each answer only where the newest full version takes it
  (`checkAnswer`), and lists for the person the answers it left out.

As built (`expandQuick`, unit F1, 7.1):

- **It returns `{ answers, leftOut }`**: the answers to write, and for each quick answer it did
  not write `{ path, target, problem }`, the quick path, the target path without its entry part
  and `checkAnswer`'s problem, which the phone shows the person (10.1 #12). Only answers that
  count are written or listed.
- **The phone passes the new entries as `newEntryIds`**, `{ <section id>: { id, at } }`, one for
  each repeating section of the full note: the entry's ID and the time it is added, its
  `entryAt`. A pure function can make neither. An entry's `entryAt` is written only when some
  answer goes into it, and `expandQuick` throws when an answer goes into a repeating section that
  `newEntryIds` gives no usable entry for.
- **It goes beyond `checkAnswer` in two ways.** A choose-many is first put in the full field's
  order of options, the order a stored value must have (2.3), which `maps_to_mismatch` does not
  compare. And a number whose quick and full fields have different units (or one has none) is
  left out as `wrong_type` without asking `checkAnswer`, which cannot see a unit: a 2 stored in
  inches would pass it as 2 cm. The validator holds the newest quick version to the unit
  (`maps_to_mismatch`); an older one is not.
- **The quick fields' targets, as built** (card F6-general-assemble, once every target note type
  existed: earlier, the quick card's export would have failed with `unknown_note_type`). Fourteen
  fields carry `mapsTo`, written as the field's last key, in the definition and in the two
  pieces' shape files, as the differences of `spec/quick-1.diff.json` and
  `spec/quick-2.diff.json` name them:
  - into General: `general.concern` to `reason.concern`, `general.hpi_details` to
    `hpi.narrative`, and `general.bp.systolic`, `general.bp.diastolic`, `general.hr` and
    `general.temp` to `vitals.bp.systolic`, `vitals.bp.diastolic`, `vitals.hr` and `vitals.temp`;
  - into Wound care: `wound.type` and `wound.location` to the same paths,
    `wound.dimensions.length`, `.width` and `.depth` to `wound.measurements.length`, `.width` and
    `.depth`, `wound.drainage` to `wound.drainage_amount`, and `wound.dressing` to
    `wound.treatment.dressing`, inside the wound;
  - into Social needs: `social.needs` to `needs.needs`.

  The blood pressure's and the dimensions' parts are mapped one by one, since Expand writes to a
  leaf's path and the diff files name the targets field by field. The assessment, the HPI choice,
  support, referral, medication and photos have no twin and map nothing. `vitals` in General and
  `wound` in Wound care repeat, so Expand into either takes a new entry (`newEntryIds`). The
  golden file expands the quick encounter's `every` set into each of the three (7.3). Once Expand
  has carried a quick answer into a full note of the visit, the EMS handoff's field lines list it
  once, from the full note (7.1).
- **The quick form asks no follow-up of its own**: a quick encounter is a Medical note, so its
  follow-up is the Red flags and disposition note's (6.2). Its lines' follow-up date is declared
  left out in `spec/quick-2.diff.json`, and their text box is the Red flags note's Follow-up
  details (10.1 #40).
- **Two answers are required while they show** (wave D's review), because the step that acts on
  each needs it: a referral's details (PRD main 113), and a medication delivery's instructions,
  with which phase 7 creates the delivery task (PRD main 418).

### 6.5 Sexual and reproductive branching

"The Pregnancy, Contraception and Menstrual sections appear only when that reason is picked.
Current pregnancy details ... appear only once a pregnancy is confirmed. The Pregnancy test
question sits at the top of the Pregnancy section, with Positive or Negative and no Not done
option" (PRD main 417). All of it is `showWhen` and field order. Nothing in the renderer is
special to this note type.

As planned in wave B, Current pregnancy shows when the test is Positive or when a flag beside
the test, "Known pregnancy, no test today", is set (an `any` condition), so a pregnancy known
before the visit is charted without a test being recorded that was not done. The flag is not in
the lines: a departure for the clinical team (inventory A44; 10.1 #24). The estimated due date
may be in the past, as an overdue pregnancy's is.

As built (wave D's review), the flag clears the test (`clears`), so a note never holds a test
today beside "no test today". Pregnancy also stays among Testing history's tests, as the lines
write it, for an earlier test and its date: a positive result there opens nothing, and nothing
stops it from disagreeing with today's (10.1 #24).

### 6.6 Sensitive exams

- A sensitive exam section shows only when its system is picked (6.3), like every system.
- It carries `sensitiveExam: true`. The interpreter's `visibleAnswers` leaves its answers out for
  a reader without the key who does not act as the note's author (lifecycle 6.4), and
  `recapLines` leaves it out for everyone (PRD main 415: "never show on the patient overview").
- Its consent field is `required`, so `finishCheck` stops Complete without it: "the note can't be
  signed without consent recorded".
- Its three workflow fields are `noNormal`.
- The exam picker's options for GU, breast and rectal carry `sensitiveExam`. `visibleAnswers`
  drops those codes from the picker's answer for a reader without the key, and `recapLines`
  drops them for everyone, so the overview does not say the exam was done.
- A condition outside a sensitive exam section never reads an answer in one, nor tests a picker
  code marked `sensitiveExam` (2.2, `validate.condition_reads_restricted`): what it showed would
  tell a reader without the key what was found. The same holds for a `treatmentRecord` section.

As built in wave B (units F1 and F6):

- **What a sensitive exam leaves out is more than its sections and picker codes.** For a reader
  without the key `visibleAnswers` also takes out every answer in a grid row whose option is
  marked `sensitiveExam`, a region whose region is marked (with its side and surface), the Other
  text of a field whose picked Other option is marked, and an entry that held answers and has none
  left once those are out, `entryAt` and all, so the entries after it are numbered as if it had
  never been there (lifecycle 6.4). `recapLines` takes out the same for everyone.
- **So a condition outside a sensitive exam reads none of it**: not whether the picker is filled
  (its marked codes may be all that fills it), nor a marked Other text, a cell of a marked row
  or the side of a marked region (2.2). Only `is` on codes that are not marked reads the same
  either way.
- **No field in a sensitive exam or a treatment record is marked `handoff`**
  (`validate.handoff_restricted`): the handoff goes to EMS. The handoff's field lines are laid
  out from the answers less what a sensitive exam put there, as its recap lines are. As built in
  wave D's review, its recap lines also leave out every treatment record section, for every
  reader: one who may see the section would otherwise hand it to EMS (7.1).
- **In the plans**, GU's, Breast's and Rectal's sections carry `sensitiveExam`, each with its
  three workflow fields and nothing else `required` or `noNormal`. In GU, Exam performed opens the
  external exam and the findings text, and general findings and CVA can be charted without it
  (default 35); in Breast and Rectal every finding waits for it, so consent is required
  whenever a finding is charted (10.1 #21).

### 6.7 Nothing charted twice

"Open skin (ulcer, abscess, laceration, burn) hands off to Wound care, and so does a wound found
in the diabetic foot exam" (PRD main 416). In the Skin and Diabetic foot sections, an `action`
field with `action: 'open_note_type'` and `noteType: 'wound_care'` shows when one of those
findings is picked. It opens
the encounter's Wound care draft, or creates one. The Skin finding itself stores only its type.
In the plans no field that such an action's condition reads has a normal option, so one-tap
Normal never answers one: in the foot exam it would write "Wound present? No" beside an ulcer
already ticked, and hide the hand-off (10.1 #29). Skin offers the action for Ulcer or Abscess.

As built (wave D's review): while Ulcer or Abscess is picked, a Skin finding stores only its
location and type, and asks no characteristics, size or photos, which Wound care asks of the
wound. The foot exam's Wound present? is not asked while Inspection holds Intact skin, so one-tap
Normal, which hides no answer that counts, leaves Inspection empty beside Wound present? Yes, and
the two are never charted together (10.1 #29). A wound ticked in the MSK exam's Inspection opens
no hand-off: Inspection has a Normal option, and no answer Normal fills opens one (10.1 #35).

Skin findings also ask "Same lesion as documented before?" (PRD main 416). In phase 4 the answer
is a choice (Yes, No, Unknown) stored with the finding. Linking it to the earlier finding waits
(6.8).

### 6.8 What waits for a later phase

| In SPEC or PRD main | In phase 4 | Arrives |
|---|---|---|
| Photos (SPEC 116, 306) | A `photo` field that says "Photos arrive in a later release" | Phase 8 |
| Fields drive supply suggestions (PRD main 424) | Nothing in the definition. Mappings are keyed by note type key, path and option code, which are stable (2.6). | Phases 5 and 6 |
| Orders, medication order in the quick form | The answers are recorded; no order is placed | Phase 6 |
| Resource search and recommended resources (SPEC 259 to 265) | An `info` field: "The resource directory is coming." (PRD main 514) | V2 |
| Referral status per resource (SPEC 266) | Left out (PRD main 113) | V2 |
| Dictation | Left out (PRD main 412) | V2 |
| A link from a skin finding to the earlier finding it continues (PRD main 416) | The Yes, No or Unknown answer only | When earlier notes can be picked from: phase 7 or later |
| Follow-up tasks created in one tap (PRD main 384, 433) | The follow-up answers are recorded and shown on the summary screen | Phase 7 |
| Connect to resource in Harm reduction (PRD main 399; SPEC 148) | The button opens Add referral | The directory is V2 (PRD main 514) |
| The drawn body map | A list of regions grouped by front and back, with side and surface (10.1 #3) | To decide |

## 7. The interpreter: one set of rules, pinned twice

### 7.1 The functions

Each is pure: a definition and a note's answers in, plain data out. TypeScript in
`packages/forms/src/interp/`, Dart in `apps/mobile/lib/forms/`, one file per function on each
side, with three files they share: the rules of what counts (`conditions.ts`), the layout the
recap, the read model and the handoff write from (`layout.ts`), and what a sensitive exam leaves
out (`sensitive-exams.ts`). Each function is exported from the package's index. The table is as
built (unit F1); what each does in full follows it.

| Function | Returns | Used by |
|---|---|---|
| `fieldAt(def, path)` | What a path points at, a `PathTarget`, or null when it names nothing: `{ points, at, section, field, option, entry, row, side, part, key, leaf, holds }`. `points` is `field`, `cell` (in a grid's row), `option` (the text of an Other option) or `entry` (an entry's `entryAt` or `entryRemoved`); `at` is its place in the resolved definition; `key` is the path without its entry part; `holds` is what may be stored there, or null where the path names a field that stores nothing | everything below |
| `checkAnswer(def, path, value)` | null, or one problem, the first check that fails in this order: `unknown_path`; `wrong_type`; `unknown_option`; `wrong_type` again, for a choose-many out of the definition's order; `out_of_range`; `too_long`; `excluded_pair`; `exclusive_with_others` | The server on every answer (lifecycle 4.4); the phone before it saves |
| `effectiveAnswers(def, answers)` | A new map of the answers that count, blanks and refused answers left out, keys in UTF-16 code-unit order | every function below, exports, and the hash a signer sends (lifecycle 4.5) |
| `finishCheck(def, answers)` | `{ section, path, problem: 'required' }[]`: each answer a visible required field is missing, per side, per row and per entry | Complete (lifecycle 3.3, 4.6) |
| `normalAnswers(def, sectionId, answers, entryId?)` | The answers one-tap Normal would add to that section or that entry, a map in code-unit key order | 6.3 |
| `recapLines(def, answers)` | `{ section, text }[]`: one line per section that has an answer | lifecycle 8.1 |
| `readModel(def, answers, corrections)` | `{ sections }`: each `{ id, title, items }`, or `{ id, title, entries }` with each entry `{ id, title, items }` for a repeating section; an item is `{ path, labels, value, corrections }`, `value` a string, or null for an answer a correction took away, and a correction `{ path, old, by, credential, at, reason }` | The visit read (3.5), the phone's read view |
| `visibleAnswers(def, answers, reader)` | The answers that count that a reader may see, a subset of `effectiveAnswers` in its order, or null when the reader may not see the note at all. `reader` is `{ actsAsAuthor, viewSensitive, viewSensitiveExams, readsMedical, chartsMedical, ordersMedications, sensitiveCodes }`: six facts about the person, and phase 3's sensitive diagnosis codes as ranges `{ from, to }` | lifecycle 6.4 |
| `handoffLines(defs, answersByNote, sensitiveCodes)` | The EMS handoff summary of one visit's notes, `{ kind, note, section, label, value }[]`: first a `field` line for each answer of the fields marked `handoff`, but a quick answer Expand carried into a full note of the visit, then each note's `recap` lines, but a treatment record's; in neither part a diagnosis on the sensitive list (10.1 #6) | lifecycle 5.7, 9.8 |
| `suggestions(def, answers)` | The note type keys the options picked suggest, each once, in the definition's order | lifecycle 9.6 |
| `expandQuick(quickDef, answers, fullDef, newEntryIds)` | `{ answers, leftOut }`: the answers to write into the full note, and `{ path, target, problem }` for each one left out. `newEntryIds` is `{ <section id>: { id, at } }`, the new entry of each repeating section of the full note | 6.4 |

`answerSchema` in the lifecycle part is `checkAnswer` under another name; the lifecycle's cards
use `checkAnswer`.

Rules the functions share, stated once:

- In a draft, a hidden field's answer does not count, and is not deleted. If the field becomes
  visible again the answer is back. The renderer does not clear hidden answers: each clear would
  be a change to sync. When the note is finished, the answers that do not count are moved to its
  history, so a finished note holds exactly what was signed (lifecycle 4.5).
- An exclusive option and another option in one value is `exclusive_with_others`, and a blocked
  pair in one value is `excluded_pair`. The widget never produces either; the server refuses
  both. So a contradictory disposition is caught when it is entered, not at Complete.
- The server checks one answer at a time and cannot refuse an answer for being in a hidden field:
  changes arrive in any order. Visibility is applied when reading and when signing.
- On the phone the domain layer calls `checkAnswer` before the store's `setField`. On the server
  the sync rules call it once the note is loaded (lifecycle 4.4). The phone's sync registry holds
  no definitions and checks only that a path has the right shape.

As built (unit F1, `conditions.ts`):

- **An answer counts** while its section, every group and grid around it and its own condition
  hold; no set flag clears it or a field it is in (a flag in a grid's cell clears only in its own
  row); its row is picked, in a grid with picked rows; its entry is there, in a repeating section;
  and, for the text of an Other option, an Other option is picked beside it, on the same side and
  in the same row.
- **A blank (`null`, `""`, `[]` or `{}`) is no answer, and so is an answer `checkAnswer`
  refuses.** Neither counts, fills a required field or is read by a condition. The server and the
  phone never store one; this gives both interpreters one meaning for odd data.
- **A condition reads only answers that count**: `filled` holds on an answer that counts, `is` on
  a code that counts, and `not` of either where there is none.
- **An entry is there** while its `entryAt` holds a time `checkAnswer` takes and its
  `entryRemoved` is not `true`. Entries are in the order they were added: by `entryAt` as an
  instant (the fraction of a second padded to nine digits, so `10:00:00Z` comes before
  `10:00:00.5Z`), then by entry ID.
- Only a map's own keys are read, and a list in a result is a new copy, never the input's.

Each function, as built:

- **`fieldAt`** looks a path up in the path model of 2.3 (`src/paths.ts`) once the entry part of
  a repeating section is taken out. A field's own path names the field even where nothing is
  stored there (a group, a grid, a region or a problem as a whole, a field with sides without its
  side, a photo, an action, an info), with `holds` null. The text of an Other option points at
  the option; a field has one (2.2). A section alone, or an entry alone, is null.
- **`checkAnswer`** takes `null` at any path that stores an answer, as its clear, and otherwise:
  for a flag and for `entryRemoved`, only `true`; for a choose-one, one of its codes (`""` is
  `unknown_option`); for a choose-many, a list of its codes with none twice, in the definition's
  order (2.3; another order is `wrong_type`); for a number, a value inside its range whose
  shortest decimal form has no more decimals than the field's (more is `out_of_range`, as
  `validate.number_range_empty` reads a range); for a duration, whole days from 0 to its `max`, or 36,525 without one (more is `out_of_range`, as for a number); for
  a date, a real `YYYY-MM-DD`, its range not checked, having no clock (2.2); for a time, `HH:MM`
  from `00:00` to `23:59`; for a text, no more characters than its `maxLength`, 200 for an Other
  text and 300 for a problem label (phase 3's limit for a code's text), counted as code points
  (2.3); for a problem code, the shape of ICD-10-CM, phase 3's check, so an update of the code set
  never refuses an answer; for an `entryAt`, a UTC time on a real date (2.3). The server's sync
  schema counts no characters in note data (it bounds a value at 64 KiB), so it never refuses for
  length an answer `checkAnswer` takes. It does refuse a text holding a NUL or half of a
  surrogate pair (`jsonProblem`, `services/api/src/sync/records.ts`), so `checkAnswer` refuses
  such a text too, as `wrong_type`, before its length is counted (a text field, an Other text and
  a problem's label alike): the phone never saves an answer the server would refuse.
- **`effectiveAnswers`** holds each answer that counts as stored. Leaving blanks and refused
  answers out makes it exactly what the content hash takes (lifecycle 4.5), and a finished note
  holds no `null`. An entry that is there keeps its `entryAt`. The keys are in UTF-16 code-unit
  order, the order `canonicalJson` writes, so the same answers always give the same map. JSON and
  Dart map equality ignore key order, so unit tests (`packages/forms/test/interp/`) pin it.
- **`finishCheck`** asks for a field with sides once for each side, for a field in a grid's cell
  once for each row that counts, and inside a repeating section in each entry that is there; a
  repeating section with no entry asks for nothing, and a field that does not count is not asked
  for. Empty is no answer `checkAnswer` takes, the same for every kind that may be required: so 0
  fills a number, a lone exclusive None fills a choose-many, Other fills a choice without its
  text, a text of spaces fills a text (the phone trims what it saves), and a flag is filled only
  when ticked. Problems are in the definition's order: sections, entries in the order added,
  fields as written, rows in order, right before left. A contradictory disposition is not looked
  at again: `checkAnswer` refused it when it was entered.
- **`normalAnswers`** gives nothing for a section that does not offer Normal, that is hidden,
  that repeats when no entry that is there is named, or that does not repeat when one is. It fills
  a field that shows, that no set flag clears, that holds no answer (a blank or a refused value is
  none, as for `finishCheck`), and that neither is nor sits in a group or grid marked `noNormal`
  or `collapsed` (6.3). A choose-one takes its normal option, a choose-many every normal option
  (`normal_conflict` makes one answer take them), a number its `normal`; each side and each row
  that counts is filled on its own. A field shows if it shows with Normal's answers in: a
  follow-up a normal hides is not filled, one a normal shows is, and the order fields are written
  in decides nothing. **Normal never makes an answer that counts stop counting.** When every
  normal at once would hide one (a detail charted under `not` intact, say), the normals are taken
  one at a time in the definition's order, each kept when, with those kept before it, it hides
  nothing, and those passed over are tried again until a round keeps none. What is returned is
  the kept answers that count with all of them in.
- **`recapLines`** lays out the answers that count, less everything a sensitive exam put there
  (for every reader, 6.6) and every field marked `recap: false` with everything in it, as the
  read model lays them out. Each item is its labels joined by `, `, then `: ` and its value; items
  are joined by `; `. In a repeating section each entry with an item is its title (its
  `itemTitle`, `{n}` being its place among the entries that are there), `: ` and its items, and
  entries are joined by `. `. The vector file's note gives the rest of the wording, which both
  interpreters write word for word.
- **`readModel`** gives the sections, and entries, that have an item, in the definition's order.
  An item is one answer that counts, except that a region, a problem, and a choice with its Other
  text are one item each, at the field's path. Its labels are those along its path (each group's
  and grid's, the row's, not the cell's, the field's, then Right or Left), and its value is
  written out: a code by its label, a choose-many's labels in the definition's order joined by
  `, `, an Other as its label, `: ` and its text, a number at its decimals with "n of max" when
  shown out of a maximum and its unit after a space, a flag as Yes, a duration in weeks and days
  ("2 weeks 1 day", "0 days"), a region's labels joined by `, `, a problem as "label (code)", a
  date and a time as stored. Only a correction whose outcome is `corrected` marks an item, in the
  order given, `old` being the old value written as that answer alone would be (null for a
  blank, or for a value `checkAnswer` refuses there), and the credential as its code, which the
  renderer words. **A change whose answer no
  longer counts**, because the correction cleared it or hid the field it changed, is an item all
  the same, at its place, with value null, while its old value can be written out, so the old
  value stays visible struck through; its section, or its entry while that entry is there, is
  listed for it. A correction that removed an entry, and an answer a correction hid without
  changing it, mark nothing: `readModel` sees only the answers that count now (10.1 #13). It
  leaves nothing out for any reader: the caller passes the answers and the corrections the reader
  may see (lifecycle 5.1). A field marked `recap: false` is in it.
- **`visibleAnswers`** starts from `effectiveAnswers` of the whole note, so no reader sees an
  answer that does not count. Whoever acts as the author gets all of that; the author's own sync
  read of a draft does not go through it at all (lifecycle 4.4). It gives null for a note type
  offered for Medical only to a reader who does not read Medical notes, and for a sensitive note
  type to a reader without `viewSensitive`. Otherwise it takes out, and never blanks: without
  `viewSensitiveExams`, what a sensitive exam put there (6.6); without both `viewSensitive` and
  `chartsMedical`, every `treatmentRecord` section; without `viewSensitive`, a diagnosis whose
  code is sensitive, with its entry, or outside a repeating section its whole section. A code is
  sensitive by phase 3's rule (`isSensitiveCode`, exported): its first characters, as many as a
  range's `from` has, sort between `from` and `to`, both included. Only the code decides, so a
  diagnosis with a label and no code is not sensitive. `ordersMedications` changes nothing: `needs`
  hides nothing from a reader (2.2).
- **`handoffLines`** takes two lists side by side: `defs[i]` is the definition of note `i`'s own
  version, and `answersByNote[i]` the answers its reader may see (`visibleAnswers`, applied by the
  caller), or null for a note they may not see, which gives no line and keeps its place; lists of
  different lengths throw. Its third argument is phase 3's sensitive code list, as a reader's
  `sensitiveCodes`. The field lines come first, note by note in the order given: the items,
  laid out as the read model lays them out from the answers that count less what a sensitive exam
  put there, of each field marked `handoff` with everything in it, and of a marked field inside a
  group or grid that is not marked, alone. `label` is the item's labels joined by `, `, with an
  entry's title first in a repeating section. Then come each note's recap lines, `label` being the
  section's title. `note` is the note's place in the lists, and the screen and the PDF head each
  note with `defs[note].title`. Wave D's review added two rules, in both interpreters and the
  vectors:
  - **A quick answer Expand carried into a full note has no field line of its own**: a field is
    left out of the field lines when its `mapsTo` (its own, or a group's or grid's around it)
    names a note type of which a note in the lists holds an answer that counts at the target of
    one of its answers. The full note's line stands for it, and stays right when that note is
    corrected. Each note's recap still shows the answer, so after Expand a vital is in the
    summary three times, not four (10.1 #6).
  - **No recap line of a `treatmentRecord` section**, for any reader: EMS may not read a
    treatment record (`validate.handoff_restricted`), and a reader who may see one, its author or
    one with `view_sensitive` and a clinical credential, would otherwise hand it over.
  - **No sensitive diagnosis**, for any reader, in either part: before anything is laid out, each
    note's answers that count lose every diagnosis whose code is on the list, with its entry or,
    outside a repeating section, its section, as `visibleAnswers` takes them from a reader without
    `view_sensitive` (the two share `sensitiveDiagnoses`). The entries left are numbered among
    themselves. A sensitive note type's own recap stays for a reader who may see it (10.1 #6).
- **`suggestions`** reads only stored codes that count: a choice's, a region's parts, a choice in
  a grid's cell. A grid's fixed row is never picked, so a `suggests` on one suggests nothing. The
  order is the definition's (fields as written, a field's options as listed, a region's options,
  then its side, then its surface), whichever entry picked an option and whenever, so two phones
  show the same chips. It returns every key suggested, the note's own type and the visit's other
  note types included: the summary screen leaves out those already in the visit (lifecycle 9.6).
- **`expandQuick`** walks the quick definition's fields in order, at every depth, and maps each
  answer that counts of a field whose `mapsTo` names this full note type to the target path, with
  what follows the quick field's own path kept (a side, `_other`, a region's part, a group child's
  id). The rest is in 6.4.

### 7.2 The vectors (written by the planner, level X)

`packages/contract/test-vectors/forms-conformance.json`: about ten small made-up definitions that
between them use every kind, every option flag, every condition form, a repeating section, sides
and a grid, each with cases for every function in 7.1: the inputs and the exact output. The
TypeScript tests (`packages/forms/test/conformance.test.ts`) and the Dart tests
(`apps/mobile/test/forms/conformance_test.dart`) both read it.

As built (unit F1):

- **The file is `{ note, definitions, cases }`.** `note` is one text that states what the cases
  alone cannot show: the entry ID and `entryAt` formats, the order of `checkAnswer`'s checks, how
  an item is laid out and its value written, the wording of the recap and the read model, the
  rules of `visibleAnswers`, `suggestions`, `handoffLines` and `expandQuick`. `definitions` maps a
  name to a resolved definition. There are fourteen, made up, with keys `demo_*` and labels
  "Demo …": `visit`, `wound`, `exam`, `outreach`, `psych`, `quick` (`demo_quick` version 2),
  `quickOld` (its version 1, which maps answers the newest full note types do not all take),
  `problems`, `ems`, `social`, `checkup`, `intake`, `rehab` and `rules` (a Normal section built
  so that one-tap Normal's retry is the only way to its answer, and a diagnosis hidden by a
  condition). `cases` maps each function of 7.1 to its cases, 589 in all, each
  `{ name, definition, why, expected }` with `why` optional, and the inputs its function reads:
  `path`, with `value` for `checkAnswer`; for the rest `answers`,
  with `section` and an optional `entry` for `normalAnswers`, `corrections` for `readModel`,
  `reader` for `visibleAnswers`, and `full` (the full definition's name) and `newEntryIds` for
  `expandQuick`. A `handoffLines` case gives `notes`, a list of `{ definition, answers }`, with
  `answers` null for a note the reader may not see, and `sensitiveCodes`, the list it is given;
  its own `definition` is the first note's.
  `fieldAt`'s expected value is the plain projection `{ points, at, entry, row, side, part,
  stores }`, `stores` saying whether `holds` is set.
- **The TypeScript reader** (`packages/forms/test/conformance.test.ts`) runs `validate()` on
  every definition, with the newest version of each key in the file as the note types it may
  name, and holds each key and version to one definition. It checks that the definitions between
  them still use every kind, option flag, condition form on a section and on a field, `./` in an
  entry and in a cell, section mark, sides, `handoff`, `mapsTo`, a flag that clears, a number's
  `normal` and second unit, both kinds of grid rows, a region's side and surface, and a sensitive
  and a quick note type. It holds its list of functions to the table above, each exported from
  the package's index with its number of arguments. It refuses a case with a key its function
  does not read, or without one it needs, a name used twice in a function, or a definition the
  file does not have. Then it runs every case and compares the result with `expected` as plain
  data, in which key order plays no part.
- **The Dart reader** (`apps/mobile/test/forms/conformance_test.dart`) is unit F2's, and reads
  the file the same way. A rule either interpreter keeps is pinned by a case here, not by a unit
  test on one side only, so that breaking it on either side fails a test.

  As built (unit F2), it holds no answer of its own. It reads each definition with
  `NoteTypeDef.fromJson` (3.4), calls each function with a case's inputs, and writes the result
  back as plain data to compare with `expected`: `fieldAt`'s target as the same projection, an
  enum by its name, a problem by its code, a line or a model through its `toJson`. Like the
  TypeScript reader it runs every function the file holds, names the inputs each one reads, and
  refuses a case with a key its function does not read or without one it needs, a name used
  twice, or a definition (or a `full`, or a note's) that the file does not have. Dart's map
  equality ignores key order, so for the four functions whose order is part of the answer it also
  checks that the keys come in UTF-16 code-unit order (`String.compareTo`, as JavaScript's `<` on
  strings): `effectiveAnswers`, which the content hash is taken over; `visibleAnswers`; and
  `normalAnswers` and `expandQuick`'s answers, which the phone writes as changes in that order. It
  does not run the validator or check what the definitions use between them: the TypeScript reader
  does that over the same file.
- **Beside the vectors**, `packages/forms/test/interp/one-meaning.test.ts` holds the validator's
  meaning of what counts (`validate.ts`) to the interpreter's. On 300 small definitions made from
  a fixed seed, each tried with every answer set where there are at most 256, and with a fixed
  sample of 256 otherwise, it holds that a field the validator reports `required_never_visible`
  shows under no answer set; that a required field it lets through shows under some set, wherever
  every set was tried; that `effectiveAnswers` of `visibleAnswers` is `visibleAnswers` for every
  reader, so what a reader sees counts by itself; and that one-tap Normal offers only answers
  `checkAnswer` takes, each of which counts once written, and hides none that counted.
- **Beside the vectors on the phone**, a few Dart tests under `apps/mobile/test/forms/` hold what
  the vectors cannot say, each naming it in its header: JSON is one thing to TypeScript and two
  to Dart, where 3 and 3.0 are an int and a double, and the phone also hands the interpreter
  values no JSON decoder made (`check_answer_test.dart`, `read_test.dart`); a map's key order and
  whether a list was copied (`effective_test.dart`, `visible_test.dart`, `expand_test.dart`);
  what Dart must not do with odd data that TypeScript cannot, throw or loop
  (`effective_test.dart`); a definition read with its defaults, and a shape the validator would
  never pass refused by its place (`definition_test.dart`); and two lists of different lengths,
  which a vector case cannot give (`handoff_test.dart`).

### 7.3 The golden file (generated)

`packages/forms/generated/golden.json` is written with the export (4.1). For every real note type
version it holds what the TypeScript interpreter says for sets of answers made by rule, three as
designed (five as built, below): no answers; every section opened and one-tap Normal applied; the
first option of every choice picked. For each: `finishCheck`, `recapLines` and the hash of
`readModel`.

The Dart test `apps/mobile/test/forms/golden_test.dart` recomputes all of it from the bundled
presets and compares. So the two interpreters are held together on the real forms, not only on
the small ones, and a transcription card that trips a difference fails a test.

As built (unit E, `packages/forms/scripts/golden.ts`, run as `pnpm --filter @sineobex/forms golden`
after the export, from the `presets.json` it wrote). Wave D's review found that three sets reached
6 of General's 29 sections, and widened the file to five sets and more for each:

- **The five sets** are made from the definition alone, so the phone can make the same, and are
  named `blank`, `normal`, `first`, `systems` and `every`. `blank` has no answers. Each of the
  others first opens every section: a repeating section gets one entry, `e0000001` at
  `2000-01-01T00:00:00Z` (`GOLDEN_ENTRY`); any other section is opened by looking at it, which
  stores nothing.
  - `normal` applies one-tap Normal to each section, in the definition's order, each against the
    answers so far.
  - `first` picks the first option of every answer that holds codes, hidden or not: each choice,
    each part of a region (the region, its side and its surface), each grid cell and each side, a
    choose-many as a list of that one code. Nothing else is made up: no text, number, flag, date,
    time, duration or problem. `first` is the run that tries every condition on a choice once
    (10.4, risk 2).
  - `systems` sets every answer that opens something, one a condition names or a grid picks its
    rows in: a choose-many takes every option it can hold together (no exclusive option, and of
    a blocked pair the first), a choose-one its first option, a flag is set, and nothing else is
    made up. Then Normal, as in `normal`. So every exam system is picked and every module opened
    before Normal runs on it, and a sensitive exam's Exam performed is ticked while its consent
    is left blank, which `finishCheck` must ask for.
  - `every` fills every answer, hidden or not: a choose-many as in `systems`, a choose-one its
    last option, a flag set, and every other kind a fixed value (`FILLED`: the text "Demo" cut to
    the field's `maxLength`, a number's `min`, the date 2000-01-01, the time 12:00, 10 days, and
    the problem F11.20, "Demo problem"). Then Normal. So every system has a finding charted, and
    every follow-up a finding opens is reached.
- **Each case** is `{ name, answers, finishCheck, recapLines, handoffLines, effectiveKeys,
  readModelHash, visibleHashes, contentHash, expansions }`. `handoffLines` is the note's alone, as
  its author sees it, with the sensitive codes F10 to F19 (`GOLDEN_SENSITIVE_CODES`), so the
  diagnosis `every` makes is left out of it; `effectiveKeys` are the keys of `effectiveAnswers`, in its order. The hashes
  are SHA-256 of canonical JSON, which holds every label and value without copying them:
  `readModelHash` of `readModel(definition, answers, [])`; `visibleHashes` of `visibleAnswers`,
  null included, for three fixed readers (`GOLDEN_READERS`), none acting as the author, so every
  rule of 7.1 runs: `full`, `noExams` (no `view_sensitive_exams` and no clinical credential, so no
  sensitive exam and no treatment record) and `noSensitive` (no `view_sensitive`), with the
  sensitive codes F10 to F19, among them `FILLED`'s; and `contentHash`, the hash a sign-off would
  carry (lifecycle 4.5) for a fixed note, visit and patient (`GOLDEN_NOTE`). `expansions` gives,
  for each note type a `mapsTo` names, what `expandQuick` writes into its newest version, a
  repeating section's new entry being `e0000002` at `2000-01-02T00:00:00Z` (`GOLDEN_NEW_ENTRY`).
  `answers` are written in code-unit key order, so a difference in the answers made (one-tap
  Normal on the phone, say) is told apart from a difference in what is said about them.
- **The file** is a list in the presets' order, each `{ key, version, hash, cases }`, the five
  cases in that order. It holds what the presets hold, the released versions (D78, 3.2), so it is
  `[]` until F6-release, which adds nine note types of five cases each, about 190 KB.
- **The content hash** is worked out by mirroring the API's `noteContent`, since the script cannot
  load `services/api`. `services/api/test/note-content-hash.test.ts` holds the API's
  `noteContentHash` to every case of `golden.json` and of the phone's sample, and the phone's test
  holds its own.
- **What the sets reach on the real note types** is held by `packages/forms/test/golden.test.ts`,
  which resolves the definitions itself, so it runs before they are released. Between them
  `first`, `systems` and `every` give every section of every note type an answer that counts;
  `systems` opens each of General's exam modules before Normal runs on it, and ticks GU's,
  Breast's and Rectal's Exam performed with consent blank, so `finishCheck` asks for consent; and
  the quick encounter's `every` expands into General, Social needs and Wound care, with answers in
  each. A trial on a released copy found the two interpreters, and the API's content hash,
  agreeing on all 45 real cases.

As built (unit F2): the test also holds the presets and the golden file to the same keys,
versions and hashes. Until the definitions are released, `golden.json` is empty, so the same
check runs over `apps/mobile/test/forms/golden_sample.json` as well: the fixture note types and
the vectors' definitions, with what TypeScript says about them. `packages/forms/test/golden.test.ts`
writes that sample as a file snapshot, so a change on the TypeScript side fails there until the
sample is written again, and the phone's test then says whether Dart agrees.

- **What the phone's test checks**, for the bundled presets against `golden.json`, then for the
  sample's presets against its golden list: the same keys, versions and hashes in the same order;
  each preset's hash is `valueHash` of its definition; Dart makes the same five sets by the same
  rules and the same entry, answer for answer and in the same key order; and over the golden
  list's own answers, `finishCheck`, `recapLines`, `handoffLines`, the keys of `effectiveAnswers`
  in their order, the hashes of `readModel` and of `visibleAnswers` for the three readers, the
  content hash (`noteContentHash`) and each expansion say the same. Comparing over the file's
  answers keeps a fault in Normal apart from a fault in the recap.
- **The sample cannot pass empty**: the test asks it for more than ten note types, for `normal`
  answers that fill a field as well as answers that open an entry, and for a quick note type
  whose Expand writes something.
- **To write the sample again**, after a change to either interpreter, the fixture note types or
  the vectors' definitions: `pnpm --filter @sineobex/forms exec vitest run test/golden.test.ts -u`,
  then run the phone's test. The sample is about 260 KB.

## 8. The phone renderer and the portal read view

### 8.1 The pieces (all under `apps/mobile/lib/features/forms/`)

As built (unit F5):

| File | Is |
|---|---|
| `note_form.dart` | `NoteForm`, the shell: the sections as an accordion, each header with its recap line; the fields that show, each through the field host; groups, grids and actions, which the form lays out itself; the entries of a repeating section with Add and Remove; one-tap Normal for a section, an entry and a system |
| `field_host.dart` | `FieldHost`: the widget for a field's kind, its label and help, and under each answer it shows "Waiting to send" and phase 2's conflict choice. Also the host's contract with the form (`FormAnswers`, `AnswerState`, `AnswerConflict`, `ConflictBy`), `answerPaths`, `otherTextPath` and `answerText` |
| `text_field.dart` | `NoteTextField`, and what the other widgets share: `TypingSaver` and `typingPause`, which save what is typed; `limitCodePoints`; and `ReadOnlyAnswer`, an answer that can't be changed |
| `choice_field.dart` | `ChoiceField`: the chips, and the box of the Other text (`otherTextField`); `pickedCodes` |
| `number_field.dart` | `NumberField`: the box, the second unit's switch, the stepper |
| `flag_field.dart`, `date_field.dart`, `time_field.dart`, `duration_field.dart` | A tick; a date typed in three boxes or picked on the calendar; a time picked on the dial; weeks and days |
| `group_field.dart` | `GroupField`, its two layouts (`FieldsInStack`, `FieldsInRow`), `clearedBy`, and `Collapsible`, the header of a collapsed group or grid |
| `grid_field.dart` | `GridField`, with `gridRows`, `gridSides` and `cellPath` |
| `region_field.dart` | `RegionField`: the region, the side and Front or back, each a choose-one of chips |
| `problem_field.dart` | `ProblemField`: a search of phase 3's problem code list |
| `action_field.dart` | `ActionField`, and `ActionHandler`, what the screen does for an action |
| `photo_field.dart`, `info_field.dart` | The place of photos until phase 8, which says "Photos arrive in a later release."; guidance |
| `note_read_view.dart` | `NoteReadView`, which draws a `readModel`, and `credentialText` |

No widget knows which note type it is in, and nothing in `features/forms` touches the store. A
widget calls back with the value to store; `note_form.dart` hands each change, one answer at a time,
to the screen, whose domain layer calls `checkAnswer` and then the store's `setField` (lifecycle
9.5). As planned, a widget is given its field, its value, a callback and `enabled`, except where a
kind stores more than one answer, or none: a choice is also given its Other text and a callback for
it; a region and a diagnosis take and give their parts together (`RegionAnswer`, `ProblemAnswer`);
and a group and a grid take a builder that draws each of their fields, since they store nothing
themselves.

**The host's contract with the form.** The form gives each field host a `FormAnswers`: `at(path)`
gives an `AnswerState`, and `change(path, value)` takes a change, `null` being the clear of an
answer. A path is the answer's whole path, its entry part and side included. An `AnswerState` is the
value as stored, whether it is `pending` (saved on this phone and not yet confirmed by the server)
and, when two people changed it, an `AnswerConflict`: the value on the server (`theirs`), who holds
it (`ConflictBy`: a teammate, the same person on another phone, or the server), when, and
`onChoose(keepMine)`, which is null while charting is paused for the phone's clock. `NoteForm` is
its own `FormAnswers`, made from what the screen gives it (below). A field host can also draw a
group, a grid (given its picked `rows`) or an action (given `actions`) by itself, as its tests do;
in a note form the form lays those out.

**The field host.**

- It shows the label and the help above the widget, but for the kinds that show their own: a text, a
  number, a tick, an action and a diagnosis label their own box or button, a collapsed group or grid
  its header, and guidance is its label. The label it shows is kept from a screen reader, since each
  control says it, and the help is heard after the field's controls (review finding A11Y-5).
- A field with sides is answered at `<path>.right` and at `<path>.left` (`answerPaths`), each under
  its side's name, a semantics container named Right or Left. A grid lays out its own sides.
- Each answer's widget is keyed `form.<answer path>`, so what is typed never moves to another
  answer.
- Under the widget, "Waiting to send" shows while an answer it shows is pending, and phase 2's
  choice for each of those answers that has a conflict. A region shows those of its three parts, and
  a diagnosis those of its code and its label. A choice with an Other option shows those of its
  Other text as well, whether or not Other is still picked, the text's values written as text: it is
  an answer of its own, and a conflict on it must be answerable where it was charted (review finding
  BEH-1).
- A conflict on both a diagnosis's code and its label is one choice, written "label (code)", which
  keeps both parts of one side, so a code is never kept with the other side's label. It can be
  chosen only when each part's can.
- The choice uses the words of phase 2's Needs attention screen: "This field already had a different
  value. Choose which one to keep.", the two values side by side under "Your value" and "A
  teammate", "You, from another phone" or "On the server", with the time, then "Use my value" and
  "Keep theirs" (or "Keep the server’s"), and "Both values stay in the note’s history either way."
  It names no teammate (PLAN-OPEN, 10.1 #52). While the person can't choose it says "You can choose
  once the phone’s clock is right.", and on a read-only field its buttons do nothing. `answerText`
  writes each value: "(blank)" for none, a date written out, anything else as the read view writes
  it, and a value of the wrong type as stored.

**What each kind writes, and where** (2.3; `null` clears an answer at any path, 7.1):

| Kind | Writes | At | When |
|---|---|---|---|
| `choice`, one | its code; tapping the picked chip again writes `null` (PLAN-OPEN, 10.1 #49) | the field's path | at the tap |
| `choice`, many | its codes in the definition's order, whatever order they were tapped in; `null` once the last is unpicked, never `[]`. An exclusive option clears the others when picked, and another clears it; a blocked pair is refused (8.2) | the field's path | at the tap |
| the Other text | the text, trimmed, at most 200 code points; `null` for none. Its box opens under the chips while Other is picked, labelled with the option's label: "Say what “Other” is". Unpicking Other hides the box and leaves the text, which no longer counts: clearing it would be one more change to sync | `<field>_other`; with sides `<field>_other.right`; in a grid's cell `<grid>.<row>_other`, then the side | as typing pauses |
| `text` | the text, trimmed, at most `maxLength` code points; a box of spaces writes `null` | the field's path | as typing pauses |
| `number` | a number in the base unit at the field's decimals, a whole one as an integer; an empty box writes `null`. What can't be saved writes nothing, and the answer stays what it was (8.2) | the field's path | as typing pauses; a stepper when tapping pauses (PLAN-OPEN, 10.1 #45) |
| `flag` | `true`; unticking writes `null`, never `false` | the field's path | at the tap |
| `date` | `YYYY-MM-DD`, typed (month, day, year) or picked on the calendar; Clear, or emptying the three boxes, writes `null` | the field's path | when typing pauses or the boxes are left, as a number; when picked |
| `time` | `HH:MM` on the 24-hour clock, picked on the dial; Clear writes `null` | the field's path | when picked |
| `duration` | the weeks and days typed, as whole days; two empty boxes write `null`. More than its most, or what isn't whole numbers, writes nothing, and a line says why at once. Days past six are shown as weeks the next time it is drawn | the field's path | as typing pauses; moving between its two boxes does not save |
| `group`, `grid` | nothing themselves: each of their fields at its own path | a group's fields at `<group>.<id>`; a grid's cell at `<grid>.<row>`, then the side; a group cell's fields after the row | |
| `region` | a code for each part, each part its own answer, cleared alone by tapping its picked chip | `<field>.region`, `<field>.side`, `<field>.surface` | at the tap |
| `problem` | the code picked and its title as the label, cut to 300 code points, written together; Remove writes `null` to both. What was typed to search is never stored | `<field>.code`, `<field>.label` | when a match is picked |
| `photo`, `action`, `info` | nothing | | |

"As typing pauses" is one second with no keystroke (`typingPause`; PLAN-OPEN, 10.1 #42). Leaving the
box, Done, and the box leaving the screen or turning read-only save at once, the last two in a
microtask, so Save & Close while typing loses nothing. A value changed elsewhere, by a sync or a
conflict's choice, replaces what a box shows unless the person is typing over it. A choice keeps
what it last showed as picked, so two taps before the form is drawn again both count.

**The form** (`NoteForm`):

- **The accordion.** The sections that show, in the definition's order, one open at a time. Each
  header (keyed `form.section.<id>`) is a heading and a button that says whether it is open (review
  finding A11Y-8). Without `openSection` the first section that shows is open (PLAN-OPEN, 10.1 #47);
  a new `openSection` opens that section and brings it into view. A closed header shows the
  section's line from `recapLines`, cut at three lines on screen (PLAN-OPEN, 10.1 #48), and its
  semantics value is the whole line; an open section shows its fields instead. The recap is worked
  out as it is drawn and never stored, and nothing a sensitive exam recorded is in it, for anyone
  (lifecycle 8.1).
- **What is drawn.** The form reads the note as the interpreter does (`NoteReading`,
  `conditions.dart`): the field host holds neither the definition nor that reading. A section or a
  field whose condition does not hold is not drawn, and its stored answer is left alone, so it is
  back if the field shows again (7.1). Inside a grid's cell `./` is read from the row, elsewhere
  from the entry. A section that `needs` a capability is drawn only when the screen's `capabilities`
  hold it, even when it holds a teammate's answers (PLAN-OPEN, 10.1 #53; 6.4).
- **What a set flag clears.** While a set flag counts, the fields it clears are drawn read-only,
  among a section's own fields and inside a group (2.3), and nothing is written to them. A flag that
  is stored but does not count clears nothing, and a picker that does not count picks no grid row
  (pinned after review finding BEH-3).
- **Groups and grids** are laid out by the form, with their label and help above them unless
  collapsed, and each of their fields drawn by a field host of its own, so each keeps its own
  "Waiting to send" and conflict choice. A grid's rows are its own, or the options picked where its
  picker counts, in the picker's order; with none picked it says "Each one picked above gets its own
  line here." A collapsed group or grid that holds an answer opens with it showing (PLAN-OPEN,
  10.1 #50), and a read-only one still opens, to be read. A grid's cell is drawn bare, its row's
  label standing for the cell's (7.1).
- **An action** is drawn only on a form that can be changed, and only where the screen's
  `ActionHandler` gives it something to do; otherwise nothing is drawn, not even its label, so it
  leaves no gap (PLAN-OPEN, 10.1 #51; #39). Its button carries the field's label, its help under it,
  and while the future it starts runs a second tap does nothing, so one tap opens one note.
- Every other field is a `FieldHost`, keyed `host.<path>`.

**Entries.** Each entry of a repeating section is titled by its `itemTitle`, `{n}` being its place
among the entries that are there, as the recap and the read view number them, and is a semantics
container named by its title. Remove, read as "Remove Wound 1", writes the entry's `entryRemoved` as
`true`. It asks first ("Remove Wound 1?", "Its answers will no longer count. They stay in the note’s
history.") when the entry holds an answer, and removes an empty entry at once. Add ("Add wound")
writes `<section>.<id>.entryAt`, the time in UTC, at an ID (`makeEntryId`: `e` and seven characters
from `a-z0-9`) that no answer of the note uses, a removed entry's included. With no entry the
section says "No wound added yet."; at its most, "A note holds at most 10. Remove one to add
another." stands in for Add. An entry's title and Remove share a line where they fit, and Remove
goes under the title at large text (review finding A11Y-6). A read-only form offers neither Add nor
Remove.

**One-tap Normal.** A section that offers it (`normal: true`) has "All normal" at the top of its
fields, read as "All normal, " and the section's title; a repeating one has one in each entry, for
that entry, read with the entry's title. A system examined over several sections has one more, above
the first of them that is drawn (10.3 #7). Each runs `normalAnswers` and writes each answer it
returns, one at a time (6.3), each section or entry seeing what was written before it. What it did
is said under it, "12 answers filled as normal.", "1 answer filled as normal." or "Nothing left for
Normal to fill.", as a live region where the platform reads them and as an announcement on iOS. A
read-only form offers no Normal.

**The read view** (`NoteReadView`) draws a read model and nothing else: what the reader may see was
settled when the model was made, and it knows nothing of kinds. It is a column that does not scroll,
which the visit screen places among the note's recap, sign-offs and addenda (lifecycle 9.7).

- Each section's title, and in a repeating section each entry's title, is a heading. Each answer is
  one read-only node (keyed `read.<path>`), read as its labels joined by ", ", then its value.
  Values are written exactly as the read model writes them (a date as `YYYY-MM-DD`, a time as
  `HH:MM`), so the phone and the portal match (8.4).
- An answer a correction took away shows no value on screen, and a screen reader hears "No answer
  now" before the old value.
- Each correction, in the order given (keyed `read.<path>.correction.<i>`): the old value struck
  through, read as "Replaced: " and the value, a blank old value shown as "(blank)" and read as
  "Replaced: blank"; then "Changed by" with the name, the credential in words, and the date and time
  in the phone's own time zone; then "Reason: " and the reason. `credentialText` words a credential
  as the portal does, and leaves out one this app version doesn't know rather than show its code.
- A note with no section says "Nothing was recorded in this note."
- `itemAction` lets the screen put a widget under an answer: Correct, for the acting author.

**What the screen owes the form** (units L4 and L5; lifecycle 9.5 to 9.7):

- **The note's answers, drawn again after each change.** `answers` is the note's map as stored,
  entry parts included, and `definition` the note's own version. `onChanged(path, value)` gets one
  answer at a time: L4 checks it (`checkAnswer`) and saves it (`setField`), and the screen draws the
  form again with the answers the store then holds, so what shows follows each answer. The widgets
  never send what `checkAnswer` refuses for a blocked pair, an exclusive option, a range, decimals
  or a length. The form keeps no copy of its own: until it is drawn again a choice shows what it
  last sent and a box what was typed, but Normal works from the answers it was given, so a second
  tap before the screen draws again writes the same values again, each one more change to sync.
  Whether the form should keep a working copy is open (F5's review).
- **A change after the form has gone.** A box saves what was typed as it leaves the screen, in a
  microtask, so `onChanged` can come after the form is disposed (Save & Close while typing). The
  screen must take it without the form on screen.
- **What waits and what conflicts:** `pending`, the paths saved on this phone that the server has
  not confirmed, and `conflicts`, an `AnswerConflict` for each path two people changed (lifecycle
  9.5), its `onChoose` null while charting is paused for the clock (lifecycle 3.11).
- **The capabilities:** `capabilities` holds `orderMedications` for a credential that may order, or
  the Quick encounter's Medication section is not drawn (6.4).
- **The action handlers:** an `ActionHandler` gives, for an action field at its path, what to do, or
  null where it can't be done there. `open_note_type` gets one only where its note type can be
  started in the visit, opening that note type's draft or making one (lifecycle 9.4; not a
  Medical-only note type in a Non-Medical visit, 10.1 #39); `show_handoff` and `add_referral` where
  the screen offers them (lifecycle 7, 9.8; cards F7-actions and F7-handoff).
- **Where to open:** `openSection`, for the summary's jump to a section (lifecycle 9.6).
- **The read view for a finished note** (lifecycle 9.7): `NoteReadView` given `readModel` of the
  answers and the corrections the reader may see, with Correct under an answer through `itemAction`
  for the acting author only. Sign-offs, attestations and addenda go below it. The form's
  `enabled: false` draws every answer read-only, its sections still opening, for a note the person
  may read but not change now.
- `newEntryId` and `clock` make an entry's ID and its `entryAt`; they default to `makeEntryId` and
  the phone's clock.
- **Open from F5's review (BEH-4).** A teammate's phone holds someone else's draft as
  `visibleAnswers` gives it (lifecycle 4.4), so a choose-many it writes holds only the codes its
  reader may see: a teammate without `patients.view_sensitive_exams` who taps the exam picker sends
  a list without the GU, breast or rectal code the note holds. The phone cannot put back what it was
  never sent; what the server does with such a set is lifecycle 4.4's.

### 8.2 What every field widget must do

The rules of `docs/plan/patterns/phone-screen.md`, plus these, each as built:

- **A choice** shows chips that wrap, each at least 48 px high and each one node for a screen
  reader: a button with its label, a tap action, and its selected state from the selected flag,
  never in the label, so "selected" or "not selected" is said once. Choose-one chips are a group of
  which one is picked. A picked choose-one chip clears the answer when tapped again, and says so
  first: "Double-tap to clear." as its hint on iOS, and "clear" as the hint of its tap elsewhere, so
  TalkBack says "double-tap to clear" (review finding A11Y-7). A picked Other chip is read as
  "Other, text box below"; the box is not focused by itself.
- An exclusive option clears the others when picked, and is cleared when another is picked.
- **A blocked pair:** picking the second does not select it, and one line under the chips names the
  first option held that it clashes with, in the released labels ("Declined can’t be picked with
  ED."). It is said once: a live region where the platform reads them, an announcement on iOS. A
  second tap on the same chip says nothing new, and the line goes at the next pick or clear. So the
  widget never stores what `checkAnswer` refuses as `exclusive_with_others` or `excluded_pair`, and
  its tests run `checkAnswer` on what it stores.
- **A number** has a numeric keyboard, with a decimal point only where the field keeps decimals or
  has a second unit and a sign only where its range goes below zero, and shows its unit, or "out of
  10" for a score, after the box, read as its own node after it. A value that is not a number, has
  more decimals than the field keeps, or is outside the range is not saved, and the answer stays
  what it was; zeros at the end of the decimals are not counted, so 2.50 is 2.5 (review finding
  BEH-2). The line that says why ("Type a number.", "Type a whole number.", "Type at most 1 decimal
  place.", "It must be from 50 to 115 °F.") is a live region. It is set when the save would run, as
  typing pauses, when the box is left or on Done, never at a keystroke, so typing 98.6 does not say
  the range at its 9; it goes as soon as what is typed can be saved (review finding A11Y-1).
- **A second unit** (`altUnit`) is a two-way switch under the box, the base unit picked each time
  the field is drawn (PLAN-OPEN, 10.1 #44). A value typed in the second unit, at any number of
  decimals, is converted and rounded to the field's decimals in the base unit, which is stored, and
  "Saved as 5.1 cm." says so. Switching shows the same answer in the other unit, the second at one
  decimal place more than the field keeps, and saves nothing. The range is said in the base unit.
- **A stepper** (`display: stepper`) puts "One fewer" and "One more" either side of the box, each a
  button of at least 48 px read with the number. It starts at the least from an empty box, steps by
  one, and stops at each end of the range.
- **A text field that can hold patient details** turns suggestions and autocorrect off, as
  `PhiField` does (`apps/mobile/lib/features/patients/patient_widgets.dart:24`). Every box a form
  types in is one, keyed `phi.form.<field id>`: a text, the Other text (`<id>_other`), a number, a
  duration's weeks and days (`<id>.weeks`, `<id>.days`), a date's month, day and year
  (`<id>.month`, `<id>.day`, `<id>.year`) and the diagnosis search. A text counts code
  points, as the server does, and is cut at its `maxLength`; its own counter shows from 90%, and
  says once that it is near the limit and once that it is at it, as phase 3's note counter does. The
  calendar and the time dial have no typing mode: theirs are text boxes without these settings,
  which the keyboard would learn from. A date is typed in its own three boxes instead.
- **A date** is typed in three private boxes, Month, Day and Year, in one node named by the
  field's label: month first and a four-digit year (PLAN-OPEN, 10.1 #54), side by side, or one
  under another where they would not fit their labels (200% text). It is read as phase 3's birth
  date is (`dob.dart`'s month names and days in a month) and saved as `YYYY-MM-DD` when typing
  pauses or the boxes are left, as a number is. A date half typed says nothing until the boxes are
  left; one that can't be saved (no such day, a month past 12, a short year, the wrong side of
  today, beyond the picker's reach) leaves the answer as it was, and one line under the boxes says
  why, once. A saved typed date is read back once, month spelled out ("Saved as March 7, 2027.").
  Beside the boxes, a button read as the field's label and the date written out, or "no date",
  opens the calendar, the second way in, with Clear beside it once there is one; a time is the same
  button, in the phone's time format. Typed or picked, a date reaches a hundred years back and ten
  ahead, on the side of today the field's `range` allows (PLAN-OPEN, 10.1 #43). `checkAnswer` has
  no clock, so a stored date outside the range now, a follow-up that has passed, is still shown and
  left alone until changed, and the picker opens on the nearest day it can show.
- **A diagnosis** is a private search box carrying the field's label, which searches phase 3's
  problem code list on the phone by word or by code, with or without its dot, and lists eight
  matches at most, each a button read as its title and code. Only a code from that list can be
  picked (PLAN-OPEN, 10.1 #46). A code on phase 3's sensitive list is marked Sensitive, on a match
  and once picked, as the problem list marks it; only the code decides. Once picked it is read as
  the field's label with "label (code)", and Remove clears it. "Add to the problem list" (lifecycle
  8.3) is not part of the widget: card F7-problem-button adds it.
- **A region** is up to three choose-ones of chips: the region (the field's options, in every
  released note type the eleven of the shared list, in its order); then Side, where the field names
  a side list; then Front or back, where it asks for its surface (10.1 #3).
- A grid reflows to one row per line at 320 px and at 200% text. It never scrolls sideways. As built
  every grid is one row per line, each row named by its label, which stands for the cell's; with
  sides, a Right and a Left block sit side by side only where both fit at 280 px each, scaled by the
  text size (on a tablet), and one under the other on a phone, at 320 px and at 200% text. A group
  laid out as a row puts as many fields on a line as fit at 160 px each, scaled by the text size:
  two on a phone, one at 320 px or at 200% text, four on a tablet.
- **A disabled field** (a finished note, a frozen store, a field a set flag clears) is read-only and
  says so to a screen reader. A text, a number, a date, a time, a duration, a choice, a region and a
  diagnosis are drawn as `ReadOnlyAnswer`: the value written out ("98.6 °F", "7 of 10", "38 weeks 2
  days", "Arms, Right, Anterior", a date in words, a time as the phone shows times), or a dash read
  as "Blank", in full contrast in a sunken box, read as read-only and not enabled. A tick keeps its
  label and its help in full contrast (review finding A11Y-4). A disabled Material control would
  fade its words to about 38%, too faint to read.
- **What a screen reader hears:** a field's label, then its help (review finding A11Y-5); a
  section's header as a heading; a group, a grid's row and each side by name; nothing twice. What
  the form says by itself is said once, not again at each keystroke: a refused pick, a number's or a
  duration's line, a text's limit and what Normal did.
- **Every run:** each widget, the form and the read view pass in Day, Night run and High contrast,
  at 200% text and on a 320 px phone, and the whole form at 200% text on a 320 px phone in Day and
  Night run as well (8.3). At 300% text an entry's title and Remove still fit.
- **The one exception (review finding A11Y-3): the calendar's day cells.** They are Material's,
  seven to a row, under 48 px wide: 47.7 on a 390 px phone and 37.7 on a 320 px one, where seven
  columns of 48 px would need 336 px. So the calendar fails Android's tap target check in every run,
  and iOS's 44 px at 320 px. The typed date is the way in that meets every rule, in every run; the
  calendar stays as a second way. `date_field_test.dart` opens the calendar in `formRuns` with the
  guidelines on, holds its labels and contrast, and records which runs its cells can't meet, so a
  Flutter change that fixes them shows.

### 8.3 Tests without one test per form

As built, under `apps/mobile/test/features/forms/`. Every rule's test was run with its rule removed
by a script, and failed.

- **One widget test file per kind**, fourteen: each runs its main scenario in phase 3's five runs
  (Day, Night run, High contrast, Day at 200% text, Day on a 320 px phone; `forEachRun`) and ends
  with `expectFieldOk`: the four guideline matchers (Android's and iOS's tap target sizes, labelled
  tap targets, text contrast); every text box private (`expectPrivateFields`); nothing that scrolls
  sideways but a box's own line; no overflow; and the words of what can't be changed measured
  directly (`expectReadOnlyReadable`), a read-only answer on its sunken box and a tick on the
  surface and the ground, at 4.5:1 and 7:1 in High contrast, since the contrast matcher skips a node
  that is not enabled (review finding A11Y-2). Then its labels and tap actions, and the rules of 8.2
  for that kind.
- **The test helper** (`forms_test_helpers.dart`): a field from a made-up definition or from a
  bundled note type; `TestAnswers`, a `FormAnswers` in memory that draws a field again after each
  change, as the form does; `pumpField` and `pumpForm`, on a 390 px phone or a 320 px one in a run's
  theme and text size; `expectFieldOk`; and `formRuns`, the five runs and 200% text on a 320 px
  phone in Day and in Night run, the form's worst case for layout (review finding A11Y-9).
- **The field host** (`field_host_test.dart`): each kind gets its widget; each answer goes to its
  own path, a side's, a grid cell's, a region's parts, a diagnosis's code and label, and the Other
  text's, before the side; "Waiting to send" and the conflict choice, and the Other text's own in a
  section, on a side and in a grid's cell; one choice for a diagnosis; the label heard before the
  help.
- **The form:** `note_form_test.dart` (the accordion and its headers, the recap, conditions,
  `needs`, flags and pickers that count, groups, grids and picked rows, actions, a read-only form),
  `note_form_entries_test.dart` (Add, Remove and the question it asks, in `formRuns`; the order and
  numbers of entries; the most; 300% text) and `note_form_normal_test.dart` (a section's, an entry's
  and a system's Normal, on the released General note too: HEENT's four sections, MSK's regions and
  gait; what Normal says).
- **The read view** (`note_read_view_test.dart`): every `readModel` case of
  `packages/contract/test-vectors/forms-conformance.json` drawn, with each section, entry, item and
  correction checked; old values struck through, in order, with who, when and why, in the five runs.
- **One generated smoke test** (`presets_smoke_test.dart`): every note type in
  `assets/forms/presets.json`, in the seven runs of `formRuns`. Each is drawn three ways, with only
  the answers that open its fields, with every field that shows answered, and read-only; in each,
  every section and every collapsed group and grid is opened, every field that shows is found by its
  key (`host.<path>`, a group's, a grid's and an action's `form.<path>`, the Other text's
  `phi.form.<id>_other`), and `expectFieldOk` passes. The read view of every answered note is drawn
  in the same runs. It names no note type and no field: a small solver works the answers out from
  each definition's conditions (`is`, `filled`, `any`, `all`, `not`, `./`, a picked row for each
  grid of picked rows, an entry for each repeating section, Other picked to open its text), keeping
  answers that clash in separate sets, and a plain test holds it to the definition: every section,
  field and Other text shows in some set, and `checkAnswer` takes every value. A new note type is
  covered the moment it is in the presets. A field is checked in its grid's first row and in a
  repeating section's one entry, not in every row. No bundled field has help, so a field's help is
  held by the widget tests alone. It opens no picker: the date's typed boxes, the time dial and the
  question Remove asks pass the guideline matchers in `formRuns`, in their own files' tests, and the
  calendar is opened there too, its day cells the one exception (8.2, A11Y-3).

### 8.4 The portal

`apps/portal/src/app/(app)/encounters/[encounterId]/NoteView.tsx` (lifecycle card L6-visit-page) draws the
`read` model. It has no knowledge of kinds beyond what the model says: a label, a display value,
and for a corrected value the old one, who, when and why. Axe runs on it in three themes with
the rest of the visit page.

## 9. Tests, and the rule each one holds

| Rule | Test |
|---|---|
| The format: every file matches the schema and the semantic rules | `packages/forms/test/validate.test.ts` (a bad file for each rule in 4.2) |
| A released version never changes, and is released whole: a resolved line without its file's own line is refused | `packages/forms/test/lock.test.ts` (the second: "a version is released whole", 4.2) |
| A path or code is never reused for another meaning | `packages/forms/test/versions.test.ts` |
| Every option in SPEC is in a definition, or declared | `packages/forms/test/spec-check.test.ts`, and the export itself in CI |
| Both interpreters agree, on every function | `forms-conformance.json` through both readers, `packages/forms/test/conformance.test.ts` and `apps/mobile/test/forms/conformance_test.dart`; the Dart reader also holds the key order of the four functions where it is part of the answer (7.2) |
| The EMS handoff gives no recap line of a treatment record section and no line of a sensitive diagnosis, for any reader, and no field line of its own to a quick answer Expand carried into a full note of the visit | the `handoffLines` cases of `forms-conformance.json` through both readers; `packages/forms/test/real-definitions.test.ts`, "the EMS handoff on the real definitions" (7.1) |
| The validator and the interpreter mean one thing by what counts, and what a reader sees counts by itself | `packages/forms/test/interp/one-meaning.test.ts` (7.2) |
| The phone's interpreter holds what the vectors cannot say: a whole number held as a double, values no JSON decoder made, key order and copies, odd data read without a throw or a loop, and a definition the validator would never pass refused by its place | `apps/mobile/test/forms/{check_answer,definition,effective,expand,handoff,read,visible}_test.dart` (7.2) |
| Both interpreters agree on every real note type: the five answer sets, and over them the finish check, the recap, the handoff, the order of the answers that count, the read model, what three readers see, the content hash and Expand | `golden.json` and `apps/mobile/test/forms/golden_test.dart`; until the definitions are released, the same test over `apps/mobile/test/forms/golden_sample.json`, which `packages/forms/test/golden.test.ts` writes as a snapshot (7.3) |
| The golden file is what the interpreter says about each preset, for five answer sets made by rule, holds only what the presets carry, and is what is committed | `packages/forms/test/golden.test.ts` (7.3) |
| The golden sets reach every section of every real note type, open each exam module before one-tap Normal runs on it, leave a sensitive exam's consent for Complete to ask, and expand the quick encounter into each note type it maps to | `packages/forms/test/golden.test.ts`, "the golden cases on the real note types" (7.3) |
| The API, the golden file and the phone work out one content hash on the real forms | `services/api/test/note-content-hash.test.ts`, "the content hashes of the forms golden file"; `apps/mobile/test/forms/golden_test.dart` (7.3) |
| The export writes only what passed every check: every released version in a fixed order, its hash, the same bytes whatever a file's key order, the phone's copy byte for byte; it stops after schema problems and prints each problem once | `packages/forms/test/export.test.ts` (4.1) |
| Only a released version is a preset: a draft is checked, noted and never written, and a release makes what it releases presets in the same run | `packages/forms/test/export.test.ts`, "only released versions are presets (D78)"; `packages/forms/test/golden.test.ts`, "covers what the presets carry" (3.2) |
| Nothing is released that nothing checks or uses, and only `--release` writes the lock | `packages/forms/test/export.test.ts`, "the release mode" (4.1) |
| A released line never leaves the lock or changes: a lock deleted or emptied fails | `packages/forms/test/export.test.ts`, "the lock only grows"; `lock-grows` in the Forms drift step (4.2) |
| The forms, their generated files and the shared vectors are scanned for real-looking identifiers | `tools/test/phi-guard.test.mjs`, "fixture locations" (4.1) |
| An answer that breaks its definition is refused by the server | `services/api/test/sync-encounters.test.ts` (lifecycle), with the fake's parity case 14 |
| A phone starts a note only on a listed version; it keeps a definition only with the listed hash, key and version and only one it can read, and a list only once it holds every version the list names; the presets come first; a file changed on disk is not used; what it fetched last is there offline after a restart; each person and team has its own files, and a forget deletes only theirs | `apps/mobile/test/forms/definition_store_test.dart` (3.4) |
| A fetch that fails or is refused changes nothing; it downloads only what neither the presets nor the files hold, runs once per team at a time, writes nothing back after a sign-out, and also brings the versions the team's notes name | `apps/mobile/test/forms/forms_api_test.dart`, with the forms routes faked by `forms_fake.dart` (3.4) |
| Every team's list is fetched after sign-in, bound to that sign-in, and the open team's at each sync without stopping the sync; every sign-out, "Log out anyway" included, and every wipe path deletes the files | `apps/mobile/test/forms/definition_hooks_test.dart`, with the real session and sync controllers (3.4) |
| The app and its harness hold the store, its folder is inside the databases' folder and asked for once, and a sign-in through the harness's screens still settles | `apps/mobile/test/forms/app_wiring_test.dart` (3.4) |
| The table: one row per team, key and version, never changed; a preset row names its platform version; a team reads and writes only its own rows | `db/test/note-type-versions.test.ts` (3.1) |
| Installing presets writes only what a team lacks, each team its own, and is idempotent; a row with another hash is never overwritten and never passed over, even one another transaction wrote meanwhile; the seed installs in its teams | `db/test/install-presets.test.ts`; `packages/forms/test/install.test.ts` (the presets are the export's file; `PresetDiffers` names a key and a version and nothing else) (3.2) |
| A new team gets every preset in the transaction that creates it, audited in its chain, or is not created | `services/api/test/forms-routes.test.ts`, "a new team's presets" (3.2) |
| The list and definition routes: any member, nobody else; a refusal of another team, or a suspended one, is logged in the platform chain | `services/api/test/forms-routes.test.ts`, `permissions.test.ts` ("team scope refusals") |
| The list installs what the team lacks and audits only that, lists each key's newest version, logs and skips a differing key and still answers, and names its own team in its query | `services/api/test/forms-routes.test.ts` (3.2, 3.3) |
| A definition found is kept privately; every other response, a refusal or a 404 included, is `no-store`, whatever its handler set | `services/api/test/forms-routes.test.ts`, the one-version route and "the cache headers" (3.3) |
| No URL carries patient details: a note type's key and version are the only path parameters that are not IDs, with exactly 0017's patterns | `packages/contract/test/spec.test.ts` (3.3) |
| `definitionFor` reads a row once, keeps teams apart, and reads a missing row again | `services/api/test/forms-routes.test.ts`, "definitionFor" (3.3) |
| Consent is needed to complete a sensitive exam; Normal never fills it | conformance cases; the golden `systems` set on the real GU, Breast and Rectal sections (`packages/forms/test/golden.test.ts`) |
| On the real definitions, one-tap Normal never charts a finding beside an answer it contradicts (MSK strength for a side not examined, Intact skin beside a foot wound, a refill under 2 seconds beside a measured time of 2 or more); findings a clinician charts together are held, and their opposites refused; a Skin ulcer or abscess is not measured twice; what a later phase acts on is required once its choice is made | `packages/forms/test/real-definitions.test.ts` (6.2 to 6.7); the required fields also in `packages/forms/test/definitions.test.ts` |
| A sensitive exam is absent for a reader without the key and from every recap | conformance cases for `visibleAnswers` and `recapLines` |
| Disposition blocks its pairs | a conformance case; the choice widget test |
| Each widget: three themes, 200%, 320 px, labels, the rules of 8.2 | one test file per kind |
| Every note type renders | `presets_smoke_test.dart` |
| Generated files are current | the Forms drift step in `tools/ci-local.sh` and CI (4.2) |

## 10. Defaults, risks and departures

### 10.1 Defaults chosen

| # | Question | Default built | Who decides |
|---|---|---|---|
| 1 | The 60 or so ambiguities in SPEC (choose-one or choose-many for 79 button rows, what Other does, which fields are required, vitals units and ranges, and the rest) | The default written beside each in the inventories' ambiguity sections. Where a plan departs from it, or the inventories give none, the piece's diff file says so, marked PLAN-OPEN under this row; those to read first have rows of their own (14 to 41) | Brooke and Mercy |
| 2 | Is Harm reduction Medical? (PRD main 447) | Yes | Brooke and Mercy |
| 3 | The body map | Until it is drawn, a list, as built (F5, `region_field.dart`): the region, from the field's options in the shared list's order; then the side, from the list the field names; then Front or back, the surface's own choice, where the field asks for it. Each is a choose-one and its own answer. The regions are not split into a front view and a back view: nothing in a definition says which view a region is on (Arms and Head are on both), only the surface stores front or back, and a split would let a region filed under the back be marked Anterior. The codes are those behind the quick form's region list (SPEC 299), and Feet, Face and Groin (#27). Drawing the map later changes the widget, not what is stored | The team |
| 4 | Where red flags and disposition are asked | Once per Medical encounter, in their own short note (6.2) | Brooke and Mercy |
| 5 | What one-tap Normal does to a field that already has an answer | Leaves it, and fills no normal that would hide an answer already charted (7.1) | Brooke and Mercy |
| 6 | The content of the EMS handoff summary | The fields marked `handoff`: chief concern, vitals, the red-flag answers, EMS time, and each note's recap. The patient's name, age and allergies come from the chart. As built: a line for each answer of the marked fields, note by note, then every note's recap lines, so a handoff field appears twice, once in its note's recap. Nothing a sensitive exam put there is in either part, and no recap line of a treatment record section, for any reader. Nor, for any reader, a diagnosis on phase 3's sensitive list, with its entry or, outside a repeating section, its section, as `visibleAnswers` leaves it out for a reader without `view_sensitive`; the list holds substance use disorders, so no 42 CFR Part 2 record reaches EMS until counsel decides. A quick answer Expand carried into a full note of the visit has no field line of its own: the full note's stands for it (7.1). Still open: whether a sensitive diagnosis should ever reach EMS, for treatment (with counsel), and whether the recaps of the sensitive note types (Behavioral health, Sexual and reproductive health) belong in it at all, which stay for a reader who may see them | Brooke and Mercy; counsel for the sensitive diagnoses |
| 7 | The contents of the full safety assessment and the mental status exam (SPEC 164, 166, which are empty) | One text box each | Brooke and Mercy |
| 8 | Chaperone and consent for Breast and Rectal (SPEC gives them for GU only) | All three sensitive exams get them (PRD main 415) | Brooke and Mercy |
| 9 | The label of the psych note type (three names in the PRD) | "Behavioral health"; key `psychological` | Brooke and Mercy |
| 10 | May the field specification's lines be copied into the repository, piece by piece? | Yes: the spec check needs them (4.1). Without them, every transcription card is read against SPEC by the auditor instead. The example that names a real organization (SPEC 263 to 265) is left out of the copy | The project lead |
| 11 | Which timeline filter each note type belongs to | The mapping in section 5 | Brooke and Mercy |
| 12 | What Expand does with a Quick encounter draft written on an older released version | It reads the draft's own version, writes each answer only where the newest full version takes it (`checkAnswer`), and lists for the person the answers it left out (6.4) | Brooke and Mercy |
| 13 | What the visit read shows of an answer a correction took away | An answer the correction cleared, or hid while changing it, shows no value and its old one struck through (7.1). An entry a correction removed, and an answer it hid without changing, are not marked: the read model sees only the answers that count now | Brooke and Mercy |
| 14 | The unit of temperature (inventory A10 asks for a °C switch) | Degrees F only. A number's second unit is a factor (`altUnit.perUnit`), and °C to °F is not | Brooke and Mercy |
| 15 | When Wound care's infection details open (inventory A31: by themselves for Possible, Yes and Urgent) | A group that stays closed until tapped: the format has no condition for a group's opening. Urgent shows "Go to Red flags and disposition" | Brooke and Mercy |
| 16 | The time of a set of vitals (inventory A13: each set has its own) | The time its entry was added (`entryAt`); no time field | Brooke and Mercy |
| 17 | The Social needs icons (PRD main 419: design-system icons, not emoji) | None in version 1: no set of icon names exists yet. The lock freezes the `needs` list once released, so icons added later make a new list under a new name | The team, before the lists are released |
| 18 | What one-tap Normal records for the shoulder tests | Not performed, the inventory's normal for the region-specific tests: Normal never records a test as negative | Brooke and Mercy |
| 19 | The placeholder ranges and repeat maxima | The vitals take what can be measured: respiratory rate, SpO₂, heart rate and both blood pressure numbers from 0, temperature from 50 °F, so an overdose or hypothermia is charted as measured. Wound length and width 0.1 to 100 cm, depth 0 to 30; typical cycle 1 to 90 days, duration 1 to 30; gravida 1 to 30, para 0 to 30; naloxone 1 to 20 doses; an estimated due date may be past. At most 10 sets of vitals, problems, wounds, tests and MSK regions in one note. Gestational age 0 to 45 weeks (`max` 315 days), so a slip such as 400 weeks for 40 is refused | Brooke and Mercy |
| 20 | How many Skin findings one note holds | 20, the format's most (2.4); Wound care holds 10 wounds | Brooke and Mercy |
| 21 | What Exam performed opens in Breast and Rectal (default 35 answers it for GU only) | Every finding, so consent is required whenever a finding of either exam is charted (6.6) | Brooke and Mercy |
| 22 | Is Social needs' housing status the chart's living situation? (inventory A37) | No: the note keeps the lines' six (Unsheltered, Shelter, Transitional, Permanent, Doubled-up, Unknown) with PRD main 111's changes, Couch surfing for Doubled-up and an Other, apart from the chart's ten; only Unsheltered, Couch surfing, Unknown and Other are shared | Brooke and Mercy |
| 23 | Findings that cannot be held together, beyond the inventory's (default 17) | Excluded pairs: Well appearing against Ill and Toxic appearing, Alert, Drowsy and Somnolent against one another, and Agitated against Calm, in General appearance; Alert, Somnolent and Obtunded in Neurologic mental status; Warm against Cool, Dry against Moist and Diaphoretic, on the skin; Calm against Agitated, Rapid against Slow speech, in Psychiatric observation. Warm stays beside Edema in Peripheral vascular and beside Asymmetric in the foot exam, excluding only Cool. Five normal options are not exclusive, and are held beside the findings they do not rule out (wave D's review): Normal S1/S2 beside a murmur, rub or gallop, and Patent beside swelling or trouble with secretions, with no opposite option; Supple, excluding only Stiff; No mass, excluding Mass and Nodule; Intact skin in the foot exam, excluding Ulcer, Fissure, Blister and Necrosis. PERRLA clears the other pupil findings, as PERRL does | Brooke and Mercy |
| 24 | Does a pregnancy known before the visit open Current pregnancy? (inventory A44) | Yes: a flag beside the pregnancy test, "Known pregnancy, no test today", opens it as a Positive test does, so no one records a test that was not done. The flag is not in the lines. It clears the test, so a note never holds a test today beside it. Pregnancy also stays among Testing history's tests, as the lines write it: a positive one there opens nothing, and may disagree with today's (6.5) | Brooke and Mercy |
| 25 | What one-tap Normal fills in an optional part, and which pulse sites are routine | Nothing in a group or grid marked `collapsed`, even once it is opened. The reflex table is collapsed, and Cardiovascular's and Peripheral vascular's Pulses hold Radial, DP and PT, which Normal fills, with the other sites in a collapsed More pulse sites (6.3). A departure from focused-exam default 28 for the reflexes and those sites | Brooke and Mercy |
| 26 | Rows that are choose-one though their answers may go together (inventory A1) | Contraception method, wound type (and the quick form's twin) and a wound's follow-up stay choose-one: a patient using two methods records one, an abscess with cellulitis is one type, and a follow-up is a time or a place | Brooke and Mercy |
| 27 | The regions of the body region list | The eight of the quick form (SPEC 299): Head, Upper Body, Abdomen, Back, Arms, Legs, Lower Body, Hands; then Feet, Face and Groin, added in wave D's review, since the foot exam hands a foot wound to Wound care and the full module's body map needs them (PRD main 410, 416). The quick form, Wound care, Skin and Neurologic sensation all offer the eleven. The lock freezes the list once released | Brooke and Mercy, before the lists are released |
| 28 | May range of motion be full and painful? | No: Full is exclusive, so it clears Painful, Limited and Unable, and Unable clears the others | Brooke and Mercy |
| 29 | Does one-tap Normal answer the foot exam's Wound present? (default 29 sets it to No) | No: no answer that opens a hand-off is filled by Normal, so it never writes No beside a wound already charted. Wound present? is not asked while Inspection holds Intact skin, so Normal leaves Inspection empty beside a Yes (6.7) | Brooke and Mercy |
| 30 | When a lymph node's size is asked | Once its row has any finding, so the lines' example ("Inguinal: 2 cm, tender, mobile") can be charted | Brooke and Mercy |
| 31 | Where Breast records a clock position and a side | Inside the Mass group, shown while Mass is picked: one mass per exam, and no side for tenderness, a nodule or another finding | Brooke and Mercy |
| 32 | May coordination be Abnormal beside both normal findings? | Yes: Unable clears the others, but a blocked pair cannot refuse three codes held together | Brooke and Mercy |
| 33 | What the phone does with a team's list that names a version this app cannot read (one written for a newer app) | Refuses the list whole: the team keeps the list it had, and the note types it offered, until the app is updated; the versions that did check out are kept. Leaving the entry out would let Start drop a note type without a word. Nothing tells the person yet: what Start says is L5's (3.4) | The team |
| 34 | Where a one-sided neurologic, foot or peripheral vascular finding records its side (focused-exam default 25: one list plus free text) | In a Notes box (up to 2,000 characters) at the end of each of the three sections: which side a cranial nerve finding is on, which foot has a callus or is warmer, which limb has the edema. Their choices have no sides | Brooke and Mercy |
| 35 | Does a wound ticked in the MSK exam's Inspection hand off to Wound care? | No: it is only ticked, and a Wound care note is added for it as for any wound. Inspection has a Normal option, and no answer Normal fills opens a hand-off (#29); PRD main 416 names Skin's open skin and the foot exam's wound (6.7) | Brooke and Mercy |
| 36 | When is a capillary refill time asked? (focused-exam default 42) | Only while Capillary refill is Greater than 2 seconds, after the choice, from 2 to 10 seconds. The choice stays the finding and the number optional, so the two never disagree, and Normal never fills Less than 2 seconds beside a measured 4 | Brooke and Mercy |
| 37 | May a screening be both declined and performed, or declined and ordered? | No: Declined is excluded with Performed and with Ordered, so a declined test deducts no kit (PRD main 431). Education and Referred can stand beside it | Brooke and Mercy |
| 38 | What happens to a blood pressure whose diastolic is above its systolic (the two boxes swapped)? | It is taken: no rule holds two fields together, and the server checks one answer at a time. As built, the renderer (F5) warns of nothing either: a number is checked against its own range alone | Brooke and Mercy |
| 39 | Does Outreach's New need Emergency open anything? | Yes: it shows Go to Red flags and disposition, as Behavioral health's Active and Immediate Yes and Wound care's Urgent do (inventory A31, A41), and suggests no other note type. Outreach is offered in Non-Medical encounters too, where the Red flags note cannot be started: the screen offers an action only where its note type can be started (F5, F7), so there it shows nothing until the visit is made Medical | Brooke and Mercy |
| 40 | Where does the quick encounter's follow-up note go? (PRD main 404) | Into the Red flags note's Follow-up details, a text box shown once a follow-up is picked, beside the when and the date: the visit's follow-up is asked once, and phase 7's follow-up task reads it with the date (6.2, 6.4) | Brooke and Mercy |
| 41 | Which follow-up does phase 7's follow-up task read? | The Red flags note's only. Each wound's follow-up in Wound care, and Sexual and reproductive health's (Results needed, Referral, PCP), are kept beside it and can differ from it (6.2). Narrowing 6.2 to the quick encounter, with phase 7 reading every note's follow-up, is the alternative | Brooke and Mercy, with phase 7's design |
| 42 | How long typing pauses before a typed answer is saved (a text, an Other text, a number, a duration) | One second (`typingPause`). Leaving the box, Done, and the box leaving the screen or turning read-only save at once, so Save & Close while typing loses nothing. Lifecycle 3.2 says a note "saves as the author types", but each save is a change to sync with its own history row, so one per keystroke would be too many (8.1) | The team |
| 43 | How far a note's date picker reaches | A hundred years back and ten ahead, on the side of today the field's `range` allows: a definition bounds only the side (2.2). A stored date beyond them opens the picker on the nearest day it can show (8.2) | The team |
| 44 | Which unit a number with a second unit opens in | The base unit (cm beside inches), each time it is drawn: what is stored, checked and read is in the base unit, and remembering the last unit used would need a setting kept for each person (8.2) | Brooke and Mercy |
| 45 | When a stepper's count is saved | When tapping pauses, as typing does (#42), not at each tap: going from 1 to 4 is one change to sync, not three (8.2) | The team |
| 46 | May a diagnosis that is not on the phone's code list be charted? | No: only a code from the list can be picked, with its title as the label (8.2). Phase 3 lets a problem have no code, and the interpreter takes a label alone, but a label carries no code, so it could never be marked, or kept from a reader, as sensitive: only the code decides (7.1) | Brooke and Mercy |
| 47 | Which section a note form opens at, and how many may be open at once | One at a time; the first section that shows, unless the screen names one (the summary's jump to a section, lifecycle 9.6), so a long exam is not one long page (8.1) | The team |
| 48 | How much of a long recap a closed section's header shows | Three lines, then an ellipsis; a screen reader hears all of it, and the open section shows every answer (8.1) | The team |
| 49 | How a choose-one answer is cleared | By tapping the picked chip again, and a screen reader is told that a tap clears it (8.2). The design gave no way to clear one, and a mis-tap must be undoable; a Clear button beside every choice would double the targets. Phase 3's choose-one chips keep the picked one on | The team |
| 50 | Does a collapsed group or grid open by itself? | Only when it holds an answer, so what was charted is never out of sight, on a read-only form too; otherwise it stays closed until tapped (8.1). Wound care's infection details still stay closed for Possible, Yes and Urgent until something in them is answered (#15), and one-tap Normal still fills nothing in a collapsed part (#25) | Brooke and Mercy |
| 51 | Does a finished note offer its actions, Show handoff on a finished Red flags note for one? | No: an action is drawn only on a form that can be changed, and only where the screen gives it something to do (#39, 8.1). An action stores nothing, and a step that can't be taken is not offered. Whether the visit screen offers a finished note's handoff is the screen's (lifecycle 9.7, 9.8) | Brooke and Mercy |
| 52 | Does a conflict on an answer name the person who made the other change? | No: phase 2's words, "A teammate", "You, from another phone" or "On the server", with the time, the two values side by side (8.1). Lifecycle 9.5 asks for both values and phase 2's choice; the summary's lines name who changed an answer since the person last had the note open (lifecycle 9.6) | The team |
| 53 | Is a section that `needs` a capability drawn for a credential without it? | No, even when it holds a teammate's answers: such a section is "shown to, and changed by" a credential with the capability (2.2, 6.4), and the form draws it only for one (8.1). The read view of a finished note shows it to every reader, as `needs` hides nothing from a reader (lifecycle 6.4) | Brooke and Mercy |
| 54 | How a date is typed | In three private boxes, month, day and year: month first, as the US pilot writes a date and as phase 3's birth date is read (phase 3 design 14.1 #20), and a four-digit year, since a two-digit one could fall either side of today on a field whose range is `any`. The calendar is the second way in: its day cells can't be 48 px on a 320 px phone (8.2, review finding A11Y-3). Day-month order follows phase 3's team setting when there is one | The team |

### 10.2 Questions that need a person and have no default

1. **The MSK test list for each region but the shoulder** (PRD main 414).
2. **The result options for Testing History** (PRD main 103 adds "a date and result per test";
   no list exists). Until the clinical team gives one, the plan offers Positive, Negative,
   Pending and Unknown (inventory A34).
3. **The content of the full safety assessment and the mental status exam.** SPEC has the two
   buttons and no fields (SPEC 164 to 166). Each ships as one text box until the clinical team
   supplies the lists.

### 10.3 Where this design departs from the PRD or the plan, or reads them a particular way

1. **D13 says the presets are bundled "for first-run offline".** A first run is a sign-in, which
   is online. The bundle is used to avoid downloads; a phone never starts a note on a version
   the server has not listed (3.4). This closes a gap that opens in phase 5, when a team's
   version 3 may not be the platform's version 3.
2. **Red flags and disposition are their own note**, where SPEC puts them inside General (6.2).
3. **Outreach is its own note type**, where SPEC makes it a subsection of Social needs (5).
4. **The server does not refuse an answer in a hidden field** (7.1). Visibility is applied on
   reading.
5. **The portal shows a note through a server-built read model**, so "the same form on desktop"
   is a read view in phase 4. Charting on the desktop is not in this phase's scope
   (`IMPLEMENTATION_PLAN.md`, phase 4).
6. **The build plan says the definitions are "generated from the Google Doc Contents tab"**
   (Build plan 81). They are transcribed by hand, one piece per card, and checked against the
   tab's own lines by machine (4.2). The tab is not regular enough to generate from: it never
   says whether a row of buttons is choose-one or choose-many (inventory A1).
7. **One-tap Normal is per section in the definitions**, where PRD main 414 gives each system
   one. The sections follow the transcription pieces, so Cardiovascular has two (heart and
   perfusion), HEENT four, Neurologic two, and MSK one per region examined and one for Gait
   (6.3). For F5: the renderer offers one Normal per system, which runs `normalAnswers` on every
   section of that system (each entry of a repeating one), so the person sees the PRD's one tap.
   As built (unit F5, `note_form.dart`): a system is the sections that offer Normal and show while
   one option of one choice is picked (`showWhen: { field: 'exam.systems', is: 'heent' }`), wherever
   two or more do. In the General note they are HEENT, Cardiac, Neuro and MSK, each named by its
   option's label in the picker. Above the header of the first of a system's sections that is drawn
   sits a band with that name and an "All normal", read as "All normal, HEENT". It runs
   `normalAnswers` on each of the system's sections that is drawn, and on each entry of a repeating
   one (each MSK region), in the definition's order, each seeing what was written before it, and
   says what it did as a section's Normal does (8.1). The band shows only where two or more of the
   system's sections are drawn, and not on a read-only form. Each section keeps its own Normal, and
   each entry its own.

### 10.4 Risks

1. **Two interpreters.** Every rule exists in TypeScript and in Dart. The conformance vectors
   and the golden file are the defence; a function added to one side without a vector is the
   same risk as the fake server's (plan risk 7).
2. **The transcription is about 300 fields and 180 option lists.** The spec check catches a
   missing or extra option. It does not catch a wrong choose-one or a wrong condition; the cards
   carry those decisions from the inventories, and the golden file's "first option of every
   choice" run exercises every condition once.
3. **The defaults are clinical choices made by an engineer.** They are isolated in `.diff.json`
   files so the clinical team can go through them as a list. Until they do, the forms are a
   preview.
4. **One answer per change.** One-tap Normal on a large system writes 10 to 20 changes. That is
   how phase 2 works, and its sync batches them, but a visit with every system charted is a few
   hundred changes. The live job should include one.
5. **A definition is 256 KiB at most** and the General note type with its 21 exam modules is the
   largest: about 52 KiB resolved as typed in wave D. If it passes the limit, split the
   exam into a note type of its own. The number of answers a note can hold is bounded by the
   server's `MAX_NOTE_FIELDS`, and the export prints it for each note type (2.4), so a form that
   comes near it is seen before a visit does. As typed, a General note holds at most 792, with MSK
   at 10 regions and Skin at 20 findings; raising either maximum raises it.

## 11. Units

The cards are in one index for the whole phase, `docs/plan/phase-4-encounters/README.md`, with
their levels, files and order. This part's units, and what each owns:

| Unit | Owns | Depends on |
|---|---|---|
| **F0** The forms package | `packages/forms/` except `definitions/`, `src/interp/`, `scripts/` and the tests of the units that own those (`test/interp/`, `test/conformance.test.ts`, `test/definitions.test.ts`, `test/export.test.ts`, `test/golden.test.ts`): the schema, the types, the path model, the resolver, the validator, the lock, the version rules, the spec check, the shape check, and its own copy of the canonical JSON and hash functions | — |
| **F1** The interpreter in TypeScript | `packages/forms/src/interp/`, `packages/contract/test-vectors/forms-conformance.json` and its TypeScript reader, `packages/forms/test/interp/`; in wave B's review, edits to F0's `src/validate.ts` and its test (2.2) | F0 |
| **E** The export | `packages/forms/scripts/` and its tests, `packages/forms/test/export.test.ts` and `test/golden.test.ts` (which writes the phone's golden sample); the generated files, the Forms drift step in CI, the PHI guard's fixture list | F0, F1 |
| **F2** The interpreter in Dart | `apps/mobile/lib/forms/` (one file per function), the Dart reader of the vectors, the golden test and its sample, `apps/mobile/test/forms/golden_sample.json` | F1 (the vectors), E (the golden file) |
| **F3** Definitions on the server | `db/migrations/0017_note_type_versions.sql`, `packages/forms/src/install.ts`, `services/api/src/forms/`, `services/api/src/routes/forms.ts`, and their tests (`db/test/install-presets.test.ts`, `services/api/test/forms-routes.test.ts`) | F0, E |
| **F4** Definitions on the phone | `apps/mobile/lib/forms/definition_store.dart`, `forms_api.dart`, `forms_providers.dart`; one level X card adds the calls in `lib/auth` and `lib/sync`; in wave D's review, the store's wiring in `apps/mobile/lib/app_providers.dart` and the app harness (3.4) | F2, F3 |
| **F5** The renderer | `apps/mobile/lib/features/forms/`, its tests | F2 |
| **F6** The definitions | `packages/forms/definitions/`, `definitions.lock.json`, `packages/forms/test/definitions.test.ts`; in wave B's review, an edit to F0's `src/shape-check.ts` and its test (4.2); in wave D's review, `packages/forms/test/real-definitions.test.ts` (9) | F0, E |
| **F7** Flows | `apps/mobile/lib/encounters/{red_flags,expand_quick}.dart`, and named edits to F5's and the lifecycle's screens | F5, F6, lifecycle L4 |

`installPresets` lives in the forms package, not in the API, because the seed calls it and the
database package cannot import the API (`db/package.json`; `services/api/package.json:26`). The
forms package needs `canonicalJson` and `sha256Hex` for a definition's hash, and they exist only
in the API's sync folder (`services/api/src/sync/canonical.ts`), so F0 carries its own copy,
pinned by the same vector file, `packages/contract/test-vectors/canonical-json.json`. Since wave
A that file holds an object whose keys lie on both sides of U+FFFF, so a reader that sorts keys
by code point, and not by UTF-16 code unit as the API does, fails: the API, this copy and the
phone are held to one order.

## What this part needs from the lifecycle part

| Needed | Where the lifecycle part gives it |
|---|---|
| A note keeps its key and version, and both are checked when the note is created | lifecycle 4.4, card L1-note-create |
| The server calls `checkAnswer` for every answer, and the fake does the same | lifecycle 4.4, 4.9 rule 14 |
| `MAX_NOTE_FIELDS` raised to 1,000 | lifecycle card L1-note-answers |
| Complete calls `finishCheck` on the phone and on the server | lifecycle 3.3, 4.6 |
| A fifth hard stop: the author of the Red flags note completes it with their Medical notes | lifecycle 3.3 |
| The visit read and the chart's recent visits carry `read` for each note, built by `readModel` | lifecycle 5.1, 5.2 |
| Sensitive content is filtered by `visibleAnswers` everywhere a note is read | lifecycle 6.4 |
| The frame around a note's form calls `note_form.dart` and passes answers to the domain layer | lifecycle 9.5, card L5-note-screen |
| An empty draft counts for nothing, so the Red flags note stays out of the way until answered | lifecycle 3.1 |
| The note type versions the open team's notes on the phone name, passed to the sync controller as `heldNoteTypes`, so a draft's version is fetched back after "Log out anyway" (3.4) | Not yet: the phone domain layer's (L4) to add, with its line in `apps/mobile/lib/app_providers.dart` and the app harness |
| The hash a signer sends covers `effectiveAnswers`, and a finished note keeps only those | lifecycle 4.5 |
| A note records whether it is a Medical note, from its type, when it is created | lifecycle 2.2 |
