import 'dart:async';
import 'dart:convert';

import 'package:sineobex_field/api/transport.dart';
import 'package:sqlite3/sqlite3.dart';

/// `GET /v1/presets` answered as each test writes the answer, so the phone's rules (phase 5 design
/// 6.1) are held to answers the test chose: a reset, another epoch, a row it can't read, a 403, an
/// answer cut off or late. The test server's own route (P2-fake) is held to the API's by its parity
/// cases; these tests don't need it. Every other request goes to the transport given, if any.
class PresetsStandIn {
  /// Every pull, oldest first: the team it asked in and its query.
  final requests = <({String teamId, Map<String, String> query})>[];

  /// What each team's pulls answer, read when a pull arrives: an answer's JSON, or an exception
  /// thrown in its place. Kept for every pull until a test replaces it.
  final answers = <String, Object>{};

  /// While a team has one, its pulls wait for it to complete (an answer on its way).
  final holds = <String, Completer<void>>{};

  /// The pulls of [teamId].
  List<Map<String, String>> queriesOf(String teamId) => [
    for (final r in requests)
      if (r.teamId == teamId) r.query,
  ];

  ApiTransport transportFor(String teamId, {ApiTransport? inner}) => _Transport(this, teamId, inner);
}

class _Transport implements ApiTransport {
  _Transport(this.standIn, this.teamId, this.inner);
  final PresetsStandIn standIn;
  final String teamId;
  final ApiTransport? inner;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    if (method != 'GET' || path != '/v1/presets') {
      final next = inner;
      if (next == null) throw ApiException(404, 'not_found', 'no route $method $path');
      return next.send(method, path, query: query, body: body);
    }
    standIn.requests.add((teamId: teamId, query: {...?query}));
    // The answer as it was when the pull arrived, however long it then takes to come back.
    final answer = standIn.answers[teamId];
    await standIn.holds[teamId]?.future;
    if (answer == null) throw StateError('No answer written for $teamId.');
    if (answer is Exception) throw answer;
    // Through JSON, as HTTP carries it.
    return jsonDecode(jsonEncode(answer));
  }
}

/// Made-up epochs: the one a team's copy came from, another (a restored database), and the nil
/// UUID of a team that has taken no revision.
const epochA = '00000000-0000-4000-8000-0000000e0001';
const epochB = '00000000-0000-4000-8000-0000000e0002';
const nilEpoch = '00000000-0000-0000-0000-000000000000';

/// Made-up preset ids.
const labsId = '00000000-0000-4000-8000-00000000c001';
const suppliesId = '00000000-0000-4000-8000-00000000c002';
const glucoseId = '00000000-0000-4000-8000-00000000a001';
const gauzeId = '00000000-0000-4000-8000-00000000a002';
const footCheckId = '00000000-0000-4000-8000-00000000b001';
const frostRiskId = '00000000-0000-4000-8000-00000000f001';
const highId = '00000000-0000-4000-8000-00000000f002';
const settingsId = '00000000-0000-4000-8000-000000005001';

/// A pull's answer (`PresetsPull`), as the API writes one.
Map<String, Object?> pullAnswer({
  required int revision,
  String epoch = epochA,
  bool reset = false,
  List<Map<String, Object?>> presets = const [],
}) => {'reset': reset, 'revision': revision, 'epoch': epoch, 'presets': presets};

/// One preset of an answer (`PulledPreset`).
Map<String, Object?> pulled(
  String id,
  String kind,
  Map<String, Object?> body, {
  int version = 1,
  String state = 'active',
  String? originKey,
}) => {'id': id, 'kind': kind, 'state': state, 'version': version, 'originKey': originKey, 'body': body};

// Bodies in the shapes of packages/presets/src/schemas.ts, named as in the Done when's story.

Map<String, Object?> labs() => {'name': 'Demo: Labs', 'behaviour': 'lab', 'sort': 30};

Map<String, Object?> supplies() => {'name': 'Demo: Supplies', 'behaviour': 'supply', 'sort': 40};

Map<String, Object?> glucose({String name = 'Demo: Glucose test'}) => {
  'name': name,
  'categoryId': labsId,
  'unit': 'test',
  'medical': true,
  'captureLot': false,
  'result': {'type': 'number', 'unit': 'mg/dL'},
};

Map<String, Object?> gauze() => {
  'name': 'Demo: Gauze',
  'categoryId': suppliesId,
  'unit': 'each',
  'medical': false,
  'captureLot': false,
  'result': null,
};

Map<String, Object?> footCheck() => {
  'name': 'Demo: Foot check',
  'medical': true,
  'prompt': '',
  'lines': [
    {'itemId': glucoseId, 'qty': 1, 'core': true},
  ],
};

Map<String, Object?> frostRisk() => {
  'name': 'Demo: Frost risk',
  'tier': 'secondary',
  'criteria': '',
  'color': 'blue',
  'rank': 10,
  'sensitive': false,
};

Map<String, Object?> high() => {
  'name': 'Demo: High',
  'tier': 'primary',
  'criteria': 'Demo: criteria for people to read.',
  'color': 'red',
  'rank': 10,
  'sensitive': false,
};

Map<String, Object?> teamSettings({int problemCheckDays = 90}) => {
  'name': 'Team settings',
  'bagMinimumsOn': false,
  'newBagMinimums': <Object?>[],
  'problemCheckDays': problemCheckDays,
};

/// Everything a team database holds of its presets copy, read straight from the file: each row by
/// id, and every key of its bookkeeping (under `presets.`).
Map<String, Object?> copyIn(Database db) => {
  'rows': {
    for (final r in db.select('SELECT id, kind, version, state, origin_key, body_json FROM presets'))
      r['id']! as String: [r['kind'], r['version'], r['state'], r['origin_key'], jsonDecode(r['body_json']! as String)],
  },
  'keys': {
    for (final r in db.select("SELECT key, value FROM kv WHERE key LIKE 'presets.%'")) r['key']! as String: r['value'],
  },
};

/// Every write of [id] to the presets table fails from now on, as a full disk or a killed app cuts
/// a write short, until [writesWork].
void failWritesOf(Database db, String id) => db
  ..execute(
    "CREATE TRIGGER fail_insert BEFORE INSERT ON presets WHEN NEW.id = '$id' "
    "BEGIN SELECT RAISE(ABORT, 'demo: the write failed'); END",
  )
  ..execute(
    "CREATE TRIGGER fail_update BEFORE UPDATE ON presets WHEN NEW.id = '$id' "
    "BEGIN SELECT RAISE(ABORT, 'demo: the write failed'); END",
  );

void writesWork(Database db) => db
  ..execute('DROP TRIGGER fail_insert')
  ..execute('DROP TRIGGER fail_update');
