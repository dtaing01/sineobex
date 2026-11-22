# Recipe: add a Team setup page for a kind of preset

Line ranges are from commit `7368524`.

## When to use this

Use this to add one page of Team setup (phase 5 design 8.1) for one kind of preset: its list
under `/team/presets/<area>` and, where 8.1 names one, a preset's own page
`/team/presets/<area>/[id]`. The admin preset routes exist, and so does everything the pages
share:

- the calls, in `apps/portal/src/lib/presets.ts`;
- the parts, in `apps/portal/src/components/presets/`;
- the refusal sentences, in `apps/portal/src/lib/refusals.ts`;
- Remove, Restore and taking Sineobex's update, in `apps/portal/src/app/actions/presets.ts`.

A page adds its kind's fields, its own add and edit actions, and its tests. For anything this
recipe does not cover, `portal-page.md` holds.

## Level

**R.** A page is 8.1's wording, every refusal's sentence and its accessibility. The auditor reads
the diff and looks at the page in all three themes. A small model must not:

- change anything under `services/`, `packages/` or `db/`, the generated contract, or
  `apps/portal/src/lib/api.ts`;
- add a permission (every page asks `team.manage_presets`, which the API checks);
- check one of the API's rules in the portal (D114);
- write its own Remove, Restore or take-update action;
- edit `apps/portal/e2e/helpers.ts` (a shared helper has one owner).

## What to read first

| What | Where |
|---|---|
| The kind's body, and what is fixed after creation | Design 4.4 (`docs/design/phase-5-admin-configuration.md`); its bounds in `packages/presets/src/schemas.ts` |
| What each act refuses, in which order | Design 5.1; the routes' refusals in design 7 |
| The page's row: what it shows, its states, its wording | Design 8.1, its row and "Shared on every page" below the table |
| A list row as the API sends it | `services/api/src/routes/presets-admin.ts` lines 195-221 (`PresetView`); the routes, lines 223-334 |
| Each refusal's details | `services/api/src/presets/store.ts` lines 486-544; the acts, lines 577-958 |
| Each refusal, as the API's tests make one | `services/api/test/presets-routes.test.ts`: creating (line 202), editing (630), archiving and restoring (876), a reason (1017), taking an update (1723) |

## The example to copy

The categories page, `apps/portal/src/app/(app)/team/presets/categories/`. It is a list page:
each preset is edited where it is listed. A kind with its own `[id]` page (items, bundles,
flags) puts a section's contents on that page instead, and its list links to it.

`page.tsx` (39 lines):

| Lines | What it does |
|---|---|
| 5 | `metadata`: the screen's name only |
| 19-24 | `searchParams`: `preset` is taken only when it is an ID |
| 25-30 | The kind's list first, alone: a person without the key is refused there, logged once, and `unwrap` sends them to `/home?denied=1`. Then each active preset's history |
| 31-38 | What was read goes to a view component, which a unit test draws without the API |

`CategoriesView.tsx` (186 lines):

| Lines | What it does |
|---|---|
| 21 | The fields' words, `FIELD_LABELS[kind]` (`components/presets/review.ts`): the words the update's review uses |
| 23-37 | A hint on each option of a choice fixed after creation, saying what choosing it means |
| 41-50 | The list's order |
| 61-83 | The edit form: hidden `id`, `BaseVersion`, `FreeText`, a number's `TextField`, `ReasonBox`, Save |
| 85-120 | One preset's section: named by its `h2`, its facts, Edit behind a `Disclosure`, `RemoveForm`, `UpdateOffer`, a `flat` `HistoryTable` named for it |
| 122-146 | The add form: `FreeText`, `ChoiceGroup` with 8.1's sentence, `ReasonBox` |
| 154-186 | The page: `<Fragment key={view}>`, the `h1`, the lede, `PresetNotice`, the empty state, the sections, the add form, `RemovedList` |

`apps/portal/src/app/actions/presets-categories.ts` (85 lines):

| Lines | What it does |
|---|---|
| 28-37 | The refusal context: `labels` name the fields in the error summary; `sentences` give a field whose every problem asks one thing its own sentence |
| 39-40 | A free-text field is sent without the spaces around it: the API refuses them, and never trims |
| 46-58 | Add: `sentValues`, the body as typed, `createPreset` in `try`, `presetFailure` in `catch`, then `revalidatePath` and `{ ok: true, message }` |
| 64-85 | Edit: `namedPreset`, then `presetNow` for the body as the API holds it, the form's fields over it, `editPreset` at the version shown |

## Steps

1. Write the page's wording first, from its 8.1 row. Every sentence 8.1 gives is used word for
   word, with curly apostrophes (’). The shared ones are `PRESET_SENTENCES`
   (`apps/portal/src/lib/refusals.ts` lines 62-72): use them, never a copy.
2. Create `page.tsx` like the example's. Read the kind's list first and alone. Read any other
   list the page needs (an item's categories, a line's items) after it. A list page reads each
   active preset's history; a preset's own page places `<VersionHistory kind id />`.
3. Create the view. For each active preset, a `<section aria-labelledby>` named by its `h2`:
   - its facts, its Edit, and `<RemoveForm kind preset />`;
   - `<UpdateOffer kind preset names />`. Place it for every active preset: it draws nothing
     while nothing is on offer. `names` maps every preset ID the bodies name to its name, from
     the lists the page read;
   - its history, named for it ("History of <name>").
   On a preset's own page, pass `back="/team/presets/<area>"` to `RemoveForm` and `UpdateOffer`,
   so the act lands on the list.
4. Write the forms. Name every field by its body path (`name`, `categoryId`, `lines.0.qty`), so
   the API's problem lands beside it. Each form that writes has a `ReasonBox`; each that changes a
   preset has a `BaseVersion`. Use:
   - `FreeText` for each free-text field: a name, a prompt, criteria;
   - `TextField` with `inputMode="numeric"` and a hint for a number;
   - `ChoiceGroup` for a choice fixed after creation, with 8.1's sentence as its `hint`;
   - `ItemLines` for lines of items (`components/presets/ItemLines.tsx`, its props).
5. Create `apps/portal/src/app/actions/presets-<area>.ts` like the example's. Send what was typed:
   `wholeNumber` for a number, `readLines` for lines, `form.get(name) === 'on'` for a checkbox.
   An edit sends `{ ...now.body, ...the form's fields }` at the version shown. On a refusal,
   `return presetFailure(err, values, { kind, act: 'save', labels, sentences })`.
6. A sentence 8.1 doesn't give goes in `refusals.ts`, with a test in `refusals.test.ts`:
   - a problem code's, in `PROBLEMS` (lines 135-159);
   - one field's own, in the page's `sentences`;
   - a refusal code's, in `presetRefusalState`'s `switch` (lines 228-313).
7. Check the hub's card: `PRESET_AREAS` (`lib/presets.ts` lines 271-320). An area not listed there
   joins it with its kinds.

## Tests to write

- **The actions**, `apps/portal/src/app/actions/presets-<area>.test.ts`, like
  `presets-categories.test.ts` (251 lines). Its stand-in API (lines 9-29) answers a GET with
  `listed` and a write with `answer`. Test:
  - each request's path, params and body; an edit's body is the API's with the form's fields over
    it, at the version shown;
  - the message, and `revalidatePath`;
  - each refusal's sentence, beside its field;
  - `/reauth?next=…` for `reauth_required`;
  - that a form no page writes asks the API nothing.
- **The view**, `<Area>View.test.ts` beside it, like `CategoriesView.test.ts` (227 lines): draw it
  with `renderToStaticMarkup` from made-up rows. Test:
  - the order, each fact, the add form's wording, the Removed list and the notice;
  - an update on offer, drawn in its own preset's section; one that changes a fixed field
    offers Add as new.

  The seeded team is never offered an update (`packages/presets/data/platform.json` holds version
  1 of each preset), so only this test draws one.
- **The page**, a `test.describe` of its own in `apps/portal/e2e/presets-pages.spec.ts`, like
  Categories' (lines 159-555):
  - Opened from the hub, `@responsive`: the title, the `h1`, the nav's `aria-current`, and each
    preset against `GET /v1/admin/presets/<kind>`, read in the test. Then `expectAccessible`,
    `expectReflow`, `expectNothingStored`, `expectOnlyIds` and no CSP violation.
  - Each write, and each refusal its routes answer, with its sentence. The error summary takes
    focus: run `expectAccessible(…, { inPlace: true })` and `expectReflow` on it.
  - What each act leaves in the history.
  - A stale sign-in through `/reauth` and back (lines 516-538).
  - A typed address refused for `clinician@example.com`, logged once (`deniedOf`, lines 58-72).

## Run

```sh
pnpm -s lint && pnpm -s format:check && pnpm -s typecheck; echo exit $?
pnpm -s --filter @sineobex/portal test; echo exit $?
node tools/phi-guard.mjs; echo exit $?
```

Each passes when it prints `exit 0`. The end-to-end cases use fixed ports and a fixed database.
Run them under the shared lock, as `tools/ci-local.sh`'s "Portal end-to-end" step runs them:

```sh
flock "$CI_LOCK" bash -c 'export ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres \
  PORTAL_ENV=test PW_CHROMIUM_PATH=/opt/pw-browsers/chromium; tools/e2e-db.sh >/dev/null \
  && pnpm -s --filter @sineobex/portal build >/dev/null \
  && cd apps/portal && CI=1 pnpm -s test:a11y e2e/presets-pages.spec.ts; echo exit $?'
```

It passes when Playwright's summary says `<n> passed` and it prints `exit 0`. It makes the
database and builds the portal afresh each time: the tests run the built portal.

## What the auditor checks

1. Is every sentence of the page's 8.1 row there word for word, with curly apostrophes, and the
   shared ones taken from `PRESET_SENTENCES`?
2. Does every refusal the page's routes answer (design 7) have its sentence? Is it beside its
   field when the API names one, and does the form keep what was typed?
3. Does every form that writes have a `ReasonBox`, and every form that changes a preset a
   `BaseVersion`? Does an edit send the API's current body with the form's fields over it?
4. Is every free-text box a `FreeText`, with "Don’t put patient names here." under it?
5. Is nothing the API decides decided in the portal (D114)? No act is hidden or refused for a
   preset's state, its references or its body, and no field is checked before it is sent.
6. Is `UpdateOffer` placed for every active preset, with `names` for every ID the bodies name?
7. Are Remove, Restore and taking an update the shared parts and actions, with no copy of them?
8. Do the page's addresses carry only IDs, an act's fixed word and a field's ID? Is its title the
   screen's name only?
9. Do the end-to-end cases run axe in all three themes, on the page and on each error state,
   reflow at 320 px, `expectNothingStored` and `expectOnlyIds`? Did they pass under
   `flock "$CI_LOCK"`?

## Mistakes to avoid

- **Checking a rule in the portal.** The API is the one judge (D114). Hiding Remove for a preset
  something uses, or refusing an empty name before it is sent, makes a second copy of a rule,
  which drifts. Send what was typed: the API's answer has a sentence.
- **An edit built from the form alone.** A field the form doesn't show (a fixed field, a flag's
  rank, one a later phase adds) would be sent as nothing, and lost. Send `presetNow`'s body with
  the form's fields over it.
- **A form in a closed `<details>`.** Chrome never finishes the transitions of buttons inside a
  closed `<details>`, and `expectAccessible` waits on them for good. Put an act behind a
  `Disclosure`.
- **A table in a panel in a panel.** At 320 px it has too little width. On a list page, pass
  `flat` to the history.
- **Two regions with one name.** Every `<section aria-labelledby>` is a region, and axe's
  `landmark-unique` check refuses two with one name: name each preset's history for its preset.
- **`@responsive` on a case that writes.** It runs twice against one database, on desktop and
  narrow, and the second run finds the first's preset. Tag only the cases that read.
- **Counting seeded presets.** Every spec shares the database, and other cases add presets. Read
  what to expect from the API, in the test.
- **A token between `stale-sign-in` and `signIn`.** `staffToken(email)` is a sign-in, and takes
  the stale one.
- **Reloading after a refusal.** Only a take refused `stale` reads the page again
  (`actions/presets.ts`). An edit refused `stale` keeps the version it sent, and stays stale until
  the person reloads and sees the other version.
- **The reason and the body in one step.** The API refuses a reason before it reads the body, so
  a form sent empty is told only about its reason. Test the reason, then the fields.
