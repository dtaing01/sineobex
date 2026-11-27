import {
  FLAG_COLOR_NAMES,
  type AnswerTest,
  type CategoryBody,
  type FlagColor,
  type LabResult,
  type PresetKind,
} from '@/lib/presets';

/**
 * What each field of a kind's body is called on the preset pages (phase 5 design 8.1), in the
 * order its form shows them. The review of an update and the pages' own forms use the same words,
 * so a person reviewing an update reads the names they edit by.
 */
export const FIELD_LABELS = {
  order_category: { name: 'Name', behaviour: 'What it holds', sort: 'Place in the list' },
  item: {
    name: 'Name',
    categoryId: 'Category',
    unit: 'Counted in',
    medical: 'Medical',
    captureLot: 'Capture lot and expiry',
    result: 'Result',
  },
  bundle: { name: 'Name', medical: 'Medical or Non-Medical', lines: 'Items', prompt: 'Ask before applying' },
  flag: {
    name: 'Name',
    tier: 'List',
    criteria: 'Criteria',
    color: 'Colour',
    // A flag the team ranked gets the platform's rank back when its update is taken in place (5.1).
    rank: 'Place in its list (lowest first)',
    sensitive: 'Sensitive',
  },
  field_supply_map: { name: 'Name', noteTypeKey: 'Note type', path: 'Field', when: 'Answer', lines: 'Items' },
  condition_supply_map: { name: 'Name', codes: 'Condition codes', lines: 'Items' },
  bag: { name: 'Name', minimums: 'Minimums' },
  settings: {
    bagMinimumsOn: 'Bag minimums',
    newBagMinimums: 'Template for new bags',
    problemCheckDays: 'Check problems not updated in',
  },
} as const satisfies { readonly [K in PresetKind]: Readonly<Record<string, string>> };

/** What a category holds (its `behaviour`), in 8.1's words, in the order the add form offers them. */
export const BEHAVIOURS = {
  supply: 'Supplies',
  medication: 'Medications',
  lab: 'Tests',
} as const satisfies Readonly<Record<CategoryBody['behaviour'], string>>;

const TIERS: Readonly<Record<string, string>> = { primary: 'Risk level', secondary: 'Conditions' };

/** A field's value as a person reads it: a text, or a list for a body's lines. */
export type Described = string | readonly string[];

const none = (text: unknown) => (typeof text === 'string' && text !== '' ? text : 'None');
const yesNo = (value: unknown) => (value === true ? 'Yes' : 'No');

/**
 * One field of a body in words. IDs are named from `names` (the team's presets the page read), and
 * an ID it does not hold is said to be so, never shown.
 */
export function describeField(
  kind: PresetKind,
  field: string,
  value: unknown,
  names: Readonly<Record<string, string>>,
): Described {
  const named = (id: unknown) => (typeof id === 'string' && names[id]) || 'Not on your team’s list';
  const lines = (list: unknown, say: (line: Record<string, unknown>) => string) =>
    Array.isArray(list) ? list.map((l) => say(l as Record<string, unknown>)) : [];
  if (value === undefined) return field === 'path' || field === 'when' ? 'Every note of this type' : 'None';
  switch (`${kind}.${field}`) {
    case 'order_category.behaviour':
      return (BEHAVIOURS as Readonly<Record<string, string>>)[String(value)] ?? String(value);
    case 'item.categoryId':
      return named(value);
    case 'item.medical':
    case 'item.captureLot':
    case 'flag.sensitive':
      return yesNo(value);
    case 'item.result': {
      const result = value as LabResult | null;
      if (result === null) return 'None';
      return result.type === 'choice'
        ? `A choice: ${result.options.join(', ')}`
        : `A number in ${result.unit}`;
    }
    case 'bundle.medical':
      return value === true ? 'Medical' : 'Non-Medical';
    case 'bundle.prompt':
    case 'flag.criteria':
      return none(value);
    case 'bundle.lines':
      return lines(
        value,
        (l) => `${named(l.itemId)} × ${String(l.qty)}, ${l.core === true ? 'core' : 'optional'}`,
      );
    case 'flag.tier':
      return TIERS[String(value)] ?? String(value);
    case 'flag.color':
      return FLAG_COLOR_NAMES[value as FlagColor] ?? String(value);
    case 'field_supply_map.when': {
      const when = value as AnswerTest;
      if ('answered' in when) return 'Answered';
      if ('includes' in when) return `Includes ${String(when.includes)}`;
      return `Is ${String(when.equals)}`;
    }
    case 'field_supply_map.lines':
      return lines(value, (l) => {
        const qty = l.qty as number | { fromPath: string };
        return `${named(l.itemId)} × ${typeof qty === 'number' ? qty : `the number in ${qty.fromPath}`}`;
      });
    case 'condition_supply_map.codes':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'condition_supply_map.lines':
      return lines(value, (l) => `${named(l.itemId)} × ${String(l.qtyPerPatient)} per patient`);
    case 'bag.minimums':
    case 'settings.newBagMinimums':
      return lines(value, (l) => `${named(l.itemId)}: at least ${String(l.min)}`);
    case 'settings.bagMinimumsOn':
      return value === true ? 'On' : 'Off';
    case 'settings.problemCheckDays':
      return `${String(value)} days`;
    default:
      return typeof value === 'string' ? none(value) : JSON.stringify(value);
  }
}

/**
 * A page's own words for some fields of a body, read with the whole body: a field supply map's note
 * type, field, answer and lines, named in its note type's words from the note types the page read
 * (item 18). Undefined leaves the field to describeField.
 */
export type BodyWords = (
  field: string,
  value: unknown,
  body: Record<string, unknown>,
) => Described | undefined;

/** A row of the review: a field, as the copy holds it now and as the update would make it. */
export interface ReviewRow {
  field: string;
  label: string;
  now: Described;
  update: Described;
  changes: boolean;
}

/** Whether two values of a body are the same, whatever order their keys came in. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * The review of an update on offer (8.1): every field of the kind's body, the copy's value now
 * beside the update's, each that the update changes marked. A flag's rank is one of them, since
 * taking an update in place gives back the platform's (5.1). A field the page does not know comes
 * after the known ones, by its own name, so nothing the update changes goes unshown. `words`, the
 * page's own, name a field first where they can.
 */
export function reviewRows(
  kind: PresetKind,
  now: object,
  update: object,
  names: Readonly<Record<string, string>>,
  words?: BodyWords,
): ReviewRow[] {
  const a = now as Record<string, unknown>;
  const b = update as Record<string, unknown>;
  const labels: Readonly<Record<string, string>> = FIELD_LABELS[kind];
  const known = Object.keys(labels);
  const others = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((f) => !known.includes(f) && !(kind === 'settings' && f === 'name'))
    .sort();
  return [...known, ...others].map((field) => ({
    field,
    label: labels[field] ?? field,
    now: words?.(field, a[field], a) ?? describeField(kind, field, a[field], names),
    update: words?.(field, b[field], b) ?? describeField(kind, field, b[field], names),
    changes: !same(a[field], b[field]),
  }));
}
