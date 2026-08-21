# CI/CD

Four workflows in `.github/workflows/`. Everything they run is reproducible
locally with one command — CI that tests something you cannot run on your own
machine is a guessing game when it fails.

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | PR, push to `main` | Analyze, test, build; typecheck and synth infra; run the database suite |
| `security.yml` | PR, push, weekly | Dependency audit, secret scan, PHI guards |
| `deploy-infra.yml` | Manual only | Deploys the CDK stacks via OIDC |
| `release-mobile.yml` | Tag `v*`, or manual | Signed builds to Play internal and TestFlight |

---

## 1. `ci.yml`

Seven jobs. `ci-passed` aggregates the rest, so branch protection has one
required check to point at and adding a job later does not mean editing the
protection rule.

**`workflows`** — runs `actionlint` over `.github/workflows/`. This is first
because a malformed workflow fails in the least helpful way GitHub has: the
run reports **zero jobs** and a bare "startup failure", with no line number
and nothing in the logs. A generic YAML parser will not catch it — GitHub
expressions have no double-quoted string literal, so `join(needs.*.result,
" ")` is valid YAML and an invalid workflow. That exact mistake cost a red
run on the pull request that introduced these pipelines.

Run it yourself before pushing a workflow change:

```sh
curl -sSLo - https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_linux_amd64.tar.gz \
  | tar xz actionlint && ./actionlint .github/workflows/*.yml
```

**`app`** — `dart format --set-exit-if-changed`, `flutter analyze`,
`flutter test` (101 tests, with coverage), and a release web build to prove
the Dart compiles for a real target. It also asserts that the synthetic
patient dataset defaults to *off*, which is a compile-time gate and therefore
a real guarantee rather than a convention.

**`android-build` / `ios-build`** — compile for each mobile target. Both are
unsigned; they answer "does it build", not "is it releasable". The iOS job
additionally asserts that `PrivacyInfo.xcprivacy` made it into the bundle.
Merely having the file on disk is not enough — it has to be registered in the
Xcode project's Copy Bundle Resources phase, which it now is. Without it the
App Store rejects the upload days later at submission rather than here. This
check caught exactly that on its first run.

**`infra`** — `tsc --noEmit`, then `cdk synth` with `CDK_DEFAULT_ACCOUNT`
unset, so the stacks synthesize environment-agnostically and need no AWS
credentials at all. Asserts all five
stacks rendered, and that `ApiStack` is not wired to the master database
credential. That last check exists because a master-credential connection is a
superuser, a superuser bypasses row-level security entirely, and nothing else
in the pipeline would notice.

**`database`** — the one worth the most. Spins up `postgis/postgis:16-3.4`,
applies all three migrations from scratch, and asserts 41 properties:

- Row-level security isolates teams, refuses cross-team reads *and* writes,
  revokes deletes outright, and **fails closed** when no actor is set — the
  case where a handler forgets to call `setActor()`.
- Encounters cannot be updated or deleted. Audit rows cannot be deleted.
- The audit trigger fires on a patient update without the application's help,
  attributed to the acting user.
- `updated_at` is forced to server time regardless of what a client sends,
  which is what makes the sync cursor safe against device clock skew.
- Every scheduled-job query executes, is idempotent on a second run, and
  produces no patient identifiers in its output.

This suite exists because four SQL bugs shipped past code review in this
repository: two `text = uuid` comparisons that failed on every cron run, an
unscoped `CROSS JOIN` that leaked one team's inventory state to another, and
an upsert that aborted on duplicate keys. None were visible to a typechecker.

Run it yourself with `infra/test/run.sh`.

---

## 2. `deploy-infra.yml` — AWS OIDC setup

Deployment authenticates with **OIDC**: GitHub exchanges a short-lived token
for an AWS role. There are no AWS access keys in this repository's secrets and
there should never be — a long-lived key in CI cannot be rotated quickly and
does not appear in CloudTrail as a distinct identity.

### 2.1 Create the identity provider

Once per AWS account:

```sh
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 2.2 Create the role

The trust policy must pin **both** the repository and the ref. A wildcard on
`sub` would let any branch in any of your repositories assume a role that can
change production infrastructure.

```sh
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=dtaing01/sineobex

cat > trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": [
          "repo:$REPO:ref:refs/heads/main",
          "repo:$REPO:environment:dev",
          "repo:$REPO:environment:prod"
        ]
      }
    }
  }]
}
EOF

aws iam create-role \
  --role-name SineobexGitHubDeploy \
  --assume-role-policy-document file://trust.json \
  --max-session-duration 3600
```

### 2.3 Grant permissions

CDK assumes its own bootstrap roles, so the GitHub role only needs permission
to assume those — not broad administrative access:

```sh
cat > policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "sts:AssumeRole",
    "Resource": "arn:aws:iam::$ACCOUNT:role/cdk-*"
  }]
}
EOF

aws iam put-role-policy \
  --role-name SineobexGitHubDeploy \
  --policy-name AssumeCdkBootstrapRoles \
  --policy-document file://policy.json
```

### 2.4 Wire it to GitHub

- Repository secret `AWS_DEPLOY_ROLE_ARN` =
  `arn:aws:iam::<account>:role/SineobexGitHubDeploy`
- Repository variable `AWS_REGION` = your region
- Create GitHub **Environments** named `dev` and `prod`. Add **required
  reviewers** to `prod`.

That approval gate is what stands between a `workflow_dispatch` and a
production database. The workflow also requires the operator to retype the
stage name as confirmation, which catches the wrong-dropdown mistake but is
not a substitute for the reviewer.

### 2.5 What deployment does not do

**Migrations are not run by CI.** The database has no route from the internet,
and a schema change against a system holding PHI should be a decision someone
makes at a terminal with the runbook open. See [`SETUP.md`](SETUP.md) §2.3.

---

## 3. `release-mobile.yml`

Triggered by a `v*` tag, or manually per platform.

Secrets are listed in [`MOBILE_RELEASE.md`](MOBILE_RELEASE.md) §3, plus
`FLUTTER_CONFIG_PROD` — the contents of a `config/prod.json` matching
`app/config/example.env.json`.

Both jobs refuse to build if `SINEOBEX_DEMO_SEED` is true in that config. The
Android job additionally inspects the signed bundle and fails if it carries
the Android debug certificate.

Neither store's **production** track is reachable from CI. The Play service
account is scoped to testing tracks, and the iOS job stops at TestFlight.
Promoting a build to clinicians working with real patients should take a
person deciding to.

Signing material is written to disk only for the duration of the job. The iOS
job creates a dedicated keychain and deletes it in an `always()` step, rather
than importing into the shared runner's login keychain.

---

## 4. `security.yml`

**`dependencies`** — `npm audit --audit-level=high` on the infrastructure, and
`flutter pub outdated` reported without failing. Dart has no severity-rated
audit feed, so that half is information for a human rather than a gate.

**`secrets`** — gitleaks across full history.

**`phi-guard`** — four repository-specific invariants that are easy to break
by accident and expensive to discover later:

1. No patient identifier interpolated into a URL path. Bodies are not logged;
   paths land in API Gateway access logs, CloudFront logs, and browser
   history, all retained far longer than the request.
2. `LOG_BODIES` is not enabled anywhere.
3. No build flag in `app_config.dart` defaults to true.
4. No cron job payload references patient data — cron-job.org is not a
   business associate and must never be in a position to need one.

These are greps, not proofs. They catch the specific regressions this codebase
is prone to; they are not a security review.

---

## 5. Recommended branch protection

On `main`:

- Require the **`CI passed`** status check.
- Require the **`Secret scan`** and **`PHI guard`** checks.
- Require a pull request before merging, with at least one approval.
- Require branches to be up to date before merging.
- Do not allow force pushes.

---

## 6. Local reproduction

Everything CI runs, on your own machine:

```sh
# app
cd app && flutter pub get
dart format --set-exit-if-changed lib test
flutter analyze lib test
flutter test
flutter build web --release --no-wasm-dry-run

# infra
cd ../infra && npm ci
npx tsc --noEmit
npm run synth

# database (needs PostgreSQL 16 + PostGIS 3 running)
cd .. && infra/test/run.sh
```
