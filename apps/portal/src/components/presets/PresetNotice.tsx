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
  updated: {
    heading: 'Update taken',
    text: 'Sineobex’s new version is in place, on the phones after their next sync.',
  },
  added: { heading: 'Added as a new one', text: 'The old one is removed, and kept in the history.' },
} as const;
export type PresetDone = keyof typeof PRESET_DONE;

export function isPresetDone(value: unknown): value is PresetDone {
  return typeof value === 'string' && Object.hasOwn(PRESET_DONE, value);
}

/**
 * Why an act on a preset was refused when another admin's act meanwhile caused it
 * (`?refused=<code>&preset=<id>`, lib/presets.ts presetFailure): the page, read again, draws the
 * preset in its new state, which the form refused left with, so the page says it here.
 */
export const PRESET_REFUSED = {
  archived: {
    heading: 'Removed by another admin',
    text: 'It was removed while you were working on it, so what you sent wasn’t saved. It isn’t offered for new work, and can be restored.',
  },
  not_archived: {
    heading: 'Restored by another admin',
    text: 'It was restored while you were working on it, so what you sent wasn’t saved. It’s offered again, on the phones after their next sync.',
  },
} as const;
export type PresetRefused = keyof typeof PRESET_REFUSED;

export function isPresetRefused(value: unknown): value is PresetRefused {
  return typeof value === 'string' && Object.hasOwn(PRESET_REFUSED, value);
}

/**
 * The key a page's view starts afresh at, one for each notice its address carries: Next keeps
 * client state, an open form among it, across visits to the same page.
 */
export function noticeKey(done?: string, refused?: string, preset?: string): string {
  if (isPresetDone(done)) return `${done}:${preset ?? ''}`;
  return isPresetRefused(refused) ? `refused:${refused}:${preset ?? ''}` : '';
}

/**
 * Pages pass their search parameters as they came, and the rows they show, for the preset's name;
 * an address that names no act, or an act of another page's, draws nothing.
 */
export function PresetNotice({
  done,
  refused,
  preset,
  presets,
}: {
  done?: string | string[];
  refused?: string | string[];
  preset?: string | string[];
  presets: readonly Pick<PresetRow, 'id' | 'name'>[];
}) {
  const notice = isPresetDone(done)
    ? PRESET_DONE[done]
    : isPresetRefused(refused)
      ? PRESET_REFUSED[refused]
      : null;
  if (!notice) return null;
  const name = presets.find((p) => p.id === preset)?.name;
  return (
    <section
      aria-labelledby="preset-done"
      className={`px-alert ${isPresetDone(done) ? 'px-alert--ok' : 'px-alert--info'}`}
    >
      <ArrivalHeading id="preset-done">{name ? `${notice.heading}: ${name}` : notice.heading}</ArrivalHeading>
      <p>{notice.text}</p>
    </section>
  );
}
