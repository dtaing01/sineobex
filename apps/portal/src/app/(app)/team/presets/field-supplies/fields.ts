import type { AnswerTest, NoteTypeDefinition, NoteTypeField, NoteTypeOption } from '@/lib/presets';

/**
 * Where a field supply mapping may fire, read from a note type's definition as GET
 * /v1/admin/note-types lists it (phase 5 design 4.4, 8.1): each field and each grid cell a note holds
 * an answer at, by the path a mapping writes (its entry part left out, as `mapsTo` writes one), with
 * the words the note type shows for it. The page names a mapping's field and answer by these words,
 * offers them to choose from, and says where a mapping's field or answer has left the note type's
 * current version. Nothing here judges a mapping: the API does (D114), and answers a field it refuses
 * with its sentence.
 */

/** What a note holds at a place, as far as a mapping fires on it; null where it fires on none. */
export type Holds =
  | { type: 'choice'; many: boolean; options: readonly NoteTypeOption[] }
  | { type: 'tick' }
  | { type: 'number'; unit?: string }
  /** A text, a date or a duration: a mapping fires on any answer there. */
  | { type: 'any' };

/** A field, or a grid's cell, of a note type. */
export interface AnswerPlace {
  /** As a mapping writes it: a field's ids from its section's, a grid cell's with its row's code. */
  path: string;
  /** Its section's title. */
  section: string;
  /** Its words within the section: "Wound treatment: Dressing", "Status for each vaccine: Flu". */
  label: string;
  holds: Holds | null;
}

/** Every field and grid cell of the definition that holds an answer, in the order the note shows them. */
export function placesOf(definition: NoteTypeDefinition): AnswerPlace[] {
  const places: AnswerPlace[] = [];
  for (const section of definition.sections)
    walk(definition, places, section.title, section.fields, [section.id], [], false);
  return places;
}

/** The field or grid cell a mapping's path names in the definition, or null when it has none there. */
export function placeAt(definition: NoteTypeDefinition, path: string): AnswerPlace | null {
  return placesOf(definition).find((p) => p.path === path) ?? null;
}

function walk(
  definition: NoteTypeDefinition,
  places: AnswerPlace[],
  section: string,
  fields: readonly NoteTypeField[],
  at: readonly string[],
  within: readonly string[],
  sided: boolean,
) {
  for (const field of fields) {
    const path = [...at, field.id];
    if (field.kind === 'group') {
      walk(definition, places, section, field.fields ?? [], path, [...within, field.label], sided);
      continue;
    }
    if (field.kind === 'grid') {
      const cell = field.cell as NoteTypeField | undefined;
      if (!cell) continue;
      // A grid's cell has no path part of its own: each row's answer is at the grid's path and the
      // row's code (forms 2.3). A grid with sides holds its cells' answers by side.
      for (const row of rowsOf(definition, field)) {
        const rowAt = [...path, row.code];
        const rowWithin = [...within, field.label, row.label];
        if (cell.kind === 'group')
          walk(
            definition,
            places,
            section,
            cell.fields ?? [],
            rowAt,
            rowWithin,
            sided || field.sides === true,
          );
        else
          places.push({
            path: rowAt.join('.'),
            section,
            label: rowWithin.join(': '),
            holds: holdsOf(cell, sided || field.sides === true),
          });
      }
      continue;
    }
    places.push({
      path: path.join('.'),
      section,
      label: [...within, field.label].join(': '),
      holds: holdsOf(field, sided),
    });
  }
}

/** A grid's rows: its own, or the options of the field that picks them (`rows: {pickedIn}`). */
function rowsOf(definition: NoteTypeDefinition, grid: NoteTypeField): readonly NoteTypeOption[] {
  const rows = grid.rows as NoteTypeOption[] | { pickedIn?: unknown } | undefined;
  if (Array.isArray(rows)) return rows;
  const picker = typeof rows?.pickedIn === 'string' ? fieldAt(definition, rows.pickedIn) : null;
  return picker?.options ?? [];
}

/** A field by its path of ids, its entry part left out, through groups; null when there is none. */
function fieldAt(definition: NoteTypeDefinition, path: string): NoteTypeField | null {
  const [sectionId, ...ids] = path.split('.');
  let fields: readonly NoteTypeField[] | undefined = definition.sections.find(
    (s) => s.id === sectionId,
  )?.fields;
  let found: NoteTypeField | null = null;
  for (const id of ids) {
    found = fields?.find((f) => f.id === id) ?? null;
    if (!found) return null;
    fields = found.fields;
  }
  return found;
}

// What the page offers follows the kinds validatePreset maps (BM-71, packages/presets): a choice, a
// tick or a number, and for any answer a text, a date or a duration. A field with sides holds one
// answer for each side, and a region, a diagnosis, a time, a photo or a button none a mapping fires
// on. The API judges whatever is sent.
function holdsOf(field: NoteTypeField, sided: boolean): Holds | null {
  if (sided || field.sides === true) return null;
  switch (field.kind) {
    case 'choice':
      return { type: 'choice', many: field.many === true, options: field.options ?? [] };
    case 'flag':
      return { type: 'tick' };
    case 'number':
      return { type: 'number', ...(typeof field.unit === 'string' ? { unit: field.unit } : {}) };
    case 'text':
    case 'date':
    case 'duration':
      return { type: 'any' };
    default:
      return null;
  }
}

// ------------------------------------------------------------------------------------------------
// The answer a mapping fires on
// ------------------------------------------------------------------------------------------------

/** An answer a form offers for a field, as the body's `when` holds it: a test and its value as sent. */
export interface AnswerChoice {
  kind: 'answered' | 'equals' | 'includes';
  /** The value as the form posts it: an option's code, `true` for a tick, a number; empty for answered. */
  value: string;
  label: string;
}

/**
 * An answer's key among a field's answers, as the form's select names it. Here, not beside the form's
 * part, so the page's server half can call it: a function of a client module is the browser's.
 */
export const choiceKey = (c: Pick<AnswerChoice, 'kind' | 'value'>) => `${c.kind}:${c.value}`;

/** The answer a mapping's `when` holds, as the form posts it. */
export function choiceOf(when: AnswerTest): Pick<AnswerChoice, 'kind' | 'value'> {
  if ('answered' in when) return { kind: 'answered', value: '' };
  if ('includes' in when) return { kind: 'includes', value: when.includes };
  return { kind: 'equals', value: String(when.equals) };
}

/**
 * A mapping's answer in words, as its facts and its form show it: "Any answer", an option's label,
 * "Ticked", "Is 40 mmHg". A code the field no longer holds is shown as it is stored.
 */
export function describeAnswer(when: AnswerTest, holds: Holds | null): string {
  const label = (code: string) =>
    (holds?.type === 'choice' ? holds.options.find((o) => o.code === code)?.label : undefined) ?? code;
  if ('answered' in when) return holds?.type === 'tick' ? 'Ticked' : 'Any answer';
  if ('includes' in when) return label(when.includes);
  if (when.equals === true) return 'Ticked';
  if (typeof when.equals === 'number')
    return `Is ${when.equals}${holds?.type === 'number' && holds.unit ? ` ${holds.unit}` : ''}`;
  // A choose-many that is this one alone; on a choose-one, the answer itself.
  return holds?.type === 'choice' && holds.many ? `Only “${label(when.equals)}”` : label(when.equals);
}

/**
 * The answers a form offers for a field (8.1): any answer, or one of a choice's options, a choose-one
 * being that option and a choose-many holding it among others; a tick, ticked. `current`, the answer
 * a mapping holds or a refused form sent, is offered as it is when none of those is it, so a save
 * that leaves the answer alone never changes it.
 */
export function answerChoices(holds: Holds | null, current?: AnswerTest): AnswerChoice[] {
  const offered: AnswerChoice[] =
    holds?.type === 'choice'
      ? [
          { kind: 'answered', value: '', label: 'Any answer' },
          ...holds.options.map((o) => ({
            kind: holds.many ? ('includes' as const) : ('equals' as const),
            value: o.code,
            label: o.label,
          })),
        ]
      : [{ kind: 'answered', value: '', label: holds?.type === 'tick' ? 'Ticked' : 'Any answer' }];
  if (current === undefined) return offered;
  const now = choiceOf(current);
  if (offered.some((c) => c.kind === now.kind && c.value === now.value)) return offered;
  const kept = { ...now, label: describeAnswer(current, holds) };
  // A tick stores true alone, so "ticked" either way is the one choice.
  return holds?.type === 'tick' && kept.label === 'Ticked' ? [kept] : [...offered, kept];
}
