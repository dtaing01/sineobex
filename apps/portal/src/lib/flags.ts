import 'server-only';
import type { Schemas } from '@sineobex/contract';

/**
 * The portal's calls for a patient's flags (phase 5 design 7, 8.1): the flag list the Flags panel
 * and the search filters choose from, the two acts the panel's route handlers post, and what the
 * patient page works out from the chart for the panel. The API applies the flag rule to every one
 * (D114): the portal holds no copy of it.
 *
 * Written ahead of its code (card P5-tests): every call throws until card P5-portal-panel builds it.
 * src/lib/flags.test.ts says what each must do.
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
  throw new Error('P5-portal-panel');
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
  throw new Error(`P5-portal-panel ${patientId} ${body.id}`);
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
  throw new Error(`P5-portal-panel ${patientId} ${changeId} ${reason.length}`);
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
 * tier and rank as listed, then each archived flag the patient carries, from the chart's flags,
 * offered only to clear. Pure.
 */
export function flagChoices(listed: readonly ListedFlag[], chart: Chart): FlagChoice[] {
  throw new Error(`P5-portal-panel ${listed.length} ${chart.canonicalId}`);
}

/**
 * The changes in the chart's flag history the person may mark entered in error: with
 * `patients.edit`, their own (the chart's `flagChanges` name each one's author) or, holding
 * `team.manage_users`, anyone's; never one marked already. Pure.
 */
export function markableChanges(
  chart: Chart,
  me: { userId: string; permissions: readonly string[] },
): string[] {
  throw new Error(`P5-portal-panel ${chart.canonicalId} ${me.userId}`);
}
