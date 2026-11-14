# Recipe: add made-up demo data to the seed

Line ranges are from commit `ead5a05`.

## When to use this

Use this when a card needs a new made-up patient, problem or duplicate pair in the demo team, so
a demo or an end-to-end test has something to show. The seed is `db/seed/seed.ts` (teams and
staff) and `db/seed/demo-patients.ts` (patients and their records). It runs only in databases
marked as demo environments, and the preview holds made-up patients only.

## Level

**S** for adding an entry to an existing list (`PATIENTS`, `PROBLEMS`, `PAIRS`) with the values
the card gives. The PHI guard and the seed test catch a mistake in form. They cannot tell an
invented name from a real person's, so the card gives every name and every text in full, and the
implementer uses exactly those.

Not for a small model, send back to the planner:

- a new `insert` statement in `seedDemoPatients` or `seed` (a new table, or the history and
  audit tables): the planner writes the SQL;
- a new entry in `DEMO_STAFF`: the seed test counts the users, and sign-in tests depend on them;
- any change to `tools/phi-guard.mjs` or `tools/phi-guard-rules.mjs` (`tools/**` is always
  level X), and any `phi-guard: allow` comment.

## The example to copy

All in `db/seed/demo-patients.ts`.

| Lines | What it does |
|---|---|
| 22-26 | `demoId(kind, n, k)` and `demoPatientId(n)`: seeded IDs are fixed, built from the patient's number `n` |
| 30-52 | `DemoPatient`: the fields an entry may have. Only `n` and `registered` are required |
| 200-207 | The smallest good entry (patient 14): a preferred name, a descriptor that starts with "Demo:", a registration time, and an ID card |
| 216-223 | An entry with an estimated birth year and no legal name (patient 16) |
| 406-413 | The last demo-team entry (patient 40), with a legal name, a full birth date and an alias |
| 414-422 | Patient 41, in the neighbouring team (`team: 'neighbour'`). Keep it last |
| 425-437 | `DemoProblem`: `k` is the problem's number, `patient` is the patient's `n` |
| 644-680 | The loop that inserts each patient: `on conflict (id) do nothing`, and a patient that already exists is skipped with all its records |

`db/seed/seed.ts` lines 84-95: the seed refuses to run unless the database is marked as a demo
environment. Lines 15-61: the demo staff (do not add to them).

## Steps

1. Open `db/seed/demo-patients.ts`. Find the highest `n` in `PATIENTS` (today 41). The card gives
   the new number; it must not be in use.
2. Add the new entry before the comment `// A similar name in the neighbouring team` (line 414),
   shaped like patient 14:

   ```ts
   {
     n: 42,
     preferred: '<name from the card>',
     descriptor: 'Demo: <text from the card>',
     registered: '2026-10-20T17:00:00Z',
   },
   ```

3. Add only the optional fields the card lists (`legal`, `birth`, `living`, `usualArea`,
   `language`, `aliases`, `allergies`, `card`). `usualArea` and every other free text start with
   "Demo:". A birth date is a plain invented date, written `'YYYY-MM-DD'`.
4. If the card adds a problem: add an entry to `PROBLEMS` with the next free `k`, `patient: <n>`,
   and the title, code and statuses the card gives. A coded problem's title is copied exactly
   from `packages/contract/data/icd10cm-curated.csv`.
5. If the card adds a duplicate pair: add an entry to `PAIRS` (it ends at line 617) with the next
   free `k` and the two patient numbers as `a` and `b`, copying the shape of the first entry.
6. Do not add a phone number, an email, an address, or any number that looks like an official
   ID. The header comment (lines 5-18) says nobody in the seed has a phone number.
7. `git add` any new file before running the guard: it scans only files git tracks.

## What the PHI guard looks for

`node tools/phi-guard.mjs` reads every tracked text file. In fixture paths (`db/seed/`, any
`/test/` or `/e2e/` folder, `apps/mobile/test/`, `tools/test/`) it fails the build on a line with:

- a number shaped like a Social Security number (`123-45-…`);
- a phone number, unless it is in the fictional range `555-0100` to `555-0199`;
- an email whose domain is not reserved (`example.com`, `example.org`, `example.net`, `.test`,
  `.invalid`, `localhost`);
- a string shaped like a Medicare Beneficiary Identifier.

The rules are in `tools/phi-guard-rules.mjs` lines 12-41. The guard does not know whether a name
belongs to a real person. That part is the card's and the reviewer's job.

## Tests to write

Usually none. `db/test/migrate.test.ts` already has the test `is idempotent and uses only
obviously made-up staff` (line 76): it runs `seed` twice on a scratch database made by
`createScratchDatabase()`. It fails if your entry breaks an insert or a constraint.

If the card asks for an assertion on the new data, add it where the card says, and name the
record with `demoPatientId(<n>)` (imported from `../seed/demo-patients.ts`, as
`db/test/patients.test.ts` line 9 does). Never type a seeded ID by hand in a `db` test.

## Run

```sh
node tools/phi-guard.mjs
```

Last line: `PHI guard: <number> files clean`. On failure it prints `PHI guard found <n>
problem(s):` and one line per finding, with the file and line.

```sh
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
cd db && pnpm -s vitest run test/migrate.test.ts
```

Passes when the summary says `Test Files  1 passed (1)` and `Tests  8 passed (8)`. The last line
starts with `Duration`.

```sh
pnpm -s lint && pnpm -s format:check && pnpm -s typecheck
```

Passes when it ends with no error line.

The portal end-to-end tests read the seed too. Do not run them for this card; the reviewer runs
the full local CI under the shared lock.

## Check before you report

1. Is every name, descriptor and text exactly what the card gave, with nothing made up by you?
2. Does every descriptor, usual area and other free text start with "Demo:"?
3. Is the new `n` (and each new `k`) unused, and is patient 41 still the last entry?
4. Is there no phone number, email, address or ID-shaped number in what you added?
5. Does `node tools/phi-guard.mjs` end with `files clean`, with no `phi-guard: allow` added?
6. Does the seed test pass (the seed runs twice without an error)?
7. Did you leave `DEMO_STAFF`, the SQL in `seedDemoPatients` and the existing entries unchanged?

## Mistakes to avoid

- **A name close to an existing demo patient's.** Several seeded patients are near-duplicates on
  purpose (header comment, lines 13-17), and search and duplicate tests depend on their scores. A
  new "Jon" or "Smitty" changes what those tests find. Use only the card's name.
- **Putting "(demo)" in a patient's name.** The header comment says why not: a shared token
  would distort every match score. Patients carry "Demo:" in descriptions instead. Staff names
  are the other way round: they end with "(demo)" and the seed test checks it.
- **Changing an existing entry or reusing an ID.** End-to-end tests name seeded patients by ID
  (`apps/portal/e2e/corrections.spec.ts` line 6). Also, an existing patient is skipped on a
  second run (line 679), so an edit to one never reaches a database that is already seeded.
- **Editing patient 1.** Lines 74-98 read it field for field from
  `packages/contract/test-vectors/done-when.json`, so the seed, the phone's test server and the
  tests agree. That file is not yours to change.
- **A realistic identifier "for realism".** The guard fails the build. Silencing it with
  `phi-guard: allow` is not an implementer's choice.
- **An insert without `on conflict … do nothing`.** The seed must change nothing on a second run.
