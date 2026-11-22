/**
 * Where visibleAnswers may take an answer out from a reader who may read the note (phase 5 design
 * 4.4, D138). A supply map is refused (`sensitive_path`, validatePreset in the presets package)
 * when what it fires on lies there: a supply line is read by people with inventory.view and
 * billing.view_codes, and would tell them what was found, as a condition would (D77). One function
 * decides it, beside visibleAnswers, and test/interp/may-be-hidden.test.ts holds the two together,
 * for every reader of 7.1, on every released note type that is not sensitive and on the vectors'
 * made-up ones.
 *
 * The Medical gate is not this function's: visibleAnswers shows no Medical-only note to a reader who
 * does not read Medical notes, but every standard role that reads supply lines reads them (0002).
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType, ResolvedSection } from '../resolve.ts';
import type { Option } from '../types.ts';
import { definitionModel, fieldAt } from './field-at.ts';
import type { PathTarget } from './field-at.ts';

/** What a supply map fires on at its path: the presets package's `when`, which forms cannot import. */
export type AnswerTest = { equals: string | number | boolean } | { includes: string } | { answered: true };

// An entry's ID, any one: fieldAt finds a field of a repeating section only by an answer's path,
// and what may be hidden of a field is the same in every entry.
const AN_ENTRY = 'e0000000';

// PLAN-OPEN (BM-77): may a supply mapping read a sensitive answer? No: whatever visibleAnswers may
// take out from a reader who may read the note, and a sensitive note type as a whole.
/**
 * Whether visibleAnswers may take out, from a reader who may read a note of this definition, what a
 * test of `path` reads: with no path, the note type as a whole, which is true exactly when it is
 * sensitive; with a path and no `when`, any answer there, as `{answered: true}` (what a `fromPath`
 * reads). A path is an answer path without an entry part, as `mapsTo` writes one. A path that
 * stores no answer may be hidden: nothing fires on what no reader can read.
 */
export function mayBeHidden(definition: ResolvedNoteType, path?: string, when?: AnswerTest): boolean {
  // Seen by no reader without view_sensitive, whatever the path.
  if (definition.sensitivity === 'sensitive') return true;
  if (path === undefined) return false;
  const target = targetOf(definition, path);
  if (target === null || target.leaf === null || target.field === null) return true;
  const { section, field } = target;
  // Every answer of the section, for a reader without view_sensitive_exams, or without
  // view_sensitive and a clinical credential.
  if (section.sensitiveExam || section.treatmentRecord) return true;
  // A sensitive diagnosis takes its whole section, or in a repeating section its entry, from a
  // reader without view_sensitive, and only its code says whether it is sensitive.
  if (holdsDiagnosis(definition, section)) return true;
  if (inMarkedRow(target)) return true;
  // A marked region takes its side and surface with it.
  if (field.kind === 'region' && field.options.some(marked)) return true;
  // The text of an Other option goes with a marked Other option.
  if (target.points === 'option')
    return field.kind === 'choice' && field.options.some((o) => o.other && marked(o));
  const holds = target.holds;
  if (holds?.type !== 'codes' || !holds.options.some(marked)) return false;
  // Only the marked codes are taken out of a code answer, and the answer itself when nothing else
  // is left in it: a test of an unmarked code reads the same for every reader, unless it reads a
  // choose-many whole.
  const test = when ?? { answered: true };
  if ('answered' in test) return true;
  const code = 'includes' in test ? test.includes : test.equals;
  if (holds.options.some((o) => o.code === code && marked(o))) return true;
  return 'equals' in test && holds.many;
}

function targetOf(definition: ResolvedNoteType, path: string): PathTarget | null {
  const [section, ...rest] = path.split('.');
  const repeats = definition.sections.find((s) => s.id === section)?.repeat !== undefined;
  return fieldAt(definition, repeats ? [section, AN_ENTRY, ...rest].join('.') : path);
}

/** A section with a diagnosis in it, in a group or a grid's cell too: visibleAnswers finds any. */
function holdsDiagnosis(definition: ResolvedNoteType, section: ResolvedSection): boolean {
  return definitionModel(definition).nodes.some(
    (node) => node.section.section.id === section.id && node.field.kind === 'problem',
  );
}

/** A cell in a grid's row whose option is marked: its fixed row, or the option picked for it. */
function inMarkedRow(target: PathTarget): boolean {
  const grid = target.leaf?.node.grid;
  if (!grid || target.row === null || grid.field.kind !== 'grid') return false;
  const rows = Array.isArray(grid.field.rows)
    ? grid.field.rows
    : grid.picked?.holds.type === 'codes'
      ? grid.picked.holds.options
      : [];
  return rows.some((row) => row.code === target.row && marked(row));
}

const marked = (option: Option) => option.sensitiveExam === true;
