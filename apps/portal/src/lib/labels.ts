import type { Schemas } from '@sineobex/contract';

export const CREDENTIAL_LABELS: Record<string, string> = {
  attending: 'Attending physician',
  resident: 'Resident',
  np: 'Nurse practitioner',
  pa: 'Physician assistant',
  student: 'Student or volunteer',
  chw: 'Community health worker',
  none: 'No clinical credential',
};

/** Fields each credential needs (mirrors REQUIRED_FIELDS in the API; the API is the check). */
export const CREDENTIAL_FIELD_SETS: Record<string, { name: string; label: string; hint?: string }[]> = {
  student: [
    { name: 'school', label: 'School' },
    { name: 'supervisingPhysician', label: 'Supervising physician' },
  ],
  resident: [
    { name: 'npi', label: 'NPI', hint: '10 digits' },
    { name: 'program', label: 'Residency program' },
    { name: 'supervisingAttending', label: 'Supervising attending' },
  ],
  attending: [
    { name: 'npi', label: 'NPI', hint: '10 digits' },
    { name: 'licenseNumber', label: 'License number' },
    { name: 'licenseState', label: 'License state', hint: 'Two letters, for example MI' },
  ],
  np: [
    { name: 'npi', label: 'NPI', hint: '10 digits' },
    { name: 'licenseNumber', label: 'License number' },
    { name: 'licenseState', label: 'License state', hint: 'Two letters, for example MI' },
  ],
  pa: [
    { name: 'npi', label: 'NPI', hint: '10 digits' },
    { name: 'licenseNumber', label: 'License number' },
    { name: 'licenseState', label: 'License state', hint: 'Two letters, for example MI' },
  ],
  chw: [],
  none: [],
};

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Detroit',
  }).format(new Date(iso));
}

const UNSYNCED: Record<string, [string, string]> = {
  encounters: ['encounter', 'encounters'],
  notes: ['note', 'notes'],
  // Phase 3 (design 2.1): a patient's details, street names, allergies, consents and ID cards;
  // problems and their notes.
  patients: ['patient detail', 'patient details'],
  problems: ['problem list entry', 'problem list entries'],
  activity: ['activity log entry', 'activity log entries'],
  photos: ['photo', 'photos'],
};

/**
 * "3 encounters, 2 notes" from a phone's unsynced counts; "Nothing" when empty. Categories keep
 * one order (the database returns object keys in its own order).
 */
export function unsyncedSummary(counts: Record<string, number>): string {
  const order = Object.keys(UNSYNCED);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([k, n]) => {
      const [one, many] = UNSYNCED[k] ?? [k, k];
      return `${n} ${n === 1 ? one : many}`;
    });
  return parts.length === 0 ? 'Nothing' : parts.join(', ');
}

/** A synced record type as a noun inside a sentence: "New street name", "ID card". */
const SYNC_ENTITY: Record<Schemas['ChangeEntity'], string> = {
  encounter: 'encounter',
  encounter_note: 'note',
  audit: 'activity log entry',
  patient: 'patient',
  patient_alias: 'street name',
  patient_allergy: 'allergy',
  patient_consent: 'consent decision',
  problem: 'problem',
  problem_note: 'problem note',
  id_link: 'ID card',
};

export function syncEntityNoun(entity: string): string {
  return SYNC_ENTITY[entity as Schemas['ChangeEntity']] ?? entity;
}

/** The same, starting a sentence or a heading: "Street name". */
export function syncEntityLabel(entity: string): string {
  const noun = syncEntityNoun(entity);
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

/** Patient-side fields in the words of the phone's forms (design 11.1). */
const FIELD_LABELS: Record<string, string> = {
  preferredName: 'Name they go by',
  legalName: 'Legal name',
  birth: 'Date of birth',
  visualDescriptor: 'What they look like',
  usualArea: 'Usually found',
  livingSituation: 'Living situation',
  preferredLanguage: 'Preferred language',
  allergyScreen: 'Allergies asked',
  idCardChoice: 'ID card',
  removal: 'Removed',
  enteredInError: 'Entered in error',
};

/** "data.wound.length_cm" → "Wound length cm" (note types bring real labels in phase 4). */
export function syncFieldLabel(field: string): string {
  const known = FIELD_LABELS[field];
  if (known) return known;
  const raw = field.startsWith('data.') ? field.slice(5) : field;
  const words = raw
    .replace(/[._]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : field;
}

/** A quarantined value as readable text. */
export function quarantineValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(blank)';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

/** Why a search hit or a possible duplicate matched (design 5.2). */
export const MATCH_REASON: Record<Schemas['MatchReason'], string> = {
  name: 'Name',
  alias: 'Street name',
  legal_name: 'Legal name',
  descriptor: 'Description',
  typo: 'Name, spelled a little differently',
  nickname: 'Nickname for the name',
  sounds_like: 'Name sounds the same',
  initial: 'Initial',
  dob_exact: 'Same birth date',
  dob_swapped: 'Birth date with day and month swapped',
  dob_month_year: 'Same birth month and year',
  dob_year_slip: 'Birth date with the year a little off',
  dob_year: 'Same birth year',
  dob_estimate: 'Age close to the estimate',
};

/** "Street name, Same birth year". */
export function matchReasons(reasons: readonly Schemas['MatchReason'][]): string {
  return reasons.map((r) => MATCH_REASON[r]).join(', ');
}

/** Why a new ID card was made (design 10.4). */
export const ID_LINK_REASON: Record<Schemas['IdLinkReason'], string> = {
  first_card: 'First card',
  lost: 'Lost',
  damaged: 'Damaged',
  stolen: 'Stolen',
  patient_request: 'Patient asked',
  other: 'Other',
};

// PLAN-OPEN: living situation options (design 14.1, #2): the ten of 11.4 until the Google Doc
// Contents tab, which owns option lists, confirms them. The keys are the sync value's `kind`.
export const LIVING_SITUATION = {
  unsheltered: 'Unsheltered (street or outdoors)',
  vehicle: 'Vehicle',
  emergency_shelter: 'Emergency shelter',
  transitional_housing: 'Transitional housing',
  couch_surfing: 'Couch surfing',
  hotel_motel: 'Hotel or motel (self-paid)',
  housed: 'Housed',
  institution: 'In an institution (hospital, jail, treatment)',
  unknown: 'Unknown',
  other: 'Other',
} as const satisfies Record<string, string>;

export const PROBLEM_STATUS: Record<Schemas['ProblemStatus'], string> = {
  new: 'New',
  ongoing: 'Ongoing',
  resolved: 'Resolved',
};
