> **Reviewed (Nov 14).** Four reviewers checked this design and the lifecycle part against the PRD, the code, the rules that never bend and the task-card rules; their 95 findings are applied. Section 10 lists what a person still has to decide. Nothing is built yet.

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
    modules/<name>/v<N>.json           a block of sections included by note types (one per exam system)
    note-types/<key>/v<N>.json         one note type, one version
    spec/<piece>.txt                   the lines of SPEC a definition was transcribed from
    spec/<piece>.diff.json             the differences from SPEC made on purpose, each with its reason
    spec/<piece>.shape.json            the planner's decisions for the piece: its sections and fields (4.2)
  definitions.lock.json                the hashes of every released file, of the piece files a released
                                       definition names, and of each released version's resolved definition
  schema/definition.schema.json        the JSON Schema of the three file kinds
  src/                                 the path model, the resolver, the validator, the lock, the version
                                       rules, the spec and shape checks, and the interpreter (TypeScript)
  scripts/export.ts                    writes everything under generated/ and the phone asset
  generated/presets.json               every note type version with includes and lists resolved, and its hash
  generated/golden.json                what the interpreter says about each preset (7.3)
apps/mobile/assets/forms/presets.json  a copy of generated/presets.json
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
  | { kind: 'duration' }                                    // weeks and days, stored as days
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
  This is accepted as a limit: no piece of SPEC needs more.
- A grid's `pickedIn` is read as a condition is, and must name a choose-many answer
  (`validate.picked_in_unknown_field`, `validate.picked_in_not_choose_many`).
- **A condition never reads what a reader may not see.** A condition, or a grid's picked rows,
  in a section without `sensitiveExam` may not read an answer inside a section that has it, nor
  test an option code marked `sensitiveExam`; the same for `treatmentRecord`
  (`validate.condition_reads_restricted`, reported at the condition). What it shows would tell a
  reader without the key what was found. `needs` is not covered: lifecycle 6.4 hides no `needs`
  section from any reader; `needs` decides who may change an answer (rule 5).
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
| `duration` | a whole number of days | the field's path | weeks and days |
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
(`note_type_versions_preset_names_version`), so `installPresets` (card F3-install) sets it on
every preset row, and a `team` row may leave it null. Beside the `forbid_mutation` trigger the app
role loses `update` and `delete` on the table (`revoke`), as every append-only table has both.
`insert ... on conflict do nothing` works for the app role. The row-level policy also lets a
platform-scope request write and read a row of any team, as the policy of 0004 does.

### 3.2 Installing the presets

`installPresets(tx, teamId)` in `services/api/src/forms/install.ts` inserts every version in
`@sineobex/forms`'s `generated/presets.json` that the team does not have, with
`on conflict do nothing`. If a row exists with a different hash it throws: a released version
was edited, which the lock file should have stopped.

It runs in three places, each inside a transaction that already exists:

1. When a team is created (`services/api/src/routes/owner.ts:136`).
2. In the seed (`db/seed/seed.ts`).
3. At the start of `GET /v1/forms/note-types` (3.3), so a team gets a new platform version the
   first time one of its phones asks, with no deploy step. The write is idempotent. When it
   inserts a row it writes the audit event `forms.presets_installed` (the key and version) in
   the same transaction. Here a row with a different hash is logged and that key is skipped: a
   throw would fail the route for the whole team at every sync.

"A later platform update to a preset never overwrites a team's edited copy" (PRD main 387):
from phase 5 on, `installPresets` skips a key whose newest row has `origin = 'team'`.

### 3.3 Routes

| Route | Key | Answer |
|---|---|---|
| `GET /v1/forms/note-types` | any member of the team | For each key the team offers: its newest version, title, kinds, sensitivity, `quick`, `auto` and hash |
| `GET /v1/forms/note-types/{key}/{version}` | any member of the team | The resolved definition. It never changes, so it is served with a long cache lifetime |

Neither holds patient data. Neither is audited as a patient read; the install of 3.2 is audited
when it writes.

On the server, `definitionFor(tx, teamId, key, version)` reads one row and keeps it in memory.
Rows never change, so the cache never goes stale. The sync rules and the visit read use it.

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
   (`tools/phi-guard-rules.mjs:4-10`), so copied text and made-up people in vectors are scanned.
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

### 4.2 What the export checks (each failure names the file and the rule)

| Check | What it catches |
|---|---|
| The JSON Schema (`src/schema.ts`, `checkFile`) | A misspelt key, a missing label, a wrong type, a pattern or a limit of 2.2 and 2.4 |
| The resolver (`src/resolve.ts`) | A note type file that is not there (`resolve.missing_file`); an include of a module or version that does not exist (`resolve.unknown_module`); a list that does not exist, the `surface` list a region asks for included (`resolve.unknown_list`); a file whose content names another key, name or version than its path (`resolve.misplaced_file`) |
| The semantic validator (`src/validate.ts`) | Two fields with one ID; a reserved ID (`entryAt`, `entryRemoved`); a condition that names no field; a path of five parts, or a path part the server would refuse; an option code used twice; an exclusive option in a choose-one field; a `required` field that can never be visible; a `mapsTo` that names no field. Every rule, with its name, is listed below the table. |
| The lock (`definitions.lock.json`, `src/lock.ts`) | A released version file, module, list or piece file whose content changed (`lock.changed`) or that is gone (`lock.missing`); a released version whose resolved definition's hash changed while its files did not (`lock.changed`, at the version's file); a released file that includes, names or is checked against a part that is not released, or a released version whose resolved hash the lock does not hold (`lock.unreleased_part`) |
| Version rules (2.6, `src/versions.ts`) | A path or code reused for another meaning: a kind or a unit that changed, or a label that changed with no rename declared, against every earlier version |
| The spec check (`src/spec-check.ts`) | For each file whose sections name a piece: a word of the piece that is no option label of those sections, and an option label there that is no word of the piece, unless `<piece>.diff.json` declares it; a declaration that nothing needs |
| The shape check (`src/shape-check.ts`) | A definition whose structure differs from `definitions/spec/<piece>.shape.json`, which the planner writes for each piece: every key of every section and field (path, kind, label, choose-one or choose-many, which options carry which flag, `showWhen`, `required`, `sides`, `noNormal` and the rest), the option codes in order, the order of sections and fields, the file the piece is for and the note type's header (below). So a wrong choose-one, a wrong condition, a missing flag or a crossed code fails the export. |
| Drift | Generated files that differ from what the export writes (`git diff --exit-code`, as the contract does) |

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
  that carry it.
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
  against the lines in the unit's review.

**The lock, as built.** `definitions.lock.json` is a flat object from a path under
`definitions/` to the SHA-256 of the file's content (its canonical JSON; a piece's `.txt` as
text), so a file reformatted or written with its keys in another order is the same file. It
holds every released note type version, module version and list; the three files of every piece
a released definition names; and, at `<the version's file>#resolved`, the hash of each released
version's resolved definition, computed as the server computes it. A change to the resolver that
changes a released definition then fails the export, at the version's file, even though no file
changed. A file is released by adding its line; a file with no line is a draft and may change.

**The validator's rules, as built.** Each is reported as `validate.<rule>`, in the file and at
the place it was written (through the resolver's origins), once:

| Group | Rules |
|---|---|
| IDs and codes | `duplicate_section_id`, `duplicate_field_id`, `reserved_id`, `duplicate_code`, `excludes_unknown_code`, `excludes_same_code`, `excludes_in_choose_one` |
| Paths (2.3) | `path_too_long`, `bad_path_part`, `path_collision` |
| Conditions (2.2) | `condition_unknown_field`, `condition_unknown_code`, `condition_not_a_choice`, `relative_outside_entry`, `path_into_repeat`, `condition_cycle`, `condition_reads_restricted`; picked rows: `picked_in_unknown_field`, `picked_in_not_choose_many` |
| Other note types (6.4, 6.7) | `unknown_note_type` (a `mapsTo`, `suggests` or `open_note_type` that names none), `maps_to_unknown_field`, `maps_to_mismatch`, `maps_to_in_grid`, `maps_to_twice`, `maps_to_from_repeat`, `maps_to_not_quick`, `maps_to_needs` |
| What a key means where it is written | `exclusive_in_choose_one`, `region_option_flag`, `row_option_flag` (an Other or exclusive option among a grid's fixed rows), `sides_not_allowed`, `required_not_allowed`, `grid_in_grid`, `grid_cell_stores_nothing`, `clears_unknown_field` (a flag clears a sibling, never itself), `number_range_empty` (min above max, or no value at the field's decimals between them), `number_normal` |
| Visibility | `required_never_visible`, `visibility_too_complex` |
| Limits (2.4) | `text_too_long`, `repeat_too_many`, `too_large` |

- `required_never_visible` searches every answer a required field's showing depends on: the
  conditions of its section and of the groups and grid around it, picked rows, exclusive options,
  blocked pairs and clearing flags, reading only answers that count (a hidden or cleared answer
  does not, 7.1). A choose-many is tried one asked code at a time, only when a condition needs
  it. A search past 20,000 tries, or a chain of follow-ups more than 200 deep, is refused as
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
  recorded by side (focused-exam defaults 25 and 26), so a grid can be `collapsed` like a group,
  at no cost in path parts; motor strength is a number whose `normal` is 5, what one-tap Normal
  fills (default 28); Skin's side list has Midline (default 24), so a region's `side` names any
  shared list.

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

### 6.5 Sexual and reproductive branching

"The Pregnancy, Contraception and Menstrual sections appear only when that reason is picked.
Current pregnancy details ... appear only once a pregnancy is confirmed. The Pregnancy test
question sits at the top of the Pregnancy section, with Positive or Negative and no Not done
option" (PRD main 417). All of it is `showWhen` and field order. Nothing in the renderer is
special to this note type.

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

### 6.7 Nothing charted twice

"Open skin (ulcer, abscess, laceration, burn) hands off to Wound care, and so does a wound found
in the diabetic foot exam" (PRD main 416). In the Skin and Diabetic foot sections, an `action`
field with `action: 'open_note_type'` and `noteType: 'wound_care'` shows when one of those
findings is picked. It opens
the encounter's Wound care draft, or creates one. The Skin finding itself stores only its type.

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
`packages/forms/src/`, Dart in `apps/mobile/lib/forms/`, one file per function on each side.

| Function | Returns | Used by |
|---|---|---|
| `fieldAt(def, path)` | The field, option or cell a path points at, or null | everything below |
| `checkAnswer(def, path, value)` | null, or one problem: `unknown_path`, `wrong_type`, `unknown_option`, `out_of_range`, `too_long`, `excluded_pair`, `exclusive_with_others` | The server on every answer (lifecycle 4.4); the phone before it saves |
| `effectiveAnswers(def, answers)` | The answers that count: visible fields only, removed entries dropped | every function below, the recap, exports, and the hash a signer sends (lifecycle 4.5) |
| `finishCheck(def, answers)` | A list of `{ section, path, problem }`: a visible required field that is empty | Complete (lifecycle 3.3, 4.6) |
| `normalAnswers(def, sectionId, answers, entryId?)` | The answers one-tap Normal would add: visible fields with no answer, in that section or that entry | 6.3 |
| `recapLines(def, answers)` | One line per section that has an answer | lifecycle 8.1 |
| `readModel(def, answers, corrections)` | Sections, labels and display values, with corrected values marked | The visit read (3.5), the phone's read view |
| `visibleAnswers(def, answers, reader)` | The answers a reader may see, or null when the reader may not see the note at all. `reader` is `{ actsAsAuthor, viewSensitive, viewSensitiveExams, readsMedical, chartsMedical, ordersMedications, sensitiveCodes }`: five facts about the person and the list of sensitive diagnosis codes | lifecycle 6.4 |
| `handoffLines(defs, answersByNote)` | The EMS handoff summary: the fields marked `handoff` | lifecycle 5.7, 9.8 |
| `suggestions(def, answers)` | Note type keys suggested by the options picked | lifecycle 9.6 |
| `expandQuick(quickDef, answers, fullDef, newEntryIds)` | The answers to write into the full note | 6.4 |

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

### 7.2 The vectors (written by the planner, level X)

`packages/contract/test-vectors/forms-conformance.json`: about ten small made-up definitions that
between them use every kind, every option flag, every condition form, a repeating section, sides
and a grid, each with cases for every function in 7.1: the inputs and the exact output. The
TypeScript tests (`packages/forms/test/conformance.test.ts`) and the Dart tests
(`apps/mobile/test/forms/conformance_test.dart`) both read it.

### 7.3 The golden file (generated)

`packages/forms/generated/golden.json` is written by the export. For every real note type
version it holds what the TypeScript interpreter says for three sets of answers made by rule: no
answers; every section opened and one-tap Normal applied; the first option of every choice
picked. For each: `finishCheck`, `recapLines` and the hash of `readModel`.

The Dart test `apps/mobile/test/forms/golden_test.dart` recomputes all of it from the bundled
presets and compares. So the two interpreters are held together on the real forms, not only on
the small ones, and a transcription card that trips a difference fails a test.

## 8. The phone renderer and the portal read view

### 8.1 The pieces (all under `apps/mobile/lib/features/forms/`)

| File | Is |
|---|---|
| `note_form.dart` | The shell: accordion sections, each header with its recap line; the Normal button on a section that offers it; entries of a repeating section with Add and Remove |
| `field_host.dart` | Picks the widget for a field's kind; shows the label, help, the conflict choice of phase 2 when a field has one, and "Waiting to send" |
| one file per kind: `choice_field.dart`, `text_field.dart`, `number_field.dart`, `flag_field.dart`, `date_field.dart`, `time_field.dart`, `duration_field.dart`, `group_field.dart`, `grid_field.dart`, `region_field.dart`, `problem_field.dart`, `photo_field.dart`, `action_field.dart`, `info_field.dart` | One widget each. Props: the field, its value, `onChanged`, `enabled`. No widget knows which note type it is in. |
| `note_read_view.dart` | Draws a `readModel`: sections, labels, values; a corrected value with the old one struck through |

A widget calls `onChanged` with the value to store. `note_form.dart` passes it to the domain
layer, which calls `checkAnswer` and then the store's `setField` (lifecycle 9.5). Nothing in
`features/forms` touches the store.

### 8.2 What every field widget must do

The rules of `docs/plan/patterns/phone-screen.md`, plus:

- A choice shows chips that wrap, each at least 48 px high, each a button with its label and its
  selected state for a screen reader. Choose-many announces "selected" and "not selected".
- An exclusive option clears the others when picked, and is cleared when another is picked.
- A blocked pair: picking the second shows one line under the field ("Sent to ED can't be picked
  with Declined care") and does not select it. The line is a live region that speaks once.
- A number field has a numeric keyboard, shows its unit, and says its range when the value is
  out of it. With `altUnit` it has a two-way switch and stores the base unit.
- A text field that can hold patient details turns suggestions and autocorrect off, as
  `PhiField` does (`apps/mobile/lib/features/patients/patient_widgets.dart:24`).
- A grid reflows to one row per line at 320 px and at 200% text. It never scrolls sideways.
- A disabled field (a finished note, a frozen store) is read-only and says so to a screen reader.

### 8.3 Tests without one test per form

- **One widget test file per kind**: three themes with the guideline matchers, 200% text, 320 px,
  labels and tap actions, the rules of 8.2 for that kind.
- **One generated smoke test** (`apps/mobile/test/features/forms/presets_smoke_test.dart`): for
  every bundled note type, open every section with every field visible, in three themes, at 200%
  text and 320 px, and assert no overflow, no unlabelled control and the guideline matchers. A
  new note type is covered the moment its file exists.
- **The read view**: one test file, on the conformance definitions.

### 8.4 The portal

`apps/portal/src/app/(app)/encounters/[encounterId]/NoteView.tsx` (lifecycle card L6-visit-page) draws the
`read` model. It has no knowledge of kinds beyond what the model says: a label, a display value,
and for a corrected value the old one, who, when and why. Axe runs on it in three themes with
the rest of the visit page.

## 9. Tests, and the rule each one holds

| Rule | Test |
|---|---|
| The format: every file matches the schema and the semantic rules | `packages/forms/test/validate.test.ts` (a bad file for each rule in 4.2) |
| A released version never changes | `packages/forms/test/lock.test.ts` |
| A path or code is never reused for another meaning | `packages/forms/test/versions.test.ts` |
| Every option in SPEC is in a definition, or declared | `packages/forms/test/spec-check.test.ts`, and the export itself in CI |
| Both interpreters agree, on every function | `forms-conformance.json` through both test suites |
| Both interpreters agree on every real note type | `golden.json` and `apps/mobile/test/forms/golden_test.dart` |
| An answer that breaks its definition is refused by the server | `services/api/test/sync-encounters.test.ts` (lifecycle), with the fake's parity case 14 |
| A phone starts a note only on a listed version | `apps/mobile/test/forms/definition_store_test.dart` |
| Installing presets is idempotent, and a changed released version throws | `services/api/test/forms-install.test.ts` |
| The list and definition routes: any member, nobody else | `services/api/test/forms-routes.test.ts`, `permissions.test.ts` |
| Consent is needed to complete a sensitive exam; Normal never fills it | conformance cases; one case on the real GU section in the golden file |
| A sensitive exam is absent for a reader without the key and from every recap | conformance cases for `visibleAnswers` and `recapLines` |
| Disposition blocks its pairs | a conformance case; the choice widget test |
| Each widget: three themes, 200%, 320 px, labels, the rules of 8.2 | one test file per kind |
| Every note type renders | `presets_smoke_test.dart` |
| Generated files are current | the Forms drift step in `tools/ci-local.sh` and CI |

## 10. Defaults, risks and departures

### 10.1 Defaults chosen

| # | Question | Default built | Who decides |
|---|---|---|---|
| 1 | The 60 or so ambiguities in SPEC (choose-one or choose-many for 79 button rows, what Other does, which fields are required, vitals units and ranges, and the rest) | The default written beside each in the inventories' ambiguity sections | Brooke and Mercy |
| 2 | Is Harm reduction Medical? (PRD main 447) | Yes | Brooke and Mercy |
| 3 | The body map | A list of regions by front and back, with side and surface. The codes are those behind the quick form's region list (SPEC 299). | The team |
| 4 | Where red flags and disposition are asked | Once per Medical encounter, in their own short note (6.2) | Brooke and Mercy |
| 5 | What one-tap Normal does to a field that already has an answer | Leaves it | Brooke and Mercy |
| 6 | The content of the EMS handoff summary | The fields marked `handoff`: chief concern, vitals, the red-flag answers, EMS time, and each note's recap. The patient's name, age and allergies come from the chart. | Brooke and Mercy |
| 7 | The contents of the full safety assessment and the mental status exam (SPEC 164, 166, which are empty) | One text box each | Brooke and Mercy |
| 8 | Chaperone and consent for Breast and Rectal (SPEC gives them for GU only) | All three sensitive exams get them (PRD main 415) | Brooke and Mercy |
| 9 | The label of the psych note type (three names in the PRD) | "Behavioral health"; key `psychological` | Brooke and Mercy |
| 10 | May the field specification's lines be copied into the repository, piece by piece? | Yes: the spec check needs them (4.1). Without them, every transcription card is read against SPEC by the auditor instead. The example that names a real organization (SPEC 263 to 265) is left out of the copy | The project lead |
| 11 | Which timeline filter each note type belongs to | The mapping in section 5 | Brooke and Mercy |
| 12 | What Expand does with a Quick encounter draft written on an older released version | It reads the draft's own version, writes each answer only where the newest full version takes it (`checkAnswer`), and lists for the person the answers it left out (6.4) | Brooke and Mercy |

### 10.2 Questions that need a person and have no default

1. **The MSK test list for each region but the shoulder** (PRD main 414).
2. **The result options for Testing History** (PRD main 103 adds "a date and result per test";
   no list exists).
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
5. **A definition is 256 KiB at most** and the General note type with sixteen modules is the
   largest. If it passes the limit, split the exam into a note type of its own. The number of
   answers a note can hold is bounded by the server's `MAX_NOTE_FIELDS`, and the export prints it
   for each note type (2.4), so a form that comes near it is seen before a visit does.

## 11. Units

The cards are in one index for the whole phase, `docs/plan/phase-4-encounters/README.md`, with
their levels, files and order. This part's units, and what each owns:

| Unit | Owns | Depends on |
|---|---|---|
| **F0** The forms package | `packages/forms/` except `definitions/`, `src/interp/`, `scripts/` and `test/export.test.ts`: the schema, the types, the path model, the resolver, the validator, the lock, the version rules, the spec check, the shape check, and its own copy of the canonical JSON and hash functions | — |
| **F1** The interpreter in TypeScript | `packages/forms/src/interp/`, `packages/contract/test-vectors/forms-conformance.json` and its two readers | F0 |
| **E** The export | `packages/forms/scripts/` and its test, `packages/forms/test/export.test.ts`; the generated files, the Forms drift step in CI, the PHI guard's fixture list | F0, F1 |
| **F2** The interpreter in Dart | `apps/mobile/lib/forms/` (one file per function), the golden test | F1 (the vectors), E (the golden file) |
| **F3** Definitions on the server | `db/migrations/0017_note_type_versions.sql`, `packages/forms/src/install.ts`, `services/api/src/forms/`, `services/api/src/routes/forms.ts` | F0, E |
| **F4** Definitions on the phone | `apps/mobile/lib/forms/definition_store.dart`, `forms_api.dart`, `forms_providers.dart`; one level X card adds the calls in `lib/auth` and `lib/sync` | F2, F3 |
| **F5** The renderer | `apps/mobile/lib/features/forms/`, its tests | F2 |
| **F6** The definitions | `packages/forms/definitions/`, `definitions.lock.json` | F0, E |
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
| The hash a signer sends covers `effectiveAnswers`, and a finished note keeps only those | lifecycle 4.5 |
| A note records whether it is a Medical note, from its type, when it is created | lifecycle 2.2 |
