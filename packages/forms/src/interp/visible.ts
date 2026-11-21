/**
 * Who may read what in a note (docs/design/phase-4/lifecycle.md 6.4; forms.md 6.6 and 7.1): one
 * function, applied wherever a note is read by someone, on the server and on the phone. What a
 * reader may not see is absent, with nothing left that hints at it, never blanked.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import type { Answers } from './conditions.ts';
import { effectiveAnswers } from './effective.ts';
import { fieldAt } from './field-at.ts';
import { withoutSensitiveExams } from './sensitive-exams.ts';

/** A range of the sensitive diagnosis codes, as phase 3 lists them (sensitive-codes.ts). */
export type SensitiveCodeRange = { readonly from: string; readonly to: string };

/** Five facts about the person reading, worked out by the caller from their keys and credential. */
export type NoteReader = {
  /** Acts as the note's author (lifecycle 3.8): sees all of it. */
  actsAsAuthor: boolean;
  /** patients.view_sensitive. */
  viewSensitive: boolean;
  /** patients.view_sensitive_exams. */
  viewSensitiveExams: boolean;
  /** patients.view with encounters.chart or billing.view_codes: may read a Medical note. */
  readsMedical: boolean;
  /** A credential with chartMedical. */
  chartsMedical: boolean;
  /**
   * A credential that orders medications. A `needs` section is shown to every reader: `needs`
   * decides who may change an answer (lifecycle 6.4 rule 5), so this changes nothing here.
   */
  ordersMedications: boolean;
  /** The sensitive diagnosis codes. */
  sensitiveCodes: readonly SensitiveCodeRange[];
};

/**
 * The answers that count (effectiveAnswers) that `reader` may see, in the same order, or null
 * when they may not see the note at all: a Medical note (offered for Medical only) to a reader
 * who does not read Medical notes, or a sensitive note type to a reader without view_sensitive.
 * Whoever acts as the author sees every answer that counts. Otherwise:
 *
 *  - without view_sensitive_exams, everything a sensitive exam put there (sensitive-exams.ts);
 *  - without view_sensitive and a clinical credential, every answer of a `treatmentRecord` section;
 *  - without view_sensitive, a diagnosis whose code is sensitive, with what the note asks about
 *    it: its entry, or outside a repeating section its section.
 *
 * Which answers count is worked out on the whole note first, so a reader never sees an answer
 * that does not count for the author.
 */
export function visibleAnswers(
  definition: ResolvedNoteType,
  answers: Answers,
  reader: NoteReader,
): Record<string, unknown> | null {
  const counted = effectiveAnswers(definition, answers);
  if (reader.actsAsAuthor) return counted;
  if (!definition.kinds.includes('non_medical') && !reader.readsMedical) return null;
  if (definition.sensitivity === 'sensitive' && !reader.viewSensitive) return null;

  const seen = reader.viewSensitiveExams ? counted : withoutSensitiveExams(definition, counted);
  const treatment = reader.viewSensitive && reader.chartsMedical;
  const hidden = reader.viewSensitive ? [] : sensitiveDiagnoses(definition, counted, reader.sensitiveCodes);
  return Object.fromEntries(
    Object.entries(seen).filter(([path]) => {
      if (!treatment && fieldAt(definition, path)?.section.treatmentRecord) return false;
      return !hidden.some((prefix) => path.startsWith(prefix));
    }),
  );
}

/**
 * Where each sensitive diagnosis's answers are: the start of every path of its entry or section.
 * `counted` are answers that count. The EMS handoff leaves them out for every reader (handoff.ts).
 */
export function sensitiveDiagnoses(
  definition: ResolvedNoteType,
  counted: Record<string, unknown>,
  ranges: readonly SensitiveCodeRange[],
): string[] {
  const prefixes: string[] = [];
  for (const [path, value] of Object.entries(counted)) {
    const target = fieldAt(definition, path);
    if (target?.field?.kind !== 'problem' || target.part !== 'code') continue;
    if (!isSensitiveCode(value as string, ranges)) continue;
    const section = target.section.id;
    prefixes.push(target.entry === null ? `${section}.` : `${section}.${target.entry}.`);
  }
  return prefixes;
}

/**
 * Phase 3's rule (services/api/src/sync/entities/problem.ts, isSensitiveCode): a code is sensitive
 * when its first characters, as many as the range's `from` has, sort between `from` and `to`.
 * Only the code decides, as on the problem list: a diagnosis with no code is not sensitive.
 */
export function isSensitiveCode(code: string, ranges: readonly SensitiveCodeRange[]): boolean {
  return ranges.some((range) => {
    const head = code.slice(0, range.from.length);
    return head >= range.from && head <= range.to;
  });
}
