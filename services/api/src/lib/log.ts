/**
 * Structured logger that cannot carry patient details.
 *
 * Only keys on the allowlist are written; anything else is dropped and counted, so a careless
 * `log.info('x', { patient })` loses the field instead of leaking it. Values must be primitives,
 * and strings are truncated. There is deliberately no way to log a request or response body.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ALLOWED_KEYS = new Set([
  'requestId',
  'method',
  'route',
  'status',
  'durationMs',
  'code',
  'errorName',
  'teamId',
  'userId',
  'deviceId',
  'count',
  'accepted',
  'rejected',
  'conflicts',
  'release',
  'env',
  'port',
  'job',
]);

const MAX_STRING = 200;

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export type LogSink = (line: string) => void;

export function sanitize(fields: LogFields = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!ALLOWED_KEYS.has(key)) {
      dropped++;
      continue;
    }
    out[key] = typeof value === 'string' && value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (dropped > 0) out.droppedFields = dropped;
  return out;
}

export function createLogger(options: { level?: LogLevel; sink?: LogSink } = {}): Logger {
  const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const min = order.indexOf(options.level ?? 'info');
  // eslint-disable-next-line no-console -- the one sanctioned write to stdout
  const sink = options.sink ?? ((line: string) => console.log(line));
  const write = (level: LogLevel, event: string, fields?: LogFields) => {
    if (order.indexOf(level) < min) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level, event, ...sanitize(fields) }));
  };
  return {
    debug: (e, f) => write('debug', e, f),
    info: (e, f) => write('info', e, f),
    warn: (e, f) => write('warn', e, f),
    error: (e, f) => write('error', e, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
