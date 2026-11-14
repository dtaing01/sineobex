# Recipe: add a database migration and its test

Line ranges are from commit `ead5a05`.

## When to use this

A card asks for a change to the database schema: a new column, an index, or a wider check
constraint on a table that already exists. The schema lives in `db/migrations/` as numbered plain
SQL files. `db/src/migrate.ts` (`migrate`, line 58) applies every pending file in one transaction.

## Level

**T** for the small changes below: the card gives the SQL in full and the planner wrote the test
first. A merged migration can never be edited, so a reviewer reads every one before it merges.

**X (the frontier model only)** when the migration does any of these. `docs/plan/README.md` lists them as
always level X:

- adds or changes a policy (`create policy`, `enable row level security`),
- adds or changes a trigger or a function,
- touches the audit tables of `db/migrations/0003_audit.sql` (`audit_events`,
  `audit_chain_heads`, `audit_anchors`) or `sineobex.append_audit`.

A new table always needs row-level security, so **a new table is level X too**.
`db/migrations/0012_id_links.sql` shows what one needs: the table (lines 8-32), indexes (36-40),
triggers (43-46), the policy (49-52) and the `revoke` (54). A small model does not write these.

| A small model may write | A small model must not write |
|---|---|
| `alter table ... add column` with a default | `create table`, `drop table`, `drop column` |
| `create index` on an existing table | `create policy`, `alter policy`, `enable row level security` |
| Drop and re-add a check constraint to allow one more value | `create trigger`, `create function`, `grant`, `revoke` |
| | Anything on the audit tables; any `update` or `delete` of rows unless the card gives it in full |

## The example to copy

Smallest good example: `db/migrations/0014_problem_merge_correction.sql` (9 lines) with
`db/test/problem-merge-correction.test.ts` (55 lines). `0016_merge_review_undo.sql` is a fine
example of adding columns, but most of its test is about filling in old rows, which is planner work.

| Where | What it does |
|---|---|
| `0014_problem_merge_correction.sql` lines 1-2 | Comment: which module, which design section, why |
| line 4 | `set search_path = sineobex, public, extensions;` Every migration has this line |
| lines 6-9 | Drops the check and adds it again with one more allowed value |
| `0016_merge_review_undo.sql` lines 10-12, 17-18 | Adding columns: `not null default`, so existing rows stay valid |
| `0006_quarantine_record_index.sql` line 6 | Adding an index |
| `problem-merge-correction.test.ts` lines 9-29 | Setup: a scratch database, a team, a user, the rows the test needs |
| lines 31-47 | The new thing is accepted, written as the application role (`asApp`) |
| lines 49-54 | What must still be refused is refused |

## Steps

1. Find the highest number in `db/migrations/` (`0016` at this commit). Your file is the next
   number, four digits, then `_short_name.sql`. Two files with one number make `loadMigrations`
   throw `Two migrations share version`.
2. Start the file with a two-line comment (module, design section, why) and then:

   ```sql
   set search_path = sineobex, public, extensions;
   ```

3. Write the change. Always name the schema (`sineobex.<table>`). Use one of these shapes.

   ```sql
   -- A column. Give a default so rows that exist stay valid.
   alter table sineobex.<table>
     add column <name> <type> not null default <value>;

   -- An index. Never "concurrently": the runner applies everything in one transaction.
   create index <table>_<columns> on sineobex.<table> (<columns>);

   -- One more allowed value in a check. Copy the old list exactly and add to it.
   alter table sineobex.<table> drop constraint <table>_<column>_check;
   alter table sineobex.<table> add constraint <table>_<column>_check
     check (<column> in ('old_a', 'old_b', 'new_c'));
   ```

4. Do not write `begin` or `commit`. The runner opens the transaction.
5. Create `db/test/<short-name>.test.ts`. Copy lines 1-29 of
   `problem-merge-correction.test.ts`, rename the `describe`, and keep only the setup rows your
   test needs.
6. Write the tests from the card (see below).
7. Do not open any other file in `db/migrations/`. A fix to an old migration is a new file.

## Tests to write

Helpers, all of which exist:

- `createScratchDatabase()` from `db/src/testing.ts` (line 36): a fresh database with every
  migration applied. It returns `db.owner` (owner connection, for setup and checks), `db.appUrl`
  and `db.drop()`. Call `db.drop()` in `afterAll`.
- `makeTeam(db.owner, name)`, `makeUser(db.owner, email)`, `addMember(db.owner, teamId, userId,
  roleKey)` from `db/test/helpers.ts` (lines 22-47).
- `asApp(db.appUrl, { teamId, userId }, (tx) => ...)` from `db/test/helpers.ts` (lines 4-20): runs
  SQL as the application role, the way the API does, so row-level security applies.

Assert, for each kind of change:

- **Column:** insert a row without the column; select it; the column holds the default.
- **Check constraint:** an insert with the new value succeeds through `asApp`; an insert with a
  value nobody defined fails: `.rejects.toThrow(/check constraint/)` (lines 49-54).
- **Index:** no test of its own. `db/test/migrate.test.ts` proves the file applies.
- If the card says old rows must be filled in, the planner gives that test. Its setup applies
  only the earlier migrations first (`db/test/merge-review-undo.test.ts` lines 67-76).

Use made-up people only: names like `Demo person`, emails at `example.com`.

## Run

```sh
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
cd db && pnpm -s vitest run test/<short-name>.test.ts
pnpm -s vitest run test/migrate.test.ts
(cd .. && node tools/phi-guard.mjs)
```

Each vitest run ends with a summary. It must contain `Test Files  1 passed (1)` and no `failed`
line. The last line printed is `Duration ...`. The PHI guard reads only files git tracks, so
`git add` your new files before running it; its last line is `PHI guard: <n> files clean`.

## Check before you report

1. Is the file number one higher than the highest that was there, with no number used twice?
2. Does the file contain only the statements the card gave, plus the `set search_path` line?
3. Is every other file in `db/migrations/` unchanged (`git status` shows one new file there)?
4. Is the file free of `create policy`, `create trigger`, `create function`, `grant`, `revoke`,
   `concurrently`, `begin` and `commit`?
5. Does every new `not null` column have a default?
6. Does the test check both that the new thing works and that the old refusals still hold?
7. Does the test use only made-up names and `example.com` emails?

## Mistakes to avoid

- **Editing a merged migration.** The runner stores a checksum of each file and stops with `was
  edited after it was applied` (`db/src/migrate.ts` lines 91-96; tested in
  `db/test/migrate.test.ts` lines 29-34).
- **`create index concurrently`.** It cannot run inside a transaction, and all migrations run in
  one (`CLAUDE.md`, Conventions).
- **Relying on one Postgres version.** Local is 16, CI also runs 17. The `unaccent` dictionary
  differs between them, which is why migration 0015 pins `normalize_name` (plan decision D43).
- **Putting a table in `public`.** Everything lives in the `sineobex` schema;
  `db/test/migrate.test.ts` lines 36-41 fail if `public` holds a table.
- **Dropping the old values from a check.** 0014 keeps all six old kinds and adds one. Losing one
  makes existing rows fail.
- **Testing only as the owner.** The owner skips row-level security. Write the new value through
  `asApp`, as the example does.
