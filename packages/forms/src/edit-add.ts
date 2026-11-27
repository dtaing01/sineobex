/**
 * Adding to a team's note type (phase 5 design 5.4): a field at the end of a section, a section
 * with the fields it starts with, and one section copied unchanged from a platform note type or
 * another of the team's (BM-75). Every id and code the server makes is `t_` and the lowest number
 * above every one the type has used (rule 3). A team may add 40 fields and 10 sections to a type,
 * each counted over its fields and sections whose id the server made (section 11, row 39; BM-84). A
 * copy keeps every mark (rule 1), and is refused from a type of other kinds, group, sensitivity,
 * quick or auto, or of a section with `needs` (`not_copyable`), when an id it brings was used in a
 * version of the target (`id_taken`), and when phase 4's validator refuses the result (`invalid`).
 * applyNoteTypeEdit (edit.ts) hands them here.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import { canonicalJson } from './canonical.ts';
import type {
  NewField,
  NoteTypeEdit,
  NoteTypeEditCode,
  NoteTypeEditContext,
  NoteTypeEditRefusal,
  NoteTypeEditStep,
} from './edit.ts';
import { copyPart, isMadeId, isProtected, isWords, madeIds, madeIn, withFields } from './edit-protected.ts';
import { noteTypeFile } from './resolve.ts';
import type { FileProblem, ResolvedField, ResolvedNoteType, ResolvedSection } from './resolve.ts';
import { MAX_TEXT_LENGTH } from './types.ts';
import { validate } from './validate.ts';

// PLAN-OPEN (BM-84): how many fields and sections may a team add to a note type? 40 fields and 10
// sections, each counted over the type's fields and sections whose id the server made.
export const MAX_TEAM_FIELDS = 40;
// PLAN-OPEN (BM-84): the 10 sections a team may add, as above; a copy of another of the team's
// types brings its made sections, and they count.
export const MAX_TEAM_SECTIONS = 10;

type Refused = Extract<NoteTypeEditStep, { ok: false }>;
const refused = (code: NoteTypeEditCode, more: Omit<NoteTypeEditRefusal, 'code'> = {}): Refused => ({
  ok: false,
  refusal: { code, ...more },
});

/** add_field, add_section or copy_section on `definition`, as applyNoteTypeEdit answers it. */
export function applyAddEdit(
  definition: ResolvedNoteType,
  edit: Extract<NoteTypeEdit, { op: 'add_field' | 'add_section' | 'copy_section' }>,
  context: NoteTypeEditContext,
): NoteTypeEditStep {
  switch (edit.op) {
    case 'add_field':
      return addField(definition, edit, context);
    case 'add_section':
      return addSection(definition, edit, context);
    case 'copy_section':
      return copySection(definition, edit, context);
  }
}

/** Where a section goes: just after `afterSectionId`, first for null; undefined when there is no such section. */
function placeAfter(definition: ResolvedNoteType, afterSectionId: string | null): number | undefined {
  if (afterSectionId === null) return 0;
  const index = definition.sections.findIndex((s) => s.id === afterSectionId);
  return index < 0 ? undefined : index + 1;
}

const nextIds = (definition: ResolvedNoteType, context: NoteTypeEditContext) =>
  madeIds([...context.versions, definition, ...(context.taken ?? [])]);

function addField(
  definition: ResolvedNoteType,
  edit: Extract<NoteTypeEdit, { op: 'add_field' }>,
  context: NoteTypeEditContext,
): NoteTypeEditStep {
  const index = definition.sections.findIndex((s) => s.id === edit.sectionId);
  const section = definition.sections[index];
  if (!section) return refused('not_found');
  // A section with needs is set by a credential with the capability only: nothing a team adds there.
  if (isProtected(definition, { section: section.id })) return refused('protected');
  const at = `$.sections[${index}].fields[${section.fields.length}]`;
  const made = madeField(edit, nextIds(definition, context), at, definition);
  if (!made.ok) return made;
  const next = withFields(definition, { section, groups: [] }, (fields) => [...fields, made.field]);
  return overLimits(next) ?? { ok: true, definition: next, renames: [] };
}

function addSection(
  definition: ResolvedNoteType,
  edit: Extract<NoteTypeEdit, { op: 'add_section' }>,
  context: NoteTypeEditContext,
): NoteTypeEditStep {
  const index = placeAfter(definition, edit.afterSectionId);
  if (index === undefined) return refused('not_found');
  if (!isWords(edit.title)) return refused('label_invalid');
  const at = `$.sections[${index}]`;
  if (!Array.isArray(edit.fields) || edit.fields.length === 0)
    return shapeRefused(definition, `${at}.fields`, 'a section holds one field at least (forms 2.2)');
  // The section's id first, then each field's and its options' codes, in the order sent.
  const next = nextIds(definition, context);
  const id = next();
  const fields: ResolvedField[] = [];
  for (const [i, spec] of edit.fields.entries()) {
    const made = madeField(spec, next, `${at}.fields[${i}]`, definition);
    if (!made.ok) return made;
    fields.push(made.field);
  }
  // Made with no mark (rule 1): the id, the title and the fields, nothing else.
  const section: ResolvedSection = { id, title: edit.title, fields };
  const sections = [...definition.sections];
  sections.splice(index, 0, section);
  const result = { ...definition, sections };
  return overLimits(result) ?? { ok: true, definition: result, renames: [] };
}

// PLAN-OPEN (BM-75): what may a team copy into one of its note types? One section at a time,
// unchanged with its marks, from a platform note type or another of the team's, only from a type
// with the same kinds, timeline group, sensitivity, quick and auto, and never a section with needs.
function copySection(
  definition: ResolvedNoteType,
  edit: Extract<NoteTypeEdit, { op: 'copy_section' }>,
  context: NoteTypeEditContext,
): NoteTypeEditStep {
  // The platform's newest released version where it ships the key, so a module it resolved in
  // comes with it; else the team's current version of another of its note types.
  const source = Object.hasOwn(context.platform, edit.fromKey)
    ? context.platform[edit.fromKey]
    : edit.fromKey === definition.key
      ? definition
      : Object.hasOwn(context.team, edit.fromKey)
        ? context.team[edit.fromKey]
        : undefined;
  const copied = source?.sections.find((s) => s.id === edit.sectionId);
  if (!source || !copied) return refused('not_found');
  const index = placeAfter(definition, edit.afterSectionId);
  if (index === undefined) return refused('not_found');
  // Who may read a note, whether it is Medical and where the timeline files it follow its type
  // (D56), and a section with needs is set by a capability: a copy changes none of them.
  if (fixedOf(source) !== fixedOf(definition) || copied.needs !== undefined) return refused('not_copyable');
  // Rule 3: a path or a code the target ever gave a meaning is never given another.
  const versions = [...context.versions, definition];
  const madeUsed = new Set(versions.flatMap((v) => [...madeIn(v)]));
  if (
    versions.some((v) => v.sections.some((s) => s.id === copied.id)) ||
    [...madeIn(copied)].some((id) => madeUsed.has(id))
  )
    return refused('id_taken');
  const sections = [...definition.sections];
  sections.splice(index, 0, copyPart(copied));
  const result = { ...definition, sections };
  const over = overLimits(result);
  if (over) return over;
  const problems = introduced(definition, result, index, context);
  if (problems.length > 0) return refused('invalid', { problems });
  return { ok: true, definition: result, renames: [] };
}

/** What a copy may not change about a note type: its kinds (as a set), group, sensitivity, quick and auto. */
const fixedOf = (d: ResolvedNoteType): string =>
  canonicalJson([[...d.kinds].sort(), d.group, d.sensitivity, d.quick ?? null, d.auto ?? null]);

/**
 * What phase 4's validator finds in `result` and did not find before the section copied in at
 * `index`, a place after it moved one section on: the copy is refused for what it brings, never
 * for what an earlier operation of the publish left, which the publish's own check reports. Other
 * keys are looked up as the publish's check looks them up: the team's, then the platform's.
 */
function introduced(
  before: ResolvedNoteType,
  result: ResolvedNoteType,
  index: number,
  context: NoteTypeEditContext,
): FileProblem[] {
  const check = (definition: ResolvedNoteType) =>
    validate(definition, {
      noteType: (key) =>
        key === definition.key
          ? definition
          : Object.hasOwn(context.team, key)
            ? context.team[key]
            : Object.hasOwn(context.platform, key)
              ? context.platform[key]
              : undefined,
    });
  const moved = (text: string) =>
    text.replace(/\$\.sections\[(\d+)\]/g, (whole, n: string) =>
      Number(n) >= index ? `$.sections[${Number(n) + 1}]` : whole,
    );
  const identity = (p: FileProblem) => `${p.rule}\n${p.path}\n${p.message}`;
  const known = new Set(
    check(before).map((p) => identity({ ...p, path: moved(p.path), message: moved(p.message) })),
  );
  return check(result).filter((p) => !known.has(identity(p)));
}

/** Refused for more fields or sections whose ids the server made than a team may add (BM-84). */
function overLimits(definition: ResolvedNoteType): Refused | undefined {
  const sections = definition.sections.filter((s) => isMadeId(s.id)).length;
  if (sections > MAX_TEAM_SECTIONS) return refused('too_many_sections');
  let fields = 0;
  const count = (list: readonly ResolvedField[]) => {
    for (const field of list) {
      if (isMadeId(field.id)) fields += 1;
      if (field.kind === 'group') count(field.fields);
      if (field.kind === 'grid') count([field.cell]);
    }
  };
  for (const section of definition.sections) count(section.fields);
  return fields > MAX_TEAM_FIELDS ? refused('too_many_fields') : undefined;
}

function shapeRefused(definition: ResolvedNoteType, path: string, message: string): Refused {
  const file = noteTypeFile(definition.key, definition.version);
  return refused('invalid', { problems: [{ file, path, rule: 'edit.new_field', message }] });
}

type Made = { ok: true; field: ResolvedField } | Refused;

/**
 * A field built from what the request gives for it, and only that: its id, and each option's code,
 * from `next` (rule 3), and no mark of any kind (rule 1). Refused with `label_invalid` for words the
 * schema refuses, and with `invalid` for a shape it refuses, at `at`, where the field would be.
 */
function madeField(spec: NewField, next: () => string, at: string, definition: ResolvedNoteType): Made {
  const given = spec as Record<string, unknown>;
  if (!isWords(given.label)) return refused('label_invalid');
  const shape = (path: string, message: string) => shapeRefused(definition, `${at}${path}`, message);
  switch (given.kind) {
    case 'text': {
      if (given.lines !== 'one' && given.lines !== 'many') return shape('.lines', 'is one or many');
      const { maxLength } = given;
      if (
        !Number.isInteger(maxLength) ||
        (maxLength as number) < 1 ||
        (maxLength as number) > MAX_TEXT_LENGTH
      )
        return shape('.maxLength', `is a whole number from 1 to ${MAX_TEXT_LENGTH}`);
      return {
        ok: true,
        field: {
          id: next(),
          kind: 'text',
          label: given.label,
          lines: given.lines,
          maxLength: maxLength as number,
        },
      };
    }
    case 'choice': {
      if (typeof given.many !== 'boolean') return shape('.many', 'is true or false');
      const { options } = given;
      if (!Array.isArray(options) || options.length === 0)
        return shape('.options', 'holds the words of one option at least');
      if (!options.every(isWords)) return refused('label_invalid');
      const id = next();
      return {
        ok: true,
        field: {
          id,
          kind: 'choice',
          label: given.label,
          many: given.many,
          options: options.map((label: string) => ({ code: next(), label })),
        },
      };
    }
    case 'number': {
      const { min, max, decimals, unit } = given;
      if (typeof min !== 'number' || !Number.isFinite(min)) return shape('.min', 'is a number');
      if (typeof max !== 'number' || !Number.isFinite(max)) return shape('.max', 'is a number');
      if (decimals !== 0 && decimals !== 1 && decimals !== 2) return shape('.decimals', 'is 0, 1 or 2');
      if (unit !== undefined && !isWords(unit)) return shape('.unit', 'is words the schema takes');
      // A range with no value at its decimals could never be answered: the validator's
      // number_range_empty, which would refuse the whole publish, refused here by the field's index.
      const scaled = (value: number) => Number((value * 10 ** decimals).toFixed(6));
      if (Math.ceil(scaled(min)) > Math.floor(scaled(max)))
        return shape(
          '.max',
          `no value with ${decimals} decimals lies from ${min} to ${max}, so the field could never be answered`,
        );
      return {
        ok: true,
        field: {
          id: next(),
          kind: 'number',
          label: given.label,
          min,
          max,
          decimals,
          ...(unit === undefined ? {} : { unit }),
        },
      };
    }
    default:
      return shape('.kind', 'is text, choice or number: the kinds a team adds');
  }
}
