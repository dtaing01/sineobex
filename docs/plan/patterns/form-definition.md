# Recipe: turn a piece of the field specification into a form definition

Written with the phase 4 design (`docs/design/phase-4/forms.md`, sections 2 and 4). The package
it describes, `packages/forms`, is built by units F0 and E. Use this recipe after they land.

## When to use this

A card gives you a piece of the field specification (a block of lines) and asks for the
definition file made from it: a note type, or a module of an exam system. You copy every button,
box and condition into JSON. You decide nothing: the card's **Decisions** table says what each
field is.

## Level

**S** for a plain piece: the export's checks catch a missing option, an extra option and a broken
file. **R** when the card says so (a repeating section, a grid, a sensitive exam): the auditor
reads the result against the specification.

A small model must not: change `packages/forms/src/**`, `packages/forms/schema/**` or
`definitions.lock.json`; edit a file under `packages/forms/generated/` or
`apps/mobile/assets/forms/` by hand (the export writes them); edit a released version file (a
change is a new `v<N+1>.json`, and the card says when); invent a field, an option or a condition
that is not in the card.

## The example to copy

`docs/plan/patterns/form-definition-example.md` shows one piece from start to finish: its lines,
the Decisions table, the definition, the diff file and the shape file. Read it once.

## Steps

1. **The piece's lines** are in `packages/forms/definitions/spec/<piece>.txt`, which the card
   names. That file is never edited.
2. **Create the definition file** at the path the card gives, with the header the card gives
   (`key`, `version`, `title`, `kinds`, `group`, `sensitivity` for a note type; `name`, `version`
   for a module).
3. **Add one section for each row of the card's Sections table**, in order, with the `id` and
   `title` given, and `"spec": "<piece>"`.
4. **Add one field for each row of the Decisions table**, in order. Use this table:

   | The Decisions table says | Write |
   |---|---|
   | choice, one | `{ "id": "…", "kind": "choice", "many": false, "label": "…", "options": [ … ] }` |
   | choice, many | the same with `"many": true` |
   | list `<name>` | `"options": { "list": "<name>" }` in place of the array |
   | text | `{ "id": "…", "kind": "text", "label": "…", "lines": "many", "maxLength": 2000 }` |
   | number | `{ "id": "…", "kind": "number", "label": "…", "min": …, "max": …, "decimals": …, "unit": "…" }` |
   | stepper | a number with `"display": "stepper"` |
   | out of N | a number with `"min": 0, "max": N, "decimals": 0, "display": "outOf"` |
   | cm with inches | a number with `"unit": "cm", "altUnit": { "unit": "in", "perUnit": 2.54 }` |
   | flag | `{ "id": "…", "kind": "flag", "label": "…" }`, plus `"clears": [ … ]` if given |
   | date past / future / any | `{ "id": "…", "kind": "date", "label": "…", "range": "past" }` |
   | time | `{ "id": "…", "kind": "time", "label": "…" }` |
   | group | `{ "id": "…", "kind": "group", "label": "…", "layout": "stack", "fields": [ … ] }` |
   | grid | `{ "id": "…", "kind": "grid", "label": "…", "rows": …, "cell": { … } }` as the card writes it |
   | sides | add `"sides": true` |
   | required | add `"required": true` |
   | no Normal | add `"noNormal": true` |
   | show when `<path>` is `<code>` | add `"showWhen": { "field": "<path>", "is": "<code>" }` |
   | action | `{ "id": "…", "kind": "action", "label": "…", "action": "…" }` as the card writes it |

5. **Type the options from the specification's lines.** One object per button, in the order
   written: `{ "code": "…", "label": "…" }`.
   - The **label** is the button's text exactly, capitals included, without the brackets and
     without spaces at the ends. `&#91;` is `[`. `\[` and `\]` are brackets. A row can run over
     two or three lines: it is still one field. Where the lines have no brackets, an option is a
     whole line: a bullet line (`•   Pale` is "Pale") or one line of a numbered list.
   - The **code** is the label in lower case, with every run of characters that are not `a-z` or
     `0-9` turned into one `_`, and no `_` at the start or end. "Already has" is `already_has`.
     "Safer-use supplies" is `safer_use_supplies`. If the Decisions table gives a code, use that
     one (it does when the label starts with a digit or two labels would get one code).
   - Add a flag only where the Decisions table says so: "flag `other` on Other" is
     `"other": true` on that option. A flag never changes the option's code.
6. **Leave the piece's other files alone.** `<piece>.txt`, `<piece>.shape.json` and
   `<piece>.diff.json` are already there. They hold the decisions. Do not edit them.
7. **The export checks the file** when the card's commands are run. Its messages name the file,
   the field and the rule.

## Tests to write

None. The export runs the JSON Schema, the validator, the spec check and the shape check, and
the phone's smoke test renders every note type (`apps/mobile/test/features/forms/
presets_smoke_test.dart`). If the card asks for a case in a test file, it gives the case in full.

## Run

```sh
pnpm forms:export
pnpm -s --filter @sineobex/forms test
export PATH=/opt/flutter/bin:/opt/bin:$PATH
(cd apps/mobile && flutter test test/forms/golden_test.dart test/features/forms/presets_smoke_test.dart)
npx prettier --write packages/forms/definitions
```

The export's last line is `forms: <n> note types, <m> modules, <k> lists, 0 problems`. The
vitest run prints `Test Files  <n> passed (<n>)`. `flutter test` ends with `All tests passed!`.
The definition and every generated file the export changed go in one commit.

## The piece's three files (the planner writes them before the card)

`packages/forms/definitions/spec/<piece>.txt`, `<piece>.diff.json` and `<piece>.shape.json`. A
piece's name is lower-case letters, digits and hyphens. A section names its piece with `"spec"`.
The export checks every file whose sections name a piece against the piece's files, each file on
its own. A later version that differs from the piece on purpose names a new piece, with its own
three files. The worked example shows one of each.

**The lines (`.txt`)** are the export's lines, unchanged, blank lines included, so that a line
number can be found again. A line that must not be copied is replaced by `[left out]`; a line that
holds that marker is skipped.

**What the spec check reads as a word** (`specWords` in `packages/forms/src/spec-check.ts`):

| In the lines | Read as a word |
|---|---|
| `\[ New concern \]` or `&#91; YES \]`, anywhere in a line, with or without `Buttons:` | what is between the brackets |
| A bullet line with no bracket: `•   Well appearing`, `◦   Right` | the line after the bullet |
| A numbered line with no bracket in it, none in the lines that continue it, and nothing nested under it | the line after the number |
| A heading, a numbered line with lines nested under it, `1\. Eyes`, `A. Part`, any other line | nothing |

A word has its escapes undone (`&#91;`, `&#32;`, a backslash before a character, a backslash at
the end of a line, the no-break space), no space at its ends and one space between its parts.
Words are compared exactly, capitals included. The check compares the set of the piece's words
with the set of option labels in the sections that name the piece; an option from a shared list,
a row of a grid, a region and a side from the `side` or `side_rl` list all count as labels. It
does not say which field a word belongs to or how often it appears: the shape file does. A line
with a bracket that has no partner fails.

**The diff file** has exactly four keys:

| Key | Holds |
|---|---|
| `piece` | the piece's name |
| `notOptions` | each word of the lines that is not an option, written as the check reads it: `"+"`, `"CONNECT TO RESOURCE"`, `"Text box"`, `"___ cm"`, `"Text box titled Chief Concern"`, a button's text with the emoji the definition leaves off |
| `added` | each option label that is not a word of the lines: an option decided elsewhere, a label written another way than the lines write it, an "Other" that the lines write as a heading over its text box |
| `differences` | for a person: `{ "line": 5, "what": "…", "why": "…" }` for every decision the lines do not show. `line` is a line of the `.txt`, counted from 1. A note to the builder, an example value and anything left for a later version go here |

An entry of `notOptions` that is no word of the lines, or that is an option after all, fails. So
does an entry of `added` that no option has, or that is in the lines. All four keys are there even
when a list is empty.

**The shape file** has exactly three keys, `piece`, `sections` and `fields`, and is the Sections
and Decisions tables as the export reads them:

- `sections`: one entry for each section that names the piece, in order. An entry is the section
  as the definition writes it, without `fields` and `spec`: its `id` and `title`, and `showWhen`,
  `repeat`, `normal`, `sensitiveExam`, `treatmentRecord` or `needs` where it has one.
- `fields`: one entry for every field at every depth, in the order the definition writes them. An
  entry is the field as the definition writes it, with these changes:
  - `path` in place of `id`: the ids from the section down, joined by dots (`provided.naloxone`).
    A field in a group comes after the group, at `<the group's path>.<its id>`. The cell of a grid
    comes after the grid, at `<the grid's path>.<the cell's id>`. (This names the field in the
    file. It is the path its answer is stored at for a plain field only.)
  - no `fields` and no `cell`: each of those fields has its own entry.
  - `options`, and a grid's `rows`, as a number when the definition writes the options out.
    `{ "list": "<name>" }` and `{ "pickedIn": "<path>" }` stay as they are.
  - `flags`, only when an option carries a key beside `code` and `label`: for each such key, the
    codes that carry it, in the order of the options: `{ "other": ["other"], "exclusive": ["none"] }`.
    For `suggests` and `icon`, what each code carries: `{ "suggests": { "wound": "wound_care" } }`.
    A shared list's flags are in the list's own file and are not repeated here.
- Every other key is written as the definition has it and compared exactly: `kind`, `label`,
  `many`, `showWhen`, `required`, `sides`, `noNormal`, a number's `min`, `max`, `decimals`, `unit`
  and `display`, a text's `lines` and `maxLength`, `action`, `clears`, `excludes`, `mapsTo` and
  the rest. A key that is not in the entry must not be in the definition.

A shape file is written from the inventory, before the definition, by someone else than the one
who types the definition. Worked out from the definition, it would check nothing.

## What the auditor checks

1. Does every button in the piece's lines appear as an option, with the same words?
2. Is there no option, field or condition that is in neither the lines nor the card?
3. Is every `id` and every `code` lower case with `_`, and unique among its siblings?
4. Does every `showWhen` name a path that exists (section id, a dot, field id)?
5. Are the notes to the builder, the example values and anything marked V2 left out?
6. Are the piece's `.txt`, `.shape.json` and `.diff.json` files unchanged?
7. Did the export end with `0 problems`, and are the generated files in the change?
8. Are only the files the card lists changed?

## Mistakes to avoid

- **Fixing the specification.** A typo, an odd capital letter or a strange order in the piece is
  copied as it is. What looks wrong there is for the auditor, not for the implementer to mend.
- **Guessing choose-one or choose-many.** The specification never says. The Decisions table
  does. If a field is missing from the table, stop and report.
- **Joining or splitting fields.** A row of buttons wrapped over three lines is one field. Two
  rows under one heading are two fields.
- **Example values as defaults.** `10:52 AM`, `09 / 12 / 2026`, `28 days` are examples. A
  definition has no default values.
- **A code that changes later.** Once a version is released, its codes are fixed: reports and
  supply mappings read them. Follow the code rule exactly, so the same label always gets the
  same code.
- **An empty or one-line `options` array from a wrapped row.** Count the buttons in the lines and
  the options you wrote. The card gives the count.
- **Editing generated files to make a test pass.** Run the export again instead.
