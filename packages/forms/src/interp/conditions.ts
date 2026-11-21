/**
 * Which answers of a note count, and whether a condition holds (docs/design/phase-4/forms.md, 2.2,
 * 2.3 and 7.1). The rules every function of the interpreter shares are here and nowhere else:
 *
 *  - An answer counts while its field shows: its section's condition holds, and the condition of
 *    each group and grid around it, and its own. A hidden answer is not deleted: it counts again
 *    when its field shows again.
 *  - While a flag with `clears` is set and counts, the fields it names do not count, nor anything
 *    in them.
 *  - In a grid with rows `{ pickedIn }`, a row counts only while its option is picked.
 *  - In a repeating section, an entry is there while its `entryAt` answer is and its
 *    `entryRemoved` is not true; the answers of an entry that is not there do not count.
 *  - The text of an Other option counts only while an Other option is picked beside it.
 *  - A blank (null, "", [] or {}, lifecycle 4.5) is no answer, and so is an answer `checkAnswer`
 *    refuses: the server and the phone never store one (7.1), so this only decides what a note
 *    that somehow held one would mean, the same way on both sides.
 *  - A condition reads only answers that count: `filled` holds on an answer that counts, and `is`
 *    on a code that counts. `not` of either holds where there is no such answer.
 *
 * Whether a field shows can hang on other answers, and theirs on others again. The validator
 * refuses a definition where that comes round to itself (validate.condition_cycle), so each is
 * worked out once, when it is first asked for, in the order the conditions need them.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import { leafAt } from '../paths.ts';
import type { FieldNode, Leaf, PathModel, SectionNode } from '../paths.ts';
import type { Condition } from '../types.ts';
import { checkAnswer } from './check-answer.ts';
import { definitionModel, ENTRY_ID, fieldAt } from './field-at.ts';

/** A note's answers: a flat map from a path to a value (2.3). */
export type Answers = Readonly<Record<string, unknown>>;

/**
 * No answer: absent, null, "", [] or {}, the blanks of lifecycle 4.5. A field filled in and then
 * cleared is a field never touched, to a condition, to Complete and to the content hash alike.
 */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && Object.keys(value).length === 0;
}

const OTHER = '_other';

/**
 * The answers a field stores itself, at each row and side: what Complete waits for and one-tap
 * Normal fills. Not the text of an Other option, which the option asks for, and nothing of the
 * fields in a group or a grid's cell, which are fields of their own.
 */
export function ownLeaves(node: FieldNode): Leaf[] {
  return node.leaves.filter((leaf) => leaf.node === node && leaf.fieldPath !== null);
}

/** A note's answers read against its definition: what shows, what counts, which entries are there. */
export class NoteReading {
  readonly model: PathModel;
  private readonly shows = new Map<string, boolean>();
  private readonly working = new Set<string>();
  private readonly values = new Map<string, unknown>();
  private readonly live = new Map<SectionNode, string[]>();

  constructor(
    readonly definition: ResolvedNoteType,
    private readonly answers: Answers,
  ) {
    this.model = definitionModel(definition);
  }

  /** Where the answer of a leaf is in a note: in a repeating section the entry's ID is the second part. */
  pathOf(leaf: Leaf, entry: string | null): string {
    if (!leaf.node.section.section.repeat) return leaf.key;
    const [section, ...rest] = leaf.parts;
    return [section, entry, ...rest].join('.');
  }

  /** What is stored at a path, as the note holds it: blank, refused, counting or not. */
  stored(path: string): unknown {
    return Object.hasOwn(this.answers, path) ? this.answers[path] : undefined;
  }

  /**
   * The answer at a path, counting or not: undefined where there is none, where it is blank and
   * where `checkAnswer` refuses it.
   */
  answer(path: string): unknown {
    if (this.values.has(path)) return this.values.get(path);
    const value = this.stored(path);
    const taken = isBlank(value) || checkAnswer(this.definition, path, value) !== null ? undefined : value;
    this.values.set(path, taken);
    return taken;
  }

  /** The answer at a path if it counts, else undefined. */
  counting(path: string): unknown {
    const value = this.answer(path);
    return value !== undefined && this.counts(path) ? value : undefined;
  }

  /** Whether the answer at a path would count, were there one: its field shows there and nothing clears it. */
  counts(path: string): boolean {
    const target = fieldAt(this.definition, path);
    if (!target?.holds) return false;
    const section = this.model.sections.find((s) => s.section === target.section)!;
    if (target.points === 'entry') return this.sectionShows(section) && this.isLive(section, target.entry!);
    return this.leafCounts(target.leaf!, target.entry);
  }

  /**
   * The entries of a repeating section that are there, in the order they were added: by `entryAt`
   * as a time, then by ID, so two entries added in one instant still have one order. Empty for a
   * section that does not repeat.
   */
  entries(section: SectionNode): string[] {
    const known = this.live.get(section);
    if (known) return known;
    const found: [id: string, at: string][] = [];
    if (section.section.repeat) {
      const prefix = `${section.section.id}.`;
      for (const path of Object.keys(this.answers)) {
        if (!path.startsWith(prefix) || !path.endsWith('.entryAt')) continue;
        const id = path.slice(prefix.length, -'.entryAt'.length);
        const at = this.answer(path);
        if (!ENTRY_ID.test(id) || at === undefined) continue;
        if (this.answer(`${prefix}${id}.entryRemoved`) === true) continue;
        found.push([id, instant(at as string)]);
      }
    }
    found.sort(([a, x], [b, y]) => (x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0));
    const entries = found.map(([id]) => id);
    this.live.set(section, entries);
    return entries;
  }

  /** Whether a section's own condition holds. */
  sectionShows(section: SectionNode): boolean {
    const condition = section.section.showWhen;
    // A section's condition cannot start with ./ (2.2), so it reads no entry and no row.
    return this.once(section.at, () => !condition || this.holds(condition, section, null, null));
  }

  /**
   * Whether a field's answers count in a row (in a grid's cell) and an entry (in a repeating
   * section): it shows there, and no flag clears it or anything around it.
   */
  fieldCounts(node: FieldNode, row: string | null, entry: string | null): boolean {
    return this.once(`${node.at} ${row ?? ''} ${entry ?? ''}`, () => {
      const section = node.section;
      if (!this.sectionShows(section)) return false;
      if (section.section.repeat ? entry === null || !this.isLive(section, entry) : entry !== null)
        return false;
      const around: FieldNode[] = [];
      for (let at: FieldNode | null = node; at; at = at.parent) around.unshift(at);
      for (const at of around) {
        // Only what is inside a grid's cell is in a row. The grid's own condition is read from outside.
        const inRow = at.grid ? row : null;
        if (at.field.showWhen && !this.holds(at.field.showWhen, at, inRow, entry)) return false;
        // A row of picked rows is there while its option is picked.
        const grid = at.parent?.cell === at ? at.parent : null;
        if (grid?.picked && (inRow === null || !this.picks(grid.picked, entry, [inRow]))) return false;
        for (const flag of at.siblings)
          if (flag !== at && flag.field.kind === 'flag' && flag.field.clears?.includes(at.field.id))
            if (flag.leaves.some((leaf) => leaf.row === inRow && this.filled(leaf, entry))) return false;
      }
      return true;
    });
  }

  /** Whether the answer at a leaf, in an entry, would count. An entry outside its section is ignored. */
  leafCounts(leaf: Leaf, entry: string | null): boolean {
    const at = leaf.node.section.section.repeat ? entry : null;
    if (!this.fieldCounts(leaf.node, leaf.row, at)) return false;
    // Only the text of an Other option has no field path (paths.ts, Leaf.fieldPath).
    if (leaf.fieldPath !== null || leaf.node.field.kind !== 'choice') return true;
    // Its answer is at the same path with `_other` taken off the field's own part, before any side.
    const sided = leaf.node.field.sides === true || leaf.node.grid?.field.sides === true;
    const parts = [...leaf.parts];
    const own = parts.length - (sided ? 2 : 1);
    parts[own] = parts[own]!.slice(0, -OTHER.length);
    const choice = this.model.leaves.get(parts.join('.'));
    const others = leaf.node.field.options.filter((o) => o.other).map((o) => o.code);
    return choice !== undefined && this.picks(choice, at, others);
  }

  /** Whether a condition holds, read from where it is written (`carrier`), in a row and an entry. */
  holds(
    condition: Condition,
    carrier: FieldNode | SectionNode,
    row: string | null,
    entry: string | null,
  ): boolean {
    if ('all' in condition) return condition.all.every((c) => this.holds(c, carrier, row, entry));
    if ('any' in condition) return condition.any.some((c) => this.holds(c, carrier, row, entry));
    if ('not' in condition) return !this.holds(condition.not, carrier, row, entry);
    const named = leafAt(this.model, condition.field, carrier, row);
    // The validator refuses a condition that names no answer; were one let through, it would read none.
    if ('fault' in named) return false;
    if ('filled' in condition) return this.filled(named.leaf, entry);
    return this.picks(named.leaf, entry, typeof condition.is === 'string' ? [condition.is] : condition.is);
  }

  private isLive(section: SectionNode, entry: string): boolean {
    return this.entries(section).includes(entry);
  }

  /** The leaf holds an answer that counts. */
  private filled(leaf: Leaf, entry: string | null): boolean {
    return this.leafCounts(leaf, entry) && this.answer(this.pathOf(leaf, entry)) !== undefined;
  }

  /** The leaf holds, and counts with, one of these codes: as its one code, or among its list. */
  private picks(leaf: Leaf, entry: string | null, codes: readonly string[]): boolean {
    if (!this.leafCounts(leaf, entry)) return false;
    const value = this.answer(this.pathOf(leaf, entry));
    if (typeof value === 'string') return codes.includes(value);
    return Array.isArray(value) && value.some((code) => codes.includes(code as string));
  }

  private once(key: string, work: () => boolean): boolean {
    const known = this.shows.get(key);
    if (known !== undefined) return known;
    if (this.working.has(key))
      throw new Error(`whether ${key} shows hangs on itself: the definition did not pass the validator`);
    this.working.add(key);
    try {
      const shows = work();
      this.shows.set(key, shows);
      return shows;
    } finally {
      this.working.delete(key);
    }
  }
}

/**
 * An `entryAt` (checkAnswer has taken it: a UTC time, with up to nine digits of a second) as text
 * that sorts as the time does. Compared as written, 10:00:00Z would sort after 10:00:00.5Z.
 */
function instant(entryAt: string): string {
  const fraction = entryAt.length > 20 ? entryAt.slice(20, -1) : '';
  return entryAt.slice(0, 19) + fraction.padEnd(9, '0');
}
