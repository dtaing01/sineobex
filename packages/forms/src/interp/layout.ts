/**
 * A note's answers laid out for a person to read (docs/design/phase-4/forms.md 7.1; lifecycle 5.1,
 * 8.1 and 9.7): the items of each section and entry, each with its labels and its value written
 * out. The read model and the recap are both made from it, so they say the same thing in the same
 * words, and the Dart interpreter writes every value exactly as this does (the vectors hold it).
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType, ResolvedSection } from '../resolve.ts';
import type { FieldNode, Holds, Leaf } from '../paths.ts';
import type { ResolvedField } from '../resolve.ts';
import { NoteReading, ownLeaves } from './conditions.ts';

/** One thing a reader sees: an answer, or the answers of a region, a problem or a choice and its Other text. */
export type Item = {
  /** The answer's path in the note; for a region or a problem, the field's own path. */
  path: string;
  /** The labels along the path: the groups', the grid's, the row's, the field's, then Right or Left. */
  labels: string[];
  value: string;
  /** Every answer path the item shows. */
  covers: string[];
};

export type LaidOutSection = {
  section: ResolvedSection;
  /** A section that does not repeat. */
  items: Item[];
  /** A repeating section's entries that have an item, each with its number among the entries that are there. */
  entries: { id: string; title: string; items: Item[] }[] | null;
};

/** The words for the two sides (forms.md 2.3: right before left). */
export const SIDE_LABELS: Readonly<Record<string, string>> = { right: 'Right', left: 'Left' };

/**
 * The sections of `answers` in the definition's order, with only the sections and entries that
 * have an item. `answers` are answers that count (effectiveAnswers, perhaps less what a reader may
 * not see): each is shown as it is, and nothing here works out a condition again. `skip` leaves a
 * field out, and everything in it.
 *
 * An entry's number is its place among the entries that are there (entryAt, in the order added),
 * as the form numbers them; an entry with nothing to show is not listed, and keeps its number.
 */
export function layOut(
  definition: ResolvedNoteType,
  answers: Readonly<Record<string, unknown>>,
  skip: (node: FieldNode) => boolean = () => false,
): LaidOutSection[] {
  const reading = new NoteReading(definition, answers);
  const laid: LaidOutSection[] = [];
  for (const section of reading.model.sections) {
    const itemsOf = (entry: string | null) => {
      const items: Item[] = [];
      const walker = new Walker(reading, answers, entry, skip, items);
      for (const node of section.nodes) walker.walk(node, [], null);
      return items;
    };
    if (!section.section.repeat) {
      const items = itemsOf(null);
      if (items.length > 0) laid.push({ section: section.section, items, entries: null });
      continue;
    }
    const entries = reading
      .entries(section)
      .map((id, index) => ({
        id,
        title: section.section.repeat!.itemTitle.replaceAll('{n}', String(index + 1)),
        items: itemsOf(id),
      }))
      .filter((entry) => entry.items.length > 0);
    if (entries.length > 0) laid.push({ section: section.section, items: [], entries });
  }
  return laid;
}

class Walker {
  constructor(
    private readonly reading: NoteReading,
    private readonly answers: Readonly<Record<string, unknown>>,
    private readonly entry: string | null,
    private readonly skip: (node: FieldNode) => boolean,
    private readonly items: Item[],
  ) {}

  /** `labels` are those above the field; `row` is the grid row it is in, if any. */
  walk(node: FieldNode, labels: string[], row: string | null): void {
    if (this.skip(node)) return;
    const { field } = node;
    // A grid's cell has no path part of its own, so no label: the row's stands for it.
    const own = node.parent?.cell === node ? labels : [...labels, field.label];
    switch (field.kind) {
      case 'group':
        for (const child of node.children) this.walk(child, own, row);
        return;
      case 'grid': {
        const options = Array.isArray(field.rows)
          ? field.rows
          : node.picked?.holds.type === 'codes'
            ? node.picked.holds.options
            : [];
        for (const code of node.rows) {
          const label = options.find((o) => o.code === code)?.label ?? code;
          this.walk(node.cell!, [...own, label], code);
        }
        return;
      }
      case 'region':
      case 'problem':
        return this.whole(node, own, row);
      case 'photo':
      case 'action':
      case 'info':
        return;
      default:
        for (const leaf of ownLeaves(node).filter((l) => l.row === row)) this.answer(node, leaf, own);
    }
  }

  /** One answer, and for a choice the Other text beside it, on the same side. */
  private answer(node: FieldNode, leaf: Leaf, labels: string[]) {
    const path = this.reading.pathOf(leaf, this.entry);
    if (!Object.hasOwn(this.answers, path)) return;
    const side = node.field.sides || node.grid?.field.sides ? leaf.parts.at(-1)! : null;
    const covers = [path];
    let text: string | undefined;
    const other = node.leaves.find(
      (l) =>
        l.node === node &&
        l.fieldPath === null &&
        l.row === leaf.row &&
        (side === null || l.parts.at(-1) === side),
    );
    if (other) {
      const otherPath = this.reading.pathOf(other, this.entry);
      if (Object.hasOwn(this.answers, otherPath)) {
        covers.push(otherPath);
        text = this.answers[otherPath] as string;
      }
    }
    const value = this.answers[path];
    this.items.push({
      path,
      labels: side === null ? labels : [...labels, SIDE_LABELS[side]!],
      value:
        leaf.holds.type === 'codes'
          ? codeLabels(leaf.holds.options, value as string | string[], text)
          : displayValue(leaf.holds, value, node.field),
      covers,
    });
  }

  /** A region's region, side and surface, or a problem's code and label: one item at the field's path. */
  private whole(node: FieldNode, labels: string[], row: string | null) {
    const leaves = node.leaves.filter((l) => l.node === node && l.row === row);
    const held = leaves
      .map((leaf) => ({ leaf, path: this.reading.pathOf(leaf, this.entry) }))
      .filter(({ path }) => Object.hasOwn(this.answers, path));
    if (held.length === 0) return;
    const at = held[0]!.path;
    const shown = (part: string) => {
      const found = held.find(({ leaf }) => leaf.parts.at(-1) === part);
      return found ? displayValue(found.leaf.holds, this.answers[found.path], node.field) : undefined;
    };
    let value: string;
    if (node.field.kind === 'problem') {
      const [code, label] = [shown('code'), shown('label')];
      value = code !== undefined && label !== undefined ? `${label} (${code})` : (label ?? code)!;
    } else
      value = held
        .map(({ leaf, path }) => displayValue(leaf.holds, this.answers[path], node.field))
        .join(', ');
    this.items.push({
      path: at.slice(0, at.lastIndexOf('.')),
      labels,
      value,
      covers: held.map(({ path }) => path),
    });
  }
}

/**
 * The labels of the options picked, in the definition's order, joined by ', '. The Other text, when
 * there is one, follows the first Other option picked: "Other: <text>".
 */
function codeLabels(
  options: readonly { code: string; label: string; other?: true }[],
  value: string | string[],
  text?: string,
): string {
  const picked = typeof value === 'string' ? [value] : value;
  let placed = text === undefined;
  return options
    .filter((o) => picked.includes(o.code))
    .map((o) => {
      if (placed || !o.other) return o.label;
      placed = true;
      return `${o.label}: ${text}`;
    })
    .join(', ');
}

/**
 * One answer written out, as the holds of its path say: a code's label, several labels joined by
 * ', '; a number at its field's decimals, "n of max" when it is shown out of a maximum, then its
 * unit after a space; Yes for a tick; a duration in weeks and days; anything else as stored.
 */
export function displayValue(holds: Holds, value: unknown, field: ResolvedField | null): string {
  switch (holds.type) {
    case 'codes':
      return codeLabels(holds.options, value as string | string[]);
    case 'number': {
      const shown = (n: number) => n.toFixed(holds.decimals);
      const number =
        field?.kind === 'number' && field.display === 'outOf'
          ? `${shown(value as number)} of ${shown(holds.max)}`
          : shown(value as number);
      return holds.unit === undefined ? number : `${number} ${holds.unit}`;
    }
    case 'flag':
      return 'Yes';
    case 'duration':
      return duration(value as number);
    default:
      return value as string;
  }
}

/** Whole days as weeks, then days, each only when not zero: "0 days", "1 day", "2 weeks 3 days". */
function duration(days: number): string {
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  const parts: string[] = [];
  if (weeks > 0) parts.push(weeks === 1 ? '1 week' : `${weeks} weeks`);
  if (rest > 0 || weeks === 0) parts.push(rest === 1 ? '1 day' : `${rest} days`);
  return parts.join(' ');
}
