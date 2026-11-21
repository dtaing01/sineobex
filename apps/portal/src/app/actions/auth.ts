'use server';

import { createApiClient } from '@sineobex/contract';
import { redirect } from 'next/navigation';
import { api, getSession, safeNext, unwrap } from '@/lib/api';
import { AuthError, authProvider, type Tokens } from '@/lib/auth';
import { apiBaseUrl } from '@/lib/env';
import { formValues, type ActionState } from '@/lib/forms';
import type { SessionData } from '@/lib/session';
import type { IronSession } from 'iron-session';

type Session = IronSession<SessionData>;

function clear(session: Session): void {
  for (const key of Object.keys(session) as (keyof SessionData)[]) delete session[key];
}

const CODE = /^\d{6}$/;

function authFailure(err: unknown, values?: Record<string, string>): ActionState {
  if (err instanceof AuthError) return { error: err.message, ...(values ? { values } : {}) };
  throw err;
}

export async function signIn(_: ActionState, form: FormData): Promise<ActionState> {
  const values = formValues(form, 'email');
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(form.get('password') ?? '');
  const fieldErrors: Record<string, string> = {};
  if (!email) fieldErrors.email = 'Enter your email address.';
  if (!password) fieldErrors.password = 'Enter your password.';
  if (Object.keys(fieldErrors).length > 0) return { error: 'Fill in both fields.', fieldErrors, values };

  let result;
  try {
    result = await authProvider().signIn(email, password);
  } catch (err) {
    return authFailure(err, values);
  }
  const session = await getSession();
  clear(session);
  if (result.status === 'signed_in') {
    await startSession(session, result.tokens, null);
    redirect('/select-team');
  }
  session.pending = {
    tokens: result.tokens,
    factorId: result.status === 'mfa_challenge' ? result.factorId : null,
  };
  await session.save();
  redirect(result.status === 'mfa_challenge' ? '/sign-in/mfa' : '/sign-in/mfa/enroll');
}

async function startSession(session: Session, tokens: Tokens, factorId: string | null): Promise<void> {
  const now = Date.now();
  session.tokens = tokens;
  if (factorId) session.factorId = factorId;
  session.startedAt = now;
  session.lastActivity = now;
  delete session.pending;
  // One team: go straight in. Several: the person chooses.
  const me = await unwrap(
    createApiClient({ baseUrl: apiBaseUrl(), token: tokens.accessToken }).GET('/v1/me'),
  );
  if (me.teams.length === 1) session.teamId = me.teams[0]!.teamId;
  await session.save();
}

export async function verifyCode(_: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get('code') ?? '').replace(/\s/g, '');
  if (!CODE.test(code))
    return { error: 'Enter the 6-digit code.', fieldErrors: { code: 'The code is 6 digits.' } };
  const session = await getSession();
  const pending = session.pending;
  if (!pending?.factorId) redirect('/sign-in');
  let tokens: Tokens;
  try {
    tokens = await authProvider().verifyMfa(pending.tokens, pending.factorId, code);
  } catch (err) {
    return authFailure(err);
  }
  await startSession(session, tokens, pending.factorId);
  redirect('/home');
}

export async function beginEnrollment(): Promise<void> {
  const session = await getSession();
  if (!session.pending) redirect('/sign-in');
  const enrollment = await authProvider().startEnrollment(session.pending.tokens);
  session.pending = { ...session.pending, enrollment };
  await session.save();
  redirect('/sign-in/mfa/enroll');
}

export async function finishEnrollment(_: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get('code') ?? '').replace(/\s/g, '');
  if (!CODE.test(code))
    return {
      error: 'Enter the 6-digit code from your authenticator app.',
      fieldErrors: { code: 'The code is 6 digits.' },
    };
  const session = await getSession();
  const enrollment = session.pending?.enrollment;
  if (!session.pending || !enrollment) redirect('/sign-in');
  let tokens: Tokens;
  try {
    tokens = await authProvider().verifyMfa(session.pending.tokens, enrollment.factorId, code);
  } catch (err) {
    return authFailure(err);
  }
  await startSession(session, tokens, enrollment.factorId);
  redirect('/home');
}

/** Step-up before admin actions and exports: re-enter the authenticator code. */
export async function reauthenticate(_: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get('code') ?? '').replace(/\s/g, '');
  const next = safeNext(String(form.get('next') ?? ''));
  if (!CODE.test(code))
    return { error: 'Enter the 6-digit code.', fieldErrors: { code: 'The code is 6 digits.' } };
  const session = await getSession();
  if (!session.tokens || !session.factorId) redirect('/sign-in');
  try {
    session.tokens = await authProvider().verifyMfa(session.tokens, session.factorId, code);
  } catch (err) {
    return authFailure(err);
  }
  await session.save();
  redirect(next);
}

export async function signOut(): Promise<void> {
  const session = await getSession();
  if (session.tokens)
    await authProvider()
      .signOut(session.tokens)
      .catch(() => undefined);
  clear(session);
  session.destroy();
  redirect('/sign-in?ended=signed_out');
}

export async function acknowledge(_: ActionState, form: FormData): Promise<ActionState> {
  const client = await api({ team: false });
  const me = await unwrap(client.GET('/v1/me'));
  const missing = me.pendingAcknowledgements.filter((a) => form.get(a.kind) !== 'on');
  if (missing.length > 0) {
    return {
      error: 'Tick both boxes to continue.',
      fieldErrors: Object.fromEntries(missing.map((a) => [a.kind, 'Required to use Sineobex.'])),
    };
  }
  for (const a of me.pendingAcknowledgements) {
    await unwrap(client.POST('/v1/me/acknowledgements', { body: { kind: a.kind, version: a.version } }));
  }
  redirect('/select-team');
}

export async function selectTeam(form: FormData): Promise<void> {
  const teamId = String(form.get('teamId') ?? '');
  const me = await unwrap((await api({ team: false })).GET('/v1/me'));
  if (!me.teams.some((t) => t.teamId === teamId)) redirect('/select-team?problem=not_a_member');
  const session = await getSession();
  session.teamId = teamId;
  await session.save();
  redirect('/home');
}

/** "Stay signed in" from the idle warning. The proxy has already refreshed lastActivity. */
export async function stayActive(): Promise<void> {}
