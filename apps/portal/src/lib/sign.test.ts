import type { Schemas } from '@sineobex/contract';
import { describe, expect, it } from 'vitest';
import { samePlan, signAnswer, signedState, signPlan, signRequest, SIGN_ACTS, visitAfter } from './sign';

// Co-sign and Attest on the visit page (lifecycle 3.5, 5.3, 5.4, 9.11).
const VISIT = '5eed2000-0000-4000-8000-000000000001';
const id = (n: number) => `5eed2100-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (c: string) => c.repeat(64);

function note(n: number, over: Partial<Schemas['VisitNote']> = {}) {
  return {
    noteId: id(n),
    title: `Note ${n}`,
    canCosign: false,
    canAttest: false,
    contentHash: hash(String(n % 10)),
    ...over,
  } as Schemas['VisitNote'];
}

describe('the plan a press sends', () => {
  it('holds exactly the notes the visit read marks for the act, each with the hash that read gave', () => {
    const notes = [
      note(1, { canCosign: true }),
      note(2),
      note(3, { canAttest: true }),
      note(4, { canCosign: true, title: '' }),
    ];
    expect(signPlan(notes, 'cosign')).toEqual({
      notes: [
        { noteId: id(1), contentHash: hash('1') },
        { noteId: id(4), contentHash: hash('4') },
      ],
      titles: ['Note 1', 'Note'],
    });
    expect(signPlan(notes, 'attest')).toEqual({
      notes: [{ noteId: id(3), contentHash: hash('3') }],
      titles: ['Note 3'],
    });
  });

  it('offers nothing when no note is marked', () => {
    expect(signPlan([note(1), note(2, { canAttest: true })], 'cosign')).toBeNull();
    expect(signPlan([], 'attest')).toBeNull();
  });

  it('offers nothing when a marked note came without its hash: the API would refuse a plan without it', () => {
    expect(
      signPlan(
        [note(1, { canCosign: true }), note(2, { canCosign: true, contentHash: undefined })],
        'cosign',
      ),
    ).toBeNull();
  });

  it('is the same plan only with the same notes, in the same order, with the same hashes', () => {
    const a = [
      { noteId: id(1), contentHash: hash('a') },
      { noteId: id(2), contentHash: hash('b') },
    ];
    expect(
      samePlan(
        a,
        a.map((n) => ({ ...n })),
      ),
    ).toBe(true);
    expect(samePlan(a, [a[0]!, { noteId: id(2), contentHash: hash('c') }])).toBe(false);
    expect(samePlan(a, [a[1]!, a[0]!])).toBe(false);
    expect(samePlan(a, [a[0]!])).toBe(false);
    expect(samePlan(a, [...a, { noteId: id(3), contentHash: hash('d') }])).toBe(false);
  });
});

describe('what the route handler takes', () => {
  const plan = [{ noteId: id(1), contentHash: hash('a') }];

  it('takes an act and one to 50 notes, each named once, each with a hash', () => {
    expect(signRequest({ act: 'cosign', notes: plan })).toEqual({ act: 'cosign', notes: plan });
    expect(signRequest({ act: 'attest', notes: plan })).toEqual({ act: 'attest', notes: plan });
    const fifty = Array.from({ length: 50 }, (_, i) => ({ noteId: id(i), contentHash: hash('a') }));
    expect(signRequest({ act: 'cosign', notes: fifty })?.notes).toHaveLength(50);
  });

  it('refuses anything else', () => {
    for (const body of [
      null,
      'cosign',
      { act: 'sign', notes: plan },
      { act: 'toString', notes: plan },
      { act: 'cosign', notes: [] },
      { act: 'cosign', notes: [...plan, ...plan] },
      { act: 'cosign', notes: [{ noteId: 'not-an-id', contentHash: hash('a') }] },
      { act: 'cosign', notes: [{ noteId: id(1), contentHash: 'ABC' }] },
      { act: 'cosign', notes: [{ noteId: id(1), contentHash: hash('A') }] },
      { act: 'cosign', notes: [{ noteId: id(1) }] },
      {
        act: 'cosign',
        notes: Array.from({ length: 51 }, (_, i) => ({ noteId: id(i), contentHash: hash('a') })),
      },
    ])
      expect(signRequest(body), JSON.stringify(body)).toBeNull();
  });

  it('keeps nothing it was not asked to send', () => {
    expect(
      signRequest({ act: 'cosign', notes: [{ ...plan[0], extra: 'x' }], statementVersion: 'mine' }),
    ).toEqual({ act: 'cosign', notes: plan });
  });
});

describe('where an answer sends the person', () => {
  it('loads the visit again after the act, saying it was done', () => {
    expect(signAnswer(VISIT, 'cosign', 200, '')).toEqual({ go: `/encounters/${VISIT}?signed=cosigned` });
    expect(signAnswer(VISIT, 'attest', 200, '')).toEqual({ go: `/encounters/${VISIT}?signed=attested` });
  });

  it('loads the visit again when it changed since it was read', () => {
    for (const code of ['content_changed', 'not_waiting'])
      expect(signAnswer(VISIT, 'cosign', 409, code)).toEqual({ go: `/encounters/${VISIT}?signed=changed` });
    // Since the read, a note became theirs, or a part of one hidden from them: the page says why.
    for (const code of ['is_author', 'is_signer', 'cannot_see_all'])
      expect(signAnswer(VISIT, 'attest', 403, code)).toEqual({ go: `/encounters/${VISIT}?signed=changed` });
  });

  it('says so when the person’s credential no longer does the act', () => {
    expect(signAnswer(VISIT, 'cosign', 403, 'cannot_sign')).toEqual({
      go: `/encounters/${VISIT}?signed=cannot_sign`,
    });
    expect(signAnswer(VISIT, 'attest', 403, 'cannot_attest')).toEqual({
      go: `/encounters/${VISIT}?signed=cannot_attest`,
    });
  });

  it('signs in again, or leaves a screen the role can’t use, as every page does', () => {
    expect(signAnswer(VISIT, 'cosign', 401, 'unauthorized')).toEqual({ go: '/sign-in?ended=expired' });
    expect(signAnswer(VISIT, 'cosign', 403, 'forbidden')).toEqual({ go: '/home?denied=1' });
    expect(signAnswer(VISIT, 'cosign', 403, 'not_a_member')).toEqual({
      go: '/select-team?problem=not_a_member',
    });
  });

  it('sends a visit the team no longer has to its page, which says so', () => {
    expect(signAnswer(VISIT, 'cosign', 404, 'not_found')).toEqual({ go: `/encounters/${VISIT}` });
  });

  it('keeps the page, with a sentence, for a request the API couldn’t take or a failure', () => {
    expect(signAnswer(VISIT, 'cosign', 422, 'validation_failed')).toEqual({
      problem: 'Something about this request was wrong. Load the visit again.',
    });
    expect(signAnswer(VISIT, 'attest', 500, 'error')).toEqual({
      problem: 'Something went wrong. Try again.',
    });
  });
});

describe('what the visit page says when it is loaded again', () => {
  it('says the visit changed in the design’s words', () => {
    expect(signedState('changed')).toBe('changed');
    expect(visitAfter(VISIT, 'changed')).toBe(`/encounters/${VISIT}?signed=changed`);
  });

  it('shows only the states it knows', () => {
    for (const s of ['cosigned', 'attested', 'changed', 'cannot_sign', 'cannot_attest'])
      expect(signedState(s)).toBe(s);
    expect(signedState('toString')).toBeNull();
    expect(signedState(['changed'])).toBeNull();
    expect(signedState(undefined)).toBeNull();
  });
});

describe('the sentences a second person is shown', () => {
  it('are lifecycle 3.5’s, with their versions', () => {
    expect(SIGN_ACTS.cosign).toMatchObject({
      statement: 'I reviewed this note and agree with it.',
      statementVersion: 'cosign-2026-11',
    });
    expect(SIGN_ACTS.attest).toMatchObject({
      statement: 'I reviewed this note and agree with the assessment and plan.',
      statementVersion: 'attest-2026-11',
    });
  });
});

describe('what the section says a press does', () => {
  it('names how many notes it covers', () => {
    expect(SIGN_ACTS.cosign.lead(1)).toBe('Co-sign signs this note with your name and credential:');
    expect(SIGN_ACTS.cosign.lead(2)).toBe('Co-sign signs these 2 notes with your name and credential:');
    expect(SIGN_ACTS.attest.lead(1)).toBe(
      'Attest adds your dated attestation below this note, and changes nothing in it:',
    );
    expect(SIGN_ACTS.attest.lead(3)).toBe(
      'Attest adds your dated attestation below these 3 notes, and changes nothing in them:',
    );
  });
});
