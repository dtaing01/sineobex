import postgres, { type Sql, type TransactionSql } from 'postgres';

export type Tx = TransactionSql<Record<string, never>>;

/** Who a transaction runs for. Sets the values row-level security policies read. */
export interface TxContext {
  teamId?: string | null;
  userId?: string | null;
  /** Owner actions and scheduled jobs that must cross teams. Never set by request handlers. */
  platform?: boolean;
}

export interface Database {
  tx<T>(ctx: TxContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createSql(url: string, options: { max?: number; prepare?: boolean } = {}): Sql {
  return postgres(url, {
    max: options.max ?? 5,
    prepare: options.prepare ?? true,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: 'sineobex-api' },
    // Column names only. postgres.camel would also rewrite keys inside jsonb values, which would
    // corrupt form data and audit details.
    transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
  });
}

export function createDatabase(sql: Sql): Database {
  return {
    async tx<T>(ctx: TxContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      const result = await sql.begin(async (raw) => {
        const tx = raw as unknown as Tx;
        // set_config(..., true) is `set local`: the values vanish when the transaction ends,
        // so a pooled connection never carries one request's team into the next.
        await tx`
          select set_config('app.team_id', ${ctx.teamId ?? ''}, true),
                 set_config('app.user_id', ${ctx.userId ?? ''}, true),
                 set_config('app.scope', ${ctx.platform ? 'platform' : ''}, true)
        `;
        return fn(tx);
      });
      return result as T;
    },
    async ping() {
      await sql`select 1`;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
