# Sineobex implementation plan

Status as of 2026-10-20. Source: the [Sineobex Build & Strategy Plan](https://claude.ai/code/artifact/6f83b7b9-4134-4c36-ad0c-17a41eed3af3) (main tab, the **Build plan** tab dated Oct 19, the **Proposed · Oct 12** tab, and the **Google Doc Contents** field spec). When this file and the plan disagree, the plan wins and this file is corrected.

This file turns the Build plan's phases 0–12 into concrete work in this repository: what gets built, on what stack, how each phase is tested, and what still needs a person. Statuses in the phase table are kept current as work lands.

---

## 1. What we are building

A field-first EMR for street medicine teams, piloting in Detroit:

- **Field app** (Flutter, iOS and Android): charting that works with no signal, an encrypted local database, and a sync protocol that deletes local data only after the server confirms each value.
- **Portal** (Next.js, browser, online-only): Logistics, Program Admins and Billing/Data. Route building, configuration, merge queue, attestation, exports, audit dashboard.
- **API** (TypeScript, Hono): the only thing either app talks to. Every permission check and every audit event happens here.
- **Database** (PostgreSQL, plain SQL migrations): runs unchanged on Supabase (preview, made-up patients only) and RDS (pilot, under the AWS BAA).
- **Infrastructure** (AWS CDK): the production stack, checked in CI against the cdk-nag HIPAA Security rule pack.

Out of scope for the MVP, per the plan's V2 list: AI patient story, resource directory (the Resources tab shows Coming Soon), geofenced alerts, team chat, offline desktop, dictation, volunteer run sign-up, referral status and completion tracking, supply barcode scanning, send-out labs.

---

## 2. Architecture

```
            ┌──────────────────────┐        ┌──────────────────────────┐
            │ Field app (Flutter)  │        │ Portal (Next.js, BFF)    │
            │ SQLCipher, plain SQL │        │ no PHI at rest in browser│
            │ outbox + receipts    │        │ tokens in httpOnly cookie│
            └─────────┬────────────┘        └────────────┬─────────────┘
                      │ HTTPS + OIDC bearer token         │ server-side fetch
                      ▼                                   ▼
            ┌──────────────────────────────────────────────────────────┐
            │ API (Hono, TypeScript) — one codebase, two entry points  │
            │  • Node entry  → ECS Fargate (pilot/prod), local, CI     │
            │  • Deno entry  → Supabase Edge Function (preview)        │
            │  auth (any OIDC issuer) → permission check → handler     │
            │  → audit event in the same transaction                   │
            └─────────┬───────────────────────────────┬────────────────┘
                      ▼                               ▼
            ┌──────────────────────┐        ┌──────────────────────────┐
            │ PostgreSQL           │        │ Object storage (S3 API)  │
            │ schema `sineobex`    │        │ photos, documents,       │
            │ RLS as second line   │        │ audit anchors (Object    │
            │ hash-chained audit   │        │ Lock in production)      │
            └──────────────────────┘        └──────────────────────────┘
```

### Repository layout

Matches the Build plan's layout, plus `tools/` for repo scripts and `docs/` for compliance records.

```
apps/mobile        Flutter field app
apps/portal        Next.js portal (Logistics, admin, billing)
apps/website       marketing site (moved from /website), gains a Log in button
services/api       TypeScript API (Hono), Node and Deno entry points
packages/contract  OpenAPI spec generated from the API's route schemas; TS types; Dart client generator
packages/forms     encounter form definitions built from the Google Doc Contents tab
db/migrations      plain SQL, applied in order, checksummed
db/seed            made-up patients, routes and bags for the preview
infra/             AWS CDK app (phase 12)
tools/             PHI guard, migration runner, contract drift check
docs/              compliance mapping, architecture notes, runbooks
```

### Decisions this plan makes, and why

| # | Decision | Why |
|---|---|---|
| D1 | The OpenAPI spec is **generated from the API's Zod route definitions** (`@hono/zod-openapi`), committed to `packages/contract/openapi.json`. TS types (portal) and the Dart client (phone) are generated from that file. CI regenerates all three and fails on any diff. | A hand-written spec can drift from the server. Generating it from the code that validates requests means the contract is the implementation. The Build plan's goal — "the two apps can't drift apart" — holds because CI enforces it. |
| D2 | The Dart client is produced by a **small generator we own** (`packages/contract/scripts/gen-dart.ts`), not openapi-generator. | openapi-generator's Dart output pulls in `dio`, `built_value` and a build step, and is hard to review. Ours emits plain model classes and one client class, only for the shapes we use. |
| D3 | The API core is **runtime-neutral**: `createApp(deps)` takes a database handle, a token verifier, a clock and a blob store. Node and Deno entry files only wire those in. | The plan's "same code on Node, in ECS Fargate" only holds if nothing in the core touches Deno- or Node-specific APIs. Tests run the core on Node against a real Postgres. |
| D4 | All tables live in a **`sineobex` schema**, not `public`; the `anon` and `authenticated` roles get no grants. | On Supabase, PostgREST exposes `public` to the internet. Keeping tables out of it enforces "the phone and the portal talk only to our API" at the database. RDS has no such roles; the migration checks before revoking. |
| D5 | **RLS is the second line**: every request runs in a transaction that sets `app.team_id`; team-scoped tables carry a policy on it. The API connects as a non-owner role. | A handler that forgets a `team_id` filter returns nothing instead of another team's patients. Plain Postgres policies, no Supabase `auth.uid()`. |
| D6 | **Auth accepts any OIDC issuer** via JWKS (`jose`), configured by `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`. Admin and Billing/Data actions require an MFA-level token (`aal2` on Supabase; Cognito enforces MFA at the pool). Tests use a local signing key. | "Supabase Auth swaps for Cognito without touching app screens." The swap is three environment variables plus the MFA claim mode. |
| D7 | **Audit log**: one hash chain per team (`hash = SHA-256(prev_hash ‖ canonical row)`), written in the same transaction as the change it records, serialized per team with `pg_advisory_xact_lock`. UPDATE and DELETE are blocked by trigger and by grants. A job writes each chain head to the anchor store (S3 Object Lock, compliance mode, in production). | Matches module 10. Per-team chains keep one busy team from serializing everyone. Verification is a single SQL walk, covered by tests that tamper with a row and expect the walk to fail. |
| D8 | **Sync protocol** exactly as module 9: immutable change entries (UUID change ID, device record ID, entity, field, value, base version, user, device, device time, per-device sequence, SHA-256 of the canonical value). The server answers each change `accepted` (server version + hash), `rejected` (reason) or `conflict` (server value + version). Field-level purge only after a hash-matched receipt. | The plan's central safety rule. Idempotency by change ID makes "app killed mid-sync" a retry, not a duplicate. |
| D9 | **Draft reconciliation** (Oct 19): a `set` change carries the field version the user saw. Blank or default server field, or matching version → accepted. Different non-blank server value → `conflict`, shown side by side; the user's choice is sent as an explicit resolution and both values stay in field history. | "A field that already holds a different value is never overwritten silently." |
| D10 | **Phone key handling**: a random 256-bit database key per user, wrapped with AES-256-GCM under a key derived from the PIN (PBKDF2-HMAC-SHA256), stored in the platform keystore with this-device-only accessibility. The wrong-PIN counter is written *before* each attempt, so killing the app can't skip a count; the tenth wrong PIN destroys every copy. Biometric unlock reads a second copy from a keystore item the OS releases only after a biometric check against the currently enrolled set (iOS `biometryCurrentSet`, Android Keystore with `enforceBiometrics`). The refresh token is sealed with the database key, so it is usable only after the app is unlocked. | Meets module 9's unlock and wrong-PIN rules. The biometric gate is enforced by the Secure Enclave or Keystore, not by app code; enrolling a new fingerprint invalidates the copy and the PIN still works. |
| D11 | SQLCipher comes from `package:sqlite3`'s build hook (`hooks.user_defines.sqlite3.source: sqlcipher`). | `sqlcipher_flutter_libs` is end-of-life. The hook build is the maintained path, and host tests then run against real SQLCipher, so "the file is unreadable without the key" is a test, not an assumption. |
| D12 | The **portal is a backend-for-frontend**: the browser holds only an encrypted, httpOnly session cookie (no PHI); server components and route handlers call the API with the user's token. Responses carry `Cache-Control: no-store`; patient search uses POST so names never reach URLs, history or access logs; page titles are generic. | Module 9 desktop column: nothing at rest in the browser, no PHI in titles, URLs or history. Internal patient UUIDs do appear in portal URLs so links and the back button work; they identify nothing without a signed-in session. |
| D13 | **Form definitions are data.** `packages/forms` holds the eight categories as typed definitions; they are seeded into `note_type_versions` as platform presets, and the phone downloads the team's versions at sync (bundling the presets for first-run offline). | "Changing an option is a data change, not an app release. Each note type is versioned." |
| D14 | GitHub Actions are **pinned by commit SHA**, Dependabot keeps them current, and every workflow runs with least-privilege `permissions`. | Supply-chain hygiene expected by health-department security questionnaires. |
| D15 | The phone's database is **plain SQL on SQLCipher** through `package:sqlite3`, one file per user and team, opened with the user's raw 256-bit key, `secure_delete` on, synchronous writes. No Drift, no code generation. | Earlier drafts said Drift. The sync engine decides whether records are lost (risk 3), so every statement that confirms or purges should be readable in review, not generated. Separate files per user and team make "locked to that user" structural and make a remote wipe a file deletion that needs no key. |
| D16 | A second offline edit to a field names the first (`follows`). The server accepts it when that change, by the same person, is what last wrote the field, or when its receipt left the field at the current version. | Without it, a person's own unconfirmed edit looks like someone else's value and their next edit conflicts with themselves. |
| D17 | A change the server holds in **quarantine** leaves the phone once the receipt's hash matches, and is listed as "sent to a Program Admin to review". | Module 9's "never dropped" rule exists so the worker can fix a rejection. A quarantined change is one the worker can't fix; the server already holds that exact value for the admin, which is the confirmed-receipt rule. |
| D18 | The clock check reads a **boot clock that counts deep sleep** through the app's own platform channel (Android `elapsedRealtime` and `BOOT_COUNT`, iOS `CLOCK_MONOTONIC` and `kern.bootsessionuuid`). The server time is taken at the middle of each sync request. | Dart's `Stopwatch` stops while the phone sleeps, so a phone left in a pocket would look like its clock drifted and charting would pause for no reason. The midpoint halves a slow network's error. |
| D19 | When a rejected create is fixed, the record's later edits (pending, or rejected only because the record didn't exist yet) are folded into the fixed create, and the server settles their rejections with it. | Edits travel in the same batch as their create, so one bad create would otherwise leave several rejections the worker can't fix one by one. |
| D20 | **Sign-out erases nothing unless every team database on the phone is known to be fully synced**, which needs the key in memory. A sign-out from the lock screen, or with any team's work waiting, keeps the PIN-wrapped key and the files. Only a remote wipe and the tenth wrong PIN (whose key is already gone) delete unsynced data. Kept data stays wipeable: on every lock, wrong PIN, sign-out and app start, and every 5 minutes while nobody is unlocked, the phone asks with each database's device key whether to wipe it, for every database on the phone, whoever it belongs to. Only an explicit wipe order deletes anything; a status the app doesn't know keeps the data, and "wiped" means the device ID is spent (the data stays and syncs under a new one). A wipe is written down before it starts and confirmed to the server whenever it can be, so one the app didn't finish completes later, and a file is never opened while its wipe is unfinished. | The review found four paths where a sign-out erased unsynced records: from the lock screen, after "Wait" when the app locked, and for a second team's database. Making the session the single place that decides, from the files on disk, closes all of them at once. The second review found that kept data then escaped remote wipe, which a lost phone must never do. |
| D21 | When the server confirms (by device key) that the user was removed, the phone **freezes the store** (no new change, audit entries included), uploads every unconfirmed change, and wipes only once the server holds each change ID with a matching hash. Every step re-checks that the same team is still open, and the wipe always targets the database the check started from. A team that dropped out of the person's profile gets the same hand-over at the next unlock. Activity log entries in a hand-over are written to the audit chain as the person's (they are nobody's to approve). A change the server refused as unreadable can't be handed over, so a file holding one is not wiped on removal: it stays, locked, until an administrator orders the wipe, and the person is told. A change already held for review is never applied by a later push from its phone; only the admin's decision puts it on the chart. Nobody decides on their own quarantined change, and a phone with a wipe order, or whose person has 5,000 items waiting from all their phones together, hands nothing more over. | A change saved during the upload would have been wiped unsent, and a team switch mid-check wiped the wrong team. A read that can't be logged is refused too: what can't be audited can't be shown. |
| D22 | Between checks, the clock status and change stamps are carried forward from the last server time on a clock that runs with the app, and suspended when it goes to the background. A server time whose round trip took over 30 seconds is not used. "Check again" asks the server for its time. | A clock that jumps while the app is open is caught at once instead of up to 20 seconds later, and a reply that trickles in on weak signal no longer pauses a phone whose clock is right. |

---

## 3. Regulations and standards, and where each is met

Full mapping in `docs/compliance/` (added in phase 0, extended each phase). I am not a lawyer; counsel confirms the legal items listed in section 7.

| Requirement | Where it is met |
|---|---|
| HIPAA §164.312(a) access control: unique user IDs, emergency access, automatic logoff, encryption | OIDC identities per person; per-team role + credential checks in the API on every call; 15-minute portal idle logoff, team-set phone auto-lock (default 5 min) and a 15-minute ceiling; SQLCipher on the phone, KMS on RDS and S3 |
| §164.312(b) audit controls | Hash-chained, append-only audit table; every new action writes its event in the same transaction; anchors in S3 Object Lock; admin audit dashboard with unusual-access flags |
| §164.312(c) integrity | Hash chain; SHA-256 receipts on every synced value and every photo; signed notes change only by addendum or correction, with the old value kept |
| §164.312(d) person or entity authentication | MFA by authenticator app or passkey, no SMS; device registration key for quarantine uploads; re-authentication before exports |
| §164.312(e) transmission security | TLS 1.2+ only; HSTS on the portal; S3 bucket policies deny non-TLS |
| HIPAA minimum necessary (§164.502(b)) | Team search index holds only identifying fields and allergies; Billing/Data never sees sensitive sections; sensitive exams need an extra permission |
| 42 CFR Part 2 (pending counsel) | Behavioral health, harm reduction and reproductive modules sit behind a `view_sensitive` permission so they can be restricted further without a schema change |
| HIPAA Security Rule risk analysis | Template in `docs/compliance/risk-analysis.md`; a person completes it before the pilot |
| WCAG 2.2 AA (target), 2.1 AA legal floor for ADA Title II and HHS §504 | Portal: semantic HTML, axe checks in CI on every page in all three themes, keyboard paths; phone: semantic labels, 48 px targets, text scaling to 200%, widget tests that assert semantics |
| ACA §1557 language access | Patient-facing outputs (ID link card text, EMS handoff PDF) go through a translation table; languages pending Brooke and Mercy |
| Information blocking / anti-lock-in | Full customer export (CSV and JSON) free and always available to Program Admins |
| CMS place of service 27 | Billing export writes POS 27 per encounter |
| OWASP ASVS L2 / MASVS L2 | CSP and security headers, no PHI in logs (logger accepts allowlisted keys only), screenshot blocking on Android and app-switcher hiding, root/jailbreak warning setting |

---

## 4. Phases

Each phase ends when its **Done when** line holds, proven by an automated test where one can be written. Phases follow the Build plan's numbering.

| Phase | Scope | Done when | Status |
|---|---|---|---|
| 0. Setup and guardrails | Monorepo; CI on every PR (secret scan, PHI guard, TS lint/typecheck/tests, migrations on a scratch DB, Flutter analyze/tests, portal accessibility, contract drift, infra synth, workflow lint); old secret-scan finding resolved; preview deploy workflow; seed script with made-up patients; Demo data only banner; design tokens into the Flutter theme and portal CSS | CI green on an empty phone app, portal and API; preview deploys from main once Supabase and Vercel secrets are set | **Done** (CI green; preview deploy waits on secrets) |
| 1. Foundation | Teams, memberships (one login, several teams), sign-in, roles and credentials, server-side permission checks, append-only audit log; role changes with a reason; credential upgrades that take effect only once the new credential's fields are filled in; portal sign-in, users and roles; phone sign-in, PIN or biometric lock, auto-lock | A Program Admin invites a user, upgrades a student to resident by entering the resident's fields and a reason, and both changes appear in the audit log (API integration test + portal flow) | **Done**: API test and full-stack Playwright test through the portal |
| 2. Offline data layer | Encrypted local DB, outbox, sync API with per-change receipts and hash match, field-level purge after confirmed receipt; Save & Close drafts with field reconciliation; rejections, Needs attention, quarantine; clock check; sync progress on logout; remote wipe and wrong-PIN wipe | Automated tests pass for charting in airplane mode, killing the app mid-sync, reconnecting on a slow network, a 7-minute clock offset, and two people editing the same draft | **Done**: each scenario runs against an in-memory server (`sync_scenarios_test.dart`) and against the real API and Postgres in CI (`live_api_test.dart`); charting screens arrive in phase 4, so these drive the local store directly. Admins see each phone's sync state, clock flag and unsynced work, wipe a lost phone, and review quarantine in the portal (`/team/devices`, `/team/quarantine`, Playwright + axe in three themes). An adversarial review found 27 real defects (eight could lose unsynced records); each is fixed with a regression test (D20–D22). A second review (security, and the fixes themselves) confirmed 21 more, mostly in remote wipe, quarantine review and audit attribution; all are fixed the same way |
| 3. Patients | Intake with consent; DOB rule (46 → 1946); living situation (Couch surfing, Other with text); Edit via the intake form with Update and save; admin-only legal name and DOB corrections with a reason; typo-tolerant search on server (pg_trgm, Double Metaphone) and phone (FTS5 trigram); route-scoped cache; duplicate warnings; merge queue with required comments; problem list (New, Ongoing, Resolved); ID links (opaque token, offline regeneration with handshake) | A made-up patient is found offline by a misspelled alias, edited, and flagged as a likely duplicate at intake | Planned |
| 4. Encounters | Forms from `packages/forms`, versioned note types; Medical or Non-Medical; several care types in one encounter; Quick encounter; Focused exam (16 systems, one-tap Normal); red flags and EMS handoff; Sexual and reproductive branching; sensitive sections by role; all Oct 19 field changes; Save & Close and Complete; 24-hour incomplete alert; signing, addenda, corrections, attestation queue, automatic recap; chart opens after Complete; referrals (date + free text) | A resident charts a medical, wound and social visit as one encounter offline, saves and closes it, completes it later, and an attending attests it | Planned |
| 5. Admin configuration | Note types, bundles (edit and remove), field-to-supply and condition-to-supply mappings, item catalog with dispensing unit, Orders categories (OTC, Rx, Labs, custom), two-tier flags, bag minimums | An admin adds a Labs item, a bundle and a secondary flag, and a phone sees all three after its next sync | Planned |
| 6. Orders, inventory, alerts | Shared bags and team stock; suggest then confirm; deduction from the route's bags; dispensing past the count allowed, count goes negative, Program Admin, Logistics and route lead alerted; allergy hard stop with a logged override; passive banners; push notifications with no patient details | Dispensing 3 of an item a bag holds 1 of leaves it at −2 and alerts all three roles, with nothing shown to the field user during the run | Planned |
| 7. Routes and runs | Route builder (team, lead, bags, patients ranked by both flag tiers); every stop starts Not yet; pre-visit contact by anyone on the route; lead confirms → route locks → bag check; change requests (add, drop, reorder); on-the-fly patients and locations attributed to the route; stop outcomes; post-run report (seen, added, Patients Not Seen, incomplete notes); follow-ups board | Logistics builds a route, the lead confirms it from the phone, the team runs it with one patient added on the fly and one not located, and Logistics reschedules from the report | Planned |
| 8. Photos and documents | In-app capture only, encrypted on the phone, chunked upload, purge only after a confirmed hash | Five wound photos taken offline upload after reconnecting and never appear in the camera roll | Planned |
| 9. QR IDs, check-ins, continuity queue | Scan an ID link, quick check-ins, the priority list that feeds route planning | Scanning a printed card opens the right chart after sign-in, and opens only a sign-in page for anyone else | Planned |
| 10. Billing, data export, grant reports | Billing export (ICD-10, CPT, NPI, POS 27; resident and NP notes held until attested; drafts excluded); full customer export (CSV, JSON); grant reports with counts only | A month of made-up encounters exports to the agreed format | Planned |
| 11. Preview review | Brooke and Mercy run the preview; accessibility pass (VoiceOver, TalkBack, axe, keyboard, 200% text); VPAT draft | Team sign-off and no blocking accessibility issue open | Needs people |
| 12. AWS production | Separate dev, staging, prod accounts; BAA in AWS Artifact; RDS, Cognito, S3 with Object Lock audit anchoring, ECS Fargate, KMS, CloudTrail, WAF; backups with a tested restore; store releases | The production stack passes the module 10 checklist and a restore from backup works | Code in this repo; deploy needs accounts |

### In every phase

- Every new action writes its audit event, in the same transaction. A test helper asserts the event for each new endpoint.
- No patient details in logs, crash reports, notifications or URLs. The API logger accepts allowlisted keys only; the PHI guard in CI fails the build on `console.*` in API code and on realistic-looking identifiers in fixtures.
- Accessibility checks on every new screen, in all three themes.
- Tests for the offline path of every new feature, not only the online one.

---

## 5. CI/CD

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | Every PR and push to `main` | Secret scan (gitleaks, full history); PHI guard; TypeScript lint, typecheck, unit tests; API integration tests and migrations against Postgres 16 and 17 service containers; Flutter format check, analyze, tests; phone sync scenarios against the real API (`tools/live-sync.sh`); portal build + Playwright/axe accessibility; contract drift (regenerate spec, TS types, Dart client; fail on diff); forms export drift; infra `cdk synth` with cdk-nag HIPAA checks; actionlint and shellcheck |
| `deploy-preview.yml` | Push to `main`, manual | Apply migrations to the Supabase preview DB, deploy the API Edge Function, deploy the portal and website. Skips with a notice until the secrets are configured |
| `security.yml` | Weekly, manual | Full-history gitleaks, CodeQL (JS/TS), `pnpm audit` (high and critical fail), OSV scan of `pubspec.lock` |
| `release-mobile.yml` | Manual | Signed Android and iOS builds; needs store accounts and signing secrets |
| `deploy-aws.yml` | Manual, protected environments | `cdk deploy` via GitHub OIDC to an AWS role per environment; production requires approval |

Dependabot covers npm, pub and GitHub Actions. Branch protection on `main` (required checks, one review) is a repository setting the owner applies; it is listed in the setup guide.

---

## 6. Defaults chosen for questions the plan leaves open

Each is a single configuration point or code path, so changing it later is small. Each is marked in code with `PLAN-OPEN:` and the question.

| Open question (plan) | Default built | Why this default |
|---|---|---|
| Does a note signed offline count as signed at device time or server receipt? (needed before phase 4) | Signature time = clock-corrected device time; server receipt time stored alongside; billing export uses the signature time | The clinical act happened at device time; the corrected time removes skew; both are kept so the answer can change without data loss |
| PA signing rule | PAs follow the NP rule (signed at once, held out of billing until attested) | The conservative choice for billing; flips per team |
| Credential fields required before an upgrade | Student: school, supervising physician. Resident: NPI, program, supervising attending. Attending, NP, PA: NPI, license number, license state | The proposed list in the Oct 19 decisions, pending Brooke and Mercy |
| Patients Not Seen edge cases | Complete run marks untouched stops Not reached and lists them; Other outcome with a reason, a reported death prompts a chart status review; Declined and Rescheduled stay off the list; matched duplicates or same-day visits by another team come off the list; 3 missed runs in a row raise the patient on the follow-ups board | The proposals in the Oct 19 "Still open" list |
| Do safer-use supplies and naloxone count as Non-Medical? | Item-level `medical` flag set by the admin; platform presets mark naloxone Medical and safer-use supplies Non-Medical | Lets each team match its standing orders |
| Clock check after a phone restarts offline (uptime resets, no reference) | Charting is not paused; times are stored as device time and flagged unverified until the next sync | The pause relies on a server reference; without one, pausing would block care on every offline reboot |
| Pricing (P22) | Not built; billing for Sineobex itself is out of scope for the MVP | Still open in the plan |
| A remote wipe for a phone that is never unlocked again | At the lock screen the phone asks with its device key and deletes the team's database file (no key needed). Handing unsynced work to quarantine needs the key, so it waits for an unlock | A lost phone may never be unlocked by its owner again; deleting what can't be read anyway is the safe default |
| Who is told when someone keeps the server's value in a conflict | The note's author, when the kept value came from someone other than the person choosing, and the author isn't the one choosing | The Oct 19 rule says "the note's author is told"; telling people about their own choices is noise |

---

## 7. What this repository cannot finish on its own

These need an account, a signature or a person. The code is written so each is configuration, not a rebuild.

- **Supabase preview project** and **Vercel projects**: create them and add `SUPABASE_*` and `VERCEL_*` secrets to GitHub (listed in `docs/setup.md`).
- **AWS**: accounts for dev, staging and prod; the BAA in AWS Artifact before any real patient data; the deploy role for GitHub OIDC.
- **Apple Developer Program and Google Play** accounts and signing keys.
- **Counsel**: 42 CFR Part 2, photo, document and audit-log retention, the customer BAA, company structure.
- **Brooke and Mercy**: credential field list, MSK region tests beyond the shoulder, languages for §1557, sign-off in phase 11.
- **Outside accessibility audit** and the VPAT, and the **HIPAA risk analysis** (template provided).

---

## 8. Risks and where I disagree with the plan

1. **The clock check can block care.** Module 9 pauses charting when the phone is more than 5 minutes off server time, while the same module says no rejection ever blocks charting the patient in front of you. With the reference built from last-sync time plus uptime, the pause only fires if someone changes the phone's clock, which is rare, but when it fires it stops a clinician mid-visit. I built the decided behaviour, plus the reboot exception in section 6. My recommendation is to switch to "correct and flag" (P17 as originally proposed) after the preview, once there is data on how often it fires.
2. **Two runtimes for one API.** Running the preview on Supabase Edge Functions (Deno) and production on Node means the Deno entry can break without the Node tests noticing. Mitigation: the core is runtime-neutral and CI type-checks the Deno entry. If the preview stays on Supabase for long, consider running the Node container there too.
3. **The sync engine is the product.** It decides whether clinical records are lost. It has the most tests in the repo, and the Dart engine is tested against both an in-memory fake and the real API in CI. Any change to it should get a second reviewer.
4. **PBKDF2 in pure Dart** (D10) uses 120,000 iterations so unlock stays under a second on older phones. That is below OWASP's 600,000 for PBKDF2-SHA256; it's acceptable only because the wrapped key never leaves the platform keystore. Measure on the pilot's actual phones and raise it, or move to the platform-accelerated KDF in `cryptography_flutter`, before real PHI.
5. **The phone's native code has no automated test yet.** The boot clock and the iOS backup exclusion live in `MainActivity.kt` and `AppDelegate.swift`. CI compiles the Android side; nothing builds the iOS side, because that needs a macOS runner. Before the pilot, add an iOS build job and a device test that the clock check survives sleep and a reboot.
6. **Server answers are trusted on TLS alone.** A wipe order, a removal answer or a receipt whose hash matches makes the phone delete data, and none of them is signed by the server. Anyone the phone trusts to terminate TLS (an MDM or corporate inspection root on iOS, where user CAs can't be excluded as on Android) could forge one. The review judged this hardening rather than a defect, and I agree it needs a trusted root on the phone. My recommendation: pin the API's public key on both platforms before real PHI (phase 12, once the production certificates exist), and consider signing the destructive answers with a key that ships in the app.
7. **The in-memory sync server mirrors the API's rules by hand.** It is what most engine tests run against. It now applies the API's create, field, audit and request-schema rules, and the live job runs rejections, fixes, keep-server choices and large numbers against the real API, but a rule added to the API and not to the fake would still go untested on the phone. Any change to `services/api/src/sync` should come with the same change in `apps/mobile/test/sync/fake_server.dart`.
8. **Scope.** Phases 1–10 are a large build for a small team. If time runs short, cut from the edges (grant report variants, follow-ups board filters), never from sync, audit or permissions.
