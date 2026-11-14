# Recipe: add an API route

Line ranges are from commit `ead5a05`.

## When to use this

A card asks for a new online endpoint in `services/api/src/routes/`: the portal or the phone
calls it directly. Records that phones create offline do **not** use this recipe: they travel by
sync, and `services/api/src/sync/**` is level X.

## Level

Usually **T**. A route enforces a permission and writes an audit event, so the planner writes its
tests first and a reviewer reads the diff. The card gives the path, the schema fields, the
permission key, the error codes and the audit action in full.

Level X parts a small model must not do:

- Do not edit anything in `services/api/src/auth/**`, `services/api/src/db/**` or
  `services/api/src/sync/**`. You call `teamScope` and `scope.tx`; you never change them.
- Do not invent a permission key. See `permission-check.md`.
- Do not edit generated files by hand (step 8 regenerates them).

## The example to copy

One route, "decline a problem reversal", in four small places.

| Where | What it does |
|---|---|
| `services/api/src/patients/schemas.ts` line 37, line 579, line 841 | The path parameter `ProblemParam`, the body `DeclineReversal` (named with `.openapi('DeclineReversal')`), and its input type |
| `services/api/src/routes/problems.ts` lines 1-22, 30 | Imports, and the `json` helper that wraps a schema as a JSON body |
| `problems.ts` lines 60-69 | `declineRoute`: method, path, `operationId`, tag, summary, request, responses |
| `problems.ts` lines 96-99 | The handler. Two lines: `teamScope` (permission, recent sign-in), then call the module function and answer with `c.json(..., 200)` |
| `services/api/src/patients/problems-admin.ts` lines 345-379 | `declineReversal`: one `scope.tx`, the checks, the writes, the audit event, the answer |
| `services/api/src/app.ts` lines 14 and 107 | The route file is imported and registered |
| `services/api/test/problems-admin.test.ts` lines 38-53, 150-162, 291-331 | Setup, a `call` helper, and the route's two tests |

For a read (GET) route, the same file shows `reversalsRoute` (lines 32-44, handler 86-89) and
`listReversals` (`problems-admin.ts` lines 187-236).

## Steps

1. **Schemas.** In the module's `schemas.ts` (the card names it), add the body and the answer.
   Reuse `Uuid`, `Reason`, `Ok` and `errors` from `services/api/src/routes/schemas.ts`.

   ```ts
   export const DoThing = z.object({ reason: Reason }).openapi('DoThing');
   export type DoThingInput = z.infer<typeof DoThing>;
   ```

2. **Module function.** In the module file the card names, write the work. All SQL and the audit
   event go inside one `scope.tx`. Throw `notFound`, `conflict` or `invalid` from
   `services/api/src/lib/errors.ts` for refusals; the transaction then rolls back.

   ```ts
   export async function doThing(scope: TeamScope, id: string, input: DoThingInput): Promise<ThingValue> {
     return scope.tx(async (tx, audit) => {
       const [row] = await tx<{ id: string }[]>`
         select id from sineobex.<table> where team_id = ${scope.team.teamId} and id = ${id}`;
       if (!row) throw notFound('<thing>');
       // ... the writes the card gives ...
       await audit({ action: '<entity>.<verb>', entity: '<entity>', entityId: row.id, patientId, details: { /* IDs only */ } });
       return /* the answer */;
     });
   }
   ```

3. **Route definition.** In the route file, copy `declineRoute` (lines 60-69). Change `path`,
   `operationId` (unique, camelCase), `tags`, `summary`, the request schemas and the 200 answer.
   List every error status the route can give in `errors(...)`; 401, 403 and 422 are always there.
4. **Handler.** Inside the file's `register...Routes` function:

   ```ts
   app.openapi(doThingRoute, async (c) => {
     const scope = await teamScope(c, deps, { permissions: ['<existing.key>'], recentAuth: true });
     return c.json(await doThing(scope, c.req.valid('param').thingId, c.req.valid('json')), 200);
   });
   ```

   Use `c.req.valid('param')`, `c.req.valid('query')` and `c.req.valid('json')`; never read the raw
   request. Leave out `recentAuth` unless the card says the action needs a recent sign-in.
5. **New route file only:** export `register<Name>Routes(app: App, deps: Deps)`, then import it and
   call it in `services/api/src/app.ts` next to the others (lines 7-17 and 99-109).
6. **Search terms and names go in a POST body**, never in the path or query. IDs may be in the path.
7. **Permissions table.** Add the route to `ROUTES` in `services/api/test/permissions.test.ts`
   (see `permission-check.md`).
8. **Contract.** From the repository root run `pnpm contract:generate` and keep the regenerated
   files in the same change. Never edit them by hand.

## Tests to write

Helpers (all exist):

- `createHarness()` from `services/api/test/harness.ts` (line 46): the real app on a scratch
  database. `h.request(path, { method, token, teamId, json })` calls it; `h.close()` in `afterAll`.
- `createTeam(h)` and `memberWith(h, teamId, permissions)` from
  `services/api/test/patient-fixtures.ts` (lines 54 and 30): a team, and a member whose role holds
  exactly those permissions. Use `member.token`.
- `createPatient(h, teamId, authorUserId, fields)` (line 108) when the route needs a patient.
- `auditMark(h)`, `expectAudit(h, action, { after, patientId, count })`, `expectAuditClean(h,
  terms, after)` (lines 240-277). See `audit-event.md`.
- `h.tokenFor(email, { authTime })` for a stale sign-in (`problems-admin.test.ts` lines 320-326).

Assert, as `problems-admin.test.ts` lines 291-331 do:

- The happy path: status 200, the body (`toMatchObject`), and the rows it wrote, read back with
  `h.scratch.owner`.
- Exactly one audit event with the right action and patient (`count: 1`).
- Each refusal the card lists: its status and `body.error.code`. Doing it twice gives the 409.
- A member without the permission gets 403 and one `access.denied` event.
- With `recentAuth`: a token an hour old gets 403 with code `reauth_required`.
- `res.headers.get('cache-control')` is `no-store` (line 156).

## Run

```sh
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
cd services/api && pnpm -s vitest run test/<your-file>.test.ts
pnpm -s vitest run test/permissions.test.ts
cd ../.. && pnpm contract:generate
pnpm -s lint && pnpm -s format:check && pnpm -s typecheck
```

Each vitest run must print `Test Files  1 passed (1)` and no `failed` line; the last line printed
is `Duration ...`. The lint line must exit with status 0 (`echo $?` prints `0`).

## Check before you report

1. Does the handler call `teamScope` with a permission before anything else?
2. Is every SQL statement and the audit event inside the same `scope.tx`?
3. Does every query filter by `team_id = ${scope.team.teamId}`?
4. Is the permission key one that already exists in `services/api/src/auth/permissions.ts`?
5. Are names and search text absent from the path, the query and the audit details?
6. Did you add the route to `ROUTES` in `permissions.test.ts`?
7. Did you run `pnpm contract:generate` and keep its output, unedited?
8. Are `services/api/src/auth/**`, `src/db/**` and `src/sync/**` unchanged?

## Mistakes to avoid

- **Checking permissions only in the app.** The API is the check; the screens only hide things.
  Row-level security is the second line, not the first (`CLAUDE.md`).
- **Search in a GET.** `permissions.test.ts` lines 346-363 test that names travel only in a POST
  body; `services/api/src/routes/audit-log.ts` line 28 says why (URLs, browser history, access logs).
- **Error messages built from input.** `services/api/src/lib/errors.ts` lines 3-7: messages are fixed text, never
  made from what the request sent.
- **A route that returns chart values but checks only an edit permission.** Review finding S5
  added `patients.view` to such routes (`permissions.test.ts` lines 91, 170, 187).
- **Forgetting the contract.** CI regenerates the spec and both clients and fails on any diff.
- **Auditing outside the transaction.** If the event is written in a second `scope.tx`, a failure
  between the two leaves an action with no record.
