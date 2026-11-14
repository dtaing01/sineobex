# Recipe: turn a piece of the field specification into a form definition

Written with the phase 4 design (`docs/design/phase-4/forms.md`, sections 2 and 4). The package
it describes, `packages/forms`, is built by cards F0-1 to F0-7. Use this recipe after they land.

## When to use this

A card gives you a piece of the field specification (a block of lines) and asks for the
definition file made from it: a note type, or a module of an exam system. You copy every button,
box and condition into JSON. You decide nothing: the card's **Decisions** table says what each
field is.

## Level

**S** for a plain piece: the export's checks catch a missing option, an extra option and a broken
file. **R** when the card says so (a repeating section, a grid, a sensitive exam): a reviewer
reads the result against the specification.

A small model must not: change `packages/forms/src/**`, `packages/forms/schema/**` or
`definitions.lock.json`; edit a file under `packages/forms/generated/` or
`apps/mobile/assets/forms/` by hand (the export writes them); edit a released version file (a
change is a new `v<N+1>.json`, and the card says when); invent a field, an option or a condition
that is not in the card.

## The example to copy

`docs/plan/patterns/form-definition-example.md` shows one piece from start to finish: the
specification's lines, the Decisions table, the definition and the diff file. Read it once.

## Steps

1. **Open the files the card names.** The piece's lines are already saved as
   `packages/forms/definitions/spec/<piece>.txt`. Do not edit that file.
2. **Create the definition file** at the path the card gives, with the header the card gives
   (`key`, `version`, `title`, `kinds`, `sensitivity` for a note type; `name`, `version` for a
   module).
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
   - The **label** is the button's text exactly, without the brackets and without spaces at the
     ends. `&#91;` is `[`. `\[` and `\]` are brackets. A row can run over two or three lines:
     it is still one field.
   - The **code** is the label in lower case, with every run of characters that are not `a-z` or
     `0-9` turned into one `_`, and no `_` at the start or end. "Already has" is `already_has`.
     "Safer-use supplies" is `safer_use_supplies`. If the Decisions table gives a code, use that
     one (it does when the label starts with a digit or two labels would get one code).
   - Add `"exclusive": true`, `"other": true`, `"normal": true` or `"unable": true` only where
     the Decisions table names that option.
6. **Create the diff file** `packages/forms/definitions/spec/<piece>.diff.json` with exactly the
   content the card gives. It lists what differs from the specification on purpose.
7. **Run the export** (below). Fix what it reports. Its messages name the file, the field and
   the rule.

## Tests to write

None. The export runs the JSON Schema, the validator, the spec check and the field counts, and
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
Commit the definition, the diff file and every generated file the export changed, together.

## Check before you report

1. Does every button in the piece's lines appear as an option, with the same words?
2. Is there no option, field or condition that is in neither the lines nor the card?
3. Is every `id` and every `code` lower case with `_`, and unique among its siblings?
4. Does every `showWhen` name a path that exists (section id, a dot, field id)?
5. Did you leave out the notes to the builder, the example values and anything marked V2?
6. Is the diff file exactly what the card gives?
7. Did the export end with `0 problems`, and did you commit the generated files?
8. Did you change only the files the card lists?

## Mistakes to avoid

- **Fixing the specification.** A typo, an odd capital letter or a strange order in the piece is
  copied as it is. If something looks wrong, finish the card and say so in its Report.
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
