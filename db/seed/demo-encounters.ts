import {
  canonicalJson,
  checkAnswer,
  effectiveAnswers,
  finishCheck,
  PRESETS,
  sha256Hex,
  type Answers,
  type ResolvedNoteType,
} from '@sineobex/forms';
import type { TransactionSql } from 'postgres';
import { demoId, demoPatientId } from './demo-patients.ts';

/**
 * Made-up visits for the demo team (phase 4, lifecycle card L2-seed; 10.2 "Demo data only"):
 * a Medical visit with a note signed by a resident and attested by an attending beside a completed
 * Social needs note, a Non-Medical outreach visit, and a wound visit whose signed wound note was
 * corrected. Every patient is one of demo-patients.ts's invented people, every free text starts
 * with "Demo:", and the staff are the seed's "(demo)" accounts.
 *
 * Each visit is charted on the released note types as sync applies a phone's changes (lifecycle 4.3
 * to 4.7) and as the online attest writes (5.4): the same rows, field versions and history, every
 * answer one its type takes, the content hash worked out over what the signer saw, and each step
 * allowed by the rule it follows. The seed cannot import the API (the API imports this package),
 * so the few rules it needs are restated here; db/test/demo-encounters.test.ts holds every row to
 * the API's own functions (signoffEffect, attestEffect, correctionEffect, noteContentHash and the
 * credential table). Sync's audit events and notices are not written: the seed is not anyone's act,
 * as its patients are not.
 */

/** Seeded IDs are fixed, so the seed is idempotent and tests can name what they need. */
export const demoVisitId = (n: number) => demoId('20', n);
const noteId = (visit: number, k: number) => demoId('21', visit, k);
const signoffId = (visit: number, k: number) => demoId('22', visit, k);
const attestationId = (visit: number, k: number) => demoId('23', visit, k);
const correctionId = (visit: number, k: number) => demoId('24', visit, k);

/** The wording versions the phone shows (sign, complete) and the portal's attest. */
const STATEMENTS = { sign: 'sign-2026-11', complete: 'complete-2026-11', attest: 'attest-2026-11' } as const;

/** One entry of the wound note's repeating section: `e` and seven characters, as the phone makes. */
const WOUND = 'wound.ewound01';

interface DemoNote {
  k: number;
  type: string;
  /** When the note was added; its answers are entered with it. */
  at: string;
  answers: Answers;
  /** What the phone sends at Complete (lifecycle 3.3): `sign` for a Medical note its author signs. */
  act: 'complete' | 'sign';
  attest?: { by: string; at: string };
  correction?: { at: string; reason: string; changes: Answers };
}

interface DemoVisit {
  n: number;
  patient: number;
  kind: 'medical' | 'non_medical';
  /** The staff email of whoever charts the visit and all its notes. */
  by: string;
  startedAt: string;
  locationText: string;
  /** A Medical visit's assessment, entered before Complete: it is part of what is signed (4.5). */
  summary?: { text: string; at: string };
  /** Complete, on the summary screen: one sign-off per note, the Red flags note's first. */
  completedAt: string;
  notes: DemoNote[];
}

const VISITS: DemoVisit[] = [
  {
    // Marcus (15), with diabetes on his problem list: a resident's visit, attested the next day.
    n: 1,
    patient: 15,
    kind: 'medical',
    by: 'resident@example.com',
    startedAt: '2026-10-20T16:00:00Z',
    locationText: 'Demo: outside the made-up Eastern Market shed',
    summary: { text: 'Demo: sugars steady on his own log; no red flags today.', at: '2026-10-20T16:20:00Z' },
    completedAt: '2026-10-20T16:25:00Z',
    notes: [
      {
        k: 1,
        type: 'red_flags_disposition',
        at: '2026-10-20T16:01:00Z',
        answers: {
          'red_flags.emergency': 'no',
          'disposition.disposition': ['follow_up'],
          'follow_up.when': 'next_street_clinic',
          'follow_up.details': 'Demo: bring the glucose log to the next clinic',
        },
        act: 'sign',
        attest: { by: 'clinician@example.com', at: '2026-10-21T15:00:00Z' },
      },
      {
        k: 2,
        type: 'social_needs',
        at: '2026-10-20T16:10:00Z',
        answers: { 'needs.needs': ['food', 'phone'], 'needs.housing': 'unsheltered' },
        act: 'complete',
      },
    ],
  },
  {
    // Pepe (24): a wellness check by someone with no clinical credential.
    n: 2,
    patient: 24,
    kind: 'non_medical',
    by: 'logistics@example.com',
    startedAt: '2026-10-22T17:00:00Z',
    locationText: 'Demo: by the made-up Fisher overpass',
    completedAt: '2026-10-22T17:15:00Z',
    notes: [
      {
        k: 1,
        type: 'outreach',
        at: '2026-10-22T17:02:00Z',
        answers: {
          'outreach.type': 'wellness_check',
          'outreach.interaction': 'spoke_with_patient',
          'outreach.support': ['food', 'hygiene'],
          'outreach.new_need': ['no'],
          'outreach.notes': 'Demo: doing well, asked when the next food drop is',
          'outreach.follow_up': 'team_follow_up',
        },
        act: 'complete',
      },
    ],
  },
  {
    // The man in the blue wheelchair (21), whose pressure ulcer is on his problem list: the
    // attending signs, then corrects a measurement the next day.
    n: 3,
    patient: 21,
    kind: 'medical',
    by: 'clinician@example.com',
    startedAt: '2026-10-24T22:00:00Z',
    locationText: 'Demo: under the made-up Lodge freeway ramp',
    summary: { text: 'Demo: stage 2 sore cleaned and covered; cushion checked.', at: '2026-10-24T22:25:00Z' },
    completedAt: '2026-10-24T22:30:00Z',
    notes: [
      {
        k: 1,
        type: 'red_flags_disposition',
        at: '2026-10-24T22:01:00Z',
        answers: {
          'red_flags.emergency': 'no',
          // Answered while emergency was ticked yes, before it went back to no: hidden, it does not
          // count, and the note drops it when it is signed.
          'red_flags.ems_activated': 'no',
          'disposition.disposition': ['follow_up'],
          'follow_up.when': 'prn',
        },
        act: 'sign',
      },
      {
        k: 2,
        type: 'wound_care',
        at: '2026-10-24T22:05:00Z',
        answers: {
          [`${WOUND}.entryAt`]: '2026-10-24T22:05:00Z',
          [`${WOUND}.location.region`]: 'lower_body',
          [`${WOUND}.location.surface`]: 'posterior',
          [`${WOUND}.type`]: 'pressure',
          [`${WOUND}.duration`]: 'wk_1_to_4',
          [`${WOUND}.measurements.length`]: 3,
          [`${WOUND}.measurements.width`]: 2,
          [`${WOUND}.measurements.depth`]: 0.5,
          [`${WOUND}.bed`]: ['granulation'],
          [`${WOUND}.drainage_amount`]: 'small',
          [`${WOUND}.drainage_type`]: 'serous',
          [`${WOUND}.periwound`]: ['intact'],
          [`${WOUND}.infection_concern`]: 'no',
          [`${WOUND}.treatment.cleansing`]: ['ns'],
          [`${WOUND}.treatment.dressing`]: ['mepilex'],
          [`${WOUND}.treatment.follow_up`]: 'week_1',
        },
        act: 'sign',
        correction: {
          at: '2026-10-25T16:00:00Z',
          reason: 'Demo: measured again along the long edge',
          changes: { [`${WOUND}.measurements.length`]: 3.5 },
        },
      },
    ],
  },
];

/** The credential table's columns the seed needs (services/api/src/auth/permissions.ts, CAPABILITIES). */
const CAN_SIGN = new Set(['attending', 'resident', 'np', 'pa']);
const CAN_ATTEST = new Set(['attending']);
const CHARTS_MEDICAL = new Set(['attending', 'resident', 'np', 'pa', 'student']);
const NEEDS_ATTESTATION = new Set(['resident', 'np', 'pa']);

interface Member {
  userId: string;
  displayName: string;
  credential: string;
  fields: Record<string, string>;
}

interface HeldNote {
  id: string;
  type: ResolvedNoteType;
  medical: boolean;
  answers: Answers;
  versions: Record<string, number>;
  status: 'draft' | 'completed' | 'signed';
  attestation: 'not_needed' | 'waiting' | 'attested';
  signoffId: string | null;
  signerUserId: string | null;
}

export async function seedDemoEncounters(
  tx: TransactionSql,
  teamId: string,
): Promise<{ visits: number; skipped?: string }> {
  const types = await releasedTypes(tx, teamId);
  if (typeof types === 'string') return { visits: 0, skipped: types };
  const staff = await membersOf(tx, teamId);
  if (VISITS.some((v) => !staff.has(v.by))) return { visits: 0, skipped: 'no demo staff to chart them' };

  let charted = 0;
  for (const visit of VISITS) {
    if (await chartVisit(tx, teamId, visit, types, staff)) charted++;
  }
  return { visits: charted };
}

/**
 * The note types the visits are charted on, as the team holds them: only the released definitions,
 * checked by hash. A team given other definitions (the tests' fixtures) gets no visit.
 */
async function releasedTypes(
  tx: TransactionSql,
  teamId: string,
): Promise<Map<string, ResolvedNoteType> | string> {
  const keys = [...new Set(VISITS.flatMap((v) => v.notes.map((n) => n.type)))];
  const rows = await tx<{ key: string; hash: string; definition: ResolvedNoteType }[]>`
    select key, hash, definition from sineobex.note_type_versions
    where team_id = ${teamId} and version = 1 and key in ${tx(keys)}`;
  const types = new Map<string, ResolvedNoteType>();
  for (const key of keys) {
    const held = rows.find((r) => r.key === key);
    const released = PRESETS.find((p) => p.key === key && p.version === 1);
    if (!held || !released || held.hash !== released.hash)
      return `the team does not hold the released ${key} v1`;
    types.set(key, held.definition);
  }
  return types;
}

/** The demo staff as sync loads a signer (lifecycle 4.2): the membership as it is now. */
async function membersOf(tx: TransactionSql, teamId: string): Promise<Map<string, Member>> {
  const rows = await tx<
    {
      email: string;
      userId: string;
      displayName: string;
      credential: string;
      fields: Record<string, string>;
    }[]
  >`
    select u.email, u.id as "userId", u.display_name as "displayName", m.credential, m.credential_fields as fields
    from sineobex.team_memberships m join sineobex.users u on u.id = m.user_id
    where m.team_id = ${teamId} and m.removed_at is null`;
  return new Map(rows.map(({ email, ...m }) => [email, m]));
}

/** Charts one visit, unless it is there already: then nothing of it is written again. */
async function chartVisit(
  tx: TransactionSql,
  teamId: string,
  visit: DemoVisit,
  types: Map<string, ResolvedNoteType>,
  staff: Map<string, Member>,
): Promise<boolean> {
  const json = (v: unknown) => tx.json((v ?? null) as never);
  const author = staff.get(visit.by)!;
  const id = demoVisitId(visit.n);
  const patientId = demoPatientId(visit.patient);
  const history = async (
    entity: 'encounter' | 'encounter_note',
    recordId: string,
    field: string,
    version: number,
    value: unknown,
    previous: unknown,
    kind: 'created' | 'set' | 'corrected',
    by: string,
    at: string,
  ) => {
    const [row] = await tx<{ id: string }[]>`
      insert into sineobex.field_history (team_id, entity, record_id, field, version, value, previous_value, kind,
        changed_by, device_time, recorded_at)
      values (${teamId}, ${entity}, ${recordId}, ${field}, ${version}, ${json(value)},
        ${previous === undefined ? null : json(previous)}, ${kind}, ${by}, ${at}, ${at})
      returning id::text as id`;
    return row!.id;
  };
  const meta = (by: string, at: string) => ({ by, at, changeId: null });

  // The visit (4.3): its envelope's fields at version 1, each with its history.
  const envelope: Record<string, unknown> = {
    patientId,
    location: null,
    locationText: visit.locationText,
    kind: visit.kind,
  };
  const fields = Object.keys(envelope);
  const inserted = await tx`
    insert into sineobex.encounters (id, team_id, patient_id, kind, status, author_user_id, started_at,
      started_device_time, clock_verified, location, location_text, field_versions, field_meta, created_at)
    values (${id}, ${teamId}, ${patientId}, ${visit.kind}, 'draft', ${author.userId}, ${visit.startedAt},
      ${visit.startedAt}, true, null, ${visit.locationText}, ${json(Object.fromEntries(fields.map((f) => [f, 1])))},
      ${json(Object.fromEntries(fields.map((f) => [f, meta(author.userId, visit.startedAt)])))}, ${visit.startedAt})
    on conflict (id) do nothing
    returning id`;
  if (inserted.length === 0) return false;
  for (const f of fields) {
    await history('encounter', id, f, 1, envelope[f], undefined, 'created', author.userId, visit.startedAt);
  }
  // The patient was seen when the visit started; never moved back.
  await tx`
    update sineobex.patients set last_seen_at = least(${visit.startedAt}::timestamptz, now())
    where team_id = ${teamId} and id = ${patientId}
      and (last_seen_at is null or last_seen_at < least(${visit.startedAt}::timestamptz, now()))`;

  // Each note (4.4), with every answer it was given; a Medical note needs a patient and a
  // credential that charts Medical.
  const held: HeldNote[] = [];
  for (const n of visit.notes) {
    const type = types.get(n.type)!;
    const medical = !type.kinds.includes('non_medical');
    if (medical && (visit.kind !== 'medical' || !CHARTS_MEDICAL.has(author.credential))) {
      throw new Error(`demo visit ${visit.n}: ${n.type} is a Medical note`);
    }
    for (const [path, value] of Object.entries(n.answers)) {
      const problem = checkAnswer(type, path, value);
      if (problem) throw new Error(`demo visit ${visit.n}: ${n.type} ${path} is ${problem}`);
    }
    const note: HeldNote = {
      id: noteId(visit.n, n.k),
      type,
      medical,
      answers: { ...n.answers },
      versions: { status: 1 },
      status: 'draft',
      attestation: 'not_needed',
      signoffId: null,
      signerUserId: null,
    };
    for (const path of Object.keys(n.answers)) note.versions[`data.${path}`] = 1;
    await tx`
      insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, note_type_version, medical,
        status, author_user_id, data, field_versions, field_meta, created_at)
      values (${note.id}, ${teamId}, ${id}, ${type.key}, ${type.version}, ${medical}, 'draft', ${author.userId},
        ${json(note.answers)}, ${json(note.versions)},
        ${json(Object.fromEntries(Object.keys(note.versions).map((f) => [f, meta(author.userId, n.at)])))}, ${n.at})`;
    await history('encounter_note', note.id, 'status', 1, 'draft', undefined, 'created', author.userId, n.at);
    for (const [path, value] of Object.entries(n.answers)) {
      await history(
        'encounter_note',
        note.id,
        `data.${path}`,
        1,
        value,
        undefined,
        'created',
        author.userId,
        n.at,
      );
    }
    held.push(note);
  }

  // The assessment, a set of the envelope while every note is a draft.
  if (visit.summary) {
    const { text, at } = visit.summary;
    await tx`
      update sineobex.encounters set summary = ${text},
        field_versions = field_versions || ${json({ summary: 1 })},
        field_meta = field_meta || ${json({ summary: meta(author.userId, at) })},
        version = version + 1
      where id = ${id}`;
    await history('encounter', id, 'summary', 1, text, null, 'set', author.userId, at);
  }

  const hashOf = (note: HeldNote) =>
    sha256Hex(
      canonicalJson({
        v: 1,
        noteId: note.id,
        encounterId: id,
        patientId,
        noteTypeKey: note.type.key,
        noteTypeVersion: note.type.version,
        summary: visit.summary?.text ?? null,
        answers: effectiveAnswers(note.type, note.answers),
      }),
    );

  // Complete (3.3, 4.6): one sign-off per note, made at one time on the phone and received a
  // little later. The Red flags note goes first, so the Medical notes after it may be signed.
  const signedAt = visit.completedAt;
  const receivedAt = new Date(Date.parse(signedAt) + 2 * 60_000).toISOString();
  let redFlagsDone = false;
  for (const [i, note] of held.entries()) {
    const n = visit.notes[i]!;
    if (finishCheck(note.type, note.answers).length > 0)
      throw new Error(`demo visit ${visit.n}: ${n.type} incomplete`);
    const isRedFlags = note.type.auto === 'medical';
    if (note.medical && !isRedFlags && !redFlagsDone)
      throw new Error(`demo visit ${visit.n}: red flags first`);
    const signs = note.medical && n.act === 'sign' && CAN_SIGN.has(author.credential);
    const needsAttestation = NEEDS_ATTESTATION.has(author.credential);
    const effect = !note.medical || n.act === 'complete' ? 'completed' : signs ? 'signed' : 'saved_unsigned';
    const { npi, ...fields } = author.fields;
    const sid = signoffId(visit.n, n.k);
    await tx`
      insert into sineobex.note_signoffs (id, team_id, note_id, act, effect, content_hash, signer_user_id, signer_name,
        signer_credential, signer_npi, signer_fields, claimed_credential, needs_attestation, statement_version,
        signed_at, signed_device_time, clock_verified, received_at)
      values (${sid}, ${teamId}, ${note.id}, ${n.act}, ${effect}, ${await hashOf(note)}, ${author.userId},
        ${author.displayName}, ${author.credential}, ${npi ?? null}, ${json(fields)},
        ${n.act === 'sign' ? author.credential : null}, ${needsAttestation}, ${STATEMENTS[n.act]}, ${signedAt},
        ${signedAt}, true, ${receivedAt})`;

    // The note keeps only the answers that count, which is what was hashed; each one dropped and
    // the status get their next version and a history row.
    const counting = effectiveAnswers(note.type, note.answers);
    const dropped = Object.keys(note.answers).filter((path) => !Object.hasOwn(counting, path));
    const status = effect === 'signed' ? 'signed' : 'completed';
    const attestation = effect === 'signed' && needsAttestation ? 'waiting' : 'not_needed';
    const bumped = ['status', ...dropped.map((path) => `data.${path}`)];
    for (const field of bumped) note.versions[field] = (note.versions[field] ?? 0) + 1;
    await tx`
      update sineobex.encounter_notes set
        data = ${json(counting)},
        status = ${status},
        completed_at = ${signedAt},
        completed_by = ${author.userId},
        first_signed_at = ${effect === 'signed' ? signedAt : null},
        signoff_id = ${effect === 'signed' ? sid : null},
        attestation = ${attestation},
        field_versions = field_versions || ${json(Object.fromEntries(bumped.map((f) => [f, note.versions[f]])))},
        field_meta = field_meta || ${json(Object.fromEntries(bumped.map((f) => [f, meta(author.userId, signedAt)])))},
        version = version + 1
      where id = ${note.id}`;
    await history(
      'encounter_note',
      note.id,
      'status',
      note.versions.status!,
      status,
      'draft',
      'set',
      author.userId,
      signedAt,
    );
    for (const path of dropped) {
      await history(
        'encounter_note',
        note.id,
        `data.${path}`,
        note.versions[`data.${path}`]!,
        null,
        note.answers[path],
        'set',
        author.userId,
        signedAt,
      );
    }
    Object.assign(note, {
      answers: counting,
      status,
      attestation,
      signoffId: effect === 'signed' ? sid : null,
    });
    note.signerUserId = effect === 'signed' ? author.userId : null;
    if (isRedFlags) redFlagsDone = true;
  }

  for (const [i, note] of held.entries()) {
    const n = visit.notes[i]!;
    if (n.attest) await attest(n.attest, note, visit.n, n.k);
    if (n.correction) await correct(n.correction, note, visit.n, n.k);
  }
  return true;

  /**
   * The online attest (5.4): a second person whose credential attests, never the author or the
   * signer, names the note's current signature with the hash of the note as it is.
   */
  async function attest(a: { by: string; at: string }, note: HeldNote, v: number, k: number) {
    const attending = staff.get(a.by)!;
    if (
      note.status !== 'signed' ||
      note.attestation !== 'waiting' ||
      attending.userId === author.userId ||
      attending.userId === note.signerUserId ||
      !CAN_ATTEST.has(attending.credential)
    ) {
      throw new Error(`demo visit ${v}: ${note.type.key} cannot be attested`);
    }
    const { npi, ...fields } = attending.fields;
    await tx`
      insert into sineobex.note_attestations (id, team_id, note_id, signoff_id, content_hash, attending_user_id,
        attending_name, attending_npi, attending_fields, statement_version, attested_at)
      values (${attestationId(v, k)}, ${teamId}, ${note.id}, ${note.signoffId}, ${await hashOf(note)},
        ${attending.userId}, ${attending.displayName}, ${npi ?? null}, ${json(fields)}, ${STATEMENTS.attest}, ${a.at})`;
    await tx`update sineobex.encounter_notes set attestation = 'attested' where id = ${note.id}`;
    note.attestation = 'attested';
  }

  /**
   * A correction by the note's author (3.6, 4.7): each answer written under history kind
   * `corrected`, through the guard that lets a finished note's answers change only while
   * `app.note_correction` names it, and what is left of the signature by the corrector's credential.
   */
  async function correct(
    c: { at: string; reason: string; changes: Answers },
    note: HeldNote,
    v: number,
    k: number,
  ) {
    const answers = { ...note.answers, ...c.changes };
    for (const [path, value] of Object.entries(c.changes)) {
      if (checkAnswer(note.type, path, value)) throw new Error(`demo visit ${v}: correction of ${path}`);
    }
    if (finishCheck(note.type, answers).length > 0)
      throw new Error(`demo visit ${v}: correction leaves it incomplete`);
    if (note.status !== 'signed' || note.attestation === 'attested') {
      throw new Error(`demo visit ${v}: the seed corrects only a signed note nobody attested`);
    }
    const canSign = CAN_SIGN.has(author.credential);
    const status = canSign ? 'signed' : 'completed';
    const attestation = !canSign
      ? 'not_needed'
      : NEEDS_ATTESTATION.has(author.credential)
        ? 'waiting'
        : note.attestation;
    const fieldsOf = Object.keys(c.changes).map((path) => `data.${path}`);
    const bumped = [...fieldsOf, ...(status !== note.status ? ['status'] : [])];
    for (const field of bumped) note.versions[field] = (note.versions[field] ?? 0) + 1;
    await tx`select set_config('app.note_correction', ${note.id}, true)`;
    await tx`
      update sineobex.encounter_notes set
        data = data || ${json(c.changes)},
        status = ${status}, attestation = ${attestation}, signoff_id = ${canSign ? note.signoffId : null},
        field_versions = field_versions || ${json(Object.fromEntries(bumped.map((f) => [f, note.versions[f]])))},
        field_meta = field_meta || ${json(Object.fromEntries(bumped.map((f) => [f, meta(author.userId, c.at)])))},
        version = version + 1
      where id = ${note.id}`;
    await tx`select set_config('app.note_correction', '', true)`;
    const changes = [];
    for (const [path, value] of Object.entries(c.changes)) {
      const field = `data.${path}`;
      const historyId = await history(
        'encounter_note',
        note.id,
        field,
        note.versions[field]!,
        value,
        note.answers[path] ?? null,
        'corrected',
        author.userId,
        c.at,
      );
      changes.push({ field, oldValue: note.answers[path] ?? null, newValue: value, historyId });
    }
    if (status !== note.status) {
      await history(
        'encounter_note',
        note.id,
        'status',
        note.versions.status!,
        status,
        note.status,
        'set',
        author.userId,
        c.at,
      );
    }
    await tx`
      insert into sineobex.note_corrections (id, team_id, note_id, changes, outcome, reason, requested_by_patient,
        corrector_user_id, corrector_name, corrector_credential, claimed_credential, corrected_at, clock_verified)
      values (${correctionId(v, k)}, ${teamId}, ${note.id}, ${json(changes)}, 'corrected', ${c.reason}, false,
        ${author.userId}, ${author.displayName}, ${author.credential}, ${author.credential}, ${c.at}, true)`;
    Object.assign(note, { answers, status, attestation });
  }
}
