> Draft plan (Nov 14), written before phase 4 was built. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 12: AWS production
**Status:** no unit has started (units are in section 13). Nothing here can be finished without accounts and people; section 1 says which part is which. PRD lines are from the saved main tab (`main`) and Build plan tab (`build`); "plan" is `IMPLEMENTATION_PLAN.md`.

## 1. Scope and Done when
**Done when** (Build plan 134; plan section 4, row 12): the production stack passes the module 10 checklist (section 10.1) and a restore from backup works (section 10.2).

### 1.1 In scope, and what kind of work each is
| Item | PRD | Code in this repository | Needs an account, a signature or a person |
|---|---|---|---|
| BAA before any real patient data | main 684, 688; build 131, 145 | A deploy gate: production deploys refuse until a dated BAA record is committed (5.4) | A person accepts the BAA in AWS Artifact, for the organization |
| Dev, staging, prod in separate accounts; no real PHI outside prod | main 689 | One stack definition, three environment specs; dev and staging databases are marked demo | Create the accounts; IAM Identity Center for the people who run them (main 691) |
| RDS PostgreSQL, KMS at rest | main 690, 701, 638 | Infra code, policy checks | — |
| S3 for photos; S3 Object Lock for audit anchors | main 630, 690, 705 | Infra code; the anchoring job (D7 names it, nothing runs it yet) | Counsel: retention period (main 643) |
| Cognito for app users, MFA | main 691, 639 | Cognito adapters for the API, the phone and the portal; pool settings in infra | — |
| API on ECS Fargate, load balancer, WAF | main 702, 703; build 131 | Dockerfiles, infra code, WAF rules that let sync through | Domain and DNS (build 150) |
| CloudTrail for the AWS layer, incl. S3 data events | main 623, 692 | Infra code | — |
| TLS for all traffic | main 638, 599 | Listener policy, bucket policies, DB TLS, phone certificate pins (plan risk 6) | — |
| Backups and a tested restore before the pilot | main 694 | Backup settings, `tools/restore-drill.sh`, `db verify` | A person runs the drill in production and signs the report |
| Risk analysis before the pilot | main 642 | Evidence files the template points to | The security official completes and signs it |
| Store releases | build 133 | `release-mobile.yml`, an iOS build job (plan risk 5) | Apple and Google accounts, signing keys, store listings |
| Bottom-up cost check | main 695, 697 | `infra/README.md` lists each line of main 699–711 with the resource that makes it | A person checks each line in the AWS Pricing Calculator |

### 1.2 Out of scope
| Item | Taken by |
|---|---|
| The admin audit dashboard and unusual-access flags (main 634) | An earlier phase's portal work (`/audit` exists today); the flags are not built: see 11.2 |
| Photo upload, blob store interface, S3 client (main 573, 608) | Phase 8 (its cards 0.8 and 2.10); this phase only gives it a bucket |
| Retention deletion jobs for photos and documents | After counsel answers (phase 8 design, line 24); this phase sets no expiry on patient data |
| Amazon Location Service resources (main 693) | Phase 7 names what it needs; one infra card adds it then |
| Emailing the anchor to a platform inbox (main 631, optional secondary copy) | Not built; S3 is the anchor |
| Malware scanning of desktop uploads (phase 8 design, line 29) | V2; listed as a risk (12) |
| Cognito Plus tier threat protection, SMS MFA, Business Support (main 691, 713) | Not bought for the pilot |
| Signing destructive server answers (plan risk 6, second half) | V2; pins land here |
| Migrating preview data | Never: production starts on a fresh database (main 686) |

## 2. Ground truth
### 2.1 What the code has today
| Fact | Where |
|---|---|
| There is **no `infra/` directory**. `pnpm-workspace.yaml` line 7 lists `infra`, and plan section 5 describes an infra synth job, `deploy-aws.yml` and `release-mobile.yml`; **none of them exists** (`.github/workflows` holds `ci.yml`, `deploy-preview.yml`, `security.yml`; `tools/ci-local.sh` has no infra step). The plan's CI table is ahead of the code; this phase makes it true. (The Build plan's layout says `infra/` is "added in phase 13", build 43: read as a numbering slip.) | `ls`, `grep -i "infra\|cdk"` |
| The Node entry point already handles SIGTERM for ECS. | `services/api/src/entry/node.ts` |
| The API refuses to start when `APP_ENV` and the database's mark disagree; demo kinds are `local`, `test`, `preview`. The mark is write-once with five allowed values. | `services/api/src/entry/bootstrap.ts`, `config.ts`, `db/migrations/0001_base.sql` 50–69 |
| `MFA_MODE=pool` exists for Cognito. `IDENTITY_ADMIN` allows only `supabase` and `memory`. | `services/api/src/config.ts`, `auth/context.ts` 142 |
| The identity admin interface has three calls: `inviteOrFind`, `disable`, `enable`. | `services/api/src/auth/identity-admin.ts` 14–19 |
| The token verifier checks `audience` with JWKS. Cognito access tokens carry `client_id`, not `aud`; this is not handled (not verified by a test here). | `services/api/src/auth/verifier.ts` 72–110 |
| The phone's `AuthProvider` is password, then MFA code, then refresh; there are `dev` and `supabase` providers. A pilot or production build refuses the dev provider. | `apps/mobile/lib/auth/auth_provider.dart` 48–53, `lib/config/env.dart` |
| The portal has `dev` and `supabase` sign-in adapters. | `apps/portal/src/lib/auth/` |
| `audit_anchors` (chain_key, seq, hash, store, object_key, anchored_at) exists, append-only, with row-level security. **No code writes to it.** `verify_audit_chain(chain_key)` exists. | `db/migrations/0003_audit.sql` 59–71, 160, 207–210 |
| `POST /v1/team/audit/verify` (`team.view_audit`) walks the chain and writes `audit.verified`. | `services/api/src/routes/audit-log.ts` 73, 166–178 |
| `/v1/health` pings the database and returns the release. The logger writes allowlisted keys only (`deviceId` is one). | `services/api/src/routes/system.ts` 25–54, `lib/log.ts` |
| Android forbids cleartext and user CAs; there is no pin set. | `apps/mobile/android/app/src/main/res/xml/network_security_config.xml` |
| The `db` CLI has `migrate`, `seed`, `grant-api`, `add-owner`. | `db/src/cli.ts` 31–57 |
| `encounters_patient_fk` is NOT VALID, to be validated on the fresh RDS database. | `docs/design/phase-3-patients.md` 2222 |
| The risk analysis and the safeguard mapping name phase 12 for S3 TLS policy, backups and the token-encryption decision. | `docs/compliance/risk-analysis.md` rows 6, 7, 15; `hipaa-security-rule.md` |
| Migrations run to 0016; phase 4 reserves 0017–0021. | `db/migrations/` |

### 2.2 What earlier phases must have delivered first
| Phase | Thing | Used here for |
|---|---|---|
| 8 | `BlobStore` interface and `Deps.blobs`; the S3-API store with SigV4 (`services/api/src/blobs/s3.ts`) | The anchor store reuses the signer; the photo bucket is its target |
| 8 | Chunked upload routes and their size limits | The WAF body-size exceptions (5.5) list these paths |
| 4–10 | Every migration through phase 10 | The fresh RDS database gets them all in one run |
| 7 | The list of Amazon Location resources, if maps were built | One infra card |
| 10 | Export re-authentication | Checked in staging with Cognito's `auth_time` |
| 11 | Team sign-off on the preview | Nothing is deployed for real users before it |

Infra units U3 and U4 depend on none of these and can be built and synthesized now. Deploying needs accounts.

## 3. The design in one page
1. **Infrastructure is AWS CDK in TypeScript, one app, one stack set, three environment specs.** The plan already names `cdk synth` with cdk-nag (plan section 5) and the workspace already lists `infra`; a spec is data, so staging differs from production by a reviewed file, not by code.
2. **Policy is checked on the synthesized template, by small pure functions, and fails the build.** cdk-nag's HIPAA pack plus our own checks (5.5); nothing that the checklist can prove at synth time is left to a person's eyes.
3. **Dev and staging databases are marked `preview`; production is marked `production`.** The existing firewall (`bootstrap.ts`) already keeps demo and real apart, so "no real PHI outside production" (main 689) needs no new environment kind and no change to a write-once table.
4. **A fourth, management account holds only the organization, IAM Identity Center and the organization's CloudTrail.** Identity Center (main 691) needs an organization, and a trail that production admins can't alter must live outside production.
5. **The anchor is one manifest per rotation, holding every chain head, chained to the previous manifest, written with Object Lock in compliance mode.** That is the team's rotating key (main 627) built the recommended way (main 629–630): `periodKey = SHA-256(previous periodKey ‖ this period's heads)`.
6. **The anchoring job is a pure function plus two thin edges** (read heads, put object), run every 12 hours as a scheduled Fargate task from the API image. Same code, same tests, no second runtime.
7. **Cognito is used through its API, not its hosted pages.** The phone and portal keep their own sign-in screens (D6); password sign-in over pinned TLS, TOTP required at the pool, no SMS (main 691, plan section 3).
8. **The phone pins the certificate authority roots, not the leaf.** AWS-managed certificates change keys at renewal; pinning the roots still shuts out an inspection root (plan risk 6) and can't strand phones at a renewal. A failed pin stops sync and deletes nothing.
9. **The WAF never sees a rejection as a reason to drop work.** Rate rules start in count mode; a block is an ordinary failed request to the phone, which backs off and keeps everything (D24, D42).
10. **Every claim in the checklist has evidence a script produced.** `tools/prod-checklist.mjs` and `tools/restore-drill.sh` write JSON reports with IDs, counts and hashes; the risk analysis cites the files.

## 4. Data model
One new table. No new column on an existing table. No new synced entity.

### 4.1 `sineobex.audit_anchor_runs` (append-only), migration "the next free number", `<n>_audit_anchor_runs.sql`
| Column | Type | Meaning | Constraint |
|---|---|---|---|
| `id` | bigint identity | Run number | primary key |
| `run_at` | timestamptz | Server time the heads were read | not null |
| `store` | text | `s3` or `memory` | not null |
| `object_key` | text | Where the manifest is | not null, unique |
| `document_sha256` | bytea | SHA-256 of the manifest bytes | not null, 32 bytes |
| `prev_run_id` | bigint | The run before | references this table; null only for the first run |
| `period_key` | bytea | `SHA-256(prev period_key ‖ document_sha256)`; the first run uses 32 zero bytes | not null, 32 bytes |
| `chain_count` | integer | Chains in the manifest | not null, ≥ 0 |
| `retain_until` | timestamptz | The Object Lock date asked for | not null, > `run_at` |

- Append-only: the same `forbid_mutation` trigger `audit_anchors` uses (`0003_audit.sql` 70–71); `revoke update, delete, truncate` from `sineobex_app`.
- Row-level security, copied from `audit_anchors` (0003, 207–210) but with no team column: `using (sineobex.is_platform_scope()) with check (sineobex.is_platform_scope())`.
- `audit_anchors` gets no new column: its `object_key` already joins to a run. The migration adds an index on `audit_anchors (object_key)`.
- Level X (audit tables, a policy, a trigger).

### 4.2 The manifest (an S3 object, not a table)
Canonical JSON (the existing rules in `services/api/src/sync/canonical.ts`), UTF-8, one object:

`{"v":1,"runAt":"2027-01-05T12:00:00.000Z","environment":"production","prev":{"objectKey":"anchors/v1/2027/01/05/20270105T000000Z-9f2c….json","documentSha256":"<hex>","periodKey":"<hex>"},"chains":[{"chainKey":"<uuid>","seq":1042,"hash":"<hex>"}]}`

`chains` is sorted by `chainKey`. It holds team IDs, counts and hashes: no patient details, no user IDs. `prev` is `null` in the first manifest.

### 4.3 Infrastructure data shapes (TypeScript, in `infra/lib/spec.ts`)
`EnvSpec` is the one record that differs between accounts. Every field is required, so a missing answer fails type-checking.

| Field | dev | staging | prod | PRD |
|---|---|---|---|---|
| `name`, `appEnv` | `dev`, `preview` | `staging`, `preview` | `prod`, `production` | main 689 |
| `db.instance`, `multiAz`, `storageGb` | t4g.micro, false, 20 | t4g.small, false, 20 | t4g.medium, true, 50 | main 701, 709, 710 |
| `db.backupDays`, `deletionProtection` | 1, false | 7, false | 35, true | main 694 |
| `api.tasks`, `portal.tasks` | 1, 1 | 1, 1 | 2, 2 | main 702 |
| `schedule.offHours` (scale to zero nights and weekends) | true | true | false | main 709 |
| `anchor.lockMode`, `retentionDays`, `intervalHours` | governance, 1, 12 | governance, 1, 12 | compliance, 2192, 12 | main 627, 630, 643 |
| `logs.hotDays` | 7 | 30 | 30 | main 708 |
| `waf.rateMode` | count | block | count, then block (5.5) | main 703 |
| `baaRecord` | none | none | required | main 688 |

## 5. Rules
### 5.1 Anchoring: states and transitions
A chain is in one of five states against its latest anchor. `anchorVerdict` decides.

| State | Meaning | Who sees it | What follows |
|---|---|---|---|
| `current` | Head equals the anchor | `team.view_audit` | Nothing |
| `ahead` | Head is past the anchor and the row at the anchor's seq still has the anchor's hash | `team.view_audit` | Normal between runs |
| `behind` | Head seq is lower than the anchor's seq | `team.view_audit`, owners | The database was restored to an earlier time (10.2) or rows were removed. An incident, never silent |
| `diverged` | A row at or before the anchor's seq has a different hash | `team.view_audit`, owners | Tampering or corruption. An incident |
| `none` | No anchor yet | `team.view_audit` | Normal for a team's first 12 hours |

The job's run, in order. Each step is safe to repeat.

| Step | Does | On failure |
|---|---|---|
| 1 | Read `audit_chain_heads` and the last run, in one snapshot, in platform scope | Exit non-zero; the alarm fires after two missed runs |
| 2 | `anchorDue`; if not due, exit 0 | — |
| 3 | `buildAnchorDocument`; `anchorObjectKey` | — |
| 4 | Put the object with `retain_until` and the lock mode; read it back; compare SHA-256 | Exit non-zero. Nothing was written to the database |
| 5 | One transaction: insert the run, insert `audit_anchors` rows (`on conflict (chain_key, seq) do nothing`), append `audit.anchor_run` | Exit non-zero. The object exists with no row; the next run writes a new manifest whose `prev` is the last **recorded** run, and the orphan is listed by the checklist |

Who may do what: the job runs as the platform (no person). Reading anchor status needs `team.view_audit` (existing key). Nobody can change or delete an anchor, by trigger, grant and Object Lock.

### 5.2 Pure functions, pinned by shared vectors
| Function | Language and file | Input → output | Vector file (`packages/contract/test-vectors/`) |
|---|---|---|---|
| `anchorDue` | TS, `services/api/src/audit/anchor-rules.ts` | `{now, lastRunAt \| null, intervalHours, headsChanged}` → `boolean` (true when never run, or interval passed and any head moved; also true every 24 h with no change, so a silent day is still on record) | `anchor.json` |
| `buildAnchorDocument` | TS, same file | `{runAt, environment, prev \| null, heads[]}` → `{bytes, sha256, periodKey}` | `anchor.json` |
| `anchorObjectKey` | TS, same file | `{runAt, sha256}` → `anchors/v1/YYYY/MM/DD/<basic ISO>-<first 16 hex>.json` | `anchor.json` |
| `retainUntil` | TS, same file | `{runAt, retentionDays}` → instant | `anchor.json` |
| `anchorVerdict` | TS, same file | `{anchorSeq, anchorHash, rowHashAtAnchorSeq \| null, headSeq} \| null` → one of the five states | `anchor.json` |
| `verifyManifestChain` | TS, same file (used by the drill and the checklist) | `manifests[]` in order → `{ok, firstBadIndex, problem}` | `anchor.json` |
| `deploymentAllowed` | TS, `services/api/src/config-rules.ts`; Dart, `apps/mobile/lib/config/deployment_rules.dart` | `{env, authKind, apiUrl, hasPins}` → `{ok, reason}` (5.3) | `deployment-rules.json` |
| `pinMatches` | Dart, `apps/mobile/lib/security/tls_pins.dart`; TS, `tools/tls-pins.mjs` (generates and checks the pin list) | `{chainSpkiSha256[], pins[]}` → `boolean` (true when any certificate in the presented chain matches any pin) | `tls-pins.json` |
| `wafBodyExempt` | TS, `infra/lib/waf-paths.ts` | `{method, path}` → `boolean` | `waf-paths.json` (TS only; also read by the staging smoke test) |
| policy checks (5.5) | TS, `infra/policy/*.ts` | synthesized template → `Finding[]` | fixtures in `infra/test/fixtures/` |

Only `deploymentAllowed` and `pinMatches` exist in both languages; this phase adds little phone logic.

### 5.3 `deploymentAllowed`: which builds may talk to which stack
| env | authKind | apiUrl | hasPins | Result |
|---|---|---|---|---|
| `local` | any | any | any | ok |
| `preview` | `supabase` or `cognito` | https | any | ok |
| `pilot`, `production` | `cognito` | https, host on the pinned list | true | ok |
| `pilot`, `production` | anything else, or http, or no pins | | | refused, with the reason; the app shows a start-up error and opens no store |

The API side: `IDENTITY_ADMIN=cognito` and `MFA_MODE=pool` are required when `APP_ENV` is `pilot` or `production`; `supabase` is refused there (a preview provider must not hold real staff). Added to the `superRefine` in `config.ts`.

### 5.4 Deploy gates
| Gate | Rule | Held by |
|---|---|---|
| BAA | `infra/config/prod.ts` names `docs/compliance/evidence/baa.json` (`{acceptedOn, acceptedBy (role, not a name), artifactAgreement, accounts[]}`); synth for prod fails when the file is missing or lists fewer accounts than the spec | `checkBaaRecord` |
| Demo firewall | The migration task for dev and staging passes `--environment preview`; for prod `--environment production`. The API then refuses a mismatched database (existing) | `bootstrap.ts` |
| Approval | The GitHub `production` environment requires a reviewer (`docs/setup.md` section 1) | Repository setting |
| Same commit | Production deploys only an image digest that staging ran and whose commit passed CI | `deploy-aws.yml` |
| Migrations first | The service is updated only after the migration task exits 0 | `deploy-aws.yml` |

### 5.5 Policy checks (each a pure function over the template; each has a passing and a failing fixture)
| Check | Fails when | PRD |
|---|---|---|
| `checkEligibleServices` | A resource type is not in `infra/policy/eligible-services.json` (the HIPAA-eligible list, kept by hand, dated) | main 684 |
| `checkEncryptionAtRest` | RDS, any bucket, log group, secret or ECR repository lacks a customer KMS key | main 638 |
| `checkBucketsPrivateTlsOnly` | A bucket lacks block-public-access, versioning, or a policy denying non-TLS | main 638; plan section 3 (e) |
| `checkAnchorBucket` | The anchor bucket lacks Object Lock, or prod is not `COMPLIANCE`, or a lifecycle rule expires objects | main 630 |
| `checkDatabase` | RDS is public, not encrypted, `rds.force_ssl` off, backups under the spec, prod not Multi-AZ or without deletion protection | main 694, 701 |
| `checkTlsPolicy` | A listener allows below TLS 1.2 or serves plain HTTP except a redirect | main 599, 638 |
| `checkCognitoPool` | MFA not `ON`, SMS MFA enabled, self sign-up on, tier not Essentials, password policy under the spec | main 639, 691 |
| `checkTrail` | No multi-region trail with log-file validation, or no data events on the photo and anchor buckets | main 623, 692 |
| `checkNoSecretsInEnv` | A task definition has a plain environment variable whose name ends `_URL`, `_KEY`, `_SECRET`, `_PASSWORD` with a credential in it; secrets must come from Secrets Manager | main 640 |
| `checkWaf` | The ALB has no web ACL; logging does not redact `authorization` and `cookie`; the body-size rule is not scoped by `wafBodyExempt` | main 703 |
| `checkLogRetention` | A log group has no retention, or an S3 log bucket expires before `logs.archiveDays` | main 643, 708 |
| `checkBaaRecord` | 5.4 | main 688 |

WAF rules: AWS managed common, known-bad-inputs and IP-reputation groups; the common group's body-size rule is excluded for `POST /v1/sync/*` and phase 8's upload paths (a sync batch and a photo chunk are larger than 8 KB); a rate rule per IP (2,000 requests per 5 minutes) and one keyed on the `authorization` header (600 per 5 minutes). Rate rules run in count mode in production for the first 14 days of the pilot, then block if no field phone would have been blocked.

## 6. Sync
**No new synced record type and no new field.** Nothing a phone makes in this phase needs the change protocol. What changes around sync:

| Topic | Rule | Mirrored in the phone test server |
|---|---|---|
| A WAF block (403 with an HTML body) or rate limit (429) on a push, pull or hand-over | An ordinary failed request: back off, resend, drop nothing, purge nothing (main 547–550, D24) | Yes: `fake_server.dart` gains two fault modes, `edgeBlocked` and `edgeRateLimited`; scenario tests assert the outbox is unchanged and the next sync confirms everything |
| The load balancer drops a connection at 60 s idle | Already covered by D24's time budget (20 s plus body time); the ALB idle timeout is set to 120 s so the phone's own timeout always fires first | No change |
| A deploy replaces API tasks mid-batch | `node.ts` finishes in-flight requests for up to 20 s; the ALB deregistration delay is 30 s; an unanswered batch is resent and change IDs make it idempotent (main 548) | Existing "connection lost mid-batch" scenario |
| A restore loses receipts the phone already acted on | See risk 1 (section 12). No protocol change in this phase | — |
| A failed certificate pin | The request fails before any byte is sent. Sync shows "Can't reach Sineobex securely. Update the app, or try another network." Nothing is deleted; wipe checks also fail closed (no wipe without an answer) | No (the fake has no TLS); a unit test on the HTTP client factory |

What a phone must hold: the pin list and the allowed host, both compiled into the build (`--dart-define` for the host; pins from `tls-pins.json` at build time). They never leave the phone and hold nothing about patients. A new pin list reaches phones only through an app update, so each list carries every root AWS's certificates chain to plus one spare; `tools/tls-pins.mjs` fails the release build when the live chain matches fewer than one pin.

## 7. API routes that only work online
| Path | Permission | Request → answer | Refusals | Audit event |
|---|---|---|---|---|
| `POST /v1/team/audit/verify` (exists; answer grows) | `team.view_audit` | `{}` → existing `{ok, checked, firstBadSeq, problem}` plus `anchor: {state, seq, anchoredAt, storeChecked}`. `storeChecked` is true when the API read the manifest from the store and its hash matched the run row | Existing | `audit.verified` gains `details.anchorState`, `details.storeChecked` |
| `GET /v1/owner/audit/anchors` (new) | Platform owner (the existing owner check in `routes/owner.ts`) | → the last 50 runs: `{id, runAt, objectKey, chainCount, retainUntil, periodKey}` and, per run, whether the stored object still matches | 403 not an owner | `audit.anchors_viewed`, platform chain, `details.count` |

No route starts a run, changes retention or deletes anything. The job is not a route: it has no listener. The contract is regenerated with both (`pnpm contract:generate`).

## 8. Screens
No phone screen is new. Two phone states get wording:

| Where | State | Wording |
|---|---|---|
| App start (phone) | `deploymentAllowed` refused | "This build can’t be used with real patient records. Install Sineobex from the App Store or Google Play." |
| Sync status (phone) | Pin failure | "Can’t reach Sineobex securely. Update the app, or try another network. Your work is saved on this phone." |

Portal:

| Screen | Shows | States |
|---|---|---|
| `/audit` (exists): the tamper-check panel | After "Check the log": the chain result as today, then one line for the anchor | `current` or `ahead`: "Sealed copy made <time>. The log matches it." `none`: "No sealed copy yet. The first is made within 12 hours." `behind`: "The log is older than its last sealed copy. Tell the platform owner now." `diverged`: "The log doesn’t match its sealed copy. Tell the platform owner now." Store unreachable: "The sealed copy couldn’t be read. Try again." |
| `/owner/anchors` (new, under the existing `/owner` area) | A table of the last 50 runs: time, chains, kept until, matches | Empty: "No sealed copies yet." A mismatch row is marked with text and an icon, not colour alone |
| Sign-in (exists) | Unchanged screens; the Cognito adapter maps its challenges to the existing password, set-up-authenticator and code steps | Cognito's "new password required" (first sign-in after an invitation) maps to the existing set-password step |

The PRD gives no wording for these; the copy above is a default (PLAN-OPEN: Brooke and Mercy). Both portal pages get axe checks in Day, Night run and High contrast and a narrow-width check, as every screen does.

## 9. Audit events and the PHI rules that apply
| Event | Chain | Written by | Details (IDs, counts and hashes only) |
|---|---|---|---|
| `audit.anchor_run` | Platform | The job, in the transaction that inserts the run | `runId`, `chainCount`, `store`, `documentSha256` (hex), `retainUntil` |
| `audit.verified` (exists) | Team | The verify route | adds `anchorState`, `storeChecked` |
| `audit.anchors_viewed` | Platform | The owner route | `count` |
| `platform.restore_drill` | Platform | `db verify --record` on the **live** database after a drill, never on the restored copy | `snapshotTime`, `chainsChecked`, `chainsOk`, `anchorsChecked`, `minutesToRestore` |

AWS-layer actions (a bucket policy change, a new Cognito user, a KMS key use) are CloudTrail's, not the app's (main 623). The two logs are separate on purpose.

PHI rules for this phase:

- Manifests, run rows, drill reports and checklist reports hold team IDs, counts, hashes and times. No names, no patient IDs, no user IDs.
- API logs go to CloudWatch through the allowlisted logger (`lib/log.ts`). ALB access logs record paths: paths carry internal UUIDs at most (D12), search terms travel in POST bodies (D12). WAF logs redact `authorization` and `cookie` and never include bodies.
- Container environment variables carry no secret (`checkNoSecretsInEnv`); the database URL comes from Secrets Manager. Cognito holds staff emails and display names, not patients (risk analysis section 1). Invitation emails are Cognito's template: no team name, no patient details.
- Evidence files under `docs/compliance/evidence/` pass the PHI guard; account IDs are written as their last four digits. Dev and staging hold made-up patients only and show Demo data only (the existing banner for demo kinds).

## 10. Tests
### 10.1 Done when, part 1: the module 10 checklist
`infra/checklist/module-10.json` is the list; each item has an ID, the PRD line, a kind (`synth`: proven on the template in CI; `live`: proven by `tools/prod-checklist.mjs` against the deployed account with read-only calls; `person`: a dated record in `docs/compliance/evidence/`), and the evidence it writes.

| # | Item | PRD | Kind | What is asserted |
|---|---|---|---|---|
| 1 | Every action is logged by the app, in the transaction | main 625 | synth (CI) | The API suite's audit helper passes on the deployed commit (existing tests; the report records the commit and CI run) |
| 2 | The chain verifies | main 629 | live | `verify_audit_chain` is ok for every chain (through `db verify`) |
| 3 | Anchors exist, are locked, are chained | main 630 | synth + live | `checkAnchorBucket`; the last run is under 13 hours old; every manifest has COMPLIANCE retention in the future; `verifyManifestChain` ok; a delete attempt on the newest manifest version is refused (the refusal is the evidence) |
| 4 | No orphan manifest | 5.1 | live | Every object under `anchors/v1/` has a run row, or is listed |
| 5 | CloudTrail covers the AWS layer | main 623, 692 | synth + live | `checkTrail`; the trail is logging; a test read of the anchor bucket appears as a data event within 15 minutes |
| 6 | TLS everywhere | main 638, 599 | synth + live | `checkTlsPolicy`, `checkBucketsPrivateTlsOnly`; a TLS 1.1 handshake to the API is refused; the API's database session reports SSL in use |
| 7 | Encryption at rest with KMS | main 638 | synth + live | `checkEncryptionAtRest`; the RDS instance and each bucket report a customer key |
| 8 | MFA for admins and Billing/Data | main 639 | synth + live | `checkCognitoPool`; the live pool reports MFA `ON`, TOTP only; a staging sign-in without a code gets no token (Cognito adapter test) |
| 9 | No PHI in logs | main 640 | synth + live | PHI guard on the commit; `checkNoSecretsInEnv`; a staging run of the done-when scenarios, then a search of that hour's API, ALB and WAF logs for the scenario's made-up names finds nothing |
| 10 | PHI guard and secret scan in CI | main 641 | synth (CI) | Both jobs passed on the deployed commit |
| 11 | Risk analysis written | main 642 | person | `docs/compliance/risk-analysis.md` is filled in, dated and signed; the report records its commit |
| 12 | Log retention decided | main 643 | person | Counsel's answer is recorded; the spec's `retentionDays` and `logs.archiveDays` match it |
| 13 | BAA accepted | main 688 | person + synth | `baa.json` exists; `checkBaaRecord` |
| 14 | Separate accounts, no real PHI outside prod | main 689 | live | The three account IDs differ; dev and staging databases are marked `preview` |
| 15 | Only eligible services | main 684 | synth | `checkEligibleServices` |
| 16 | Backups on | main 694 | synth + live | `checkDatabase`; the latest restorable time is under 10 minutes old |
| 17 | The admin audit dashboard exists and flags unusual access | main 634 | person | Out of this phase (1.2); the item stays open until its phase reports it. **The Done when is not met while this is open** (11.2) |

The checklist passes when every `synth` and `live` item passes on the same commit and every `person` item has its record.

### 10.2 Done when, part 2: the restore drill
`tools/restore-drill.sh <env>` (level X). It never touches the live database except to read its backup metadata and, at the end, to record the drill.

| Step | Does | Asserted | Evidence |
|---|---|---|---|
| 1 | Note the time; read the latest restorable time | It is under 10 minutes old | `rpoMinutes` |
| 2 | Restore to that time into a new instance `sineobex-drill-<date>`, in a subnet only the drill task can reach, same KMS key | The instance becomes available | `minutesToRestore` (the measured recovery time) |
| 3 | Run `db verify` against the copy | The migration version equals the live one; `verify_audit_chain` ok for every chain; row counts per table are within the changes made since step 1 | Counts and chain totals |
| 4 | Compare the copy with the anchors in S3 | For every chain, `anchorVerdict` against the newest manifest older than the restore time is `current` or `ahead`; `verifyManifestChain` ok | `anchorsChecked`, states |
| 5 | Start one API task against the copy with `APP_ENV` matching its mark | `/v1/health` answers ok; in staging only, the done-when scenarios run against it | Health answer, release |
| 6 | Delete the copy and its snapshot | The instance is gone | Deletion time |
| 7 | `db verify --record` on the live database | `platform.restore_drill` is in the platform chain | The event's seq |
| 8 | Write `docs/compliance/evidence/restore-drills/<date>-<env>.json` | PHI guard passes on it | The file; a person signs the risk analysis row |

Run it in staging on every change to the data stack, and in production once before the pilot (main 694) and every quarter after (11.1).

### 10.3 The test that holds each rule
| Rule | Test |
|---|---|
| Each pure function in 5.2 | A vector test per language, reading the shared file; `anchor.json` includes a first run, an unchanged day, a restored (`behind`) chain and a tampered (`diverged`) chain |
| The job writes nothing to the database when the store fails | API test with a store that fails on put, and one that corrupts on read-back: no run row, no anchor row, no event |
| The run, its anchors and its event are one transaction; an unchanged day inside 24 h writes nothing | API tests: the audit append is made to fail and no run row remains (checked to bite by removing the transaction); a fixed clock for the second |
| Anchor rows can't be changed | DB test: update and delete on `audit_anchor_runs` raise; `sineobex_app` can't see a run outside platform scope |
| Tampering after an anchor is reported | API test: alter an audit row as the owner role, call verify, expect `diverged` |
| Each policy check | One passing and one failing fixture template each; plus the real synthesized template for all three specs passes all checks and cdk-nag's HIPAA pack (CI job "Infra synth and policy") |
| The WAF lets sync through | `waf-paths.json` vectors; live in staging: a 1 MiB sync push and a photo chunk are accepted, a 1 MiB post to another path is refused |
| An edge block never loses work | Phone scenario tests with the fake's `edgeBlocked` and `edgeRateLimited` modes; the outbox is byte-for-byte unchanged after the failure |
| Cognito sign-in | API: verifier tests with tokens shaped like Cognito's (`token_use=access`, `client_id`, `auth_time`), signed by the local key; identity admin tests against a stub of the three Cognito calls. Phone and portal: provider tests against the same stub. One live run in staging |
| A production build refuses a wrong stack or a wrong certificate | `deployment-rules.json` and `tls-pins.json` vectors; a widget test for the start-up error; the release workflow checks the live chain |
| The demo firewall on AWS | Existing `assertDatabaseMatches` tests; a staging deploy with `APP_ENV=production` fails to start (run once, recorded) |

## 11. Defaults chosen (PLAN-OPEN), and questions with no default
### 11.1 Defaults
| # | Question | Default | Why | Who decides |
|---|---|---|---|---|
| 1 | Anchor retention (main 643) | 2,192 days (six years) in production, compliance mode | The PRD's "common choice"; compliance mode can be lengthened later, never shortened | Counsel |
| 2 | Rotation interval (main 627: 12–24 h) | 12 hours | The shorter end halves what an undetected edit could cover | The team |
| 3 | A management account besides dev, staging, prod | Yes, with no workloads | Identity Center and an out-of-reach trail need it; main 689 names three | Project lead |
| 4 | "IAM Identity Center for the owner registry" (main 691) | Identity Center signs owners in to AWS; the app's `platform_owners` table stays the app's registry | The app has no SAML sign-in, and owners are few | Project lead |
| 5 | Is the pilot its own stack (`pilot` kind) or the first team in production? | The first team in production; `pilot` stays unused | One real environment to secure; main 686 says pilot and production start together on a fresh database | Project lead |
| 6 | Region | us-east-1, one region | The cost table's assumption (main 697) | Project lead |
| 7 | Backup retention and copies | 35 days of point-in-time recovery; a daily copy to a locked backup vault in a second region | Covers deletion of the database by a compromised admin (risk analysis row 7) | Project lead |
| 8 | Drill frequency | Before the pilot, then quarterly and after any change to the data stack | "Tested restore" (main 694) should stay true | Project lead |
| 9 | Cognito sign-in flow | Password then TOTP through Cognito's API, on our own screens; no hosted pages, no SMS | D6: no screen changes; passkeys later | Project lead |
| 10 | Per-user rate limit (plan section 6, "Search rate limit") | At the WAF: 600 requests per 5 minutes per token, 2,000 per IP; count mode for 14 days, then block | Field teams share carrier addresses and sync in bursts; counting first shows real traffic | The team |
| 11 | What the phone pins | The certificate authority roots, with one spare | Leaf keys change at renewal (decision 8) | Project lead |
| 12 | Where the portal runs (main 713 says "a few dollars on S3 and CloudFront") | A second Fargate service behind the same load balancer; the marketing site on S3 and CloudFront | The portal is a backend-for-frontend with server-side sessions (D12); it can't be static files. Adds about one task's cost | Project lead |
| 13 | Database password rotation | By runbook, every 90 days and when someone with access leaves | Automatic rotation restarts tasks mid-sync; the pilot is small | Project lead |
| 14 | App-layer encryption of ID card tokens (risk analysis row 15) | Not added; KMS at rest only | A token is a pointer, not a credential (phase 3 design, default 27) | Counsel, in the risk analysis |
| 15 | App review sign-in for Apple and Google | A review team in production holding only "Demo:" patients, with one reviewer account | Stores review the production build and need a login; no real data is shown | Project lead |
| 16 | Log archive after 30 hot days (main 708) | Application, ALB, WAF and CloudTrail logs archived to S3 for the anchor retention period | One retention answer for everything a breach review needs | Counsel |

### 11.2 Questions that need a person and have no default
1. **Who accepts the BAA, and for which legal entity?** (counsel, project lead; plan section 7 lists company structure as open.)
2. **Who is the security official who signs the risk analysis?** (project lead.)
3. **The public app name, bundle identifiers and domain** (the team; build 150). Infra, pins, store listings and `ID_LINK_BASE_URL` all wait on it.
4. **Who holds the root credentials and the break-glass procedure for each account?** (project lead.)
5. **Is the audit dashboard with unusual-access flags (main 634) part of the module 10 checklist for this Done when?** No phase in the plan's table builds the flags. This design reads the checklist as including it (item 17) and so cannot close without it. (project lead.)
6. **The old secret-scan finding** (build 151) must be closed before production secrets exist. (project lead.)

## 12. Risks, and where the design departs from the PRD
1. **A restore can lose records phones have already deleted.** A phone purges a value once the server confirms it by hash (main 570). A restore to a time before that receipt loses the value everywhere. Multi-AZ covers hardware failure without a restore; point-in-time recovery to the latest moment keeps the window to minutes; the runbook says to restore to the latest restorable time unless the cause is corruption, and then to list every device that synced after the restore point from the API logs (`deviceId` is logged) so the team can re-chart. A real fix is a sync-core change (keep confirmed values for a short hold): **recommended to the project lead, not designed here.**
2. **Compliance-mode Object Lock can't be undone.** A wrong retention in production stays for its full term. Dev and staging use governance mode and one day; the first production run happens only after default 1 is confirmed. Objects are a few kilobytes, so the cost of being wrong is small.
3. **The body-size rule would silently break sync.** AWS's common rule group blocks bodies over 8 KB. Held by `checkWaf`, `waf-paths.json` and the staging smoke test.
4. **Rate limits can block a whole team behind one carrier address.** Count mode first (default 10); a block never loses work (section 6).
5. **Pins can lock phones out.** Root pins plus a spare, a release check against the live chain, and a failure that deletes nothing. An inspection proxy on a clinic's Wi-Fi will stop sync by design; the wording says to try another network.
6. **Cognito tokens differ from Supabase's.** No `aud` on access tokens, no `aal` claim, `auth_time` instead of `amr`. The verifier and the 15-minute step-up (safeguard mapping, (d)) must be re-proven with Cognito-shaped tokens before staging.
7. **The eligible-services list is kept by hand.** It can go stale; it is dated, and the checklist report prints its age.
8. **iOS has no CI build** (plan risk 5). The release workflow needs a macOS runner; a card adds a build-only job first.
9. **Uploads from the portal are not scanned for malware** (phase 8 design risk 6). Still open.
10. **Cost.** The management account, the portal service, the second-region backup copy and VPC endpoints are not in the PRD's table (main 699–711). Expect the upper end of $300–450; a person re-prices it (main 695).

Departures and readings: four accounts, not three (default 3). The portal on Fargate, not S3 and CloudFront (default 12). Dev and staging are `preview`-kind, not new kinds (decision 3). The "rotating key" is the chained manifest's `periodKey`, not a secret (decision 5). CloudTrail is never used for app events (main 623). `infra/` arrives in this phase, not "phase 13" (build 43).

## 13. Units and a first card list
Dependency order: **U0** alone first. Then U1, U2, U3 and U5 in parallel (disjoint files). U4 needs U3; the first deploy needs U1 to U5; U6 is last. **Every card in U2, U3 and U4 is level X** except 4.3: sign-in, `.github/**`, `tools/**`, and all of `infra/**`, which this design adds to the always-X list in `docs/plan/README.md`.

- **U0 Core rules and schema** (cards 0.x) owns the migration, the vector files, `anchor-rules.ts`, `config-rules.ts`, `config.ts`.
- **U1 Anchoring** (1.x) owns the rest of `services/api/src/audit/**`, `entry/anchor.ts`, the two routes, the two portal pages.
- **U2 Cognito** (2.x) owns the new adapter files and the verifier.
- **U3 Infrastructure** (3.x) owns `infra/**`.
- **U4 Pipelines and tools** (4.x) owns `.github/**`, `tools/**`, the Dockerfiles, `db/src/cli.ts`.
- **U5 Phone hardening** (5.x) owns `tls_pins.dart`, `deployment_rules.dart`, the fake's fault modes. **U6 Documents and evidence** (6.x) owns `docs/**`, `infra/README.md`.

| # | Card | Level | Files | Needs |
|---|---|---|---|---|
| 0.1 | Vector files `anchor.json`, `deployment-rules.json`, `tls-pins.json`, `waf-paths.json` | T | `packages/contract/test-vectors/*` | — |
| 0.2 | Migration: `audit_anchor_runs`, trigger, policy, index | X | `db/migrations/<n>_audit_anchor_runs.sql`, db test | — |
| 0.3 | `buildAnchorDocument`, `anchorObjectKey`, `retainUntil` | T | `services/api/src/audit/anchor-rules.ts` | 0.1 |
| 0.4 | `anchorDue`, `anchorVerdict`, `verifyManifestChain` | T | `services/api/src/audit/anchor-rules.ts` | 0.3 |
| 0.5 | `deploymentAllowed` (TS) and the config rules for `pilot` and `production` | T | `services/api/src/config-rules.ts`, `config.ts` | 0.1 |
| 0.6 | Config keys: `IDENTITY_ADMIN=cognito`, `COGNITO_USER_POOL_ID`, `AWS_REGION`, `ANCHOR_*` | T | `services/api/src/config.ts` | 0.5 |
| 1.1 | `AnchorStore` interface and memory store | T | `services/api/src/audit/anchor-store.ts` | 0.3 |
| 1.2 | S3 anchor store (Object Lock headers; phase 8's signer) | X | `services/api/src/audit/anchor-store-s3.ts` | 1.1, phase 8 card 2.10 |
| 1.3 | The run: steps 1–5 of 5.1 in one function | X | `services/api/src/audit/anchor-run.ts` | 0.2, 0.4, 1.1 |
| 1.4 | Job entry point (reads config, runs once, exits) and its bundle | X | `services/api/src/entry/anchor.ts`, `scripts/build.mjs` | 1.3 |
| 1.5 | Verify route answers `anchor` | T | `services/api/src/routes/audit-log.ts`, `schemas.ts` | 0.4, 1.1 |
| 1.6 | Owner route `GET /v1/owner/audit/anchors` | T | `services/api/src/routes/owner.ts` | 1.1 |
| 1.7 | Regenerate the contract | S | generated files only | 1.5, 1.6 |
| 1.8 | Portal: anchor line on `/audit` | R | `apps/portal/src/app/(app)/audit/*`, `lib/labels.ts` | 1.7 |
| 1.9 | Portal: `/owner/anchors` page with axe tests | R | `apps/portal/src/app/(app)/owner/anchors/*`, e2e | 1.7 |
| 2.1 | Verifier accepts Cognito access tokens (`client_id`, `token_use`, `auth_time`) | X | `services/api/src/auth/verifier.ts` | 0.6 |
| 2.2 | Cognito identity admin (`inviteOrFind`, `disable`, `enable`) | X | `services/api/src/auth/cognito-identity-admin.ts`, `entry/bootstrap.ts` | 0.6 |
| 2.3 | Phone `CognitoAuthProvider` and `AuthKind.cognito` | X | `apps/mobile/lib/auth/auth_provider.dart`, `lib/config/env.dart` | 0.1 |
| 2.4 | Portal Cognito adapter | X | `apps/portal/src/lib/auth/cognito.ts`, `index.ts`, `env.ts` | — |
| 2.5 | A local stub of the Cognito calls for tests | X | `tools/dev-cognito.mjs` | — |
| 3.1 | CDK app skeleton, `EnvSpec`, three spec files | X | `infra/bin/app.ts`, `infra/lib/spec.ts`, `infra/config/*.ts` | — |
| 3.2 | Policy check harness, fixtures folder, cdk-nag HIPAA pack | X | `infra/policy/index.ts`, `infra/test/policy.test.ts` | 3.1 |
| 3.3–3.6 | Policy checks, three per card (12 checks, 5.5), each with two fixtures | X | `infra/policy/<check>.ts` | 3.2 |
| 3.7 | Keys: one KMS key each for data, logs, secrets | X | `infra/lib/keys.ts` | 3.1 |
| 3.8 | Network: VPC, two zones, private subnets, one NAT, S3 and Secrets endpoints | X | `infra/lib/network.ts` | 3.1 |
| 3.9 | Database: RDS, parameter group (`force_ssl`), secrets, backups | X | `infra/lib/database.ts` | 3.7, 3.8 |
| 3.10 | Buckets: photos, anchors (Object Lock), logs | X | `infra/lib/buckets.ts` | 3.7 |
| 3.11 | Cognito pool and clients | X | `infra/lib/identity.ts` | 3.1 |
| 3.12 | API service: ECR, task definition, Fargate service, roles | X | `infra/lib/api-service.ts` | 3.9, 3.10 |
| 3.13 | Migration task and anchor schedule (every 12 h) | X | `infra/lib/tasks.ts` | 3.12 |
| 3.14 | Portal service; website bucket and distribution | X | `infra/lib/portal-service.ts`, `infra/lib/website.ts` | 3.12 |
| 3.15 | Load balancer, certificates, WAF with `wafBodyExempt` | X | `infra/lib/edge.ts`, `infra/lib/waf-paths.ts` | 3.12, 0.1 |
| 3.16 | Logs, alarms (missed anchor run, failed task, 5xx, storage), off-hours schedule | X | `infra/lib/observability.ts` | 3.12 |
| 3.17 | Backup vault, second-region copy | X | `infra/lib/backup.ts` | 3.9 |
| 3.18 | Management account: organization trail, guardrail policies, GitHub deploy roles | X | `infra/lib/organization.ts`, `infra/lib/deploy-roles.ts` | 3.1 |
| 3.19 | Checklist data file and the eligible-services list | X | `infra/checklist/module-10.json`, `infra/policy/eligible-services.json` | 3.2 |
| 4.1 | API and portal Dockerfiles (non-root, RDS CA bundle) | X | `services/api/Dockerfile`, `apps/portal/Dockerfile` | — |
| 4.2 | CI job "Infra synth and policy"; the same step in `ci-local.sh` | X | `.github/workflows/ci.yml`, `tools/ci-local.sh` | 3.2 |
| 4.3 | `db verify` (version, chains, counts, `--record`) and `db validate-constraints` | T | `db/src/cli.ts`, `db/src/verify.ts` | 0.2 |
| 4.4 | `deploy-aws.yml`: build, push, migrate, deploy; gates of 5.4 | X | `.github/workflows/deploy-aws.yml` | 3.18, 4.1 |
| 4.5 | `tools/prod-checklist.mjs` (live checks, report) | X | `tools/prod-checklist.mjs`, test | 3.19, 4.3 |
| 4.6 | `tools/restore-drill.sh` (10.2) | X | `tools/restore-drill.sh` | 4.3, 4.5 |
| 4.7 | `tools/tls-pins.mjs` (generate and check pins) | X | `tools/tls-pins.mjs` | 0.1 |
| 4.8 | iOS build-only CI job | X | `.github/workflows/ci.yml` | — |
| 4.9 | `release-mobile.yml`: signed Android and iOS builds, pin check | X | `.github/workflows/release-mobile.yml` | 4.7, 4.8, 5.2 |
| 5.1 | `deploymentAllowed` (Dart) and the start-up error | R | `apps/mobile/lib/config/deployment_rules.dart`, `lib/main.dart` | 0.1 |
| 5.2 | `pinMatches` and the pinned HTTP client; Android pin set | X | `apps/mobile/lib/security/tls_pins.dart`, `network_security_config.xml` | 0.1 |
| 5.3 | Fake server fault modes `edgeBlocked`, `edgeRateLimited` and two scenarios | X | `apps/mobile/test/sync/fake_server.dart`, scenario test | — |
| 5.4 | Sync status wording for a pin failure | R | the sync status widget, its test | 5.2 |
| 6.1 | `infra/README.md`: accounts, first deploy (below), cost lines | S | `infra/README.md`, `docs/setup.md` | U3 |
| 6.2 | Runbooks: restore, incident (`behind`, `diverged`), password rotation, break-glass | S | `docs/runbooks/*.md` | 4.6 |
| 6.3 | Compliance: safeguard mapping, risk analysis rows 6, 7, 15, evidence index | S | `docs/compliance/*.md` | 4.5 |
| 6.4 | Plan: D-table, section 5 CI table, section 6 defaults, status | S | `IMPLEMENTATION_PLAN.md`, `docs/plan/README.md` | all |

**Cards by level: S 5, T 9, R 4, X 38 (56 cards; 3.3–3.6 counted as four).** Most of this phase is level X by rule; the judgment that could move was moved into `EnvSpec`, the vectors, the policy fixtures and the checklist file.

### 13.1 Order of a first production deploy (people in bold)
| # | Step | Evidence for the risk analysis |
|---|---|---|
| 1 | **Decide** 11.2 items 1–4 and 6; **counsel** answers defaults 1 and 16 | Dated notes in `docs/compliance/evidence/decisions.md` |
| 2 | **Create** the organization and four accounts; turn on Identity Center with MFA; lock away root credentials | Account list (last four digits), date |
| 3 | **Accept the BAA** in AWS Artifact for the organization; commit `baa.json` | `baa.json` (checklist 13) |
| 4 | Deploy the management stack (trail, guardrails, deploy roles) | Trail status (checklist 5) |
| 5 | Deploy dev, then staging, from CI; migrate with `--environment preview`; seed | Deploy run links |
| 6 | Staging: run the done-when scenarios, the WAF smoke test, the Cognito sign-in, the log search, a restore drill | Checklist report and drill report for staging |
| 7 | **Register** the domain names; issue certificates; generate pins (`tools/tls-pins.mjs`) | Pin file commit |
| 8 | Deploy production with an **approver**; migrate with `--environment production`; `grant-api`; `validate-constraints`; `add-owner` | Deploy run, approver, migration version |
| 9 | First anchor run; confirm the manifest is locked | Checklist 3 |
| 10 | Run `tools/prod-checklist.mjs prod` | `docs/compliance/evidence/checklist/<date>-prod.json` |
| 11 | Run `tools/restore-drill.sh prod`; **sign** the report | Drill report; `platform.restore_drill` seq |
| 12 | **Complete and sign** the risk analysis, citing 3, 10 and 11 | Checklist 11 |
| 13 | Build signed apps; **submit** to TestFlight and Play internal testing, then the stores | Build numbers, pin check output |
| 14 | An owner creates the pilot team and appoints its Program Admin | App audit events (existing) |
