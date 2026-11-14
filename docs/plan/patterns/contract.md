# Recipe: regenerate the contract

Line ranges are from commit `ead5a05`.

## When to use this

Use this after a card changed an API route, a request or response schema, or a file in
`packages/contract/data/`. The contract is the set of files both apps are built from. A script
writes them from the API's own route definitions. You run the script and commit what it wrote, in
the same commit as the change that caused it.

## Level

**S.** The work is one command and a commit. The drift check and the contract tests catch a
mistake. The route or schema change that comes before it has its own level (see `api-route.md`).

A small model must not:

- edit any generated file by hand (the list is under Steps, step 3);
- edit the generators in `packages/contract/scripts/` (`generate.ts`, `dart.ts`,
  `gen-patient-data.ts`). If a generator fails or writes something wrong, stop and report;
- edit `tools/ci-local.sh` or `.github/workflows/ci.yml`. Both are always level X.

## The example to copy

There is no code to copy. These are the parts that do the work. Read them only if a step fails.

| File and lines | What it does |
|---|---|
| `package.json` line 18 | `contract:generate` runs the `generate` script of `@sineobex/contract` |
| `packages/contract/package.json` line 11 | `generate` runs `scripts/generate.ts`, then `scripts/gen-patient-data.ts` |
| `packages/contract/scripts/generate.ts` lines 33-58 | Builds the API app with no database, reads its routes, sorts every key and writes `packages/contract/openapi.json` |
| `packages/contract/scripts/generate.ts` lines 60-72 | Writes the TypeScript types (`packages/contract/src/generated/api.ts`) and the Dart client (`apps/mobile/lib/api/generated/api.dart`) from that spec |
| `packages/contract/scripts/dart.ts` line 479 | `generateDart(doc)`: the Dart client as one string. It throws on a schema shape it does not support |
| `packages/contract/scripts/gen-patient-data.ts` lines 150 and 225-233 | `buildPatientData()` turns the files in `packages/contract/data/` into seven generated files, and the script writes them |
| `tools/ci-local.sh` lines 23-25 | The drift check: regenerate, then `git diff --exit-code` over the three contract paths |
| `packages/contract/test/patient-data.test.ts` lines 11-18 | The drift check for the seven data files: each committed file must equal what `buildPatientData()` gives |

## Steps

1. Finish the route, schema or data-file change first. Its own tests must pass.
2. From the repository root, run:

   ```sh
   pnpm contract:generate
   ```

3. Run `git status --short`. Only files from this list may show as changed by the command:

   - `packages/contract/openapi.json`
   - `packages/contract/src/generated/api.ts`
   - `apps/mobile/lib/api/generated/api.dart`
   - `services/api/src/patients/generated/nicknames.ts`, `weak-tokens.ts`, `sensitive-codes.ts`
   - `apps/mobile/lib/patients/generated/nicknames.dart`, `weak_tokens.dart`, `sensitive_codes.dart`
   - `apps/mobile/assets/problem_codes.json`

   A route or schema change touches only the first three. A change in `packages/contract/data/`
   touches only the last seven. If nothing changed, the contract was already up to date: that is
   fine, say so in the report.
4. Run `git diff --stat` on the changed generated files. Check the size is what the card expects:
   one new route adds one path to `openapi.json` and one method to `api.dart`. If routes or types
   the card did not mention disappeared or changed, stop and report.
5. If the card adds a route, the card tells you whether to add its path to the list in
   `packages/contract/test/spec.test.ts` (the test `defines every phase 3 route`, line 104). Do it
   only when the card says so.
6. Commit the generated files together with the change that caused them, in one commit.

## Why generated files are never edited by hand

- The next run of `pnpm contract:generate` overwrites a hand edit without warning.
- CI regenerates the files and fails when the result differs from what is committed. A hand edit
  always differs.
- The portal and the phone are compiled against these files. If they say something the API does
  not do, both apps build and then fail when they call the API.

To change a generated file, change its source: the route's schema in `services/api/src/`, or a
data file in `packages/contract/data/`. Then regenerate.

`apps/mobile/lib/api/generated/transport.dart` is the one hand-written file in that folder (a
two-line re-export). The generator does not write it. Leave it alone.

## Tests to write

None for a plain regeneration. The checks already exist:

- `packages/contract/test/spec.test.ts`: shapes in `openapi.json` that clients would read wrong.
- `packages/contract/test/patient-data.test.ts`: the seven data files match their sources.
- `packages/contract/test/dart.test.ts`: the Dart generator itself.

## Run

```sh
pnpm contract:generate
```

Last two lines:
`contract regenerated: openapi.json, src/generated/api.ts, apps/mobile/lib/api/generated/api.dart`
then `patient data regenerated: 7 files`.

```sh
pnpm -s --filter @sineobex/contract test
```

Passes when the summary says `Test Files  3 passed (3)`. The last line starts with `Duration`.

```sh
pnpm contract:generate && git diff --exit-code -- packages/contract/openapi.json packages/contract/src/generated apps/mobile/lib/api/generated
```

Run this one after you commit. It passes when `git diff` prints nothing and the exit code is 0.
This is the drift check that CI runs.

```sh
pnpm -s typecheck
```

Passes when it ends with no error. It fails here when the portal uses a route or a field that the
new contract no longer has.

## Check before you report

1. Did you run `pnpm contract:generate` after the last change to a route, a schema or a data file?
2. Does `git status --short` show no changed generated file outside the list in step 3?
3. Did you leave every generated file exactly as the command wrote it (no hand edit, no formatter)?
4. Are the generated files in the same commit as the change that caused them?
5. Does the drift check command print nothing after the commit?
6. Do the contract tests say `3 passed (3)`?
7. Does the diff of `openapi.json` hold only what the card asked for?

## Mistakes to avoid

- **Running `dart format` over `apps/mobile/lib/api/generated`.** It changes the file, and the
  drift check fails. `apps/mobile/tool/format_check.sh` skips that folder on purpose. Use that
  script, never `dart format .`.
- **Fixing a Prettier complaint in a generated file.** `.prettierignore` already skips
  `packages/contract/openapi.json` and `packages/contract/src/generated`. If Prettier complains
  about one, something else is wrong: stop and report.
- **Forgetting the data files.** The `git diff` drift check covers only the three contract paths.
  The seven data files are held by `patient-data.test.ts`, so run the contract tests too.
- **`Schema.nullable()` on a registered schema.** It comes out in the spec as `allOf` with a
  `null` member, which no value can match. `spec.test.ts` (line 41) fails on it. The fix is
  `z.union([Schema, z.null()])` in the API's schema, not an edit to `openapi.json`.
- **A free-text path or query parameter.** `spec.test.ts` (line 70) allows a path parameter only
  as a UUID, and a query parameter only as a UUID, an enum or a short fixed pattern. Names, birth
  dates and search text travel in POST bodies. It also fails on a chart value in a 409 (line 87).
- **A schema shape the Dart generator does not know.** `generateDart` throws rather than guess
  (`dart.test.ts` line 147). Do not patch `dart.ts`: stop and report the shape and the message.
- **Committing the route without the regenerated files.** CI's `contract` job fails with "The API
  contract changed. Run 'pnpm contract:generate' and commit the result."
