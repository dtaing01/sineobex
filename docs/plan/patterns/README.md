# Pattern recipes

A recipe is a short page for one kind of recurring work. It shows one existing piece of code to
copy and the steps to make another like it. Each recipe says under its title which commit its
line ranges are from. Read `docs/plan/README.md` first: it defines the card levels S, T, R and X.

## How a card uses a recipe

- A card's **Read first** names the lines of one recipe (usually its Steps) and one example file.
- The recipe gives the steps, the test helpers, the commands and the mistakes to avoid. They are
  the same every time.
- The card gives the particulars: the names, the fields, the SQL, the wording, the files to
  change and the tests to write or to make pass.
- Where the card and the recipe disagree, the card wins for particulars. If the card asks for
  something the recipe says a small model must not do, the implementer stops and reports: it
  does not choose.
- Each recipe ends with **What the auditor checks**. The planner copies the lines that apply
  into the card's **Audit** list. The auditor goes through the whole list when it reads the
  unit's diff.
- A recipe's line ranges go stale as the code changes. The planner checks them when it writes a
  card, and corrects the recipe in the same commit. An implementer who finds that the lines do
  not show what the card says stops and reports: it does not go looking for the code.

## Server

| Recipe | Use it to |
|---|---|
| [migration.md](migration.md) | Add a migration |
| [api-route.md](api-route.md) | Add an API route |
| [audit-event.md](audit-event.md) | Write an audit event |
| [permission-check.md](permission-check.md) | Check a permission |

## Contract and portal

| Recipe | Use it to |
|---|---|
| [contract.md](contract.md) | Regenerate the contract after a route, schema or data-file change, and commit what the generator wrote |
| [portal-page.md](portal-page.md) | Add a portal page with its server action and its end-to-end test (axe in three themes, reflow at 320 px) |
| [preset-kind.md](preset-kind.md) | Add a Team setup page for one kind of preset (phase 5): its list and forms, its add and edit actions, the shared parts placed (Reason box, Remove, Restore, the update offer, the history), every refusal's sentence, and its tests |
| [seed-data.md](seed-data.md) | Add made-up demo data to the seed that the PHI guard accepts |

## Phone

| Recipe | Use it to |
|---|---|
| [phone-domain.md](phone-domain.md) | Add a phone domain method |
| [phone-screen.md](phone-screen.md) | Add a phone screen with its tests |

## Sync

| Recipe | Use it to |
|---|---|
| [synced-entity.md](synced-entity.md) | Add a synced record type |
| [fake-mirror.md](fake-mirror.md) | Mirror a server sync rule in the phone test server |
| [shared-vectors.md](shared-vectors.md) | Add a shared test vector file read by both the API and the phone |

## Forms (phase 4 onward)

| Recipe | Use it to |
|---|---|
| [form-definition.md](form-definition.md) | Turn a piece of the field specification into a form definition; [form-definition-example.md](form-definition-example.md) is one piece worked from start to finish |
