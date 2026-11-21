# Setup

What a person with the right accounts has to do once. Code and workflows are already in the repository; each step below is configuration.

## 1. GitHub repository settings

- **Branch protection on `main`:** require a pull request with one approving review, require the CI checks (`Secret scan`, `PHI guard`, `TypeScript lint, types and unit tests`, `Migrations and API tests (Postgres 16)`, `Migrations and API tests (Postgres 17)`, `Contract drift`, `Flutter analyze and tests`, `Android debug build`, `Portal build and accessibility`, `Website build`, `Workflow and shell lint`), and block force pushes.
- **Environments:** create `preview` (no reviewers) and, for phase 12, `staging` and `production` (production requires a reviewer).
- **Secret scanning and Dependabot alerts:** turn both on under Settings → Code security.

## 2. Preview on Supabase (made-up patients only)

Supabase signs a BAA only on its Team plan with the HIPAA add-on, so the preview must never hold real patient data. The deploy marks the database `preview` on first run, and the pilot API refuses to start against a database with that mark.

1. Create a Supabase project. Note its project ref.
2. In **Authentication → Providers**, keep Email enabled and disable sign-ups (Program Admins invite people). In **Authentication → Multi-Factor**, enable TOTP and turn on asymmetric JWT signing keys so the API can verify tokens with JWKS.
3. In the SQL editor, create the login the API uses (it is not the owner, so row-level security applies to it):
   ```sql
   create role sineobex_api login password '<generate a long random password>';
   ```
   After the first migration has run, grant it the application role:
   ```bash
   DATABASE_URL='<owner connection string>' pnpm --filter @sineobex/db exec tsx src/cli.ts grant-api sineobex_api
   ```
4. Add to GitHub (Settings → Secrets and variables → Actions):

| Name | Kind | Value |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | secret | A personal access token from the Supabase dashboard |
| `SUPABASE_PROJECT_REF` | variable | The project ref |
| `PREVIEW_DATABASE_URL` | secret | Owner connection string (Session pooler, port 5432), used for migrations and seed |
| `PREVIEW_API_DATABASE_URL` | secret | `sineobex_api` connection string through the transaction pooler (port 6543) |
| `PREVIEW_PORTAL_ORIGIN` | variable | The portal's preview origin, for example `https://app-preview.sineobex.com` |

The next push to `main` migrates, seeds and deploys the API to `https://<ref>.supabase.co/functions/v1/api`.

## 3. Portal and website on Vercel (preview)

1. Create two Vercel projects from this repository with root directories `apps/portal` and `apps/website`.
2. Portal environment variables: `PORTAL_ENV=preview`, `API_URL=https://<ref>.supabase.co/functions/v1/api`, `SESSION_SECRET` (32+ random characters). Website: `NEXT_PUBLIC_PORTAL_URL` set to the portal's address.
3. Add `VERCEL_TOKEN` (secret), `VERCEL_ORG_ID`, `VERCEL_PORTAL_PROJECT_ID` and `VERCEL_WEBSITE_PROJECT_ID` (variables) to GitHub.
4. Point DNS for `sineobex.com` at the website and `app.sineobex.com` (or the chosen name) at the portal. This needs registrar access (open task in the plan).

## 4. Field app builds

Local and CI builds talk to a local API by default. For a preview build:

```bash
cd apps/mobile
flutter build apk --dart-define=SINEOBEX_ENV=preview --dart-define=SINEOBEX_API_URL=https://<ref>.supabase.co/functions/v1/api
```

Store releases need an Apple Developer Program membership and a Google Play developer account, plus signing secrets for `release-mobile.yml` (phase 12).

## 5. Production on AWS (phase 12)

Do not start until the AWS BAA is accepted in AWS Artifact. Steps live in `infra/README.md` once phase 12 lands.
