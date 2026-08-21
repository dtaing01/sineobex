# HIPAA: what the code does, and what it cannot do

Sineobex is built to record real street medicine encounters with real
patients. That makes the records **protected health information**, and the
organisation operating it a **covered entity or business associate** under
HIPAA.

This document is written to be useful rather than reassuring. It separates
three things that are easy to blur together:

1. Safeguards implemented in this repository.
2. Configuration the operator must complete before real PHI touches the system.
3. Obligations no software can satisfy on your behalf.

**Compliance is a property of an organisation, not of a codebase.** Nothing
here certifies anything. Have counsel and a qualified security assessor review
this deployment before it holds a single real record.

---

## 1. Implemented in this repository

### Access control — §164.312(a)(1)

| Control | Where |
|---|---|
| Unique user identification | Cognito user pool; every audit row carries the caller's `sub` |
| MFA required for all users | `infra/lib/auth-stack.ts` — `mfa: REQUIRED`, TOTP |
| No self-registration | `selfSignUpEnabled: false`; clinicians are provisioned by an admin |
| Role-based authorisation | Cognito groups `full-admin` / `standard` / `view-only`, checked in `lambda/shared/http.ts` |
| Team-level record isolation | Postgres row-level security, `migrations/002_row_level_security.sql` |
| Automatic logoff | 10-minute inactivity lock plus immediate lock on backgrounding, `SessionController` |
| Emergency access | Admin group retains full read across their agency's teams |
| Password policy | 14 characters, four character classes, `auth-stack.ts` |
| Short token lifetime | 60-minute access and ID tokens, 7-day refresh, revocation enabled |
| Bearer token on every request | `AuthInterceptor`, wired in `providers.dart`, with one refresh-and-retry on 401 |
| MFA challenge handled end to end | `SessionController.confirmMfa`; TOTP entry in `SignInScreen` |

The API connects to Postgres as `sineobex_api`, **not** as the master user.
This matters more than it looks: a superuser bypasses row-level security
entirely, so using the master credential for application queries would
silently disable every isolation policy while leaving them visibly present in
the schema.

The first draft of this system got that wrong — the role was created
`NOLOGIN` and the Lambdas connected as master, which made all three policies
inert. It is now enforced three ways rather than trusted: the role is created
`LOGIN NOBYPASSRLS NOSUPERUSER`, migration 002 raises an exception and aborts
if the role could ever bypass RLS, and the API's patient upsert carries an
explicit `team_id` check of its own so isolation does not rest on RLS alone.

### Verification of these controls

Claims in this section are asserted by tests rather than left as intent, and
those tests run on every pull request:

| Control | Where it is proven |
|---|---|
| RLS isolates teams; cross-team read and write both refused | `infra/test/10_rls.sql` |
| RLS fails closed when the actor is unset | `infra/test/10_rls.sql` |
| A deactivated member loses data access | `infra/test/10_rls.sql` |
| The API role cannot bypass RLS or delete | `infra/test/10_rls.sql`, migration 002 |
| Encounters and audit rows are immutable | `infra/test/20_integrity.sql` |
| The audit trigger fires without the application | `infra/test/20_integrity.sql` |
| Server clock cannot be overridden by a client | `infra/test/20_integrity.sql` |
| Scheduled jobs emit no patient identifiers | `infra/test/30_cron_queries.sql` |
| Auth failures never discard queued records | `app/test/sync_test.dart` |
| Demo data cannot ship in a default build | `.github/workflows/ci.yml` |

This is not a substitute for a risk analysis or a penetration test. It means
these specific controls cannot silently regress.

### Audit controls — §164.312(b)

Two independent layers, answering different questions:

- **Application audit** (`audit_log` table). Who opened which chart, who wrote
  which note. Written by database triggers on `patients` and `encounters`, so
  a handler that forgets to log cannot create a gap. A `DO INSTEAD NOTHING`
  rule makes the table append-only.
- **Infrastructure audit** (CloudTrail, multi-region, log-file validation on).
  Who changed a security group, who read a secret, who downloaded an
  attachment.

Actions taken offline are queued on the device and shipped on the next sync,
flagged `recorded_offline` so a reconstructed timeline shows that the
timestamp came from a device clock rather than the server's.

Archived audit records land in an S3 bucket with **Object Lock in compliance
mode**, retained 2,192 days (six years, per §164.316(b)(2)(i)). In compliance
mode nobody can shorten that or delete an object — not an administrator, not
the root account. That is the point.

### Integrity — §164.312(c)(1)

Encounters are append-only at three levels: the client never offers an edit
path, the sync handler uses `ON CONFLICT DO NOTHING`, and the table carries
`DO INSTEAD NOTHING` rules for `UPDATE` and `DELETE`. A correction is made by
writing a later encounter, never by rewriting an earlier one.

Patients are soft-deleted. The `sineobex_api` role has `DELETE` revoked on
every table.

### Transmission security — §164.312(e)(1)

- TLS 1.2+ everywhere; API Gateway does not accept plaintext.
- `rds.force_ssl=1` in the cluster parameter group: Postgres **rejects** an
  unencrypted connection rather than merely preferring encryption.
- `usesCleartextTraffic="false"` on Android; ATS enforced on iOS.
- Secrets Manager and KMS reached over VPC interface endpoints, so credential
  traffic stays on the AWS backbone.

### Encryption at rest — §164.312(a)(2)(iv)

- Aurora storage, S3 buckets, and Performance Insights all encrypted with a
  customer-managed KMS key, annual rotation.
- On device: SQLite via **SQLCipher**, key generated on first launch and held
  in the iOS Keychain / Android Keystore. The app refuses to start if
  `PRAGMA cipher_version` comes back empty — better to fail than to write a
  patient chart into a plaintext file.
- Android backup and device-to-device transfer are disabled entirely
  (`data_extraction_rules.xml`).
- Sign-out deletes the local rows **and** destroys the SQLCipher key, so any
  residual file blocks are unrecoverable ciphertext.
- That erasure is deliberately hard to trigger by accident. Only an explicitly
  rejected refresh token (`NotAuthorizedException`, `UserNotFoundException`,
  `UserNotConfirmedException`) signs the user out; a network failure keeps the
  session, because wiping the database on a dead-zone timeout would destroy
  unsynced field encounters.

### Minimum necessary — §164.502(b)

- Patient identifiers travel in request bodies, never in URL paths. An id in a
  URL lands in API Gateway access logs, CloudFront logs, and browser history —
  all retained far longer than the request.
- Access logs record the caller's `sub`, method, route, and status. Never a
  query string, never a body.
- `LOG_BODIES=false`; error responses return a request id, not the caught
  error, because a Postgres error can quote the offending row.
- Push notifications carry a subject id only. "Follow-up due: Jane Smith,
  prenatal" rendered on a lock screen in a shared van is a disclosure.
- The sync queue never discards a clinical record on an authentication
  failure. 401 and 403 are classified retryable precisely because the drain
  loop deletes permanent failures, and an expired session must not be able to
  erase an encounter that never reached the server.
- Not-found and not-authorised are deliberately indistinguishable on patient
  lookup: "this patient exists but isn't yours" is itself a disclosure.

### Scheduled jobs

cron-job.org is **not** a business associate and never needs to be: no job
sends or receives PHI. Requests are HMAC-signed over a timestamp, verified
with a constant-time comparison, and rejected outside a five-minute window.
Response saving is off. See `cron/README.md`.

### The web build

SQLCipher has no WebAssembly build. Rather than storing unencrypted patient
data in IndexedDB on a possibly-shared browser profile, the web target uses an
**in-memory** SQLite-on-WASM database: nothing is written to IndexedDB, OPFS,
or localStorage, and everything is gone when the tab closes. Web is the
secondary target and is deliberately the less capable one.

---

## 2. Operator configuration required before real PHI

These are not optional, and none of them can be done from this repository.

1. **Execute a Business Associate Addendum with AWS.** Every service used here
   is HIPAA-eligible, which means AWS *will* cover it under a BAA — not that
   it is covered. Until the BAA is signed, none of it is.
2. **Enable the BAA-covered account configuration** and confirm every service
   in use is in scope for your agreement.
3. **Restrict the account.** Enforce MFA on all IAM principals, remove root
   access keys, enable GuardDuty, Security Hub, and AWS Config with the HIPAA
   conformance pack.
4. **Subscribe on-call to the alarm topic** (`AlarmTopicArn` output). An
   unnoticed alarm is not a control.
5. **Set the real CORS origin** in `api-stack.ts` — it currently points at
   `app.sineobex.org` for prod and localhost for dev.
6. **Provision users properly.** One Cognito account per person. Shared
   logins destroy the audit trail's meaning, and the audit trail is the
   control everything else leans on.
7. **Configure the retention you actually need.** The six-year Object Lock
   default meets the federal floor; some states require longer, and Object
   Lock retention can be extended but never shortened.
8. **Review the log retention settings.** One year on CloudWatch is a cost
   trade-off, not a legal determination.
9. **Turn off the demo seed.** `SINEOBEX_DEMO_SEED` must be absent or false in
   any build that will hold real records. It defaults to false; keep it that
   way.
10. **Point `SINEOBEX_TILE_URL` at a tile server you control.** Left unset,
    the app fetches map tiles from a public CDN, which discloses approximate
    patient locations to a third party with no BAA. See `docs/SETUP.md` §6 and
    the map-tile entry in §4 below.
11. **Penetration test** before go-live, and after significant changes.

---

## 3. What no software can do for you

HIPAA's Administrative Safeguards (§164.308) are mostly about people:

- A designated Security Official and Privacy Official.
- A documented **risk analysis** and risk management plan — §164.308(a)(1)(ii).
  This is the single most-cited deficiency in OCR enforcement actions, and it
  is a document, not a feature.
- Workforce security: authorisation, clearance, and a **termination procedure**
  that actually disables the Cognito account the same day.
- Security awareness and training, with records.
- A sanction policy, applied.
- Incident response and **breach notification** procedures — 60 days to
  notify, and the clock does not wait for you to be ready.
- Contingency planning: data backup, disaster recovery, emergency mode
  operation, and periodic testing of all three.
- Business Associate Agreements with every downstream vendor touching PHI.
- Physical safeguards for the devices themselves. An encrypted phone left
  unlocked on a van seat is a physical control failure, not a software one.

The code in this repository supports these. It cannot substitute for them.

---

## 4. Known gaps in this deployment

Stated plainly rather than left for an assessor to find:

- **Map tiles are fetched from a third party, and that discloses patient
  location.** This is the most serious gap in this list, and it was mine to
  catch earlier than I did.

  `flutter_map` requests raster tiles for whatever viewport is on screen. On
  the patient detail screen that viewport is centred on a patient's recorded
  location, so the tile request itself — its `{z}/{x}/{y}` path, its source IP,
  its timing — reveals roughly where an identified individual is, to whoever
  serves it. The default endpoint is a public CARTO CDN. CARTO has not signed
  a BAA with you and has no obligation to protect that. Under §164.514(b)(2)
  geographic detail finer than a state is an identifier, so this is PHI, and
  routing it to an uncovered third party is an impermissible disclosure under
  §164.502 — reportable under §164.400 if it is ever examined seriously.

  Switching to `tile.openstreetmap.org` does **not** resolve it. The OSMF tile
  servers are equally a third party receiving the same coordinates, and their
  tile usage policy does not permit an application of this kind regardless.

  The resolution is to serve OpenStreetMap tiles from infrastructure inside
  your BAA-covered account and point `SINEOBEX_TILE_URL` at it. The app now
  reads that endpoint from build configuration (`AppConfig.tileUrlTemplate`),
  so no code change is needed — but the default is still the third-party CDN,
  and **that default must not be shipped to clinicians handling real
  patients.** `docs/SETUP.md` §6 has the options and the migration path.

  Until that is done, treat map display as a demonstration feature.
- **Attachment upload is scaffolded, not finished.** The presign route exists
  and the bucket is configured; the client-side capture flow is not built.
- **Notification delivery is queued, not sent.** `notification_queue` is
  populated by the cron jobs; no push provider is wired to drain it.
- **No automated key-compromise response.** Rotating the KMS CMK is manual.
- **No break-glass audit alerting.** Anomalous access patterns land in the
  audit log but nothing watches it. A CloudWatch metric filter on
  `listPatients` volume per actor would be the obvious first control.
- **RLS is enforced on `patients`, `patient_locations`, and `encounters`
  only.** Inventory and reference data are not patient-identifying, but if
  inventory ever gains per-patient attribution, it needs a policy too.
- **The Android and iOS builds compile, but have never been run.** CI builds
  both on every pull request, so the app is known to compile and link — which
  it did not until `547d1ec`, where a dependency conflict that had made both
  platforms unbuildable since the initial port was found and fixed by exactly
  these jobs.

  Compiling is not working. Nothing here has been exercised on a physical
  device, and the parts most likely to fail there are the parts that matter
  most: SQLCipher opening an encrypted database against the real Keychain and
  Android Keystore, biometric unlock, GPS capture, and behaviour on a genuinely
  intermittent connection. **All of that must be tested on real hardware before
  any clinical use.**
- **The `sineobex_api` password is not on an automatic rotation schedule.**
  The master credential rotates every 30 days; the application role's password
  is set by migration 002 and must be rotated by re-running that migration with
  a new value. The Lambdas detect a rotated password (SQLSTATE 28P01/28000),
  rebuild their connection pool, and retry once, so rotation does not require a
  deploy — but scheduling it is currently a manual task.
- ~~**No SQL-level test coverage.**~~ **Closed.** `infra/test/` applies all
  three migrations from scratch against a real PostgreSQL 16 + PostGIS and
  asserts 41 properties, including that row-level security isolates teams and
  fails closed when no actor is set, that encounters and audit rows cannot be
  removed, and that every scheduled-job query executes and is idempotent. It
  runs on every pull request (`.github/workflows/ci.yml`) and locally via
  `infra/test/run.sh`. The four SQL bugs that originally motivated this entry
  are now covered by regression assertions.
