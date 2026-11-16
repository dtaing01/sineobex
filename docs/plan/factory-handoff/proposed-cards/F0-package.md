# Card F0-package: the forms package

Level: R. Window: 16,000. Needs: none.

## Goal

The workspace has a package `@sineobex/forms` at `packages/forms/`, with the scripts the later
cards call, and the lockfile knows it.

## Read first

- `packages/contract/package.json`, all of it (24 lines): the package to copy the shape of.
- `packages/contract/tsconfig.json`, all of it (5 lines): the settings to copy.
- `docs/design/phase-4/forms.md` lines 73-90: what the package will hold.

## Files

- `packages/forms/package.json` (new)
- `packages/forms/tsconfig.json` (new)
- `packages/forms/src/index.ts` (new)
- The lockfile, which the install below rewrites. Never edit it by hand.

## Steps

1. Write `packages/forms/package.json` with exactly these fields, in this order: `name`
   `@sineobex/forms`; `private` true; `type` `module`; `description` "Encounter form definitions,
   their checks, and the interpreter that reads them (phase 4 design, forms 2)."; `exports`
   `{ ".": "./src/index.ts" }`; `scripts` `export` `tsx scripts/export.ts`, `typecheck`
   `tsc --noEmit`, `test` `vitest run`; `devDependencies` `@types/node` `22.20.5`, `tsx`
   `4.23.15`, `typescript` `5.9.3`, `vitest` `4.1.12`. No other field, no other dependency.
2. Write `packages/forms/tsconfig.json` as `packages/contract/tsconfig.json` is, with the same
   `include`.
3. Write `packages/forms/src/index.ts` with this content:

   ```ts
   /** The forms package (phase 4 design, forms 2). Its modules are added card by card. */
   export {};
   ```

## Tests

None to write. The install, the type check and the lint are the checks.

## Run

```sh
pnpm install --prefer-offline --no-frozen-lockfile
grep -q '^  packages/forms:$' pnpm-lock.yaml
pnpm -s --filter @sineobex/forms typecheck
npx prettier --write packages/forms
pnpm -s lint && pnpm -s format:check && pnpm -s typecheck
```

- The install ends without an error. It may fetch the metadata of the four packages, never a package that is not already in the lockfile.
- The last line prints no error.

## Audit

- `git diff --stat`: the three new files and `pnpm-lock.yaml` only.
- The lockfile diff adds the `packages/forms` importer and nothing else: no new package, no
  version changed.
- `package.json` has the four dev dependencies at the versions the contract package uses.
