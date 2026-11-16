# Worked example: one piece of the field specification, from lines to definition

This goes with `form-definition.md`. The piece is the second half of Harm Reduction. A card gives
you parts 1 to 3. You write part 4. Parts 5 and 6 are written for you.

## 1. The piece's lines (`packages/forms/definitions/spec/harm-reduction-2.txt`)

```
   2. Subsection 2
      1. HARM REDUCTION PROVIDED
         1. NALOXONE
            1. Buttons:  \[ Offered \] \[ Accepted \] \[ Declined \] \[ Already has \]
            2. &#91; − \]   x doses   \[ + \]  
         2. SUPPLIES
            1. Buttons:  \[ Fentanyl strips \] \[ Safer-use supplies \] \[ Sharps \]\[ Safer smoking supplies \] \[ Condoms \] \[ Other \]
         3. EDUCATION
            1. Buttons: \[ Overdose response \] \[ Safer use \] \[ Never use alone \]\[ MOUD \] \[ Other \] 
      2. MOUD / SUD TREATMENT
         1. Currently receiving treatment?
            1. Buttons: \[ Yes \] \[ No \] \[ Unknown \]
         2. Treatment Discussed?
            1. Buttons: \[ Yes \] \[ No \]
         3. Interested in treatment?
            1. Buttons: \[ Yes \] \[ Maybe \] \[ No \]
            2. If yes:
               1. &#91; Buprenorphine \]\[ Methadone \]\[ Naltrexone \]\[ Other \]
            3. &#91; CONNECT TO RESOURCE \]
```

## 2. The card's Sections table

| Order | `id` | `title` |
|---|---|---|
| 1 | `provided` | Harm reduction provided |
| 2 | `treatment` | MOUD / SUD treatment |

## 3. The card's Decisions table

Field labels come from this table. The specification writes headings in capitals; the app shows
them in sentence case. Option labels come from the lines, exactly.

| Section | `id` | Label | Kind | Options | Also |
|---|---|---|---|---|---|
| `provided` | `naloxone` | Naloxone | choice, one | 4 buttons | |
| `provided` | `naloxone_doses` | Doses | stepper, 1 to 20, unit `doses` | | show when `provided.naloxone` is `accepted` |
| `provided` | `supplies` | Supplies | choice, many | 6 buttons | flag `other` on Other |
| `provided` | `education` | Education | choice, many | 5 buttons | flag `other` on Other |
| `treatment` | `receiving` | Currently receiving treatment? | choice, one | 3 buttons | |
| `treatment` | `discussed` | Treatment discussed? | choice, one | 2 buttons | |
| `treatment` | `interested` | Interested in treatment? | choice, one | 3 buttons | |
| `treatment` | `interested_in` | Which treatment? | choice, many | 4 buttons | flag `other` on Other; show when `treatment.interested` is `yes` or `maybe` |
| `treatment` | `connect` | Connect to resource | action `add_referral` | | |

## 4. The definition you write (the two sections, inside the note type's `sections` array)

```json
{
  "id": "provided",
  "title": "Harm reduction provided",
  "spec": "harm-reduction-2",
  "fields": [
    {
      "id": "naloxone",
      "kind": "choice",
      "many": false,
      "label": "Naloxone",
      "options": [
        { "code": "offered", "label": "Offered" },
        { "code": "accepted", "label": "Accepted" },
        { "code": "declined", "label": "Declined" },
        { "code": "already_has", "label": "Already has" }
      ]
    },
    {
      "id": "naloxone_doses",
      "kind": "number",
      "label": "Doses",
      "min": 1,
      "max": 20,
      "decimals": 0,
      "unit": "doses",
      "display": "stepper",
      "showWhen": { "field": "provided.naloxone", "is": "accepted" }
    },
    {
      "id": "supplies",
      "kind": "choice",
      "many": true,
      "label": "Supplies",
      "options": [
        { "code": "fentanyl_strips", "label": "Fentanyl strips" },
        { "code": "safer_use_supplies", "label": "Safer-use supplies" },
        { "code": "sharps", "label": "Sharps" },
        { "code": "safer_smoking_supplies", "label": "Safer smoking supplies" },
        { "code": "condoms", "label": "Condoms" },
        { "code": "other", "label": "Other", "other": true }
      ]
    }
  ]
}
```

`education` follows the same shape as `supplies`. In the second section, the two fields that are
not plain:

```json
{
  "id": "interested_in",
  "kind": "choice",
  "many": true,
  "label": "Which treatment?",
  "showWhen": { "field": "treatment.interested", "is": ["yes", "maybe"] },
  "options": [
    { "code": "buprenorphine", "label": "Buprenorphine" },
    { "code": "methadone", "label": "Methadone" },
    { "code": "naltrexone", "label": "Naltrexone" },
    { "code": "other", "label": "Other", "other": true }
  ]
},
{ "id": "connect", "kind": "action", "label": "Connect to resource", "action": "add_referral" }
```

## 5. The diff file (`packages/forms/definitions/spec/harm-reduction-2.diff.json`), already written

```json
{
  "piece": "harm-reduction-2",
  "notOptions": ["−", "+", "CONNECT TO RESOURCE"],
  "added": [],
  "differences": [
    { "line": 5, "what": "The dose stepper shows only when Naloxone is Accepted, and starts at 1.", "why": "inventory A36" },
    { "line": 18, "what": "The row has no label. Label added: Which treatment?", "why": "a field needs a label" },
    { "line": 17, "what": "Shown for Yes and for Maybe.", "why": "inventory A37a" },
    { "line": 19, "what": "Always shown; opens Add referral.", "why": "inventory A38" }
  ]
}
```

`notOptions` lists the words of the lines that are not options. The spec check reads three things
as words: every bracketed word (so also the stepper's minus and plus, a button that starts an
action, `[ Text box ]`, an example value such as `[ 10:52 AM ]`), every bullet line, and every
numbered line that has no bracket and nothing nested under it (so also `Text box titled X` and a
note to the builder). `added` lists option labels that are in the definition and not in the lines.
Both are written as the check reads a word: without the brackets, `&#91;` and the backslashes, with
one space between words and none at the ends.

`differences` is for a person: what else was decided, and where the decision comes from. `line`
counts from the first line of the piece's file, which is line 1.

The export fails if a word of the lines is neither an option nor in `notOptions`, if an option is
neither in the lines nor in `added`, and if either list holds a word that nothing needs.

## 6. The shape file (`packages/forms/definitions/spec/harm-reduction-2.shape.json`), already written

```json
{
  "piece": "harm-reduction-2",
  "file": "note-types/harm_reduction_example/v1.json",
  "header": {"key": "harm_reduction_example", "version": 1, "title": "Harm reduction (worked example)", "kinds": ["medical"], "group": "harm_reduction", "sensitivity": "sensitive"},
  "sections": [
    {"id": "provided", "title": "Harm reduction provided"},
    {"id": "treatment", "title": "MOUD / SUD treatment"}
  ],
  "fields": [
    {"path": "provided.naloxone", "kind": "choice", "many": false, "label": "Naloxone", "options": ["offered", "accepted", "declined", "already_has"]},
    {"path": "provided.naloxone_doses", "kind": "number", "label": "Doses", "min": 1, "max": 20, "decimals": 0, "unit": "doses", "display": "stepper", "showWhen": {"field": "provided.naloxone", "is": "accepted"}},
    {"path": "provided.supplies", "kind": "choice", "many": true, "label": "Supplies", "options": ["fentanyl_strips", "safer_use_supplies", "sharps", "safer_smoking_supplies", "condoms", "other"], "flags": {"other": ["other"]}},
    {"path": "provided.education", "kind": "choice", "many": true, "label": "Education", "options": ["overdose_response", "safer_use", "never_use_alone", "moud", "other"], "flags": {"other": ["other"]}},
    {"path": "treatment.receiving", "kind": "choice", "many": false, "label": "Currently receiving treatment?", "options": ["yes", "no", "unknown"]},
    {"path": "treatment.discussed", "kind": "choice", "many": false, "label": "Treatment discussed?", "options": ["yes", "no"]},
    {"path": "treatment.interested", "kind": "choice", "many": false, "label": "Interested in treatment?", "options": ["yes", "maybe", "no"]},
    {"path": "treatment.interested_in", "kind": "choice", "many": true, "label": "Which treatment?", "showWhen": {"field": "treatment.interested", "is": ["yes", "maybe"]}, "options": ["buprenorphine", "methadone", "naltrexone", "other"], "flags": {"other": ["other"]}},
    {"path": "treatment.connect", "kind": "action", "label": "Connect to resource", "action": "add_referral"}
  ]
}
```

The shape file is parts 2 and 3 as the export reads them: the definition's sections without the
words of their options. A section's entry is the section as the definition writes it, without
`fields` and `spec`. A field's entry is the field as the definition writes it, with `path` in
place of `id` (the ids from the section down, joined by dots) and an option list as its codes in
order. A code there is the rule's code for the option's label (recipe, step 5); where the planner
gives another, the entry is `{ "code": …, "label": … }`. `flags` names, for each key an option
carries beside its code and label, the codes that carry it. `file` names the definition file the
piece is typed into, and `header` is the note type's own keys (every key but `sections` and
`renames`): exactly one shape file for a note type carries it.
A field in a group has an entry of its own, after the group's, at `<group's path>.<its id>`; the
cell of a grid at `<grid's path>.<the cell's id>`.

The export fails if a section or a field is missing, is one too many or is out of order, and if
any key of one is not what the shape file says, the codes of the options and their order
included. The message names the field and the key. Once the file the shape file names exists, it
also fails if no section of it names the piece, if a section of it names no piece and no shape
file for it lists that section's id under `outside`, and if a key of the note type's header is not
what `header` says.
