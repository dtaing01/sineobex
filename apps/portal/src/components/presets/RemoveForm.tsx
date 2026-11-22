import { removePresetAction } from '@/app/actions/presets';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import type { PresetKind, PresetRow } from '@/lib/presets';
import { BaseVersion } from './BaseVersion';
import { ReasonBox } from './ReasonBox';
import styles from './presets.module.css';

/**
 * Remove, with a reason (phase 5 design 5.1, 8.1): the preset is archived at the version shown,
 * never deleted, and joins the Removed list, where it can be restored. Behind a disclosure, so a
 * list of presets is not a list of reason boxes. `note` is what the page says of removing one (a
 * flag's: "Patients who have this flag keep it until someone clears it."); `back` is the page to
 * land on after, under /team/presets, when not this one (a preset's own page goes back to its list).
 */
export function RemoveForm({
  kind,
  preset,
  note,
  back,
}: {
  kind: PresetKind;
  preset: Pick<PresetRow, 'id' | 'name' | 'version'>;
  note?: string;
  back?: string;
}) {
  return (
    <details className={styles.disclosure}>
      <summary>
        Remove<span className="sr-only"> {preset.name}</span>
      </summary>
      <ActionForm id={`remove-${preset.id}`} action={removePresetAction} label={`Remove ${preset.name}`}>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={preset.id} />
        <BaseVersion version={preset.version} />
        {back && <input type="hidden" name="back" value={back} />}
        {note && <p>{note}</p>}
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton variant="danger">Remove</SubmitButton>
        </div>
      </ActionForm>
    </details>
  );
}
