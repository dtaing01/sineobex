'use client';

import type { Schemas } from '@sineobex/contract';
import type { FlagChoice } from '@/lib/flags';

/**
 * A patient's Flags panel (phase 5 design 8.1): the history (the flag, set or cleared, who, when, why;
 * a change entered in error says so, with who and when, its reasons only where the API sent them,
 * to the change's author and Program Admins), Entered in error on the changes the person may mark,
 * and the form: the flag (its choices from `GET /v1/presets/flags`, an archived flag the patient
 * carries only to clear), set or clear, a reason (required, `autoComplete="off"`) and Save, posted to
 * the route handler `flags/route.ts` with the change's ID the page made once for the form (D115).
 *
 * Written ahead of its code (card P5-tests): it draws nothing until card P5-portal-panel builds it.
 * FlagsPanel.test.ts says what it must draw.
 */
export interface FlagsPanelProps {
  patientId: string;
  /** The chart's flags as the API worked them out for this reader. */
  flags: Schemas['ChartFlags'];
  /** The flag field's choices (lib/flags.ts flagChoices). */
  choices: readonly FlagChoice[];
  /** The changes the person may mark entered in error (lib/flags.ts markableChanges). */
  markable: readonly string[];
  /** `patients.edit`: the form and Entered in error are offered. */
  canEdit: boolean;
  /** The ID of the change the form makes, made once by the page for the form's life (D115). */
  changeId: string;
}

export function FlagsPanel(props: FlagsPanelProps) {
  void props;
  return null;
}
