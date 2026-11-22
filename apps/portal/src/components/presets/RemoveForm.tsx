import { removePresetAction } from '@/app/actions/presets';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import type { PresetKind, PresetRow } from '@/lib/presets';
import { BaseVersion } from './BaseVersion';
import { Disclosure } from './Disclosure';
import { ReasonBox } from './ReasonBox';

type Removed = Pick<PresetRow, 'id' | 'name' | 'version'>;

/** Remove's form: the preset at the version shown, and a reason. */
export function RemovePresetForm({
  kind,
  preset,
  note,
  back,
}: {
  kind: PresetKind;
  preset: Removed;
  note?: string;
  back?: string;
}) {
  return (
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
  );
}

/**
 * Remove, with a reason (phase 5 design 5.1, 8.1): the preset is archived at the version shown,
 * never deleted, and joins the Removed list, where it can be restored. Behind a button that shows
 * the form. `note` is what the page says of removing one (a flag's: "Patients who have this flag
 * keep it until someone clears it."); `back` is the page to land on after, under /team/presets,
 * when not this one (a preset's own page goes back to its list).
 */
export function RemoveForm(props: { kind: PresetKind; preset: Removed; note?: string; back?: string }) {
  return (
    <Disclosure id={`remove-${props.preset.id}-form`} label="Remove" name={props.preset.name}>
      <RemovePresetForm {...props} />
    </Disclosure>
  );
}
