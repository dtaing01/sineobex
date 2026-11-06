import 'server-only';
import type { Schemas } from '@sineobex/contract';
import { cache } from 'react';
import { api, getSession, unwrap } from './api';

export type Me = Schemas['Me'];
export type MyTeam = Schemas['MyTeam'];

/** The signed-in person and the team they're acting in. Cached for one render. */
export const currentUser = cache(async (): Promise<{ me: Me; team: MyTeam | null }> => {
  const me = await unwrap((await api({ team: false })).GET('/v1/me'));
  const session = await getSession();
  const team = me.teams.find((t) => t.teamId === session.teamId) ?? null;
  return { me, team };
});

export function can(team: MyTeam | null, permission: MyTeam['permissions'][number]): boolean {
  return team?.permissions.includes(permission) ?? false;
}
