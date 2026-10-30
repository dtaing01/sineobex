import '../patients/match_constants.dart' show estimateRange;
import '../patients/recognisable.dart';
import 'canonical_json.dart';

/// The entity registry on the phone (phase 3 design 2.9-1): per kind of synced record, the API's
/// value schemas, the records a change names, the fields a create sets, its outbox category and
/// whether it waits for the clock check.
///
/// services/api/src/sync/entities/ holds the server's registry. The two are pinned to each other by
/// packages/contract/test-vectors/sync-values.json (entities_test.dart): the same values are valid,
/// an invalid one fails at the same Zod issue paths or breaks the same named rule, and each valid
/// change names the same parents. The phone checks a value before it enters the outbox, because a
/// value the server refuses can only come back as a rejection the worker must fix.

const entityEncounter = 'encounter';
const entityNote = 'encounter_note';
const entityAudit = 'audit';
const entityPatient = 'patient';
const entityAlias = 'patient_alias';
const entityAllergy = 'patient_allergy';
const entityConsent = 'patient_consent';
const entityProblem = 'problem';
const entityProblemNote = 'problem_note';
const entityIdLink = 'id_link';

/// How two values for one field are reconciled on the server (design 2.4).
enum FieldClass { draft, keepBoth, identity, status, setOnce }

/// A record a change names, which must be on the server (or held with it) before the change applies.
typedef ParentRef = ({String entity, String id});

// ------------------------------------------------------------------------------------------------
// Value schemas: Zod's rules, as far as the API's schemas use them
// ------------------------------------------------------------------------------------------------

/// What a value broke: Zod issue paths ('' for the value itself, `consent.reason` inside it).
class ValueIssues {
  final _paths = <String>{};
  int _aborts = 0;

  /// Where the value failed, as the API's `details.problems[].path` names it.
  Set<String> get paths => {..._paths};
  bool get ok => _paths.isEmpty;

  /// [abort]: a wrong type or an unknown choice, after which Zod runs no refinement of the object
  /// around it. Length, format and refinement issues let those run.
  void add(String path, {bool abort = false}) {
    _paths.add(path);
    if (abort) _aborts++;
  }
}

typedef _Schema = void Function(Object? value, String path, ValueIssues issues);

String _at(String path, String key) => path.isEmpty ? key : '$path.$key';

_Schema _string({int min = 0, int? max, RegExp? pattern, List<bool Function(String)> refine = const []}) =>
    (v, path, issues) {
      if (v is! String) return issues.add(path, abort: true);
      if (v.length < min || (max != null && v.length > max)) issues.add(path);
      if (pattern != null && !pattern.hasMatch(v)) issues.add(path);
      for (final ok in refine) {
        if (!ok(v)) issues.add(path);
      }
    };

/// Strings are validated, never trimmed (review finding 21): an untrimmed one is refused.
_Schema _trimmed(int min, int max) => _string(min: min, max: max, refine: [(s) => s == s.trim()]);

_Schema _oneOf(Set<Object> values) => (v, path, issues) {
  if (v == null || !values.contains(v)) issues.add(path, abort: true);
};

void _bool(Object? v, String path, ValueIssues issues) {
  if (v is! bool) issues.add(path, abort: true);
}

_Schema _number({num? min, num? max, bool integer = false}) => (v, path, issues) {
  if (v is! num || !v.isFinite || (integer && v != v.truncate())) return issues.add(path, abort: true);
  if ((min != null && v < min) || (max != null && v > max)) issues.add(path);
};

_Schema _nullable(_Schema s) => (v, path, issues) {
  if (v != null) s(v, path, issues);
};

typedef _Field = ({_Schema schema, bool optional});
_Field _req(_Schema s) => (schema: s, optional: false);
_Field _opt(_Schema s) => (schema: s, optional: true);

/// A strict object: an unknown key is an issue on the object itself. Its refinement runs unless a
/// field had the wrong type, as Zod 4 does.
_Schema _object(
  Map<String, _Field> fields, {
  void Function(Map<String, Object?> v, String path, ValueIssues issues)? refine,
}) => (v, path, issues) {
  if (v is! Map<String, Object?>) return issues.add(path, abort: true);
  final aborts = issues._aborts;
  for (final MapEntry(key: name, value: f) in fields.entries) {
    if (v.containsKey(name)) {
      f.schema(v[name], _at(path, name), issues);
    } else if (!f.optional) {
      issues.add(_at(path, name), abort: true);
    }
  }
  if (v.keys.any((k) => !fields.containsKey(k))) issues.add(path);
  if (refine != null && issues._aborts == aborts) refine(v, path, issues);
};

/// Zod's discriminated union: an unknown discriminator is an issue at its key.
_Schema _union(String key, Map<String, _Schema> options) => (v, path, issues) {
  if (v is! Map<String, Object?>) return issues.add(path, abort: true);
  final option = options[v[key]];
  if (option == null) return issues.add(_at(path, key), abort: true);
  option(v, path, issues);
};

_Schema _array(_Schema item, {required int max}) => (v, path, issues) {
  if (v is! List<Object?>) return issues.add(path, abort: true);
  if (v.length > max) issues.add(path);
  for (final (i, x) in v.indexed) {
    item(x, _at(path, '$i'), issues);
  }
};

/// Zod 4's `z.string().uuid()`: RFC 9562 versions 1 to 8, either case, or the nil and max IDs.
final uuidPattern = RegExp(
  r'^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}'
  r'|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
);
bool isUuid(Object? v) => v is String && uuidPattern.hasMatch(v);
final _uuid = _string(pattern: uuidPattern);

/// A real calendar date, YYYY-MM-DD.
bool isRealDate(String s) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(s);
  if (m == null) return false;
  final (y, mo, d) = (int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
  final date = DateTime.utc(y, mo, d);
  return date.year == y && date.month == mo && date.day == d;
}

final _isoDate = _string(pattern: RegExp(r'^\d{4}-\d{2}-\d{2}$'), refine: [isRealDate]);
final _languageTag = _string(pattern: RegExp(r'^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'));
final _scriptVersion = _string(pattern: RegExp(r'^[a-z0-9_.-]{1,40}$'));
final _name80 = _trimmed(1, 80);
final _text200 = _trimmed(1, 200);

/// The routes' shared Reason trims (a transform), so sync values use this.
final _syncReason = _trimmed(3, 300);

/// Earliest birth date and year stored (patients_birth checks in 0009).
const birthMinDate = '1900-01-01';
const birthMinYear = 1900;

final _legalName = _object(
  {'given': _req(_nullable(_name80)), 'family': _req(_nullable(_name80))},
  refine: (v, path, issues) {
    if (v['given'] == null && v['family'] == null) issues.add(path);
  },
);

final _birth = _union('precision', {
  'day': _object({
    'precision': _req(_oneOf({'day'})),
    'date': _req(
      _string(pattern: RegExp(r'^\d{4}-\d{2}-\d{2}$'), refine: [isRealDate, (d) => d.compareTo(birthMinDate) >= 0]),
    ),
  }),
  'year': _object({
    'precision': _req(_oneOf({'year'})),
    'year': _req(_number(integer: true, min: birthMinYear)),
  }),
  'estimated': _object({
    'precision': _req(_oneOf({'estimated'})),
    'year': _req(_number(integer: true, min: birthMinYear)),
  }),
});

// PLAN-OPEN: living situation options (design 14.1, #2): the ten of 11.4 until the Google Doc
// Contents tab confirms them. The API's values.ts holds the same list.
const livingSituations = {
  'unsheltered',
  'vehicle',
  'emergency_shelter',
  'transitional_housing',
  'couch_surfing',
  'hotel_motel',
  'housed',
  'institution',
  'unknown',
  'other',
};

final _livingSituation = _object({'kind': _req(_oneOf(livingSituations)), 'other': _opt(_text200)});

void _reasonRequired(Map<String, Object?> v, String path, ValueIssues issues) {
  final decision = v['decision'];
  if ((decision == 'unable' || decision == 'not_offered') && !v.containsKey('reason')) {
    issues.add(_at(path, 'reason'));
  }
}

const _methods = {'verbal', 'written', 'not_applicable'};
const _noticeDecisions = {'acknowledged', 'declined', 'unable', 'not_offered'};

final _registrationConsent = _object({
  'id': _req(_uuid),
  'decision': _req(_oneOf({'given', 'unable'})),
  'method': _req(_oneOf(_methods)),
  'reason': _opt(_syncReason),
  'scriptVersion': _req(_scriptVersion),
  'language': _req(_languageTag),
}, refine: _reasonRequired);

final _privacyNotice = _object({
  'id': _req(_uuid),
  'decision': _req(_oneOf(_noticeDecisions)),
  'reason': _opt(_syncReason),
}, refine: _reasonRequired);

final _matchCheck = _object({
  'checkId': _req(_uuid),
  'where': _req(_oneOf({'phone', 'server', 'both'})),
  'indexVersion': _req(_nullable(_string(max: 40))),
  'shown': _req(_array(_uuid, max: 10)),
  'dismissed': _req(_array(_uuid, max: 10)),
});

const allergyScreens = {'not_asked', 'none_known'};
const idCardChoices = {'not_asked', 'wants', 'declined'};

/// A patient's settable fields and their schemas (FIELD_SCHEMAS.patient in the API).
final Map<String, _Schema> _patientFields = {
  'preferredName': _nullable(_name80),
  'visualDescriptor': _nullable(_text200),
  'livingSituation': _nullable(_livingSituation),
  'usualArea': _nullable(_text200),
  'preferredLanguage': _nullable(_languageTag),
  'allergyScreen': _oneOf(allergyScreens),
  'idCardChoice': _oneOf(idCardChoices),
  'legalName': _nullable(_legalName),
  'birth': _nullable(_birth),
};

/// The fields an intake sets on the server, in its order, and their defaults.
const patientFieldNames = [
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

/// Legal name and birth: changed by an admin's correction, filled by anyone who saw them (D26).
const identityFields = {'legalName', 'birth'};

final _patientCreate = _object({
  for (final name in patientFieldNames) name: _opt(_patientFields[name]!),
  'consent': _req(_registrationConsent),
  'privacyNotice': _req(_privacyNotice),
  'matchCheck': _opt(_matchCheck),
});

final _aliasCreate = _object({'patientId': _req(_uuid), 'alias': _req(_trimmed(1, 60))});

const allergyCategories = {'drug', 'food', 'environment', 'other', 'unknown'};
const allergySeverities = {'mild', 'moderate', 'severe', 'unknown'};

final _allergyCreate = _object({
  'patientId': _req(_uuid),
  'substance': _req(_trimmed(1, 120)),
  'category': _opt(_oneOf(allergyCategories)),
  'reaction': _opt(_nullable(_text200)),
  'severity': _opt(_oneOf(allergySeverities)),
  'encounterId': _opt(_nullable(_uuid)),
});

_Schema _consentOf(String kind, Set<String> decisions) => _object({
  'patientId': _req(_uuid),
  'kind': _req(_oneOf({kind})),
  'decision': _req(_oneOf(decisions)),
  'method': _req(_oneOf(_methods)),
  'scriptVersion': _req(_scriptVersion),
  'language': _req(_languageTag),
  'reason': _opt(_syncReason),
}, refine: _reasonRequired);

final _consentCreate = _union('kind', {
  'care_and_record': _consentOf('care_and_record', {'given', 'unable'}),
  'privacy_notice': _consentOf('privacy_notice', _noticeDecisions),
});

/// ICD-10-CM, checked by shape only, so a code-set update never becomes a sync rejection (9.5).
final icd10cmCode = RegExp(r'^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$');

final _problemCode = _object({
  'system': _req(_oneOf({'icd10cm'})),
  'code': _req(_string(pattern: icd10cmCode)),
  'display': _opt(_trimmed(1, 300)),
});

final _problemCreate = _object(
  {
    'patientId': _req(_uuid),
    'title': _req(_text200),
    'code': _opt(_nullable(_problemCode)),
    'status': _req(_oneOf({'new', 'ongoing'})),
    'sensitive': _opt(_bool),
    'encounterId': _opt(_nullable(_uuid)),
    'onsetDate': _opt(_nullable(_isoDate)),
    'recurrenceOf': _opt(_uuid),
    'resolvedInErrorOf': _opt(_uuid),
  },
  refine: (v, path, issues) {
    if (v.containsKey('recurrenceOf') && v.containsKey('resolvedInErrorOf')) {
      issues.add(_at(path, 'resolvedInErrorOf'));
    }
  },
);

const problemStatuses = ['new', 'ongoing', 'resolved'];

final _problemStatus = _object({
  'status': _req(_oneOf(problemStatuses.toSet())),
  'encounterId': _req(_nullable(_uuid)),
});

final _problemNoteCreate = _object({
  'problemId': _req(_uuid),
  'text': _req(_trimmed(1, 4000)),
  'encounterId': _opt(_nullable(_uuid)),
});

const idLinkReasons = {'first_card', 'lost', 'damaged', 'stolen', 'patient_request', 'other'};

final _idLinkCreate = _object({
  'patientId': _req(_uuid),
  'token': _req(_string(pattern: RegExp(r'^[A-Za-z0-9_-]{22}$'))),
  'replacesLinkId': _req(_nullable(_uuid)),
  'reason': _req(_oneOf(idLinkReasons)),
});

/// Alias removal, allergy or problem entered in error: set once, with a reason.
final _retraction = _object({'reason': _req(_syncReason)});

/// Most patients one offline audit entry may list: Show more displays up to SEARCH_MAX (50).
const auditMaxPatients = 50;

const auditActions = {
  'patient.viewed',
  'patient.searched',
  'patient.match_checked',
  'id_link.copied',
  'encounter.viewed',
  'note.viewed',
};

// PLAN-OPEN: search terms in the audit log (design 14.1, #9, for counsel). Never stored: an entry
// carries which patients a search showed and the criteria used, never the text (D41).
final _auditAppend = _object({
  'action': _req(_oneOf(auditActions)),
  'entity': _opt(_string(pattern: RegExp(r'^[a-z_]{1,40}$'))),
  'entityId': _opt(_uuid),
  'patientId': _opt(_uuid),
  'patientIds': _opt(_array(_uuid, max: auditMaxPatients)),
  'resultCount': _opt(_number(integer: true, min: 0, max: 100000)),
  'criteria': _opt(_array(_oneOf({'name', 'birth_full', 'birth_year', 'descriptor'}), max: 4)),
  'source': _opt(_oneOf({'team_index', 'cache', 'local', 'server'})),
  'checkId': _opt(_uuid),
});

// Phase 2's values (services/api/src/sync/records.ts).

final _location = _object({
  'lat': _req(_number(min: -90, max: 90)),
  'lng': _req(_number(min: -180, max: 180)),
  'accuracyM': _opt(_number(min: 0, max: 100000)),
});

final _encounterCreate = _object({
  'kind': _req(_oneOf({'medical', 'non_medical'})),
  'patientId': _opt(_nullable(_uuid)),
  'location': _opt(_nullable(_location)),
});

/// A note data path (`vitals.temp_c`), as the API's DATA_PATH.
final dataPathPattern = RegExp(r'^[a-z][a-zA-Z0-9_]{0,60}(\.[a-z][a-zA-Z0-9_]{0,60}){0,3}$');

/// The most data fields one note may have (MAX_NOTE_FIELDS in the API).
const maxNoteFields = 300;

void _jsonValue(Object? v, String path, ValueIssues issues) {
  if (storableProblem(v) != null) issues.add(path);
}

final _noteCreate = _object({
  'encounterId': _req(_uuid),
  'noteTypeKey': _req(_string(pattern: RegExp(r'^[a-z][a-z0-9_]{1,60}$'))),
  'noteTypeVersion': _opt(_nullable(_number(integer: true, min: 1))),
  'data': _opt((v, path, issues) {
    if (v is! Map<String, Object?>) return issues.add(path, abort: true);
    for (final MapEntry(:key, :value) in v.entries) {
      if (!dataPathPattern.hasMatch(key)) issues.add(_at(path, key));
      _jsonValue(value, _at(path, key), issues);
    }
    if (v.length > maxNoteFields) issues.add(path);
  }),
});

const _draftStatus = {'draft', 'completed'};

// ------------------------------------------------------------------------------------------------
// Rules a value breaks on its own (values.ts valueProblem)
// ------------------------------------------------------------------------------------------------

/// `birth_in_future`: a date after [today] (YYYY-MM-DD, the server's date) plus one day, or a year
/// after this one.
String? birthProblem(Object? birth, String today) {
  if (birth is! Map<String, Object?>) return null;
  if (birth['precision'] == 'day') {
    final limit = DateTime.parse('${today}T00:00:00Z').add(const Duration(days: 1));
    final date = birth['date']! as String;
    return date.compareTo(limit.toIso8601String().substring(0, 10)) > 0 ? 'birth_in_future' : null;
  }
  return (birth['year']! as num) > int.parse(today.substring(0, 4)) ? 'birth_in_future' : null;
}

/// `living_other_text`: the text goes with Other and only with Other.
String? livingProblem(Object? living) {
  if (living is! Map<String, Object?>) return null;
  return (living['kind'] == 'other') == living.containsKey('other') ? null : 'living_other_text';
}

// ------------------------------------------------------------------------------------------------
// The registry
// ------------------------------------------------------------------------------------------------

/// The rules of one kind of synced record.
class EntityRules {
  const EntityRules._({
    required this.entity,
    required this.category,
    required this.pausesWithClock,
    required this.patientSide,
    required this._create,
    required this._fields,
    required this._permission,
    required this._parents,
    this._parentsOfSet,
    this._createdFields,
    this._attributes,
    this._initialStatus,
  });

  final String entity;

  /// The outbox category (module 9's unsynced summary): `patients` for a patient and everything
  /// that registers or identifies them, `problems` for the problem list.
  final String category;

  /// Waits while the clock check fails (D35): what device time decides (problems, notes, ID links,
  /// encounters). Registering the person in front of you never waits for it.
  final bool pausesWithClock;

  /// About one patient (`records.patient_id`), and kept on the phone by that patient's scopes and
  /// local work (design 2.9-6).
  final bool patientSide;

  final _Schema _create;
  final Map<String, (_Schema, FieldClass)> _fields;
  final String Function(String op, String? field) _permission;
  final List<ParentRef> Function(Map<String, Object?> v) _parents;
  final List<ParentRef> Function(String field, Object? v)? _parentsOfSet;
  final Map<String, Object?> Function(Map<String, Object?> v)? _createdFields;
  final Map<String, Object?> Function(Map<String, Object?> v)? _attributes;
  final String Function(Map<String, Object?> v)? _initialStatus;

  /// Where a create's value breaks its schema; empty when it is valid.
  Set<String> createIssues(Object? value) {
    final issues = ValueIssues();
    _create(value, '', issues);
    return issues.paths;
  }

  /// Whether [field] can be set at all.
  bool settable(String field) => _schemaOf(field) != null;

  (_Schema, FieldClass)? _schemaOf(String field) {
    if (entity == entityNote && field.startsWith('data.') && dataPathPattern.hasMatch(field.substring(5))) {
      return (_jsonValue, FieldClass.draft);
    }
    return _fields[field];
  }

  /// Where a set's value breaks the field's schema; null when the field can't be set.
  Set<String>? fieldIssues(String field, Object? value) {
    final schema = _schemaOf(field);
    if (schema == null) return null;
    final issues = ValueIssues();
    schema.$1(value, '', issues);
    return issues.paths;
  }

  FieldClass? fieldClass(String field) => _schemaOf(field)?.$2;

  /// The rule a valid value breaks on its own, as the server's `details.problem`: a patient create
  /// with nothing to recognise, a birth in the future, Other without its text. [today] is the
  /// date the rule is checked on (the server's; the phone's corrected date before it sends).
  String? valueProblem(String op, String? field, Object? value, String today) {
    if (entity != entityPatient) return null;
    if (op == 'create') {
      final v = value! as Map<String, Object?>;
      if (!isRecognisable(v)) return 'nothing_to_recognise';
      return birthProblem(v['birth'], today) ?? livingProblem(v['livingSituation']);
    }
    if (field == 'birth') return birthProblem(value, today);
    if (field == 'livingSituation') return livingProblem(value);
    return null;
  }

  /// The catalog key a change needs (D37); the server holds the change for review without it.
  String permission(String op, [String? field]) => _permission(op, field);

  /// The records a valid create names, in the server's order.
  List<ParentRef> parentsOfCreate(Map<String, Object?> value) => _parents(value);

  /// The records a valid set's value names: a problem status's encounter, an encounter's patient.
  List<ParentRef> parentsOfSet(String field, Object? value) => _parentsOfSet?.call(field, value) ?? const [];

  /// The fields a create sets on the server, each at version 1, with their values.
  Map<String, Object?> createdFields(Map<String, Object?> value) => _createdFields?.call(value) ?? const {};

  /// What a create records that no set changes, as the phone keeps it with the record.
  Map<String, Object?> attributes(Map<String, Object?> value) => _attributes?.call(value) ?? {...value};

  /// The record's status right after its create.
  String initialStatus(Map<String, Object?> value) => _initialStatus?.call(value) ?? 'active';

  /// The record's status after [field] takes [value], when the field decides it.
  String? statusAfter(String field, Object? value) {
    if (field == 'status') return value is Map<String, Object?> ? value['status'] as String? : value as String?;
    if (field == 'removal') return 'removed';
    if (field == 'enteredInError' && entity == entityAllergy) return 'entered_in_error';
    return null;
  }

  /// The patient a create is about, when its value says (a problem note's is its problem's).
  String? patientOfCreate(String recordId, Map<String, Object?> value) => switch (entity) {
    entityPatient => recordId,
    entityEncounter ||
    entityAlias ||
    entityAllergy ||
    entityConsent ||
    entityProblem ||
    entityIdLink => value['patientId'] as String?,
    _ => null,
  };
}

List<ParentRef> _refs(List<(String, Object?)> named) => [
  for (final (entity, id) in named)
    if (id is String) (entity: entity, id: id),
];

const _chart = 'encounters.chart';
const _edit = 'patients.edit';

final Map<String, EntityRules> _registry = {
  entityEncounter: EntityRules._(
    entity: entityEncounter,
    category: 'encounters',
    pausesWithClock: true,
    patientSide: false,
    create: _encounterCreate,
    fields: {
      'patientId': (_nullable(_uuid), FieldClass.draft),
      'location': (_nullable(_location), FieldClass.draft),
      'status': (_oneOf(_draftStatus), FieldClass.draft),
    },
    permission: (_, _) => _chart,
    parents: (v) => _refs([(entityPatient, v['patientId'])]),
    parentsOfSet: (field, v) => field == 'patientId' ? _refs([(entityPatient, v)]) : const [],
    createdFields: (v) => {'patientId': v['patientId'], 'location': v['location'], 'status': 'draft'},
    attributes: (v) => {'kind': v['kind']},
    initialStatus: (_) => 'draft',
  ),
  entityNote: EntityRules._(
    entity: entityNote,
    category: 'notes',
    pausesWithClock: true,
    patientSide: false,
    create: _noteCreate,
    fields: {'status': (_oneOf(_draftStatus), FieldClass.draft)},
    permission: (_, _) => _chart,
    parents: (v) => _refs([(entityEncounter, v['encounterId'])]),
    createdFields: (v) => {
      'status': 'draft',
      for (final MapEntry(:key, :value) in ((v['data'] as Map<String, Object?>?) ?? const {}).entries)
        'data.$key': value,
    },
    attributes: (v) => {
      for (final name in ['encounterId', 'noteTypeKey', 'noteTypeVersion']) name: v[name],
    },
    initialStatus: (_) => 'draft',
  ),
  entityPatient: EntityRules._(
    entity: entityPatient,
    category: 'patients',
    pausesWithClock: false,
    patientSide: true,
    create: _patientCreate,
    fields: {
      for (final MapEntry(:key, :value) in _patientFields.entries)
        key: (value, identityFields.contains(key) ? FieldClass.identity : FieldClass.keepBoth),
    },
    permission: (_, _) => _edit,
    parents: (_) => const [],
    createdFields: (v) => {
      for (final name in patientFieldNames)
        name: v[name] ?? (name == 'allergyScreen' || name == 'idCardChoice' ? 'not_asked' : null),
    },
    attributes: (v) => {
      for (final MapEntry(:key, :value) in v.entries)
        if (!_patientFields.containsKey(key)) key: value,
    },
  ),
  entityAlias: EntityRules._(
    entity: entityAlias,
    category: 'patients',
    pausesWithClock: false,
    patientSide: true,
    create: _aliasCreate,
    fields: {'removal': (_retraction, FieldClass.setOnce)},
    permission: (_, _) => _edit,
    parents: (v) => _refs([(entityPatient, v['patientId'])]),
  ),
  entityAllergy: EntityRules._(
    entity: entityAllergy,
    category: 'patients',
    pausesWithClock: false,
    patientSide: true,
    create: _allergyCreate,
    fields: {'enteredInError': (_retraction, FieldClass.setOnce)},
    // Recording an allergy registers what the patient says; retracting one is a clinical judgment.
    permission: (op, _) => op == 'create' ? _edit : _chart,
    parents: (v) => _refs([(entityPatient, v['patientId']), (entityEncounter, v['encounterId'])]),
  ),
  entityConsent: EntityRules._(
    entity: entityConsent,
    category: 'patients',
    pausesWithClock: false,
    patientSide: true,
    create: _consentCreate,
    fields: const {},
    permission: (_, _) => _edit,
    parents: (v) => _refs([(entityPatient, v['patientId'])]),
    initialStatus: (_) => 'recorded',
  ),
  entityProblem: EntityRules._(
    entity: entityProblem,
    category: 'problems',
    pausesWithClock: true,
    patientSide: true,
    create: _problemCreate,
    fields: {'status': (_problemStatus, FieldClass.status), 'enteredInError': (_retraction, FieldClass.setOnce)},
    permission: (_, _) => _chart,
    parents: (v) => _refs([
      (entityPatient, v['patientId']),
      (entityEncounter, v['encounterId']),
      (entityProblem, v['recurrenceOf']),
      (entityProblem, v['resolvedInErrorOf']),
    ]),
    parentsOfSet: (field, v) =>
        field == 'status' && v is Map<String, Object?> ? _refs([(entityEncounter, v['encounterId'])]) : const [],
    createdFields: (v) => {
      'status': {'status': v['status'], 'encounterId': v['encounterId']},
    },
    attributes: (v) => {...v}..remove('status'),
    initialStatus: (v) => v['status']! as String,
  ),
  entityProblemNote: EntityRules._(
    entity: entityProblemNote,
    category: 'problems',
    pausesWithClock: true,
    patientSide: true,
    create: _problemNoteCreate,
    fields: const {},
    permission: (_, _) => _chart,
    parents: (v) => _refs([(entityProblem, v['problemId']), (entityEncounter, v['encounterId'])]),
    initialStatus: (_) => 'recorded',
  ),
  entityIdLink: EntityRules._(
    entity: entityIdLink,
    category: 'patients',
    pausesWithClock: true,
    patientSide: true,
    create: _idLinkCreate,
    fields: const {},
    permission: (_, _) => _edit,
    parents: (v) => _refs([(entityPatient, v['patientId'])]),
    // The token stays in the outbox value until confirmed and in id_links, never in a record.
    attributes: (v) => {...v}..remove('token'),
    initialStatus: (_) => 'pending',
  ),
};

/// The rules of a change's entity; null for an activity log entry, which is no record.
EntityRules? rulesFor(String entity) => _registry[entity];

/// Every entity a record can be.
Iterable<String> get recordEntities => _registry.keys;

/// The outbox category of a change's entity.
String categoryOf(String entity) => _registry[entity]?.category ?? 'activity';

/// Where an offline audit entry breaks the API's AuditAppend; empty when it is valid.
Set<String> auditIssues(Object? value) {
  final issues = ValueIssues();
  _auditAppend(value, '', issues);
  return issues.paths;
}

/// The records a change names (design 2.9-2): for a create, its parents; for a set, what its value
/// names. A valid value is assumed; anything else names nothing.
List<ParentRef> parentsOf({required String entity, required String op, String? field, Object? value}) {
  final rules = rulesFor(entity);
  if (rules == null) return const [];
  if (op == 'create') return value is Map<String, Object?> ? rules.parentsOfCreate(value) : const [];
  if (op == 'set' && field != null) return rules.parentsOfSet(field, value);
  return const [];
}

// ------------------------------------------------------------------------------------------------
// Identity fields (design 2.4): what a fill is
// ------------------------------------------------------------------------------------------------

int _birthYear(Map<String, Object?> b) =>
    b['precision'] == 'day' ? int.parse((b['date']! as String).substring(0, 4)) : (b['year']! as num).toInt();

/// [next] keeps every recorded part of [cur] and only adds to it: a legal name part that was
/// missing; a year made a date in that year; an estimate made a year or a date within
/// [estimateRange] of it. (fields.ts `fills`.)
bool fills(String field, Object? cur, Object? next) {
  if (next == null || cur is! Map<String, Object?> || next is! Map<String, Object?>) return false;
  if (field == 'legalName') {
    return (cur['given'] == null || next['given'] == cur['given']) &&
        (cur['family'] == null || next['family'] == cur['family']);
  }
  if (cur['precision'] == 'year') return next['precision'] == 'day' && _birthYear(next) == cur['year'];
  if (cur['precision'] == 'estimated') {
    return next['precision'] != 'estimated' && (_birthYear(next) - _birthYear(cur)).abs() <= estimateRange;
  }
  return false;
}

/// An estimate refined to a stated year or date further away than [estimateRange]: sent, and kept
/// for an admin to check (design 11.5).
bool refinedOutOfRange(Object? cur, Object? next) =>
    cur is Map<String, Object?> &&
    next is Map<String, Object?> &&
    cur['precision'] == 'estimated' &&
    next['precision'] != 'estimated' &&
    (_birthYear(next) - _birthYear(cur)).abs() > estimateRange;

/// records.ts isBlank: an empty object is blank too.
bool isBlankValue(Object? v) => v == null || v == '' || (v is List && v.isEmpty) || (v is Map && v.isEmpty);

/// Defaults that record nothing yet: an allergy screen or ID card choice "not asked" is blank.
bool isBlankField(String field, Object? value) =>
    ((field == 'allergyScreen' || field == 'idCardChoice') && value == 'not_asked') || isBlankValue(value);

/// Problem statuses in the order they move (design 9.2): only an admin moves one back.
int problemStatusRank(Object? status) => problemStatuses.indexOf(status! as String);
