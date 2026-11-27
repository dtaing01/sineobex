import type { Schemas } from '@sineobex/contract';

/**
 * Which credential signs and which attests: a copy of the sign and attest columns of the API's
 * credential table (services/api/src/auth/permissions.ts, CAPABILITIES; lifecycle 3.5), held to it by
 * credentials.test.ts. It decides only which links the navigation shows. The API decides every act,
 * every queue and every count.
 */
export const CREDENTIAL_ACTS: Record<Schemas['Credential'], { sign: boolean; attest: boolean }> = {
  attending: { sign: true, attest: true },
  resident: { sign: true, attest: false },
  np: { sign: true, attest: false },
  pa: { sign: true, attest: false },
  student: { sign: false, attest: false },
  chw: { sign: false, attest: false },
  none: { sign: false, attest: false },
};

/**
 * The queues a person may open (lifecycle 5.4, 6.1, 9.14): each needs a role that charts and a
 * credential that does its act, as the queue's route asks. A credential the portal doesn't know does
 * neither.
 */
export function queueLinks(team: Pick<Schemas['MyTeam'], 'credential' | 'permissions'> | null): {
  cosign: boolean;
  attest: boolean;
} {
  if (!team?.permissions.includes('encounters.chart')) return { cosign: false, attest: false };
  const acts = Object.hasOwn(CREDENTIAL_ACTS, team.credential) ? CREDENTIAL_ACTS[team.credential] : null;
  return { cosign: acts?.sign ?? false, attest: acts?.attest ?? false };
}
