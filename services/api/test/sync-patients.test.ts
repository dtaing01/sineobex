import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { createPatient, expectAudit, auditMark, mergeDirect, type NewPatient } from './patient-fixtures.ts';
import {
  addMember,
  call,
  createEncounter,
  createProblem,
  FakePhone,
  handOver,
  intakeValue,
  push,
  register,
  removedPhone,
  results,
  secondTeam,
  setRole,
  setupTeam,
  type Team,
} from './sync-fixtures.ts';

// Patient-side records through the change protocol (phase 3 design 2, 13.3 sync-patients). Every
// patient, name and place here is made up.

interface ValueCase {
  name: string;
  entity: string;
  op: 'create' | 'set' | 'append';
  field?: string;
  value: unknown;
  parents?: { entity: string; id: string }[];
  expect?: { paths?: string[]; problem?: string };
}

const vectors = JSON.parse(
  readFileSync(new URL('../../../packages/contract/test-vectors/sync-values.json', import.meta.url), 'utf8'),
) as { valid: ValueCase[]; invalid: ValueCase[] };

type Change = Awaited<ReturnType<FakePhone['change']>>;

describe('phase 3 sync: patient-side records', () => {
  let h: Harness;
  let t: Team;
  let phoneA: FakePhone;
  let phoneB: FakePhone;
  let chwPhone: FakePhone;
  let adminPhone: FakePhone;
  let billing: { id: string; token: string; membershipId: string; phone: FakePhone };

  beforeAll(async () => {
    h = await createHarness();
    t = await setupTeam(h);
    phoneA = await FakePhone.create();
    phoneB = await FakePhone.create();
    chwPhone = await FakePhone.create();
    adminPhone = await FakePhone.create();
    await register(h, phoneA, t.aToken, t.teamId);
    await register(h, phoneB, t.bToken, t.teamId);
    await register(h, chwPhone, t.chwToken, t.teamId);
    await register(h, adminPhone, t.adminToken, t.teamId);
    const member = await addMember(h, t, 'quinn@example.com', 'Quinn (demo)', 'billing_data');
    const phone = await FakePhone.create();
    await register(h, phone, member.token, t.teamId);
    billing = { ...member, phone };
  });
  afterAll(() => h.close());

  /** Pushes changes from one phone and returns their results. */
  const send = async (phone: FakePhone, token: string, ...changes: Change[]) =>
    results((await push(h, phone, token, t.teamId, changes)).body);
  const asA = (...changes: Change[]) => send(phoneA, t.aToken, ...changes);
  const asB = (...changes: Change[]) => send(phoneB, t.bToken, ...changes);
  const one = async (phone: FakePhone, token: string, change: Change) =>
    (await send(phone, token, change))[0]!;

  const patient = (p: NewPatient = {}) => createPatient(h, t.teamId, t.aId, p);
  const setField = (phone: FakePhone, recordId: string, field: string, value: unknown, baseVersion: number) =>
    phone.change({ entity: 'patient', recordId, op: 'set', field, value, baseVersion });

  const row = async (id: string) =>
    (
      await h.scratch.owner<
        {
          preferredName: string | null;
          visualDescriptor: string | null;
          usualArea: string | null;
          legalGivenName: string | null;
          legalFamilyName: string | null;
          birthPrecision: string | null;
          birthYear: number | null;
          allergyScreen: string;
          fieldVersions: Record<string, number>;
        }[]
      >`select preferred_name as "preferredName", visual_descriptor as "visualDescriptor",
               usual_area as "usualArea", legal_given_name as "legalGivenName",
               legal_family_name as "legalFamilyName", birth_precision as "birthPrecision",
               birth_year as "birthYear", allergy_screen as "allergyScreen", field_versions as "fieldVersions"
        from sineobex.patients where id = ${id}`
    )[0]!;

  const historyOf = (recordId: string, field: string) =>
    h.scratch.owner<
      { version: number; value: unknown; previousValue: unknown; kind: string; reviewId: string | null }[]
    >`
      select version, value, previous_value as "previousValue", kind, review_id as "reviewId"
      from sineobex.field_history
      where record_id = ${recordId} and field = ${field} order by id`;

  const openReviews = (recordId: string) =>
    h.scratch.owner<
      { id: string; field: string; needs: string; patientId: string; openedByChange: string }[]
    >`
      select id, field, needs, patient_id as "patientId", opened_by_change as "openedByChange"
      from sineobex.field_reviews
      where record_id = ${recordId} and status = 'open' order by opened_at`;

  const count = async (table: string, where: string) =>
    Number(
      (await h.scratch.owner.unsafe(`select count(*)::int as n from sineobex.${table} where ${where}`))[0]!.n,
    );

  const accepted = (c: Change, serverVersion = 1) => ({
    changeId: c.changeId,
    status: 'accepted',
    serverVersion,
    hash: c.valueHash,
  });

  describe('values', () => {
    const table: Record<string, string> = {
      patient: 'patients',
      patient_alias: 'patient_aliases',
      patient_allergy: 'patient_allergies',
      patient_consent: 'patient_consents',
      problem: 'problems',
      problem_note: 'problem_notes',
      id_link: 'patient_id_links',
      encounter: 'encounters',
    };

    it('refuses every invalid value of sync-values.json as a validation rejection, and stores nothing', async () => {
      for (const v of vectors.invalid) {
        const c = await phoneA.change({
          entity: v.entity as Change['entity'],
          op: v.op,
          ...(v.field ? { field: v.field } : {}),
          value: v.value,
          baseVersion: 1,
        });
        const r = await one(phoneA, t.aToken, c);
        expect(r, v.name).toMatchObject({ status: 'rejected', reason: 'validation' });
        if (v.expect!.problem) {
          expect(r.details?.problem, v.name).toBe(v.expect!.problem);
        } else {
          const paths = [...new Set((r.details?.problems as { path: string }[]).map((p) => p.path))].sort();
          expect(paths, v.name).toEqual(v.expect!.paths);
        }
        expect(await count('field_history', `change_id = '${c.changeId}'`), v.name).toBe(0);
        if (v.op === 'create' && table[v.entity]) {
          expect(await count(table[v.entity]!, `id = '${c.recordId}'`), v.name).toBe(0);
        }
      }
    });

    it('checks the parents sync-values.json lists for every valid change before anything is stored', async () => {
      // An empty team: no parent exists, so each change names the first one it lacks.
      for (const v of vectors.valid) {
        if (!v.parents?.length || v.op === 'append') continue;
        let recordId = randomUUID();
        if (v.op === 'set') {
          const p = await patient();
          recordId =
            v.entity === 'problem'
              ? await createProblem(h, t.teamId, p.id, t.aId)
              : await createEncounter(h, t.teamId, t.aId, null);
        }
        const c = await phoneA.change({
          entity: v.entity as Change['entity'],
          recordId,
          op: v.op,
          ...(v.field ? { field: v.field } : {}),
          value: v.value,
          baseVersion: 1,
        });
        expect(await one(phoneA, t.aToken, c), v.name).toMatchObject({
          status: 'rejected',
          reason: 'stale_reference',
          details: { problem: `${v.parents[0]!.entity}_missing` },
        });
        expect(await count('field_history', `change_id = '${c.changeId}'`), v.name).toBe(0);
      }
    });
  });

  describe('each entity', () => {
    it('an intake: the row canonical to itself, two consents, every field at version 1, replayed the same', async () => {
      const checkId = randomUUID();
      const value = intakeValue({
        preferredName: 'Ruthie',
        visualDescriptor: 'Demo: green coat, cane',
        birth: { precision: 'estimated', year: 1961 },
        matchCheck: { checkId, where: 'phone', indexVersion: '7.idx1', shown: [], dismissed: [] },
      });
      const c = await phoneA.change({
        entity: 'patient',
        op: 'create',
        value,
        deviceTime: '2026-10-20T14:30:00.000Z',
        correctedTime: '2026-10-20T14:30:04.000Z',
      });
      const mark = await auditMark(h);
      const r = await one(phoneA, t.aToken, c);
      expect(r).toEqual(accepted(c));
      const [p] = await h.scratch.owner<
        { canonicalId: string; status: string; registeredAt: Date; lastSeenAt: Date; fieldVersions: object }[]
      >`select canonical_id as "canonicalId", status, registered_at as "registeredAt",
               last_seen_at as "lastSeenAt", field_versions as "fieldVersions" from sineobex.patients
        where id = ${c.recordId}`;
      expect(p).toMatchObject({ canonicalId: c.recordId, status: 'active' });
      expect(p!.registeredAt.toISOString()).toBe('2026-10-20T14:30:04.000Z');
      expect(p!.lastSeenAt.toISOString()).toBe('2026-10-20T14:30:04.000Z');
      expect(Object.values(p!.fieldVersions)).toEqual(Array(9).fill(1));
      const consents = await h.scratch.owner<{ id: string; kind: string; decision: string }[]>`
        select id, kind, decision from sineobex.patient_consents where patient_id = ${c.recordId} order by kind`;
      expect(consents).toEqual([
        { id: value.consent.id, kind: 'care_and_record', decision: 'given' },
        { id: value.privacyNotice.id, kind: 'privacy_notice', decision: 'acknowledged' },
      ]);
      expect(await count('field_history', `record_id = '${c.recordId}' and kind = 'created'`)).toBe(9);
      const [created] = await expectAudit(h, 'patient.created', {
        after: mark,
        patientId: c.recordId,
        count: 1,
      });
      expect(created!.details).toMatchObject({ changeId: c.changeId, matchCheckId: checkId });

      const before = await auditMark(h);
      expect(await one(phoneA, t.aToken, c)).toEqual(r);
      expect(await auditMark(h)).toBe(before);
      const again = await phoneA.change({ entity: 'patient', recordId: c.recordId, op: 'create', value });
      expect(await one(phoneA, t.aToken, again)).toMatchObject({
        status: 'rejected',
        details: { problem: 'record_exists' },
      });
    });

    it('an allergy, a consent, an encounter: created once, replayed the same, a second create refused', async () => {
      const p = await patient();
      const creates = [
        await phoneA.change({
          entity: 'patient_allergy',
          op: 'create',
          value: { patientId: p.id, substance: 'Penicillin', category: 'drug', severity: 'severe' },
        }),
        await phoneA.change({
          entity: 'patient_consent',
          op: 'create',
          value: {
            patientId: p.id,
            kind: 'privacy_notice',
            decision: 'acknowledged',
            method: 'written',
            scriptVersion: '2026-10-1',
            language: 'es',
          },
        }),
        await phoneA.change({
          entity: 'encounter',
          op: 'create',
          value: { kind: 'medical', patientId: p.id },
        }),
      ];
      const mark = await auditMark(h);
      const first = await asA(...creates);
      expect(first).toEqual(creates.map((c) => accepted(c)));
      await expectAudit(h, 'allergy.created', { after: mark, patientId: p.id, count: 1 });
      const [consent] = await expectAudit(h, 'consent.recorded', { after: mark, patientId: p.id, count: 1 });
      expect(consent!.details).toMatchObject({ kind: 'privacy_notice', decision: 'acknowledged' });
      expect(await asA(...creates)).toEqual(first);
      const twice = await asA(
        ...(await Promise.all(
          creates.map((c) =>
            phoneA.change({ entity: c.entity, op: 'create', recordId: c.recordId, value: c.value }),
          ),
        )),
      );
      expect(twice.map((r) => r.details?.problem)).toEqual([
        'record_exists',
        'record_exists',
        'record_exists',
      ]);
    });

    it('retractions are set once: the second is kept in history, and the record never comes back', async () => {
      const p = await patient({ allergies: [{ substance: 'Latex' }] });
      const allergy = p.allergyIds[0]!;
      const retract = (phone: FakePhone, reason: string) =>
        phone.change({
          entity: 'patient_allergy',
          recordId: allergy,
          op: 'set',
          field: 'enteredInError',
          value: { reason },
        });
      const first = await retract(phoneA, 'Demo: wrong patient');
      const mark = await auditMark(h);
      expect(await asA(first)).toEqual([accepted(first)]);
      await expectAudit(h, 'allergy.entered_in_error', { after: mark, patientId: p.id, count: 1 });
      const second = await retract(phoneB, 'Demo: entered twice');
      expect(await asB(second)).toEqual([
        {
          ...accepted(second),
          server: expect.objectContaining({ value: { reason: 'Demo: wrong patient' }, version: 1 }),
          details: { outcome: 'history_only' },
        },
      ]);
      const [a] = await h.scratch.owner<{ status: string; errorReason: string }[]>`
        select status, error_reason as "errorReason" from sineobex.patient_allergies where id = ${allergy}`;
      expect(a).toEqual({ status: 'entered_in_error', errorReason: 'Demo: wrong patient' });
      expect((await historyOf(allergy, 'enteredInError')).map((x) => x.kind)).toEqual([
        'entered_in_error',
        'kept_both',
      ]);
    });

    it('two phones adding allergies offline keep both: a union, never one over the other', async () => {
      const p = await patient();
      const add = (phone: FakePhone, substance: string) =>
        phone.change({ entity: 'patient_allergy', op: 'create', value: { patientId: p.id, substance } });
      const a = await add(phoneA, 'PCN');
      const b = await add(phoneB, 'Penicillin');
      expect(await asA(a)).toEqual([accepted(a)]);
      expect(await asB(b)).toEqual([accepted(b)]);
      expect(await count('patient_allergies', `patient_id = '${p.id}' and status = 'active'`)).toBe(2);
    });

    it('caps active allergies at 30 per patient', async () => {
      const p = await patient();
      await h.scratch.owner`
        insert into sineobex.patient_allergies (id, team_id, patient_id, substance, recorded_at, author_user_id)
        select gen_random_uuid(), ${t.teamId}, ${p.id}, 'Demo substance ' || i, now(), ${t.aId}
        from generate_series(1, 30) as i`;
      const c = await phoneA.change({
        entity: 'patient_allergy',
        op: 'create',
        value: { patientId: p.id, substance: 'Sulfa' },
      });
      expect(await one(phoneA, t.aToken, c)).toMatchObject({ details: { problem: 'too_many_allergies' } });
    });

    it('street names: two phones’ aliases union, a removal is set once, and at most 20 stay active', async () => {
      const p = await patient();
      const add = (phone: FakePhone, alias: string) =>
        phone.change({ entity: 'patient_alias', op: 'create', value: { patientId: p.id, alias } });
      const a = await add(phoneA, 'Smitty');
      const b = await add(phoneB, 'Big Del');
      const mark = await auditMark(h);
      expect(await asA(a)).toEqual([accepted(a)]);
      expect(await asB(b)).toEqual([accepted(b)]);
      await expectAudit(h, 'alias.created', { after: mark, patientId: p.id, count: 2 });
      expect(await count('patient_aliases', `patient_id = '${p.id}' and status = 'active'`)).toBe(2);
      // Matching re-ran for each, with the alias as a name key.
      expect(await count('patient_name_keys', `patient_id = '${p.id}' and source = 'alias'`)).toBe(2);

      const remove = (phone: FakePhone, reason: string) =>
        phone.change({
          entity: 'patient_alias',
          recordId: a.recordId,
          op: 'set',
          field: 'removal',
          value: { reason },
        });
      const first = await remove(phoneA, 'Demo: he dislikes it');
      expect(await asA(first)).toEqual([accepted(first)]);
      await expectAudit(h, 'alias.removed', { after: mark, patientId: p.id, count: 1 });
      const second = await remove(phoneB, 'Demo: not his name');
      expect((await asB(second))[0]!.details).toEqual({ outcome: 'history_only' });
      const [alias] = await h.scratch.owner<{ status: string; removedReason: string; removedBy: string }[]>`
        select status, removed_reason as "removedReason", removed_by as "removedBy"
        from sineobex.patient_aliases where id = ${a.recordId}`;
      expect(alias).toEqual({ status: 'removed', removedReason: 'Demo: he dislikes it', removedBy: t.aId });
      expect(await count('patient_name_keys', `source_id = '${a.recordId}'`)).toBe(0);

      await h.scratch.owner`
        insert into sineobex.patient_aliases (id, team_id, patient_id, alias, author_user_id)
        select gen_random_uuid(), ${t.teamId}, ${p.id}, 'Demo alias ' || i, ${t.aId} from generate_series(1, 19) as i`;
      const tooMany = await add(phoneA, 'Twenty-first');
      expect(await one(phoneA, t.aToken, tooMany)).toMatchObject({
        details: { problem: 'too_many_aliases' },
      });
    });

    it('an intake like someone the creator wasn’t shown says so in its receipt', async () => {
      const like = {
        preferredName: 'Ozzie',
        legalName: { given: 'Oswald', family: 'Prendergast' },
        birth: { precision: 'day', date: '1958-11-02' },
      };
      const existing = await patient(like as NewPatient);
      const unshown = await phoneA.change({ entity: 'patient', op: 'create', value: intakeValue(like) });
      expect(await one(phoneA, t.aToken, unshown)).toEqual({
        ...accepted(unshown),
        details: { possibleDuplicate: true },
      });
      const shown = await phoneB.change({
        entity: 'patient',
        op: 'create',
        value: intakeValue({
          ...like,
          matchCheck: {
            checkId: randomUUID(),
            where: 'phone',
            indexVersion: null,
            shown: [existing.id, unshown.recordId],
            dismissed: [existing.id, unshown.recordId],
          },
        }),
      });
      expect(await one(phoneB, t.bToken, shown)).toEqual(accepted(shown));
      expect(
        await count('duplicate_pairs', `'${shown.recordId}' in (patient_a, patient_b) and creator_dismissed`),
      ).toBe(2);
    });

    it('a record read through sync has the shape the chart gives it', async () => {
      const p = await patient({
        aliases: ['Smitty'],
        allergies: [{ substance: 'Penicillin', severity: 'severe' }],
      });
      const problemId = await createProblem(h, t.teamId, p.id, t.aId, { code: 'J02.9' });
      const chart = await call(h, `/v1/patients/${p.id}`, { token: t.aToken, teamId: t.teamId });
      expect(chart.status).toBe(200);
      const c = chart.body as unknown as {
        patient: object;
        aliases: { id: string }[];
        allergies: { id: string }[];
        problems: { id: string }[];
      };
      const synced = await call(h, '/v1/sync/records', {
        method: 'POST',
        token: t.aToken,
        teamId: t.teamId,
        json: {
          records: [
            { entity: 'patient', id: p.id },
            { entity: 'patient_alias', id: p.aliasIds[0] },
            { entity: 'patient_allergy', id: p.allergyIds[0] },
            { entity: 'problem', id: problemId },
          ],
        },
      });
      expect(synced.body.records).toEqual([
        c.patient,
        c.aliases.find((x) => x.id === p.aliasIds[0]),
        c.allergies.find((x) => x.id === p.allergyIds[0]),
        c.problems.find((x) => x.id === problemId),
      ]);
    });
  });

  describe('ID links made on a phone (design 10.4)', () => {
    const token = () => randomUUID().replace(/-/g, '').slice(0, 22);
    const link = (phone: FakePhone, patientId: string, replacesLinkId: string | null = null) =>
      phone.change({
        entity: 'id_link',
        op: 'create',
        value: { patientId, token: token(), replacesLinkId, reason: replacesLinkId ? 'lost' : 'first_card' },
      });

    it('a community health worker makes a card: accepted with its outcome, the same on a retry', async () => {
      const p = await patient();
      const c = await link(chwPhone, p.id);
      const r = await one(chwPhone, t.chwToken, c);
      expect(r).toEqual({
        ...accepted(c),
        details: { linkOutcome: 'active', activeLinkId: c.recordId, retiredLinkIds: [] },
      });
      expect(await one(chwPhone, t.chwToken, c)).toEqual(r);
      const next = await link(chwPhone, p.id, c.recordId);
      expect((await one(chwPhone, t.chwToken, next)).details).toEqual({
        linkOutcome: 'active',
        activeLinkId: next.recordId,
        retiredLinkIds: [c.recordId],
      });
    });

    it('a card for a merged patient, or one the team lacks, is a stale reference; Billing/Data’s is held', async () => {
      const survivor = await patient();
      const merged = await patient();
      await mergeDirect(h, t.teamId, merged.id, survivor.id, t.adminId);
      const r = await asA(await link(phoneA, merged.id), await link(phoneA, randomUUID()));
      expect(r.map((x) => [x.reason, x.details])).toEqual([
        ['stale_reference', { problem: 'patient_merged', survivorId: survivor.id }],
        ['stale_reference', { problem: 'patient_missing' }],
      ]);
      const held = await link(billing.phone, survivor.id);
      expect(await one(billing.phone, billing.token, held)).toMatchObject({
        reason: 'permission',
        quarantined: true,
        hash: held.valueHash,
      });
      expect(await count('patient_id_links', `patient_id in ('${survivor.id}', '${merged.id}')`)).toBe(0);
    });
  });

  describe('permission per entity, existing keys only (D37)', () => {
    it('a community health worker registers allergies and consents, and holds a problem for review', async () => {
      const p = await patient();
      const allergy = await chwPhone.change({
        entity: 'patient_allergy',
        op: 'create',
        value: { patientId: p.id, substance: 'Peanuts', category: 'food' },
      });
      const consent = await chwPhone.change({
        entity: 'patient_consent',
        op: 'create',
        value: {
          patientId: p.id,
          kind: 'care_and_record',
          decision: 'given',
          method: 'verbal',
          scriptVersion: '2026-10-1',
          language: 'en',
        },
      });
      const problem = await chwPhone.change({
        entity: 'problem',
        op: 'create',
        value: { patientId: p.id, title: 'Cough', status: 'new' },
      });
      const retraction = await chwPhone.change({
        entity: 'patient_allergy',
        recordId: allergy.recordId,
        op: 'set',
        field: 'enteredInError',
        value: { reason: 'Demo: wrong person' },
      });
      const r = await send(chwPhone, t.chwToken, allergy, consent, problem, retraction);
      expect(r.slice(0, 2)).toEqual([accepted(allergy), accepted(consent)]);
      // Problems and marking an allergy entered in error are clinical: encounters.chart.
      for (const [i, c] of [problem, retraction].entries()) {
        expect(r[i + 2]).toMatchObject({
          status: 'rejected',
          reason: 'permission',
          quarantined: true,
          hash: c.valueHash,
        });
      }
      expect(await count('problems', `id = '${problem.recordId}'`)).toBe(0);
      expect(await count('patient_allergies', `id = '${allergy.recordId}' and status = 'active'`)).toBe(1);
    });

    it('a CHW registers a patient with a street name', async () => {
      const c = await chwPhone.change({
        entity: 'patient',
        op: 'create',
        value: intakeValue({ preferredName: 'Bo' }),
      });
      const alias = await chwPhone.change({
        entity: 'patient_alias',
        op: 'create',
        value: { patientId: c.recordId, alias: 'Bobo' },
      });
      expect(await send(chwPhone, t.chwToken, c, alias)).toEqual([accepted(c), accepted(alias)]);
    });

    it('Billing/Data holds every patient-side write for review', async () => {
      const p = await patient();
      const changes = [
        await billing.phone.change({
          entity: 'patient',
          op: 'create',
          value: intakeValue({ preferredName: 'Al' }),
        }),
        await billing.phone.change({
          entity: 'patient_allergy',
          op: 'create',
          value: { patientId: p.id, substance: 'Bees' },
        }),
        await setField(billing.phone, p.id, 'usualArea', 'Demo: the made-up park', 1),
      ];
      const r = await send(billing.phone, billing.token, ...changes);
      expect(r.map((x) => [x.reason, x.quarantined])).toEqual(Array(3).fill(['permission', true]));
    });
  });

  describe('parents and holds', () => {
    it('an encounter names a patient of the team: an unknown or another team’s is a stale reference', async () => {
      const other = await secondTeam(h, 'Neighbour Team', 'neighbour');
      const theirs = await createPatient(h, other.teamId, t.aId);
      const mine = await patient();
      const unknown = await phoneA.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical', patientId: randomUUID() },
      });
      const another = await phoneA.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical', patientId: theirs.id },
      });
      const encounter = await phoneA.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical' },
      });
      const changes = [
        unknown,
        another,
        encounter,
        await phoneA.change({
          entity: 'encounter',
          recordId: encounter.recordId,
          op: 'set',
          field: 'patientId',
          value: theirs.id,
          baseVersion: 1,
        }),
        await phoneA.change({
          entity: 'encounter',
          recordId: encounter.recordId,
          op: 'set',
          field: 'patientId',
          value: mine.id,
          baseVersion: 1,
        }),
      ];
      const r = await asA(...changes);
      // The API answers before the foreign key could (0013): never a server_constraint.
      expect(r.map((x) => x.details?.problem ?? x.status)).toEqual([
        'patient_missing',
        'patient_missing',
        'accepted',
        'patient_missing',
        'accepted',
      ]);
      expect(await count('encounters', `id in ('${changes[0]!.recordId}', '${changes[1]!.recordId}')`)).toBe(
        0,
      );
    });

    it('holds a whole intake behind its held create, each item listed with its patient', async () => {
      const m = await addMember(h, t, 'rae@example.com', 'Rae (demo)');
      const phone = await FakePhone.create();
      await register(h, phone, m.token, t.teamId);
      const intake = await phone.change({
        entity: 'patient',
        op: 'create',
        value: intakeValue({ preferredName: 'Mo', allergyScreen: 'not_asked' }),
      });
      await setRole(h, t, m.membershipId, 'billing_data');
      expect(await one(phone, m.token, intake)).toMatchObject({ reason: 'permission', quarantined: true });
      await setRole(h, t, m.membershipId, 'healthcare_staff');

      const dependants = [
        await phone.change({
          entity: 'patient_allergy',
          op: 'create',
          value: { patientId: intake.recordId, substance: 'Aspirin' },
        }),
        await phone.change({
          entity: 'patient_consent',
          op: 'create',
          value: {
            patientId: intake.recordId,
            kind: 'privacy_notice',
            decision: 'declined',
            method: 'verbal',
            scriptVersion: '2026-10-1',
            language: 'en',
          },
        }),
        await phone.change({
          entity: 'problem',
          op: 'create',
          value: { patientId: intake.recordId, title: 'Rash', status: 'new' },
        }),
        await setField(phone, intake.recordId, 'usualArea', 'Demo: the made-up depot', 1),
      ];
      const encounter = await phone.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical', patientId: intake.recordId },
      });
      // A note on the held encounter waits on the encounter, which waits on the patient.
      const note = await phone.change({
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId: encounter.recordId, noteTypeKey: 'vitals' },
      });
      dependants.push(encounter, note);
      const r = await send(phone, m.token, ...dependants);
      expect(r.map((x) => [x.reason, x.quarantined, x.hash])).toEqual(
        dependants.map((c) => ['awaiting_review', true, c.valueHash]),
      );
      const held = await h.scratch.owner<{ changeId: string; waitsOn: string }[]>`
        select details->>'changeId' as "changeId", details->>'waitsOn' as "waitsOn" from sineobex.audit_events
        where action = 'sync.quarantined' and actor_user_id = ${m.id} and details->>'reason' = 'awaiting_review'
        order by id`;
      expect(held.map((x) => x.waitsOn)).toEqual([...Array(5).fill(intake.changeId), encounter.changeId]);

      const mark = await auditMark(h);
      const queue = await call(h, `/v1/team/quarantine?userId=${m.id}`, {
        token: t.adminToken,
        teamId: t.teamId,
      });
      expect((queue.body.items as unknown[]).length).toBe(7);
      // patient_of_change: every item, the note included, is logged with the patient it is about.
      await expectAudit(h, 'quarantine.item_viewed', { after: mark, patientId: intake.recordId, count: 7 });
    });

    it('a removed CHW’s intake is handed over, and accepted record first', async () => {
      const { phone, userId } = await removedPhone(h, t, 'kit@example.com', 'Kit (demo)');
      const intake = await phone.change({
        entity: 'patient',
        op: 'create',
        value: intakeValue({ preferredName: 'Lu' }),
      });
      const allergy = await phone.change({
        entity: 'patient_allergy',
        op: 'create',
        value: { patientId: intake.recordId, substance: 'Codeine' },
      });
      expect((await handOver(h, phone, [intake, allergy])).status).toBe(200);
      const items = (
        await call(h, `/v1/team/quarantine?userId=${userId}`, { token: t.adminToken, teamId: t.teamId })
      ).body.items as { id: string; changeId: string }[];
      const decide = (c: Change) =>
        call(h, `/v1/team/quarantine/${items.find((i) => i.changeId === c.changeId)!.id}/decision`, {
          method: 'POST',
          token: t.adminToken,
          teamId: t.teamId,
          json: { decision: 'accept', reason: 'Confirmed with Kit' },
        });
      expect((await decide(allergy)).body.error?.code).toBe('waiting_on_record');
      expect((await decide(intake)).status).toBe(200);
      expect((await decide(allergy)).status).toBe(200);
      const [p] = await h.scratch.owner<{ authorUserId: string }[]>`
        select author_user_id as "authorUserId" from sineobex.patients where id = ${intake.recordId}`;
      expect(p!.authorUserId).toBe(userId);
      expect(await count('patient_allergies', `patient_id = '${intake.recordId}'`)).toBe(1);
    });
  });

  describe('keep both (module 9)', () => {
    it('two phones set Usually found from version 1: one applied, the other kept with a review', async () => {
      const p = await patient({ usualArea: 'Demo: by the made-up bus station' });
      const a = await setField(phoneA, p.id, 'usualArea', 'Demo: by the library steps', 1);
      const b = await setField(phoneB, p.id, 'usualArea', 'Demo: under the made-up bridge', 1);
      expect(await asA(a)).toEqual([accepted(a, 2)]);
      const mark = await auditMark(h);
      const [rb] = await asB(b);
      const [review] = await openReviews(p.id);
      expect(rb).toEqual({
        ...accepted(b, 2),
        server: {
          value: 'Demo: by the library steps',
          version: 2,
          changedBy: t.aId,
          changedAt: expect.any(String),
        },
        details: { outcome: 'kept_both', reviewId: review!.id },
      });
      expect(review).toMatchObject({
        field: 'usualArea',
        needs: 'patients.edit',
        patientId: p.id,
        openedByChange: b.changeId,
      });
      expect((await row(p.id)).usualArea).toBe('Demo: by the library steps');
      expect(await historyOf(p.id, 'usualArea')).toEqual([
        expect.objectContaining({ version: 1, kind: 'created' }),
        expect.objectContaining({ version: 2, kind: 'set', value: 'Demo: by the library steps' }),
        {
          version: 2,
          kind: 'kept_both',
          value: 'Demo: under the made-up bridge',
          previousValue: 'Demo: by the library steps',
          reviewId: review!.id,
        },
      ]);
      const [contested] = await expectAudit(h, 'patient.field_contested', {
        after: mark,
        patientId: p.id,
        count: 1,
      });
      expect(contested!.details).toMatchObject({
        field: 'usualArea',
        reviewId: review!.id,
        changeId: b.changeId,
      });
      // A retry gets the same answer, the chart's value included.
      expect(await asB(b)).toEqual([rb]);
      // A third value joins the same review: one open review per field.
      const c = await setField(phoneB, p.id, 'usualArea', 'Demo: the made-up church hall', 1);
      expect((await asB(c))[0]!.details).toEqual({ outcome: 'kept_both', reviewId: review!.id });
      expect(await openReviews(p.id)).toHaveLength(1);
    });

    it('a blank fills and the same value is a no-op, whoever saw what', async () => {
      const p = await patient({ preferredLanguage: 'es' });
      const fill = await setField(phoneB, p.id, 'usualArea', 'Demo: the made-up market', 0);
      const same = await setField(phoneB, p.id, 'preferredLanguage', 'es', 0);
      expect(await asB(fill, same)).toEqual([accepted(fill, 2), accepted(same, 1)]);
      expect((await historyOf(p.id, 'usualArea')).at(-1)!.kind).toBe('filled_blank');
    });

    it('D16 exception: a second edit following a first that was kept, not applied, is kept too', async () => {
      const p = await patient({ usualArea: 'Demo: the made-up pier' });
      const a = await setField(phoneA, p.id, 'usualArea', 'Demo: the made-up station', 1);
      expect(await asA(a)).toEqual([accepted(a, 2)]);
      const b1 = await setField(phoneB, p.id, 'usualArea', 'Demo: the made-up mall', 1);
      const b2 = await phoneB.change({
        entity: 'patient',
        recordId: p.id,
        op: 'set',
        field: 'usualArea',
        value: 'Demo: the made-up mall, east door',
        baseVersion: 1,
        follows: b1.changeId,
      });
      const r = await asB(b1, b2);
      expect(r.map((x) => [x.serverVersion, x.details?.outcome])).toEqual([
        [2, 'kept_both'],
        [2, 'kept_both'],
      ]);
      // Without the exception, b2 would match b1's receipt version and overwrite the chart silently.
      expect((await row(p.id)).usualArea).toBe('Demo: the made-up station');
    });

    it('someone must stay recognisable: of two clears from two phones, the second is kept in history', async () => {
      const p = await patient({ preferredName: 'Dee', visualDescriptor: 'Demo: red scarf, crutches' });
      const a = await setField(phoneA, p.id, 'visualDescriptor', null, 1);
      const b = await setField(phoneB, p.id, 'preferredName', null, 1);
      expect(await asA(a)).toEqual([accepted(a, 2)]);
      const mark = await auditMark(h);
      expect(await asB(b)).toEqual([
        {
          ...accepted(b, 1),
          server: expect.objectContaining({ value: 'Dee', version: 1 }),
          details: { outcome: 'history_only', problem: 'nothing_to_recognise' },
        },
      ]);
      expect(await row(p.id)).toMatchObject({ preferredName: 'Dee', visualDescriptor: null });
      expect(await openReviews(p.id)).toEqual([]);
      const [kept] = await expectAudit(h, 'patient.kept_in_history', {
        after: mark,
        patientId: p.id,
        count: 1,
      });
      expect(kept!.details).toMatchObject({ field: 'preferredName', problem: 'nothing_to_recognise' });
      // Neither phone is stuck: their next changes are accepted.
      const nextA = await setField(phoneA, p.id, 'usualArea', 'Demo: the made-up quay', 1);
      const nextB = await setField(phoneB, p.id, 'preferredLanguage', 'fr', 1);
      expect((await asA(nextA))[0]!.status).toBe('accepted');
      expect((await asB(nextB))[0]!.status).toBe('accepted');
    });

    it('an allergy outranks No known allergies, whichever arrives first', async () => {
      // NKA after an allergy: kept in history, no review.
      const first = await patient({ allergies: [{ substance: 'Sulfa' }] });
      const nka = await setField(phoneA, first.id, 'allergyScreen', 'none_known', 1);
      expect((await asA(nka))[0]).toEqual({
        ...accepted(nka, 1),
        server: expect.objectContaining({ value: 'not_asked', version: 1 }),
        details: { outcome: 'history_only' },
      });
      expect((await row(first.id)).allergyScreen).toBe('not_asked');
      expect(await openReviews(first.id)).toEqual([]);

      // An allergy after NKA: the screen goes back to "not asked", as the allergy's author.
      const second = await patient({ allergyScreen: 'none_known' });
      const allergy = await phoneB.change({
        entity: 'patient_allergy',
        op: 'create',
        value: { patientId: second.id, substance: 'Iodine' },
      });
      expect(await asB(allergy)).toEqual([accepted(allergy)]);
      expect(await row(second.id)).toMatchObject({
        allergyScreen: 'not_asked',
        fieldVersions: expect.objectContaining({ allergyScreen: 2 }),
      });
      const [cleared] = await h.scratch.owner<{ kind: string; changedBy: string; changeId: string }[]>`
        select kind, changed_by as "changedBy", change_id as "changeId" from sineobex.field_history
        where record_id = ${second.id} and field = 'allergyScreen' and version = 2`;
      expect(cleared).toEqual({ kind: 'cleared_by_allergy', changedBy: t.bId, changeId: allergy.changeId });
    });
  });

  describe('identity fields: legal name and birth', () => {
    it('an estimate refined by more than ESTIMATE_RANGE, seen, is kept for an admin', async () => {
      const p = await patient({ birth: { precision: 'estimated', year: 1980 } });
      const c = await setField(phoneA, p.id, 'birth', { precision: 'day', date: '1970-05-01' }, 1);
      const [r] = await asA(c);
      const [review] = await openReviews(p.id);
      expect(r!.details).toEqual({ outcome: 'kept_both', reviewId: review!.id });
      expect(review!.needs).toBe('patients.correct_identity');
      expect((await row(p.id)).birthYear).toBe(1980);
    });

    it('changing a recorded value, seen, is an admin’s correction: identity_admin_only', async () => {
      const p = await patient({ legalName: { given: 'Delbert', family: 'Smithfield' } });
      const c = await setField(phoneA, p.id, 'legalName', { given: 'Delbert', family: 'Smithers' }, 1);
      expect(await asA(c)).toEqual([
        expect.objectContaining({ status: 'rejected', details: { problem: 'identity_admin_only' } }),
      ]);
    });

    it('a stale fill never lands on an admin’s correction: it is kept for an admin instead', async () => {
      // {Delbert, null} at version 1; a staff fill made it {Delbert, Smith} and an admin corrected it
      // back to {Delbert, null} (version 3). A phone that saw version 1 fills "Smith" again.
      const p = await patient({ legalName: { given: 'Delbert', family: null } });
      await h.scratch.owner`
        update sineobex.patients set field_versions = field_versions || '{"legalName": 3}' where id = ${p.id}`;
      const c = await setField(phoneA, p.id, 'legalName', { given: 'Delbert', family: 'Smith' }, 1);
      const [r] = await asA(c);
      const [review] = await openReviews(p.id);
      expect(r).toMatchObject({ serverVersion: 3, details: { outcome: 'kept_both', reviewId: review!.id } });
      expect(review!.needs).toBe('patients.correct_identity');
      expect(await row(p.id)).toMatchObject({ legalGivenName: 'Delbert', legalFamilyName: null });
    });

    it('a blank fills whether or not it was seen, and a seen value is filled out', async () => {
      const blank = await patient({ legalName: null });
      const filled = await setField(phoneA, blank.id, 'legalName', { given: 'Ada', family: null }, 0);
      const year = await patient({ birth: { precision: 'year', year: 1946 } });
      const day = await setField(phoneA, year.id, 'birth', { precision: 'day', date: '1946-03-07' }, 1);
      const named = await patient({ legalName: { given: 'Delbert', family: null } });
      const family = await setField(
        phoneA,
        named.id,
        'legalName',
        { given: 'Delbert', family: 'Smithfield' },
        1,
      );
      const estimate = await patient({ birth: { precision: 'estimated', year: 1980 } });
      const near = await setField(phoneA, estimate.id, 'birth', { precision: 'day', date: '1982-06-30' }, 1);
      expect(await asA(filled, day, family, near)).toEqual(
        [filled, day, family, near].map((c) => accepted(c, 2)),
      );
      expect(await row(year.id)).toMatchObject({ birthPrecision: 'day', birthYear: 1946 });
      expect((await row(named.id)).legalFamilyName).toBe('Smithfield');
      for (const id of [blank.id, year.id, named.id]) {
        expect((await historyOf(id, id === year.id ? 'birth' : 'legalName')).at(-1)!.kind).toBe(
          'filled_blank',
        );
      }
    });

    it('two fills of one blank: the first lands, the second waits for an admin', async () => {
      const p = await patient({ legalName: null });
      const a = await setField(phoneA, p.id, 'legalName', { given: 'Del', family: null }, 1);
      const b = await setField(phoneB, p.id, 'legalName', { given: 'Delbert', family: null }, 1);
      expect(await asA(a)).toEqual([accepted(a, 2)]);
      const [r] = await asB(b);
      expect(r!.details?.outcome).toBe('kept_both');
      expect((await openReviews(p.id))[0]!.needs).toBe('patients.correct_identity');
    });
  });

  describe('merged patients (design 2.7)', () => {
    it('late work naming the merged record: children stored as sent, sets applied to the survivor', async () => {
      const survivor = await patient({ preferredName: 'Del', allergyScreen: 'none_known' });
      const merged = await patient({ preferredName: 'Smitty', usualArea: 'Demo: the made-up underpass' });
      const { mergeId } = await mergeDirect(h, t.teamId, merged.id, survivor.id, t.adminId);

      const encounter = await phoneA.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical', patientId: merged.id },
      });
      const allergy = await phoneA.change({
        entity: 'patient_allergy',
        op: 'create',
        value: { patientId: merged.id, substance: 'Morphine' },
      });
      const problem = await phoneA.change({
        entity: 'problem',
        op: 'create',
        value: { patientId: merged.id, title: 'Cough', status: 'new' },
      });
      const fill = await setField(phoneA, merged.id, 'usualArea', 'Demo: by the made-up underpass', 1);
      const differs = await setField(phoneA, merged.id, 'preferredName', 'Smitty D', 1);
      const r = await asA(encounter, allergy, problem, fill, differs);
      expect(r.slice(0, 3)).toEqual([encounter, allergy, problem].map((c) => accepted(c)));
      // Stored as sent, shown on the survivor by group.
      const group = await h.scratch.owner<{ id: string }[]>`
        select e.id from sineobex.encounters e join sineobex.patients p on p.team_id = e.team_id and p.id = e.patient_id
        where p.canonical_id = ${survivor.id}`;
      expect(group.map((x) => x.id)).toEqual([encounter.recordId]);
      expect(
        await count('patient_allergies', `id = '${allergy.recordId}' and patient_id = '${merged.id}'`),
      ).toBe(1);
      // The allergy cleared the group's No known allergies.
      expect((await row(survivor.id)).allergyScreen).toBe('not_asked');

      // A blank on the survivor fills; a different value is kept both, on the survivor.
      expect(r[3]).toEqual({ ...accepted(fill, 2), details: { redirectedTo: survivor.id, mergeId } });
      expect((await row(survivor.id)).usualArea).toBe('Demo: by the made-up underpass');
      expect((await row(merged.id)).usualArea).toBe('Demo: the made-up underpass');
      expect((await historyOf(survivor.id, 'usualArea')).at(-1)!.kind).toBe('redirected');
      const [review] = await openReviews(survivor.id);
      expect(r[4]).toEqual({
        ...accepted(differs, 1),
        server: expect.objectContaining({ value: 'Del', version: 1 }),
        details: { outcome: 'kept_both', reviewId: review!.id, redirectedTo: survivor.id, mergeId },
      });
      // Replayed, the same answer, read from the survivor.
      expect(await asA(fill, differs)).toEqual(r.slice(3));
    });

    it('a chain of merges is one read', async () => {
      const p1 = await patient({ preferredName: 'One' });
      const p2 = await patient({ preferredName: 'Two' });
      const p3 = await patient({ preferredName: 'Three' });
      await mergeDirect(h, t.teamId, p3.id, p2.id, t.adminId);
      await mergeDirect(h, t.teamId, p2.id, p1.id, t.adminId);
      const c = await setField(phoneA, p3.id, 'usualArea', 'Demo: the made-up yard', 1);
      expect((await asA(c))[0]!.details).toMatchObject({ redirectedTo: p1.id });
      expect((await row(p1.id)).usualArea).toBe('Demo: the made-up yard');
    });
  });

  describe('a rejection never stops a phone’s queue (D42)', () => {
    it('a constraint no check caught is a stored rejection, and the next change applies', async () => {
      const p = await patient();
      await h.scratch.owner.unsafe(`alter table sineobex.patient_allergies
        add constraint test_only_no_zebra check (substance <> 'Demo zebra dust')`);
      try {
        const bad = await phoneA.change({
          entity: 'patient_allergy',
          op: 'create',
          value: { patientId: p.id, substance: 'Demo zebra dust' },
        });
        const good = await phoneA.change({
          entity: 'patient_allergy',
          op: 'create',
          value: { patientId: p.id, substance: 'Demo oak pollen' },
        });
        const mark = await auditMark(h);
        const r = await asA(bad, good);
        const refusal = {
          changeId: bad.changeId,
          status: 'rejected',
          reason: 'validation',
          message: expect.any(String),
          details: { problem: 'server_constraint', constraint: 'test_only_no_zebra', sqlstate: '23514' },
        };
        expect(r).toEqual([refusal, accepted(good)]);
        // Rolled back to the savepoint: nothing of the change, but its receipt and its rejection.
        expect(await count('patient_allergies', `id = '${bad.recordId}'`)).toBe(0);
        expect(await count('sync_changes', `change_id = '${bad.changeId}' and status = 'rejected'`)).toBe(1);
        const [rejected] = await expectAudit(h, 'sync.rejected', { after: mark, count: 1 });
        expect(rejected!.details).toMatchObject({ changeId: bad.changeId, constraint: 'test_only_no_zebra' });
        await expectAudit(h, 'allergy.created', { after: mark, count: 1 });
        expect(await asA(bad)).toEqual([refusal]);

        // An admin's accept of the same change answers cannot_apply, never a server error.
        const held = await billing.phone.change({
          entity: 'patient_allergy',
          op: 'create',
          value: { patientId: p.id, substance: 'Demo zebra dust' },
        });
        await send(billing.phone, billing.token, held);
        const items = (
          await call(h, `/v1/team/quarantine?userId=${billing.id}`, { token: t.adminToken, teamId: t.teamId })
        ).body.items as { id: string; changeId: string }[];
        const decided = await call(
          h,
          `/v1/team/quarantine/${items.find((i) => i.changeId === held.changeId)!.id}/decision`,
          {
            method: 'POST',
            token: t.adminToken,
            teamId: t.teamId,
            json: { decision: 'accept', reason: 'Confirmed with Quinn' },
          },
        );
        expect(decided.status).toBe(409);
        expect(decided.body.error?.code).toBe('cannot_apply');
      } finally {
        await h.scratch.owner.unsafe(
          'alter table sineobex.patient_allergies drop constraint test_only_no_zebra',
        );
      }
    });
  });

  describe('offline reads and sync reads', () => {
    it('an offline search lists up to 50 patients it showed, findable by each one', async () => {
      const ids = Array.from({ length: 50 }, () => randomUUID());
      const c = await phoneA.change({
        entity: 'audit',
        op: 'append',
        value: {
          action: 'patient.searched',
          patientIds: ids,
          resultCount: 55,
          criteria: ['name'],
          source: 'team_index',
        },
      });
      expect(await asA(c)).toEqual([accepted(c)]);
      const [found] = await h.scratch.owner<{ details: Record<string, unknown> }[]>`
        select details from sineobex.audit_events
        where team_id = ${t.teamId} and details -> 'patientIds' @> ${h.scratch.owner.json([ids[49]!])}`;
      expect(found!.details).toMatchObject({
        offline: true,
        changeId: c.changeId,
        criteria: ['name'],
        source: 'team_index',
      });
      const tooMany = await phoneA.change({
        entity: 'audit',
        op: 'append',
        value: { action: 'patient.searched', patientIds: [...ids, randomUUID()] },
      });
      expect((await asA(tooMany))[0]).toMatchObject({ status: 'rejected', reason: 'validation' });
    });

    it('reads each record kind by its own rule, and logs a patient-side read as a view of the patient', async () => {
      const p = await patient({ allergies: [{ substance: 'Shellfish' }] });
      const problem = await createProblem(h, t.teamId, p.id, t.aId);
      const sensitive = await createProblem(h, t.teamId, p.id, t.aId, { code: 'F11.20', sensitive: true });
      const records = (token: string, refs: { entity: string; id: string }[]) =>
        call(h, '/v1/sync/records', { method: 'POST', token, teamId: t.teamId, json: { records: refs } });

      const mark = await auditMark(h);
      const chw = await records(t.chwToken, [
        { entity: 'patient', id: p.id },
        { entity: 'patient_allergy', id: p.allergyIds[0]! },
      ]);
      expect(chw.status).toBe(200);
      const [snap] = chw.body.records as { fields: Record<string, { version: number }> }[];
      expect(Object.keys(snap!.fields).sort()).toEqual([
        'allergyScreen',
        'birth',
        'idCardChoice',
        'legalName',
        'livingSituation',
        'preferredLanguage',
        'preferredName',
        'usualArea',
        'visualDescriptor',
      ]);
      await expectAudit(h, 'patient.viewed', { after: mark, patientId: p.id, count: 2 });
      // The CHW preset sees no problem list; Billing/Data no encounters. Both refused and logged.
      expect((await records(t.chwToken, [{ entity: 'problem', id: problem }])).status).toBe(403);
      expect((await records(billing.token, [{ entity: 'encounter', id: randomUUID() }])).status).toBe(403);
      await expectAudit(h, 'access.denied', { after: mark, count: 2 });
      // Billing/Data reads problems, but a sensitive one is missing, like one the team lacks.
      const read = await records(billing.token, [
        { entity: 'problem', id: problem },
        { entity: 'problem', id: sensitive },
      ]);
      expect((read.body.records as { id: string }[]).map((x) => x.id)).toEqual([problem]);
      expect(read.body.missing).toEqual([{ entity: 'problem', id: sensitive }]);
    });
  });
});
