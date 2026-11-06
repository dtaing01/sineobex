import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DuplicatePageValue, FieldHistoryPageValue } from '../src/patients/schemas.ts';
import { valueHash } from '../src/sync/canonical.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, expectAuditClean, logSpy } from './patient-fixtures.ts';
import { call, FakePhone, push, register, results, setupTeam, type Team } from './sync-fixtures.ts';

// The phase 3 done-when, server half (design 13.1): "a made-up patient is found offline by a
// misspelled alias, edited, and flagged as a likely duplicate at intake." The phone's work arrives
// as one push of the changes the phone runners make, built from the shared fixture
// (packages/contract/test-vectors/done-when.json), and the server must accept every one by hash,
// apply the edit, register the intake and queue the pair, with the offline reads in the audit
// chain and no name in any audit detail or log line.

interface DoneWhen {
  p1: {
    id: string;
    preferredName: string;
    legalName: { given: string; family: string };
    birth: { precision: 'day'; date: string };
    visualDescriptor: string;
    usualArea: string;
    livingSituation: { kind: string };
    preferredLanguage: string;
    registeredAt: string;
    aliases: { id: string; alias: string }[];
    allergies: { substance: string; category: string; severity: string }[];
    neverOnThePhone: string[];
  };
  search: { text: string; criteria: string[] };
  edit: { field: string; value: string; baseVersion: number; previousValue: string };
  intake: {
    preferredName: string;
    legalName: { given: string; family: null };
    birth: { precision: 'day'; date: string };
    consent: { decision: string; method: string; scriptVersion: string; language: string };
    privacyNotice: { decision: string };
    dismissed: string[];
  };
  match: {
    expected: {
      reasons: string[];
      serverScoreAtLeast: number;
      creatorDismissed: boolean;
      possibleDuplicate: boolean;
    };
  };
  neverInAuditDetails: string[];
}

const root = new URL('../../../', import.meta.url);
const fixture = JSON.parse(
  readFileSync(new URL('packages/contract/test-vectors/done-when.json', root), 'utf8'),
) as DoneWhen;
const P1 = fixture.p1.id;

const spy = logSpy();
let h: Harness;
let t: Team;
let phone: FakePhone;

/** A change as the phone's outbox holds it, made offline `minutesAgo` before the push. */
async function change(
  minutesAgo: number,
  c: {
    entity: string;
    op: 'create' | 'set' | 'append';
    recordId?: string;
    field?: string;
    value: unknown;
    baseVersion?: number;
  },
) {
  return {
    changeId: randomUUID(),
    seq: ++phone.seq,
    recordId: c.recordId ?? randomUUID(),
    baseVersion: 0,
    deviceTime: new Date(h.clock.now.getTime() - minutesAgo * 60_000).toISOString(),
    clockVerified: true,
    ...c,
    valueHash: await valueHash(c.value),
  };
}

beforeAll(async () => {
  h = await createHarness({ log: spy.log });
  t = await setupTeam(h);
  const p = fixture.p1;
  await createPatient(h, t.teamId, t.adminId, {
    id: P1,
    preferredName: p.preferredName,
    legalName: p.legalName,
    birth: p.birth,
    visualDescriptor: p.visualDescriptor,
    usualArea: p.usualArea,
    livingSituation: p.livingSituation,
    preferredLanguage: p.preferredLanguage,
    aliases: p.aliases.map((a) => a.alias),
    allergies: p.allergies,
    at: new Date(p.registeredAt),
  });
  phone = await FakePhone.create();
  await register(h, phone, t.aToken, t.teamId);
});

afterAll(async () => {
  spy.expectClean([fixture.search.text, ...fixture.p1.neverOnThePhone, 'smitty', fixture.p1.birth.date]);
  await h?.close();
});

describe('the done-when, server half (design 13.1)', () => {
  it('accepts the offline search, edit and intake, and queues the likely pair', async () => {
    const mark = await auditMark(h);
    const P2 = randomUUID();
    const checkId = randomUUID();
    const outbox = [
      // 3. Search "Smity" in the team index: the criteria and the patients shown, never the text.
      await change(50, {
        entity: 'audit',
        op: 'append',
        value: {
          action: 'patient.searched',
          patientIds: [P1],
          criteria: fixture.search.criteria,
          source: 'team_index',
          resultCount: 1,
        },
      }),
      // 4. Open P1 from the index and edit Usually found.
      await change(49, {
        entity: 'audit',
        op: 'append',
        value: {
          action: 'patient.viewed',
          entity: 'patient',
          entityId: P1,
          patientId: P1,
          source: 'team_index',
        },
      }),
      await change(48, {
        entity: 'patient',
        op: 'set',
        recordId: P1,
        field: fixture.edit.field,
        value: fixture.edit.value,
        baseVersion: fixture.edit.baseVersion,
      }),
      // 5. The intake's local check showed P1, logged before the panel rendered; then the create.
      await change(45, {
        entity: 'audit',
        op: 'append',
        value: { action: 'patient.match_checked', checkId, patientIds: [P1] },
      }),
      await change(44, {
        entity: 'patient',
        op: 'create',
        recordId: P2,
        value: {
          preferredName: fixture.intake.preferredName,
          legalName: fixture.intake.legalName,
          birth: fixture.intake.birth,
          consent: { id: randomUUID(), ...fixture.intake.consent },
          privacyNotice: { id: randomUUID(), ...fixture.intake.privacyNotice },
          matchCheck: {
            checkId,
            where: 'phone',
            indexVersion: null,
            shown: [P1],
            dismissed: fixture.intake.dismissed,
          },
        },
      }),
    ];

    // 7. Reconnect and sync: every change confirmed by hash.
    const r = await push(h, phone, t.aToken, t.teamId, outbox);
    expect(r.status).toBe(200);
    const receipts = results(r.body);
    expect(receipts.map((x) => [x.changeId, x.status, x.hash])).toEqual(
      outbox.map((c) => [c.changeId, 'accepted', c.valueHash]),
    );
    expect(receipts[4]!.details?.possibleDuplicate ?? false).toBe(fixture.match.expected.possibleDuplicate);

    // The edit: field version 2, with a set history row holding the old value.
    const [p1] = await h.scratch.owner<{ usualArea: string; versions: Record<string, number> }[]>`
      select usual_area as "usualArea", field_versions as versions from sineobex.patients where id = ${P1}`;
    expect(p1).toEqual(expect.objectContaining({ usualArea: fixture.edit.value }));
    expect(p1!.versions[fixture.edit.field]).toBe(2);
    const [set] = await h.scratch.owner<{ value: unknown; previousValue: unknown; kind: string }[]>`
      select value, previous_value as "previousValue", kind from sineobex.field_history
      where record_id = ${P1} and field = ${fixture.edit.field} and version = 2`;
    expect(set).toEqual({
      value: fixture.edit.value,
      previousValue: fixture.edit.previousValue,
      kind: 'set',
    });

    // The intake: active and canonical, consent and privacy notice recorded.
    const [p2] = await h.scratch.owner<{ status: string; canonicalId: string; consents: number }[]>`
      select status, canonical_id as "canonicalId",
        (select count(*)::int from sineobex.patient_consents c where c.patient_id = p.id) as consents
      from sineobex.patients p where id = ${P2}`;
    expect(p2).toEqual({ status: 'active', canonicalId: P2, consents: 2 });

    // The pair: open, the creator's "Not them" recorded, at or above the queue threshold.
    const [a, b] = [P1, P2].sort();
    const [pair] = await h.scratch.owner<
      { id: string; status: string; score: string; reasons: string[]; creatorDismissed: boolean }[]
    >`
      select id, status, score::text as score, reasons, creator_dismissed as "creatorDismissed"
      from sineobex.duplicate_pairs where team_id = ${t.teamId} and patient_a = ${a!} and patient_b = ${b!}`;
    expect(pair).toMatchObject({ status: 'open', creatorDismissed: fixture.match.expected.creatorDismissed });
    expect(Number(pair!.score)).toBeGreaterThanOrEqual(fixture.match.expected.serverScoreAtLeast);
    expect(pair!.reasons).toEqual(expect.arrayContaining(['dob_swapped']));

    // The audit chain: the phone's offline reads at their device times, then what the server did.
    for (const action of ['patient.searched', 'patient.viewed', 'patient.match_checked']) {
      const [event] = await expectAudit(h, action, { after: mark, teamId: t.teamId, count: 1 });
      expect(event!.details).toMatchObject({ offline: true });
      expect(event!.deviceId).toBe(phone.deviceId);
    }
    const [searched] = await expectAudit(h, 'patient.searched', { after: mark, count: 1 });
    expect(searched!.details).toMatchObject({ patientIds: [P1], criteria: ['name'], source: 'team_index' });
    await expectAudit(h, 'patient.created', { after: mark, patientId: P2 });
    await expectAudit(h, 'patient.updated', { after: mark, patientId: P1 });
    const [flagged] = await expectAudit(h, 'duplicate.flagged', { after: mark, count: 1 });
    expect([...(flagged!.details.patientIds as string[])].sort()).toEqual([a, b]);
    await expectAuditClean(h, fixture.neverInAuditDetails, mark);
    // The verifier checks only the chain of the team the caller acts in.
    const [chain] = await h.db.tx(
      { teamId: t.teamId, userId: t.adminId },
      (tx) => tx<{ ok: boolean }[]>`select ok from sineobex.verify_audit_chain(${t.teamId})`,
    );
    expect(chain!.ok).toBe(true);

    // What the phone runners check through the API.
    const history = await call(h, `/v1/patients/${P1}/history?field=${fixture.edit.field}`, {
      token: t.aToken,
      teamId: t.teamId,
    });
    expect(history.status).toBe(200);
    const entries = (history.body as unknown as FieldHistoryPageValue).entries;
    expect(entries.map((e) => e.value)).toEqual([fixture.edit.value, fixture.edit.previousValue]);
    const queue = await call(h, '/v1/team/duplicates', { token: t.adminToken, teamId: t.teamId });
    expect(queue.status).toBe(200);
    const listed = (queue.body as unknown as DuplicatePageValue).pairs.find((p) => p.id === pair!.id);
    expect(listed).toMatchObject({ status: 'open', creatorDismissed: true });
    expect(listed!.reasons).toContain('dob_swapped');

    // A retry of the same push answers the same receipts and runs nothing again.
    const again = await push(h, phone, t.aToken, t.teamId, outbox);
    expect(results(again.body)).toEqual(receipts);
    await expectAudit(h, 'duplicate.flagged', { after: mark, count: 1 });
  });
});
