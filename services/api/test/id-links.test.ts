import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditFn } from '../src/auth/context.ts';
import type { Tx } from '../src/db/database.ts';
import {
  ID_LINK_TOKEN_PATTERN,
  idLinkHandshake,
  idLinkTokenHash,
  idLinkTokenRef,
  idLinkUrl,
  newIdLinkToken,
  type HandshakeInput,
} from '../src/patients/id-links.ts';
import { canonicalJson } from '../src/sync/canonical.ts';
import { lockTeamWrites } from '../src/sync/locks.ts';
import { createHarness, type Harness } from './harness.ts';
import { FakePhone, push, register, results } from './sync-fixtures.ts';
import {
  auditMark,
  createPatient,
  createTeam,
  expectAudit,
  expectAuditClean,
  logSpy,
  memberWith,
  mergeDirect,
  type Member,
} from './patient-fixtures.ts';

// Street Medicine ID links (phase 3 design 10, D31, D39): one active card per patient record; a
// merge retires none; a new card, online or offline, retires every active card of the group.

describe('ID links', () => {
  let h: Harness;
  let teamId: string;
  let otherTeamId: string;
  let admin: Member;
  let jordan: Member;
  let casey: Member;
  let otherIssuer: Member;
  /** Every token this file made, so no audit row or log line may mention one. */
  const tokens: string[] = [];
  const logs = logSpy();

  beforeAll(async () => {
    h = await createHarness({ log: logs.log });
    teamId = await createTeam(h, 'ID Link Team (demo)');
    otherTeamId = await createTeam(h, 'Other ID Link Team (demo)');
    admin = await memberWith(h, teamId, ['team.manage_users', 'patients.view'], {
      displayName: 'Alex (demo)',
    });
    jordan = await memberWith(h, teamId, ['patients.view', 'patients.edit'], {
      displayName: 'Jordan (demo)',
    });
    casey = await memberWith(h, teamId, ['patients.view', 'patients.edit'], { displayName: 'Casey (demo)' });
    otherIssuer = await memberWith(h, otherTeamId, ['patients.view', 'patients.edit']);
  });
  afterAll(() => h.close());

  const at = (iso: string) => new Date(iso);

  /** An issue as a phone's id_link create or the online route would describe it. */
  function issue(
    patientId: string,
    by: Member,
    o: Partial<Omit<HandshakeInput, 'patientId' | 'issuedBy'>> = {},
  ): HandshakeInput {
    const token = o.token ?? newIdLinkToken();
    tokens.push(token);
    return {
      linkId: randomUUID(),
      token,
      replacesLinkId: null,
      reason: 'first_card',
      effectiveAt: at('2026-10-20T14:00:00.000Z'),
      clockVerified: true,
      madeOffline: true,
      deviceId: null,
      changeId: randomUUID(),
      ...o,
      patientId,
      issuedBy: by.userId,
    };
  }

  /** Audit events written the way a team scope writes them, attributed to the issuer. */
  const auditAs =
    (tx: Tx, team: string, userId: string): AuditFn =>
    async (e) => {
      await tx`
        select sineobex.append_audit(${team}, ${userId}, null, null, ${e.action}, ${e.entity ?? null},
          ${e.entityId ?? null}, ${e.patientId ?? null}, null, null, null, null, null,
          ${tx.json((e.details ?? {}) as never)})`;
    };

  /** The handshake in its own transaction, team lock first, as the API runs it. */
  const handshake = (input: HandshakeInput, mode: 'sync' | 'online' = 'sync', team = teamId) =>
    h.db.tx({ teamId: team, userId: input.issuedBy }, async (tx) => {
      await lockTeamWrites(tx, team);
      return idLinkHandshake(tx, auditAs(tx, team, input.issuedBy), input, mode);
    });

  interface LinkRow {
    id: string;
    patientId: string;
    status: string;
    retiredReason: string | null;
    retiredByLink: string | null;
    tokenHash: string;
  }

  const link = async (id: string) =>
    (
      await h.scratch.owner<LinkRow[]>`
        select id, patient_id as "patientId", status, retired_reason as "retiredReason",
               retired_by_link as "retiredByLink", token_hash as "tokenHash"
        from sineobex.patient_id_links where id = ${id}`
    )[0];

  /** The group's active links (every record whose canonical patient is this one). */
  const activeInGroup = async (canonicalId: string) =>
    (
      await h.scratch.owner<{ id: string }[]>`
        select l.id from sineobex.patient_id_links l
        join sineobex.patients p on p.team_id = l.team_id and p.id = l.patient_id
        where p.canonical_id = ${canonicalId} and l.status = 'active' order by l.id`
    ).map((r) => r.id);

  /** Where a card leads, as phase 9 will resolve it: by hash, then through canonical_id. */
  const resolve = async (token: string) =>
    (
      await h.scratch.owner<{ canonicalId: string }[]>`
        select p.canonical_id as "canonicalId" from sineobex.patient_id_links l
        join sineobex.patients p on p.team_id = l.team_id and p.id = l.patient_id
        where l.token_hash = ${await idLinkTokenHash(token)} and l.status = 'active'`
    )[0]?.canonicalId ?? null;

  const merge = (mergedId: string, survivorId: string) =>
    mergeDirect(h, teamId, mergedId, survivorId, admin.userId);

  const notices = async (userId: string, recordId: string) =>
    (
      await h.scratch.owner<{ kind: string }[]>`
        select kind from sineobex.user_notices
        where user_id = ${userId} and entity = 'id_link' and record_id = ${recordId} order by kind`
    ).map((r) => r.kind);

  /** A patient with one active card, made by Jordan. */
  async function withCard(name = 'Demo card holder') {
    const p = await createPatient(h, teamId, jordan.userId, { preferredName: name });
    const first = issue(p.id, jordan);
    expect(await handshake(first)).toMatchObject({ status: 'accepted', linkOutcome: 'active' });
    return { patientId: p.id, cardId: first.linkId, token: first.token };
  }

  describe('the token', () => {
    it('is 22 base64url characters, hashed with SHA-256, named by the hash’s first 12 characters', async () => {
      const a = newIdLinkToken();
      const b = newIdLinkToken();
      expect(a).toMatch(ID_LINK_TOKEN_PATTERN);
      expect(a).not.toBe(b);
      const sha = createHash('sha256').update(a, 'ascii').digest('hex');
      expect(await idLinkTokenHash(a)).toBe(sha);
      expect(await idLinkTokenRef(a)).toBe(sha.slice(0, 12));
      // In the fragment, which no browser or QR scanner sends to a server.
      expect(idLinkUrl('https://cards.example.org/', a)).toBe(`https://cards.example.org/c#${a}`);
    });
  });

  describe('the handshake (design 10.4)', () => {
    it('makes a first card active and audits it by tokenRef', async () => {
      const p = await createPatient(h, teamId, jordan.userId);
      const mark = await auditMark(h);
      const first = issue(p.id, jordan);
      const result = await handshake(first);
      expect(result).toEqual({
        status: 'accepted',
        linkOutcome: 'active',
        activeLinkId: first.linkId,
        retiredLinkIds: [],
      });
      expect(await activeInGroup(p.id)).toEqual([first.linkId]);
      const [generated] = await expectAudit(h, 'id_link.generated', {
        after: mark,
        patientId: p.id,
        count: 1,
      });
      expect(generated!.details).toEqual({
        linkId: first.linkId,
        tokenRef: await idLinkTokenRef(first.token),
        reason: 'first_card',
        offline: true,
        status: 'active',
        changeId: first.changeId,
      });
      expect(generated!.actorUserId).toBe(jordan.userId);
      expect((await link(first.linkId))!.tokenHash).toBe(await idLinkTokenHash(first.token));
    });

    it('retires the card the issuer named and makes the new one active', async () => {
      const { patientId, cardId } = await withCard();
      const mark = await auditMark(h);
      const next = issue(patientId, casey, { replacesLinkId: cardId, reason: 'lost' });
      expect(await handshake(next)).toEqual({
        status: 'accepted',
        linkOutcome: 'active',
        activeLinkId: next.linkId,
        retiredLinkIds: [cardId],
      });
      expect(await link(cardId)).toMatchObject({
        status: 'retired',
        retiredReason: 'regenerated',
        retiredByLink: next.linkId,
      });
      expect(await activeInGroup(patientId)).toEqual([next.linkId]);
      const [retired] = await expectAudit(h, 'id_link.retired', { after: mark, count: 1 });
      expect(retired!.details).toMatchObject({
        linkId: cardId,
        replacedBy: next.linkId,
        reason: 'regenerated',
      });
      // No conflict: nobody is told anything.
      expect(await notices(jordan.userId, cardId)).toEqual([]);
      await expectAudit(h, 'id_link.conflict_resolved', { after: mark, count: 0 });
    });

    it('accepts a card that lost to a newer one as retired, replaced by the winner', async () => {
      const { patientId, cardId } = await withCard();
      // Jordan replaces the card at 14:05; Casey, offline since before that, replaced it at 13:50.
      const jordans = issue(patientId, jordan, {
        replacesLinkId: cardId,
        reason: 'damaged',
        effectiveAt: at('2026-10-20T14:05:00.000Z'),
      });
      expect(await handshake(jordans)).toMatchObject({ linkOutcome: 'active' });
      const mark = await auditMark(h);
      const caseys = issue(patientId, casey, {
        replacesLinkId: cardId,
        reason: 'lost',
        effectiveAt: at('2026-10-20T13:50:00.000Z'),
        clockVerified: false,
      });
      expect(await handshake(caseys)).toEqual({
        status: 'accepted',
        linkOutcome: 'retired',
        activeLinkId: jordans.linkId,
        retiredLinkIds: [caseys.linkId],
      });
      expect(await link(caseys.linkId)).toMatchObject({
        status: 'retired',
        retiredReason: 'superseded_by_newer',
        retiredByLink: jordans.linkId,
      });
      expect(await activeInGroup(patientId)).toEqual([jordans.linkId]);
      const [resolved] = await expectAudit(h, 'id_link.conflict_resolved', { after: mark, count: 1 });
      expect(resolved!.details).toEqual({
        winner: jordans.linkId,
        loser: caseys.linkId,
        effectiveAts: { winner: '2026-10-20T14:05:00.000Z', loser: '2026-10-20T13:50:00.000Z' },
        clockVerified: { winner: true, loser: false },
      });
      const [generated] = await expectAudit(h, 'id_link.generated', { after: mark, count: 1 });
      expect(generated!.details).toMatchObject({ linkId: caseys.linkId, status: 'retired' });
    });

    it('lets a newer card made offline win over the one that synced first', async () => {
      const { patientId, cardId } = await withCard();
      const jordans = issue(patientId, jordan, {
        replacesLinkId: cardId,
        effectiveAt: at('2026-10-20T14:05:00.000Z'),
      });
      await handshake(jordans);
      const caseys = issue(patientId, casey, {
        replacesLinkId: cardId,
        effectiveAt: at('2026-10-20T14:30:00.000Z'),
      });
      expect(await handshake(caseys)).toEqual({
        status: 'accepted',
        linkOutcome: 'active',
        activeLinkId: caseys.linkId,
        retiredLinkIds: [jordans.linkId],
      });
      expect(await link(jordans.linkId)).toMatchObject({
        status: 'retired',
        retiredReason: 'superseded_by_newer',
        retiredByLink: caseys.linkId,
      });
      expect(await link(cardId)).toMatchObject({
        retiredReason: 'regenerated',
        retiredByLink: jordans.linkId,
      });
      expect(await activeInGroup(patientId)).toEqual([caseys.linkId]);
    });

    it('decides two first cards made offline by time, a tie going to the later receipt', async () => {
      const p = await createPatient(h, teamId, jordan.userId);
      const same = at('2026-10-20T12:00:00.000Z');
      const jordans = issue(p.id, jordan, { effectiveAt: same });
      const caseys = issue(p.id, casey, { effectiveAt: same });
      await handshake(jordans);
      expect(await handshake(caseys)).toMatchObject({
        linkOutcome: 'active',
        retiredLinkIds: [jordans.linkId],
      });
      expect(await activeInGroup(p.id)).toEqual([caseys.linkId]);
    });

    it('tells the losing issuer, the winning issuer and everyone who manages users', async () => {
      const { patientId, cardId } = await withCard();
      const jordans = issue(patientId, jordan, {
        replacesLinkId: cardId,
        effectiveAt: at('2026-10-20T14:05:00.000Z'),
      });
      await handshake(jordans);
      const caseys = issue(patientId, casey, {
        replacesLinkId: cardId,
        effectiveAt: at('2026-10-20T13:50:00.000Z'),
      });
      await handshake(caseys);
      expect(await notices(casey.userId, caseys.linkId)).toEqual(['id_link_superseded']);
      expect(await notices(jordan.userId, jordans.linkId)).toEqual(['id_link_kept']);
      // The admins' notice names the card that is valid.
      expect(await notices(admin.userId, jordans.linkId)).toEqual(['id_link_conflict']);
      // Nobody without team.manage_users is told about someone else's conflict.
      expect(await notices(casey.userId, jordans.linkId)).toEqual([]);
    });

    it('answers link_changed online when the named card is no longer active, and writes nothing', async () => {
      const { patientId, cardId } = await withCard();
      const next = issue(patientId, jordan, { replacesLinkId: cardId, madeOffline: false });
      await handshake(next, 'online');
      const before = await auditMark(h);
      const stale = issue(patientId, casey, { replacesLinkId: cardId, madeOffline: false });
      expect(await handshake(stale, 'online')).toEqual({
        status: 'link_changed',
        activeLinkIds: [next.linkId],
      });
      // A null replacesLinkId while a card is active is the same: the person didn't see that card.
      const blind = issue(patientId, casey, { replacesLinkId: null, madeOffline: false });
      expect(await handshake(blind, 'online')).toEqual({
        status: 'link_changed',
        activeLinkIds: [next.linkId],
      });
      expect(await link(stale.linkId)).toBeUndefined();
      expect(await link(blind.linkId)).toBeUndefined();
      expect(await activeInGroup(patientId)).toEqual([next.linkId]);
      await expectAudit(h, 'id_link.generated', { after: before, count: 0 });
    });

    it('rolls the retirements back when the token is taken, even by another team', async () => {
      const elsewhere = await createPatient(h, otherTeamId, otherIssuer.userId);
      const theirs = issue(elsewhere.id, otherIssuer);
      expect(await handshake(theirs, 'sync', otherTeamId)).toMatchObject({ linkOutcome: 'active' });

      const { patientId, cardId } = await withCard();
      const mark = await auditMark(h);
      const clash = issue(patientId, jordan, { replacesLinkId: cardId, token: theirs.token });
      expect(await handshake(clash)).toEqual({
        status: 'rejected',
        reason: 'validation',
        problem: 'token_taken',
      });
      expect(await link(cardId)).toMatchObject({ status: 'active', retiredByLink: null });
      expect(await link(clash.linkId)).toBeUndefined();
      expect(await activeInGroup(patientId)).toEqual([cardId]);
      await expectAudit(h, 'id_link.generated', { after: mark, count: 0 });
      await expectAudit(h, 'id_link.retired', { after: mark, count: 0 });
    });

    it('refuses a merged patient (naming the survivor), a missing one, and a link ID already used', async () => {
      const survivor = await createPatient(h, teamId, jordan.userId);
      const merged = await createPatient(h, teamId, jordan.userId);
      await merge(merged.id, survivor.id);
      expect(await handshake(issue(merged.id, jordan))).toEqual({
        status: 'rejected',
        reason: 'stale_reference',
        problem: 'patient_merged',
        survivorId: survivor.id,
      });
      expect(await handshake(issue(randomUUID(), jordan))).toEqual({
        status: 'rejected',
        reason: 'stale_reference',
        problem: 'patient_missing',
      });
      // Another team's patient is missing too: row-level security hides it.
      const elsewhere = await createPatient(h, otherTeamId, otherIssuer.userId);
      expect(await handshake(issue(elsewhere.id, jordan))).toMatchObject({ problem: 'patient_missing' });

      const { patientId, cardId } = await withCard();
      expect(await handshake(issue(patientId, jordan, { linkId: cardId, replacesLinkId: cardId }))).toEqual({
        status: 'rejected',
        reason: 'validation',
        problem: 'record_exists',
      });
      expect(await activeInGroup(patientId)).toEqual([cardId]);
    });
  });

  describe('merged groups (D39)', () => {
    /** Two records with a card each, the second merged into the first. */
    async function mergedPair() {
      const survivor = await withCard('Demo survivor');
      const merged = await withCard('Demo merged');
      await merge(merged.patientId, survivor.patientId);
      return { survivor, merged };
    }

    it('keeps both cards active after a merge, and both open the kept chart', async () => {
      const { survivor, merged } = await mergedPair();
      expect(await activeInGroup(survivor.patientId)).toEqual([survivor.cardId, merged.cardId].sort());
      expect(await resolve(survivor.token)).toBe(survivor.patientId);
      expect(await resolve(merged.token)).toBe(survivor.patientId);
    });

    for (const mode of ['sync', 'online'] as const) {
      for (const named of ['survivor', 'merged'] as const) {
        it(`retires both with a new card naming the ${named} record’s card (${mode})`, async () => {
          const pair = await mergedPair();
          const next = issue(pair.survivor.patientId, casey, {
            replacesLinkId: pair[named].cardId,
            reason: 'patient_request',
            madeOffline: mode === 'sync',
          });
          const result = await handshake(next, mode);
          expect(result).toMatchObject({
            status: 'accepted',
            linkOutcome: 'active',
            activeLinkId: next.linkId,
          });
          expect(result.status === 'accepted' && [...result.retiredLinkIds].sort()).toEqual(
            [pair.survivor.cardId, pair.merged.cardId].sort(),
          );
          // Issued on the kept record; exactly one active card for the whole group.
          expect(await link(next.linkId)).toMatchObject({
            patientId: pair.survivor.patientId,
            status: 'active',
          });
          expect(await activeInGroup(pair.survivor.patientId)).toEqual([next.linkId]);
          for (const old of [pair.survivor, pair.merged]) {
            expect(await link(old.cardId)).toMatchObject({
              retiredReason: 'regenerated',
              retiredByLink: next.linkId,
            });
            expect(await resolve(old.token)).toBeNull();
          }
          expect(await resolve(next.token)).toBe(pair.survivor.patientId);
        });
      }
    }

    it('lets a stale offline card lose without touching either merged card', async () => {
      const pair = await mergedPair();
      const stale = issue(pair.survivor.patientId, casey, {
        replacesLinkId: randomUUID(),
        effectiveAt: at('2026-10-19T09:00:00.000Z'),
      });
      expect(await handshake(stale)).toMatchObject({
        linkOutcome: 'retired',
        retiredLinkIds: [stale.linkId],
      });
      expect(await activeInGroup(pair.survivor.patientId)).toEqual(
        [pair.survivor.cardId, pair.merged.cardId].sort(),
      );
    });
  });

  it('leaves one active card after two phones push a new card at once', async () => {
    const { patientId, cardId } = await withCard();
    const jordans = issue(patientId, jordan, {
      replacesLinkId: cardId,
      effectiveAt: at('2026-10-20T14:05:00.000Z'),
    });
    const caseys = issue(patientId, casey, {
      replacesLinkId: cardId,
      effectiveAt: at('2026-10-20T14:10:00.000Z'),
    });
    const results = await Promise.all([handshake(jordans), handshake(caseys)]);
    expect(results.every((r) => r.status === 'accepted')).toBe(true);
    // Whichever ran first, the newer card wins.
    expect(await activeInGroup(patientId)).toEqual([caseys.linkId]);
    expect(await link(jordans.linkId)).toMatchObject({ status: 'retired' });
    expect(await link(cardId)).toMatchObject({ status: 'retired' });
  });

  it('confirms a card a phone pushed with the hash of the value it sent, not of the token', async () => {
    const phone = await FakePhone.create();
    await register(h, phone, jordan.token, teamId);
    const p = await createPatient(h, teamId, jordan.userId);
    const token = newIdLinkToken();
    tokens.push(token);
    const value = { patientId: p.id, token, replacesLinkId: null, reason: 'first_card' };
    const change = await phone.change({ entity: 'id_link', op: 'create', value });
    const res = await push(h, phone, jordan.token, teamId, [change]);
    expect(res.status).toBe(200);
    const [result] = results(res.body);
    // The receipt carries the hash of the canonical JSON the phone hashed (module 2: "receipt with
    // the token's hash" is the hash of the value that holds it), so the phone can let go of it.
    const canonical = createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
    expect(change.valueHash).toBe(canonical);
    expect(result).toMatchObject({
      status: 'accepted',
      hash: canonical,
      details: { linkOutcome: 'active', activeLinkId: change.recordId, retiredLinkIds: [] },
    });
    const [receipt] = await h.scratch.owner<{ valueHash: string }[]>`
      select value_hash as "valueHash" from sineobex.sync_changes where change_id = ${change.changeId}`;
    expect(receipt!.valueHash).toBe(canonical);
    // The link itself is looked up by the token's own hash.
    expect(await link(change.recordId)).toMatchObject({
      status: 'active',
      tokenHash: await idLinkTokenHash(token),
    });
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  describe('online issue and the card screen (design 3.5)', () => {
    interface LinkView {
      id: string;
      issuedOn: string;
      url?: string;
      tokenRef: string;
      status: string;
      reason: string;
      madeOffline: boolean;
      retiredReason: string | null;
      replacedBy: string | null;
      issuedBy: { userId: string; displayName: string };
    }
    interface LinkState {
      active: LinkView[];
      history: LinkView[];
    }

    const call = async (path: string, by: Member, json?: unknown) => {
      const res = await h.request(path, {
        method: json === undefined ? 'GET' : 'POST',
        token: by.token,
        teamId,
        ...(json === undefined ? {} : { json }),
      });
      expect(res.headers.get('cache-control')).toBe('no-store');
      const text = await res.text();
      return {
        status: res.status,
        text,
        body: JSON.parse(text) as LinkState & { error?: { code: string; details?: Record<string, unknown> } },
      };
    };
    const post = (
      patientId: string,
      by: Member,
      body: { linkId?: string; replacesLinkId: string | null; reason?: string },
    ) =>
      call(`/v1/patients/${patientId}/id-link`, by, { linkId: randomUUID(), reason: 'first_card', ...body });
    const get = (patientId: string, by: Member = jordan) => call(`/v1/patients/${patientId}/id-link`, by);
    /** The token in an active card's URL (for the log and audit checks). */
    const tokenOf = (url: string | undefined) => {
      const token = url!.split('#')[1]!;
      tokens.push(token);
      return token;
    };

    it('makes a first card on the server, with server time, and shows its URL', async () => {
      const p = await createPatient(h, teamId, jordan.userId);
      const mark = await auditMark(h);
      const res = await post(p.id, jordan, { replacesLinkId: null });
      expect(res.status).toBe(200);
      const [card] = res.body.active;
      expect(res.body.history).toEqual([]);
      expect(card).toMatchObject({
        issuedOn: p.id,
        status: 'active',
        reason: 'first_card',
        madeOffline: false,
        issuedBy: { userId: jordan.userId, displayName: 'Jordan (demo)' },
      });
      const token = tokenOf(card!.url);
      expect(token).toMatch(ID_LINK_TOKEN_PATTERN);
      expect(card!.url).toBe(`http://localhost:3100/c#${token}`);
      expect(card!.tokenRef).toBe(await idLinkTokenRef(token));
      const [generated] = await expectAudit(h, 'id_link.generated', {
        after: mark,
        patientId: p.id,
        count: 1,
      });
      expect(generated!.details).toMatchObject({ linkId: card!.id, offline: false, status: 'active' });
      expect(
        (
          await h.scratch.owner<{ effectiveAt: Date }[]>`
        select effective_at as "effectiveAt" from sineobex.patient_id_links where id = ${card!.id}`
        )[0]!.effectiveAt,
      ).toEqual(h.clock.now);
    });

    it('replaces the card, lists the old one as history, and answers a retry with the same cards', async () => {
      const p = await createPatient(h, teamId, jordan.userId);
      const first = (await post(p.id, jordan, { replacesLinkId: null })).body.active[0]!;
      tokenOf(first.url);
      const linkId = randomUUID();
      const res = await post(p.id, casey, { linkId, replacesLinkId: first.id, reason: 'stolen' });
      expect(res.status).toBe(200);
      expect(res.body.active.map((l) => l.id)).toEqual([linkId]);
      tokenOf(res.body.active[0]!.url);
      expect(res.body.history).toEqual([
        expect.objectContaining({
          id: first.id,
          status: 'retired',
          retiredReason: 'regenerated',
          replacedBy: linkId,
        }),
      ]);
      expect(res.body.history[0]!.url).toBeUndefined();

      const mark = await auditMark(h);
      const retry = await post(p.id, casey, { linkId, replacesLinkId: first.id, reason: 'stolen' });
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(res.body);
      await expectAudit(h, 'id_link.generated', { after: mark, count: 0 });
      await expectAudit(h, 'id_link.viewed', { after: mark, count: 1 });
    });

    it('answers 409 link_changed with the active IDs, never a URL or a token', async () => {
      const p = await createPatient(h, teamId, jordan.userId);
      const first = (await post(p.id, jordan, { replacesLinkId: null })).body.active[0]!;
      const token = tokenOf(first.url);
      const second = (await post(p.id, jordan, { replacesLinkId: first.id })).body.active[0]!;
      const secondToken = tokenOf(second.url);
      for (const replacesLinkId of [first.id, null]) {
        const res = await post(p.id, casey, { replacesLinkId });
        expect(res.status).toBe(409);
        expect(res.body.error).toEqual({
          code: 'link_changed',
          message: expect.any(String),
          details: { activeLinkIds: [second.id] },
        });
        for (const t of [token, secondToken, '/c#']) expect(res.text).not.toContain(t);
      }
      expect(await activeInGroup(p.id)).toEqual([second.id]);
    });

    it('refuses a card for a merged chart with the survivor, and shows the group’s cards on either ID', async () => {
      const survivor = await createPatient(h, teamId, jordan.userId);
      const merged = await createPatient(h, teamId, jordan.userId);
      const a = (await post(survivor.id, jordan, { replacesLinkId: null })).body.active[0]!;
      const b = (await post(merged.id, jordan, { replacesLinkId: null })).body.active[0]!;
      tokenOf(a.url);
      tokenOf(b.url);
      await merge(merged.id, survivor.id);

      const refused = await post(merged.id, casey, { replacesLinkId: b.id });
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({
        code: 'patient_merged',
        details: { survivorId: survivor.id },
      });
      expect(refused.text).not.toContain('/c#');

      const mark = await auditMark(h);
      const state = await get(merged.id);
      expect(state.status).toBe(200);
      expect(state.body.active.map((l) => [l.id, l.issuedOn]).sort()).toEqual(
        [
          [a.id, survivor.id],
          [b.id, merged.id],
        ].sort(),
      );
      const viewed = await expectAudit(h, 'id_link.viewed', {
        after: mark,
        patientId: survivor.id,
        count: 2,
      });
      expect(viewed.map((v) => v.details.linkId).sort()).toEqual([a.id, b.id].sort());

      // A new card naming either one replaces both, on the kept record.
      const next = await post(survivor.id, casey, { replacesLinkId: b.id, reason: 'patient_request' });
      expect(next.status).toBe(200);
      tokenOf(next.body.active[0]!.url);
      expect(next.body.active).toEqual([expect.objectContaining({ issuedOn: survivor.id })]);
      expect(next.body.history.map((l) => l.id).sort()).toEqual([a.id, b.id].sort());
      expect(await activeInGroup(survivor.id)).toEqual([next.body.active[0]!.id]);
    });

    it('answers 404 for a patient the team doesn’t have', async () => {
      const elsewhere = await createPatient(h, otherTeamId, otherIssuer.userId);
      for (const id of [randomUUID(), elsewhere.id]) {
        expect((await get(id)).status).toBe(404);
        expect((await post(id, jordan, { replacesLinkId: null })).status).toBe(404);
      }
    });
  });

  it('never writes a token or a link into an audit event or a log line', async () => {
    expect(tokens.length).toBeGreaterThan(10);
    await expectAuditClean(h, [...tokens, '/c#']);
    expect(logs.lines.length).toBeGreaterThan(0);
    logs.expectClean([...tokens, '/c#']);
  });
});
