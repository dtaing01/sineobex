/**
 * The four option operations of a team's edit (phase 5 design 5.4): add an option to a choice
 * field (its code made by the server, rule 3), rename one, retire one, move one. Each is refused on
 * a protected field, and on an option carrying `exclusive`, `normal`, `unable`, `other`, `suggests`
 * or `sensitiveExam` (edit-protected.ts); a retire is refused when it would leave no option. Only a
 * choice field outside a grid's cell takes them. applyNoteTypeEdit (edit.ts) hands them here;
 * edit-fanout.ts carries each along `mapsTo` (rule 5), applying it here to each field it reaches,
 * with that field's path and every version of the note types it reaches as `taken`, so an added
 * option has one code in each.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { NoteTypeEdit, NoteTypeEditCode, NoteTypeEditContext, NoteTypeEditStep } from './edit.ts';
import { fieldPlace, isProtected, isWords, madeIds, withFields } from './edit-protected.ts';
import { SIDES } from './paths.ts';
import type { ResolvedChoiceField, ResolvedNoteType } from './resolve.ts';
import type { Option, Rename } from './types.ts';

const refused = (code: NoteTypeEditCode): NoteTypeEditStep => ({ ok: false, refusal: { code } });

/** One of the four option operations on `definition`, as applyNoteTypeEdit answers it. */
export function applyOptionEdit(
  definition: ResolvedNoteType,
  edit: Extract<NoteTypeEdit, { op: 'add_option' | 'rename_option' | 'retire_option' | 'move_option' }>,
  context: NoteTypeEditContext,
): NoteTypeEditStep {
  const place = fieldPlace(definition, edit.path);
  if (place?.field.kind !== 'choice') return refused('not_found');
  const field = place.field;
  const changedTo = (next: ResolvedChoiceField, renames: Rename[] = []): NoteTypeEditStep => ({
    ok: true,
    definition: withFields(definition, place, (fields) => fields.map((f) => (f === field ? next : f))),
    renames,
  });

  if (edit.op === 'add_option') {
    if (isProtected(definition, { path: edit.path })) return refused('protected');
    if (!isWords(edit.label)) return refused('label_invalid');
    // Above every code the type ever used, and every one the note types the operation reaches did.
    const code = madeIds([...context.versions, definition, ...(context.taken ?? [])])();
    // Made with no mark (rule 1): the option is the code and the words, nothing else.
    return changedTo({ ...field, options: [...field.options, { code, label: edit.label }] });
  }

  const option = field.options.find((o) => o.code === edit.code);
  if (!option) return refused('not_found');
  if (edit.op === 'move_option' && edit.before !== null && !field.options.some((o) => o.code === edit.before))
    return refused('not_found');
  if (isProtected(definition, { path: edit.path, code: edit.code })) return refused('protected');

  switch (edit.op) {
    case 'rename_option': {
      if (!isWords(edit.label)) return refused('label_invalid');
      const options = field.options.map((o) => (o === option ? { ...option, label: edit.label } : o));
      // An option's answers are stored at the field's path, or at each side of it (forms 2.3).
      const paths = field.sides ? SIDES.map((side) => `${edit.path}.${side}`) : [edit.path];
      const renames =
        option.label === edit.label
          ? []
          : paths.map((path) => ({ path, code: edit.code, from: option.label, to: edit.label }));
      return changedTo({ ...field, options }, renames);
    }
    case 'retire_option': {
      // A definition has no empty lists (forms 2.2), and a choice with no option asks nothing.
      if (field.options.length === 1) return refused('last_option');
      return changedTo(withoutOption(field, option));
    }
    case 'move_option': {
      if (edit.before === edit.code) return changedTo(field);
      const options = field.options.filter((o) => o !== option);
      const at = edit.before === null ? options.length : options.findIndex((o) => o.code === edit.before);
      options.splice(at, 0, option);
      return changedTo({ ...field, options });
    }
  }
}

/**
 * The field without the option. A blocked pair that names it goes with it: the option is never
 * picked again on this version, so the pair blocks nothing, and the validator refuses a pair that
 * names no option (validate.excludes_unknown_code). Every earlier version keeps both (rule 4).
 */
function withoutOption(field: ResolvedChoiceField, option: Option): ResolvedChoiceField {
  const options = field.options.filter((o) => o !== option);
  if (!field.excludes) return { ...field, options };
  const { excludes, ...rest } = field;
  const kept = excludes.filter((pair) => !pair.includes(option.code));
  return kept.length > 0 ? { ...rest, options, excludes: kept } : { ...rest, options };
}
