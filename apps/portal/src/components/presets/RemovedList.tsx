import { restorePresetAction } from '@/app/actions/presets';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import type { PresetKind, PresetRow } from '@/lib/presets';
import { ReasonBox } from './ReasonBox';
import styles from './presets.module.css';

/**
 * The Removed list (phase 5 design 5.1, 8.1): a kind's archived presets, each with Restore and a
 * reason. A restored preset comes back at the version it was removed at; the API refuses one whose
 * name another has taken since, one that names a preset removed since, and a bundle that would come
 * back Non-Medical holding a medication, each with its sentence (lib/refusals.ts). Nothing is drawn
 * while nothing is removed. `id` names the list when a page holds two.
 */
export function RemovedList({
  kind,
  presets,
  id = `removed-${kind}`,
  heading = 'Removed',
}: {
  kind: PresetKind;
  /** The list's rows: the archived ones are drawn. */
  presets: readonly Pick<PresetRow, 'id' | 'name' | 'state'>[];
  id?: string;
  heading?: string;
}) {
  const removed = presets.filter((p) => p.state === 'archived');
  if (removed.length === 0) return null;
  return (
    <section aria-labelledby={id} className="px-panel">
      <h2 id={id} className="px-h2">
        {heading} ({removed.length})
      </h2>
      <p className="sx-help">These aren’t offered for new work. Restore one to offer it again.</p>
      <ul className={styles.removed}>
        {removed.map((p) => (
          <li key={p.id}>
            <details className={styles.disclosure}>
              <summary>
                {p.name}
                <span className="sr-only">: restore it</span>
              </summary>
              <ActionForm id={`restore-${p.id}`} action={restorePresetAction} label={`Restore ${p.name}`}>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={p.id} />
                <ReasonBox />
                <div className="px-actions">
                  <SubmitButton variant="secondary">Restore</SubmitButton>
                </div>
              </ActionForm>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
