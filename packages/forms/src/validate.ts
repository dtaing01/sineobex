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
import type { FileProblem, Origin, ResolvedField, ResolvedNoteType } from './resolve.ts';
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
  checkVisibility(model, report);
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
        return report(`${at}.field`, rule, PATH_FAULTS[named.fault](test.field));
      }
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
      wanted.forEach((code, index) => {
        if (!codes.has(code))
          report(
            typeof test.is === 'string' ? `${at}.is` : `${at}.is[${index}]`,
            'condition_unknown_code',
            `"${code}" is not the code of an option at "${test.field}": the condition could never hold for it`,
          );
      });
    });
  };
  for (const section of model.sections) check(section.section.showWhen, section, null);
  for (const node of model.nodes) {
    if (!node.field.showWhen) continue;
    // Every row of a grid has the same cell, so what holds for one row's paths holds for all.
    if (!node.grid) check(node.field.showWhen, node, null);
    else if (node.grid.rows.length > 0) check(node.field.showWhen, node, node.grid.rows[0]!);
  }
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

  for (const node of model.nodes) {
    const { field } = node;
    for (const { key, options } of optionLists(node))
      options.forEach((option, index) => {
        if (option.suggests !== undefined) known(option.suggests, `${node.at}.${key}[${index}].suggests`);
      });
    if (field.kind === 'action' && field.action === 'open_note_type')
      known(field.noteType, `${node.at}.noteType`);
    if (field.mapsTo !== undefined) checkMapsTo(node, field.mapsTo, other, report);
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
  if (!node.base)
    return report(
      at,
      'maps_to_in_grid',
      'the cell of a grid has no path of its own to map; the grid is what maps',
    );
  const full = other(key);
  if (!full) return report(at, 'unknown_note_type', `there is no note type "${key}"`);
  const target = full.nodes.find((n) => n.base?.join('.') === path);
  if (!target) return report(at, 'maps_to_unknown_field', `"${key}" has no field at "${path}"`);

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
    return to.many === from.many && from.options.every((option) => codes.has(option.code));
  }
  if (to.type === 'text' && from.type === 'text') return from.maxLength <= to.maxLength;
  if (to.type === 'number' && from.type === 'number')
    return from.min >= to.min && from.max <= to.max && from.decimals <= to.decimals;
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
      for (const option of [...field.options, ...(field.side ?? [])])
        if (option.exclusive || option.other)
          report(
            at,
            'region_option_flag',
            `option "${option.code}" of a region cannot be ${option.other ? 'an Other option' : 'exclusive'}`,
          );

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
    // would wait for ever; a group and a grid store only through their fields, and whether
    // "filled" means one of them or all of them is for each field to say.
    if (field.required && (STORES_NOTHING.has(field.kind) || field.kind === 'group' || field.kind === 'grid'))
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

function checkVisibility(model: PathModel, report: Report) {
  const visibility = new Visibility(model);
  const cyclic = new Set<string>();
  for (const node of model.nodes)
    for (const site of sitesOf(node)) {
      const reach = visibility.reach(site);
      if (!reach.has(siteKey(site))) continue;
      cyclic.add(siteKey(site));
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
        `its conditions are too tangled to try every case (${MAX_TRIES} tries), so nothing shows that it can ever be visible`,
      );
    else
      report(
        `${node.at}.required`,
        'required_never_visible',
        'no set of answers shows this field, so nothing would ever ask for it: its conditions, with those around it, cannot all hold',
      );
  }
}

/** What an answer is, as far as any condition can tell. */
type State = { filled: boolean; picked: Set<string> };

/** A condition under the answers tried so far: it holds, it does not, or it first needs this answer. */
type Verdict = boolean | Leaf;

/**
 * Whether some set of answers shows the site. An answer is tried, in every state a condition can
 * tell apart, only once a condition needs it: one that is already decided without it is not
 * multiplied by it. So the search is complete, and a long chain of follow-ups stays short.
 */
function canShow(
  visibility: Visibility,
  site: Site,
  cyclic: Set<string>,
): 'yes' | 'no' | 'unknown' | 'too_many' {
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

  const answers = new Map<string, State>();
  const counts = new Map<string, boolean>();
  const allOf = <T>(parts: T[], verdict: (part: T) => Verdict): Verdict => {
    for (const part of parts) {
      const v = verdict(part);
      if (v !== true) return v;
    }
    return true;
  };
  // An answer counts while its field shows and no flag that clears it is set and counts itself.
  const countsAt = (leaf: Leaf): Verdict => {
    const key = siteKey(siteOf(leaf));
    const known = counts.get(key);
    if (known !== undefined) return known;
    const rules = visibility.rulesOf(siteOf(leaf));
    const verdict = allOf<Formula | Leaf>([...rules.shows, ...rules.clearedBy], (part) => {
      if (!('key' in part)) return holds(part);
      const set = answered(part, (answer) => answer.filled);
      return typeof set === 'boolean' ? !set : set;
    });
    if (typeof verdict === 'boolean') counts.set(key, verdict);
    return verdict;
  };
  /** What a counting answer says; false when it does not count. */
  const answered = (leaf: Leaf, says: (answer: State) => boolean): Verdict => {
    const counting = countsAt(leaf);
    if (counting !== true) return counting;
    const answer = answers.get(leaf.key);
    return answer ? says(answer) : leaf;
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
    const { is } = formula;
    return answered(formula.leaf, (answer) =>
      is ? is.some((code) => answer.picked.has(code)) : answer.filled,
    );
  };

  let tries = 0;
  const search = (): 'yes' | 'no' | 'too_many' => {
    if (++tries > MAX_TRIES) return 'too_many';
    counts.clear();
    const verdict = allOf(visibility.rulesOf(site).shows, holds);
    if (typeof verdict === 'boolean') return verdict ? 'yes' : 'no';
    const states = statesOf(verdict, asked.get(verdict.key) ?? []);
    if (!states) return 'too_many';
    for (const state of states) {
      answers.set(verdict.key, state);
      const found = search();
      if (found !== 'no') return found;
    }
    answers.delete(verdict.key);
    return 'no';
  };
  return search();
}

/**
 * The states of one answer that the conditions asking about it can tell apart. For a choice, codes
 * that are in exactly the same asked lists, and that no rule of the field singles out, stand or
 * fall together: one of them stands for all, so a list of forty codes is one case. Null when there
 * are more states than can be tried.
 */
function statesOf(leaf: Leaf, lists: string[][]): State[] | null {
  const empty: State = { filled: false, picked: new Set() };
  const other: State = { filled: true, picked: new Set() };
  if (leaf.holds.type !== 'codes') return [other, empty];
  const { options, many, excludes } = leaf.holds;

  const exclusive = new Set(options.filter((option) => option.exclusive).map((option) => option.code));
  const singled = new Set([...exclusive, ...excludes.flat()]);
  const asked = new Set(lists.flat());
  const stands = new Map<string, string>();
  for (const code of asked) {
    const lot =
      singled.has(code) && many ? code : lists.map((list) => (list.includes(code) ? '1' : '0')).join('');
    if (!stands.has(lot)) stands.set(lot, code);
  }
  const codes = [...stands.values()];

  // The fuller states first: most conditions ask for something to be there.
  const states: State[] = [];
  if (!many) for (const code of codes) states.push({ filled: true, picked: new Set([code]) });
  else if (2 ** codes.length > MAX_TRIES) return null;
  else
    for (let set = (1 << codes.length) - 1; set > 0; set--) {
      const picked = codes.filter((_, i) => set & (1 << i));
      const alone = picked.length === 1;
      if (!alone && picked.some((code) => exclusive.has(code))) continue;
      if (excludes.some(([a, b]) => a !== b && picked.includes(a) && picked.includes(b))) continue;
      states.push({ filled: true, picked: new Set(picked) });
    }
  // Filled with none of the codes asked about, where the field has such an option.
  if (options.some((option) => !asked.has(option.code))) states.push(other);
  states.push(empty);
  return states;
}
