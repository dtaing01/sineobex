# Sineobex

A mobile-first street medicine outreach and patient management platform.

Outreach teams work in parks, underpasses, and shelter doorways, where there
is often no signal and rarely a desk. Sineobex is built for that: it captures
encounters offline on an encrypted device, syncs when the network returns, and
puts the field map, the caseload, and the van's inventory one tap apart.

## Repository layout

| Path | What it is |
|---|---|
| `app/` | The Flutter application — iOS and Android primary, web secondary |
| `infra/` | AWS CDK stacks, Lambda handlers, and SQL migrations |
| `cron/` | cron-job.org schedule definitions for the data refresh jobs |
| `docs/` | Conversion plan, parity review, and HIPAA notes |
| `src/`, `components/`, `lib/` | The original React prototype, retained as the parity reference |

## Running the app

```sh
cd app
flutter pub get
flutter run
```

With no backend configured the app runs entirely on-device: sign-in is not
enforced, and the sign-in screen says so rather than pretending otherwise.

To load the synthetic Detroit dataset for a demo:

```sh
flutter run --dart-define=SINEOBEX_DEMO_SEED=true
```

That data is fictional. It is off by default and must stay off in any build
that will hold real records.

To point at a deployed backend:

```sh
flutter run \
  --dart-define=SINEOBEX_API_URL=https://api.example.org/v1 \
  --dart-define=SINEOBEX_COGNITO_POOL_ID=us-east-1_XXXXXXXXX \
  --dart-define=SINEOBEX_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx \
  --dart-define=SINEOBEX_AWS_REGION=us-east-1
```

### Checks

```sh
cd app
flutter analyze
flutter test
```

## Deploying the backend

```sh
cd infra
npm install
npm run synth                       # renders CloudFormation, no AWS calls needed
npx cdk deploy --all -c stage=prod
```

Then apply the migrations in order against the cluster
(`001_initial_schema.sql`, `002_row_level_security.sql`,
`003_seed_reference_data.sql`) and configure the cron jobs per
[`cron/README.md`](cron/README.md).

`npm run synth` needs AWS credentials only to resolve the VPC's availability
zones; everything else renders offline.

## Maps

Maps are rendered with `flutter_map` over OpenStreetMap-derived CARTO Positron
tiles. The attribution shown on every map is a licence condition of both OSM
and CARTO — please leave it in place.

## Handling real patient data

This application is designed to hold protected health information, which
carries obligations that code alone cannot discharge. Read
[`docs/HIPAA.md`](docs/HIPAA.md) before deploying it anywhere near a real
patient — including its "Known gaps" section, which lists what is scaffolded
rather than finished.

A signed Business Associate Addendum with AWS is a prerequisite, not a
follow-up.

## Background

Sineobex began as a single-file React prototype (`src/App.tsx`) with all data
in memory and no backend. The conversion to Flutter is documented in
[`docs/FLUTTER_CONVERSION_PLAN.md`](docs/FLUTTER_CONVERSION_PLAN.md), and the
element-by-element parity audit against the prototype is in
[`docs/PARITY_REVIEW.md`](docs/PARITY_REVIEW.md). The React app is kept in the
repository as the reference the port was measured against.
