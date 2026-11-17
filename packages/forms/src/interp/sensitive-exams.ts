/**
 * What a sensitive exam leaves behind when it is taken out of a note's answers (lifecycle 6.4 rules
 * 3 and 8, forms.md 6.6): visibleAnswers takes it out for a reader without
 * patients.view_sensitive_exams, and recapLines for everyone, so nothing says the exam was done.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import type { Option } from '../types.ts';
import { fieldAt } from './field-at.ts';
import type { PathTarget } from './field-at.ts';

const OTHER = '_other';

/**
 * The answers less everything a sensitive exam put there: every answer of a section marked
 * `sensitiveExam`; an option marked `sensitiveExam` from a code answer, the answer itself when
 * nothing else is left in it; every answer in a grid row whose option is marked; a region whose
 * region is marked, with its side and surface; and the Other text of a field whose picked Other
 * option was taken out (a field has one Other option: validate.other_twice).
 *
 * An entry of a repeating section that held answers and is left with none goes too, its entryAt
 * with it, as an entry with a sensitive diagnosis does for visibleAnswers.
 *
 * `answers` are answers that count (effectiveAnswers): an answer taken out here changes no other
 * answer's showing, because no condition outside a sensitive exam reads one
 * (validate.condition_reads_restricted). The order of the paths is kept.
 */
export function withoutSensitiveExams(
  definition: ResolvedNoteType,
  answers: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const kept: [string, unknown][] = [];
  // The paths of the choices whose picked Other option was taken out.
  const lostOther = new Set<string>();
  const texts: string[] = [];
  for (const [path, value] of Object.entries(answers)) {
    const target = fieldAt(definition, path);
    if (!target || target.section.sensitiveExam || inSensitiveRow(target)) continue;
    if (target.field?.kind === 'region' && sensitive(target.field.options, answers[sibling(path, 'region')]))
      continue;
    if (target.points === 'option') {
      texts.push(path);
      kept.push([path, value]);
      continue;
    }
    const holds = target.holds;
    if (holds?.type !== 'codes') {
      kept.push([path, value]);
      continue;
    }
    const picked = typeof value === 'string' ? [value] : (value as string[]);
    const marked = new Set(holds.options.filter((o) => o.sensitiveExam).map((o) => o.code));
    const left = picked.filter((code) => !marked.has(code));
    if (holds.options.some((o) => o.other && marked.has(o.code) && picked.includes(o.code)))
      lostOther.add(path);
    if (left.length === picked.length) kept.push([path, value]);
    else if (left.length > 0) kept.push([path, left]);
  }
  const dropped = new Set(texts.filter((path) => lostOther.has(choiceOf(definition, path))));
  const left = kept.filter(([path]) => !dropped.has(path));
  // An entry the exam was all of goes whole: its entryAt alone would show an empty entry where
  // the exam was, and number the rest around it. An entry that held nothing keeps its entryAt.
  const held = (paths: Iterable<string>) => {
    const entries = new Set<string>();
    for (const path of paths) {
      const target = fieldAt(definition, path);
      if (target?.entry && target.points !== 'entry') entries.add(`${target.section.id}.${target.entry}`);
    }
    return entries;
  };
  const before = held(Object.keys(answers));
  const after = held(left.map(([path]) => path));
  return Object.fromEntries(
    left.filter(([path]) => {
      const target = fieldAt(definition, path);
      if (target?.points !== 'entry' || !target.entry) return true;
      const entry = `${target.section.id}.${target.entry}`;
      return after.has(entry) || !before.has(entry);
    }),
  );
}

/** A row of a grid whose option is marked `sensitiveExam`: its fixed row, or the option picked for it. */
function inSensitiveRow(target: PathTarget): boolean {
  const grid = target.leaf?.node.grid;
  if (!grid || target.row === null || grid.field.kind !== 'grid') return false;
  const rows = Array.isArray(grid.field.rows)
    ? grid.field.rows
    : grid.picked?.holds.type === 'codes'
      ? grid.picked.holds.options
      : [];
  return rows.some((row) => row.code === target.row && row.sensitiveExam === true);
}

function sensitive(options: Option[], code: unknown): boolean {
  return options.some((o) => o.code === code && o.sensitiveExam === true);
}

/** The path of another answer of the same region: its last part replaced. */
function sibling(path: string, part: string): string {
  return `${path.slice(0, path.lastIndexOf('.'))}.${part}`;
}

/** The choice an Other text belongs to: `_other` taken off the field's own part, before any side. */
function choiceOf(definition: ResolvedNoteType, path: string): string {
  const target = fieldAt(definition, path)!;
  const parts = path.split('.');
  const own = parts.length - (target.side ? 2 : 1);
  parts[own] = parts[own]!.slice(0, -OTHER.length);
  return parts.join('.');
}
