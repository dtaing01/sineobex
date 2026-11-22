'use client';

import { useState } from 'react';
import { useFieldId, useFormState } from '@/components/ActionForm';
import { ItemLines, type ItemChoice } from '@/components/presets/ItemLines';
import styles from '@/components/presets/presets.module.css';
import type { ActionState } from '@/lib/forms';

/** A list a new bag's minimums can be filled from: the template for new bags, or one of the bags. */
export interface MinimumsSource {
  /** `template`, or the bag's ID. */
  id: string;
  label: string;
  minimums: readonly { itemId: string; min: number }[];
}

/** The Copy from choice that fills the minimums from the template for new bags. */
export const TEMPLATE = 'template';

/**
 * A new bag's minimums (phase 5 design 8.1; PRD main 930): Copy from, the template for new bags to
 * start with, or one of the team's bags, which fills the lines below with that list; the person
 * changes them as they like, and the API stores the lines sent, never the choice. Choosing again
 * fills them again, also after a refusal, which until then keeps the lines it sent.
 */
export function NewBagMinimums({
  items,
  sources,
  hint,
}: {
  items: readonly ItemChoice[];
  /** The template first, then the bags. */
  sources: readonly MinimumsSource[];
  /** What a minimum means, read with the lines. */
  hint: string;
}) {
  const state = useFormState();
  const id = useFieldId('copyFrom');
  // The person's choice holds until the form's next answer; after one, a refused form shows what
  // it sent, and one that went through starts again from the template.
  const [chosen, setChosen] = useState<{ from: string; at: ActionState } | null>(null);
  const picked = chosen !== null && chosen.at === state ? chosen.from : undefined;
  const sent = state.values?.copyFrom;
  const from = picked ?? (sources.some((s) => s.id === sent) ? sent! : TEMPLATE);
  const source = sources.find((s) => s.id === from);
  const minimums = source?.minimums ?? [];
  return (
    <>
      <div className="px-field">
        <label htmlFor={id}>Copy from</label>
        <p id={`${id}-hint`} className="sx-help">
          Choosing one fills the minimums below with its list, in place of what they hold. Change them before
          you add the bag, or later.
        </p>
        <select
          id={id}
          name="copyFrom"
          className={`px-select ${styles.choose}`}
          value={from}
          aria-describedby={`${id}-hint`}
          onChange={(e) => setChosen({ from: e.target.value, at: state })}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {/* On the page before anything is said in it, so a screen reader reads each fill. */}
      <p role="status" className="sr-only">
        {picked !== undefined && source
          ? `Minimums filled from ${source.label}: ${minimums.length} ${minimums.length === 1 ? 'item' : 'items'}.`
          : ''}
      </p>
      <ItemLines
        name="minimums"
        legend="Minimums"
        hint={hint}
        items={items}
        lines={minimums.map((m) => ({ itemId: m.itemId, quantity: m.min }))}
        quantity={{ field: 'min', label: 'Minimum' }}
        max={200}
        {...(picked !== undefined ? { fill: picked } : {})}
      />
    </>
  );
}
