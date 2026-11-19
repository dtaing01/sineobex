import type { Schemas } from '@sineobex/contract';
import { formatDateTime } from './labels';
import type { SignAct } from './sign';

/**
 * The portal's work lists for phase 4 (lifecycle 3.7, 5.4, 5.6, 9.12, 9.14): the co-sign and
 * attestation queues, the team's incomplete notes and Home's counts, worded. Pure functions of what
 * the API answered: which visits, notes and numbers a person gets, the API has decided.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Home's count for a Program Admin (9.12): "4 notes not complete. 2 are older than a day." */
export function incompleteText(total: number, overdue: number): string {
  if (total === 0) return 'No notes are incomplete.';
  const older = overdue > 0 ? ` ${plural(overdue, 'is', 'are')} older than a day.` : '';
  return `${plural(total, 'note', 'notes')} not complete.${older}`;
}

/** Home's count of a queue: the visits that wait, as the API counts them. */
export function waitingText(visits: number, act: SignAct): string {
  const what = act === 'cosign' ? 'a co-signature' : 'attestation';
  if (visits === 0) return `No visits wait for ${what}.`;
  return `${plural(visits, 'visit waits', 'visits wait')} for ${what}.`;
}

/** A patient as a list names them: the preferred name the API gives, never one made up. */
export function patientName(preferredName: string | null, patientId: string | null): string {
  return patientId ? (preferredName ?? 'No name recorded') : 'No patient recorded';
}

/**
 * A note in a queue (5.4): its title, then who signed or attested it before when a correction sent
 * it back, first (3.7), who wrote it and when it was completed, and, when the API says this person
 * may not act on it, that someone else has to. Why is the visit page's to say (`heldBecause`).
 */
export function queueNoteLines(note: Schemas['QueueNote'], act: SignAct): { title: string; lines: string[] } {
  const lines: string[] = [];
  if (note.signedBefore || note.attestedBefore) {
    lines.push(
      [
        'Back after a correction.',
        note.signedBefore && `Signed before by ${note.signedBefore.displayName}.`,
        note.attestedBefore && `Attested before by ${note.attestedBefore.displayName}.`,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
  lines.push(
    `Written by ${note.author.displayName}${note.completedAt ? `, completed ${formatDateTime(note.completedAt)}` : ''}.`,
  );
  if (!note.canAct) lines.push(`Someone else has to ${act === 'cosign' ? 'co-sign' : 'attest'} it.`);
  return { title: note.title || 'Note', lines };
}
