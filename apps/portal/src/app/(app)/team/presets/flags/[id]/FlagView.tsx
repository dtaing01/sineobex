import Link from 'next/link';
import { Fragment } from 'react';
import { saveFlagAction } from '@/app/actions/presets-flags';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { BaseVersion } from '@/components/presets/BaseVersion';
import { FixedFact } from '@/components/presets/FixedFact';
import { FlagPill } from '@/components/presets/FlagPill';
import { FreeText } from '@/components/presets/FreeText';
import { LongText } from '@/components/presets/LongText';
import { isPresetDone, PresetNotice } from '@/components/presets/PresetNotice';
import { ReasonBox } from '@/components/presets/ReasonBox';
import { RestorePresetForm } from '@/components/presets/RemovedList';
import { RemoveForm } from '@/components/presets/RemoveForm';
import { UpdateOffer } from '@/components/presets/UpdateOffer';
import { HistoryTable } from '@/components/presets/VersionHistory';
import type { PresetEvent } from '@/lib/presets';
import { ColourField, colourName, CRITERIA_HINT, LABELS, SENSITIVE_HINT, TIER_HINT } from '../FlagFields';
import { TIERS, type Flag } from '../flags';

const KIND = 'flag';
const LIST = '/team/presets/flags';

/** 8.1's sentence on Remove: an archived flag stays on every patient who carries it (5.1). */
export const REMOVE_NOTE = 'Patients who have this flag keep it until someone clears it.';

/** What the flag is, in a word or two: which list it is on, and whether it is sensitive. */
function kindOf(flag: Flag): string {
  if (flag.body.tier === 'primary') return 'A risk level';
  return flag.body.sensitive ? 'A sensitive condition' : 'A condition';
}

/**
 * The flag's form: its name, its colour and its criteria, at the version shown, with a reason.
 * Which list it is on and whether it is sensitive are shown, fixed at creation (4.4); its place in
 * its list is the Flags list's to move.
 */
function EditFlag({ flag }: { flag: Flag }) {
  return (
    <section aria-labelledby="edit-flag-heading" className="px-panel">
      <h2 id="edit-flag-heading" className="px-h2">
        Edit
      </h2>
      <ActionForm id="edit-flag" action={saveFlagAction} label={`Edit ${flag.name}`}>
        <input type="hidden" name="id" value={flag.id} />
        <BaseVersion version={flag.version} />
        <FreeText name="name" label={LABELS.name} defaultValue={flag.body.name} />
        <FixedFact
          name="tier"
          label={LABELS.tier}
          // A list a later API knows is named as it is sent.
          value={
            (TIERS as Readonly<Record<string, { title: string }>>)[flag.body.tier]?.title ?? flag.body.tier
          }
          hint={TIER_HINT}
        />
        <ColourField defaultValue={flag.body.color} />
        <LongText
          name="criteria"
          label={LABELS.criteria}
          defaultValue={flag.body.criteria}
          hint={CRITERIA_HINT}
        />
        <FixedFact
          name="sensitive"
          label={LABELS.sensitive}
          value={flag.body.sensitive ? 'Yes' : 'No'}
          hint={SENSITIVE_HINT}
        />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

/**
 * A flag's own page (phase 5 design 8.1; PRD main 316-318): what it is and how staff see it;
 * Sineobex's update when one is on offer; its form; Remove, which says that patients keep the flag;
 * and its history. A removed flag says so and offers Restore instead. Remove and an update taken
 * land on the Flags list, which says what was done; a restore lands here.
 */
export function FlagView({
  flag,
  history,
  done,
  preset,
}: {
  flag: Flag;
  history: readonly PresetEvent[];
  done?: string;
  preset?: string;
}) {
  // A new view starts afresh after each act the page is sent back to (CategoriesView).
  const view = isPresetDone(done) ? `${done}:${preset ?? ''}` : '';
  return (
    <Fragment key={view}>
      <p>
        <Link href={LIST}>← Flags</Link>
      </p>
      <h1 className="px-h1">{flag.name}</h1>
      <p className="px-lede">
        {kindOf(flag)}, shown to staff as{' '}
        <FlagPill color={flag.body.color} colorName={colourName(flag.body.color)} name={flag.name} />.
      </p>
      <PresetNotice done={done} preset={preset} presets={[flag]} />
      {flag.state === 'active' ? (
        <>
          {/* A flag names no other preset, so the review has no IDs to name. */}
          <UpdateOffer kind={KIND} preset={flag} names={{}} back={LIST} />
          <EditFlag flag={flag} />
          <section aria-labelledby="remove-flag" className="px-panel">
            <h2 id="remove-flag" className="px-h2">
              Remove
            </h2>
            <p>
              A removed flag isn’t offered when staff flag a patient. It keeps its history, and can be
              restored from the Flags list.
            </p>
            <RemoveForm kind={KIND} preset={flag} note={REMOVE_NOTE} back={LIST} />
          </section>
        </>
      ) : (
        <section aria-labelledby="removed-flag" className="px-panel">
          <h2 id="removed-flag" className="px-h2">
            Removed
          </h2>
          <p>
            This flag isn’t offered when staff flag a patient, and patients who have it keep it until someone
            clears it. Restore it to offer it again.
          </p>
          <RestorePresetForm kind={KIND} preset={flag} />
        </section>
      )}
      <HistoryTable events={history} id={flag.id} />
    </Fragment>
  );
}
