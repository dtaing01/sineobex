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
