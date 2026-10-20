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

/** "data.wound.length_cm" → "Wound length cm" (note types bring real labels in phase 4). */
export function syncFieldLabel(field: string): string {
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
