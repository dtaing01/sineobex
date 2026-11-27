import { ChoiceGroup } from '@/components/presets/ChoiceGroup';
import { FlagSwatch } from '@/components/presets/FlagPill';
import { FIELD_LABELS } from '@/components/presets/review';
import { FLAG_COLOR_NAMES, type FlagColor } from '@/lib/presets';
import { TIERS, type Tier } from './flags';

export const LABELS = FIELD_LABELS.flag;

/** Which list a flag is on and whether it is sensitive are fixed at creation (design 4.4; D132). */
export const TIER_HINT = 'Which list a flag is on can’t be changed later.';
export const SENSITIVE_HINT =
  'Sensitive flags are hidden from Billing and Data. Whether a flag is sensitive can’t be changed later.';
// A flag's criteria are text for people, never a rule the app runs (packages/presets/src/schemas.ts).
export const CRITERIA_HINT = 'Staff read these when they choose a flag. Nothing flags a patient by itself.';

/**
 * What choosing each list means for a patient, said before a choice that can't be changed later;
 * validatePreset holds a risk level to never being sensitive (4.4), and the API refuses one.
 */
export const TIER_OPTIONS = (['primary', 'secondary'] as const satisfies readonly Tier[]).map((value) => ({
  value,
  label: TIERS[value].title,
  hint:
    value === 'primary'
      ? 'A patient has one risk level at a time. A risk level can’t be sensitive.'
      : 'A patient can have several conditions at once.',
}));

/** A colour's plain name, which every pill reads first; one the portal doesn't know reads as sent. */
export const colourName = (color: string): string =>
  (FLAG_COLOR_NAMES as Readonly<Record<string, string>>)[color] ?? color;

/**
 * A flag's colour, one of the palette's eight in its order (TM-36), each with its swatch before its
 * name: the name, never the swatch, is what a screen reader reads, and what the pill says.
 */
export function ColourField({ defaultValue }: { defaultValue?: string }) {
  return (
    <ChoiceGroup
      name="color"
      legend={LABELS.color}
      hint="Staff see the colour with its name, as in Red · High."
      defaultValue={defaultValue}
      options={(Object.keys(FLAG_COLOR_NAMES) as FlagColor[]).map((value) => ({
        value,
        label: FLAG_COLOR_NAMES[value],
        mark: <FlagSwatch color={value} />,
      }))}
    />
  );
}
