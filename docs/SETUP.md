# Setup

Everything needed to go from a fresh clone to a running system. Read the
section you need; they are ordered by how soon you will need them.

Mobile store setup is long enough to live on its own — see
[`MOBILE_RELEASE.md`](MOBILE_RELEASE.md).

> **Before anything touches real patient data**, read
> [`HIPAA.md`](HIPAA.md) in full, including its Known Gaps section. A signed
> Business Associate Addendum with AWS is a prerequisite, not a follow-up.

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

`npm run synth` needs AWS credentials only to look up the VPC's availability
zones. Everything else renders offline.

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
Only to resolve the VPC's availability zones, because the stacks name a
concrete account and region. Any valid read-only credential for the target
account is enough.

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
