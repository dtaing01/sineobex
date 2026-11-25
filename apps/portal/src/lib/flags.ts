import 'server-only';
import type { Schemas } from '@sineobex/contract';
import { api, unwrap } from './api';
import { flagRefusal, refusalRedirect, type FlagAct } from './refusals';

/**
 * The portal's calls for a patient's flags (phase 5 design 7, 8.1): the flag list the Flags panel
 * and the search filters choose from, the two acts the panel's route handlers post, and what the
 * patient page works out from the chart for the panel. The API applies the flag rule to every one
 * (D114): the portal holds no copy of it. A flag the person may not see is in neither the list nor
 * the chart, so nothing here, nor in the panel, decides who sees what.
 */

export type ListedFlag = Schemas['ListedFlag'];
type Chart = Schemas['PatientChart'];

/** What a flag act's API answered: done, or refused with its status, code and details. */
export type FlagActOutcome =
  { done: true } | { refused: { status: number; code: string; details?: Record<string, unknown> } };

/**
 * The team's active flags the person may see (`GET /v1/presets/flags`), by tier and rank, as the API
 * gives them. A refusal is the page's (`unwrap`).
 */
export async function listFlags(): Promise<ListedFlag[]> {
  return unwrap((await api()).GET('/v1/presets/flags', {}));
}

/** A refused call, as the panel's sentences read it: its status, code and, where sent, details. */
function refusedOf(error: unknown, status: number): FlagActOutcome {
  const body = (error as { error?: { code?: unknown; details?: unknown } } | undefined)?.error;
  const details = body?.details;
  return {
    refused: {
      status,
      code: typeof body?.code === 'string' ? body.code : 'error',
      ...(details !== null && typeof details === 'object'
        ? { details: details as Record<string, unknown> }
        : {}),
    },
  };
}

/**
 * Sets or clears a flag on the patient (`POST /v1/patients/{patientId}/flags`), with [body]'s `id`
 * as the page made it once for the form (D115): a retry after a dropped answer sends the same id,
 * and gets the first answer, never a second change.
 */
export async function changeFlag(
  patientId: string,
  body: { id: string; flagId: string; action: 'set' | 'clear'; reason: string },
): Promise<FlagActOutcome> {
  const { error, response } = await (
    await api()
  ).POST('/v1/patients/{patientId}/flags', { params: { path: { patientId } }, body });
  return response.ok ? { done: true } : refusedOf(error, response.status);
}

/**
 * Marks a flag change entered in error
 * (`POST /v1/patients/{patientId}/flag-changes/{changeId}/entered-in-error`). A mark already made,
 * as a retry after a dropped answer finds it (409 `already_marked`), is done.
 */
export async function markFlagChange(
  patientId: string,
  changeId: string,
  reason: string,
): Promise<FlagActOutcome> {
  const { error, response } = await (
    await api()
  ).POST('/v1/patients/{patientId}/flag-changes/{changeId}/entered-in-error', {
    params: { path: { patientId, changeId } },
    body: { reason },
  });
  if (response.ok) return { done: true };
  const refused = refusedOf(error, response.status);
  return 'refused' in refused && refused.refused.code === 'already_marked' ? { done: true } : refused;
}

/** One choice of the panel's flag field: a flag the person may set, or one the patient carries. */
export interface FlagChoice {
  flagId: string;
  name: string;
  tier: Schemas['FlagTier'];
  color: string;
  colorName: string;
  /** An archived flag the patient carries: offered only to clear (5.1). */
  clearOnly: boolean;
  /** The patient carries it now. */
  carried: boolean;
}

/**
 * What the panel's flag field offers: each listed flag (active, and one the person may see), by
 * tier and rank as listed, then each flag the patient carries that the list doesn't hold, from the
 * chart's flags, offered only to clear: one removed from the team's list (5.1), as the chart says. A
 * flag the person may not see is in neither, so it is never offered. Pure.
 */
export function flagChoices(listed: readonly ListedFlag[], chart: Chart): FlagChoice[] {
  const carried = [...(chart.flags?.primary ? [chart.flags.primary] : []), ...(chart.flags?.secondary ?? [])];
  const carriedIds = new Set(carried.map((f) => f.flagId));
  const listedIds = new Set(listed.map((f) => f.flagId));
  return [
    ...listed.map((f) => ({
      flagId: f.flagId,
      name: f.name,
      tier: f.tier,
      color: f.color,
      colorName: f.colorName,
      clearOnly: false,
      carried: carriedIds.has(f.flagId),
    })),
    ...carried
      .filter((f) => !listedIds.has(f.flagId))
      .map((f) => ({
        flagId: f.flagId,
        name: f.name,
        tier: f.tier,
        color: f.color,
        colorName: f.colorName,
        clearOnly: true,
        carried: true,
      })),
  ];
}

/**
 * The changes in the chart's flag history the person may mark entered in error: with
 * `patients.edit`, their own (the chart's `flagChanges` name each one's author) or, holding
 * `team.manage_users`, anyone's; never one marked already (section 11, rows 23 and 24). The API
 * checks the same again, and refuses. Pure.
 */
export function markableChanges(
  chart: Chart,
  me: { userId: string; permissions: readonly string[] },
): string[] {
  if (!me.permissions.includes('patients.edit')) return [];
  // PLAN-OPEN (PL-19): who counts as a Program Admin, to mark someone else's flag change entered in
  // error, with no new keys? A holder of team.manage_users, as phase 4's assign reads it; the API
  // decides the same (services/api/src/patients/flags.ts), and this only offers the button.
  const anyone = me.permissions.includes('team.manage_users');
  return (chart.flagChanges ?? [])
    .filter((c) => c.status !== 'entered_in_error' && (anyone || c.authorUserId === me.userId))
    .map((c) => c.id);
}

// ------------------------------------------------------------------------------------------------
// The route handlers' side (D115): what the panel posts, and what it is told
// ------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A reason as the phone trims it, so the API never refuses one for a space at either end: the
 * spaces and line ends JavaScript trims, and U+0085, which Dart trims too (records.ts untrimmed).
 */
export const trimReason = (reason: string): string => reason.replace(/^[\s\u0085]+|[\s\u0085]+$/g, '');

/**
 * Set or clear, as the panel posts it: the change's ID made once for the form, the flag, set or
 * clear, and the reason, trimmed. Null for anything the panel never posts. The reason's bounds are
 * the API's (reason_invalid), said in the panel's words.
 */
export function flagChangeRequest(
  body: unknown,
): { id: string; flagId: string; action: 'set' | 'clear'; reason: string } | null {
  if (!isRecord(body)) return null;
  const { id, flagId, action, reason } = body;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (typeof flagId !== 'string' || !UUID.test(flagId)) return null;
  if (action !== 'set' && action !== 'clear') return null;
  if (typeof reason !== 'string') return null;
  return { id, flagId, action, reason: trimReason(reason) };
}

/** Entered in error, as the panel posts it: the reason, trimmed. Null for anything else. */
export function flagMarkRequest(body: unknown): { reason: string } | null {
  if (!isRecord(body) || typeof body.reason !== 'string') return null;
  return { reason: trimReason(body.reason) };
}

/** What a flag act's route handler answers the panel. */
export type FlagAnswer =
  | { ok: true }
  // The refusal in the panel's words, and the field it is about, where it is about one.
  | { ok: false; error: string; field?: 'flagId' | 'reason'; code?: string }
  // A refusal that asks the person to do something first: where the browser goes.
  | { ok: false; redirect: string };

/**
 * What the panel is told once the API has answered [act]: done, a refusal in plain words beside its
 * field, or, for a refusal that asks something of the person first (signed out, a suspended team),
 * where the browser goes, back to the patient after. A 403 is said in words, never sent home: for a
 * mark it means the change is someone else's (section 11, row 23).
 */
export function flagAnswer(act: FlagAct, patientId: string, outcome: FlagActOutcome): FlagAnswer {
  if ('done' in outcome) return { ok: true };
  const { status, code, details } = outcome.refused;
  const go = code === 'forbidden' ? null : refusalRedirect(code, `/patients/${patientId}`);
  if (go) return { ok: false, redirect: go };
  return { ok: false, code, ...flagRefusal(act, status, code, details) };
}
