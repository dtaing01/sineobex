import { lockTeam, takeRevision } from '@sineobex/forms';
import {
  BODY_SCHEMAS,
  heldBy,
  presetRefs,
  presetWriteEffect,
  validatePreset,
  type HeldPreset,
  type PresetBody,
  type PresetHeadAfter,
  type PresetKind,
} from '@sineobex/presets';
import type { TransactionSql } from 'postgres';
import { demoId } from './demo-patients.ts';

/**
 * The demo team's own presets (phase 5 design 13.4, card P1-seed; 9, "demo additions start
 * Demo:"): a made-up item, a bundle that gives it and a bag that carries it, beside the platform's
 * presets the installer gives every team (5.2), which they name. Every name and every free text
 * starts with "Demo:", and the author is the seed's made-up author.
 *
 * Each is written as the admin routes write a create (5.1, 7): its head, its version 1 as the
 * team's, and its `created` event with a reason, all by that author, under the team lock and one
 * revision for the lot, taken only once something will be written (4.2). The seed cannot import the
 * API (the API imports this package), so the steps the routes take are taken here, each by the
 * presets package's own rule: the body's schema, validatePreset against the team's presets, the
 * name as the database compares it, and presetWriteEffect for what is refused and what the head
 * becomes. db/test/demo-presets.test.ts holds every row to the same rules. Nothing is audited: the
 * seed is not anyone's act, as its patients and visits are not (13.3).
 */

/** Seeded IDs are fixed, so the seed is idempotent and tests can name what they need. */
export const demoPresetId = (n: number) => demoId('30', n);

/** The platform presets the demo bodies name, by origin key (packages/presets/data/platform.json). */
const NAMED = [
  'order_category.supplies',
  'item.socks',
  'item.handwarmers',
  'item.gauze',
  'item.bandage',
  'item.naloxone_kit',
] as const;
type Named = (typeof NAMED)[number];

interface DemoPreset {
  n: number;
  kind: Extract<PresetKind, 'item' | 'bundle' | 'bag'>;
  /** The body, in full: nothing is left to a schema's default. */
  body: (platform: Readonly<Record<Named, string>>) => Record<string, unknown>;
  reason: string;
}

// Each of its own kind, so no two compare names; in the order they name each other.
const PRESETS: readonly DemoPreset[] = [
  {
    n: 1,
    kind: 'item',
    body: (platform) => ({
      name: 'Demo: Rain poncho',
      categoryId: platform['order_category.supplies'],
      unit: 'each',
      medical: false,
      captureLot: false,
      result: null,
    }),
    reason: 'Demo: ponchos for the rainy season',
  },
  {
    n: 2,
    kind: 'bundle',
    body: (platform) => ({
      name: 'Demo: Rainy night',
      medical: false,
      prompt: 'Demo: Ask whether they have somewhere dry to sleep before giving this bundle.',
      lines: [
        { itemId: demoPresetId(1), qty: 1, core: true },
        { itemId: platform['item.socks'], qty: 1, core: true },
        { itemId: platform['item.handwarmers'], qty: 2, core: false },
      ],
    }),
    reason: 'Demo: what we give on a wet night',
  },
  {
    n: 3,
    kind: 'bag',
    body: (platform) => ({
      name: 'Demo: Outreach backpack',
      minimums: [
        { itemId: demoPresetId(1), min: 4 },
        { itemId: platform['item.socks'], min: 10 },
        { itemId: platform['item.gauze'], min: 20 },
        { itemId: platform['item.bandage'], min: 20 },
        { itemId: platform['item.naloxone_kit'], min: 2 },
      ],
    }),
    reason: 'Demo: what the outreach backpack carries',
  },
];

interface Planned {
  id: string;
  kind: PresetKind;
  body: PresetBody;
  reason: string;
  head: PresetHeadAfter;
}

/**
 * Writes those of the demo presets the team does not hold yet. Every one is worked out first, under
 * the team lock: a run that finds one the team's presets would refuse (a platform preset it names
 * missing or archived, a body validatePreset refuses, a name another active preset holds) writes
 * none of them and takes no revision, and says why, by kind and code only, never a name. The bodies
 * are this file's own, so one that fails its schema is a fault here, and throws.
 */
export async function seedDemoPresets(
  tx: TransactionSql,
  teamId: string,
  author: string,
): Promise<{ presets: number; skipped?: string }> {
  // Before anything is read: a writer at the same moment commits first, and is seen.
  await lockTeam(tx, teamId);
  const held = new Set(
    (
      await tx<{ id: string }[]>`
        select id from sineobex.team_presets
        where team_id = ${teamId} and id in ${tx(PRESETS.map((p) => demoPresetId(p.n)))}`
    ).map((r) => r.id),
  );
  const missing = PRESETS.filter((p) => !held.has(demoPresetId(p.n)));
  if (missing.length === 0) return { presets: 0 };

  const platform = await platformIds(tx, teamId);
  if (!platform) return { presets: 0, skipped: 'the team does not hold every platform preset they name' };
  // The team's presets as the installer and the API's writes read them, each planned one joining
  // them, so the next body may name it as the routes' next create would find it.
  const presets: Pick<HeldPreset, 'id' | 'kind' | 'state' | 'body'>[] = await heldBy(tx, teamId);
  const planned: Planned[] = [];
  for (const p of missing) {
    const id = demoPresetId(p.n);
    const parsed = BODY_SCHEMAS[p.kind].safeParse(p.body(platform));
    if (!parsed.success) throw new Error(`demo preset ${p.n}: its ${p.kind} body fails its schema`);
    const body = parsed.data as PresetBody;
    const problems = validatePreset({
      kind: p.kind,
      body,
      refs: presetRefs(presets),
      definitions: {},
      id: null,
    });
    // An archived preset named is the act's refusal (presetWriteEffect's), as for the routes.
    const archivedRefs = problems.filter((x) => x.code === 'reference_archived').length;
    if (problems.length > archivedRefs) {
      const codes = [...new Set(problems.map((x) => x.code))].join(', ');
      return {
        presets: 0,
        skipped: `the ${p.kind} is invalid against the presets the team holds (${codes})`,
      };
    }
    const effect = presetWriteEffect({
      act: 'create',
      kind: p.kind,
      state: null,
      baseVersion: null,
      currentVersion: null,
      changedFixed: false,
      sameBody: false,
      referencedBy: {},
      archivedRefs,
      nameTaken: await nameTaken(tx, teamId, p.kind, body.name),
      updateOnOffer: false,
      updateChangesFixed: false,
    });
    if ('refuse' in effect)
      return { presets: 0, skipped: `the ${p.kind} would be refused (${effect.refuse})` };
    presets.push({ id, kind: p.kind, state: effect.stateAfter, body });
    planned.push({ id, kind: p.kind, body, reason: p.reason, head: effect });
  }

  // One revision for the lot, stamped on every head, as 0023 requires of every head written.
  const revision = await takeRevision(tx, teamId);
  for (const p of planned) {
    await tx`
      insert into sineobex.team_presets (id, team_id, kind, name, state, current_version, customized, revision,
        created_by, updated_by)
      values (${p.id}, ${teamId}, ${p.kind}, ${p.body.name}, ${p.head.stateAfter}, ${p.head.versionAfter},
        ${p.head.customizedAfter}, ${revision}, ${author}, ${author})`;
    await tx`
      insert into sineobex.team_preset_versions (team_id, preset_id, version, body, source, created_by)
      values (${teamId}, ${p.id}, ${p.head.versionAfter}, ${tx.json(p.body as never)}, 'team', ${author})`;
    await tx`
      insert into sineobex.team_preset_events (team_id, preset_id, act, version, reason, created_by)
      values (${teamId}, ${p.id}, 'created', ${p.head.versionAfter}, ${p.reason}, ${author})`;
  }
  return { presets: planned.length };
}

/** The team's id for each platform preset the bodies name; null when it holds not every one. */
async function platformIds(tx: TransactionSql, teamId: string): Promise<Record<Named, string> | null> {
  const rows = await tx<{ originKey: Named; id: string }[]>`
    select origin_key as "originKey", id from sineobex.team_presets
    where team_id = ${teamId} and origin_key in ${tx([...NAMED])}`;
  const ids = Object.fromEntries(rows.map((r) => [r.originKey, r.id])) as Partial<Record<Named, string>>;
  return NAMED.every((key) => ids[key] !== undefined) ? (ids as Record<Named, string>) : null;
}

/** Whether another active preset of the kind holds the name, as the unique index compares names. */
async function nameTaken(tx: TransactionSql, teamId: string, kind: PresetKind, name: string) {
  const [row] = await tx<{ taken: boolean }[]>`
    select exists (
      select 1 from sineobex.team_presets
      where team_id = ${teamId} and kind = ${kind} and state = 'active' and lower(name) = lower(${name})
    ) as taken`;
  return row!.taken;
}
