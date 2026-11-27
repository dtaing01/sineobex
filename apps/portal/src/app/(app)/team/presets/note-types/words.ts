import type { CopySource } from '@/components/presets/CopySection';
import type { ReviewRow } from '@/components/presets/review';
import type {
  NoteTypeDefinition,
  NoteTypeEvent,
  NoteTypeField,
  NoteTypeGroup,
  NoteTypeKind,
  NoteTypeRow,
} from '@/lib/presets';

/**
 * The note type pages' words for what a note type is (phase 5 design 8.1): which visits offer it,
 * where the timeline files its notes and who may read them. Each is fixed when the type is made
 * (5.4, rule 2), so the pages show them and never send them, but on Add.
 */

/** A timeline group, as the phone's timeline filter names it (PRD main 725), in that order. */
export const GROUPS: Readonly<Record<NoteTypeGroup, string>> = {
  clinical: 'Clinical',
  psych: 'Psych',
  social: 'Social',
  outreach: 'Outreach',
  harm_reduction: 'Harm reduction',
  wound: 'Wound',
};

export const KIND_WORDS: Readonly<Record<NoteTypeKind, string>> = {
  medical: 'Medical',
  non_medical: 'Non-Medical',
};

/** Which visits offer it: "Medical", "Non-Medical", or "Medical and Non-Medical" (D56). */
export function visitsOf(kinds: readonly string[]): string {
  const known = (['medical', 'non_medical'] as const).filter((k) => kinds.includes(k));
  return known.length > 0 ? known.map((k) => KIND_WORDS[k]).join(' and ') : kinds.join(', ');
}

/** A group in words; a group a later API knows is named as it is sent. */
export const groupOf = (group: string): string =>
  (GROUPS as Readonly<Record<string, string>>)[group] ?? group;

/** Who may read its notes: a sensitive type needs patients.view_sensitive (forms 2.2). */
export const readersOf = (sensitivity: string): string =>
  sensitivity === 'sensitive' ? 'Only staff who may read sensitive notes' : 'Staff who read the team’s notes';

/**
 * Whose version a note type is at: Sineobex's as it made it, which the PRD calls Use as is (main 952),
 * or the team's, which a platform update never overwrites (5.2). Read from the source of the current
 * version, as its history gives it: a remove and a restore make the note type `customized` (5.1),
 * which keeps Sineobex's later versions to an offer, though the version stays Sineobex's. Without
 * the history, `customized` is all there is to go on.
 */
export function whoseOf(
  row: Pick<NoteTypeRow, 'customized' | 'version'>,
  history?: readonly Pick<NoteTypeEvent, 'version' | 'source'>[],
): string {
  const source = history?.findLast((e) => e.version === row.version)?.source;
  const sineobex = source === undefined ? !row.customized : source === 'platform';
  return sineobex ? 'Sineobex’s, used as is' : 'Your team’s';
}

/** A field's words in a list: a group's own fields after its label. */
function fieldLines(fields: readonly NoteTypeField[], within = ''): string[] {
  return fields.flatMap((f) => [
    `${within}${f.label}`,
    ...(f.kind === 'group' && f.fields ? fieldLines(f.fields, `${within}${f.label}: `) : []),
  ]);
}

/** Whether two values are the same, whatever order their keys came in. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * The review of a note type's update on offer (8.1): what the note type is, then each section with
 * its title and its fields' words, the team's version now beside Sineobex's new one, each row the
 * update changes marked. A section either holds is shown, so nothing the update adds or leaves out
 * goes unshown; a title the update gives a section is shown beside the one it has now, and a change
 * below a field's words (an option, a mark) marks its section.
 */
export function noteTypeReviewRows(now: NoteTypeDefinition, update: NoteTypeDefinition): ReviewRow[] {
  const facts: ReviewRow[] = [
    {
      field: 'title',
      label: 'Title',
      now: now.title,
      update: update.title,
      changes: now.title !== update.title,
    },
    {
      field: 'kinds',
      label: 'Which visits',
      now: visitsOf(now.kinds),
      update: visitsOf(update.kinds),
      changes: visitsOf(now.kinds) !== visitsOf(update.kinds),
    },
    {
      field: 'group',
      label: 'Timeline group',
      now: groupOf(now.group),
      update: groupOf(update.group),
      changes: now.group !== update.group,
    },
    {
      field: 'sensitivity',
      label: 'Who may read it',
      now: readersOf(now.sensitivity),
      update: readersOf(update.sensitivity),
      changes: now.sensitivity !== update.sensitivity,
    },
  ];
  const ids = [...new Set([...now.sections.map((s) => s.id), ...update.sections.map((s) => s.id)])];
  const sections = ids.map((id): ReviewRow => {
    const a = now.sections.find((s) => s.id === id);
    const b = update.sections.find((s) => s.id === id);
    return {
      field: `section:${id}`,
      label: `Section: ${(b ?? a)!.title}`,
      now: a ? [`Its title: ${a.title}`, ...fieldLines(a.fields)] : 'Not in it',
      update: b ? [`Its title: ${b.title}`, ...fieldLines(b.fields)] : 'Not in it',
      changes: !same(a, b),
    };
  });
  return [...facts, ...sections];
}

/**
 * What a section can be copied from on one note type's page (design 5.4's copy_section): every other
 * note type, a removed one too, each with the sections a copy from it reads, as the list gives them
 * (the platform's newest version of a platform note type, whatever the team's copy of it holds, else
 * its current version). Whether one can be copied here is the API's to say (D114).
 */
export function copySources(rows: readonly NoteTypeRow[], key: string): CopySource[] {
  return rows
    .filter((r) => r.key !== key)
    .map((r) => ({
      key: r.key,
      title: r.state === 'archived' ? `${r.title} (removed)` : r.title,
      sections: r.copySections,
    }));
}
