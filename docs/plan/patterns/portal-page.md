# Recipe: add a portal page

Line ranges are from commit `ead5a05`.

## When to use this

Use this to add one page to the portal (`apps/portal`): a Next.js server component that reads
from the API, an optional server action that writes through the API, and an end-to-end test. The
API route the page calls must already exist and be in the contract (see `api-route.md` and
`contract.md`). The portal never reads the database and never checks a permission by itself: the
API does both.

## Level

**R.** A page is a screen's wording and accessibility, and its navigation entry follows a
permission. A reviewer reads the diff and looks at the screen in all three themes. A small model must not: add a permission key (the PRD allows no new ones); edit
`apps/portal/src/lib/api.ts`, `apps/portal/src/proxy.ts` or anything under
`apps/portal/src/lib/auth/`; edit `apps/portal/e2e/helpers.ts` (a shared helper has one owner);
edit `apps/portal/playwright.config.ts`, `tools/**` or `.github/**` (always level X).

## The example to copy

The page: `apps/portal/src/app/(app)/team/reviews/page.tsx` (117 lines).

| Lines | What it does |
|---|---|
| 9 | `metadata`: the title is the screen's name only. The root layout adds "· Sineobex" |
| 11-16 | `UUID` pattern and `href()`: the only things this page puts in a URL are a record ID and a page number |
| 22-35 | The component is `async`. `searchParams` is a Promise: await it, then accept only values that match a pattern |
| 36-40 | The read: `unwrap((await api()).GET(path, { params }))`. `unwrap` redirects on a refusal (no permission goes to `/home?denied=1`) |
| 46-50 | One `<h1 className="px-h1">` and help text in plain language |
| 51-69 | The message after an action (chosen from a fixed query value, in `role="status"`), and the empty state |
| 75-78 | Each item is a `<section>` labelled by its own `<h2>` |
| 82-86 | A link to a patient page: `prefetch={false}`, and `sr-only` text that tells links apart |
| 88 | The form is a component (`apps/portal/src/components/ReviewForm.tsx`, line 29: `<ActionForm id=… action={decideReview} label=…>`) |

The action: `apps/portal/src/app/actions/reviews.ts` (74 lines).

| Lines | What it does |
|---|---|
| 1 | `'use server'` is the first line |
| 12-15 | `backTo()`: a return path taken from the form is checked against a pattern, never trusted |
| 21-22 | Signature `(_: ActionState, form: FormData): Promise<ActionState>`; `formValues(form, …names)` reads the fields |
| 27-37 | Checks before the API call. On failure: `{ error, fieldErrors, values }`, so the form keeps what was typed |
| 38-49 | The write: `unwrap((await api()).POST(path, { params, body }))` |
| 50-71 | `catch`: rethrow anything that is not a `PortalApiError`; turn known `err.code` values into plain messages |
| 72-73 | `revalidatePath(back)`, then `redirect()` with a fixed word in the query (`?decided=current`) |

The test: `apps/portal/e2e/corrections.spec.ts` (89 lines). Lines 22-30: `signIn`, open the page,
`expectAccessible`, `expectReflow`. Lines 37-43: the error summary takes focus, then
`expectAccessible(…, { inPlace: true })`. Line 62: `expectNothingStored`. Lines 82-89: a role
without the permission finds no link and is sent to `/home?denied=1`.

## Steps

1. Create `apps/portal/src/app/(app)/<path>/page.tsx`. Start it like the example:

   ```tsx
   import type { Metadata } from 'next';
   import { api, unwrap } from '@/lib/api';
   export const metadata: Metadata = { title: '<Screen name>' };
   export default async function <Name>Page() {
     const data = await unwrap((await api()).GET('<route from the card>'));
     return <><h1 className="px-h1"><Screen name></h1>…</>;
   }
   ```

2. If the page takes query values, copy lines 22-35 of the example. Accept a value only when it
   matches a pattern (a UUID, a number, one of a fixed set of words).
3. Write the body with the wording the card gives, exactly. Use the classes the example uses
   (`px-h1`, `px-h2`, `px-panel`, `sx-help`, `px-alert px-alert--ok`). Give every list item its
   own heading. Write the empty state.
4. Every `<Link>` whose `href` starts with `/patients/` gets `prefetch={false}`.
5. If the page writes: create `apps/portal/src/app/actions/<name>.ts` shaped like the example
   action. Validate, call the API inside `try`, map `PortalApiError` codes to the card's
   messages, then `revalidatePath` and `redirect`. The `redirect` call stays outside the `try`.
6. If the page writes: put the form in `apps/portal/src/components/<Name>Form.tsx` using
   `ActionForm`, `TextField`, `ChoiceField` and `SubmitButton` from `@/components/ActionForm`.
   Each `ActionForm` needs an `id` that is unique on the page, and a `label`.
7. Add the navigation entry in `apps/portal/src/app/(app)/layout.tsx` (the `nav` array, lines
   10-40): `{ href, label, show: can(team, '<existing key from the card>') }`.
8. Add the path to the list in `apps/portal/e2e/a11y.spec.ts` lines 65-76 (pages behind sign-in).
9. Write the end-to-end test (next section).

## Tests to write

One file: `apps/portal/e2e/<name>.spec.ts`. Import from `./helpers`: `signIn`,
`expectAccessible`, `expectReflow`, `expectNothingStored`, and `setRole` or `customRole` when the
card needs a role the seed lacks. Seeded sign-ins are in `db/seed/seed.ts` lines 15-61
(`admin@example.com`, `logistics@example.com`, …). Assert, in tests named by the card:

- `await expect(page).toHaveTitle('<Screen name> · Sineobex')`.
- `await expectAccessible(page, '<path>')`: axe in Day, Night run and High contrast.
- `await expectReflow(page, '<path>')`: nothing scrolls sideways at 320 px.
- With a form: submit it empty, `await expect(form.getByRole('alert')).toBeFocused()`, then
  `expectAccessible(page, '<label>', { inPlace: true })` so the error state is checked too.
- After a successful action: `toHaveURL(…)` on the redirect, and the `role="status"` message.
- `await expectNothingStored(page, '<label>')`.
- A role without the permission: the navigation link has count 0, and
  `page.goto('<path>')` ends at `/home?denied=1`.
- Only seeded demo patients (`db/seed/demo-patients.ts`), and typed text that starts with "Demo:".

## Run

```sh
pnpm -s lint && pnpm -s format:check && pnpm -s typecheck
pnpm -s --filter @sineobex/portal test
```

The first passes when it ends with no error line. The second passes when the summary says every test
file passed (this includes `src/lib/patient-links.test.ts`); its last line starts with `Duration`.
The end-to-end tests use fixed ports and a fixed database. Run them under the shared lock
(`CI_LOCK` is given to you), never without it:

```sh
flock "$CI_LOCK" sh -c 'ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres tools/e2e-db.sh \
  && PORTAL_ENV=test pnpm -s --filter @sineobex/portal build \
  && cd apps/portal && CI=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
     pnpm -s test:a11y e2e/<name>.spec.ts'
```

It passes when Playwright's summary says `<n> passed` and nothing failed. Rebuild after every
source change: the tests run the built portal, not your working files.

## Check before you report

1. Is the page title the screen's name only, with no patient name, date or ID in it?
2. Does every URL the page builds hold only record IDs, page numbers or fixed words?
3. Does every `<Link>` to `/patients/…` have `prefetch={false}`?
4. Does every read and write go through `api()` and `unwrap()`, with no other `fetch`?
5. Is the navigation entry shown by an existing permission key, the one the API route checks?
6. Do `expectAccessible` and `expectReflow` run on the page, and on its error state if it has a form?
7. Did the end-to-end test run under `flock "$CI_LOCK"` and pass?

## Mistakes to avoid

- **Prefetching a patient page.** Loading a patient page logs a view. A prefetch logs a view
  nobody made. `apps/portal/src/lib/patient-links.test.ts` fails on any such link without
  `prefetch={false}`.
- **A patient in the title or URL.** The root layout says "Titles never name a patient"
  (`apps/portal/src/app/layout.tsx` line 13). The patient page's own title is just `Patient`.
  Search text and names go in POST bodies; a redirect carries a fixed word, never a value.
- **Hiding a page in the portal and calling that the permission check.** `can()` only hides the
  link. The API refuses, logs the refusal, and `unwrap` redirects (`apps/portal/src/lib/api.ts` lines 67-69).
- **Catching the redirect.** `redirect()` works by throwing. Inside `try`, the `catch` must
  rethrow what is not a `PortalApiError` (example action, line 51).
- **Running axe mid-fade.** Use `expectAccessible`: it waits for theme transitions (`helpers.ts`
  lines 31-33). Do not call `AxeBuilder` yourself.
- **Leaving a role changed.** Specs share one database: after `setRole`, put the role back.
  Copy uses curly apostrophes (’), as the existing copy does.
