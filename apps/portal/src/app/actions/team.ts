'use server';

import type { Schemas } from '@sineobex/contract';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, PortalApiError, unwrap } from '@/lib/api';
import { fieldLabel, formValues, type ActionState } from '@/lib/forms';

type Credential = Schemas['Credential'];
const CREDENTIAL_FIELDS = [
  'school',
  'supervisingPhysician',
  'npi',
  'program',
  'supervisingAttending',
  'licenseNumber',
  'licenseState',
] as const;

function credentialFields(form: FormData): Schemas['CredentialFields'] {
  const out: Record<string, string> = {};
  for (const f of CREDENTIAL_FIELDS) {
    const v = String(form.get(f) ?? '').trim();
    if (v) out[f] = v;
  }
  return out;
}

/** Turns an API refusal into form errors, mapping field problems onto the fields. */
function failure(err: unknown, values: Record<string, string>): ActionState {
  if (!(err instanceof PortalApiError)) throw err;
  const fieldErrors: Record<string, string> = {};
  const problems = (err.details?.problems ?? []) as { field: string; problem: string }[];
  for (const p of problems) {
    fieldErrors[p.field] =
      p.problem === 'missing'
        ? `${fieldLabel(p.field)} is required for this credential.`
        : `${fieldLabel(p.field)} doesn’t look right.`;
  }
  const fields = (err.details?.fields ?? []) as { path: string }[];
  for (const f of fields) {
    const name = f.path.split('.').at(-1) ?? f.path;
    fieldErrors[name] ??= `Check ${fieldLabel(name)}.`;
  }
  return { error: err.message, fieldErrors, values };
}

const ALL_FIELDS = ['email', 'displayName', 'roleId', 'credential', 'reason', ...CREDENTIAL_FIELDS];

export async function inviteMember(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, ...ALL_FIELDS);
  let member;
  try {
    member = await unwrap(
      (await api()).POST('/v1/team/members', {
        body: {
          email: values.email ?? '',
          displayName: values.displayName ?? '',
          roleId: values.roleId ?? '',
          credential: (values.credential ?? 'none') as Credential,
          credentialFields: credentialFields(form),
        },
      }),
    );
  } catch (err) {
    return failure(err, values);
  }
  revalidatePath('/team/members');
  return {
    ok: true,
    message: `${member.displayName} was invited. They will get an email to set a password.`,
  };
}

export async function changeRole(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'membershipId', 'roleId', 'reason');
  try {
    await unwrap(
      (await api()).PUT('/v1/team/members/{membershipId}/role', {
        params: { path: { membershipId: values.membershipId ?? '' } },
        body: { roleId: values.roleId ?? '', reason: values.reason ?? '' },
      }),
    );
  } catch (err) {
    return failure(err, values);
  }
  revalidatePath(`/team/members/${values.membershipId}`);
  return { ok: true, message: 'Role changed. The change and your reason are in the audit log.' };
}

export async function changeCredential(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'membershipId', 'credential', 'reason', ...CREDENTIAL_FIELDS);
  let result;
  try {
    result = await unwrap(
      (await api()).PUT('/v1/team/members/{membershipId}/credential', {
        params: { path: { membershipId: values.membershipId ?? '' } },
        body: {
          credential: (values.credential ?? 'none') as Credential,
          credentialFields: credentialFields(form),
          reason: values.reason ?? '',
        },
      }),
    );
  } catch (err) {
    return failure(err, values);
  }
  revalidatePath(`/team/members/${values.membershipId}`);
  return {
    ok: true,
    message:
      result.direction === 'down'
        ? 'Credential lowered. The permissions it removed stopped working immediately.'
        : 'Credential updated. It takes effect now.',
  };
}

export async function removeMember(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'membershipId', 'reason');
  try {
    await unwrap(
      (await api()).POST('/v1/team/members/{membershipId}/remove', {
        params: { path: { membershipId: values.membershipId ?? '' } },
        body: { reason: values.reason ?? '' },
      }),
    );
  } catch (err) {
    return failure(err, values);
  }
  revalidatePath('/team/members');
  redirect('/team/members?removed=1');
}

export async function createRole(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'name', 'description');
  const permissions = form.getAll('permissions').map(String) as Schemas['Permission'][];
  if (permissions.length === 0)
    return {
      error: 'Choose at least one permission.',
      fieldErrors: { permissions: 'Choose at least one.' },
      values,
    };
  try {
    await unwrap(
      (await api()).POST('/v1/team/roles', {
        body: {
          name: values.name ?? '',
          ...(values.description ? { description: values.description } : {}),
          permissions,
        },
      }),
    );
  } catch (err) {
    return failure(err, values);
  }
  revalidatePath('/team/roles');
  return { ok: true, message: `Role “${values.name}” created.` };
}
