/**
 * The semantic validator (docs/design/phase-4/forms.md, 4.2): what the JSON Schema cannot say about
 * a definition. It reads a resolved definition, so a module is checked as part of each note type
 * that includes it: its conditions name that note type's fields.
 *
 * Definitions are typed by hand. What passes here is what the server, the phone and the reports
 * rely on without looking again: every path is one the server takes, every condition names an
 * answer that exists, and nothing is ambiguous enough for two readers to differ on.
 *
 * Each problem names the file, the place in it and the rule, by a code that does not change.
 * Pure, like the resolver, and loaded by the API: nothing here may import a package.
 */
import { locate, noteTypeFile } from './resolve.ts';
import type { FileProblem, Origin, ResolvedField, ResolvedNoteType, ResolvedSection } from './resolve.ts';
import { canonicalJson } from './canonical.ts';
import { leafAt, pathModel, PATH_FAULTS } from './paths.ts';
import type { FieldNode, Found, Holds, Leaf, PathModel, SectionNode } from './paths.ts';
import { MAX_DEFINITION_BYTES, MAX_REPEAT, MAX_TEXT_LENGTH } from './types.ts';
import type { Condition, Option } from './types.ts';

export type ValidateContext = {
  /** From `resolve`: lets a problem name the file and the place where the fault was written. */
  origins?: readonly Origin[];
  /**
   * The newest resolved version of another note type, for what names one: `mapsTo`, `suggests`
   * and the `open_note_type` action. Undefined when there is no such note type.
   */
  noteType: (key: string) => ResolvedNoteType | undefined;
};

/**
 * Every fault in a resolved definition; empty when it can be trusted. Without `origins` a place is
 * a place in the resolved definition, in the file a note type of that key and version would have.
 */
export function validate(definition: ResolvedNoteType, context: ValidateContext): FileProblem[] {
  const model = pathModel(definition);
  const found: Found[] = [...model.found];
  const report: Report = (at, rule, message) => found.push({ at, rule, message });
  checkCodes(model, report);
  checkConditions(model, report);
  checkOtherNoteTypes(model, context, report);
  checkFlags(model, report);
  checkVisibility(model, context, report);
  checkLimits(model, report);

  const origins = context.origins ?? [
    { at: '$', file: noteTypeFile(definition.key, definition.version), path: '$' },
  ];
  // A list used by five fields is one file: its fault is found five times and reported once.
  const problems = new Map<string, FileProblem>();
  for (const { at, rule, message } of found) {
    const { file, path } = locate(origins, at);
    const key = `${file}  ${path}  ${rule}`;
    if (!problems.has(key)) problems.set(key, { file, path, rule: `validate.${rule}`, message });
  }
  return [...problems.values()];
}

type Report = (at: string, rule: string, message: string) => void;

// ---------------------------------------------------------------------------------------------
// Conditions.

/** Every `{ field }` in a condition, with its place. */
function tests(
  condition: Condition,
  at: string,
  each: (test: Extract<Condition, { field: string }>, at: string) => void,
) {
  if ('field' in condition) each(condition, at);
  else if ('all' in condition) condition.all.forEach((c, i) => tests(c, `${at}.all[${i}]`, each));
  else if ('any' in condition) condition.any.forEach((c, i) => tests(c, `${at}.any[${i}]`, each));
  else tests(condition.not, `${at}.not`, each);
}

function checkConditions(model: PathModel, report: Report) {
  const check = (condition: Condition | undefined, carrier: FieldNode | SectionNode, row: string | null) => {
    if (!condition) return;
    tests(condition, `${carrier.at}.showWhen`, (test, at) => {
      const named = leafAt(model, test.field, carrier, row);
      if ('fault' in named) {
        const rule = named.fault === 'unknown_field' ? 'condition_unknown_field' : named.fault;
        // A condition names an answer: a field with sides has two, a region and a problem have parts.
        const parts = ['right', 'left', 'region', 'code'].filter(
          (part) => !('fault' in leafAt(model, `${test.field}.${part}`, carrier, row)),
        );
        const hint =
          parts.length > 0 ? `; it stores at ${parts.map((p) => `"${test.field}.${p}"`).join(' and ')}` : '';
        return report(`${at}.field`, rule, PATH_FAULTS[named.fault](test.field) + hint);
      }
      const from = 'field' in carrier ? carrier.section.section : carrier.section;
      const key = hiddenBy(named.leaf.node.section.section, from);
      if (key)
        report(
          `${at}.field`,
          'condition_reads_restricted',
          `"${test.field}" is in a section marked ${key}, and this condition is not: a reader who may not see that answer would learn it from what this shows`,
        );
      else if (holdsDiagnosis(named.leaf.node.section, from))
        report(
          `${at}.field`,
          'condition_reads_restricted',
          `"${test.field}" is in a section that holds a diagnosis, which a reader without view_sensitive does not see whole when the diagnosis is sensitive: what this shows would tell them it is there`,
        );
      const left = examLeaves(named.leaf, 'is' in test, carrier, row, from);
      if (left)
        report(
          `${at}.field`,
          'condition_reads_restricted',
          `"${test.field}" ${left}, and this condition is not in a sensitive exam: a reader without the key would learn what the exam found from what this shows`,
        );
      if (!('is' in test)) return;
      const { holds } = named.leaf;
      if (holds.type !== 'codes')
        return report(
          `${at}.field`,
          'condition_not_a_choice',
          `"${test.field}" holds no option code to compare with`,
        );
      const codes = new Set(holds.options.map((option) => option.code));
      const wanted = typeof test.is === 'string' ? [test.is] : test.is;
      const sensitive = new Set(holds.options.filter((o) => o.sensitiveExam).map((o) => o.code));
      wanted.forEach((code, index) => {
        const place = typeof test.is === 'string' ? `${at}.is` : `${at}.is[${index}]`;
        if (!codes.has(code))
          report(
            place,
            'condition_unknown_code',
            `"${code}" is not the code of an option at "${test.field}": the condition could never hold for it`,
          );
        if (sensitive.has(code) && !from.sensitiveExam)
          report(
            place,
            'condition_reads_restricted',
            `"${code}" at "${test.field}" names a sensitive exam, and this condition is not in one: a reader without the key would learn that the exam was done`,
          );
      });
    });
  };
  for (const section of model.sections) check(section.section.showWhen, section, null);
  // Picked rows read the picked answer as a condition does.
  for (const node of model.nodes) {
    if (!node.picked) continue;
    const from = node.section.section;
    const target = node.picked.node.section.section;
    const at = `${node.at}.rows.pickedIn`;
    const key = hiddenBy(target, from);
    if (key)
      report(
        at,
        'condition_reads_restricted',
        `the rows are picked in a section marked ${key}, and this grid's section is not: its rows would show those answers`,
      );
    else if (holdsDiagnosis(node.picked.node.section, from))
      report(
        at,
        'condition_reads_restricted',
        "the rows are picked in a section that holds a diagnosis, and this grid is not in it: its rows would show that section's answers to a reader who may not see them",
      );
    else if (node.rows.length > 0 && !from.sensitiveExam && node.picked.holds.type === 'codes')
      if (node.picked.holds.options.some((o) => o.sensitiveExam))
        report(
          at,
          'condition_reads_restricted',
          'the rows are picked among options that name a sensitive exam, and this grid is not in one: its rows would show that the exam was done',
        );
  }
  for (const node of model.nodes) {
    if (!node.field.showWhen) continue;
    // In a grid's cell the condition is read in each row. A fault found in every row is reported
    // once (validate keeps one problem per place and rule); one row may read what another may not.
    if (!node.grid) check(node.field.showWhen, node, null);
    else for (const row of new Set(node.grid.rows)) check(node.field.showWhen, node, row);
  }
}

/**
 * Whether `target` is a section, other than `from`, that holds a diagnosis outside a repeating
 * section. A reader without view_sensitive gets none of its answers when the diagnosis is sensitive
 * (visibleAnswers), so a field elsewhere that any of them shows would say that one is there.
 */
function holdsDiagnosis(target: SectionNode, from: ResolvedSection): boolean {
  if (target.section === from || target.section.repeat) return false;
  return target.nodes.some((node) => node.field.kind === 'problem');
}

/**
 * What a test of `leaf` cannot see the same way once a sensitive exam is taken out of the note
 * (sensitive-exams.ts, for a reader without patients.view_sensitive_exams), said as the rest of a
 * sentence; null when it reads the same. Only `is` on codes that are not marked reads the same: a
 * marked code taken out of an answer neither adds one of them nor takes one away. Everything is
 * taken out of a sensitive exam section, so a test written inside one reads nothing it would lose.
 */
function examLeaves(
  leaf: Leaf,
  is: boolean,
  carrier: FieldNode | SectionNode,
  row: string | null,
  from: ResolvedSection,
): string | null {
  if (from.sensitiveExam) return null;
  const { node, holds } = leaf;
  // The whole row goes, and a field read from that same row goes with it.
  const grid = node.grid;
  if (grid && leaf.row !== null && grid.field.kind === 'grid' && Array.isArray(grid.field.rows)) {
    const sameRow = 'field' in carrier && carrier.grid === grid && row === leaf.row;
    if (!sameRow && grid.field.rows.some((r) => r.code === leaf.row && r.sensitiveExam))
      return `is in the row "${leaf.row}", which is a sensitive exam`;
  }
  const field = node.field;
  // A region's side and surface go with a marked region.
  if (field.kind === 'region' && leaf.parts.at(-1) !== 'region' && field.options.some((o) => o.sensitiveExam))
    return 'is part of a region whose regions include a sensitive exam';
  // The Other text goes when the Other option picked beside it is marked.
  if (
    leaf.fieldPath === null &&
    field.kind === 'choice' &&
    field.options.some((o) => o.other && o.sensitiveExam)
  )
    return 'is the text of an Other option that is a sensitive exam';
  // Filled, or not, changes when the marked codes are all that is picked. (`is` on a marked code
  // is refused where the code is checked.)
  if (!is && holds.type === 'codes' && holds.options.some((o) => o.sensitiveExam))
    return 'holds options that are a sensitive exam, and whether it is filled changes when they are taken out';
  return null;
}

/**
 * The key that hides `target`'s answers from some readers and that `from` does not carry, if any
 * (lifecycle 6.4). `needs` decides who may set an answer, not who reads it, so it is not one.
 */
function hiddenBy(target: ResolvedSection, from: ResolvedSection): string | null {
  if (target === from) return null;
  if (target.sensitiveExam && !from.sensitiveExam) return 'sensitiveExam';
  if (target.treatmentRecord && !from.treatmentRecord) return 'treatmentRecord';
  return null;
}

// ---------------------------------------------------------------------------------------------
// What names another note type: mapsTo, suggests and the open_note_type action.

function checkOtherNoteTypes(model: PathModel, context: ValidateContext, report: Report) {
  const models = new Map<string, PathModel | null>([[model.definition.key, model]]);
  const other = (key: string): PathModel | null => {
    if (!models.has(key)) {
      const definition = context.noteType(key);
      models.set(key, definition ? pathModel(definition) : null);
    }
    return models.get(key)!;
  };
  const known = (key: string, at: string) => {
    if (!other(key)) report(at, 'unknown_note_type', `there is no note type "${key}"`);
  };

  // A released quick version is not checked again against a newer full form: it can no longer be
  // edited, and Expand is written for the newest quick version. What it says of itself still is.
  const newest = context.noteType(model.definition.key);
  const across = !newest || newest.version <= model.definition.version;
  const targets = new Map<string, FieldNode>();

  for (const node of model.nodes) {
    const { field } = node;
    for (const { key, options } of optionLists(node))
      options.forEach((option, index) => {
        if (option.suggests !== undefined) known(option.suggests, `${node.at}.${key}[${index}].suggests`);
      });
    if (field.kind === 'action' && field.action === 'open_note_type')
      known(field.noteType, `${node.at}.noteType`);
    if (field.mapsTo === undefined) continue;
    const at = `${node.at}.mapsTo`;
    if (!node.base) {
      report(
        at,
        'maps_to_in_grid',
        'the cell of a grid has no path of its own to map; the grid is what maps',
      );
      continue;
    }
    if (model.definition.quick !== true)
      report(at, 'maps_to_not_quick', 'only the quick form maps its answers into a full note type (6.4)');
    if (node.section.section.repeat)
      report(
        at,
        'maps_to_from_repeat',
        'a field of a repeating section has an answer for each entry, and Expand has one full field to write them to',
      );
    const first = targets.get(field.mapsTo);
    if (first)
      report(
        at,
        'maps_to_twice',
        `the field at ${first.at} already maps to ${field.mapsTo}: Expand would write two answers to one path`,
      );
    else targets.set(field.mapsTo, node);
    if (across) checkMapsTo(node, field.mapsTo, other, report);
  }
}

/**
 * Expand (6.4) writes each answer of the quick field into the full note, at the full field's
 * path, and the server then checks it against the full definition. So the full field must be
 * there, and must take everything the quick field can hold: an answer it refused would be a
 * rejected change, long after the form was typed.
 */
function checkMapsTo(
  node: FieldNode,
  mapsTo: string,
  other: (key: string) => PathModel | null,
  report: Report,
) {
  const at = `${node.at}.mapsTo`;
  const [key, path] = mapsTo.split(':') as [string, string];
  const full = other(key);
  if (!full) return report(at, 'unknown_note_type', `there is no note type "${key}"`);
  const target = full.nodes.find((n) => n.base?.join('.') === path);
  if (!target) return report(at, 'maps_to_unknown_field', `"${key}" has no field at "${path}"`);
  // Expand by a credential without the capability would be a held change (lifecycle 6.4).
  const needs = target.section.section.needs;
  if (needs !== undefined && node.section.section.needs !== needs)
    report(
      at,
      'maps_to_needs',
      `${key}:${path} is in a section that needs ${needs}, and this field's section does not: Expand by anyone without it would be held`,
    );

  const places = new Map(target.leaves.map((leaf) => [within(leaf, target), leaf]));
  for (const leaf of node.leaves) {
    const place = places.get(within(leaf, node));
    if (!place || !takes(place.holds, leaf.holds))
      return report(
        at,
        'maps_to_mismatch',
        `what is stored at ${leaf.key} ${place ? `does not fit ${key}:${place.key}` : `has no place in ${key}:${path}`}`,
      );
  }
}

/** A path as seen from a field that stores it or holds it: `*`, `*_other`, `*.right`, `*.region`. */
function within(leaf: Leaf, node: FieldNode): string {
  const depth = node.base!.length - 1;
  const first = leaf.parts[depth]!.slice(node.base![depth]!.length);
  return ['*' + first, ...leaf.parts.slice(depth + 1)].join('.');
}

/** Whether every answer that `from` allows is one that `to` allows. */
function takes(to: Holds, from: Holds): boolean {
  if (to.type === 'codes' && from.type === 'codes') {
    const codes = new Set(to.options.map((option) => option.code));
    if (to.many !== from.many || !from.options.every((option) => codes.has(option.code))) return false;
    if (!to.many) return true;
    // checkAnswer on the full definition refuses a blocked pair and an exclusive option held with
    // others: whatever the quick widget lets be held together must be held there too.
    const offered = new Set(from.options.map((option) => option.code));
    const alone = new Set(from.options.filter((option) => option.exclusive).map((option) => option.code));
    // An exclusive option of the quick field is never held with another either.
    const blocked = (a: string, b: string) =>
      alone.has(a) ||
      alone.has(b) ||
      from.excludes.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    return (
      to.options.every(
        (option) => !option.exclusive || !offered.has(option.code) || alone.has(option.code),
      ) && to.excludes.every(([a, b]) => !offered.has(a) || !offered.has(b) || blocked(a, b))
    );
  }
  if (to.type === 'text' && from.type === 'text') return from.maxLength <= to.maxLength;
  // Expand copies the stored number, which is in the field's unit: 4 inches would become 4 cm.
  if (to.type === 'number' && from.type === 'number')
    return to.unit === from.unit && from.min >= to.min && from.max <= to.max && from.decimals <= to.decimals;
  if (to.type === 'date' && from.type === 'date') return to.range === 'any' || to.range === from.range;
  return to.type === from.type;
}

// ---------------------------------------------------------------------------------------------
// Option codes.

/** Every option list a field holds, with its place. */
function optionLists(node: FieldNode): { key: string; options: Option[] }[] {
  const { field } = node;
  if (field.kind === 'choice') return [{ key: 'options', options: field.options }];
  if (field.kind === 'grid') return Array.isArray(field.rows) ? [{ key: 'rows', options: field.rows }] : [];
  if (field.kind === 'region')
    return [
      { key: 'options', options: field.options },
      ...(field.side ? [{ key: 'side', options: field.side }] : []),
      ...(field.surface ? [{ key: 'surface', options: field.surface }] : []),
    ];
  return [];
}

function checkCodes(model: PathModel, report: Report) {
  for (const node of model.nodes) {
    for (const { key, options } of optionLists(node)) {
      const codes = new Set<string>();
      options.forEach((option, index) => {
        // Reports and supply mappings read a code as one meaning (2.6); an answer of it could be either.
        if (codes.has(option.code))
          report(
            `${node.at}.${key}[${index}].code`,
            'duplicate_code',
            `"${option.code}" is already the code of an option in this list`,
          );
        codes.add(option.code);
      });
    }
    if (node.field.kind === 'choice') checkExcludes(node, node.field, report);
  }
}

/** A blocked pair that names no option blocks nothing, and nobody would see that it does not. */
function checkExcludes(node: FieldNode, field: Extract<ResolvedField, { kind: 'choice' }>, report: Report) {
  if (!field.excludes) return;
  const at = `${node.at}.excludes`;
  if (!field.many) {
    report(at, 'excludes_in_choose_one', 'a choose-one field holds one option: no two can be held together');
    return;
  }
  const codes = new Set(field.options.map((option) => option.code));
  field.excludes.forEach((pair, index) => {
    pair.forEach((code, side) => {
      if (!codes.has(code))
        report(
          `${at}[${index}][${side}]`,
          'excludes_unknown_code',
          `"${code}" is not the code of an option of this field`,
        );
    });
    if (pair[0] === pair[1])
      report(
        `${at}[${index}]`,
        'excludes_same_code',
        `"${pair[0]}" cannot be blocked from being held with itself`,
      );
  });
}

// ---------------------------------------------------------------------------------------------
// Flags: what a key means on the field that carries it.

/** The kinds that store one answer at their own path, where a side can be the last part. */
const SIDED_KINDS = new Set(['choice', 'text', 'number', 'flag', 'date', 'time', 'duration', 'grid']);
/** The kinds that store more than one answer, with no one meaning for filled. */
const NO_ONE_ANSWER = new Set(['group', 'grid', 'region', 'problem']);
/** The kinds that store nothing (2.3). */
const STORES_NOTHING = new Set(['photo', 'action', 'info']);

function checkFlags(model: PathModel, report: Report) {
  for (const node of model.nodes) {
    const { field, at } = node;

    // Every option of a choose-one field clears the others. One marked exclusive says nothing
    // there, and is the mark of a field that was meant to be choose-many.
    if (field.kind === 'choice' && !field.many)
      for (const option of field.options)
        if (option.exclusive)
          report(at, 'exclusive_in_choose_one', `option "${option.code}" is exclusive in a choose-one field`);

    // A region holds one code, and its Other text would have no path.
    if (field.kind === 'region')
      for (const option of [...field.options, ...(field.side ?? []), ...(field.surface ?? [])])
        if (option.exclusive || option.other)
          report(
            at,
            'region_option_flag',
            `option "${option.code}" of a region cannot be ${option.other ? 'an Other option' : 'exclusive'}`,
          );

    // A fixed row is a path part, not an answer: its Other text would have no path, and nothing in
    // a row is picked for exclusive to clear. (Picked rows are options of the field they are picked in.)
    if (field.kind === 'grid' && Array.isArray(field.rows))
      for (const option of field.rows)
        if (option.exclusive || option.other)
          report(
            at,
            'row_option_flag',
            `row "${option.code}" of a grid cannot be ${option.other ? 'an Other option' : 'exclusive'}`,
          );

    if (field.kind === 'choice') checkOtherAndNormal(node, field, report);

    // The handoff summary goes to EMS (lifecycle 5.7), whose reader holds no key.
    const restricted = node.section.section.sensitiveExam
      ? 'sensitiveExam'
      : node.section.section.treatmentRecord
        ? 'treatmentRecord'
        : null;
    if (field.handoff && restricted)
      report(
        `${at}.handoff`,
        'handoff_restricted',
        `the section is marked ${restricted}, and the handoff summary goes to EMS, who may not read it`,
      );

    if (field.kind === 'number') checkNumber(field, at, report);

    if (field.sides && !SIDED_KINDS.has(field.kind))
      report(
        `${at}.sides`,
        'sides_not_allowed',
        `a ${field.kind} has no one answer to record for right and for left`,
      );
    // Right and left are one path part, the last (2.3). A grid's sides are already its cells'.
    else if (field.sides && node.grid?.field.sides)
      report(`${at}.sides`, 'sides_not_allowed', 'the grid has sides, so each of its cells already has');

    // Complete waits for a required field to be filled (7.1). These kinds store nothing, so it
    // would wait for ever; a group and a grid store only through their fields, a region up to three
    // answers and a problem two, and whether "filled" means one of them or all of them is for each
    // answer to say.
    if (field.required && (STORES_NOTHING.has(field.kind) || NO_ONE_ANSWER.has(field.kind)))
      report(
        `${at}.required`,
        'required_not_allowed',
        `a ${field.kind} holds no answer of its own to wait for`,
      );

    if (field.kind === 'grid' && node.grid)
      report(at, 'grid_in_grid', 'a grid cannot be in the cell of a grid: its rows would be rows of a row');
    if (node.parent?.cell === node && STORES_NOTHING.has(field.kind))
      report(
        at,
        'grid_cell_stores_nothing',
        `the cell of a grid holds one answer for each row; a ${field.kind} holds none`,
      );

    // While the flag is set these fields do not count (2.3). A name that is no field beside the
    // flag would leave a length counting under "Unable to measure", and nothing would show it.
    if (field.kind === 'flag')
      (field.clears ?? []).forEach((id, index) => {
        if (id === field.id || !node.siblings.some((sibling) => sibling.field.id === id))
          report(`${at}.clears[${index}]`, 'clears_unknown_field', `"${id}" is not a field beside this flag`);
      });
  }
}

/**
 * The Other options of a field share one text (2.3), which could not say which of them it is for.
 * One-tap Normal puts every normal option of a field in at once (normalAnswers): one answer must
 * hold them all, and checkAnswer must take it.
 */
function checkOtherAndNormal(
  node: FieldNode,
  field: Extract<ResolvedField, { kind: 'choice' }>,
  report: Report,
) {
  const others = field.options.flatMap((option, index) => (option.other ? [index] : []));
  for (const index of others.slice(1))
    report(
      `${node.at}.options[${index}].other`,
      'other_twice',
      'this field already has an Other option, and the two would share one text',
    );
  const normal = field.options.filter((option) => option.normal);
  if (normal.length < 2) return;
  const codes = new Set(normal.map((option) => option.code));
  const clash = !field.many
    ? 'a choose-one field holds one option, and two are marked normal'
    : normal.some((option) => option.exclusive)
      ? 'an exclusive option is marked normal beside others, and is never held with them'
      : (field.excludes ?? []).some(([a, b]) => codes.has(a) && codes.has(b))
        ? 'two of its normal options are a blocked pair, never held together'
        : null;
  if (clash) report(node.at, 'normal_conflict', `one-tap Normal would fill every normal option: ${clash}`);
}

/**
 * A number's range must hold a value at its decimals, or the field can never be answered and,
 * required, the note never completed. What one-tap Normal fills must be such a value.
 */
function checkNumber(field: Extract<ResolvedField, { kind: 'number' }>, at: string, report: Report) {
  const scale = 10 ** field.decimals;
  // Rounded first: 0.7 * 10 is 7.000000000000001.
  const scaled = (value: number) => Number((value * scale).toFixed(6));
  if (Math.ceil(scaled(field.min)) > Math.floor(scaled(field.max)))
    report(
      at,
      'number_range_empty',
      `no value with ${field.decimals} decimals lies from ${field.min} to ${field.max}, so the field could never be answered`,
    );
  if (
    field.normal !== undefined &&
    (field.normal < field.min || field.normal > field.max || !Number.isInteger(scaled(field.normal)))
  )
    report(
      `${at}.normal`,
      'number_normal',
      `one-tap Normal would fill ${field.normal}, which is not a value from ${field.min} to ${field.max} with ${field.decimals} decimals`,
    );
}

// ---------------------------------------------------------------------------------------------
// The limits of 2.4. The schema holds the first two for a file; a definition can also reach this
// check without having been a file.

function checkLimits(model: PathModel, report: Report) {
  for (const { section, at } of model.sections)
    if (section.repeat && section.repeat.max > MAX_REPEAT)
      report(`${at}.repeat.max`, 'repeat_too_many', `a section has at most ${MAX_REPEAT} entries`);
  for (const { field, at } of model.nodes)
    if (field.kind === 'text' && field.maxLength > MAX_TEXT_LENGTH)
      report(`${at}.maxLength`, 'text_too_long', `a text field holds at most ${MAX_TEXT_LENGTH} characters`);
  // As it is hashed and stored: canonical JSON, in bytes.
  const bytes = new TextEncoder().encode(canonicalJson(model.definition)).length;
  if (bytes > MAX_DEFINITION_BYTES)
    report(
      '$',
      'too_large',
      `the resolved definition is ${bytes} bytes; the most is ${MAX_DEFINITION_BYTES}`,
    );
}

// ---------------------------------------------------------------------------------------------
// Visibility. An answer counts only while its field shows and no flag clears it (2.3, 7.1), so
// whether one field shows can hang on whether another does. Two things can go wrong that no reader
// of a single condition would see: a condition that hangs on itself, and a required field that no
// set of answers ever shows.

/** One showing of a field: the field itself, or in a grid's cell the field in one row. */
type Site = { node: FieldNode; row: string | null };
const siteKey = (site: Site): string => `${site.node.at} ${site.row ?? ''}`;
const siteOf = (leaf: Leaf): Site => ({ node: leaf.node, row: leaf.row });

/** A condition with each path traced to the answer it names. */
type Formula =
  { leaf: Leaf; is: string[] | null } | { all: Formula[] } | { any: Formula[] } | { not: Formula };

/**
 * Null when the condition names no answer, or asks for a code where there is none: that is reported
 * where conditions are checked, and such a condition is then left out. With one condition fewer a
 * field can only show more often, so a field said never to show is still one that never does. A
 * code the field does not offer is likewise taken as one that could be picked.
 */
function formulaOf(
  model: PathModel,
  condition: Condition,
  carrier: FieldNode | SectionNode,
  row: string | null,
): Formula | null {
  if ('field' in condition) {
    const named = leafAt(model, condition.field, carrier, row);
    if ('fault' in named) return null;
    if (!('is' in condition)) return { leaf: named.leaf, is: null };
    if (named.leaf.holds.type !== 'codes') return null;
    return { leaf: named.leaf, is: typeof condition.is === 'string' ? [condition.is] : condition.is };
  }
  if ('not' in condition) {
    const inner = formulaOf(model, condition.not, carrier, row);
    return inner && { not: inner };
  }
  const parts = ('all' in condition ? condition.all : condition.any).map((c) =>
    formulaOf(model, c, carrier, row),
  );
  if (parts.some((part) => part === null)) return null;
  return 'all' in condition ? { all: parts as Formula[] } : { any: parts as Formula[] };
}

function leavesIn(formula: Formula, each: (test: Extract<Formula, { leaf: Leaf }>) => void) {
  if ('leaf' in formula) each(formula);
  else if ('not' in formula) leavesIn(formula.not, each);
  else ('all' in formula ? formula.all : formula.any).forEach((part) => leavesIn(part, each));
}

/** What decides whether a site's answers count. */
type Rules = {
  /** All must hold for the site to show: the section's condition, each group's and grid's around it, its own. */
  shows: Formula[];
  /** The answers of flags that clear it, or something around it, while they are set. */
  clearedBy: Leaf[];
};

class Visibility {
  private readonly rules = new Map<string, Rules>();
  constructor(private readonly model: PathModel) {}

  rulesOf(site: Site): Rules {
    const key = siteKey(site);
    let rules = this.rules.get(key);
    if (rules) return rules;
    rules = { shows: [], clearedBy: [] };
    this.rules.set(key, rules);

    const add = (condition: Condition | undefined, carrier: FieldNode | SectionNode, row: string | null) => {
      const formula = condition && formulaOf(this.model, condition, carrier, row);
      if (formula) rules.shows.push(formula);
    };
    add(site.node.section.section.showWhen, site.node.section, null);
    const around: FieldNode[] = [];
    for (let node: FieldNode | null = site.node; node; node = node.parent) around.unshift(node);
    for (const node of around) {
      // Only what is inside a grid's cell is in a row. The grid's own condition is read from outside.
      const row = node.grid ? site.row : null;
      add(node.field.showWhen, node, row);
      // A row of picked rows is there while its option is picked.
      if (node.parent?.cell === node && node.parent.picked && row !== null)
        rules.shows.push({ leaf: node.parent.picked, is: [row] });
      for (const flag of node.siblings)
        if (flag !== node && flag.field.kind === 'flag' && flag.field.clears?.includes(node.field.id))
          rules.clearedBy.push(...flag.leaves.filter((leaf) => leaf.row === row));
    }
    return rules;
  }

  /** The sites whose answers this one's showing or counting reads. */
  reads(site: Site): Site[] {
    const rules = this.rulesOf(site);
    const sites: Site[] = rules.clearedBy.map(siteOf);
    for (const formula of rules.shows) leavesIn(formula, (test) => sites.push(siteOf(test.leaf)));
    return sites;
  }

  /** Everything reachable from a site through what it reads, the site itself only if it comes round again. */
  reach(site: Site): Map<string, Site> {
    const seen = new Map<string, Site>();
    const stack = this.reads(site);
    while (stack.length > 0) {
      const next = stack.pop()!;
      const key = siteKey(next);
      if (seen.has(key)) continue;
      seen.set(key, next);
      stack.push(...this.reads(next));
    }
    return seen;
  }
}

/** The sites of a field: one for each row when it is in a grid's cell. */
function sitesOf(node: FieldNode): Site[] {
  if (!node.grid) return [{ node, row: null }];
  return [...new Set(node.grid.rows)].map((row) => ({ node, row }));
}

/**
 * More tries than this are not made. A form's conditions take a handful: the search only asks for an
 * answer when a condition needs it, so it is the tangled cases that grow, not the long ones.
 */
const MAX_TRIES = 20_000;
/**
 * Whether an answer counts hangs on the answers its field's conditions read, and so on down a chain
 * of follow-ups. Deeper than this the chain is not followed: no form has one near it.
 */
const MAX_DEPTH = 200;

function checkVisibility(model: PathModel, context: ValidateContext, report: Report) {
  const visibility = new Visibility(model);
  const lifted = new Lifted(model, context.origins);
  const cyclic = new Set<string>();
  for (const node of model.nodes)
    for (const site of sitesOf(node)) {
      if (!visibility.reach(site).has(siteKey(site))) continue;
      cyclic.add(siteKey(site));
      // A cycle that only the condition on an include makes is that include's fault.
      const without = lifted.of(node);
      if (without && !without.visibility.reach({ node: without.node, row: site.row }).has(siteKey(site))) {
        report(
          without.at,
          'condition_cycle',
          'the condition on this include names an answer inside the module it shows, so whether that answer shows hangs on itself',
        );
        continue;
      }
      // Hidden until something is answered that can only be answered, or only counts, once it shows.
      report(
        node.at,
        'condition_cycle',
        'whether this field shows, or counts, hangs on its own answer; follow its conditions, and those of the fields they name, back to it',
      );
    }

  for (const node of model.nodes) {
    if (!node.field.required) continue;
    const outcomes = sitesOf(node).map((site) => canShow(visibility, site, cyclic));
    if (outcomes.length === 0 || outcomes.some((outcome) => outcome === 'yes' || outcome === 'unknown'))
      continue;
    if (outcomes.includes('too_many'))
      report(
        `${node.at}.required`,
        'visibility_too_complex',
        `its conditions are too tangled to try every case (more than ${MAX_TRIES} tries), so nothing shows that it can ever be visible`,
      );
    else if (outcomes.includes('too_deep'))
      report(
        `${node.at}.required`,
        'visibility_too_complex',
        `it hangs on a chain of more than ${MAX_DEPTH} follow-ups, each shown by the one before, which is not followed to its end`,
      );
    else {
      // Never visible only because of the condition on the include that brought it in: that
      // condition, in the note type, is what to mend.
      const without = lifted.of(node);
      const shows =
        without &&
        sitesOf(without.node).some((site) => canShow(without.visibility, site, new Set()) === 'yes');
      if (shows)
        report(
          without.at,
          'required_never_visible',
          `the condition on this include never holds, so the required field at ${locate(context.origins ?? [], node.at).path} in the module never shows`,
        );
      else
        report(
          `${node.at}.required`,
          'required_never_visible',
          'no set of answers shows this field, so nothing would ever ask for it: its conditions, with those around it, cannot all hold',
        );
    }
  }
}

/**
 * The definition as it would be without the condition an include added to one section: what shows
 * whether a fault is that condition's. Null when the section has no such condition.
 */
class Lifted {
  private readonly cache = new Map<string, { at: string; model: PathModel; visibility: Visibility } | null>();
  constructor(
    private readonly model: PathModel,
    private readonly origins: readonly Origin[] | undefined,
  ) {}

  of(node: FieldNode): { at: string; node: FieldNode; visibility: Visibility } | null {
    const lifted = this.section(node.section);
    const same = lifted?.model.nodes.find((n) => n.at === node.at);
    return lifted && same ? { at: lifted.at, node: same, visibility: lifted.visibility } : null;
  }

  private section(section: SectionNode) {
    if (this.cache.has(section.at)) return this.cache.get(section.at)!;
    let found: { at: string; model: PathModel; visibility: Visibility } | null = null;
    const { showWhen } = section.section;
    if (this.origins && showWhen) {
      const own = locate(this.origins, section.at).file;
      // The resolver writes an include's condition as the section's, or as the first of two.
      for (const at of [`${section.at}.showWhen.all[0]`, `${section.at}.showWhen`]) {
        const origin = this.origins.find((o) => o.at === at);
        if (!origin || origin.file === own) continue;
        const index = this.model.sections.indexOf(section);
        const definition = {
          ...this.model.definition,
          sections: this.model.definition.sections.map((s) => {
            if (s !== section.section) return s;
            const { showWhen: _dropped, ...rest } = s;
            const kept = at.endsWith('.all[0]') && 'all' in showWhen ? showWhen.all[1] : undefined;
            return kept ? { ...rest, showWhen: kept } : rest;
          }),
        };
        const model = pathModel(definition);
        if (model.sections[index]?.at !== section.at) break;
        found = { at, model, visibility: new Visibility(model) };
        break;
      }
    }
    this.cache.set(section.at, found);
    return found;
  }
}

/** What a choose-one (or any other) answer is, as far as any condition can tell. */
type State = { filled: boolean; picked: Set<string> };

/** A condition under the answers tried so far: it holds, it does not, or it first needs this answered. */
type Verdict = boolean | Question;
/** An answer to try; for a choose-many, one of its options (or a class of them) to try picked or not. */
type Question = { leaf: Leaf; option?: string };

/** The text of an option that no condition asks about, as one stand-in. */
const REST = ' rest';

/**
 * A choose-many answer, as the conditions that read it can tell it apart: each code they ask about
 * (or each class of codes asked about together, that no rule of the field singles out) is picked
 * or not, and one more stands for any option none of them asks about. Two can be held together
 * unless one is exclusive or they are a blocked pair.
 */
type Many = { classOf: Map<string, string>; all: string[]; together: (a: string, b: string) => boolean };

function manyOf(leaf: Leaf, lists: string[][]): Many {
  const holds = leaf.holds as Extract<Leaf['holds'], { type: 'codes' }>;
  const exclusive = new Set(holds.options.filter((o) => o.exclusive).map((o) => o.code));
  const singled = new Set([...exclusive, ...holds.excludes.flat()]);
  const asked = new Set(lists.flat());
  const classOf = new Map<string, string>();
  const stands = new Map<string, string>();
  for (const code of asked) {
    const lot = singled.has(code) ? code : lists.map((list) => (list.includes(code) ? '1' : '0')).join('');
    if (!stands.has(lot)) stands.set(lot, code);
    classOf.set(code, stands.get(lot)!);
  }
  const all = [...stands.values()];
  // The option an unasked pick stands for: one that is free of every rule when there is one.
  const unasked = holds.options.filter((o) => !asked.has(o.code));
  const rest = unasked.find((o) => !singled.has(o.code)) ?? unasked[0];
  if (rest) all.push(REST);
  const codeOf = (v: string) => (v === REST ? rest!.code : v);
  const together = (a: string, b: string) => {
    const [x, y] = [codeOf(a), codeOf(b)];
    if (exclusive.has(x) || exclusive.has(y)) return false;
    return !holds.excludes.some(([p, q]) => (p === x && q === y) || (p === y && q === x));
  };
  return { classOf, all, together };
}

/**
 * Whether some set of answers shows the site. An answer is tried, in every state a condition can
 * tell apart, only once a condition needs it: one that is already decided without it is not
 * multiplied by it. A choose-many is tried an option at a time, picked or not, so a condition on
 * any of sixteen options is sixteen short tries, not two to the sixteenth. So the search is
 * complete, and a long chain of follow-ups stays short.
 */
function canShow(
  visibility: Visibility,
  site: Site,
  cyclic: Set<string>,
): 'yes' | 'no' | 'unknown' | 'too_many' | 'too_deep' {
  const involved = [site, ...visibility.reach(site).values()];
  // A cycle has no answer to work out. It is reported as a cycle.
  if (involved.some((s) => cyclic.has(siteKey(s)))) return 'unknown';

  // For each answer read, the code lists it is asked for: they decide which states can be told apart.
  const asked = new Map<string, string[][]>();
  for (const s of involved)
    for (const formula of visibility.rulesOf(s).shows)
      leavesIn(formula, (test) => {
        const lists = asked.get(test.leaf.key) ?? [];
        asked.set(test.leaf.key, lists);
        if (test.is) lists.push(test.is);
      });
  const isMany = (leaf: Leaf) => leaf.holds.type === 'codes' && leaf.holds.many;
  const manies = new Map<string, Many>();
  const many = (leaf: Leaf) => {
    let found = manies.get(leaf.key);
    if (!found) manies.set(leaf.key, (found = manyOf(leaf, asked.get(leaf.key) ?? [])));
    return found;
  };

  const answers = new Map<string, State>();
  const picks = new Map<string, Map<string, boolean>>();
  const counts = new Map<string, boolean>();
  let depth = 0;
  const allOf = <T>(parts: T[], verdict: (part: T) => Verdict): Verdict => {
    for (const part of parts) {
      const v = verdict(part);
      if (v !== true) return v;
    }
    return true;
  };
  /** What an answer says to a test of it (`is` null: whether it is filled), counting or not. */
  const says = (leaf: Leaf, is: string[] | null): Verdict => {
    if (!isMany(leaf)) {
      const answer = answers.get(leaf.key);
      if (!answer) return { leaf };
      return is ? is.some((code) => answer.picked.has(code)) : answer.filled;
    }
    const { classOf, all } = many(leaf);
    const set = picks.get(leaf.key);
    const wanted = is ? [...new Set(is.map((code) => classOf.get(code)!))] : all;
    let open: string | undefined;
    for (const option of wanted) {
      const picked = set?.get(option);
      if (picked === true) return true;
      if (picked === undefined) open ??= option;
    }
    return open === undefined ? false : { leaf, option: open };
  };
  // An answer counts while its field shows and no flag that clears it is set and counts itself.
  const countsAt = (leaf: Leaf): Verdict => {
    const key = siteKey(siteOf(leaf));
    const known = counts.get(key);
    if (known !== undefined) return known;
    if (++depth > MAX_DEPTH) throw TOO_DEEP;
    try {
      const rules = visibility.rulesOf(siteOf(leaf));
      const verdict = allOf<Formula | Leaf>([...rules.shows, ...rules.clearedBy], (part) => {
        if (!('key' in part)) return holds(part);
        const set = answered(part, null);
        return typeof set === 'boolean' ? !set : set;
      });
      if (typeof verdict === 'boolean') counts.set(key, verdict);
      return verdict;
    } finally {
      depth--;
    }
  };
  /** What a counting answer says; false when it does not count. */
  const answered = (leaf: Leaf, is: string[] | null): Verdict => {
    const counting = countsAt(leaf);
    if (counting !== true) return counting;
    return says(leaf, is);
  };
  const holds = (formula: Formula): Verdict => {
    if ('all' in formula) return allOf(formula.all, holds);
    if ('any' in formula) {
      for (const part of formula.any) {
        const v = holds(part);
        if (v !== false) return v;
      }
      return false;
    }
    if ('not' in formula) {
      const v = holds(formula.not);
      return typeof v === 'boolean' ? !v : v;
    }
    return answered(formula.leaf, formula.is);
  };

  let tries = 0;
  const search = (): 'yes' | 'no' | 'too_many' => {
    if (++tries > MAX_TRIES) return 'too_many';
    counts.clear();
    const verdict = allOf(visibility.rulesOf(site).shows, holds);
    if (typeof verdict === 'boolean') return verdict ? 'yes' : 'no';
    const { leaf, option } = verdict;
    if (option !== undefined) {
      const set = picks.get(leaf.key) ?? new Map<string, boolean>();
      picks.set(leaf.key, set);
      const { together } = many(leaf);
      // Picked first, where it can be held with what is picked already: most conditions ask for
      // something to be there.
      if ([...set].every(([other, picked]) => !picked || together(other, option))) {
        set.set(option, true);
        const found = search();
        if (found !== 'no') return found;
      }
      set.set(option, false);
      const found = search();
      if (found !== 'no') return found;
      set.delete(option);
      return 'no';
    }
    for (const state of statesOf(leaf, asked.get(leaf.key) ?? [])) {
      answers.set(leaf.key, state);
      const found = search();
      if (found !== 'no') return found;
    }
    answers.delete(leaf.key);
    return 'no';
  };
  try {
    return search();
  } catch (error) {
    if (error === TOO_DEEP) return 'too_deep';
    throw error;
  }
}

const TOO_DEEP = new Error('a chain of follow-ups deeper than is followed');

/**
 * The states of one answer that is not a choose-many, as the conditions asking about it can tell
 * them apart. For a choice, codes that are in exactly the same asked lists stand or fall together:
 * one of them stands for all, so a list of forty codes is one case.
 */
function statesOf(leaf: Leaf, lists: string[][]): State[] {
  const empty: State = { filled: false, picked: new Set() };
  const other: State = { filled: true, picked: new Set() };
  if (leaf.holds.type !== 'codes') return [other, empty];
  const asked = new Set(lists.flat());
  const stands = new Map<string, string>();
  for (const code of asked) {
    const lot = lists.map((list) => (list.includes(code) ? '1' : '0')).join('');
    if (!stands.has(lot)) stands.set(lot, code);
  }
  // The fuller states first: most conditions ask for something to be there.
  const states: State[] = [...stands.values()].map((code) => ({ filled: true, picked: new Set([code]) }));
  // Filled with none of the codes asked about, where the field has such an option.
  if (leaf.holds.options.some((option) => !asked.has(option.code))) states.push(other);
  states.push(empty);
  return states;
}
