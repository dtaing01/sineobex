# Recipe: add a shared test vector file

Line ranges are from commit `ead5a05`.

## When to use this

Use this when one rule is written twice, once in TypeScript (the API or the portal) and once in
Dart (the phone), and both must give the same answers. The rule gets one definition: a JSON file
in `packages/contract/test-vectors/` with inputs and expected answers. The API's tests and the
phone's tests both read it. A side that drifts fails its own test.

## Level

**X** when the rule lives on an always-X path, as most do: sync values and hashing
(`services/api/src/sync/**`, `apps/mobile/lib/sync/**`), access rules (`services/api/src/auth/**`),
and anything the phone's test server uses. The vector file and its two readers are tests. The
planner or a strong model writes them, first, and a reviewer reads the expected answers against
the phase design.

A small model must not: write or change a vector file or a reader; edit a generator; regenerate a
vector file to make a failing test pass; edit code on an always-X path.

A small model may, under a T card with the vector file and both readers already on the branch:
write or fix the implementation of the rule on one side, when that file is not on an always-X
path (for example a parser in `apps/mobile/lib/patients/`, as `dob.dart` is, or its portal twin
`apps/portal/src/lib/dob.ts`). The job is to make the given reader pass, unchanged.

## The example to copy

A hand-written file: `access.json`, three access rules over permission sets. It is the smallest
file that both the API and the phone read. (`dob.json` is as small, but its TypeScript reader is
the portal's `apps/portal/src/lib/dob.test.ts`, not the API's.)

| File and lines | What it does |
|---|---|
| `packages/contract/test-vectors/access.json` 1-7 | `note` (hand-written, which two files must give every answer) and `rules` in words |
| `access.json` 8-145 | `cases`: a name, the input, and one expected answer per rule |
| `services/api/test/permissions.test.ts` 19-29 | The API reader: an interface for a case, then `JSON.parse(readFileSync(new URL('../../../packages/contract/test-vectors/access.json', import.meta.url), 'utf8'))` |
| `permissions.test.ts` 38-53 | One `it` per case, named after the case, comparing all answers at once |
| `services/api/src/auth/permissions.ts` 56-73 | The TypeScript rules; the comment at line 50 names the vector file |
| `apps/mobile/test/patients/access_test.dart` 9-22 | The phone reader: `File('../../packages/contract/test-vectors/access.json')`, a guard that the list is not empty (line 15), one `expect` per answer with `reason:` naming the case |
| `apps/mobile/lib/patients/access.dart` 14-28 | The Dart rules; the comment at line 6 names the vector file |
| `services/api/test/contract-vectors.test.ts` 23-26 | `vector<T>(name)`: the helper to copy when one API test file reads several vector files |

A generated file: `canonical-json.json`. Use this form when one side is the reference and the
answers are computed (hashes, scores).

| File and lines | What it does |
|---|---|
| `services/api/src/sync/canonical-vectors.ts` 7-62 | `VECTORS_NOTE`, the `inputs`, `buildVectors()`, and `vectorsFile()`: the file's exact text |
| `services/api/scripts/canonical-vectors.ts` 1-10 | The generator: writes `vectorsFile()` to the vector file |
| `services/api/test/canonical.test.ts` 7-14 | The staleness test: the committed file must equal `vectorsFile()` byte for byte |
| `apps/mobile/test/sync/canonical_json_test.dart` 10-21 | The phone reader |

Vector generators are in `services/api/scripts/` (`canonical-vectors.ts`, `gen-match-vectors.ts`).
`packages/contract/scripts/` holds the contract generators only; none of them writes a vector file.

## Steps

1. Decide hand-written or generated. Hand-written when the phase design fixes the answers.
   Generated when one implementation (or Postgres) is the reference.
2. Create `packages/contract/test-vectors/<rule>.json`. Shape:
   ```json
   {
     "note": "Hand-written (phase <n> design <section>). <function> in <ts file> and <dart file> must give every answer.",
     "today": "2026-10-22",
     "cases": [{ "name": "…", "input": "…", "expected": "…" }]
   }
   ```
   Keep `today` only if the rule depends on the date. Include cases the rule refuses, with the
   error code. Use made-up data only (names are invented, descriptions start `Demo:`).
3. Write the API reader in the test file that owns the rule (or a new
   `services/api/test/<rule>.test.ts`): the case interface, the `readFileSync` line, one `it` per
   case named `c.name`.
4. Write the phone reader `apps/mobile/test/<area>/<rule>_test.dart`: read the file with the path
   relative to `apps/mobile`, assert the list is longer than a floor
   (`expect(cases, hasLength(greaterThan(10)))`), loop with `reason:` on every `expect`.
5. Run both readers. Each must fail because the rule is missing or wrong, not because the file
   was not found.
6. Write the rule on each side (or hand each side out as a T card). Put a comment on each
   implementation naming the vector file, as `access.dart` line 6 does.
7. Generated files only: put the inputs and a `…File()` function that returns the exact text in
   `services/api/src/`, a script in `services/api/scripts/` that writes it, and a staleness test
   that compares the committed file to `…File()`. Run the script and commit the file with the
   change that caused it.
8. Hand-written files only: when the rule changes, change the vector file first, in the same
   commit as both implementations.

## Tests to write

- API: `describe`/`it` from `vitest`; `expect(...).toEqual(...)` on all of a case's answers at once.
- Phone: `test` and `expect` from `flutter_test`; `reason:` so a failure names the case.
- A coverage test where the file must cover a list: each entity, each error code (as
  `contract-vectors.test.ts` 51-62 and `apps/mobile/test/patients/dob_test.dart` 38-40 do).
- Generated: the staleness test (step 7).
- Bite check on each side: change one expected answer in the vector file, run both readers, see
  both fail on that case, restore the file. Then break the rule on one side only and see only
  that side's reader fail.

## Run

```sh
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
export PATH=/opt/flutter/bin:/opt/bin:$PATH
(cd services/api && pnpm -s vitest run test/<reader>.test.ts)
(cd apps/mobile && flutter test test/<area>/<rule>_test.dart)
node tools/phi-guard.mjs
# generated files only, then commit what it wrote:
pnpm --filter @sineobex/api exec tsx scripts/canonical-vectors.ts
```

The vitest run prints `Test Files  1 passed (1)`; its last line starts with `Duration`. The
`flutter test` run ends with `All tests passed!`. The PHI guard exits 0. The canonical generator
prints `canonical vectors written`. `gen-match-vectors.ts` needs a superuser Postgres; its header
(lines 6-7) gives its command.

## Check before you report

1. Do both readers read the same file, and does neither hold its own copy of an expected answer?
2. Does each reader fail if the list is empty or the key is misspelled?
3. Does the `note` say hand-written or generated, and name both implementations?
4. Does each implementation's comment name the vector file?
5. Are there cases for what the rule refuses, not only for what it accepts?
6. Generated: is there a staleness test, and is the committed file what the script writes today?
7. Is every name and description made up?
8. Did changing one expected answer make both readers fail?

## Mistakes to avoid

- **Regenerating to get green.** A generated file records what the reference does. If it changed
  and you did not mean it to, the reference has a bug. The phone must then change too.
- **A loop over nothing.** A wrong key gives an empty list and a passing test. The readers guard
  against it (`access_test.dart` line 15, `canonical_json_test.dart` line 15).
- **Formatting the file by hand to match Prettier.** `packages/contract/test-vectors` is in
  `.prettierignore` (line 11); a generated file must stay byte for byte what the script wrote.
- **A stale `note`.** `sync-values.json`'s note names `sync-values.test.ts`; the reader is
  `services/api/test/contract-vectors.test.ts`. Name the real reader.
- **Depending on the Postgres version.** `normalize.json` and `trigram.json` come from Postgres;
  the accent map is pinned (migration 0015) because `unaccent` differs between 16 and 17.
- **A new permission in a vector.** `permissions.test.ts` lines 32-36 pin the 23 existing keys.
