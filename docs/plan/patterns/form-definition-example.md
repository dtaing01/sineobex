# Worked example: one piece of the field specification, from lines to definition

This goes with `form-definition.md`. The piece is the second half of Harm Reduction. A card gives
you parts 1 to 3. You write part 4. Part 5 is written for you, with the piece's shape file.

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
| `provided` | `supplies` | Supplies | choice, many | 6 buttons | Other is `other` |
| `provided` | `education` | Education | choice, many | 5 buttons | Other is `other` |
| `treatment` | `receiving` | Currently receiving treatment? | choice, one | 3 buttons | |
| `treatment` | `discussed` | Treatment discussed? | choice, one | 2 buttons | |
| `treatment` | `interested` | Interested in treatment? | choice, one | 3 buttons | |
| `treatment` | `interested_in` | Which treatment? | choice, many | 4 buttons | Other is `other`; show when `treatment.interested` is `yes` or `maybe` |
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
    { "line": 17, "what": "The row has no label. Label added: Which treatment?", "why": "a field needs a label" },
    { "line": 17, "what": "Shown for Yes and for Maybe.", "why": "inventory A37a" },
    { "line": 19, "what": "Always shown; opens Add referral.", "why": "inventory A38" }
  ]
}
```

`notOptions` lists the bracketed words in the lines that are not options (the stepper's minus and
plus, a button that starts an action). `added` lists option labels that are in the definition and
not in the lines. `line` counts from the first line of the piece's file. The export fails if the
lines and the definition differ in any way these do not explain.
