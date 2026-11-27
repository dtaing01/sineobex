import { Fragment } from 'react';
import { addFlagAction } from '@/app/actions/presets-flags';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { CheckField } from '@/components/presets/CheckField';
import { ChoiceGroup } from '@/components/presets/ChoiceGroup';
import { FreeText } from '@/components/presets/FreeText';
import { LongText } from '@/components/presets/LongText';
import { inRank } from '@/components/presets/order';
import { noticeKey, PresetNotice } from '@/components/presets/PresetNotice';
import { ReasonBox } from '@/components/presets/ReasonBox';
import { RemovedList } from '@/components/presets/RemovedList';
import {
  ColourField,
  colourName,
  CRITERIA_HINT,
  LABELS,
  SENSITIVE_HINT,
  TIER_HINT,
  TIER_OPTIONS,
} from './FlagFields';
import { FlagOrder } from './FlagOrder';
import { TIERS, type Flag, type ListedFlag, type Tier } from './flags';

const KIND = 'flag';

/** What each list says of itself, under its name. */
const TIER_LINES: Readonly<Record<Tier, string>> = {
  primary: 'Highest risk first. A patient has one risk level at a time.',
  secondary: 'A patient can have several conditions at once.',
};

/** A tier's active flags as its list draws them: by rank, then by name (order.ts). */
export function listedFlags(rows: readonly Flag[], tier: Tier): ListedFlag[] {
  return inRank(rows.filter((r) => r.state === 'active' && r.body.tier === tier)).map((r) => ({
    id: r.id,
    version: r.version,
    name: r.name,
    color: r.body.color,
    colorName: colourName(r.body.color),
    sensitive: r.body.sensitive,
    updateOnOffer: r.updateOnOffer,
  }));
}

/** One tier's list: its flags in their order, each opening its own page, with Move up and Move down. */
function TierList({ tier, rows }: { tier: Tier; rows: readonly Flag[] }) {
  const flags = listedFlags(rows, tier);
  const heading = `tier-${tier}`;
  return (
    <section aria-labelledby={heading} className="px-panel">
      <h2 id={heading} className="px-h2">
        {TIERS[tier].title}
      </h2>
      <p className="sx-help">{TIER_LINES[tier]}</p>
      {flags.length === 0 ? (
        <p>No {TIERS[tier].one} is on your team’s list. Add one below.</p>
      ) : (
        <FlagOrder tier={tier} flags={flags} />
      )}
    </section>
  );
}

/**
 * Add a flag of the team's own: its name, which list it is on, its colour, its criteria and whether
 * it is sensitive, with a reason. The list and Sensitive are fixed from then on (4.4).
 */
function AddFlag() {
  return (
    <section aria-labelledby="add-flag" className="px-panel">
      <h2 id="add-flag" className="px-h2">
        Add a flag
      </h2>
      <ActionForm id="new-flag" action={addFlagAction} label="Add a flag">
        <FreeText name="name" label={LABELS.name} />
        <ChoiceGroup name="tier" legend={LABELS.tier} hint={TIER_HINT} options={TIER_OPTIONS} />
        <ColourField />
        <LongText name="criteria" label={LABELS.criteria} hint={CRITERIA_HINT} />
        <CheckField name="sensitive" label={LABELS.sensitive} hint={SENSITIVE_HINT} />
        <p className="sx-help">It goes at the end of its list. Move it up or down from there.</p>
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Add flag</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

/**
 * Flags (phase 5 design 8.1; PRD main 316-318): two lists, Risk level and Conditions, each by rank,
 * highest risk first, every flag drawn as staff see it ("Red · High") and opening its own page,
 * with Move up and Move down; Add a flag; the Removed list with Restore. `rows` is the API's list,
 * archived ones included.
 */
export function FlagsView({
  rows,
  done,
  refused,
  preset,
}: {
  rows: readonly Flag[];
  done?: string;
  /** A refusal another admin's Remove or Restore caused, which the page says (PresetNotice). */
  refused?: string;
  preset?: string;
}) {
  // A new view starts afresh after each act the page is sent back to (CategoriesView).
  const view = noticeKey(done, refused, preset);
  return (
    <Fragment key={view}>
      <h1 className="px-h1">Flags</h1>
      <p className="px-lede">
        What staff mark patients with: one risk level each, and any conditions. Open a flag to change it,
        remove it or see its history.
      </p>
      <PresetNotice done={done} refused={refused} preset={preset} presets={rows} />
      <TierList tier="primary" rows={rows} />
      <TierList tier="secondary" rows={rows} />
      <AddFlag />
      <RemovedList kind={KIND} presets={rows} />
    </Fragment>
  );
}
