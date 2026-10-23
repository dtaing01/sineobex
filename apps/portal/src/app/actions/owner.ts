'use server';

import type { Schemas } from '@sineobex/contract';
import { revalidatePath } from 'next/cache';
import { api, PortalApiError, unwrap } from '@/lib/api';
import { formValues, type ActionState } from '@/lib/forms';

function failure(err: unknown, values: Record<string, string>): ActionState {
  if (err instanceof PortalApiError) return { error: err.message, values };
  throw err;
}

export async function createTeam(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'name');
  try {
    await unwrap((await api({ team: false })).POST('/v1/owner/teams', { body: { name: values.name ?? '' } }));
  } catch (err) {
    return failure(err, values);
  }
  revalidatePath('/owner');
  return { ok: true, message: `Team “${values.name}” created.` };
}

export async function appointAdmin(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'teamId', 'email', 'displayName', 'credential');
  try {
    await unwrap(
      (await api({ team: false })).POST('/v1/owner/teams/{teamId}/program-admins', {
        params: { path: { teamId: values.teamId ?? '' } },
        body: {
          email: values.email ?? '',
          displayName: values.displayName ?? '',
          credential: 'none' as Schemas['Credential'],
        },
      }),
    );
  } catch (err) {
    return failure(err, values);
  }
  revalidatePath('/owner');
  return { ok: true, message: `${values.displayName} is now a Program Admin.` };
}

export async function setTeamStatus(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'teamId', 'status', 'reason');
  try {
    await unwrap(
      (await api({ team: false })).POST('/v1/owner/teams/{teamId}/status', {
        params: { path: { teamId: values.teamId ?? '' } },
        body: { status: values.status as 'active' | 'suspended', reason: values.reason ?? '' },
      }),
    );
  } catch (err) {
    return failure(err, values);
  }
  revalidatePath('/owner');
  return { ok: true, message: values.status === 'suspended' ? 'Team suspended.' : 'Team reinstated.' };
}
