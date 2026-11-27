/**
 * The body of each kind of team preset (phase 5 design 4.4, D128): one zod schema per kind. The
 * API checks every body a person sends against its kind's schema, then against the team's other
 * presets (validate.ts); the phone's parsers read the same shapes (P2-models), and
 * packages/contract/test-vectors/preset-bodies.json pins both.
 *
 * The schemas validate and never transform, but for a default: a body is stored as it was sent, and
 * hashed and compared as stored, so a `.trim()` here would store a string the admin never typed. A
 * text that starts or ends with white space is refused instead, never trimmed for its sender.
 * Every length is counted in code points, as zod and the database's length() count it. Every object
 * is strict, so a key a later phase adds is refused by a server that does not know it yet; the phone
 * ignores such a key, so an older phone still reads a body a later phase grew. A field a later
 * phase adds joins its body optional, with a default, so an older body reads as a newer one does.
 *
 * Pure, and in the API's edge bundle: nothing here may import a package but zod and the forms index
 * (test/import-path.test.ts).
 */
import { KEY, OPTION_CODE, PATH_PART } from '@sineobex/forms';
import { z } from 'zod';

/** The eight kinds, in the order the pages list them. Phase 10 adds `billing_code_map`. */
export const PRESET_KINDS = [
  'order_category',
  'item',
  'bundle',
  'flag',
  'field_supply_map',
  'condition_supply_map',
  'bag',
  'settings',
] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];

/** A text as it is stored: never padded with white space, `min` to `max` code points. */
const text = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((s) => s === s.trim(), { message: 'untrimmed' });

/** A preset's name, which its head copies; the database holds the same bound (0023). */
const Name = text(1, 80);

/** Another preset of the same team. Which kind it must be, and that it exists, is validatePreset's. */
const Id = z.string().uuid();

/**
 * A list that names an item at most once: the later line naming one is refused, at its `itemId`, so
 * the admin is shown the line to take out. A bundle or a bag with an item twice would count it in
 * two places that could disagree.
 */
const oncePerItem = <T extends { itemId: string }>(lines: T[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    if (seen.has(line.itemId)) ctx.addIssue({ code: 'custom', path: [i, 'itemId'], message: 'item_twice' });
    seen.add(line.itemId);
  });
};

const OrderCategory = z.strictObject({
  name: Name,
  // What the category's items are: a lab records a result (validatePreset), a medication makes an
  // item Medical. Fixed at creation (rules.ts), so old orders keep their meaning.
  behaviour: z.enum(['supply', 'medication', 'lab']),
  sort: z.int().min(0).max(1_000_000),
});

// PLAN-OPEN (BM-66): what can a Labs result be? A choice from a list of 2 to 12 options, or a
// number with a unit; a new type of result is a new shape, joining both parsers optional.
const LabResult = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('choice'),
    options: z
      .array(text(1, 40))
      .min(2)
      .max(12)
      // Two options a person cannot tell apart on a result screen: the later one is refused.
      .superRefine((options, ctx) => {
        const seen = new Set<string>();
        options.forEach((option, i) => {
          const folded = option.toLowerCase();
          if (seen.has(folded)) ctx.addIssue({ code: 'custom', path: [i], message: 'option_twice' });
          seen.add(folded);
        });
      }),
  }),
  z.strictObject({ type: z.literal('number'), unit: text(1, 20) }),
]);

const Item = z.strictObject({
  name: Name,
  categoryId: Id,
  // Counted in its dispensing unit, set at creation and never converted (PRD main 469, 472).
  unit: text(1, 20),
  medical: z.boolean(),
  captureLot: z.boolean(),
  // Null when the item records none. Never left out, so every body says which.
  result: LabResult.nullable(),
});

const Bundle = z.strictObject({
  name: Name,
  // The Medical or Non-Medical tag (PRD main 447).
  medical: z.boolean(),
  // PLAN-OPEN (BM-74): what does a bundle's prompt say? Optional text of up to 300 characters,
  // asked before the bundle is applied (phase 6 asks it); empty asks nothing.
  prompt: text(0, 300).default(''),
  lines: z
    .array(
      z.strictObject({
        itemId: Id,
        qty: z.int().min(1).max(99),
        // A core line is checked when the bundle is applied, an optional one is not (PRD main 441).
        core: z.boolean(),
      }),
    )
    .min(1)
    .max(40)
    .superRefine(oncePerItem),
});

// PLAN-OPEN (TM-36): which colours can a flag have? Eight named colours that pass contrast in all
// three themes, each with a plain name shown before the flag's own ("Red · High"); no free colour.
/** The palette, in its order: a body holds `color`, and a pill shows `name` first (PRD main 945). */
export const FLAG_COLORS = [
  { color: 'red', name: 'Red' },
  { color: 'orange', name: 'Orange' },
  { color: 'yellow', name: 'Yellow' },
  { color: 'green', name: 'Green' },
  { color: 'teal', name: 'Teal' },
  { color: 'blue', name: 'Blue' },
  { color: 'purple', name: 'Purple' },
  { color: 'grey', name: 'Grey' },
] as const;
export type FlagColor = (typeof FLAG_COLORS)[number]['color'];

const Flag = z.strictObject({
  name: Name,
  // Fixed at creation, as `sensitive` is (rules.ts): a risk level never becomes a condition.
  tier: z.enum(['primary', 'secondary']),
  // PLAN-OPEN (BM-68): are a flag's criteria rules the app runs, or text for people? Text: nothing
  // flags a patient by itself (PRD main 512 puts raising a flag automatically in V2).
  criteria: text(0, 500).default(''),
  color: z.enum(FLAG_COLORS.map((c) => c.color) as [FlagColor, ...FlagColor[]]),
  rank: z.int().min(0).max(1_000_000),
  // Hidden from whoever may not see a sensitive problem (D136). Never true on a primary flag
  // (validatePreset), and fixed at creation: turning it off would show past history to readers it
  // was hidden from (D132).
  sensitive: z.boolean(),
});

/** One part of an answer path, as forms writes one (forms 2.3). */
const PART = PATH_PART.source.slice(1, -1);
/**
 * A field's or a grid cell's answer path, written without an entry part as `mapsTo` writes one: a
 * map names a field of the note type, whichever entry holds the answer (forms 2.2).
 */
const AnswerPath = z.string().regex(new RegExp(`^${PART}(?:\\.${PART}){1,3}$`));
const OptionCode = z.string().regex(OPTION_CODE);

/**
 * What a map fires on at its path. Exactly one test: a union of strict objects, so a key the server
 * does not know is reported as that key, and two tests together as no shape at all. Which tests fit
 * the field is validatePreset's.
 */
const When = z.union([
  z.strictObject({ equals: z.union([OptionCode, z.number(), z.literal(true)]) }),
  z.strictObject({ includes: OptionCode }),
  z.strictObject({ answered: z.literal(true) }),
]);

const FieldSupplyMap = z
  .strictObject({
    name: Name,
    noteTypeKey: z.string().regex(KEY),
    // Both there, or both left out: left out, the map fires once for every note of the type
    // ("wound care → 1 bandage", PRD main 470). Fixed at creation with the note type (rules.ts).
    path: AnswerPath.optional(),
    when: When.optional(),
    lines: z
      .array(
        z.strictObject({
          itemId: Id,
          // A count of its own, or a number the note holds, read where the map fires (supplies.ts).
          qty: z.union([z.int().min(1).max(99), z.strictObject({ fromPath: AnswerPath })]),
        }),
      )
      .min(1)
      .max(10),
  })
  .superRefine((map, ctx) => {
    if (map.path !== undefined && map.when === undefined)
      ctx.addIssue({ code: 'custom', path: ['when'], message: 'path_without_when' });
    if (map.when !== undefined && map.path === undefined)
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'when_without_path' });
  });

/** ICD-10-CM by its shape only, as a problem's code is checked (0010_problems.sql). */
const ICD10CM_CODE = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;

const ConditionSupplyMap = z.strictObject({
  name: Name,
  // PLAN-OPEN (BM-72): does a condition map match a code family (L30 and every code under it)?
  // No, exact codes only, so no code nobody meant to map is counted.
  codes: z.array(z.string().regex(ICD10CM_CODE)).min(1).max(20),
  lines: z
    .array(z.strictObject({ itemId: Id, qtyPerPatient: z.int().min(1).max(99) }))
    .min(1)
    .max(10),
});

/** What a bag holds at least; the settings' template for a new bag is the same list. */
const Minimums = z
  .array(z.strictObject({ itemId: Id, min: z.int().min(1).max(999) }))
  .max(200)
  .superRefine(oncePerItem);

// PLAN-OPEN (PL-15): are bags defined in phase 5? Yes, a name and its minimums; phase 6 adds stock
// and owners.
const Bag = z.strictObject({ name: Name, minimums: Minimums });

// PLAN-OPEN (PL-21): where do team settings live? In this one preset per team, versioned and sent
// to phones like every preset; a setting a later phase builds joins it, optional with a default.
const Settings = z.strictObject({
  // One settings preset per team, never removed (rules.ts), so its name is no choice.
  name: z.literal('Team settings'),
  bagMinimumsOn: z.boolean(),
  newBagMinimums: Minimums,
  // PLAN-OPEN (BM-76): when is a problem due a status check? When it is New or Ongoing and was not
  // checked within the team's window: 7 to 365 days, the platform's 90 (problem-check.ts).
  problemCheckDays: z.int().min(7).max(365),
});

/** One schema per kind. The phone skips a kind it does not know; the server has no schema for one. */
export const BODY_SCHEMAS = {
  order_category: OrderCategory,
  item: Item,
  bundle: Bundle,
  flag: Flag,
  field_supply_map: FieldSupplyMap,
  condition_supply_map: ConditionSupplyMap,
  bag: Bag,
  settings: Settings,
} as const satisfies { readonly [K in PresetKind]: z.ZodType };

export type OrderCategoryBody = z.output<typeof OrderCategory>;
export type ItemBody = z.output<typeof Item>;
export type BundleBody = z.output<typeof Bundle>;
export type FlagBody = z.output<typeof Flag>;
export type FieldSupplyMapBody = z.output<typeof FieldSupplyMap>;
export type ConditionSupplyMapBody = z.output<typeof ConditionSupplyMap>;
export type BagBody = z.output<typeof Bag>;
export type SettingsBody = z.output<typeof Settings>;
/** The body of a preset of kind K, as its schema parses it. */
export type PresetBodyOf<K extends PresetKind> = z.output<(typeof BODY_SCHEMAS)[K]>;
export type PresetBody = PresetBodyOf<PresetKind>;
