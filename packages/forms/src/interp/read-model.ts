/**
 * A note laid out for reading (docs/design/phase-4/forms.md 7.1; lifecycle 5.1 and 9.7): its
 * sections, labels and values, with each corrected answer marked and the old value kept, so the
 * portal and the phone draw one thing. A finished note never changes; a correction writes the new
 * value and keeps the old one, shown struck through with who changed it, when and why (lifecycle
 * 3.6, PRD main 460).
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import { checkAnswer } from './check-answer.ts';
import { isBlank } from './conditions.ts';
import type { Answers } from './conditions.ts';
import { effectiveAnswers } from './effective.ts';
import { fieldAt } from './field-at.ts';
import { displayValue, layOut } from './layout.ts';
import type { Item } from './layout.ts';

/** A `note_corrections` row (lifecycle 2.3), as the API and the phone hold it. */
export type NoteCorrection = {
  outcome: 'corrected' | 'declined' | 'no_change' | 'draft_edit' | 'not_author';
  reason: string;
  correctorName: string;
  correctorCredential: string;
  correctedAt: string;
  /** Each `field` is `data.<path>`. */
  changes: readonly { field: string; oldValue: unknown; newValue: unknown }[];
};

/** An old value of an answer, kept under the new one. */
export type ReadCorrection = {
  /** The answer it changed. */
  path: string;
  /** The old value written out as the answer would be; null when there was none. */
  old: string | null;
  by: string;
  credential: string;
  at: string;
  reason: string;
};

/** `value` is null for an answer a correction took away: only its old value is shown, struck through. */
export type ReadItem = {
  path: string;
  labels: string[];
  value: string | null;
  corrections: ReadCorrection[];
};
export type ReadEntry = { id: string; title: string; items: ReadItem[] };
export type ReadSection =
  { id: string; title: string; items: ReadItem[] } | { id: string; title: string; entries: ReadEntry[] };
export type ReadModel = { sections: ReadSection[] };

/**
 * The sections with an answer that counts, in the definition's order, and in a repeating section
 * its entries that have one, titled by `itemTitle` with {n} their number among the entries that
 * are there. An item is an answer that counts (a region, a problem, and a choice with its Other
 * text are one item each), with the labels along its path and its value written out (layout.ts).
 * Nothing is left out for any reader here: the caller passes the answers the reader may see
 * (visibleAnswers).
 *
 * An item's corrections are the changes of the `corrected` corrections, in the order given, to
 * an answer the item shows; the other outcomes left the note as it was. A change to an answer that
 * does not count now (the correction cleared it, or it is in a field the correction hid) whose old
 * value was an answer is an item all the same, at its place in the definition, with value null, so
 * the old value stays visible struck through (lifecycle 3.6 and 9.7, PRD main 460). Its section,
 * or its entry when that entry is still there, is listed for it.
 *
 * PLAN-OPEN: what the visit read shows of an answer a correction took away (forms.md 10.1 #13).
 * The default built: an answer the correction cleared, or hid while changing it, is marked as
 * above. An entry a correction removed, and an answer it hid without changing it, mark nothing:
 * this sees only the answers that count now, so marking them would need the note's stored answers,
 * or the visit read laying them out from the corrections themselves.
 *
 * The corrections, like the answers, are those the reader may see: the caller leaves out a
 * correction whose old or new value holds what visibleAnswers hides from them (lifecycle 5.1).
 */
export function readModel(
  definition: ResolvedNoteType,
  answers: Answers,
  corrections: readonly NoteCorrection[],
): ReadModel {
  const byPath = new Map<string, ReadItem>();
  const toRead = (items: Item[]) =>
    items.map(({ path, labels, value, covers }) => {
      const item: ReadItem = { path, labels, value, corrections: [] };
      for (const covered of covers) byPath.set(covered, item);
      return item;
    });
  const counted = effectiveAnswers(definition, answers);
  // The answers a correction took away that had a value: laid out with none, under their old one.
  const struck = new Set<string>();
  for (const { path, oldValue: old } of changes(corrections))
    if (!Object.hasOwn(counted, path) && oldValue(definition, path, old) !== null) struck.add(path);
  const sections = layOut(definition, counted, undefined, struck).map(
    ({ section, items, entries }): ReadSection =>
      entries
        ? {
            id: section.id,
            title: section.title,
            entries: entries.map((e) => ({ id: e.id, title: e.title, items: toRead(e.items) })),
          }
        : { id: section.id, title: section.title, items: toRead(items) },
  );
  for (const { path, oldValue: old, correction } of changes(corrections))
    byPath.get(path)?.corrections.push({
      path,
      old: oldValue(definition, path, old),
      by: correction.correctorName,
      credential: correction.correctorCredential,
      at: correction.correctedAt,
      reason: correction.reason,
    });
  return { sections };
}

/** The changes to answers of the corrections that changed the note, in the order given. */
function changes(corrections: readonly NoteCorrection[]) {
  return corrections.flatMap((correction) =>
    correction.outcome !== 'corrected'
      ? []
      : correction.changes
          .filter((change) => change.field.startsWith('data.'))
          .map((change) => ({
            path: change.field.slice('data.'.length),
            oldValue: change.oldValue,
            correction,
          })),
  );
}

/** An old value written out as that answer alone would be; null for a blank, or a value it cannot hold. */
function oldValue(definition: ResolvedNoteType, path: string, value: unknown): string | null {
  // An entry's own answers have no leaf; no item shows them.
  const target = fieldAt(definition, path);
  if (!target?.leaf) return null;
  if (isBlank(value) || checkAnswer(definition, path, value) !== null) return null;
  return displayValue(target.leaf.holds, value, target.field);
}
