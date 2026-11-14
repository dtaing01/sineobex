# Recipe: check a permission in the API and see the refusal logged

Line ranges are from commit `ead5a05`.

## When to use this

A card adds a route, or changes what a route needs. The API decides who may do what. The apps
only hide what a role cannot use; a typed URL must be refused by the server, and the refusal is
written to the audit log as `access.denied`.

## Level

**R**: it touches a permission, so a reviewer reads the diff. The tests come from one table
(`ROUTES`), and the card says exactly which keys go in the row.

The product allows **no new permission keys** (plan decision D37). There are 23, in
`services/api/src/auth/permissions.ts` lines 12-37. You pick from them; you never add one.

Level X parts a small model must not do. `services/api/src/auth/**` is always level X:

- Do not edit `services/api/src/auth/permissions.ts`: no new key, no new rule in `ACCESS_RULES`
  (lines 53-74). A rule is mirrored on the phone (`apps/mobile/lib/patients/access.dart`) and
  pinned by `packages/contract/test-vectors/access.json`; changing one is strong-model work.
- Do not edit `services/api/src/auth/context.ts` (`teamScope`, `require`, `requireAny`,
  `requireRule`). You call them.
- Do not write or change a row-level security policy in `db/migrations/`.

If the card's permission is not in the list of 23, stop and report. Do not pick a similar one.

## The example to copy

| Where | What it does |
|---|---|
| `services/api/src/auth/permissions.ts` lines 12-37 | The 23 keys, each with a plain description |
| `services/api/src/routes/problems.ts` lines 96-99 | The usual check: `teamScope(c, deps, { permissions: ['patients.reverse_resolved'], recentAuth: true })` as the handler's first line |
| `services/api/src/auth/context.ts` lines 210-215, 345 | `permissions` lists keys that are **all** required; each is checked with `scope.require` |
| `context.ts` lines 231-235 | `require`: on refusal it writes `access.denied` with `{ permission, route }`, then throws 403 `forbidden` |
| `services/api/src/routes/duplicates.ts` lines 132-136 | "Any one of these": `scope.requireAny([...], c.req.routePath)`; logs `{ anyOf, route }` |
| `services/api/src/routes/patients.ts` lines 221-227 | An existing named rule: `scope.requireRule('mayHoldTeamIndex', c.req.routePath, { message, code })`; logs `{ rule, route }` |
| `services/api/src/patients/problems-admin.ts` lines 72-77 | Inside a module: `scope.can(key)` to hide a sensitive record as 404. No refusal is logged, because the caller is not told the record exists |
| `services/api/test/permissions.test.ts` lines 56-68, 226-233 | The `RouteCase` shape, and the row for the route above |
| `permissions.test.ts` lines 305-331 | The two tests every row gets: refused and logged; allowed and not logged |

## Steps

1. Read the card's permission key. Check it is spelled exactly as in `permissions.ts` lines 12-37.
   TypeScript refuses a key that is not there.
2. In the handler, make the check the first statement. Use one of these three shapes.

   ```ts
   // All of these keys (the usual case).
   const scope = await teamScope(c, deps, { permissions: ['patients.view', 'patients.edit'] });

   // Any one of these keys.
   const scope = await teamScope(c, deps);
   await scope.requireAny(['patients.edit', 'patients.correct_identity'], c.req.routePath);

   // An existing named rule from ACCESS_RULES.
   const scope = await teamScope(c, deps);
   await scope.requireRule('mayViewProblems', c.req.routePath);
   ```

3. Pass `c.req.routePath` as the route, never `c.req.path` or `c.req.url`. `routePath` is the
   route's pattern, with a placeholder where the real URL has a record ID.
4. If the route returns chart values, names or births, it also needs `patients.view`. Add it to
   the list unless the card says otherwise.
5. Add `recentAuth: true` only when the card says the action needs a recent sign-in.
6. To hide part of an answer from a role (for example sensitive problems), use
   `scope.can('<key>')` in the module function and filter the query, as `problems-admin.ts`
   lines 191 and 200 do. Do not throw 403 for a single hidden record: answer 404.
7. Add one row to `ROUTES` in `services/api/test/permissions.test.ts`, next to the rows of the
   same route file:

   ```ts
   {
     method: 'POST',
     path: `/v1/<things>/${id()}/<verb>`,
     body: { /* a body the schema accepts */ },
     allowed: ['<every key the route needs>'],
     refused: ['<keys that are not enough>'],
     logged: { permission: '<the key the refusal names>' },
   },
   ```

   For `requireAny` the logged shape is `{ anyOf: [...] }`; for `requireRule` it is
   `{ rule: '<name>' }`, and add `code:` if the route gives its own error code.
8. If the route needs two keys, add a second row with a `label` (for example
   `'without patients.view'`), whose `refused` holds the other key and whose `logged` names the
   missing one. Lines 82-99 show a pair.

## Tests to write

The `ROUTES` row is the test: lines 305-331 turn it into two tests. They use `memberWith(h,
teamId, permissions)`, `auditMark(h)` and `expectAudit(h, 'access.denied', { after, teamId,
count: 1 })` from `services/api/test/patient-fixtures.ts`. They assert:

- A member holding only `refused` gets 403, error code `forbidden` (or the row's `code`), and
  exactly one `access.denied` event whose actor is that member and whose details match `logged`
  and carry a `route` starting `/v1/`.
- A member holding `allowed` gets neither 403 nor 422, and no `access.denied` event is written.

So the row's `body` must pass validation, and `refused` must be keys that really are not enough.
The IDs in the path are random; a 404 on the allowed side is fine.

In the route's own test file, add one refusal test with a realistic role, as
`services/api/test/problems-admin.test.ts` lines 326-331 do.

## Run

```sh
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
cd services/api && pnpm -s vitest run test/permissions.test.ts
```

It must print `Test Files  1 passed (1)` and no `failed` line; the last line is `Duration ...`.
At this commit the `Tests` line reads `67 passed (67)`; each new row adds two.

## Check before you report

1. Is the permission check the first statement of the handler, before any query?
2. Is every key one of the existing 23, spelled exactly?
3. Is `services/api/src/auth/**` unchanged?
4. Does the route have a row in `ROUTES`, with a body the schema accepts?
5. Did the `Tests` count in `permissions.test.ts` go up by two for each row you added?
6. If the route returns chart values, does it also require `patients.view`?
7. Does the refusal log `c.req.routePath`, not the real URL?

## Mistakes to avoid

- **Adding a permission key.** `permissions.test.ts` line 33 fails unless there are exactly 23,
  and `services/api/test/foundation.test.ts` lines 398-401 fail if the list differs from the
  database's `sineobex.known_permissions()`.
- **Checking an edit permission but returning chart values.** Review finding S5: match
  candidates, field reviews and corrections each gained a `patients.view` check
  (`permissions.test.ts` lines 90-99, 146-161, 169-177).
- **Hiding the button and skipping the server check.** The refusal must come from the API and be
  logged (`context.ts` line 230).
- **Throwing `forbidden()` yourself.** That gives a 403 with no audit event. Use `require`,
  `requireAny` or `requireRule`, which log first and then throw.
- **A looser key than the card names.** Undoing a merge needs `patients.correct_identity`;
  `patients.review_duplicates` alone is refused (`permissions.test.ts` lines 283-286).
- **Relying on row-level security.** It is the second line. It keeps teams apart; it knows
  nothing about roles.
