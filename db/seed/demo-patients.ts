import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TransactionSql } from 'postgres';

/**
 * Made-up patients for the demo team (phase 3 design 15, S0; 14.1 #30). Every person, name, birth
 * date and place here is invented. Names are realistic on purpose (a shared "(demo)" token would
 * distort every match score); descriptions, usual areas and free text start with "Demo:" instead,
 * and nobody has a phone number. The done-when's patient P1 comes from
 * packages/contract/test-vectors/done-when.json, so the seed, the phone's fake server and the
 * tests agree on it.
 *
 * What is here, for demos and the end-to-end tests: P1 (Del, street name Smitty), near-duplicates
 * nobody flagged, a pair the server flagged and nobody decided, a Not sure pair with its note, a
 * Keep separate pair, a merge whose two records both kept their ID cards (D39), problems in every
 * status (with a sensitive one, a recurrence, a "Resolved by mistake" request and one entered in
 * error), an open field review, and a similar name in a second team.
 */

export const NEIGHBOUR_TEAM_ID = '0d3e6f00-0000-4000-8000-000000000002';

const pad = (n: number, width: number) => String(n).padStart(width, '0');
/** Seeded IDs are fixed, so the seed is idempotent and tests can name what they need. */
export const demoId = (kind: string, n: number, k = 0) =>
  `5eed${kind}${pad(k, 2)}-0000-4000-8000-${pad(n, 12)}`;
export const demoPatientId = (n: number) => demoId('00', n);

type Birth = { precision: 'day'; date: string } | { precision: 'year' | 'estimated'; year: number };

interface DemoPatient {
  n: number;
  team?: 'neighbour';
  preferred?: string;
  legal?: { given: string | null; family: string | null };
  descriptor?: string;
  birth?: Birth;
  living?: { kind: string; other?: string };
  usualArea?: string;
  language?: string;
  allergyScreen?: 'not_asked' | 'none_known';
  idCardChoice?: 'not_asked' | 'wants' | 'declined';
  aliases?: string[];
  allergies?: { substance: string; category: string; severity: string; reaction?: string }[];
  /** "unable": the chart is made with a banner until consent is recorded (design 11.2). */
  consent?: { decision: 'unable'; reason: string };
  registered: string;
  lastSeen?: string;
  /** Merged into this patient (by number). */
  mergedInto?: number;
  /** An active Street Medicine ID card. */
  card?: boolean;
}

interface DoneWhen {
  p1: {
    id: string;
    preferredName: string;
    legalName: { given: string; family: string };
    birth: Birth;
    visualDescriptor: string;
    usualArea: string;
    livingSituation: { kind: string };
    preferredLanguage: string;
    allergyScreen: 'not_asked';
    idCardChoice: 'not_asked';
    registeredAt: string;
    lastSeenOn: string;
    aliases: { id: string; alias: string }[];
    allergies: { id: string; substance: string; category: string; severity: string }[];
    consents: { id: string; kind: string; decision: string; method: string }[];
  };
}

const doneWhen = JSON.parse(
  readFileSync(new URL('../../packages/contract/test-vectors/done-when.json', import.meta.url), 'utf8'),
) as DoneWhen;

const P1 = doneWhen.p1;
if (P1.id !== demoPatientId(1)) throw new Error('done-when.json: P1 must be demo patient 1');

const PATIENTS: DemoPatient[] = [
  // 1: the done-when's P1, field for field from done-when.json (aliases and allergies keep its IDs).
  {
    n: 1,
    preferred: P1.preferredName,
    legal: P1.legalName,
    descriptor: P1.visualDescriptor,
    birth: P1.birth,
    living: P1.livingSituation,
    usualArea: P1.usualArea,
    language: P1.preferredLanguage,
    allergyScreen: P1.allergyScreen,
    idCardChoice: P1.idCardChoice,
    aliases: P1.aliases.map((a) => a.alias),
    allergies: P1.allergies,
    registered: P1.registeredAt,
    lastSeen: `${P1.lastSeenOn}T18:30:00Z`,
  },
  // 2 and 3: the same person registered twice; the server flagged the pair and nobody has decided.
  {
    n: 2,
    preferred: 'Jon',
    legal: { given: 'Jon', family: 'Mercer' },
    descriptor: 'Demo: short, Lions cap, walks with a cane',
    birth: { precision: 'day', date: '1962-05-14' },
    living: { kind: 'unsheltered' },
    usualArea: 'Demo: by the made-up Gratiot bus shelter',
    registered: '2026-09-08T15:10:00Z',
  },
  {
    n: 3,
    preferred: 'Johnny',
    legal: { given: 'John', family: 'Mercer' },
    descriptor: 'Demo: short, cane, red backpack',
    birth: { precision: 'day', date: '1962-05-14' },
    living: { kind: 'emergency_shelter' },
    registered: '2026-10-02T19:40:00Z',
  },
  // 4 and 5, 6 and 7: likely the same people, never flagged (nicknames; sounds alike).
  {
    n: 4,
    preferred: 'Mike',
    legal: { given: 'Michael', family: 'Ortega' },
    birth: { precision: 'year', year: 1979 },
    aliases: ['Big Mike'],
    usualArea: 'Demo: made-up Cass Park benches',
    registered: '2026-09-12T17:00:00Z',
  },
  {
    n: 5,
    preferred: 'Big Mike',
    descriptor: 'Demo: tall, silver puffer coat',
    living: { kind: 'vehicle' },
    registered: '2026-10-05T21:15:00Z',
  },
  {
    n: 6,
    preferred: 'Kat',
    legal: { given: 'Kathryn', family: 'Bell' },
    birth: { precision: 'day', date: '1955-09-02' },
    registered: '2026-09-15T16:20:00Z',
  },
  {
    n: 7,
    preferred: 'Cathy',
    legal: { given: 'Catherine', family: 'Bell' },
    birth: { precision: 'year', year: 1955 },
    registered: '2026-10-09T14:05:00Z',
  },
  // 8 and 9: merged (9 into 8). Both cards keep opening the kept chart until a new card is made.
  {
    n: 8,
    preferred: 'Rosa',
    legal: { given: 'Rosa', family: 'Delgado' },
    birth: { precision: 'day', date: '1971-11-20' },
    language: 'es',
    usualArea: 'Demo: near the made-up Vernor Hwy laundromat',
    registered: '2026-09-03T18:00:00Z',
    card: true,
  },
  {
    n: 9,
    preferred: 'Rosie',
    legal: { given: 'Rosa', family: 'Delgado' },
    birth: { precision: 'year', year: 1971 },
    aliases: ['Ro'],
    registered: '2026-09-20T18:30:00Z',
    mergedInto: 8,
    card: true,
  },
  // 10 and 11: Not sure, with a note for field staff. 12 and 13: Keep separate.
  {
    n: 10,
    preferred: 'Tasha',
    birth: { precision: 'year', year: 1990 },
    registered: '2026-09-25T20:00:00Z',
  },
  {
    n: 11,
    preferred: 'Natasha',
    legal: { given: 'Natasha', family: 'Greene' },
    birth: { precision: 'estimated', year: 1991 },
    registered: '2026-10-11T13:45:00Z',
  },
  {
    n: 12,
    preferred: 'Luis',
    legal: { given: 'Luis', family: 'Romero' },
    birth: { precision: 'day', date: '1970-04-08' },
    registered: '2026-09-05T15:00:00Z',
  },
  {
    n: 13,
    preferred: 'Lou',
    legal: { given: 'Luis', family: 'Romero' },
    birth: { precision: 'day', date: '1988-06-30' },
    registered: '2026-10-01T15:30:00Z',
  },
  // 14: an ID card. 15 to 19 and 21, 26, 34: problems (below). 20: an open field review.
  {
    n: 14,
    preferred: 'Shay',
    descriptor: 'Demo: braids, purple scarf',
    idCardChoice: 'wants',
    registered: '2026-09-18T17:30:00Z',
    card: true,
  },
  {
    n: 15,
    preferred: 'Marcus',
    legal: { given: 'Marcus', family: 'Hill' },
    birth: { precision: 'day', date: '1967-02-21' },
    living: { kind: 'unsheltered' },
    registered: '2026-09-01T16:00:00Z',
  },
  {
    n: 16,
    preferred: 'Dee',
    descriptor: 'Demo: green hoodie, small dog',
    birth: { precision: 'estimated', year: 1985 },
    allergyScreen: 'none_known',
    registered: '2026-09-10T19:00:00Z',
  },
  {
    n: 17,
    preferred: 'Ana',
    legal: { given: 'Ana', family: 'Cruz' },
    birth: { precision: 'day', date: '1980-10-30' },
    language: 'es',
    registered: '2026-09-14T15:00:00Z',
  },
  {
    n: 18,
    preferred: 'Theo',
    birth: { precision: 'year', year: 1993 },
    registered: '2026-09-22T18:00:00Z',
  },
  {
    n: 19,
    preferred: 'Bo',
    legal: { given: 'Bo', family: 'Anders' },
    birth: { precision: 'day', date: '1977-12-05' },
    registered: '2026-09-02T17:00:00Z',
  },
  {
    n: 20,
    preferred: 'Ken',
    legal: { given: 'Kenji', family: 'Ito' },
    usualArea: 'Demo: by the made-up bus station',
    registered: '2026-09-28T16:00:00Z',
  },
  // Known only by what they look like, or by a legal name, or unable to consent yet.
  {
    n: 21,
    descriptor: 'Demo: man in blue wheelchair, Tigers blanket',
    living: { kind: 'unsheltered' },
    registered: '2026-09-07T22:00:00Z',
  },
  {
    n: 22,
    legal: { given: null, family: 'Adeyemi' },
    birth: { precision: 'year', year: 1974 },
    registered: '2026-10-06T15:00:00Z',
  },
  {
    n: 23,
    preferred: 'Ray',
    descriptor: 'Demo: asleep under the made-up overpass, orange blanket',
    consent: { decision: 'unable', reason: 'Demo: asleep, ask at the next visit' },
    registered: '2026-10-12T06:30:00Z',
  },
  {
    n: 24,
    preferred: 'Pepe',
    legal: { given: 'José', family: 'Martínez' },
    birth: { precision: 'day', date: '1958-03-19' },
    language: 'es',
    registered: '2026-09-09T16:45:00Z',
  },
  {
    n: 25,
    preferred: 'Mo',
    legal: { given: 'Mohammed', family: 'Haddad' },
    birth: { precision: 'estimated', year: 1982 },
    language: 'ar',
    registered: '2026-09-30T14:00:00Z',
  },
  {
    n: 26,
    preferred: 'Smokey',
    descriptor: 'Demo: grey dreadlocks, green army jacket',
    aliases: ['Smoke'],
    living: { kind: 'unsheltered' },
    usualArea: 'Demo: made-up Riverside rail yard',
    registered: '2026-09-04T21:00:00Z',
  },
  {
    n: 27,
    preferred: 'Lady T',
    legal: { given: 'Teresa', family: 'Banks' },
    birth: { precision: 'estimated', year: 1968 },
    living: { kind: 'vehicle' },
    registered: '2026-09-16T18:10:00Z',
  },
  {
    n: 28,
    preferred: 'Junior',
    legal: { given: 'Darnell', family: 'Price' },
    birth: { precision: 'day', date: '1984-01-15' },
    living: { kind: 'emergency_shelter' },
    allergies: [
      { substance: 'peanuts', category: 'food', severity: 'severe', reaction: 'Demo: throat swelling' },
    ],
    registered: '2026-09-11T17:20:00Z',
  },
  {
    n: 29,
    preferred: 'Grandpa Joe',
    legal: { given: 'Joseph', family: 'Walters' },
    birth: { precision: 'year', year: 1949 },
    living: { kind: 'institution' },
    registered: '2026-09-06T15:30:00Z',
  },
  {
    n: 30,
    preferred: 'Sunny',
    descriptor: 'Demo: yellow raincoat, always smiling',
    living: { kind: 'couch_surfing' },
    registered: '2026-09-21T19:30:00Z',
  },
  {
    n: 31,
    preferred: 'Red',
    legal: { given: 'Patrick', family: 'Doyle' },
    birth: { precision: 'day', date: '1958-12-01' },
    aliases: ['Paddy'],
    living: { kind: 'hotel_motel' },
    registered: '2026-09-13T16:10:00Z',
  },
  {
    n: 32,
    preferred: 'Kiki',
    legal: { given: 'Kiana', family: 'Moore' },
    birth: { precision: 'day', date: '1999-07-07' },
    living: { kind: 'transitional_housing' },
    registered: '2026-09-24T18:40:00Z',
  },
  {
    n: 33,
    preferred: 'Doc',
    legal: { given: 'Harold', family: 'Simms' },
    birth: { precision: 'estimated', year: 1960 },
    living: { kind: 'other', other: 'Demo: a tent by the made-up river path' },
    registered: '2026-09-17T20:15:00Z',
  },
  {
    n: 34,
    preferred: 'Nana',
    legal: { given: 'Bernice', family: 'Holloway' },
    birth: { precision: 'day', date: '1944-02-14' },
    living: { kind: 'housed' },
    allergies: [
      { substance: 'sulfa', category: 'drug', severity: 'moderate' },
      { substance: 'codeine', category: 'drug', severity: 'mild', reaction: 'Demo: nausea' },
    ],
    registered: '2026-09-19T15:50:00Z',
  },
  {
    n: 35,
    preferred: 'Tiny',
    descriptor: 'Demo: very tall, size 15 boots',
    living: { kind: 'unknown' },
    registered: '2026-10-03T17:00:00Z',
  },
  {
    n: 36,
    preferred: 'Benny',
    legal: { given: 'Benjamin', family: 'Ross' },
    birth: { precision: 'day', date: '1975-10-31' },
    registered: '2026-10-07T16:30:00Z',
  },
  {
    n: 37,
    preferred: 'Gigi',
    legal: { given: 'Georgina', family: 'Paz' },
    birth: { precision: 'day', date: '2001-03-03' },
    language: 'es',
    registered: '2026-10-08T19:00:00Z',
  },
  {
    n: 38,
    preferred: 'Wes',
    legal: { given: 'Wesley', family: 'Carter' },
    birth: { precision: 'year', year: 1966 },
    allergies: [{ substance: 'latex', category: 'environment', severity: 'unknown' }],
    registered: '2026-10-10T15:15:00Z',
  },
  {
    n: 39,
    preferred: 'Ali',
    legal: { given: 'Ali', family: 'Hassan' },
    birth: { precision: 'estimated', year: 1983 },
    language: 'ar',
    registered: '2026-10-13T14:20:00Z',
  },
  {
    n: 40,
    preferred: 'Mama Rose',
    legal: { given: 'Rosemary', family: 'King' },
    birth: { precision: 'day', date: '1952-08-19' },
    aliases: ['Rose'],
    registered: '2026-10-14T18:00:00Z',
  },
  // A similar name in the neighbouring team: search and matching in the demo team never see it.
  {
    n: 41,
    team: 'neighbour',
    preferred: 'Smitty',
    descriptor: 'Demo: short, green jacket',
    birth: { precision: 'year', year: 1946 },
    registered: '2026-09-29T17:00:00Z',
  },
];

interface DemoProblem {
  k: number;
  patient: number;
  title: string;
  code?: string;
  sensitive?: boolean;
  /** Each observed status in order, with when; the last is current. */
  statuses: { status: 'new' | 'ongoing' | 'resolved'; at: string }[];
  recurrenceOf?: number;
  resolvedInErrorOf?: number;
  enteredInError?: { reason: string; at: string };
  notes?: { text: string; at: string }[];
}

// Titles of coded problems are the ICD-10-CM titles (packages/contract/data/icd10cm-curated.csv).
const PROBLEMS: DemoProblem[] = [
  { k: 1, patient: 15, title: 'Cough', statuses: [{ status: 'new', at: '2026-10-15T16:00:00Z' }] },
  {
    k: 2,
    patient: 15,
    title: 'Type 2 diabetes mellitus without complications',
    code: 'E11.9',
    statuses: [
      { status: 'new', at: '2026-09-01T16:10:00Z' },
      { status: 'ongoing', at: '2026-09-15T16:00:00Z' },
    ],
  },
  {
    k: 3,
    patient: 15,
    title: 'Burn of first degree of left forearm, initial encounter',
    code: 'T22.112A',
    statuses: [
      { status: 'new', at: '2026-10-01T16:00:00Z' },
      { status: 'resolved', at: '2026-10-10T16:00:00Z' },
    ],
    notes: [
      { text: 'Demo: dressing changed, no sign of infection.', at: '2026-10-04T16:00:00Z' },
      { text: 'Demo: healed, no dressing needed.', at: '2026-10-10T16:05:00Z' },
    ],
  },
  {
    k: 4,
    patient: 16,
    title: 'Opioid dependence, uncomplicated',
    code: 'F11.20',
    sensitive: true,
    statuses: [
      { status: 'new', at: '2026-09-10T19:10:00Z' },
      { status: 'ongoing', at: '2026-09-24T19:00:00Z' },
    ],
  },
  {
    k: 5,
    patient: 16,
    title: 'Essential (primary) hypertension',
    code: 'I10',
    statuses: [{ status: 'ongoing', at: '2026-09-10T19:15:00Z' }],
  },
  {
    k: 6,
    patient: 17,
    title: 'Cellulitis of left lower limb',
    code: 'L03.116',
    statuses: [
      { status: 'new', at: '2026-09-14T15:10:00Z' },
      { status: 'resolved', at: '2026-10-02T15:00:00Z' },
    ],
  },
  {
    // "It never went away": the request an admin reverses or declines (design 9.4).
    k: 7,
    patient: 17,
    title: 'Cellulitis of left lower limb',
    code: 'L03.116',
    statuses: [{ status: 'new', at: '2026-10-16T15:00:00Z' }],
    resolvedInErrorOf: 6,
  },
  {
    k: 8,
    patient: 18,
    title: 'Cough',
    statuses: [{ status: 'new', at: '2026-09-22T18:10:00Z' }],
    enteredInError: { reason: 'Demo: added to the wrong chart', at: '2026-09-22T18:20:00Z' },
  },
  {
    k: 9,
    patient: 19,
    title: 'Acute pharyngitis, unspecified',
    code: 'J02.9',
    statuses: [
      { status: 'new', at: '2026-09-02T17:10:00Z' },
      { status: 'resolved', at: '2026-09-16T17:00:00Z' },
    ],
  },
  {
    // "It came back": a new episode.
    k: 10,
    patient: 19,
    title: 'Acute pharyngitis, unspecified',
    code: 'J02.9',
    statuses: [{ status: 'new', at: '2026-10-14T17:00:00Z' }],
    recurrenceOf: 9,
  },
  {
    k: 11,
    patient: 21,
    title: 'Pressure ulcer of sacral region, stage 2',
    code: 'L89.152',
    statuses: [
      { status: 'new', at: '2026-09-07T22:10:00Z' },
      { status: 'ongoing', at: '2026-09-21T22:00:00Z' },
    ],
    notes: [{ text: 'Demo: cushion given, wound cleaned and covered.', at: '2026-09-21T22:05:00Z' }],
  },
  {
    k: 12,
    patient: 26,
    title: 'Immersion foot, right foot, initial encounter',
    code: 'T69.021A',
    statuses: [{ status: 'ongoing', at: '2026-10-08T21:00:00Z' }],
  },
  {
    k: 13,
    patient: 26,
    title: 'Alcohol dependence, uncomplicated',
    code: 'F10.20',
    sensitive: true,
    statuses: [{ status: 'ongoing', at: '2026-09-04T21:10:00Z' }],
  },
  {
    k: 14,
    patient: 34,
    title: 'Chronic obstructive pulmonary disease, unspecified',
    code: 'J44.9',
    statuses: [{ status: 'ongoing', at: '2026-09-19T16:00:00Z' }],
  },
];

interface DemoPair {
  k: number;
  a: number;
  b: number;
  score: number;
  reasons: string[];
  status: 'open' | 'not_sure' | 'keep_separate' | 'merged';
  flagged: string;
  decision?: { comment: string; at: string };
  note?: string;
}

const PAIRS: DemoPair[] = [
  {
    k: 1,
    a: 2,
    b: 3,
    score: 0.95,
    reasons: ['name', 'nickname', 'dob_exact'],
    status: 'open',
    flagged: '2026-10-02T19:41:00Z',
  },
  {
    k: 2,
    a: 10,
    b: 11,
    score: 0.72,
    reasons: ['name', 'nickname', 'dob_estimate'],
    status: 'not_sure',
    flagged: '2026-10-11T13:46:00Z',
    decision: { comment: 'Demo: could not tell from the charts', at: '2026-10-13T15:00:00Z' },
    note: 'Demo: check the ID card at the next visit',
  },
  {
    k: 3,
    a: 12,
    b: 13,
    score: 0.7,
    reasons: ['name', 'legal_name'],
    status: 'keep_separate',
    flagged: '2026-10-01T15:31:00Z',
    decision: { comment: 'Demo: different people, born 18 years apart', at: '2026-10-03T15:00:00Z' },
  },
  {
    k: 4,
    a: 8,
    b: 9,
    score: 0.88,
    reasons: ['legal_name', 'nickname', 'dob_year'],
    status: 'merged',
    flagged: '2026-09-20T18:31:00Z',
    decision: { comment: 'Demo: same person, confirmed with her at the van', at: '2026-09-27T16:00:00Z' },
  },
];

const PATIENT_FIELDS = [
  'preferredName',
  'legalName',
  'visualDescriptor',
  'birth',
  'livingSituation',
  'usualArea',
  'preferredLanguage',
  'allergyScreen',
  'idCardChoice',
];

/** Made-up card tokens: 22 base64url characters, never derived from a patient. */
const cardToken = (n: number) => `DemoCardToken${pad(n, 9)}`;

export async function seedDemoPatients(
  tx: TransactionSql,
  demoTeamId: string,
  author: string,
): Promise<{ patients: number }> {
  const json = (v: unknown) => tx.json(v as never);
  const teamOf = (p: DemoPatient) => (p.team === 'neighbour' ? NEIGHBOUR_TEAM_ID : demoTeamId);
  const meta = (at: string) => ({ by: author, at, changeId: null });
  let inserted = 0;

  for (const p of PATIENTS) {
    const id = demoPatientId(p.n);
    const team = teamOf(p);
    const canonical = p.mergedInto ? demoPatientId(p.mergedInto) : id;
    const values: Record<string, unknown> = {
      preferredName: p.preferred ?? null,
      legalName: p.legal ?? null,
      visualDescriptor: p.descriptor ?? null,
      birth: p.birth ?? null,
      livingSituation: p.living ?? null,
      usualArea: p.usualArea ?? null,
      preferredLanguage: p.language ?? null,
      allergyScreen: p.allergyScreen ?? 'not_asked',
      idCardChoice: p.idCardChoice ?? 'not_asked',
    };
    const birthYear = p.birth
      ? p.birth.precision === 'day'
        ? Number(p.birth.date.slice(0, 4))
        : p.birth.year
      : null;
    const rows = await tx`
      insert into sineobex.patients (id, team_id, status, merged_into, canonical_id, preferred_name, legal_given_name,
        legal_family_name, visual_descriptor, birth_precision, birth_date, birth_year, living_situation,
        living_situation_other, usual_area, preferred_language, allergy_screen, id_card_choice, last_seen_at,
        registered_at, clock_verified, author_user_id, field_versions, field_meta, created_at)
      values (${id}, ${team}, ${p.mergedInto ? 'merged' : 'active'}, ${p.mergedInto ? canonical : null}, ${canonical},
        ${p.preferred ?? null}, ${p.legal?.given ?? null}, ${p.legal?.family ?? null}, ${p.descriptor ?? null},
        ${p.birth?.precision ?? null}, ${p.birth?.precision === 'day' ? p.birth.date : null}, ${birthYear},
        ${p.living?.kind ?? null}, ${p.living?.other ?? null}, ${p.usualArea ?? null}, ${p.language ?? null},
        ${values.allergyScreen as string}, ${values.idCardChoice as string}, ${p.lastSeen ?? p.registered},
        ${p.registered}, true, ${author}, ${json(Object.fromEntries(PATIENT_FIELDS.map((f) => [f, 1])))},
        ${json(Object.fromEntries(PATIENT_FIELDS.map((f) => [f, meta(p.registered)])))}, ${p.registered})
      on conflict (id) do nothing
      returning id`;
    // Only a patient added now gets its history and records, so a second run changes nothing.
    if (rows.length === 0) continue;
    inserted++;

    for (const f of PATIENT_FIELDS) {
      await tx`
        insert into sineobex.field_history (team_id, entity, record_id, field, version, value, kind, changed_by,
          device_time, recorded_at)
        values (${team}, 'patient', ${id}, ${f}, 1, ${json(values[f] ?? null)}, 'created', ${author}, ${p.registered},
          ${p.registered})`;
    }
    for (const [k, alias] of (p.aliases ?? []).entries()) {
      await tx`
        insert into sineobex.patient_aliases (id, team_id, patient_id, alias, author_user_id, created_at)
        values (${demoId('0a', p.n, k)}, ${team}, ${id}, ${alias}, ${author}, ${p.registered})
        on conflict (id) do nothing`;
    }
    for (const [k, a] of (p.allergies ?? []).entries()) {
      await tx`
        insert into sineobex.patient_allergies (id, team_id, patient_id, substance, category, severity, reaction,
          recorded_at, author_user_id, created_at)
        values (${demoId('0b', p.n, k)}, ${team}, ${id}, ${a.substance}, ${a.category}, ${a.severity},
          ${a.reaction ?? null}, ${p.registered}, ${author}, ${p.registered})
        on conflict (id) do nothing`;
    }
    const [careId, noticeId] =
      p.n === 1 ? [P1.consents[0]!.id, P1.consents[1]!.id] : [demoId('0c', p.n, 1), demoId('0c', p.n, 2)];
    const unable = p.consent?.decision === 'unable';
    await tx`
      insert into sineobex.patient_consents (id, team_id, patient_id, kind, decision, method, script_version, language,
        reason, recorded_by, recorded_at, clock_verified)
      values (${careId!}, ${team}, ${id}, 'care_and_record', ${unable ? 'unable' : 'given'},
              ${unable ? 'not_applicable' : 'verbal'}, '2026-10-1', 'en', ${p.consent?.reason ?? null}, ${author},
              ${p.registered}, true),
             (${noticeId!}, ${team}, ${id}, 'privacy_notice', ${unable ? 'not_offered' : 'acknowledged'},
              ${unable ? 'not_applicable' : 'verbal'}, '2026-10-1', 'en', ${p.consent?.reason ?? null}, ${author},
              ${p.registered}, true)
      on conflict (id) do nothing`;
    if (p.card) {
      const token = cardToken(p.n);
      await tx`
        insert into sineobex.patient_id_links (id, team_id, patient_id, token, token_hash, status, reason, effective_at,
          clock_verified, made_offline, issued_by, received_at)
        values (${demoId('0f', p.n)}, ${team}, ${id}, ${token}, ${createHash('sha256').update(token, 'ascii').digest('hex')},
          'active', 'first_card', ${p.registered}, true, false, ${author}, ${p.registered})
        on conflict (id) do nothing`;
    }
  }
  if (inserted === 0) return { patients: 0 };

  // Ken (20): two people recorded different places; the chart keeps its value and a review is open.
  const ken = demoPatientId(20);
  const review = demoId('13', 1);
  await tx`
    insert into sineobex.field_reviews (id, team_id, patient_id, entity, record_id, field, needs, opened_at)
    values (${review}, ${demoTeamId}, ${ken}, 'patient', ${ken}, 'usualArea', 'patients.edit', '2026-10-15T17:00:00Z')
    on conflict (id) do nothing`;
  await tx`
    insert into sineobex.field_history (team_id, entity, record_id, field, version, value, previous_value, kind,
      changed_by, device_time, recorded_at, review_id)
    values (${demoTeamId}, 'patient', ${ken}, 'usualArea', 1, ${json('Demo: behind the made-up library')},
      ${json('Demo: by the made-up bus station')}, 'kept_both', ${author}, '2026-10-15T16:40:00Z',
      '2026-10-15T17:00:00Z', ${review})`;

  for (const pr of PROBLEMS) {
    const patient = demoPatientId(pr.patient);
    const id = demoId('0d', pr.k);
    const first = pr.statuses[0]!;
    const current = pr.statuses[pr.statuses.length - 1]!;
    const sensitive = pr.sensitive ?? false;
    const versions: Record<string, number> = { status: pr.statuses.length };
    const fieldMeta: Record<string, unknown> = { status: meta(current.at) };
    if (pr.enteredInError) {
      versions.enteredInError = 1;
      fieldMeta.enteredInError = meta(pr.enteredInError.at);
    }
    await tx`
      insert into sineobex.problems (id, team_id, patient_id, title, code_system, code, code_display, sensitive, status,
        status_changed_at, status_changed_by, status_checked_at, recurrence_of, resolved_in_error_of, reversal_request,
        error_reason, error_by, error_at, author_user_id, field_versions, field_meta, version, created_at)
      values (${id}, ${demoTeamId}, ${patient}, ${pr.title}, ${pr.code ? 'icd10cm' : null}, ${pr.code ?? null},
        ${pr.code ? pr.title : null}, ${sensitive}, ${current.status}, ${current.at}, ${author}, ${current.at},
        ${pr.recurrenceOf ? demoId('0d', pr.recurrenceOf) : null},
        ${pr.resolvedInErrorOf ? demoId('0d', pr.resolvedInErrorOf) : null}, ${pr.resolvedInErrorOf ? 'open' : null},
        ${pr.enteredInError?.reason ?? null}, ${pr.enteredInError ? author : null}, ${pr.enteredInError?.at ?? null},
        ${author}, ${json(versions)}, ${json(fieldMeta)}, ${pr.statuses.length + (pr.enteredInError ? 1 : 0)},
        ${first.at})
      on conflict (id) do nothing`;
    for (const [i, s] of pr.statuses.entries()) {
      await tx`
        insert into sineobex.field_history (team_id, entity, record_id, field, version, value, previous_value, kind,
          changed_by, device_time, recorded_at)
        values (${demoTeamId}, 'problem', ${id}, 'status', ${i + 1}, ${json({ status: s.status, encounterId: null })},
          ${i === 0 ? null : json({ status: pr.statuses[i - 1]!.status, encounterId: null })},
          ${i === 0 ? 'created' : 'set'}, ${author}, ${s.at}, ${s.at})`;
    }
    if (pr.enteredInError) {
      await tx`
        insert into sineobex.field_history (team_id, entity, record_id, field, version, value, kind, changed_by,
          device_time, recorded_at)
        values (${demoTeamId}, 'problem', ${id}, 'enteredInError', 1, ${json({ reason: pr.enteredInError.reason })},
          'entered_in_error', ${author}, ${pr.enteredInError.at}, ${pr.enteredInError.at})`;
    }
    for (const [i, note] of (pr.notes ?? []).entries()) {
      await tx`
        insert into sineobex.problem_notes (id, team_id, problem_id, text, written_at, author_user_id, created_at)
        values (${demoId('0e', pr.k, i)}, ${demoTeamId}, ${id}, ${note.text}, ${note.at}, ${author}, ${note.at})
        on conflict (id) do nothing`;
    }
  }

  for (const pair of PAIRS) {
    const [a, b] = [demoPatientId(pair.a), demoPatientId(pair.b)].sort() as [string, string];
    const id = demoId('10', pair.k);
    const decided = pair.status === 'keep_separate' || pair.status === 'merged';
    await tx`
      insert into sineobex.duplicate_pairs (id, team_id, patient_a, patient_b, score, reasons, sources, status, note,
        first_flagged_at, last_flagged_at, decided_at, decided_by)
      values (${id}, ${demoTeamId}, ${a}, ${b}, ${pair.score}, ${pair.reasons}, ${['sync']}, ${pair.status},
        ${pair.note ?? null}, ${pair.flagged}, ${pair.flagged}, ${decided ? pair.decision!.at : null},
        ${decided ? author : null})
      on conflict (id) do nothing`;
    if (!pair.decision) continue;
    const decisionId = demoId('11', pair.k);
    const mergeId = demoId('12', pair.k);
    const merge = pair.status === 'merged';
    await tx`
      insert into sineobex.duplicate_decisions (id, team_id, pair_id, decision, comment, survivor_id, merge_id,
        decided_by, decided_at)
      values (${decisionId}, ${demoTeamId}, ${id}, ${merge ? 'merge' : pair.status}, ${pair.decision.comment},
        ${merge ? demoPatientId(pair.a) : null}, ${merge ? mergeId : null}, ${author}, ${pair.decision.at})
      on conflict (id) do nothing`;
    if (merge) {
      await tx`
        insert into sineobex.patient_merges (id, team_id, pair_id, survivor_id, merged_id, decision_id, merged_by, merged_at)
        values (${mergeId}, ${demoTeamId}, ${id}, ${demoPatientId(pair.a)}, ${demoPatientId(pair.b)}, ${decisionId},
          ${author}, ${pair.decision.at})
        on conflict (id) do nothing`;
    }
  }
  return { patients: inserted };
}
