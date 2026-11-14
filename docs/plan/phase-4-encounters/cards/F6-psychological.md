# Card F6-psychological: the Behavioral health note type

Level: S. Window: 16,000. Needs: E-presets, F6-lists, F6-spec-pieces, F6-shapes-notes, F6-red-flags.

## Goal

The note type `psychological`, version 1, exists as a definition file made from lines 150 to 171
of the field specification, and the export accepts it.

## Read first

- `docs/plan/patterns/form-definition.md` lines 30-77: the steps, and what to write for each kind.
- `docs/plan/patterns/form-definition-example.md` lines 37-122: one piece worked through.
- `packages/forms/definitions/spec/psychological.txt`, all of it (22 lines) (made by
  F6-spec-pieces): the buttons to copy.

## Files

- `packages/forms/definitions/note-types/psychological/v1.json` (new)
- The generated files the export rewrites. Keep them in the change. Never edit them by hand.

## Steps

1. Create the file with this header:

   ```
   { "key": "psychological", "version": 1, "title": "Behavioral health", "kinds": ["medical"],
     "group": "psych", "sensitivity": "sensitive", "sections": [] }
   ```

2. Sections table. Add these four sections, in this order, each with `"spec": "psychological"`:

   | `id` | `title` |
   |---|---|
   | `reason` | Reason for visit |
   | `safety` | Safety |
   | `mse` | Mental status exam |
   | `plan` | Intervention and outcome |

3. Decisions table. Add these fields, in this order. Type each option from the line of
   `psychological.txt` named, with its label exactly as written and its code by the recipe's rule.

   | Section | `id` | Label | Kind | Options | Also |
   |---|---|---|---|---|---|
   | `reason` | `reasons` | Reason for visit | choice, many | 10 buttons, line 4 | Other is `other` |
   | `reason` | `concern` | Current concern | text | | |
   | `safety` | `suicidal` | Suicidal thoughts | choice, one | 4 buttons, line 10 | "Unable to assess" is `unable` |
   | `safety` | `homicidal` | Homicidal thoughts | choice, one | 3 buttons, line 12 | "Unable to assess" is `unable` |
   | `safety` | `immediate` | Immediate safety concern | choice, one | 2 buttons, line 14 | |
   | `safety` | `red_flags` | | action | | step 4 gives it in full |
   | `safety` | `assessment` | Safety assessment | text | | |
   | `mse` | `notes` | Mental status exam | text | | |
   | `plan` | `intervention` | Intervention | choice, many | 9 buttons, line 20 | |
   | `plan` | `outcome` | Outcome | choice, many | 5 buttons, line 22 | |

4. The field `safety.red_flags` is exactly:

   ```
   { "id": "red_flags", "kind": "action", "label": "Go to Red flags and disposition",
     "action": "open_note_type", "noteType": "red_flags_disposition",
     "showWhen": { "any": [
       { "field": "safety.suicidal", "is": "active" },
       { "field": "safety.homicidal", "is": "active" },
       { "field": "safety.immediate", "is": "yes" } ] } }
   ```

5. Leave out line 6 (Dictation) and the two buttons that start with `+`.

## Tests

None to write. The export checks the file.

## Run

```sh
pnpm forms:export
pnpm -s --filter @sineobex/forms test
npx prettier --write packages/forms/definitions
```

- `pnpm forms:export` ends with a line that ends in `0 problems`.
- The test run prints `Test Files` with a count that says `passed` and no `failed`.

## Audit

- `git diff --stat`: the definition and generated files only. The piece's `.txt`, `.shape.json`
  and `.diff.json` are unchanged.
- The export's `0 problems` means the spec check matched every option to the piece's lines and
  the shape check matched every field to the shape file. Nothing else needs reading.
- `flutter test test/forms/golden_test.dart test/features/forms/presets_smoke_test.dart` passes.
