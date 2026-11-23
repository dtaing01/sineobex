/**
 * What a team's edit of a note type may not touch, and what every operation shares: how it names a
 * part, how it makes a version with one part changed, the copy it makes of a part it carries over,
 * the words it may write and the ids it makes (phase 5 design 5.4; BM-73).
 *
 * A definition has no `locked` mark, so what is protected is worked out from phase 4's marks (forms
 * 2.2), by one function (`protects`): every part of a note type with `auto` (Red flags, disposition
 * and follow-up, PRD main 409); a field with `required` or `noNormal` (the red-flag question,
 * sensitive-exam consent and chaperone, PRD main 415); a section with `needs`; a field of kind
 * `action`, `problem`, `photo` or `info`; an option carrying `exclusive`, `normal`, `unable`,
 * `other`, `suggests` or `sensitiveExam`, and every option of a protected field. Hiding a section
 * or a group that holds a protected field is refused too. Every operation of edit.ts,
 * edit-options.ts and edit-add.ts asks this file, and the admin list answers it for each section,
 * field and option (design 7).
 *
 * No operation writes a mark (rule 1): a part it carries from another version or another note type
 * is copied whole (`copyPart`), a part it changes keeps everything but the words it changes, and a
 * part it makes carries none.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedField, ResolvedGroupField, ResolvedNoteType, ResolvedSection } from './resolve.ts';
import type { Option } from './types.ts';

/**
 * A part of a note type, as an operation and the admin list name it: a section by its id; a field
 * by its path, the entry part of a repeating section left out (`supplies.pack.bags`); an option of
 * a choice field by that field's path and the option's code.
 */
export type NoteTypePart = { section: string } | { path: string } | { path: string; code: string };

/** Every protected part of one definition, as the admin list answers it for the editor (design 7). */
export type ProtectedParts = {
  /** Section ids: a section with `needs`, and every section of an `auto` note type. */
  sections: string[];
  /**
   * Field paths, at every depth but a grid's cell, in the order written: a field protected by its
   * own marks or kind, a grid whose cell is, and every field of a protected section.
   */
  fields: string[];
  /** The options of choice fields: every option of a protected field, and each marked option. */
  options: { path: string; code: string }[];
};

/** The field kinds an edit never touches: nothing a team types can stand in for them. */
export const PROTECTED_FIELD_KINDS = ['action', 'problem', 'photo', 'info'] as const;

/** The marks that protect an option: what one-tap Normal, the exam picker and the summary read. */
export const PROTECTED_OPTION_MARKS = [
  'exclusive',
  'normal',
  'unable',
  'other',
  'suggests',
  'sensitiveExam',
] as const;

// ------------------------------------------------------------------------------------------------
// Naming a part

/** Where a field is: its section, the groups around it (the outermost first), and the fields beside it. */
export type FieldPlace = {
  section: ResolvedSection;
  groups: readonly ResolvedGroupField[];
  field: ResolvedField;
  /** The fields of its section, or of its group: itself among them, at `index`. */
  siblings: readonly ResolvedField[];
  index: number;
};

/** Where fields are written: a section, or a group in it at the end of `groups`. */
export type FieldsPlace = Pick<FieldPlace, 'section' | 'groups'>;

/** The section or the group a path's parts name, `[section id, ...group ids]`, or undefined. */
export function fieldsAt(definition: ResolvedNoteType, parts: readonly string[]): FieldsPlace | undefined {
  const [sectionId, ...ids] = parts;
  const section = definition.sections.find((s) => s.id === sectionId);
  if (!section) return undefined;
  const groups: ResolvedGroupField[] = [];
  let fields: readonly ResolvedField[] = section.fields;
  for (const id of ids) {
    const group = fields.find((f) => f.id === id);
    if (group?.kind !== 'group') return undefined;
    groups.push(group);
    fields = group.fields;
  }
  return { section, groups };
}

/**
 * The field `path` names: its section's id, the id of each group around it, then its own. A grid's
 * cell has no path of its own, and no path names it; nor does a section's id alone.
 */
export function fieldPlace(definition: ResolvedNoteType, path: string): FieldPlace | undefined {
  const parts = path.split('.');
  const own = parts.pop();
  if (parts.length === 0) return undefined;
  const place = fieldsAt(definition, parts);
  if (!place) return undefined;
  const siblings = place.groups.at(-1)?.fields ?? place.section.fields;
  const index = siblings.findIndex((f) => f.id === own);
  return index < 0 ? undefined : { ...place, field: siblings[index]!, siblings, index };
}

/**
 * `definition` with the fields of the section or group at `place` as `change` gives them back: that
 * section and each group on the way are new, and every other part is the one `definition` holds.
 * Nothing is changed in place, so a definition an operation is given stays as it was.
 */
export function withFields(
  definition: ResolvedNoteType,
  place: FieldsPlace,
  change: (fields: readonly ResolvedField[]) => ResolvedField[],
): ResolvedNoteType {
  const within = (fields: readonly ResolvedField[], depth: number): ResolvedField[] => {
    const group = place.groups[depth];
    if (!group) return change(fields);
    return fields.map((f) => (f === group ? { ...group, fields: within(group.fields, depth + 1) } : f));
  };
  return {
    ...definition,
    sections: definition.sections.map((s) =>
      s === place.section ? { ...s, fields: within(s.fields, 0) } : s,
    ),
  };
}

/**
 * A part an operation carries into a new version from another version or another note type:
 * copied whole, so every mark comes with it as it was (rule 1), and made the version's own. Not
 * structuredClone, for the resolver's reason (resolve.ts): two fields sharing a list would still
 * share one array.
 */
export function copyPart<T>(part: T): T {
  if (Array.isArray(part)) return part.map(copyPart) as T;
  if (part === null || typeof part !== 'object') return part;
  return Object.fromEntries(Object.entries(part).map(([key, child]) => [key, copyPart(child)])) as T;
}

// ------------------------------------------------------------------------------------------------
// What is protected

const kindProtected: ReadonlySet<string> = new Set(PROTECTED_FIELD_KINDS);

/** Protected by its own marks or kind, or a grid whose cell is. */
function marked(field: ResolvedField): boolean {
  if (field.required !== undefined || field.noNormal !== undefined) return true;
  if (kindProtected.has(field.kind)) return true;
  return field.kind === 'grid' && marked(field.cell);
}

const optionMarked = (option: Option): boolean =>
  PROTECTED_OPTION_MARKS.some((mark) => option[mark] !== undefined);

/**
 * The one rule (5.4): whether an edit may not touch this section, this field of it, or this option
 * of the field. Read from the marks alone, so what a copied section brings stays protected.
 */
// PLAN-OPEN (BM-73): may an admin hide a required field, a consent or chaperone field, or anything in
// the Red flags note, and may an edit change who may read a section? No to both: these parts are
// protected here, and no operation writes a mark, since who may read a note and what is required of
// it rest on the marks.
function protects(
  definition: ResolvedNoteType,
  part: { section: ResolvedSection; field?: ResolvedField; option?: Option },
): boolean {
  if (typeProtected(definition)) return true;
  // Only a credential with the capability sets these answers; nothing a team adds can stand in for it.
  if (part.section.needs !== undefined) return true;
  if (part.field !== undefined && marked(part.field)) return true;
  return part.option !== undefined && optionMarked(part.option);
}

/** The fields inside a field at any depth: a group's fields, a grid's cell and what the cell holds. */
function inside(field: ResolvedField): ResolvedField[] {
  const children = field.kind === 'group' ? field.fields : field.kind === 'grid' ? [field.cell] : [];
  return children.flatMap((child) => [child, ...inside(child)]);
}

const holdsMarked = (fields: readonly ResolvedField[]): boolean =>
  fields.some((field) => marked(field) || inside(field).some(marked));

/**
 * Whether an edit may touch nothing of the note type, its title and what an operation would add to
 * it included: every part of an `auto` one, since the server refuses to finish a Medical note
 * without it (lifecycle 3.3). Every operation asks it first, before what it names is looked up.
 */
export function typeProtected(definition: ResolvedNoteType): boolean {
  return definition.auto !== undefined;
}

/**
 * Whether an edit may not touch `part` itself (5.4). A part the definition does not have is not
 * protected: the operation that names it is refused `not_found` instead. Hiding a section or a
 * group that holds a protected field is refused too, which `holdsProtected` answers.
 */
export function isProtected(definition: ResolvedNoteType, part: NoteTypePart): boolean {
  if ('section' in part) {
    const section = definition.sections.find((s) => s.id === part.section);
    return section !== undefined && protects(definition, { section });
  }
  const place = fieldPlace(definition, part.path);
  if (!place) return false;
  if (!('code' in part)) return protects(definition, place);
  if (place.field.kind !== 'choice') return false;
  const option = place.field.options.find((o) => o.code === part.code);
  return option !== undefined && protects(definition, { ...place, option });
}

/** Whether the section or field `part` names holds a protected field at any depth, or is one. */
export function holdsProtected(definition: ResolvedNoteType, part: NoteTypePart): boolean {
  if ('code' in part) return isProtected(definition, part);
  if ('section' in part) {
    const section = definition.sections.find((s) => s.id === part.section);
    return section !== undefined && (protects(definition, { section }) || holdsMarked(section.fields));
  }
  const place = fieldPlace(definition, part.path);
  return place !== undefined && (protects(definition, place) || inside(place.field).some(marked));
}

/** Every protected section, field and option of the definition, as `isProtected` answers each. */
export function protectedParts(definition: ResolvedNoteType): ProtectedParts {
  const parts: ProtectedParts = { sections: [], fields: [], options: [] };
  for (const section of definition.sections) {
    if (protects(definition, { section })) parts.sections.push(section.id);
    const walk = (fields: readonly ResolvedField[], prefix: string) => {
      for (const field of fields) {
        const path = `${prefix}.${field.id}`;
        if (protects(definition, { section, field })) parts.fields.push(path);
        if (field.kind === 'choice')
          for (const option of field.options)
            if (protects(definition, { section, field, option }))
              parts.options.push({ path, code: option.code });
        if (field.kind === 'group') walk(field.fields, path);
      }
    };
    walk(section.fields, section.id);
  }
  return parts;
}

// ------------------------------------------------------------------------------------------------
// What an operation writes and makes

/**
 * Whether `value` is words the schema takes (its `text`, schema/definition.schema.json, which the
 * API cannot load): a character at least that is not white space, and no control character and no
 * half of a surrogate pair, read by code point as the schema's pattern is.
 */
export function isWords(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  let seen = false;
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (point <= 0x1f || point === 0x7f || (point >= 0xd800 && point <= 0xdfff)) return false;
    if (!/\s/u.test(char)) seen = true;
  }
  return seen;
}

/** An id or a code the server made: `t_` and a number (rule 3). */
const MADE = /^t_(\d+)$/;

// A definition never changes once made, and every version is read again for each id an operation makes.
const highest = new WeakMap<ResolvedNoteType, bigint>();

/** The highest number of a made id or code in `value`, at any depth, or `above` when that is higher. */
function highestIn(value: unknown, above: bigint): bigint {
  if (Array.isArray(value)) return value.reduce<bigint>((n, child) => highestIn(child, n), above);
  if (value === null || typeof value !== 'object') return above;
  let n = above;
  for (const [key, child] of Object.entries(value)) {
    const made = (key === 'id' || key === 'code') && typeof child === 'string' ? MADE.exec(child) : null;
    if (made) n = BigInt(made[1]!) > n ? BigInt(made[1]!) : n;
    else n = highestIn(child, n);
  }
  return n;
}

/**
 * The ids and codes one operation makes, in the order it makes them (rule 3): `t_` and the lowest
 * number above every made id and code any of `definitions` uses, as a section's or a field's id or
 * an option's code. Handed every version of the note type and the version being made, it never
 * makes again the id of a hidden field or the code of a retired option.
 */
export function madeIds(definitions: readonly ResolvedNoteType[]): () => string {
  let n = 0n;
  for (const definition of definitions) {
    let own = highest.get(definition);
    if (own === undefined) {
      own = highestIn(definition.sections, 0n);
      highest.set(definition, own);
    }
    if (own > n) n = own;
  }
  return () => `t_${(n += 1n)}`;
}

/** Every made id and code `definition` uses, in any part: what a copied section may not bring (rule 3). */
export function madeIn(definition: ResolvedNoteType): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        if ((key === 'id' || key === 'code') && typeof child === 'string' && MADE.test(child))
          found.add(child);
        else walk(child);
      }
  };
  walk(definition.sections);
  return found;
}
