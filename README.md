# Sineobex

A field-first medical record for street medicine teams, free clinics and public health outreach, piloting in Detroit. Staff chart on a phone that works without signal; coordinators, admins and billers work in a browser portal; both talk to one API.

- **What to build and why:** the [Sineobex Build & Strategy Plan](https://claude.ai/code/artifact/6f83b7b9-4134-4c36-ad0c-17a41eed3af3). It is the source of truth.
- **How it is being built, phase by phase:** [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
- **Setting up the preview and production:** [docs/setup.md](docs/setup.md).
- **Compliance mapping (HIPAA Security Rule, WCAG):** [docs/compliance/](docs/compliance/).

> The preview build holds **made-up patients only**. Every screen says so. Never enter a real patient into it.

## Repository

| Path | What it is | Stack |
|---|---|---|
| `apps/mobile` | Field app, iOS and Android | Flutter, SQLCipher (plain SQL via `package:sqlite3`) |
| `apps/portal` | Portal for Logistics, admins and billing | Next.js (App Router), server-side only data access |
| `apps/website` | Marketing site with the Log in button | Next.js static export |
| `services/api` | The only API either app uses | TypeScript, Hono; Node (AWS) and Deno (Supabase preview) entries |
| `packages/contract` | OpenAPI spec generated from the API, TS types, Dart client generator | openapi-typescript, own Dart generator |
| `packages/forms` | Encounter form definitions (phase 4) | TypeScript data |
| `db` | Plain SQL migrations, runner, made-up seed | PostgreSQL 16+ |
| `infra` | AWS production stack (phase 12) | AWS CDK |
| `tools` | PHI guard and other repository checks | Node |

## Develop

Requirements: Node 22.12+, pnpm 10 (`corepack enable`), PostgreSQL 16 or 17 with contrib, Flutter 3.47.6.

```bash
pnpm install
createdb sineobex_local
DATABASE_URL=postgres://localhost/sineobex_local pnpm db:migrate --environment local
DATABASE_URL=postgres://localhost/sineobex_local pnpm db:seed

pnpm lint && pnpm typecheck && pnpm test   # TypeScript packages (API and DB tests need Postgres)
pnpm contract:generate                     # after any API route or schema change; commit the result
pnpm phi-guard                             # fixtures and seeds must be obviously made up

cd apps/mobile && flutter pub get && flutter analyze && flutter test
cd apps/portal && pnpm build && pnpm test:a11y   # axe in all three themes
```

API and database tests create a scratch database per test file. Point them at a superuser connection with `TEST_ADMIN_DATABASE_URL` (default `postgres://postgres@localhost:5432/postgres`).

## Rules that keep patient data safe

1. The phone and the portal call only the Sineobex API. Every permission is checked there; row-level security in Postgres is a second line.
2. Every action that touches patient data writes an audit event in the same transaction.
3. Nothing about a patient goes in logs, crash reports, notifications, URLs or page titles. The API logger drops any field not on its allowlist.
4. The phone deletes local data only after the server confirms, by hash, that it stored that exact value.
5. The preview never holds a real patient; production starts from an empty database under the AWS BAA.
