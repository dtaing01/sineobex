# Scheduled data refresh

Sineobex's derived data — analytics rollups, geographic clusters, the seasonal
demand model, and the notification queue — is recomputed on a schedule by
[cron-job.org](https://cron-job.org) calling authenticated endpoints on the
API.

`jobs.json` is the source of truth for what runs and when. It is a
specification, not something cron-job.org imports: create the jobs in their UI
(or via their API) to match it, and keep the two in step.

## Why an external scheduler

EventBridge Scheduler would keep everything inside AWS, and if you would
rather use it, the endpoints are unchanged — point a scheduled rule at the
same Lambda. cron-job.org was specified for this project, and it works fine
here because **the jobs carry no data**. Each one is a doorbell: it tells the
backend to recompute something the backend already has. The scheduler never
sees a patient.

## Security model

cron-job.org cannot hold a Cognito session, so `/cron/*` is unauthenticated at
API Gateway and authenticates inside the Lambda instead:

1. Every request carries `x-sineobex-timestamp` (Unix milliseconds) and
   `x-sineobex-signature`.
2. The signature is `HMAC-SHA256("{timestamp}.{body}", key)`, hex-encoded.
3. The key lives in Secrets Manager. Read it once from the `CronSecretArn`
   stack output and paste it into cron-job.org; it is never transmitted.
4. The Lambda recomputes the signature and compares with `timingSafeEqual`,
   not `===` — a byte-wise string comparison leaks the signature to anyone who
   can time the response.
5. Requests whose timestamp is more than five minutes from server time are
   rejected even with a valid signature, so a captured request cannot be
   replayed tomorrow.

**No PHI in any job.** Not in the URL, not in the headers, not in the body,
not in the response. Response saving is switched off in cron-job.org for the
same reason: today's responses are counts, but a stored response body is a
place PHI could leak into later. If you ever find yourself wanting to pass a
patient id to a cron job, the job belongs inside AWS instead.

## Setting up

1. Deploy the stacks: `cd infra && npm run deploy`.
2. Read the signing key:
   ```sh
   aws secretsmanager get-secret-value \
     --secret-id "$(aws cloudformation describe-stacks \
        --stack-name Sineobex-prod-Api \
        --query "Stacks[0].Outputs[?OutputKey=='CronSecretArn'].OutputValue" \
        --output text)" \
     --query SecretString --output text
   ```
3. Create one cron-job.org job per entry in `jobs.json`, using the shared
   headers and settings blocks.
4. Set the cron-job.org account timezone to **UTC** — the schedules in
   `jobs.json` are UTC, and the daily jobs are deliberately placed relative to
   Detroit's working day.
5. Enable failure notifications. A silently dead rollup job means the Insights
   screen quietly goes stale, which is worse than an obviously broken one.

## Verifying a job by hand

```sh
BODY='{"nonce":"manual-test"}'
TS=$(date +%s000)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$CRON_KEY" -hex | awk '{print $2}')

curl -sS -X POST "https://api.sineobex.org/cron/analytics-rollup" \
  -H "content-type: application/json" \
  -H "x-sineobex-timestamp: $TS" \
  -H "x-sineobex-signature: $SIG" \
  -d "$BODY"
```

A wrong or stale signature returns `401` and logs the source IP and the
reason, without echoing the signature.

## Idempotency

Every job is safe to run twice. Rollups upsert, clustering upserts, and the
notification jobs deduplicate on a time window (20 hours for follow-ups, 24
for low stock). If a job times out on cron-job.org's side and retries, nothing
is double-counted and nobody is notified twice.
