import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/sync/canonical_json.dart';

/// One note type version as the presets file and the one-version route carry it.
typedef Version = Map<String, Object?>;

/// The fixture note types with their hashes (golden_sample.json, written by the forms package's
/// golden test): real definitions, as the server and the bundled presets hand them to the phone.
List<Version> sampleVersions() {
  final sample = jsonDecode(File('test/forms/golden_sample.json').readAsStringSync()) as Map<String, Object?>;
  return (sample['presets']! as List<Object?>).cast<Version>();
}

/// The sample version of [key] at [version].
Version sampleVersion(String key, int version) =>
    sampleVersions().firstWhere((v) => v['key'] == key && v['version'] == version);

/// [v] with its definition changed and its hash made again, as a team's own edit would be.
Version edited(Version v, String title) {
  final definition = {...v['definition']! as Map<String, Object?>, 'title': title};
  return {...v, 'definition': definition, 'hash': valueHash(definition)};
}

/// The two forms routes (phase 4 design, forms 3.3) as the API answers them, for each team, in
/// front of another transport that answers everything else (the fake sync server).
class FakeFormsServer {
  /// Each team's versions. The list names each key's newest. A team with no entry is not the
  /// person's: both routes refuse it.
  final teams = <String, List<Version>>{};

  /// No answer from the forms routes (the rest of the API still answers).
  bool offline = false;

  /// What the one-version route answers in place of the version itself, by 'key/version'. An
  /// exception is thrown.
  final answers = <String, Object?>{};

  /// Requests to a path wait until its completer completes.
  final holds = <String, Completer<void>>{};

  /// Removes [key] from [teamId]'s note types, as an admin's Remove does (phase 5 design 6.3, 7):
  /// the list names it no more, and the one-version route still serves every version of it, so a
  /// draft begun on one still opens and finishes.
  ///
  /// Written ahead of its code (card P4-tests): it throws until card P4-offered teaches the fake
  /// the rule, beside the API's own list.
  void archive(String teamId, String key) => throw UnimplementedError('P4-offered');

  /// The forms requests, in order, answered or not.
  final requests = <String>[];

  int get listRequests => requests.where((r) => r == listPath).length;
  List<String> get versionRequests => [
    for (final r in requests)
      if (r != listPath) r.substring(listPath.length + 1),
  ];

  static const listPath = '/v1/forms/note-types';

  ApiTransport transportFor(String teamId, [ApiTransport? inner]) => _FormsTransport(this, teamId, inner);

  Future<Object?> _handle(String teamId, String method, String path) async {
    requests.add(path);
    if (offline) throw const NetworkException('offline');
    final hold = holds[path];
    if (hold != null) await hold.future;
    // As the API's team scope: a team the person isn't in is refused, not answered empty (a test
    // that wants an empty list sets `teams[id] = []`).
    final versions = teams[teamId];
    if (versions == null) throw const ApiException(403, 'not_a_member', 'You are not a member of this team.');
    if (path == listPath) {
      final newest = <String, Version>{};
      for (final v in versions) {
        final held = newest[v['key']];
        if (held == null || (held['version']! as int) < (v['version']! as int)) newest[v['key']! as String] = v;
      }
      final keys = newest.keys.toList()..sort();
      return {
        'noteTypes': [
          for (final key in keys)
            {
              'key': key,
              'version': newest[key]!['version'],
              'title': (newest[key]!['definition']! as Map<String, Object?>)['title'],
              'kinds': (newest[key]!['definition']! as Map<String, Object?>)['kinds'],
              'sensitivity': (newest[key]!['definition']! as Map<String, Object?>)['sensitivity'],
              'quick': (newest[key]!['definition']! as Map<String, Object?>)['quick'] ?? false,
              'auto': (newest[key]!['definition']! as Map<String, Object?>)['auto'],
              'hash': newest[key]!['hash'],
            },
        ],
      };
    }
    final name = path.substring(listPath.length + 1);
    if (answers.containsKey(name)) {
      final answer = answers[name];
      if (answer is Exception) throw answer;
      return answer;
    }
    final parts = name.split('/');
    final found = versions.where((v) => v['key'] == parts[0] && '${v['version']}' == parts[1]).firstOrNull;
    if (found == null) throw const ApiException(404, 'not_found', 'Not found.');
    return jsonDecode(jsonEncode(found));
  }
}

class _FormsTransport implements ApiTransport {
  _FormsTransport(this.server, this.teamId, this.inner);
  final FakeFormsServer server;
  final String teamId;
  final ApiTransport? inner;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) {
    if (path.startsWith(FakeFormsServer.listPath)) return server._handle(teamId, method, path);
    final next = inner;
    if (next == null) throw StateError('No route for $path');
    return next.send(method, path, query: query, body: body);
  }
}
