import { restorePresetAction } from '@/app/actions/presets';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import type { PresetKind, PresetRow } from '@/lib/presets';
import { Disclosure } from './Disclosure';
import { ReasonBox } from './ReasonBox';
import styles from './presets.module.css';
import { UpdateOffer } from './UpdateOffer';

type Restored = Pick<PresetRow, 'id' | 'name'>;

/** Restore's form: the preset, and a reason. */
export function RestorePresetForm({ kind, preset }: { kind: PresetKind; preset: Restored }) {
  return (
    <ActionForm id={`restore-${preset.id}`} action={restorePresetAction} label={`Restore ${preset.name}`}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={preset.id} />
      <ReasonBox />
      <div className="px-actions">
        <SubmitButton variant="secondary">Restore</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * The Removed list (phase 5 design 5.1, 8.1): a kind's archived presets, each with Restore and a
 * reason. A restored preset comes back at the version it was removed at; the API refuses one whose
 * name another has taken since, one that names a preset removed since, and a bundle that would come
 * back Non-Medical holding a medication, each with its sentence (lib/refusals.ts). A removed copy
 * that Sineobex offers an update has the offer beside it, to add as a new one (UpdateOffer). Nothing
 * is drawn while nothing is removed. `id` names the list when a page holds two; `names` names what
 * an update's body names, for its review.
 */
export function RemovedList({
  kind,
  presets,
  names = {},
  id = `removed-${kind}`,
  heading = 'Removed',
}: {
  kind: PresetKind;
  /** The list's rows: the archived ones are drawn. */
  presets: readonly Pick<PresetRow, 'id' | 'name' | 'state' | 'version' | 'customized' | 'body' | 'update'>[];
  names?: Readonly<Record<string, string>>;
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
          <li key={p.id} className={styles.removedItem}>
            <span className={styles.removedName}>{p.name}</span>
            <Disclosure id={`restore-${p.id}-form`} label="Restore" name={p.name}>
              <RestorePresetForm kind={kind} preset={p} />
            </Disclosure>
            <UpdateOffer kind={kind} preset={p} names={names} headingLevel={3} />
          </li>
        ))}
      </ul>
    </section>
  );
}
