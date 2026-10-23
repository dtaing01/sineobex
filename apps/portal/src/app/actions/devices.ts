'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, PortalApiError, unwrap } from '@/lib/api';
import { formValues, type ActionState } from '@/lib/forms';

function failure(err: unknown, values: Record<string, string>): ActionState {
  if (!(err instanceof PortalApiError)) throw err;
  const fieldErrors: Record<string, string> = {};
  for (const f of (err.details?.fields ?? []) as { path: string }[]) {
    if (f.path.endsWith('reason')) fieldErrors.reason = 'Give a reason of at least 3 characters.';
  }
  return { error: err.message, fieldErrors, values };
}

/** Remote wipe of a lost or stolen phone (module 9). The API requires a recent sign-in. */
export async function wipeDevice(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'deviceId', 'reason');
  try {
    await unwrap(
      (await api()).POST('/v1/team/devices/{deviceId}/wipe', {
        params: { path: { deviceId: values.deviceId ?? '' } },
        body: { reason: values.reason ?? '' },
      }),
    );
  } catch (err) {
    return failure(err, values);
  }
  revalidatePath('/team/devices');
  return {
    ok: true,
    message: 'Wipe requested. The phone erases this team’s data the next time it reaches the server.',
  };
}

/** Accept a quarantined change onto the chart, or reject it; both need a reason. */
export async function decideQuarantine(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'itemId', 'decision', 'reason', 'person', 'after', 'page');
  const decision = values.decision;
  // Never assumed: accepting writes to a patient's chart and can't be undone.
  if (decision !== 'accept' && decision !== 'reject') {
    return {
      error: 'Choose whether to accept or reject it.',
      fieldErrors: { decision: 'Choose accept or reject.' },
      values,
    };
  }
  try {
    await unwrap(
      (await api()).POST('/v1/team/quarantine/{itemId}/decision', {
        params: { path: { itemId: values.itemId ?? '' } },
        body: { decision, reason: values.reason ?? '' },
      }),
    );
  } catch (err) {
    return failure(err, values);
  }
  revalidatePath('/team/quarantine');
  // The decided item leaves the list, and its form with it; the page confirms instead, still
  // showing the person and page the admin was reviewing (the page checks each value).
  const view = new URLSearchParams();
  for (const key of ['person', 'after', 'page']) if (values[key]) view.set(key, values[key]);
  view.set('decided', decision === 'accept' ? 'accepted' : 'rejected');
  redirect(`/team/quarantine?${view}`);
}
