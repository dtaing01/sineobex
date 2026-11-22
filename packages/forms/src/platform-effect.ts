/**
 * What a platform update does to a team's copy of one platform entry (phase 5 design 5.2, D133).
 * Both installers decide every entry by it: the preset installer (packages/presets/src/install.ts)
 * for each entry of the platform's presets, and the note type installer (install.ts) for each
 * released key; packages/contract/test-vectors/platform-update.json pins it for both. It lives here
 * because the presets package imports this one, and never the other way round.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */

export type PlatformEffect = 'install' | 'skip' | 'update' | 'offer';

export type PlatformUpdateInput = {
  /** The team holds a copy: a head with the entry's origin key, or for a note type a platform version. */
  exists: boolean;
  /** The copy's head; null with no copy. */
  state: 'active' | 'archived' | null;
  /** The team edited, archived or restored the copy. */
  customized: boolean;
  /** The platform version the copy was last taken from; null with no copy. */
  originVersion: number | null;
  /** The newest version the platform ships. */
  platformVersion: number;
  /** That version changes a field fixed at creation, against the copy's current body. */
  changesFixed: boolean;
};

/**
 * `install` a copy the team lacks; `skip` a platform version no newer than the copy's, whatever
 * else is true; `update` in place only an active copy the team never edited, when nothing fixed at
 * creation changes; `offer` every other newer version, which moves only what the team is told is
 * on offer and leaves the copy as it is.
 */
export function platformUpdateEffect(input: PlatformUpdateInput): PlatformEffect {
  if (!input.exists) return 'install';
  // Never taken back to an older version, nor given the one it holds again.
  if (input.platformVersion <= (input.originVersion ?? 0)) return 'skip';
  // A platform update never overwrites what the team made its own (PRD main 387), nor brings back
  // what it archived.
  // PLAN-OPEN (PL-20): may a platform update change a field fixed at creation? No: what a count, a
  // rank or a reader means stays (D132), so such an update is offered, and taken only as a new preset.
  if (input.state === 'active' && !input.customized && !input.changesFixed) return 'update';
  return 'offer';
}
