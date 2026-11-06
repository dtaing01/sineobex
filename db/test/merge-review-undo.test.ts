import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS_DIR } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { makeTeam, makeUser } from './helpers.ts';

// 0016: what a merge did to field reviews, so its undo can reverse it (phase 3 design 8.5; review
// finding S1). Merges made before 0016 are filled in from the rows the merge's own transaction
// wrote. Made-up people only.

describe('0016 merge review undo', () => {
  let db: ScratchDatabase;
  let dir: string;
  let team: string;
  let admin: string;
  const at = new Date('2026-11-01T10:00:00.000Z');
  const later = new Date('2026-11-01T10:05:00.000Z');

  const patient = async (name: string, mergedInto: string | null = null) => {
    const id = randomUUID();
    await db.owner`
      insert into sineobex.patients (id, team_id, canonical_id, status, merged_into, preferred_name, registered_at,
        author_user_id)
      values (${id}, ${team}, ${mergedInto ?? id}, ${mergedInto ? 'merged' : 'active'}, ${mergedInto}, ${name}, now(),
        ${admin})`;
    return id;
  };

  const mergeRow = async (survivor: string, merged: string, mergedAt: Date, undone: boolean) => {
    const [a, b] = [survivor, merged].sort();
    const [pair] = await db.owner<{ id: string }[]>`
      insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, sources, status)
      values (${team}, ${a!}, ${b!}, 0.9, '{sync}', ${undone ? 'open' : 'merged'}) returning id`;
    const [decision] = await db.owner<{ id: string }[]>`
      insert into sineobex.duplicate_decisions (team_id, pair_id, decision, comment, survivor_id, decided_by)
      values (${team}, ${pair!.id}, 'merge', 'Same person, ID card checked', ${survivor}, ${admin}) returning id`;
    const [row] = await db.owner<{ id: string }[]>`
      insert into sineobex.patient_merges (team_id, pair_id, survivor_id, merged_id, decision_id, merged_by, merged_at,
        undone_at, undone_by)
      values (${team}, ${pair!.id}, ${survivor}, ${merged}, ${decision!.id}, ${admin}, ${mergedAt},
        ${undone ? later : null}, ${undone ? admin : null})
      returning id`;
    return row!.id;
  };

  const keptBoth = async (recordId: string, recordedAt: Date, deviceId: string | null) => {
    const [row] = await db.owner<{ id: string }[]>`
      insert into sineobex.field_history (team_id, entity, record_id, field, version, value, kind, changed_by,
        device_id, recorded_at)
      values (${team}, 'patient', ${recordId}, 'usualArea', 1, '"Demo: Pier 3"', 'kept_both', ${admin}, ${deviceId},
        ${recordedAt})
      returning id::text`;
    return row!.id;
  };

  const obsoleteReview = async (recordId: string, decidedAt: Date, field = 'usualArea') => {
    const [row] = await db.owner<{ id: string }[]>`
      insert into sineobex.field_reviews (team_id, patient_id, entity, record_id, field, needs, status, decided_at)
      values (${team}, ${recordId}, 'patient', ${recordId}, ${field}, 'patients.edit', 'obsolete', ${decidedAt})
      returning id`;
    return row!.id;
  };

  beforeAll(async () => {
    // Every migration before 0016, so rows can be written as a pre-0016 merge left them.
    dir = await mkdtemp(join(tmpdir(), 'sineobex-0015-'));
    for (const f of await readdir(MIGRATIONS_DIR)) {
      if (f.endsWith('.sql') && f < '0016') await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    db = await createScratchDatabase({ migrate: false });
    await migrate(db.owner, { dir });
    team = await makeTeam(db.owner, 'Merge Undo Team');
    admin = await makeUser(db.owner, 'merge-undo-admin@example.com');
  });
  afterAll(async () => {
    await db.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('fills in a live merge’s alternates and closed reviews from its own transaction, and nothing else', async () => {
    const survivor = await patient('Demo Sam');
    const merged = await patient('Demo Mo', survivor);
    const earlier = await patient('Demo Moe', merged);
    const live = await mergeRow(survivor, merged, at, false);
    const mergeAlternate = await keptBoth(survivor, at, null);
    await keptBoth(survivor, at, randomUUID()); // a phone's, in the same instant
    await keptBoth(survivor, later, null); // another transaction
    await keptBoth(merged, at, null); // not on the survivor
    const closedByMerge = await obsoleteReview(merged, at);
    const closedOnEarlier = await obsoleteReview(earlier, at, 'visualDescriptor');
    await obsoleteReview(merged, later, 'preferredName');

    const otherSurvivor = await patient('Demo Ida');
    const otherMerged = await patient('Demo Ada');
    const undone = await mergeRow(otherSurvivor, otherMerged, at, true);
    await keptBoth(otherSurvivor, at, null);
    await obsoleteReview(otherMerged, at);

    await migrate(db.owner);

    const rows = await db.owner<{ id: string; alternates: string[]; obsoleted: string[] }[]>`
      select id, alternate_history_ids::text[] as alternates, reviews_obsoleted::text[] as obsoleted
      from sineobex.patient_merges where id in (${live}, ${undone}) order by merged_id = ${merged} desc`;
    expect(rows).toEqual([
      { id: live, alternates: [mergeAlternate], obsoleted: [closedByMerge, closedOnEarlier].sort() },
      { id: undone, alternates: [], obsoleted: [] },
    ]);
    const [review] = await db.owner<{ withdrawn: string[] }[]>`
      select withdrawn_history_ids::text[] as withdrawn from sineobex.field_reviews where id = ${closedByMerge}`;
    expect(review!.withdrawn).toEqual([]);
  });
});
