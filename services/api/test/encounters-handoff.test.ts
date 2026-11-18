import { inflateSync } from 'node:zlib';
import {
  handoffLines,
  PRESETS,
  visibleAnswers,
  type HandoffLine,
  type ResolvedNoteType,
} from '@sineobex/forms';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Credential, Permission } from '../src/auth/permissions.ts';
import { handoffPdf, type HandoffPdfInput } from '../src/encounters/handoff.ts';
import { SENSITIVE_CODE_RANGES } from '../src/patients/generated/sensitive-codes.ts';
import { noteReader } from '../src/sync/records.ts';
import {
  createWorld,
  eventsAfter,
  staleToken,
  TEST_MEDICAL_EXAM_TYPE,
  TEST_NOTE_TYPE,
  visitAt,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import { noteOn, TEST_SENSITIVE_TYPE, type Clinician, type HeldNote, type Visit } from './sync-fixtures.ts';

// GET /v1/encounters/{encounterId}/ems-handoff (lifecycle 5.7, 9.8; PLAN-OPEN 12.1 #12 and #18):
// the EMS handoff as a PDF, built on the server from the forms part's handoffLines over what each
// note's reader may see (visibleAnswers), with phase 3's sensitive list, so no treatment record,
// sensitive exam or sensitive diagnosis reaches EMS for any reader. Whoever may read the Red flags
// note may export it, with a fresh sign-in; every page is stamped with who and when; the file and
// its name name no patient; one ems_handoff.exported event. Every person and value is made up.

const preset = (key: string) => PRESETS.find((p) => p.key === key)!.definition;
/** The released Red flags note: Show handoff is offered once EMS is activated (9.8). */
const RED_FLAGS = preset('red_flags_disposition');
const GENERAL = preset('general_primary_care');

const E1 = 'e0000001';
const E2 = 'e0000002';
const AT = '2026-10-20T14:50:00Z';

const EMS = {
  'red_flags.emergency': 'yes',
  'red_flags.ems_activated': 'yes',
  'red_flags.transport': 'yes',
  'red_flags.ems_time': '14:05',
};

const GENERAL_ANSWERS = {
  'reason.concern': 'Demo: chest pain since the morning',
  [`vitals.${E1}.entryAt`]: AT,
  [`vitals.${E1}.hr`]: 118,
  [`problems.${E1}.entryAt`]: AT,
  [`problems.${E1}.diagnosis.code`]: 'F11.20',
  [`problems.${E1}.diagnosis.label`]: 'Demo: opioid use',
  [`problems.${E2}.entryAt`]: AT,
  [`problems.${E2}.diagnosis.code`]: 'J45',
  [`problems.${E2}.diagnosis.label`]: 'Demo: asthma',
};

/** Each kind of content 6.4 hides, in a note whose recap would otherwise carry it. */
const EXAM_ANSWERS = {
  'general.notes': 'Demo: walked over from the shelter',
  'exam.findings': 'Demo: no lesions seen',
  'moud.dose': 'Demo: 8 mg',
  [`dx.${E1}.entryAt`]: AT,
  [`dx.${E1}.diagnosis.code`]: 'F11.20',
  [`dx.${E1}.diagnosis.label`]: 'Demo: opioid use',
  [`dx.${E2}.entryAt`]: AT,
  [`dx.${E2}.diagnosis.code`]: 'J02.9',
  [`dx.${E2}.diagnosis.label`]: 'Demo: sore throat',
};

const TALK = { 'talk.notes': 'Demo: talked about home' };

/**
 * What no handoff holds, for any reader: a sensitive exam, a treatment record, a sensitive diagnosis.
 * Each holds a character no ID does: the audit check looks for them in details that list note IDs,
 * and "F11" alone turned up inside a random UUID (review finding LPM-6).
 */
const NEVER = ['Demo: no lesions seen', 'Demo: 8 mg', 'F11.20', 'opioid'];

// ------------------------------------------------------------------------------------------------
// Reading a PDF back
// ------------------------------------------------------------------------------------------------

/**
 * The text a PDF draws, one string per text operator, in order. pdf-lib writes each page's content
 * as a Flate stream and each string of a standard font as WinAnsi bytes in hex.
 */
function pdfText(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const t of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out.push(winAnsi(Buffer.from(t[1]!, 'hex')));
  }
  return out;
}

/** WinAnsi is Latin-1 but for 0x80 to 0x9F, where it keeps the typographic marks the copy uses. */
const WIN_ANSI: Record<number, string> = {
  0x85: '…',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x96: '–',
  0x97: '—',
};
const winAnsi = (bytes: Buffer) => Array.from(bytes, (b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join('');

/** Each page's text, joined by spaces, so a line the PDF wrapped reads whole again. */
async function pages(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const single = await PDFDocument.create();
    const [copy] = await single.copyPages(doc, [doc.getPages().indexOf(page)]);
    single.addPage(copy!);
    out.push(pdfText(await single.save()).join(' '));
  }
  return out;
}

const rendered = (line: HandoffLine) => `${line.label}: ${line.value}`;

// ------------------------------------------------------------------------------------------------
// The route
// ------------------------------------------------------------------------------------------------

describe('phase 4: export the EMS handoff as a PDF', () => {
  let h: Harness;
  let w: World;
  let visit: Visit;
  let notes: HeldNote[];

  const exportAs = (token: string, encounterId = visit.encounterId) =>
    h.request(`/v1/encounters/${encounterId}/ems-handoff`, { token, teamId: w.t.teamId });

  async function readerOf(userId: string) {
    const [row] = await h.scratch.owner<{ permissions: string[]; credential: Credential }[]>`
      select r.permissions, m.credential from sineobex.team_memberships m join sineobex.roles r on r.id = m.role_id
      where m.team_id = ${w.t.teamId} and m.user_id = ${userId}`;
    return noteReader(new Set(row!.permissions as Permission[]), row!.credential, userId === w.rae.id);
  }

  /** The lines the handoff of the visit holds for [userId]: handoffLines over what they may see. */
  async function linesFor(userId: string) {
    const reader = await readerOf(userId);
    const seen = notes.map((n) => visibleAnswers(n.type, n.answers, reader));
    const shown = notes.filter((_, i) => seen[i] !== null);
    return {
      titles: shown.map((n) => n.type.title),
      lines: handoffLines(
        shown.map((n) => n.type),
        seen.filter((s) => s !== null),
        SENSITIVE_CODE_RANGES,
      ),
    };
  }

  async function chart(c: Clinician, v: Visit) {
    return [
      await noteOn(c, v, RED_FLAGS as ResolvedNoteType, EMS),
      await noteOn(c, v, GENERAL as ResolvedNoteType, GENERAL_ANSWERS),
      await noteOn(c, v, TEST_MEDICAL_EXAM_TYPE, EXAM_ANSWERS),
      await noteOn(c, v, TEST_SENSITIVE_TYPE, TALK),
    ];
  }

  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
    visit = await visitAt(w.rae, w.patientId, { startedAt: '2026-10-20T14:40:00Z' });
    notes = await chart(w.rae, visit);
  });
  afterAll(async () => {
    await h.close();
  });

  it('answers a PDF, never cached, under a file name that names no patient', async () => {
    const res = await exportAs(w.vic.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="ems-handoff.pdf"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBe('EMS handoff');
    // The header names the patient by preferred name (forms 10.1 #6); the metadata do not, and
    // neither the file nor its metadata holds an ID.
    const metadata = [doc.getTitle(), doc.getSubject(), doc.getKeywords(), doc.getAuthor()].join(' ');
    expect(metadata).not.toContain(w.preferredName);
    const text = pdfText(bytes).join(' ');
    for (const term of [w.patientId, visit.encounterId])
      expect(`${text} ${Buffer.from(bytes).toString('latin1')}`).not.toContain(term);
  });

  it('holds the lines of handoffLines over what the reader may see, each note under its title', async () => {
    for (const c of [w.vic, w.ana, w.rae, w.bea]) {
      const res = await exportAs(c.token);
      expect(res.status).toBe(200);
      const text = pdfText(new Uint8Array(await res.arrayBuffer())).join(' ');
      const { titles, lines } = await linesFor(c.id);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(text, rendered(line)).toContain(rendered(line));
      for (const note of new Set(lines.map((l) => l.note))) expect(text).toContain(titles[note]);
      expect(text).toContain('EMS handoff');
      expect(text).toContain('Visit started 2026-10-20 14:40 UTC');
    }
  });

  it('heads the file with the patient’s preferred name, age and allergies from their chart, never the legal name or birth date', async () => {
    // The coordinator's decision on the review (forms 10.1 #6, PLAN-OPEN for the clinical team and counsel).
    const rowan = (
      await createPatient(h, w.t.teamId, w.t.adminId, {
        preferredName: 'Demo Rowan',
        legalName: { given: 'Ysolde', family: 'Varrowick' },
        birth: { precision: 'day', date: '1970-11-02' },
      })
    ).id;
    const allergies = [
      await w.rae.phone.change({
        entity: 'patient_allergy',
        op: 'create',
        value: { patientId: rowan, substance: 'Demo: peanuts' },
      }),
      await w.rae.phone.change({
        entity: 'patient_allergy',
        op: 'create',
        value: { patientId: rowan, substance: 'Demo: latex', severity: 'severe' },
      }),
    ];
    expect((await w.rae.send(...allergies)).map((r) => r.status)).toEqual(['accepted', 'accepted']);
    const v = await visitAt(w.rae, rowan, { startedAt: '2026-10-20T14:40:00Z' });
    await noteOn(w.rae, v, RED_FLAGS as ResolvedNoteType, EMS);
    h.clock.set(new Date('2026-10-20T15:12:30Z'));
    const text = pdfText(
      new Uint8Array(await (await exportAs(w.vic.token, v.encounterId)).arrayBuffer()),
    ).join('|');
    expect(text).toContain('Demo Rowan|Age 55|Allergies: Demo: latex (severe), Demo: peanuts|Visit started');
    for (const term of ['Ysolde', 'Varrowick', '1970', '11-02', 'Nov']) expect(text).not.toContain(term);
    // A chart with no birth and no allergy asked about says so.
    const plain = pdfText(new Uint8Array(await (await exportAs(w.vic.token)).arrayBuffer())).join('|');
    expect(plain).toContain(`${w.preferredName}|Age not recorded|Allergies not asked yet|Visit started`);
  });

  it('prints its times in the time zone the portal sends, named; without one, in UTC', async () => {
    h.clock.set(new Date('2026-10-20T15:12:30Z'));
    const zoned = await h.request(
      `/v1/encounters/${visit.encounterId}/ems-handoff?timeZone=America/Detroit`,
      {
        token: w.vic.token,
        teamId: w.t.teamId,
      },
    );
    expect(zoned.status).toBe(200);
    const text = pdfText(new Uint8Array(await zoned.arrayBuffer())).join(' ');
    expect(text).toContain('Visit started 2026-10-20 10:40 America/Detroit');
    expect(text).toContain('Exported by Vic (demo) on 2026-10-20 11:12 America/Detroit');
    // A zone the runtime does not know is refused, and nothing is exported or logged.
    const mark = await auditMark(h);
    const unknown = await h.request(`/v1/encounters/${visit.encounterId}/ems-handoff?timeZone=Mars/Olympus`, {
      token: w.vic.token,
      teamId: w.t.teamId,
    });
    expect(unknown.status).toBe(422);
    expect(await eventsAfter(h, mark)).toEqual([]);
  });

  it('holds each note that holds something, drafts too, marked with its state', async () => {
    const text = pdfText(new Uint8Array(await (await exportAs(w.vic.token)).arrayBuffer())).join(' ');
    for (const n of notes) expect(text, n.type.title).toContain(`${n.type.title} (draft)`);
  });

  it('leaves out a note the reader may not see: a sensitive note type without patients.view_sensitive', async () => {
    const shown = async (c: { token: string }) =>
      pdfText(new Uint8Array(await (await exportAs(c.token)).arrayBuffer())).join(' ');
    expect(await shown(w.ana)).toContain('Demo: talked about home');
    expect(await shown(w.bea)).not.toContain('Demo: talked about home');
    expect(await shown(w.bea)).toContain('Demo: chest pain since the morning');
  });

  // Each note goes through visibleAnswers before handoffLines reads it (handoff.ts). No test here
  // bites if that step is taken out (review finding LPM-7, M40): with today's definitions, what a
  // reader's keys hide is a treatment record, a sensitive exam or a sensitive diagnosis with its
  // entry, and handoffLines leaves each of those out for every reader (D82, forms 10.1 #6). The step
  // stays, for a definition whose hidden content EMS could otherwise be sent.
  it('holds no sensitive exam, treatment record or sensitive diagnosis, for any reader, the author included', async () => {
    for (const c of [w.rae, w.vic, w.ana, w.bea]) {
      const text = pdfText(new Uint8Array(await (await exportAs(c.token)).arrayBuffer())).join(' ');
      for (const term of NEVER) expect(text, `${c.id}: ${term}`).not.toContain(term);
      // What is left of those notes is there: the exam note's other sections, the other diagnoses.
      expect(text).toContain('Demo: walked over from the shelter');
      expect(text).toContain('Demo: sore throat (J02.9)');
      expect(text).toContain('Demo: asthma (J45)');
    }
  });

  it('stamps every page with who exported it and when', async () => {
    h.clock.set(new Date('2026-10-20T15:12:30Z'));
    const res = await exportAs(await h.tokenFor('ana@example.com'));
    const all = await pages(new Uint8Array(await res.arrayBuffer()));
    expect(all.length).toBeGreaterThan(0);
    all.forEach((page, i) => {
      expect(page).toContain('Exported by Ana (demo) on 2026-10-20 15:12 UTC');
      expect(page).toContain(`Page ${i + 1} of ${all.length}`);
    });
  });

  it('looks in the audit for no term a random ID could hold', () => {
    for (const term of NEVER) expect(term, term).not.toMatch(/^[0-9a-f-]+$/i);
  });

  it('logs one ems_handoff.exported on the visit, with its patient and the notes read, and no answer', async () => {
    const mark = await auditMark(h);
    expect((await exportAs(w.bea.token)).status).toBe(200);
    const [event] = await expectAudit(h, 'ems_handoff.exported', {
      after: mark,
      patientId: w.patientId,
      count: 1,
    });
    expect(event).toMatchObject({ actorUserId: w.bea.id, entity: 'encounter', entityId: visit.encounterId });
    // The sensitive note type is not read for Billing/Data, so it is not named.
    expect(event!.details).toEqual({
      noteIds: notes.filter((n) => n.type !== TEST_SENSITIVE_TYPE).map((n) => n.noteId),
      source: 'portal',
    });
    expect((await eventsAfter(h, mark)).map((e) => e.action)).toEqual(['ems_handoff.exported']);
    await expectAuditClean(h, [...NEVER, ...Object.values(TALK), 'Demo: chest pain', w.preferredName], mark);
  });

  it('names no empty draft among the notes it read: it counts as not there', async () => {
    // Review finding LPM-7 (M36).
    const v = await visitAt(w.rae, w.patientId);
    const flags = await noteOn(w.rae, v, RED_FLAGS as ResolvedNoteType, EMS);
    await noteOn(w.rae, v, TEST_NOTE_TYPE, { 'care.plan': '' });
    const mark = await auditMark(h);
    expect((await exportAs(w.vic.token, v.encounterId)).status).toBe(200);
    const [event] = await expectAudit(h, 'ems_handoff.exported', { after: mark, count: 1 });
    expect(event!.details.noteIds).toEqual([flags.noteId]);
  });

  it('needs patients.view: a role without it is refused, and the refusal is logged', async () => {
    const mark = await auditMark(h);
    const res = await exportAs(w.eli.token);
    expect(res.status).toBe(403);
    const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
    expect(denied!.details).toMatchObject({ permission: 'patients.view' });
    expect((await eventsAfter(h, mark)).map((e) => e.action)).toEqual(['access.denied']);
  });

  it('needs the Red flags note: a reader of no Medical note is refused, and the refusal is logged', async () => {
    const mark = await auditMark(h);
    const res = await exportAs(w.kim.token);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('cannot_see_red_flags');
    const [denied] = await expectAudit(h, 'access.denied', { after: mark, patientId: w.patientId, count: 1 });
    expect(denied).toMatchObject({ entity: 'encounter', entityId: visit.encounterId });
    expect(denied!.details).toEqual({
      reason: 'cannot_see_red_flags',
      route: '/v1/encounters/:encounterId/ems-handoff',
    });
    expect((await eventsAfter(h, mark)).map((e) => e.action)).toEqual(['access.denied']);
  });

  it('needs a recent sign-in, and exports nothing without one', async () => {
    const mark = await auditMark(h);
    const res = await exportAs(await staleToken(h, 'vic@example.com'));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('reauth_required');
    await expectAudit(h, 'ems_handoff.exported', { after: mark, count: 0 });
  });

  it('a visit with no handoff is 404: EMS not activated, or no Red flags note at all', async () => {
    const quiet = await visitAt(w.rae, w.patientId);
    await noteOn(w.rae, quiet, RED_FLAGS as ResolvedNoteType, { 'red_flags.emergency': 'no' });
    const plain = await visitAt(w.rae, w.patientId, { kind: 'non_medical' });
    await noteOn(w.rae, plain, TEST_NOTE_TYPE, { 'care.plan': 'Demo: socks and water' });
    const mark = await auditMark(h);
    for (const v of [quiet, plain]) {
      const res = await exportAs(w.vic.token, v.encounterId);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('no_handoff');
    }
    expect(await eventsAfter(h, mark)).toEqual([]);
  });

  it('a visit the team does not have is 404, and an ID that is not a UUID is 422', async () => {
    const mark = await auditMark(h);
    const missing = await exportAs(w.vic.token, '7d3f0c1e-5a2b-4c8d-9e6f-0a1b2c3d4e5f');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('not_found');
    expect((await exportAs(w.vic.token, 'not-a-visit')).status).toBe(422);
    expect(await eventsAfter(h, mark)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
// The file itself
// ------------------------------------------------------------------------------------------------

describe('phase 4: the EMS handoff PDF', () => {
  const input = (lines: HandoffLine[], titles = ['Demo: Red flags']): HandoffPdfInput => ({
    patient: null,
    notes: titles.map((title) => ({ title, state: 'signed' as const })),
    lines,
    startedAt: '2026-10-20T14:40:00.000Z',
    clockVerified: true,
    exportedBy: 'Ana (demo)',
    exportedAt: new Date('2026-10-20T15:12:30Z'),
    timeZone: null,
  });
  const field = (label: string, value: string, note = 0): HandoffLine => ({
    kind: 'field',
    note,
    section: 's',
    label,
    value,
  });

  it('heads the file with the patient, or says there is none', async () => {
    const patient = { preferredName: 'Demo Rowan', age: 'Age about 46', allergies: 'No known allergies' };
    const text = pdfText(await handoffPdf({ ...input([field('Demo', 'x')]), patient })).join('|');
    expect(text).toContain('EMS handoff|Demo Rowan|Age about 46|No known allergies|Visit started');
    const none = pdfText(await handoffPdf(input([field('Demo', 'x')]))).join('|');
    expect(none).toContain('EMS handoff|No patient recorded for this visit|Visit started');
  });

  it('marks each note with its state', async () => {
    const lines = [field('a', '1', 0), field('b', '2', 1), field('c', '3', 2), field('d', '4', 3)];
    const states = ['draft', 'complete', 'signed', 'attested'] as const;
    const text = pdfText(
      await handoffPdf({
        ...input(lines),
        notes: states.map((state, i) => ({ title: `Demo: Note ${i + 1}`, state })),
      }),
    ).join('|');
    expect(text).toContain('Demo: Note 1 (draft)|a: 1');
    expect(text).toContain('Demo: Note 2 (complete)|b: 2');
    expect(text).toContain('Demo: Note 3 (signed)|c: 3');
    expect(text).toContain('Demo: Note 4 (signed and attested)|d: 4');
  });

  it('prints its times in the reader’s time zone, named, and in UTC without one', async () => {
    const zoned = pdfText(
      await handoffPdf({ ...input([field('Demo', 'x')]), timeZone: 'America/Detroit' }),
    ).join(' ');
    expect(zoned).toContain('Visit started 2026-10-20 10:40 America/Detroit');
    expect(zoned).toContain('Exported by Ana (demo) on 2026-10-20 11:12 America/Detroit');
    const utc = pdfText(await handoffPdf(input([field('Demo', 'x')]))).join(' ');
    expect(utc).toContain('Visit started 2026-10-20 14:40 UTC');
    expect(utc).toContain('Exported by Ana (demo) on 2026-10-20 15:12 UTC');
  });

  it('runs on to more pages, each stamped, and loses no line', async () => {
    const lines = Array.from({ length: 150 }, (_, i) => field(`Demo item ${i + 1}`, `value ${i + 1}`));
    const all = await pages(await handoffPdf(input(lines)));
    expect(all.length).toBeGreaterThan(1);
    all.forEach((page, i) => {
      expect(page).toContain('Exported by Ana (demo) on 2026-10-20 15:12 UTC');
      expect(page).toContain(`Page ${i + 1} of ${all.length}`);
    });
    const text = all.join(' ');
    for (const line of lines) expect(text).toContain(rendered(line));
  });

  it('wraps a long answer and keeps every word of it', async () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const bytes = await handoffPdf(input([field('Demo: concern', long)]));
    expect(pdfText(bytes).length).toBeGreaterThan(5);
    expect(pdfText(bytes).join(' ')).toContain(`Demo: concern: ${long}`);
  });

  it('draws a character its font has no glyph for as a question mark, and keeps curly apostrophes', async () => {
    const bytes = await handoffPdf(input([field('Demo: name', 'Zoë’s note 日本 ok\nnext line')]));
    const text = pdfText(bytes).join(' ');
    expect(text).toContain('Demo: name: Zoë’s note ?? ok');
    expect(text).toContain('next line');
  });

  it('says when the visit’s start time is the phone’s, not verified', async () => {
    const bytes = await handoffPdf({ ...input([field('Demo', 'x')]), clockVerified: false });
    expect(pdfText(bytes).join(' ')).toContain(
      'Visit started 2026-10-20 14:40 UTC (phone clock, not verified)',
    );
  });

  it('heads the recap with each note’s title after the field lines', async () => {
    const lines: HandoffLine[] = [
      field('Demo: pulse', '118 bpm', 0),
      { kind: 'recap', note: 1, section: 'plan', label: 'Demo: Plan', value: 'Demo: rest' },
    ];
    const text = pdfText(await handoffPdf(input(lines, ['Demo: First', 'Demo: Second']))).join('|');
    expect(text.indexOf('Demo: First')).toBeLessThan(text.indexOf('Demo: pulse: 118 bpm'));
    expect(text.indexOf('Demo: pulse: 118 bpm')).toBeLessThan(text.indexOf('Demo: Second'));
    expect(text.indexOf('Demo: Second')).toBeLessThan(text.indexOf('Demo: Plan: Demo: rest'));
  });
});
