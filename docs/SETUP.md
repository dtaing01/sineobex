# Setup

Everything needed to go from a fresh clone to a running system. Read the
section you need; they are ordered by how soon you will need them.

Mobile store setup is long enough to live on its own — see
[`MOBILE_RELEASE.md`](MOBILE_RELEASE.md). For how the pieces fit together and
how data moves between them, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

> **Before anything touches real patient data**, read
> [`HIPAA.md`](HIPAA.md) in full, including its Known Gaps section. A signed
> Business Associate Addendum with AWS is a prerequisite, not a follow-up.

---

## 0. Accounts and registrations

Everything this system depends on, what it costs, and where to sign up. Only
the AWS account is needed to run the backend; the store accounts are needed
only when you ship to devices.

### 0.1 AWS

One account covers every service below — there is no per-service signup. What
matters is *which* account, and what you enable on it before deploying.

| Step | Where |
|---|---|
| Create the account (use a dedicated one, not a shared sandbox) | https://portal.aws.amazon.com/billing/signup |
| Put it under an Organization so an SCP can protect CloudTrail | https://console.aws.amazon.com/organizations/ |
| **Accept the Business Associate Addendum** in AWS Artifact | https://console.aws.amazon.com/artifact/ → Agreements → AWS BAA |
| Confirm each service is in scope for the BAA | https://aws.amazon.com/compliance/hipaa-eligible-services-reference/ |
| Enable GuardDuty | https://console.aws.amazon.com/guardduty/ |
| Enable Security Hub | https://console.aws.amazon.com/securityhub/ |
| Enable AWS Config + the HIPAA conformance pack | https://console.aws.amazon.com/config/ |

Background reading: [AWS HIPAA compliance](https://aws.amazon.com/compliance/hipaa-compliance/)
and the [Architecting for HIPAA whitepaper](https://docs.aws.amazon.com/whitepapers/latest/architecting-hipaa-security-and-compliance-on-aws/welcome.html).

The BAA is the gate. Every service used here is HIPAA-*eligible*, which means
AWS **will** cover it once you sign — not that it is covered now.

### 0.2 Services the stacks create

Deployed by `infra/`, all in one region (`us-east-1` by default):

| Stack | Service | Purpose |
|---|---|---|
| Network | VPC, NAT Gateway, security groups, VPC Flow Logs | Private network; the database has no internet route |
| Data | **Aurora Serverless v2, PostgreSQL 16.4** + PostGIS | The PHI database |
| Data | **KMS** customer-managed key | Encrypts Aurora, S3, Performance Insights |
| Data | **Secrets Manager** ×2 | Master credential, plus the `sineobex_api` credential RLS depends on |
| Data | **S3** ×3 | Attachments; audit archive (Object Lock, compliance mode); access logs |
| Auth | **Cognito** user pool + groups | Sign-in; MFA required, TOTP only |
| Api | **API Gateway** HTTP API + JWT authorizer | The only entry point |
| Api | **Lambda** (Node.js 22) | API handlers and the scheduled-refresh handler |
| Api | **CloudWatch Logs** | One-year retention |
| Observability | **CloudTrail** | Includes S3 data events — attachment reads are logged |
| Observability | **CloudWatch** alarms + dashboard, **SNS** | Alerting |
| All | **IAM** | Roles and least-privilege policies |

**Cost is dominated by two always-on items that do not scale down with use:**
the NAT Gateways (two in prod, one in dev) and the Aurora ACU floor (prod
never drops below 1 ACU on the writer plus 1 on the reader). Expect a few
hundred dollars a month for a prod stack sitting idle. Both levers are behind
the `isProd` flag in `network-stack.ts` and `data-stack.ts`. Check current
rates at https://calculator.aws/ rather than trusting an estimate here.

### 0.3 Mobile stores

Needed only to distribute to devices. Full walkthrough in
[`MOBILE_RELEASE.md`](MOBILE_RELEASE.md).

| What | Cost | Where |
|---|---|---|
| Apple Developer Program (Organization) | $99/yr | https://developer.apple.com/programs/enroll/ |
| Apple D-U-N-S lookup (required for Organization enrolment) | Free | https://developer.apple.com/enroll/duns-lookup/ |
| App Store Connect (builds, TestFlight, App Privacy) | Included | https://appstoreconnect.apple.com/ |
| Apple Business Manager — private distribution to your own staff | Free | https://business.apple.com/ |
| Google Play Console (Organization) | $25 once | https://play.google.com/console/signup |
| D-U-N-S number, if you do not have one | Free | https://www.dnb.com/duns/get-a-duns.html |

**Start the D-U-N-S request first.** It takes one to three weeks and is the
usual cause of a launch date slipping. Both stores require it for organization
accounts, and both put PHI-handling apps in their strictest review category.

For a tool used only by your own clinical staff, Apple Business Manager custom
app distribution is usually a better fit than a public App Store listing — no
public listing, no consumer review surface.

### 0.4 Everything else

| What | Cost | Where | Notes |
|---|---|---|---|
| cron-job.org | Free | https://console.cron-job.org/signup | Scheduled refresh. **No PHI passes through it** — it holds an HMAC secret and fires a URL |
| GitHub Actions | Existing | https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services | Needs an OIDC role in AWS; secrets listed in [`CI.md`](CI.md) |
| Map tiles | See §6 | — | **Not yet resolved. Read §6 before clinical use.** |

Deliberately not used: no analytics SDK, no crash reporter, no third-party
logging. Each would be another business associate agreement to negotiate and
another place PHI could land.

---

## 1. Local development

### 1.1 Toolchain

| Tool | Version | Why |
|---|---|---|
| Flutter | 3.47.1+ | The app. Bundles the Dart 3.13+ SDK. |
| Node.js | 22 LTS | CDK and the Lambda handlers. |
| PostgreSQL client | 16 | Running migrations. |
| PostgreSQL server + PostGIS 3 | 16 | The database test suite. |
| AWS CLI | v2 | Reading stack outputs and secrets. |
| Xcode | 16+ | iOS builds. macOS only. |
| Android Studio / JDK 17 | — | Android builds. |

Install Flutter:

```sh
# macOS
brew install --cask flutter

# Linux
curl -sSL -o flutter.tar.xz \
  https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.47.1-stable.tar.xz
tar xf flutter.tar.xz -C ~/  &&  export PATH="$HOME/flutter/bin:$PATH"
```

Then `flutter doctor` and resolve anything it flags for your target
platforms. Web and desktop toolchains are optional; iOS and Android are not.

PostgreSQL with PostGIS, for the database tests:

```sh
# macOS
brew install postgresql@16 postgis

# Debian/Ubuntu
sudo apt-get install -y postgresql-16 postgresql-16-postgis-3 postgresql-client-16
```

### 1.2 Running the app

```sh
cd app
flutter pub get
flutter run
```

With no backend configured the app runs entirely on-device. Sign-in is not
enforced, and the sign-in screen says so rather than pretending otherwise.

**Demo data** — 12 fictional Detroit patients, useful for demos and for seeing
the maps and charts populated:

```sh
flutter run --dart-define=SINEOBEX_DEMO_SEED=true
```

It is off by default and must stay off in any build that will hold real
records. It is gated at compile time, so a release build without the flag
cannot load it even by accident.

**Against a deployed backend** — the four values come from the CDK stack
outputs in §2.4:

```sh
flutter run \
  --dart-define=SINEOBEX_API_URL=https://abc123.execute-api.us-east-1.amazonaws.com/v1 \
  --dart-define=SINEOBEX_COGNITO_POOL_ID=us-east-1_XXXXXXXXX \
  --dart-define=SINEOBEX_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx \
  --dart-define=SINEOBEX_AWS_REGION=us-east-1
```

Typing those every time gets old. Put them in a file and use `--dart-define-from-file`:

```sh
cp app/config/example.env.json app/config/dev.json   # then edit
flutter run --dart-define-from-file=config/dev.json
```

`app/config/*.json` is gitignored apart from the example. These are not
secrets — a Cognito pool id and client id are public by design — but keeping
them out of the repository avoids one environment's config leaking into
another's build.

### 1.3 Tests

```sh
cd app
flutter analyze          # static analysis; expect no issues
flutter test             # 101 unit and widget tests
```

Database tests need a running PostgreSQL with PostGIS. They **drop and
recreate** their target database, so never point them at anything real:

```sh
# Uses your local libpq settings, or set DATABASE_URL explicitly.
infra/test/run.sh
```

That suite applies all three migrations from scratch, then asserts 41
properties: that row-level security isolates teams and **fails closed** when
no actor is set, that encounters cannot be edited or deleted, that the audit
trigger fires without the application's help, and that each scheduled-job
query actually executes and is idempotent.

It exists because four SQL bugs shipped past code review in this repository —
two type mismatches that failed on every cron run, an unscoped join that
leaked one team's inventory state to another, and an upsert that aborted on
duplicate keys. None of them are visible to a typechecker.

Infrastructure:

```sh
cd infra
npm install
npx tsc --noEmit         # typecheck the stacks and Lambda handlers
npm run synth            # render CloudFormation
```

`npm run synth` needs no AWS credentials. With `CDK_DEFAULT_ACCOUNT` unset
the stacks synthesize environment-agnostically and the VPC resolves its
availability zones at deploy time via `Fn::GetAZs`. Set `CDK_DEFAULT_ACCOUNT`
when you actually deploy and CDK will look up concrete zones for that
account.

---

## 2. AWS

### 2.1 Prerequisites — do these first

1. **Sign a Business Associate Addendum with AWS.** In AWS Artifact, accept
   the AWS BAA for the account that will hold PHI. Every service used here is
   HIPAA-eligible, which means AWS *will* cover it under a BAA — not that it
   is covered until you sign one.
2. **Use a dedicated account.** Not a shared sandbox, not the payer account.
   Ideally an Organizations member account with an SCP that prevents disabling
   CloudTrail.
3. **Harden the account before deploying**: enforce MFA on every IAM
   principal, delete root access keys, and enable GuardDuty, Security Hub, and
   AWS Config with the HIPAA conformance pack.
4. **Pick a region** and stay in it. `us-east-1` is the default here. All
   HIPAA-eligible services are available in the major US regions; verify for
   any region you choose.

### 2.2 Deploy

```sh
cd infra
npm install

export AWS_PROFILE=sineobex-prod
export CDK_DEFAULT_REGION=us-east-1
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

npx cdk bootstrap                      # once per account+region
npx cdk deploy --all -c stage=prod
```

Deploying all five stacks from cold takes roughly 25–35 minutes; the Aurora
cluster is most of it.

Stages are independent: `-c stage=dev` deploys a parallel, smaller stack set
(single NAT gateway, no read replica, shorter backup retention).

### 2.3 Migrations

Run these **once, in order**, as the master user. They are not idempotent and
there is no migration runner — this is a young schema and a wrapper would be
more machinery than it earns.

Get the endpoints and secrets:

```sh
STACK=Sineobex-prod-Data
out() { aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }

DB_HOST=$(out DatabaseEndpoint)
MASTER_ARN=$(out DatabaseSecretArn)
API_ARN=$(out ApiDbSecretArn)

secret() { aws secretsmanager get-secret-value --secret-id "$1" \
  --query SecretString --output text; }

MASTER_PW=$(secret "$MASTER_ARN" | jq -r .password)
API_PW=$(secret "$API_ARN" | jq -r .password)
MASTER_URL="postgres://sineobex_admin:$MASTER_PW@$DB_HOST:5432/sineobex?sslmode=verify-full"
```

The database sits in isolated subnets with no internet route, so you need a
path in — a bastion in the private subnet, SSM Session Manager port
forwarding, or a VPN. Session Manager is the least standing access:

```sh
aws ssm start-session --target "$BASTION_INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$DB_HOST,portNumber=5432,localPortNumber=5432"
```

Then:

```sh
psql "$MASTER_URL" -v ON_ERROR_STOP=1 -f migrations/001_initial_schema.sql
psql "$MASTER_URL" -v ON_ERROR_STOP=1 -v api_password="$API_PW" \
     -f migrations/002_row_level_security.sql
psql "$MASTER_URL" -v ON_ERROR_STOP=1 -f migrations/003_seed_reference_data.sql
```

**Migration 002 is not optional and will not run without `api_password`.** It
creates the least-privilege role the API connects as. Without it the API would
fall back to the master superuser, which bypasses row-level security entirely
and would make every isolation policy decorative. The migration aborts with an
explicit error if the resulting role could bypass RLS.

003 seeds partner facilities and geographic clusters for Detroit. It contains
no patient data. Replace it with your own reference data for another city.

Verify isolation is live:

```sh
psql "$MASTER_URL" -c "
  SELECT rolname, rolcanlogin, rolsuper, rolbypassrls
  FROM pg_roles WHERE rolname = 'sineobex_api';"
# expect: t | f | f
```

### 2.4 Wire the app to the stack

```sh
aws cloudformation describe-stacks --stack-name Sineobex-prod-Api \
  --query "Stacks[0].Outputs" --output table
aws cloudformation describe-stacks --stack-name Sineobex-prod-Auth \
  --query "Stacks[0].Outputs" --output table
```

Take `ApiUrl` (append `/v1`), `UserPoolId`, and `UserPoolClientId` into the
`--dart-define` values from §1.2.

### 2.5 Create the first users

Self-registration is disabled — clinicians are provisioned by an
administrator, which is the correct posture for a system holding PHI.

```sh
POOL=$(aws cloudformation describe-stacks --stack-name Sineobex-prod-Auth \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)

aws cognito-idp admin-create-user \
  --user-pool-id "$POOL" \
  --username s.chen@streetmed.org \
  --user-attributes \
      Name=email,Value=s.chen@streetmed.org \
      Name=email_verified,Value=true \
      Name=name,Value="Sarah Chen, RN" \
      Name=custom:role,Value="Administrator" \
      Name=custom:agency,Value="Street Medicine Detroit" \
      Name=custom:team,Value="Lead Outreach Council" \
  --desired-delivery-mediums EMAIL

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$POOL" --username s.chen@streetmed.org \
  --group-name full-admin
```

Groups map to the three access tiers the app already models: `full-admin`,
`standard`, `view-only`.

On first sign-in the user is prompted to set a permanent password, then to
enrol an authenticator app — MFA is required on the pool, and the app handles
both challenges.

**The Cognito user is only half of it.** The database needs a matching
`team_members` row, or row-level security will correctly show that user
nothing at all:

```sql
INSERT INTO agencies (id, name)
VALUES (gen_random_uuid(), 'Street Medicine Detroit')
RETURNING id;  -- keep this

INSERT INTO teams (agency_id, name) VALUES ('<agency-id>', 'Team A')
RETURNING id;  -- keep this

INSERT INTO team_members (team_id, cognito_sub, display_name, role, access_tier)
VALUES ('<team-id>', '<the user''s Cognito sub>', 'Sarah Chen, RN',
        'Administrator', 'full-admin');
```

Get the sub with:

```sh
aws cognito-idp admin-get-user --user-pool-id "$POOL" \
  --username s.chen@streetmed.org \
  --query "UserAttributes[?Name=='sub'].Value" --output text
```

Deactivating someone is `UPDATE team_members SET active = false` **and**
`admin-disable-user`. Do both; the first cuts data access immediately, the
second stops new tokens being issued.

### 2.6 Alarms

```sh
aws sns subscribe --topic-arn "$(aws cloudformation describe-stacks \
  --stack-name Sineobex-prod-Observability \
  --query "Stacks[0].Outputs[?OutputKey=='AlarmTopicArn'].OutputValue" \
  --output text)" \
  --protocol email --notification-endpoint oncall@example.org
```

An unmonitored alarm is not a control.

---

## 3. Scheduled data refresh (cron-job.org)

Six jobs keep the derived data warm: analytics rollups, hotspot re-clustering,
the seasonal demand model, follow-up and low-stock alerts, and audit archival.

`cron/jobs.json` is the specification; create the jobs in the cron-job.org UI
to match it. Full mechanics, including how to test a job by hand, are in
[`../cron/README.md`](../cron/README.md).

The short version:

1. Read the signing key from the `CronSecretArn` output.
2. Create one job per entry in `jobs.json`, with the shared headers block.
3. Set the cron-job.org account timezone to **UTC** — the schedules are UTC
   and the daily jobs are placed relative to Detroit's working day.
4. Turn on failure notifications and leave response saving **off**.

**No PHI passes through cron-job.org in any job.** Each one is a doorbell that
tells the backend to recompute something it already has. That is why
cron-job.org does not need to be a business associate — and why you should
never add a job that passes a patient id.

If you would rather keep scheduling inside AWS, EventBridge Scheduler works
against the same endpoints unchanged.

---

## 4. CI/CD

Pipelines live in `.github/workflows/`. See
[`CI.md`](CI.md) for what each one does, the secrets they need, and how to set
up GitHub's OIDC trust with AWS so no long-lived access keys exist anywhere.

---

## 5. Troubleshooting

**`flutter test` fails on `sqlite3` or `SQLCipher`**
Tests use an in-memory unencrypted database and should not need SQLCipher. If
they do fail here, `flutter clean && flutter pub get` usually resolves a stale
plugin registrant.

**`cdk synth` says it needs credentials**
`CDK_DEFAULT_ACCOUNT` is set, which makes the stacks environment-specific and
triggers an availability-zone lookup. Unset it to synthesize
environment-agnostically, or supply a read-only credential for that account.
Note that `cdk synth` still writes templates when this lookup fails — it exits
non-zero without saying much, so check the exit code rather than the output
directory.

**`cdk deploy` fails with a dependency cycle**
Cross-stack `grant*` calls write into the *resource's* policy in its owning
stack. If you add one from `ApiStack` against a `DataStack` resource you will
recreate the cycle that was removed in `626afed`; attach an explicit
`PolicyStatement` to the function's role instead.

**The app signs in but every screen is empty**
Almost always a missing `team_members` row (§2.5). Row-level security is
working exactly as designed: an identity with no team membership sees nothing.
Check with `SELECT * FROM team_members WHERE cognito_sub = '<sub>';`.

**Sync never completes; the header shows a pending count that does not fall**
Check the API's CloudWatch logs for 4xx responses. The client keeps
authentication failures queued rather than discarding them, so an expired or
misconfigured token shows up as a queue that stops draining rather than as
lost data.

**Migrations fail on `CREATE EXTENSION postgis`**
Aurora PostgreSQL supports PostGIS but the extension must be creatable by your
role. Run 001 as the master user, not as `sineobex_api`.

---

## 6. Map tiles

**Status: unresolved. The default configuration is not safe for real patient
data.** This section explains why, and what to do about it.

### 6.1 What went wrong

The requirement was that OpenStreetMap power the maps. The app renders
OpenStreetMap *data*, but by default it fetches the rendered tiles from a
public CARTO CDN (`basemaps.cartocdn.com`). That was carried over from the
React prototype for visual parity and never revisited. Parity with a prototype
is not a good enough reason, and this should have been flagged during the
conversion rather than after it.

### 6.2 Why it matters more than it looks

`flutter_map` requests tiles for whatever viewport is on screen. On the patient
detail screen, that viewport is centred on a patient's recorded location. The
tile request — its `{z}/{x}/{y}` coordinates, source IP, and timing — therefore
discloses roughly where an identified individual is, to whoever serves it.

CARTO has not signed a BAA with you. Under §164.514(b)(2) geographic detail
finer than a state is an identifier, so those coordinates are PHI, and sending
them to an uncovered third party is an impermissible disclosure under §164.502.

### 6.3 Why plain OSM tiles are not the fix

Switching to `tile.openstreetmap.org` is the intuitive correction and it does
**not** work:

1. It changes *which* third party receives the patient coordinates. It does
   not stop the disclosure. The OSM Foundation has not signed a BAA either.
2. The [OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
   does not permit an application like this one. Their tile servers are donated
   infrastructure for casual and non-commercial use, with heavy or systematic
   use explicitly out of scope.

"Use OpenStreetMap" is right. "Use OpenStreetMap's servers" is not the same
statement, and only the first one is achievable here.

### 6.4 The resolution: self-hosted OSM tiles

Serve OpenStreetMap tiles from infrastructure inside your BAA-covered AWS
account. No third party sees a coordinate, OSM data still powers the map — and
this is *more* faithful to the original requirement than the CDN was, not less.

The app already reads the endpoint from build configuration, so this needs no
code change:

```sh
flutter build apk --release \
  --dart-define=SINEOBEX_TILE_URL=https://tiles.internal.example/{z}/{x}/{y}.png \
  --dart-define=SINEOBEX_TILE_ATTRIBUTION='© OpenStreetMap contributors'
```

Attribution is a condition of OpenStreetMap's ODbL and survives self-hosting —
the data is still theirs. See https://www.openstreetmap.org/copyright.

Three practical routes, cheapest first:

| Option | How | Trade-off |
|---|---|---|
| **[Protomaps](https://protomaps.com/)** | A single `.pmtiles` archive in S3, served through CloudFront. No servers to run | Simplest and cheapest. Vector tiles, so the client renders differently than raster |
| **[tileserver-gl](https://github.com/maptiler/tileserver-gl)** + [OpenMapTiles](https://openmaptiles.org/) | Container on ECS/Fargate in the VPC | Familiar raster output; you run and patch a service |
| **Pre-rendered raster in S3** | Render your service area offline, sync to a private bucket | No compute at all; only works for a bounded geography, which street medicine usually is |

Region extracts come from [Geofabrik](https://download.geofabrik.de/); the full
planet from [planet.openstreetmap.org](https://planet.openstreetmap.org/).

Because coverage is a metropolitan area rather than the planet, any of these is
small. This is a bounded piece of work, not a project.

### 6.5 Until then

`AppConfig.usesThirdPartyTiles` is true whenever the fallback endpoint is in
use. Options while a tile server is stood up, in order of preference:

1. **Stand up the tile server.** It is the only option that actually closes the
   gap, and §6.4 makes it a small job.
2. **Disable the map layers** in builds that hold real PHI. Clinical value is
   lost; legal exposure goes to zero.
3. **Coarsen the coordinates** before requesting tiles — round the map centre
   to a neighbourhood before the viewport is derived. This reduces precision
   but does not eliminate the disclosure, and it degrades exactly the
   field-navigation utility the map exists for. A stopgap, not a fix.

Do not ship the default to clinicians working with real patients.
