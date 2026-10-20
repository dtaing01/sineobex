import type { Config } from './config.ts';
import type { Database } from './db/database.ts';
import type { TokenVerifier } from './auth/verifier.ts';
import type { Logger } from './lib/log.ts';

/** Everything the API needs from the outside world. Entry points (Node, Deno, tests) build this. */
export interface Deps {
  config: Config;
  db: Database;
  verifier: TokenVerifier;
  log: Logger;
  /** Injected so tests can move time (24-hour alerts, clock checks, token expiry). */
  now: () => Date;
}

export interface AppVariables {
  requestId: string;
}

export interface AppEnv {
  Variables: AppVariables;
}
