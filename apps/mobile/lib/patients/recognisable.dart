/// Someone must stay recognisable: a name, or what they look like ("man in blue wheelchair")
/// (design 2.3, D42).
///
/// Preferred name, legal name and description sync as three fields, one change at a time. The
/// phone refuses to clear the last of them it can see (a hard stop mirroring the server), so only a
/// race with another phone reaches the server, which then keeps the chart's value and answers
/// `history_only` with `nothing_to_recognise`. services/api/src/patients/recognisable.ts holds the
/// same rule; a patient create without any of them is refused with that problem on both sides
/// (packages/contract/test-vectors/sync-values.json).
library;

/// The fields that make a patient recognisable, as sync names them.
const recognisableFields = ['preferredName', 'legalName', 'visualDescriptor'];

bool isRecognisableField(String field) => recognisableFields.contains(field);

bool _present(Object? v) => v is String && v.trim().isNotEmpty;

/// A legal name counts when either part is there.
bool _legalNamePresent(Object? v) => v is Map<Object?, Object?> && (_present(v['given']) || _present(v['family']));

bool _fieldPresent(String field, Object? value) => field == 'legalName' ? _legalNamePresent(value) : _present(value);

/// Whether these values (sync field names, as a record's fields or a create's value hold them) name
/// or describe someone.
bool isRecognisable(Map<String, Object?> values) => recognisableFields.any((f) => _fieldPresent(f, values[f]));

/// Whether a patient holding [values] would still be recognisable after [field] takes [value]. Any
/// other field changes nothing, so the answer is whether it is recognisable now.
bool recognisableAfter(Map<String, Object?> values, String field, Object? value) {
  if (!isRecognisableField(field)) return isRecognisable(values);
  return isRecognisable({...values, field: value});
}
