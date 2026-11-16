# Phase 4: Encounters

Charting a visit: forms built from data, one encounter with several notes, Save & Close and
Complete, signing, co-signing and attestation, addenda and corrections, referrals, and the
patient's timeline.

**Done when** (`IMPLEMENTATION_PLAN.md`): a resident charts a medical, wound and social visit as
one encounter offline, saves and closes it, completes it later, and an attending attests it.

## Status (Nov 16): in build

| Unit | State | On the branch | Left |
|---|---|---|---|
| F0 The forms package | Built, in review | The package `@sineobex/forms`: the format (types, JSON Schema, the schema check), its own canonical JSON and hash, the resolver, the validator, the lock, the version rules, the spec check and the shape check, with 819 tests, run in CI | The review's findings. The export's test (`test/export.test.ts`) is written with unit E, which owns the script it tests |
| F1 The interpreter in TypeScript | Not started | — | 15 cards |
| E The export | Not started | — | 3 cards |
| F2 The interpreter in Dart | Not started | — | 15 cards |
| F3 Definitions on the server | Started | — | Migration 0017 is built and in review on a unit branch. 4 cards |
| F4 Definitions on the phone | Not started | — | 4 cards |
| F5 The renderer | Not started | — | 22 cards |
| F6 The definitions | Not started | The recipe and its worked example (`docs/plan/patterns/form-definition.md`); one card written in full | 44 cards |
| F7 Flows | Not started | — | 7 cards |
| L0 Schema and core rules | Built in part, in review | The shared vectors (`note-lifecycle.json`, `signed-under.json`), the lifecycle rules in TypeScript and in Dart, and `signedUnder` | Migrations 0018 to 0021 are built and in review on a unit branch: a migration is pushed only after its review. The content hash (vectors, TypeScript, Dart) waits for F1 and F2 |
| L1 Server sync | Not started | — | 15 cards |
| L2 Server routes | Not started | — | 14 cards |
| L3 The phone's sync layer | Not started | — | 8 cards |
| L4 The phone's domain layer | Not started | — | 12 cards |
| L5 The phone's screens | Not started | — | 21 cards |
| L6 The portal | Not started | — | 9 cards |
| L7 The Done when | Not started | — | 5 cards |

Start with `docs/plan/phase-4-encounters/README.md`: every card, its level, its files, what it
needs first, and the order the units land in. Keep this table current as units land.

## How this phase is built (decided Nov 16)

The project lead decided on Nov 16 that the frontier model builds this phase with helper agents,
because the small local model's setup was not ready. What that changes:

- **The card index stays the work-list.** Each row's files, needs and order hold. No further
  cards are written for this phase. The three written in full are followed where their files are
  built, and marked Done.
- **A unit is built from the design sections its rows point to**, tests first, by one agent in
  its own worktree, a few rows at a time (`CLAUDE.md`, "Running units with helper agents").
- **What a card's checks gave is replaced.** Every rule is removed by a script to see its test
  fail. Each unit gets an independent review, with each confirmed finding shown by a failing
  test before it is fixed. A migration is pushed only after its review; other code may land
  first and take its fixes as later commits. The whole-phase adversarial review at the end is
  unchanged.
- **`tools/card-run.mjs` is not used in this phase**, so it is still unproven against a real
  model. Phase 5's first cards are its first real test. Decisions D68 and D69 stand for phases 5
  on.
- **The index's order holds**: the schema unit (L0) lands alone before server sync (L1). Its
  migrations refuse one thing today's code allows, a note marked signed with no sign-off, which
  only one test's setup did.

## Where the design is

| File | Holds |
|---|---|
| `docs/design/phase-4/forms.md` | The form definition format, how definitions reach the API, the phone and the portal, the interpreter, the renderer, the plan for turning the field specification into definitions |
| `docs/design/phase-4/lifecycle.md` | What the code has today, the data model (four migrations), the states and rules of a note, sync, the online routes, permissions, referrals, screens, audit events, tests |
| `docs/design/phase-4/forms-inventory.md`, `forms-inventory-focused-exam.md` | Every note type, section and field of the field specification with line ranges, and every ambiguity with the default taken |
| `docs/plan/phase-4-encounters/` | The card index and the cards |

The PRD is cited by line of its Markdown export of Nov 14 ("PRD main 452"). It lives outside the
repository; `CLAUDE.md` links it.

## The design in one page

1. **The note is the unit.** Each note has its own author, state, signature and lock. An
   encounter's status is worked out from its notes by the database.
2. **Medical is a property of the note's type.** A clinician and an outreach worker chart one
   visit together: a Medical note needs a clinical credential and takes a signature; a Social
   needs or Outreach note takes neither, in any visit. A visit's kind only decides what is
   offered, and only ever goes from Non-Medical to Medical.
3. **Save & Close needs nothing new on the server.** A draft already syncs field by field. It
   stays on its author's phone until it is finished, so it can be completed with no signal.
4. **Complete is one sign-off record per note, carrying a hash of what the person saw**: the
   answers that count, the patient and the assessment. The server computes the same hash over
   what it holds. If they differ the note stays a draft and the person looks again. The phone
   also stops if a sync changed a note after the screen drew it.
5. **A finished note holds exactly what was signed.** Answers in hidden fields move to history
   when a note is finished. After that only a correction changes it: one to ten answers
   together, one reason, the old values kept. The database refuses any other change.
6. **The server decides what a sign-off did**, under the credential the signer held at the time,
   read from the membership history. The same goes for a correction.
7. **A refusal is kept for what a worker can fix.** Each of the seven refusals has the action
   that settles it. Anything a worker could not fix is accepted with no effect and a notice. A
   rule that throws is stored as a rejection, so no fault here can stop a phone's queue.
8. **What only the author does works offline; what a second person does is online.** Co-signing,
   attesting and assigning act on a whole visit, take the team's write lock first, and compare
   the hash before they write.
9. **Who reads what is decided in one function.** A Medical note needs the right to chart or to
   see billing codes; sensitive note types, substance use treatment sections, sensitive exams
   and sensitive diagnoses each have their rule; whoever acts as a note's author sees all of it.
   What a reader may not see is absent, with its history, never blanked. No new permission key.
10. **A form is data.** One JSON file per version of a note type, never edited once released.
    Fourteen kinds of field. Answers stay a flat map of path to value, as phase 2 stores them.
    Definitions are stored per team and version, and a phone starts a note only on a version the
    server listed.
11. **One interpreter, written twice.** A dozen pure functions read a definition and a note's
    answers, in TypeScript and in Dart, pinned by one vector file and by a golden file over
    every real note type. The portal draws a read model the API builds.
12. **Transcription is checked by a machine.** The specification's own lines sit beside each
    definition. One check compares the words, another the structure the planner wrote down.
13. **Red flags, disposition and follow-up are one short note per Medical visit**, finished
    before any other Medical note of that visit.
14. **A chart carries its timeline and its last three visits**, so a worker reads what happened
    last time with no signal. Older visits are read online.
15. **The 24-hour alert is worked out when it is read.** There is no background job to fail.

## Decisions to copy into the plan's D-table when the phase closes

| # | Decision | Why |
|---|---|---|
| D55 | The note is the unit; the encounter's status is derived by a trigger; an empty draft counts for nothing | Several people chart one visit, each under their own rules; five code paths change a note's status |
| D56 | Medical is a property of the note's type; the gate, the signature and the attestation follow the note; a visit's kind only goes to Medical | One visit holds several care types (PRD main 97); with the rule on the visit, two phones offline could strand a clinician's notes |
| D57 | A sign-off carries a hash of the answers that count, the patient and the assessment; a finished note keeps only those answers | A signature must cover what was read, and offline it is checked days later |
| D58 | The credential of a signature or a correction is the one held at the time, from the membership history, never earlier than the note | "Signed notes keep the credential they were signed under" (PRD main 133) |
| D59 | A refusal only for what the worker can fix, each with the call that settles it; otherwise accepted with no effect and a notice; a throwing rule is a stored rejection | An open rejection blocks the next route confirmation (PRD main 562), and a rejection is never dropped |
| D60 | Co-sign, attest and assign are online, act on a whole visit, and take the team lock first | A second person must never be left with a refused change; a visit has several notes |
| D61 | A finished note changes only through a correction of one to ten answers, guarded in the database; later changes are kept in its history | "Nothing is ever overwritten or deleted" (PRD main 460) |
| D62 | A note type is one file per version, locked by hash once released; definitions are stored per team and version; a phone starts a note only on a listed version | D13; past notes keep the template they were written on (PRD main 387) |
| D63 | One interpreter in TypeScript and Dart, pinned by conformance vectors and a golden file; the portal draws a server-built read model | Two implementations of every rule are the main risk of forms as data |
| D64 | Definitions are transcribed by hand and checked by machine against the specification's lines and a shape file | The specification never says choose-one or choose-many; the checks leave a small model nothing to decide |
| D65 | Red flags, disposition and follow-up are one note per Medical visit, finished first | "Like every Medical form" (PRD main 409), without asking three times in a three-note visit |
| D66 | Who reads what in a note: five kinds of content, one function, existing keys; whoever acts as the author sees all; co-signing and attesting need the whole note | PRD main 121, 145, 204, 415, 435; D37 |
| D67 | The chart carries the timeline and the last three visits | "Recent notes" offline (PRD main 533) before routes exist |
| D68 | The remaining phases are built from task cards with four levels, and CI checks every card's shape | A small model follows a card to the letter and cannot tell a stale path from a correct one |
| D69 | A card is run by a program, not by an agent: the model is sent the card's reading and answers with each part whole (a new file, a whole file or a line range); only the card's files are written and only its commands are run | The coder model cannot call tools; a rule a program keeps needs no audit; whole parts are what a model of this size writes reliably, and diffs are not |
| D70 | Phase 4 is built by the frontier model from the card index, with a review per unit; no further cards are written for it | The local model's setup was not ready (project lead, Nov 16); the index already names every file, its needs and the order |

## What the review found

Four reviewers read both parts, each with one lens, and a fifth fact-checked the recipes.

| Lens | Findings | The most serious |
|---|---|---|
| The rules that never bend | 29 | Two people on one visit, one phone offline: the clinician's notes could be refused for ever, with no fix (the blocker). A signature could land on an answer a sync brought in after the screen was drawn. Hidden answers were inside the signed hash. |
| Truth about the code | 16 | Entry paths the server would refuse; a receipt shape the replay code would not recognise; phase 2's own tests would break; the online routes did not take the team lock |
| Coverage of the PRD | 16 | Substance use treatment records visible to Logistics; a sensitive diagnosis visible in a note though hidden on the problem list; the CHW preset reading clinical notes; no recent notes offline |
| Fit for a small model | 34 | Cards whose mistakes no test would catch; cards too large; a first unit that could not finish; two units owning one file |

All 95 are applied. Two were blockers: the stranded notes, and entry paths the server would
refuse, which would have made the wound in the Done when impossible to save. The first, with
several of the major findings, came from one cause, the rule being on the visit and not on the
note, which is why decision D56 exists.

## What a person has to decide

Every default is built, marked `PLAN-OPEN` and listed with who decides: 21 in
`lifecycle.md` 12.1, 11 in `forms.md` 10.1, and eight questions with no default in 12.2 and 10.2.
The ones that would change the most if answered differently:

1. **Who may co-sign or attest a note that has a GU, breast or rectal exam.** The default follows
   the PRD's words: only someone with the extra permission, which among the standard roles is the
   Program Admin. Attestation of such notes stalls until a team gives its attendings a role with
   it (lifecycle 6.4).
2. **Whether a Social needs or Outreach note inside a Medical visit is signed.** Default: no
   (lifecycle 3.1).
3. **The 60 or so clinical choices the field specification leaves open**: choose-one or
   choose-many for 79 rows of buttons, what is required, units and ranges for vitals (the
   inventories list each with its default).
4. **Whether the field specification's lines may be copied into the repository.** Default: yes,
   piece by piece. The machine check of transcription depends on it (forms 10.1).
5. **Substance use treatment records and 42 CFR Part 2.** Default: readable only with a clinical
   credential (lifecycle 6.4). Counsel decides.
6. **Whether a note signed offline counts from the device's time or the server's** (PRD main
   452). Default: the device's, with the server's kept beside it.

## Risks

1. **Signing offline is the riskiest rule in the product.** The content hash is the whole
   defence. Its two implementations share one vector file, the phone's test server uses the same
   file, and the live job signs against the real API.
2. **Two interpreters and a hand-kept test server.** Every rule exists twice or three times. The
   vectors, the golden file and the parity tests are what hold them together; a rule added
   without one is plan risk 7 again.
3. **The size.** 220 cards' worth of work, a third of it in the sync core. The frontier model
   now writes all of it, so the narrow file list and the machine check a card gave are replaced
   by rule-removal runs and a review of each unit ("How this phase is built").
4. **The defaults are clinical choices made by an engineer.** Until Brooke and Mercy go through
   them, the forms are a preview.
