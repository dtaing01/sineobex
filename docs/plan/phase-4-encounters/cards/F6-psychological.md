# Card F6-psychological: the Behavioral health note type

## Goal

The note type `psychological`, version 1, exists as a definition file made from lines 150 to 171
of the field specification, and the export accepts it.

## Level

S

## Depends on

- F0-export (the export and its checks run).
- F6-lists (the shared lists exist; this card uses none, but the export fails without them).
- F6-spec-pieces (the piece's lines are saved as `packages/forms/definitions/spec/psychological.txt`).
- F6-red-flags (the note type `red_flags_disposition` exists; one field here opens it).

## Read first

- `docs/plan/patterns/form-definition.md`, all of it (124 lines).
- `docs/plan/patterns/form-definition-example.md`, all of it (142 lines).
- `packages/forms/definitions/spec/psychological.txt`, all of it (22 lines) (made by
  F6-spec-pieces).

## Pattern

Recipe: `docs/plan/patterns/form-definition.md`. Example to copy:
`docs/plan/patterns/form-definition-example.md`.

## Files to change

- `packages/forms/definitions/note-types/psychological/v1.json` (new)
- `packages/forms/definitions/spec/psychological.diff.json` (new)
- The generated files the export rewrites. Commit them. Do not edit them by hand.

## Steps

1. Create `packages/forms/definitions/note-types/psychological/v1.json` with this header and an
   empty `sections` array:

   ```json
   {
     "key": "psychological",
     "version": 1,
     "title": "Behavioral health",
     "kinds": ["medical"],
     "sensitivity": "sensitive",
     "sections": []
   }
   ```

2. Add these four sections, in this order, each with `"spec": "psychological"`:

   | Order | `id` | `title` |
   |---|---|---|
   | 1 | `reason` | Reason for visit |
   | 2 | `safety` | Safety |
   | 3 | `mse` | Mental status exam |
   | 4 | `plan` | Intervention and outcome |

3. Add these fields, in this order. Line numbers are lines of `psychological.txt`.

   | Section | `id` | Label | Kind | Options | Also |
   |---|---|---|---|---|---|
   | `reason` | `reasons` | Reason for visit | choice, many | the 10 buttons on line 4 | Other is `other` |
   | `reason` | `concern` | Current concern | text | | |
   | `safety` | `suicidal` | Suicidal thoughts | choice, one | the 4 buttons on line 10 | "Unable to assess" is `unable` |
   | `safety` | `homicidal` | Homicidal thoughts | choice, one | the 3 buttons on line 12 | "Unable to assess" is `unable` |
   | `safety` | `immediate` | Immediate safety concern | choice, one | the 2 buttons on line 14 | |
   | `safety` | `red_flags` | Go to Red flags and disposition | action | | step 4 gives it in full |
   | `safety` | `assessment` | Safety assessment | text | | |
   | `mse` | `notes` | Mental status exam | text | | |
   | `plan` | `intervention` | Intervention | choice, many | the 9 buttons on line 20 | |
   | `plan` | `outcome` | Outcome | choice, many | the 5 buttons on line 22 | |

   Type each option from the line named, with the label exactly as written and the code by the
   recipe's rule (step 5 of the recipe). "Check-in" gets the code `check_in`.

4. The field `safety.red_flags` is this, exactly:

   ```json
   {
     "id": "red_flags",
     "kind": "action",
     "label": "Go to Red flags and disposition",
     "action": "open_note_type",
     "noteType": "red_flags_disposition",
     "showWhen": {
       "any": [
         { "field": "safety.suicidal", "is": "active" },
         { "field": "safety.homicidal", "is": "active" },
         { "field": "safety.immediate", "is": "yes" }
       ]
     }
   }
   ```

5. Create `packages/forms/definitions/spec/psychological.diff.json` with exactly this content:

   ```json
   {
     "piece": "psychological",
     "notOptions": ["+ COMPLETE SAFETY ASSESSMENT", "+ OPEN MSE"],
     "added": [],
     "differences": [
       { "line": 1, "what": "The title shown is Behavioral health.", "why": "forms design 10.1, default 9" },
       { "line": 6, "what": "Dictation is left out.", "why": "V2: PRD main 412" },
       { "line": 8, "what": "SAFETY is the title of the section that holds the next three questions.", "why": "inventory A40" },
       { "line": 14, "what": "A button to the Red flags note shows for Active thoughts or an immediate safety concern.", "why": "inventory A41" },
       { "line": 15, "what": "The full safety assessment has no fields in the specification. One text box.", "why": "inventory A39" },
       { "line": 17, "what": "The mental status exam has no fields in the specification. One text box.", "why": "inventory A39" }
     ]
   }
   ```

6. Run the commands under **Run**. Fix what the export reports and run again.

## Tests

None to write. The export checks the file against the schema, the validator, the lines of the
piece and the field count (10 fields). The phone's smoke test renders the note type.

## Run

```sh
pnpm forms:export
pnpm -s --filter @sineobex/forms test
export PATH=/opt/flutter/bin:/opt/bin:$PATH
(cd apps/mobile && flutter test test/forms/golden_test.dart test/features/forms/presets_smoke_test.dart)
npx prettier --write packages/forms/definitions
```

- `pnpm forms:export` ends with a line that ends in `0 problems`.
- The vitest run prints `Test Files` followed by a count that says `passed` and no `failed`.
- `flutter test` ends with `All tests passed!`.

## Check before you report

1. Are there 10 options under `reason.reasons`, 4 under `safety.suicidal`, 3 under
   `safety.homicidal`, 2 under `safety.immediate`, 9 under `plan.intervention` and 5 under
   `plan.outcome`?
2. Is every label spelt exactly as in `psychological.txt`, capitals included?
3. Do only `reason.reasons` (Other) and the two "Unable to assess" options carry a flag?
4. Is there no field for Dictation?
5. Is `psychological.diff.json` exactly the content in step 5?
6. Did the export end with `0 problems`?
7. Did you commit the generated files the export changed, and edit none of them by hand?
8. Did you change only the files this card lists?

## Never

- Never change a file under `packages/forms/src`, `packages/forms/schema` or
  `packages/forms/definitions/spec/psychological.txt`.
- Never add a field, an option or a condition that is not in this card.
- Never decide that a field is choose-one or choose-many yourself. The table says.
- Never put a patient's name or any real detail in a definition. It holds labels only.

## If stuck

Stop and write in **Report** what happened if: the export reports a problem you cannot fix by
correcting the definition; a line of `psychological.txt` does not match what this card says about
it; a command fails twice with the same message. Do not change the checks to get past them.

## Context

About 9,000 tokens for this card, the recipe, the example and the piece, and about 3,000 for the
answer. A 16,000-token window is enough.

## Report

(The implementer fills this in: the files changed, the last line of each command, anything that
did not match the card.)
