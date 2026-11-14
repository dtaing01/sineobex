# Recipe: add a synced record type

Line ranges are from commit `ead5a05`.

## When to use this

Use this when a phase adds a new kind of record that a phone creates offline and the server stores
by hash-confirmed receipt (as a consent decision is today). The server, the phone and the phone's
test server change in one piece of work.

## Level

**X.** Almost every file is on an always-X path: `services/api/src/sync/**`,
`apps/mobile/lib/sync/**`, `apps/mobile/test/sync/fake_server.dart`, and a migration with row-level
security. The frontier model does it; a second review follows.
A small model must not: edit any file under those paths; write or change a case in
`sync-values.json`; choose a permission key, a parent, a field class or the clock pause.
A small model may, each under its own card, after the X work is merged:

- add the heading to `entityLabel` (`apps/mobile/lib/features/sync/sync_labels.dart` 45-56). Level R.
- add the phone domain method that calls `store.createRecord`, as `recordConsent` does
  (`apps/mobile/lib/patients/patient_repository.dart` 945-953). Level T, tests first (`phone-domain.md`).
- run the contract generator and commit its output. Level S (`contract.md`).

## The example to copy

The smallest entity is a consent decision: append-only, one parent, no settable field.

| File and lines | What it does |
|---|---|
| `db/migrations/0009_patients.sql` 220-244 | The table, with `device_id`, `change_id`, `clock_verified`, and its append-only trigger |
| `db/migrations/0009_patients.sql` 430-476 | `patient_of_change`: the patient a held change is about, per entity (used by `services/api/src/sync/review.ts` line 65) |
| `services/api/src/sync/schemas.ts` 37-50 | `PATIENT_ENTITIES`, and the `ChangeEntity` and `RecordEntity` enums built from it (OpenAPI components) |
| `services/api/src/sync/entities/values.ts` 172-197 | `ConsentCreate`: the strict Zod schema of the create's value. Validates, never transforms (lines 12-16) |
| `values.ts` 297-305, 308-326 | `CREATE_SCHEMAS` and `FIELD_SCHEMAS`: one row per entity |
| `values.ts` 388-435 | `valueParents`: the records a change names, in order |
| `services/api/src/sync/entities/consent.ts` 1-92 | `consentRules`: permission, team lock, `applyCreate` through `storeCreate` (insert with `on conflict (id) do nothing`, audit action, audit details), `load`, `write` |
| `services/api/src/sync/records.ts` 380-415, 445-493 | `storeCreate` and the `EntityRules` interface the module fills |
| `services/api/src/sync/entities/index.ts` 6, 20-30 | The import and the `RULES` row |
| `services/api/src/routes/sync.ts` 73-85 | `requireRead`: the permission a sync read of each entity needs |
| `packages/contract/test-vectors/sync-values.json` 372-407, 1211-1244 | Two valid consent cases with `parents`, two invalid ones with `expect.paths` |
| `apps/mobile/lib/sync/entities.dart` 21, 283-296, 553-562, 653-663 | The name, the schema mirror, `patientOfCreate`, and the registry entry |
| `apps/mobile/lib/sync/local_store.dart` 13-25, 513-522 | The re-export list, and `_patientOfChange` (a record whose patient comes through a parent) |
| `apps/mobile/test/sync/fake_server.dart` 672-778 | `_create`: values checked with the phone registry, then three `switch (rules.entity)` blocks (own checks 688-709, patient 721-725, after the insert 734-776) |
| `fake_server.dart` 2059-2074 | `_fetch`: the read permission per entity, mirroring `requireRead` |

## Steps

Settle in the phase design first: the permission key (an existing one), parents, settable fields
and their class, the clock pause (D35), the outbox category, the read permission, the audit action
names, and what the offline index may hold (D40). Then change the files in this order. Each step
names what fails if it is forgotten.

1. **Migration** (see `migration.md`): the table with `team_id`, `device_id`, `change_id`,
   `clock_verified`, row-level security, and a new version of `patient_of_change` with a branch for
   the entity. Fails: the entity's insert in `sync-patients.test.ts`. No test was found that
   catches a missing `patient_of_change` branch: the reviewer checks it.
2. **`schemas.ts`**: add the name to `PATIENT_ENTITIES`. From here `pnpm -s typecheck` fails until
   steps 3 and 5 are done (`CREATE_SCHEMAS`, `FIELD_SCHEMAS` and `RULES` are exhaustive records).
3. **`values.ts`**: add `<Name>Create` (`.strict()`, `Trimmed` for text, no `.trim()` or other
   transform), its rows in `CREATE_SCHEMAS` and `FIELD_SCHEMAS`, and a `case` in `valueParents`.
   The `switch` is not checked for completeness: a missing case fails "accepts ..., unchanged, with
   its parents" in `contract-vectors.test.ts` once step 6 is done.
4. **`entities/<name>.ts`**: copy `consent.ts`. Shape:
   ```ts
   export const <name>Rules: EntityRules<Value> = {
     entity: '<name>', auditPrefix: '<prefix>',
     permission: () => '<existing key>', takesTeamLock: () => true,
     create: <Name>Create,
     parents: (v) => valueParents('<name>', 'create', undefined, v),
     parentsOfSet: () => [],
     applyCreate: (ctx, v) => storeCreate(ctx, '<name>', { insert, patientId, action, auditDetails }),
     fieldClass: () => null, fieldSchema: () => null, load, write,
   };
   ```
   `insert` returns `null` when the ID is taken. Audit details hold kinds and IDs, never typed text.
5. **`services/api/src/sync/entities/index.ts`**: import the rules and add the `RULES` row.
6. **`sync-values.json`**: at least one valid case (with `parents`, in `valueParents` order) and one
   invalid case (with `expect.paths` or `expect.problem`). Fails: "covers every patient-side
   entity" in `contract-vectors.test.ts` (lines 51-55).
7. **`services/api/src/routes/sync.ts` `requireRead`**, and `mayRead` in `review.ts` (line 292, inside
   `fetchRecords`) if some roles must not see the record. The default is `patients.view`.
8. **`sync-patients.test.ts`**: add the table to the `table` map (lines 133-142) and the tests under
   Tests to write.
9. **Contract**: `pnpm contract:generate`; commit the output. Fails: the drift check in CI.
10. **`entities.dart`**: the `const entity<Name>`, the schema mirror built from `_object`, `_req`,
    `_opt`, `_oneOf`, `_uuid`; a branch in `patientOfCreate` when the value has `patientId`; the
    registry entry (`category`, `pausesWithClock`, `patientSide`, `create`, `fields`, `permission`,
    `parents`, `initialStatus`). Fails: every vector of the entity in `entities_test.dart`, and its
    "clock pause" test, which compares the whole registry to a fixed map (lines 77-90).
11. **`local_store.dart`**: add the name to the re-export list; add a branch to `_patientOfChange`
    only if the patient comes through a parent (as `entityProblemNote` does).
12. **`fake_server.dart`**: add to `_create`'s three switches what the server module does (own
    checks, patient, after the insert), to `_fetch` what `requireRead` and `mayRead` do, and to the
    chart or history reads if the server's read routes return the record. See `fake-mirror.md`.
13. **`entities_test.dart`**: add the entity to the lists at lines 32-40 and 79-89 and to the
    permission test (92-105).

## Tests to write

- API, in `services/api/test/sync-patients.test.ts`, with the helpers already there
  (`phoneA.change`, `one`, `asA`, `accepted`, `count`, `auditMark`, `expectAudit`, `patient`):
  created once and answered `accepted(c)`; the audit event present once with its details
  (`expectAudit(h, '<action>', { after: mark, patientId, count: 1 })`); replayed, the same answer;
  a second create with the same record ID refused with `details.problem` `record_exists`; a role
  without the key held for review (the "permission per entity" group, line 523); a missing parent
  held or refused (the "parents and holds" group, line 604). The two vector loops (lines 144-195)
  cover the new cases with no new code.
- Phone: step 13. Fake, in `apps/mobile/test/sync/patient_rules_test.dart`: the group "values
  (rule 1)" (line 110) pushes every vector at the fake with no new code. Add one test per own
  check added in step 12.
- Check that the permission, parent and audit tests bite: revert the rule, see it fail, restore.

## Run

```sh
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
export PATH=/opt/flutter/bin:/opt/bin:$PATH
pnpm -s typecheck
cd services/api && pnpm -s vitest run test/contract-vectors.test.ts
pnpm -s vitest run test/sync-patients.test.ts
cd ../../apps/mobile && flutter test test/patients/entities_test.dart
flutter test test/sync/patient_rules_test.dart
```

`pnpm -s typecheck` exits 0. Each vitest run prints `Test Files  1 passed (1)`; its last line
starts with `Duration`. Each `flutter test` ends with `All tests passed!`. The coordinator then
runs `tools/live-sync.sh` and `tools/ci-local.sh` under the lock (`CLAUDE.md`): the live run is
what proves the phone and the real API agree.

## Check before you report

1. Is the permission key one that already exists, and the same on the server, the phone registry and the fake?
2. Does the create write its audit event through `storeCreate`, in the same transaction, with no typed text in the details?
3. Does the schema only validate (no `.trim()`, no default), on the server and on the phone?
4. Do `valueParents`, the phone's `parents` and the vectors' `parents` name the same records in the same order?
5. Does a replay give the same receipt, and a second create with the same ID `record_exists`?
6. Does the fake do every check the server module does, and nothing more?
7. Is `pausesWithClock` what the design says (D35), and is the "clock pause" test updated to match?
8. Did the contract regenerate, with the generated files unedited?

## Mistakes to avoid

- **A transform in a schema.** The receipt confirms the hash of what the phone sent; a `.trim()`
  would store another string (review finding 21, `values.ts` lines 12-16).
- **The server changed, the fake not.** Phone tests then pass against rules the API does not have
  (plan risk 7, decision D52). `CLAUDE.md`: any change under `services/api/src/sync/**` comes with
  the same change to the fake.
- **A new permission key.** The PRD allows none in the MVP; `permissions.test.ts` pins the 23.
- **Editing a merged migration** to add the `patient_of_change` branch. A fix is a new file.
