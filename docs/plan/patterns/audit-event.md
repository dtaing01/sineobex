# Recipe: write an audit event with the action, and test it

Line ranges are from commit `ead5a05`.

## When to use this

A card adds or changes something in the API that reads or changes patient or team data. Every
such action writes one audit event **in the same database transaction**. If the event cannot be
written, the action fails too: a read that can't be logged is refused.

This recipe is for events the API writes online. Events a phone records offline travel by sync
(`services/api/src/sync/**`), which is level X.

## Level

**T**. The audit rule is a safety rule: the planner writes the test first, and a reviewer reads
the diff. The card gives the action name and the exact `details` keys.

Level X parts a small model must not touch:

- `services/api/src/auth/context.ts`: the writer (`writeAudit`, lines 91-105) and the scopes that
  hand you the `audit` function. You only call `audit`.
- `db/migrations/0003_audit.sql`: the hash-chained table and `sineobex.append_audit` (line 104).
  The application role cannot insert, update or delete audit rows itself (lines 213-217).
- Any new migration that touches the audit tables.

## The example to copy

| Where | What it does |
|---|---|
| `services/api/src/auth/context.ts` lines 39-49 | `AuditEvent` (the fields you may set) and `AuditFn` |
| `context.ts` lines 265-274 | `TeamScope.tx`: opens the transaction and passes `(tx, audit)`. `audit` fills in the team, the actor, the role, the device, the IP and the request ID for you |
| `services/api/src/patients/history.ts` lines 25, 79-85 | The smallest call site, a **read**: one `scope.tx`, the query, then `await audit({...})` with an action, the patient and two safe details (a field name and a count) |
| `services/api/src/patients/problems-admin.ts` lines 350, 366-376 | A **write** with a typed reason: the reason goes to its own table (lines 359-364); the event carries the row's ID and `commentSha256`, never the text |
| `services/api/test/patient-fixtures.ts` lines 240-277 | `auditMark`, `expectAudit`, `expectAuditClean` |
| `services/api/test/problems-admin.test.ts` lines 294, 308-309, 425-429 | The helpers in use |

## Steps

1. Find the `scope.tx(async (tx, audit) => { ... })` that does the action. If the function has
   none yet, wrap all of its SQL in one. Do not open a second `scope.tx` for the event.
2. After the last read or write, and before `return`, add the event. Use the action name and the
   keys the card gives.

   ```ts
   await audit({
     action: '<entity>.<verb_in_past_tense>',   // e.g. 'patient.history_viewed'
     entity: '<entity>',                        // optional: what kind of record
     entityId: row.id,                          // optional: which record
     patientId: canonicalPatientId,             // the patient this is about, if any
     details: { count: page.length },           // IDs, counts, field names, versions only
   });
   ```

3. Always `await` it. An event that is not awaited can be lost when the transaction ends.
4. If the action shows several patients (a list or a search), put their IDs in
   `details.patientIds` (`services/api/src/patients/search.ts` line 59), and write one
   `patient.viewed` per patient if the card says so (`problems-admin.ts` lines 220-223).
5. If staff typed a reason or a comment, store the text in the table the card names and put only
   the new row's ID and a hash in the details:

   ```ts
   details: { correctionId: correction!.id, commentSha256: await sha256Hex(input.reason) },
   ```

   `sha256Hex` is in `services/api/src/sync/canonical.ts` (line 58). Import it; do not edit it.
6. Add a line to the function's doc comment that names the action and its detail keys
   ("Audited as ..."), as lines 341-344 of `problems-admin.ts` do.

What `details` may hold: record IDs, counts, field names, versions, status values, a source name
such as `'reversal_queue'`. What it may never hold: names, birth dates, search text, tokens, any
free text staff typed (phase 3 design, `docs/design/phase-3-patients.md` line 1365).

## Tests to write

Helpers, all in `services/api/test/patient-fixtures.ts`:

- `auditMark(h)` (line 240): the newest event's ID. Take it just before the request.
- `expectAudit(h, action, { after, patientId, teamId, count })` (line 250): returns the matching
  events. With `count` it asserts exactly that many; without, at least one.
- `expectAuditClean(h, terms, after)` (line 271): no event's details contain any of the strings.
- `logSpy()` (line 291): pass `logs.log` to `createHarness({ log: logs.log })`, then
  `logs.expectClean(terms)` checks the log lines too.

Write these assertions:

```ts
const mark = await auditMark(h);
const res = await h.request(path, { method: 'POST', token: member.token, teamId, json: body });
expect(res.status).toBe(200);
const [event] = await expectAudit(h, '<action>', { after: mark, patientId, count: 1 });
expect(event!.actorUserId).toBe(member.userId);
expect(Object.keys(event!.details).sort()).toEqual(['<key>', '<key>']);   // exactly these keys
await expectAuditClean(h, ['<the reason text>', '<a name used in the test>'], mark);
```

Also assert the other direction: when the action is refused (404, 409), no event with your
action exists after the mark: `await expectAudit(h, '<action>', { after: mark, count: 0 })`.

## Run

```sh
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
cd services/api && pnpm -s vitest run test/<your-file>.test.ts
cd ../.. && node tools/phi-guard.mjs
```

The vitest run must print `Test Files  1 passed (1)` and no `failed` line; its last line is
`Duration ...`. The PHI guard's last line is `PHI guard: <n> files clean`.

## Check before you report

1. Is the `audit(...)` call inside the same `scope.tx` callback as the SQL it records?
2. Is it awaited?
3. Does every path that returns data or changes data reach an `audit(...)` call?
4. Do the details hold only IDs, counts, field names, versions and hashes?
5. Is the action lowercase letters, dots and underscores only?
6. Does a test assert the event with `count`, and its exact detail keys?
7. Does a test run `expectAuditClean` with every name and typed text the test used?
8. Are `services/api/src/auth/context.ts` and `db/migrations/0003_audit.sql` unchanged?

## Mistakes to avoid

- **Writing the event after the transaction.** Then a crash between the two leaves an action
  nobody can see in the log. The rule in `CLAUDE.md`: same transaction, always.
- **Inserting into `sineobex.audit_events` directly.** The application role has no insert right
  (`0003_audit.sql` line 213). Only `audit(...)` works.
- **Putting the reason text in details.** The codebase stores `commentSha256` and a row ID
  instead; `merges.test.ts` lines 234-235 pin the exact keys and run `expectAuditClean`.
- **Putting search text in details.** A search logs which criteria were used and which patients
  were shown, never what was typed (`CLAUDE.md`, "Rules that never bend").
- **An action name with capitals, spaces or dashes.** The audit search accepts a prefix matching
  `^[a-z_.]+$` only (`services/api/src/routes/audit-log.ts` lines 33-37), so such an event could
  not be searched for.
- **Logging a list as one event with no patients.** An event that showed several patients names
  them in `details.patientIds`, so a search by patient finds it
  (`services/api/test/audit-patient-search.test.ts` lines 6-8; review finding S4).
- **Asserting "at least one" when one is the rule.** Use `count: 1`; a doubled event is a bug too.
