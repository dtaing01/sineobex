/**
 * Someone must stay recognisable: a name, or what they look like ("man in blue wheelchair")
 * (phase 3 design 2.3, D42; the patients_recognisable constraint in 0009).
 *
 * Those four columns sync as three fields (preferredName, legalName, visualDescriptor), one change
 * at a time, so two phones that each clear a different one, both from the version they saw, each
 * pass the field rules. Before any write to one of them (a sync set, a redirected set, a field
 * review decision, a merge undo reverting a fill) the server asks what the locked row would be left
 * with. A sync change that would leave nothing is accepted as history only; a review decision is
 * refused (409 nothing_to_recognise); a merge undo keeps that fill. The constraint is the backstop,
 * never the answer. The phone mirrors this in lib/patients/recognisable.dart.
 */

/** The fields that make a patient recognisable, as sync names them. */
export const RECOGNISABLE_FIELDS = ['preferredName', 'legalName', 'visualDescriptor'] as const;
export type RecognisableField = (typeof RECOGNISABLE_FIELDS)[number];

export const isRecognisableField = (field: string): field is RecognisableField =>
  (RECOGNISABLE_FIELDS as readonly string[]).includes(field);

const present = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/** A legal name counts when either part is there. */
function legalNamePresent(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false;
  const { given, family } = v as { given?: unknown; family?: unknown };
  return present(given) || present(family);
}

function fieldPresent(field: RecognisableField, value: unknown): boolean {
  return field === 'legalName' ? legalNamePresent(value) : present(value);
}

/** Whether these values (sync field names, as a record's `values` holds them) name or describe someone. */
export function isRecognisable(values: Readonly<Record<string, unknown>>): boolean {
  return RECOGNISABLE_FIELDS.some((f) => fieldPresent(f, values[f]));
}

/**
 * Whether the record would still be recognisable after `field` takes `value`. Any other field
 * changes nothing, so the answer is whether it is recognisable now.
 */
export function recognisableAfter(
  rec: { values: Readonly<Record<string, unknown>> },
  field: string,
  value: unknown,
): boolean {
  if (!isRecognisableField(field)) return isRecognisable(rec.values);
  return isRecognisable({ ...rec.values, [field]: value });
}

/** A patient create must bring a name or a description (`nothing_to_recognise`). */
export function recognisableCreate(value: {
  preferredName?: string | null;
  legalName?: { given: string | null; family: string | null } | null;
  visualDescriptor?: string | null;
}): boolean {
  return isRecognisable({
    preferredName: value.preferredName ?? null,
    legalName: value.legalName ?? null,
    visualDescriptor: value.visualDescriptor ?? null,
  });
}
