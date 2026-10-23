/** What a server action hands back to its form. Values are echoed so a failed submit keeps them. */
export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

export const initialState: ActionState = {};

export function formValues(form: FormData, ...names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = form.get(n);
    if (typeof v === 'string') out[n] = v;
  }
  return out;
}

/** Plain-language messages for the API's field-level problems. */
const FIELD_LABELS: Record<string, string> = {
  npi: 'NPI',
  program: 'Program',
  supervisingAttending: 'Supervising attending',
  supervisingPhysician: 'Supervising physician',
  school: 'School',
  licenseNumber: 'License number',
  licenseState: 'License state',
  reason: 'Reason',
  email: 'Email',
  displayName: 'Name',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}
