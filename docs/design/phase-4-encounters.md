# Phase 4: Encounters

Charting a visit: forms built from data, one encounter with several notes, Save & Close and
Complete, signing, co-signing and attestation, addenda and corrections, referrals, and the
patient's timeline.

**Done when** (`IMPLEMENTATION_PLAN.md`): a resident charts a medical, wound and social visit as
one encounter offline, saves and closes it, completes it later, and an attending attests it.

## Status (Nov 18): in build

| Unit | State | On the branch | Left |
|---|---|---|---|
| F0 The forms package | Done (Nov 16) | The package `@sineobex/forms`: the format (types, JSON Schema, the schema check), its own canonical JSON and hash, the resolver, one copy of the path rules (`src/paths.ts`), the validator, the lock, the version rules, the spec check and the shape check, with 968 tests, run in CI. Reviewed by three reviewers (35 findings, 12 of them major); each fix has a test that fails without it. In wave D the lock came to refuse a version’s resolved line without its file’s line (D81), and a duration to carry a most (D85) | Nothing. The export's test (`test/export.test.ts`) is written with unit E, which owns the script it tests |
| F1 The interpreter in TypeScript | Done (Nov 17) | The eleven functions of forms 7.1 under `packages/forms/src/interp/`, exported from the package and safe for the API's bundle, pinned by `packages/contract/test-vectors/forms-conformance.json` (nine made-up definitions and their cases). Reviewed by two reviewers (14 findings, two of them blockers on what a reader may see); each fix has a test that fails without it. The validator gained the rules the review asked for. In wave D the handoff came to leave out treatment-record sections, sensitive diagnoses and a quick answer Expand carried into a full note (D82), and `checkAnswer` to hold a duration’s most (D85); the vectors hold 595 cases on 14 definitions | Nothing. The phone's copy reads the same vector file (unit F2) |
| E The export | Done (Nov 17) | `packages/forms/scripts/`: the export runs every check over `definitions/` and writes the presets and the phone's copy in canonical key order, writing nothing while any problem stands; its release mode writes the lock and refuses unused files. The golden script and `golden.json`; `lock-grows.ts`, which fails CI when a line the base commit released leaves the lock or changes; the Forms drift step in CI and in `tools/ci-local.sh`; the PHI guard reads the forms package and the shared vectors. Reviewed with F3 by one reviewer (6 findings, one major); each fix has a test that fails without it. D78: the presets carry only released versions; a draft is checked and printed as a note. The golden file has five sets of answers (blank, normal, first, systems, every) and records for each what Complete needs, the recap and handoff lines, the answers that count, the read model, what three readers see, the content hash and Expand. `lock-grows` also compares with the branch’s own earlier state (D83). Reviewed again in wave D (3 findings, two major); each fix has a test that fails without it | Nothing |
| F2 The interpreter in Dart | Done (Nov 17) | The eleven functions under `apps/mobile/lib/forms/`, passing every case of `forms-conformance.json` (595 cases on 14 definitions) and the golden test over `golden.json`, the bundled presets and a sample the TypeScript side writes (`test/forms/golden_sample.json`). Reviewed by one reviewer, who also ran about 900,000 calls on generated definitions against TypeScript with no difference (4 findings, two major: the golden test was missing, and six rules were pinned on the phone only; they are shared vectors now). Since the release the golden test holds it to TypeScript on the nine released note types, every exam module included | Nothing |
| F3 Definitions on the server | Done (Nov 18) | Migration 0017; `installPresets` (`packages/forms/src/install.ts`), run at team creation, in the seed and before the list; `GET /v1/forms/note-types` and `GET /v1/forms/note-types/{key}/{version}` for any member, the second cached as private and immutable; `definitionFor`; the contract regenerated. D79, built with server sync: `definitionFor` checks a row against its hash the first time it reads it, refuses a row filed under a key or version its definition does not hold, and keeps one frozen copy per hash (at most 64) and team, key and version to a hash (at most 4,096) | Nothing |
| F4 Definitions on the phone | Done (Nov 17) | `apps/mobile/lib/forms/definition_store.dart`, `forms_api.dart` and `forms_providers.dart`: each team’s list and definitions kept per person under the databases folder, every definition checked against its hash; fetched for every team at sign-in, bound to that sign-in, and for the open team with the versions its notes name at open and at each sync; deleted at every sign-out and with a wiped team (D84). Wired into `app_providers.dart` and the test harness. Reviewed by one reviewer (8 findings, one major: the wiring made every screen test hang); each fix has a test that fails without it. The release found one more hang, the bundled presets read on a test’s fake clock, fixed with a test | The query of the versions a team’s notes name (`heldNoteTypes`), which L4 supplies |
| F5 The renderer | Not started | — | 22 cards |
| F6 The definitions | Done (Nov 17) | The field specification’s 35 pieces, 17 shared option lists and the plan of every piece under `packages/forms/definitions/spec/`; the nine note types and 21 exam modules typed from their plans and released as version 1: `definitions.lock.json`, the presets, the phone’s asset and `golden.json`. Reviewed before the release by four reviewers (29 findings, one blocker: the EMS handoff carried a substance use treatment record); the plan changes are named in the diff files, and `packages/forms/test/real-definitions.test.ts` holds what Normal fills, what each reader sees and what Complete needs on the real note types | Nothing. A released version never changes: a change is a version 2 |
| F7 Flows | Not started | — | 7 cards |
| L0 Schema and core rules | Done (Nov 17) | Migrations 0018 to 0021 (the note lifecycle, sign-offs, addenda and corrections, attestations and assignments, referrals), the shared vectors (`note-lifecycle.json`, `signed-under.json`), the lifecycle rules in TypeScript and in Dart, and `signedUnder`. Note changes take the team lock. Reviewed by three reviewers (14 findings) and the migration fixes read again by a fourth. The content hash in TypeScript and in Dart, pinned by `note-content-hash.json` (21 cases); its reviewer recomputed every case independently and ran 49,000 random notes through both with no difference (2 findings) | Nothing |
| L1 Server sync | Done (Nov 18) | `services/api/src/sync/`: the encounter’s phase 4 fields, its kind one way only and its envelope kept in history after a finished note; a note’s create checks, every answer checked against its type (1,000 at most), late changes and the reopen table, the sign-off with its content hash, addenda, corrections and referrals as new records; the Medical gate and the team lock on every change; the sync read and the review queue showing each reader only what they may see; the offline audit actions; the contract regenerated. Tests in `sync-encounters`, `sync-signoffs`, `sync-corrections`, `sync-referrals`, `sync-reads` and `sync-concurrency` (.test.ts). Reviewed by four reviewers (39 findings, seven blockers, every one on what a reader could learn: a sign-off’s hash given to readers who may not see every answer, a retried change answered with a hidden value, held values shown in the review queue); each fix has a test that fails without it. Decisions D86 to D91 | Nothing. Its online routes are L2’s |
| L2 Server routes | Not started | — | 14 cards |
| L3 The phone's sync layer | Started (Nov 18) | The registry (`apps/mobile/lib/sync/entities.dart`): the changed encounter and note, and the sign-off, addendum, correction and referral, each checked as the API checks it, pinned by `sync-values.json`. The phone’s test server (`apps/mobile/test/sync/fake_server.dart`) mirrors all seventeen rules of lifecycle 4.9, each held to the API by a case of the same name in `fake_parity_test.dart` or `fake_reads_test.dart`, and lands with server sync | The three store cards (finish, the lock by effect, receipts), in wave E |
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
| D71 | Every note change takes the team lock, and the status trigger also locks the visit's row before it works out the status (lifecycle 2.2, 4.2) | Two writers finishing two notes of one visit at once each read the other's note as it was and left the visit wrong; with the row lock a writer that forgets the team lock waits instead |
| D72 | What a finished note is never changes: its visit, type and version, whether it is Medical, its author and its first signing time; a note once signed never returns to draft. The database refuses each, correction or not (lifecycle 2.2) | A signature must go on covering the same note; without the check, a signed note could be put back to draft and rewritten in two statements |
| D73 | Composite keys tie a note's signature, an attestation and an addendum to their own note, and a note to its own team's visit; whether a named sign-off is a signature stays the routes' rule (lifecycle 2.2 to 2.4) | A key no code path can forget; a key cannot see a sign-off's effect, so the sign-off path and the attest route write each pair from the same loaded rows |
| D74 | A resolved definition is made only by `resolve()` from files that passed the schema check, and checked by `validate()`; it has no schema of its own, and in it a region's side and surface are option lists (forms 2.1) | One way into what the server stores; the interpreters are handed a definition and no lists |
| D75 | The machine checks of transcription hold every key: a shape file gives every key of every section and field, the option codes in order, the file it is for and the note type's header; the lock holds a released definition's piece files and its resolved hash (forms 4.2) | Labels, ranges, codes and headers would otherwise reach a definition unchecked; what the server refuses is a changed resolved hash, so a change to the resolver must fail too |
| D76 | A version declares in its own file every label it rewords, a field's own label as well as an option's; every earlier version is compared, and a unit may not change (forms 2.6) | Reports and supply mappings read paths and codes across versions; a reworded or re-unitted path is another meaning |
| D77 | A condition, or a grid's picked rows, outside a sensitive exam or treatment record section never reads an answer inside one (forms 2.2) | What it shows would tell a reader without the key what was found (D66) |
| D78 | The presets the server installs and the phone bundles carry only released versions; the export checks a draft and prints it as a note, and the golden file covers what the presets carry (forms 2.1, 3.2) | A version a team installs is kept for good; a draft installed and then changed would be refused at every sync and reported as a released version edited |
| D79 | The server checks an installed definition's hash the first time it reads it, keeps one frozen copy per hash and bounds its caches (forms 3.3) | The table checks a hash's form, not what it hashes; every team holds the same presets, so one copy each would grow with the teams |
| D80 | A grid with sides whose cell is, or holds, a region or a problem is refused (forms 4.2) | A region has a side of its own; one path model on both sides, for a shape no plan needs |
| D81 | A version is released whole: the lock refuses a `#resolved` line whose file line it does not hold (`lock.resolved_alone`; forms 4.2) | Released by its resolved line alone, a version’s files could be deleted or its pieces changed with every check green |
| D82 | The EMS handoff leaves out, for every reader, treatment-record sections, each entry that holds a diagnosis on phase 3’s sensitive list, and a quick answer once Expand carried it into a full note (forms 7.1, 10.1 #6) | The handoff goes to EMS, outside the team. Substance use treatment records stay out until counsel decides (PRD main 145), and phase 3’s sensitive list includes substance use disorders. Whether a sensitive diagnosis should ever reach EMS is for the clinical team and counsel |
| D83 | The lock only grows on the branch too: CI compares it with the branch’s earlier state as well as the base, and the preview deploys from `main` only (forms 4.2) | Phase 4 lives on the PR branch, whose base has no lock, so a released version could be edited and released again with every check green |
| D84 | The phone fetches every team’s list at sign-in, bound to that sign-in, and the open team’s list with the versions its notes name at open and at each sync; a list that names a version the app cannot read is refused whole and the earlier one kept (PLAN-OPEN, forms 10.1 #33); the files go at every sign-out and with a wiped team (forms 3.4) | A team first opened offline needs its list; a released version never changes, so the earlier list stays usable until the app is updated |
| D85 | A duration may carry a most, in days; gestational age is bounded at 45 weeks (forms 2.3, 10.1 #19) | A slip such as 400 weeks for 40 was taken, and after the release a bound needs a version 2 |
| D86 | Nothing sent to a phone says more than its reader may see: a retried change is answered with the field as its sender may see it now; a sign-off’s content hash goes only to a reader who sees every answer of any note (whoever acts as the author, the signer, or a reader with every hiding key and a Medical credential), and whether a sign-off’s hash matched only to whoever acts as the author (lifecycle 4.4 to 4.6, 6.4) | A hash over few possible values can be reversed by trying each; a rule that depended on what a note holds would itself tell whether something is hidden |
| D87 | The review queue shows a held change’s value only to a reviewer who may read it, by the sync read’s rules, and only such a reviewer may accept it; a held addendum to a Medical visit is shown as the visit’s notes are (lifecycle 6.4 rule 2) | The queues are among what a reader may not be shown, and accepting a change unseen would approve what the reviewer cannot check |
| D88 | Whether a set from someone who does not act as the author is held depends only on the definition and the sender’s keys: a field that could hold content they may not see is always held, whatever it holds now (lifecycle 4.4) | When it depended on what was stored, the outcome told the sender a hidden code was there |
| D89 | A held sign-off that is rejected, or that no longer matches its note when accepted, tells its sender that the note needs completing again (`change_not_applied`; lifecycle 4.6) | The phone lets go of a change once it is held, and nothing else would tell the worker |
| D90 | An addendum’s or a correction’s sign-off must belong to the same note; a signature is believed from when the server received its note’s create; a patient’s last seen moves to the earlier of the visit’s start and the server’s clock (lifecycle 4.2, 4.3, 4.7) | Each was a way the record could name another note’s signature, a time the server never saw, or a visit that never moved its patient |
| D91 | Records made at a visit stay with the first patient when the visit’s patient changes, and the visit screen lists them so the clinician can enter them in error (PLAN-OPEN, lifecycle 12.1 #25) | Moving clinical records by themselves is riskier than showing them, and refusing the visit’s correction would keep it on the wrong patient |

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

Every default is built, marked `PLAN-OPEN` and listed with who decides: 26 in
`lifecycle.md` 12.1, 41 in `forms.md` 10.1, and eight questions with no default in 12.2 and 10.2.
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
   452). Default: the device's, with the server's kept beside it. When the device's time cannot
   be trusted, the signature is recorded under the credential held when the server receives it,
   with the phone's claim beside it (lifecycle 12.1 #22).

## Risks

1. **Signing offline is the riskiest rule in the product.** The content hash is the whole
   defence. Its two implementations share one vector file, the phone's test server uses the same
   file, and the live job signs against the real API.
2. **Two interpreters and a hand-kept test server.** Every rule exists twice or three times. The
   vectors, the golden file and the parity tests are what hold them together; a rule added
   without one is plan risk 7 again.
3. **The size.** 218 cards' worth of work, a third of it in the sync core. The frontier model
   now writes all of it, so the narrow file list and the machine check a card gave are replaced
   by rule-removal runs and a review of each unit ("How this phase is built").
4. **The defaults are clinical choices made by an engineer.** Until Brooke and Mercy go through
   them, the forms are a preview.
