# HIPAA Security Rule: technical safeguards mapped to code

Sineobex is a business associate of each customer team. This page maps the Security Rule's technical safeguards (45 CFR §164.312) and the parts of the administrative and physical safeguards that software can support to where they are implemented. It is evidence for the risk analysis and for procurement questionnaires, not a legal opinion; counsel confirms the open items.

Status: **Done** = implemented and tested in this repository. **Partial** = implemented with a stated gap. **Planned** = phase named. **People** = needs a person, a contract or an account.

## §164.312 Technical safeguards

| Standard | Requirement | Implementation | Status |
|---|---|---|---|
| (a)(1) Access control | Allow access only to authorized persons | Every API call verifies an OIDC token, resolves the user's active team membership, and checks role permission and clinical credential before touching data (`services/api/src/auth/`). Row-level security on team-scoped tables is a second line (`db/migrations/`). | **Done** (phase 1; API tests and portal e2e) |
| (a)(2)(i) Unique user identification | Required | One identity per person in the OIDC provider (Supabase Auth, then Cognito), bound to the user row at invite by subject, never matched by email; no shared logins; owner registry in `platform_owners`. | **Done** (phase 1) |
| (a)(2)(ii) Emergency access procedure | Required | Platform owners can appoint a replacement Program Admin; procedure in the access policy. | People |
| (a)(2)(iii) Automatic logoff | Addressable | Portal: 15-minute idle sign-out with a warning and a way to stay signed in (`apps/portal/src/proxy.ts`, `IdleWarning`). Phone: auto-lock after 5 idle minutes (team-settable, capped at 15) and after 30 seconds in the background; the app switcher shows a cover (`lib/security/idle_lock.dart`). | **Done** (phase 1) |
| (a)(2)(iv) Encryption and decryption | Addressable | Phone: SQLCipher (AES-256) with a random per-user key wrapped by the PIN and held in the platform keystore (this device only); opening refuses to run without SQLCipher; deleted values are overwritten (`secure_delete`); database files are kept out of device backups (`apps/mobile/lib/sync/local_db.dart`, tests read the file and expect no readable text). Server: RDS and S3 encrypted with KMS. Portal: no PHI at rest. | Partial: phone done (phase 2); server in phase 12 |
| (b) Audit controls | Required | Hash-chained, append-only audit table written in the same transaction as each action (`db/migrations/0003_audit.sql`); refusals are logged too; search and tamper check in the portal. Anchoring to S3 Object Lock and CloudTrail come in phase 12. | Partial: chain, search and verification done; anchoring in phase 12 |
| (c)(1) Integrity | Protect from improper alteration or destruction | Every synced value is confirmed by SHA-256 of its canonical JSON before the phone deletes it; a field that holds a different value is never overwritten silently (conflicts are shown side by side, and every accepted value is kept in `field_history` with the one it replaced and who approved it). Signed notes refuse changes; addenda and corrections in phase 4; photos in phase 8. | Partial: sync done (phase 2) |
| (c)(2) Mechanism to authenticate ePHI | Addressable | Hash chain verification (`sineobex.verify_audit_chain`, tests tamper with rows and expect detection); per-change receipt hashes on sync, computed by the server from what it stored and compared on the phone (`services/api/src/sync/apply.ts`, `apps/mobile/lib/sync/sync_engine.dart`; shared test vectors). | **Done** (phases 1–2) |
| (d) Person or entity authentication | Required | MFA by authenticator app (TOTP, no SMS) for everyone: the API refuses team data without an aal2 token. Admin actions need a sign-in within 15 minutes (step-up in the portal). Each phone registers an Ed25519 key per team; wipe checks, wipe confirmations and quarantine uploads are signed with it and verified by the API (`services/api/src/sync/devices.ts`). | **Done** (phases 1–2) |
| (e)(1) Transmission security | Guard against unauthorized access in transit | TLS only. API sends HSTS; Android forbids cleartext and user-installed CAs; S3 policies deny non-TLS. | Partial: API headers and Android config done (phase 0); S3 in phase 12 |
| (e)(2)(ii) Encryption in transit | Addressable | As above. | Partial |

## Supporting controls (§164.308, §164.310)

| Requirement | Implementation | Status |
|---|---|---|
| §164.308(a)(1)(ii)(A) Risk analysis | Template in `risk-analysis.md` | People |
| §164.308(a)(1)(ii)(D) Information system activity review | Audit dashboard with unusual-access flags (charts off-route, bulk exports, off-hours, search bursts). Reads and searches made offline join the audit chain at sync with their device time, as the person's, even when they arrive in a removed person's hand-over (phase 2). Opening the quarantine queue logs each item shown with its patient | Partial |
| §164.308(a)(3) Workforce security, termination | Removing a user rejects their existing tokens at the API at once (every request re-checks membership) and disables their provider identity. At next contact their phone proves itself with its device key, hands unsynced work to quarantine for a Program Admin, and wipes the team's data | **Done** (phases 1–2) |
| §164.308(a)(4) Information access management | Roles per team from a fixed permission catalog, custom roles only from existing permissions, Program Admins appointed only by owners, Billing/Data view-only, row-level security as a second line | **Done** (phase 1) |
| §164.308(a)(5)(ii)(C) Log-in monitoring | `session.started` audit event the first time a provider session reaches the API; the provider logs failures | **Done** (phase 1) |
| §164.308(a)(7) Contingency plan, data backup | RDS automated backups with a tested restore (phase 12 done-when) | Planned, phase 12 |
| §164.310(d)(1) Device and media controls | Remote wipe by a Program Admin (with the phone's unsynced counts shown first), acted on at the phone's next contact, even at the lock screen; 10 wrong PINs destroy the key and the database files; no backups of app data (Android `allowBackup=false` and data extraction rules, iOS `isExcludedFromBackup`); admin device list with sync status, clock flag and open rejections | **Done** (phases 0–2); the iOS side has no automated test until an iOS CI build exists |
| §164.314 Business associate contracts | AWS BAA before real data; click-through BAA per customer organization; custom BAAs recorded by owners | People |

## Privacy Rule touchpoints

| Requirement | Implementation | Status |
|---|---|---|
| §164.502(b) Minimum necessary | Server copies of records on the phone expire 24 hours after download; local work is purged field by field once confirmed and closed (phase 2). Phone search index holds identifying fields and allergies only (phase 3) | Partial: phase 2 done |
| §164.526 Right to amend | Patient amendment requests use the correction path with request and decision logged | Planned, phase 4 |
| §164.528 Accounting of disclosures | Exports are logged with who, what and when | Planned, phase 10 |

## Not HIPAA, but in the same evidence pack

- **42 CFR Part 2:** substance use treatment records may need stricter handling. Sensitive modules sit behind a separate permission. Counsel decides whether Part 2 applies.
- **WCAG 2.2 AA / ADA Title II / HHS §504:** see `accessibility.md`.
