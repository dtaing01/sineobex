import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Pool, PoolClient } from 'pg';

const secrets = new SecretsManagerClient({});

let pool: Pool | undefined;
let cachedSecret: { username: string; password: string } | undefined;

async function credentials() {
  if (cachedSecret) return cachedSecret;
  const arn = process.env.DB_SECRET_ARN;
  if (!arn) throw new Error('DB_SECRET_ARN is not set');

  const result = await secrets.send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  if (!result.SecretString) throw new Error('Database secret has no value');
  cachedSecret = JSON.parse(result.SecretString);
  return cachedSecret!;
}

/**
 * A connection pool scoped to the Lambda execution environment.
 *
 * `max: 2` because Aurora Serverless has a finite connection budget and a
 * burst of cold Lambdas can exhaust it faster than the cluster scales. Two
 * per environment is enough for the request concurrency a single Lambda sees.
 */
export async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const { username, password } = await credentials();

  pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME,
    user: username,
    password,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // The cluster parameter group sets rds.force_ssl=1, so this is required,
    // not optional. Aurora presents an AWS-managed certificate.
    ssl: { rejectUnauthorized: true },
  });

  pool.on('error', (err) => {
    // Never log the error's query text — it can contain PHI.
    console.error('Idle client error', { name: err.name });
    cachedSecret = undefined;
  });

  return pool;
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await (await getPool()).connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Binds the caller's identity to the transaction so the audit trigger can
 * attribute every row change without each query having to pass an actor.
 */
export async function setActor(client: PoolClient, actorSub: string) {
  await client.query('SELECT set_config($1, $2, true)', [
    'sineobex.actor',
    actorSub,
  ]);
}
