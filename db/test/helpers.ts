import postgres, { type Sql, type TransactionSql } from 'postgres';

/** Runs `fn` as the application role inside a transaction with the given request context. */
export async function asApp<T>(
  appUrl: string,
  ctx: { teamId?: string | null; userId?: string | null; platform?: boolean },
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const sql = postgres(appUrl, { max: 1, onnotice: () => {} });
  try {
    return (await sql.begin(async (tx) => {
      await tx`select set_config('app.team_id', ${ctx.teamId ?? ''}, true),
                      set_config('app.user_id', ${ctx.userId ?? ''}, true),
                      set_config('app.scope', ${ctx.platform ? 'platform' : ''}, true)`;
      return fn(tx);
    })) as T;
  } finally {
    await sql.end();
  }
}

export async function makeTeam(owner: Sql, name: string): Promise<string> {
  const [row] = await owner<
    { id: string }[]
  >`insert into sineobex.teams (name) values (${name}) returning id`;
  return row!.id;
}

export async function makeUser(owner: Sql, email: string): Promise<string> {
  const [row] = await owner<{ id: string }[]>`
    insert into sineobex.users (email, display_name, auth_issuer, auth_subject)
    values (${email}, ${email.split('@')[0]!}, 'https://idp.test', ${email}) returning id`;
  return row!.id;
}

export async function addMember(
  owner: Sql,
  teamId: string,
  userId: string,
  roleKey: string,
): Promise<string> {
  const [row] = await owner<{ id: string }[]>`
    insert into sineobex.team_memberships (team_id, user_id, role_id)
    select ${teamId}, ${userId}, id from sineobex.roles where key = ${roleKey} and team_id is null
    returning id`;
  return row!.id;
}
