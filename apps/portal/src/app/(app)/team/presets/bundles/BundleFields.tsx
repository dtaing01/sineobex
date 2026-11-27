import { ChoiceGroup } from '@/components/presets/ChoiceGroup';
import { FreeText } from '@/components/presets/FreeText';
import { ItemLines, type ItemChoice } from '@/components/presets/ItemLines';
import { LongText } from '@/components/presets/LongText';
import { FIELD_LABELS } from '@/components/presets/review';
import type { BundleBody, PresetRow } from '@/lib/presets';

/**
 * A bundle's fields, on Add a bundle and on a bundle's own page (phase 5 design 4.4, 8.1): its name,
 * Medical or Non-Medical, its lines (item, quantity, Core) and what to ask before applying it.
 * Each is named by its body path, so the API's answer about it is said beside it.
 */

export type Bundle = PresetRow<'bundle'>;

export const LABELS = FIELD_LABELS.bundle;

/** 8.1's sentence under the prompt (PRD main 445), word for word. */
export const PROMPT_HINT = 'Asked before the bundle is used, so a bundle never stands in for an assessment.';

/** The lines a bundle holds at most (packages/presets/src/schemas.ts): the form offers no more. */
const MOST_LINES = 40;

// What each tag means where a bundle is used, and the tag's rule (design 4.4), in words: the API
// holds every bundle to it.
const TAGS = [
  { value: 'true', label: 'Medical', hint: 'Offered only at a Medical visit.' },
  { value: 'false', label: 'Non-Medical', hint: 'Offered at any visit.' },
];

/** "Medical · 3 items, 1 optional · Asks before applying": what a bundle is, in a line. */
export function bundleSummary(body: BundleBody): string {
  const optional = body.lines.filter((l) => !l.core).length;
  const n = body.lines.length;
  return [
    body.medical ? 'Medical' : 'Non-Medical',
    `${n} ${n === 1 ? 'item' : 'items'}${optional > 0 ? `, ${optional} optional` : ''}`,
    ...(body.prompt !== '' ? ['Asks before applying'] : []),
  ].join(' · ');
}

/** The fields, empty for a new bundle or as `bundle` holds them now. */
export function BundleFields({ items, bundle }: { items: readonly ItemChoice[]; bundle?: BundleBody }) {
  return (
    <>
      <FreeText name="name" label={LABELS.name} {...(bundle ? { defaultValue: bundle.name } : {})} />
      <ChoiceGroup
        name="medical"
        legend={LABELS.medical}
        hint="A bundle that holds a medication must be Medical."
        options={TAGS}
        {...(bundle ? { defaultValue: String(bundle.medical) } : {})}
      />
      <ItemLines
        name="lines"
        legend={LABELS.lines}
        hint="A core item is ticked when the bundle is used; an optional one is left for staff to tick."
        items={items}
        lines={(bundle?.lines ?? []).map((l) => ({ itemId: l.itemId, quantity: l.qty, core: l.core }))}
        quantity={{ field: 'qty', label: 'Quantity' }}
        core
        max={MOST_LINES}
      />
      <LongText
        name="prompt"
        label={LABELS.prompt}
        hint={PROMPT_HINT}
        {...(bundle ? { defaultValue: bundle.prompt } : {})}
      />
    </>
  );
}
