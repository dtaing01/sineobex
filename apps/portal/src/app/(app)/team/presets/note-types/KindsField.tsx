'use client';

import { useFieldId, useFormState } from '@/components/ActionForm';
import type { NoteTypeKind } from '@/lib/presets';
import { KIND_WORDS } from './words';

const KINDS: readonly { value: NoteTypeKind; hint: string }[] = [
  { value: 'medical', hint: 'Offered at Medical visits. Ticked alone, the note type is Medical.' },
  { value: 'non_medical', hint: 'Offered at Non-Medical visits.' },
];

/**
 * Which visits offer a blank note type: Medical, Non-Medical or both, posted as `kinds` once for
 * each ticked (design 5.4; PRD main 952). Fixed once the type is made, which `hint` says (8.1). A
 * refused form keeps what it sent: the action keeps both ticks, joined by a comma. The API judges
 * what may be ticked (D114).
 */
export function KindsField({ hint }: { hint: string }) {
  const state = useFormState();
  const id = useFieldId('kinds');
  const error = state.fieldErrors?.kinds;
  const sent = state.values ? (state.values.kinds ?? '').split(',') : [];
  return (
    <fieldset
      id={id}
      className="px-fieldset"
      tabIndex={-1}
      aria-describedby={[`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ')}
    >
      <legend>Which visits (for a blank one)</legend>
      <p id={`${id}-hint`} className="sx-help">
        {hint}
      </p>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      {KINDS.map((k) => (
        <div key={k.value} className="px-check">
          <input
            id={`${id}-${k.value}`}
            type="checkbox"
            name="kinds"
            value={k.value}
            aria-describedby={`${id}-${k.value}-hint`}
            defaultChecked={sent.includes(k.value)}
            // A refused form comes back with what it sent; an added one with nothing ticked.
            key={`${state.values ? 'sent' : 'new'}:${sent.includes(k.value)}`}
          />
          <label htmlFor={`${id}-${k.value}`}>{KIND_WORDS[k.value]}</label>
          <span id={`${id}-${k.value}-hint`} className="sx-help">
            {k.hint}
          </span>
        </div>
      ))}
    </fieldset>
  );
}
