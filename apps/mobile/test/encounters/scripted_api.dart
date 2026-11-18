import 'package:sineobex_field/api/transport.dart';

/// The API's encounter routes as a test scripts them (lifecycle 5): the phone's test server has none
/// of them yet, so a test answers each request it expects with the answer's JSON as the API gives it
/// (services/api/src/encounters, the contract's schemas), or with the API's refusal.
class ScriptedApi implements ApiTransport {
  /// The answers, by method and path; a request with none is a 404, as the API's router answers.
  final answers = <(String, String), Object? Function(Object? body)>{};

  /// What was asked, in order.
  final asked = <({String method, String path, Map<String, String>? query, Object? body})>[];

  /// No signal: every request fails as the transport fails without one.
  bool offline = false;

  void on(String method, String path, Object? Function(Object? body) answer) => answers[(method, path)] = answer;

  /// Answers [method] [path] with the API's refusal.
  void refuse(String method, String path, int status, String code, {Map<String, Object?>? details}) =>
      on(method, path, (_) => throw ApiException(status, code, 'Refused.', details: details));

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    if (offline) throw const NetworkException('offline');
    asked.add((method: method, path: path, query: query, body: body));
    final answer = answers[(method, path)];
    if (answer == null) throw ApiException(404, 'not_found', 'no route $method $path');
    return answer(body);
  }
}

/// Someone a read names, as `UserRef`.
Map<String, Object?> userRef(String userId, String name) => {'userId': userId, 'displayName': name};

/// A note of a visit read (`VisitNote`), its trail empty unless given.
Map<String, Object?> visitNoteJson({
  required String noteId,
  required Map<String, Object?> author,
  Map<String, Object?>? actingAuthor,
  String key = 'test_medical',
  int version = 1,
  String title = 'Test medical',
  String group = 'clinical',
  String status = 'completed',
  String attestation = 'not_needed',
  String? completedAt = '2026-10-19T16:00:00.000Z',
  String? contentHash,
  List<Map<String, Object?>> sections = const [],
  List<Map<String, Object?>> signoffs = const [],
  List<Map<String, Object?>> addenda = const [],
  List<Map<String, Object?>> corrections = const [],
  List<Map<String, Object?>> attestations = const [],
}) => {
  'noteId': noteId,
  'noteTypeKey': key,
  'noteTypeVersion': version,
  'title': title,
  'group': group,
  'status': status,
  'attestation': attestation,
  'author': author,
  'actingAuthor': actingAuthor ?? author,
  'completedAt': completedAt,
  'contentHash': ?contentHash,
  'read': {'sections': sections},
  'signoffs': signoffs,
  'addenda': addenda,
  'corrections': corrections,
  'attestations': attestations,
};

/// A sign-off as the visit read gives it (`SignoffView`).
Map<String, Object?> signoffJson({
  required String id,
  required Map<String, Object?> signer,
  String act = 'complete',
  String effect = 'completed',
  String credential = 'student',
  String signedAt = '2026-10-19T16:00:00.000Z',
  bool needsAttestation = false,
}) => {
  'id': id,
  'act': act,
  'effect': effect,
  'signer': signer,
  'credential': credential,
  'claimedCredential': null,
  'signedAt': signedAt,
  'clockVerified': true,
  'statementVersion': act == 'complete' ? 'complete-2026-11' : '$act-2026-11',
  'needsAttestation': needsAttestation,
};

/// A visit read (`VisitRead`).
Map<String, Object?> visitJson({
  required String encounterId,
  String? patientId,
  String kind = 'medical',
  String status = 'completed',
  String startedAt = '2026-10-19T15:00:00.000Z',
  bool clockVerified = true,
  String? locationText,
  String? summary,
  List<Map<String, Object?>> addenda = const [],
  List<Map<String, Object?>> notes = const [],
  List<Map<String, Object?>> records = const [],
}) => {
  'encounterId': encounterId,
  'patientId': patientId,
  'kind': kind,
  'status': status,
  'startedAt': startedAt,
  'clockVerified': clockVerified,
  'locationText': locationText,
  'summary': ?summary,
  'addenda': addenda,
  'notes': notes,
  'records': records,
};
