import { ArrivalHeading } from '@/app/(app)/team/duplicates/ArrivalHeading';
import type { PresetRow } from '@/lib/presets';

/**
 * What an act on a preset did, after its action sent the browser back (`?done=<act>&preset=<id>`,
 * actions/presets.ts): the form that made it has left the page with the preset's old place, so the
 * page says it here, and the heading takes focus so a screen reader reads it first.
 */
export const PRESET_DONE = {
  removed: { heading: 'Removed', text: 'It’s in the Removed list, where it can be restored.' },
  restored: { heading: 'Restored', text: 'It’s offered again, on the phones after their next sync.' },
} as const;
export type PresetDone = keyof typeof PRESET_DONE;

export function isPresetDone(value: unknown): value is PresetDone {
  return typeof value === 'string' && Object.hasOwn(PRESET_DONE, value);
}

/**
 * Pages pass their search parameters as they came, and the rows they show, for the preset's name;
 * an address that names no act, or an act of another page's, draws nothing.
 */
export function PresetNotice({
  done,
  preset,
  presets,
}: {
  done?: string | string[];
  preset?: string | string[];
  presets: readonly Pick<PresetRow, 'id' | 'name'>[];
}) {
  if (!isPresetDone(done)) return null;
  const notice = PRESET_DONE[done];
  const name = presets.find((p) => p.id === preset)?.name;
  return (
    <section aria-labelledby="preset-done" className="px-alert px-alert--ok">
      <ArrivalHeading id="preset-done">{name ? `${notice.heading}: ${name}` : notice.heading}</ArrivalHeading>
      <p>{notice.text}</p>
    </section>
  );
}
