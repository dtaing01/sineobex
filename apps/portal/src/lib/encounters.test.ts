import type { Schemas } from '@sineobex/contract';
import { describe, expect, it } from 'vitest';
import {
  ENCOUNTER_KIND,
  heldBecauseText,
  madeAtRows,
  noteState,
  noteTrail,
  referralRows,
  replacedBy,
  startedText,
  visitRow,
} from './encounters';

// What the visit page and the patient page's timeline say of a visit (phase 4 design, lifecycle
// 3.1, 3.5, 9.7, 9.11). Every name and value is made up.

type Note = Schemas['VisitNote'];

const casey = { userId: 'a0000000-0000-4000-8000-000000000001', displayName: 'Casey Nguyen (demo)' };
const jordan = { userId: 'a0000000-0000-4000-8000-000000000002', displayName: 'Jordan Lee (demo)' };

function note(over: Partial<Note> = {}): Note {
  return {
    noteId: 'b0000000-0000-4000-8000-000000000001',
    noteTypeKey: 'wound_care',
    noteTypeVersion: 1,
    title: 'Wound care',
    group: 'wound',
    medical: true,
    status: 'signed',
    attestation: 'not_needed',
    completedAt: '2026-10-20T16:25:00Z',
    author: casey,
    actingAuthor: casey,
    canCosign: false,
    canAttest: false,
    read: { sections: [] },
    recap: [],
    signoffs: [],
    addenda: [],
    corrections: [],
    attestations: [],
    ...over,
  };
}

describe('a note’s state', () => {
  it('is worded as lifecycle 3.1’s first column', () => {
    const state = (status: Note['status'], attestation: Note['attestation'], medical: boolean) =>
      noteState({ status, attestation, medical });
    expect(state('draft', 'not_needed', true)).toBe('Draft');
    expect(state('draft', 'not_needed', false)).toBe('Draft');
    expect(state('completed', 'not_needed', false)).toBe('Complete');
    expect(state('completed', 'not_needed', true)).toBe('Waiting for a co-signer');
    expect(state('signed', 'not_needed', true)).toBe('Signed');
    expect(state('signed', 'waiting', true)).toBe('Signed, waiting for attestation');
    expect(state('signed', 'attested', true)).toBe('Signed and attested');
  });

  it('names the kind of a visit', () => {
    expect(ENCOUNTER_KIND.medical).toBe('Medical');
    expect(ENCOUNTER_KIND.non_medical).toBe('Non-Medical');
  });
});

describe('why a waiting note waits for someone else', () => {
  it('says nothing when the API gives no reason', () => {
    expect(heldBecauseText(note({ status: 'completed' }))).toBeNull();
  });

  it('never tells an assignee they wrote the note', () => {
    const assigned = heldBecauseText(note({ status: 'completed', heldBecause: 'acts_as_author' }));
    expect(assigned).toBe('This note was assigned to you, so someone else has to co-sign it.');
    expect(assigned).not.toMatch(/wrote/);
  });

  it('words each reason for the act the note waits for', () => {
    const waiting = { status: 'signed', attestation: 'waiting' } as const;
    expect(heldBecauseText(note({ status: 'completed', heldBecause: 'wrote' }))).toBe(
      'You wrote this note, so someone else has to co-sign it.',
    );
    expect(heldBecauseText(note({ ...waiting, heldBecause: 'wrote' }))).toBe(
      'You wrote this note, so someone else has to attest it.',
    );
    expect(heldBecauseText(note({ status: 'completed', heldBecause: 'completed' }))).toBe(
      'You completed this note, so someone else has to co-sign it.',
    );
    expect(heldBecauseText(note({ ...waiting, heldBecause: 'signed' }))).toBe(
      'You signed this note, so someone else has to attest it.',
    );
    // The sentence lifecycle 9.7 gives, as written.
    expect(heldBecauseText(note({ ...waiting, heldBecause: 'cannot_see_all' }))).toBe(
      'This note has a part you can’t open. Ask a Program Admin.',
    );
  });
});

describe('when a visit started', () => {
  it('says so when the phone’s clock was not checked', () => {
    expect(startedText('2026-10-20T16:00:00Z', true)).toBe('Oct 20, 2026, 12:00 PM');
    expect(startedText('2026-10-20T16:00:00Z', false)).toBe('Oct 20, 2026, 12:00 PM, time not verified');
  });
});

describe('the trail under a note', () => {
  const signoff = (over: Partial<Schemas['SignoffView']>): Schemas['SignoffView'] => ({
    id: 'c0000000-0000-4000-8000-000000000001',
    act: 'sign',
    effect: 'signed',
    signer: casey,
    credential: 'resident',
    claimedCredential: null,
    needsAttestation: true,
    statementVersion: 'sign-2026-11',
    signedAt: '2026-10-20T16:25:00Z',
    clockVerified: true,
    ...over,
  });

  it('lists sign-offs, attestations, corrections and addenda in time order, in lifecycle 9.7’s words', () => {
    const trail = noteTrail(
      note({
        signoffs: [signoff({})],
        attestations: [
          {
            id: 'c0000000-0000-4000-8000-000000000002',
            signoffId: 'c0000000-0000-4000-8000-000000000001',
            attending: jordan,
            attestedAt: '2026-10-21T15:00:00Z',
            statementVersion: 'attest-2026-11',
          },
        ],
        addenda: [
          {
            id: 'c0000000-0000-4000-8000-000000000003',
            noteId: 'b0000000-0000-4000-8000-000000000001',
            author: jordan,
            credential: 'attending',
            text: 'Demo: called the shelter after the visit.',
            writtenAt: '2026-10-20T20:00:00Z',
            clockVerified: false,
          },
        ],
        corrections: [
          {
            id: 'c0000000-0000-4000-8000-000000000004',
            outcome: 'corrected',
            fields: ['data.wound.ewound01.measurements.length'],
            requestedByPatient: false,
            reason: 'Demo: measured again along the long edge',
            corrector: casey,
            credential: 'resident',
            correctedAt: '2026-10-22T12:00:00Z',
            clockVerified: true,
          },
        ],
      }),
    );
    expect(trail.map((e) => e.text)).toEqual([
      'Signed by Casey Nguyen (demo), Resident, Oct 20, 2026, 12:25 PM',
      'Addendum by Jordan Lee (demo), Attending physician, Oct 20, 2026, 4:00 PM, time not verified',
      'Attested by Jordan Lee (demo), Oct 21, 2026, 11:00 AM',
      'Corrected by Casey Nguyen (demo), Resident, Oct 22, 2026, 8:00 AM',
    ]);
    expect(trail[1]!.body).toBe('Demo: called the shelter after the visit.');
    expect(trail[3]!.reason).toBe('Demo: measured again along the long edge');
  });

  it('words a co-signature, a completion and a signature saved unsigned', () => {
    const lines = noteTrail(
      note({
        signoffs: [
          signoff({ id: 'c1', act: 'complete', effect: 'completed', credential: 'student' }),
          signoff({
            id: 'c2',
            act: 'cosign',
            signer: jordan,
            credential: 'attending',
            signedAt: '2026-10-20T17:00:00Z',
          }),
          signoff({
            id: 'c3',
            effect: 'saved_unsigned',
            credential: 'student',
            signedAt: '2026-10-20T18:00:00Z',
          }),
          signoff({ id: 'c4', effect: 'none', signedAt: '2026-10-20T19:00:00Z' }),
        ],
      }),
    ).map((e) => e.text);
    expect(lines).toEqual([
      'Completed by Casey Nguyen (demo), Student or volunteer, Oct 20, 2026, 12:25 PM',
      'Co-signed by Jordan Lee (demo), Attending physician, Oct 20, 2026, 1:00 PM',
      'Saved unsigned for a co-signer by Casey Nguyen (demo), Student or volunteer, Oct 20, 2026, 2:00 PM',
      'Sent again by Casey Nguyen (demo), Oct 20, 2026, 3:00 PM. It changed nothing.',
    ]);
  });

  it('leaves out a credential that is no clinical credential, and words each kind of correction', () => {
    const correction = (
      id: string,
      outcome: Schemas['CorrectionView']['outcome'],
      requestedByPatient = false,
    ): Schemas['CorrectionView'] => ({
      id,
      outcome,
      fields: ['data.outreach.notes'],
      requestedByPatient,
      reason: 'Demo: a reason',
      corrector: jordan,
      credential: 'none',
      correctedAt: `2026-10-23T1${id}:00:00Z`,
      clockVerified: true,
    });
    const lines = noteTrail(
      note({
        medical: false,
        status: 'completed',
        signoffs: [signoff({ act: 'complete', effect: 'completed', credential: 'none' })],
        corrections: [
          correction('1', 'corrected', true),
          correction('2', 'declined', true),
          correction('3', 'no_change'),
          correction('4', 'draft_edit'),
          correction('5', 'not_author'),
        ],
      }),
    ).map((e) => e.text);
    expect(lines).toEqual([
      'Completed by Casey Nguyen (demo), Oct 20, 2026, 12:25 PM',
      'Corrected at the patient’s request by Jordan Lee (demo), Oct 23, 2026, 7:00 AM',
      'Amendment request declined by Jordan Lee (demo), Oct 23, 2026, 8:00 AM. The note is unchanged.',
      'Correction by Jordan Lee (demo), Oct 23, 2026, 9:00 AM. The note already held those values.',
      'Changed by Jordan Lee (demo), Oct 23, 2026, 10:00 AM, while the note was a draft again',
      'Correction sent by Jordan Lee (demo), Oct 23, 2026, 11:00 AM. Not applied: they don’t act as the note’s author.',
    ]);
  });

  it('keeps entries at the same moment in a fixed order', () => {
    const at = '2026-10-20T16:25:00Z';
    const trail = noteTrail(
      note({ signoffs: [signoff({ id: 'z', signedAt: at }), signoff({ id: 'a', signedAt: at })] }),
    );
    expect(trail.map((e) => e.id)).toEqual(['a', 'z']);
  });
});

describe('a corrected answer', () => {
  it('names who replaced it, under which credential, when, and why', () => {
    expect(
      replacedBy({
        path: 'wound.ewound01.measurements.length',
        old: '3 cm',
        by: 'Jordan Lee (demo)',
        credential: 'attending',
        at: '2026-10-25T16:00:00.000Z',
        reason: 'Demo: measured again along the long edge',
      }),
    ).toBe('Changed by Jordan Lee (demo), Attending physician, Oct 25, 2026, 12:00 PM');
  });

  it('leaves out a credential it doesn’t know, and shows a time it can’t read as it came', () => {
    expect(
      replacedBy({
        path: 'a',
        old: null,
        by: 'Jordan Lee (demo)',
        credential: 'none',
        at: 'soon',
        reason: 'r',
      }),
    ).toBe('Changed by Jordan Lee (demo), soon');
  });
});

describe('a visit on the timeline', () => {
  it('carries its time, kind and each note’s title and state from the API, nothing more', () => {
    expect(
      visitRow({
        encounterId: 'd0000000-0000-4000-8000-000000000001',
        startedAt: '2026-10-20T16:00:00Z',
        kind: 'medical',
        status: 'signed',
        notes: [
          {
            noteId: 'b0000000-0000-4000-8000-000000000001',
            noteTypeKey: 'red_flags_disposition',
            title: 'Red flags and disposition',
            medical: true,
            group: 'clinical',
            status: 'signed',
            attestation: 'attested',
          },
          {
            noteId: 'b0000000-0000-4000-8000-000000000002',
            noteTypeKey: 'social_needs',
            title: '',
            medical: false,
            group: 'social',
            status: 'completed',
            attestation: 'not_needed',
          },
        ],
      }),
    ).toEqual({
      encounterId: 'd0000000-0000-4000-8000-000000000001',
      when: 'Oct 20, 2026, 12:00 PM',
      kind: 'Medical',
      notes: [
        {
          noteId: 'b0000000-0000-4000-8000-000000000001',
          title: 'Red flags and disposition',
          state: 'Signed and attested',
        },
        // A copy from before titles were sent has none: it reads as a note, never as its key.
        { noteId: 'b0000000-0000-4000-8000-000000000002', title: 'Note', state: 'Complete' },
      ],
    });
  });
});

describe('a referral on the timeline', () => {
  const referral = (
    id: string,
    attributes: Record<string, unknown>,
    over: Partial<Schemas['RecordSnapshot']> = {},
  ) =>
    ({
      entity: 'referral',
      id,
      authorUserId: casey.userId,
      createdAt: '2026-10-20T16:00:00Z',
      updatedAt: '2026-10-20T16:00:00Z',
      status: 'active',
      version: 1,
      fields: {},
      attributes: {
        patientId: 'e0000000-0000-4000-8000-000000000001',
        details: 'Demo: dental van',
        encounterId: null,
        clockVerified: true,
        authorName: 'Robin Patel (demo)',
        ...attributes,
      },
      ...over,
    }) as Schemas['RecordSnapshot'];

  it('lists newest first by its date, then by when it was recorded, naming who recorded it', () => {
    const rows = referralRows([
      referral('r1', { referredOn: '2026-10-01', recordedAt: '2026-10-01T15:00:00Z' }),
      referral('r2', { referredOn: '2026-10-03', recordedAt: '2026-10-03T15:00:00Z', encounterId: 'v1' }),
      referral('r3', { referredOn: '2026-10-01', recordedAt: '2026-10-02T15:00:00Z' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
    expect(rows[0]).toEqual({
      id: 'r2',
      referredOn: 'Oct 3, 2026',
      details: 'Demo: dental van',
      recordedBy: 'Robin Patel (demo)',
      encounterId: 'v1',
      enteredInError: null,
    });
  });

  it('keeps one entered in error, with its reason', () => {
    const [row] = referralRows([
      referral(
        'r1',
        { referredOn: '2026-10-01', recordedAt: '2026-10-01T15:00:00Z' },
        {
          status: 'entered_in_error',
          fields: {
            enteredInError: { value: { reason: 'Demo: wrong patient' }, version: 2 },
          } as unknown as Schemas['RecordSnapshot']['fields'],
        },
      ),
    ]);
    expect(row!.enteredInError).toBe('Demo: wrong patient');
  });
});

describe('the records made at a visit', () => {
  const VISIT_PATIENT = 'e0000000-0000-4000-8000-000000000001';
  const record = (
    entity: Schemas['RecordSnapshot']['entity'],
    id: string,
    attributes: Record<string, unknown>,
    over: Partial<Schemas['RecordSnapshot']> = {},
  ) =>
    ({
      entity,
      id,
      authorUserId: casey.userId,
      createdAt: '2026-10-20T16:00:00Z',
      updatedAt: '2026-10-20T16:00:00Z',
      status: 'active',
      version: 1,
      fields: {},
      attributes: { patientId: VISIT_PATIENT, ...attributes },
      ...over,
    }) as Schemas['RecordSnapshot'];

  it('lists referrals, problems, allergies and problems’ notes, in that order, each saying what it is', () => {
    const rows = madeAtRows(
      [
        record('problem_note', 'n1', { text: 'Demo: cushion checked' }),
        record('patient_allergy', 'a1', { substance: 'Demo: latex' }),
        record('problem', 'p1', { title: 'Pressure ulcer', code: { system: 'icd10', code: 'L89.152' } }),
        record('referral', 'r1', { referredOn: '2026-10-24', details: 'Demo: wound clinic' }),
        record('problem', 'p2', { title: 'Demo: sore heel', code: null }),
      ],
      [],
    );
    expect(rows.map((r) => r.text)).toEqual([
      'Referral, Oct 24, 2026: Demo: wound clinic',
      'Problem: Pressure ulcer (L89.152)',
      'Problem: Demo: sore heel',
      'Allergy: Demo: latex',
      'Note on a problem: Demo: cushion checked',
    ]);
    expect(rows.every((r) => !r.elsewhere && !r.enteredInError)).toBe(true);
  });

  it('says when a record is on another chart now, as the API says, and when it was entered in error', () => {
    const [moved, wrong] = madeAtRows(
      [
        record('referral', 'r1', {
          referredOn: '2026-10-24',
          details: 'Demo: wound clinic',
          patientId: 'e0000000-0000-4000-8000-000000000002',
        }),
        record('patient_allergy', 'a1', { substance: 'Demo: latex' }, { status: 'entered_in_error' }),
      ],
      ['r1'],
    );
    expect(moved).toMatchObject({ elsewhere: true, patientId: 'e0000000-0000-4000-8000-000000000002' });
    expect(wrong).toMatchObject({ elsewhere: false, enteredInError: true });
  });

  it('takes the API’s word for the chart: a record under a merged ID of the visit’s patient is on its chart', () => {
    // The review of unit L6: comparing patient IDs here called such a record "on another chart".
    const [kept] = madeAtRows(
      [
        record('referral', 'r1', {
          referredOn: '2026-10-24',
          details: 'Demo: wound clinic',
          patientId: 'e0000000-0000-4000-8000-000000000003',
        }),
      ],
      [],
    );
    expect(kept).toMatchObject({ elsewhere: false, patientId: 'e0000000-0000-4000-8000-000000000003' });
  });
});
