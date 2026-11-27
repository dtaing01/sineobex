import 'dart:convert';
import 'dart:io';

import 'package:uuid/uuid.dart';

import '../sync/fake_server.dart';

/// The platform's presets (packages/presets/data/platform.json, phase 5 design 4.6), each origin key
/// at its newest platform version, in the order the file first names the key.
List<Map<String, Object?>> newestPlatformPresets() {
  final platform = (jsonDecode(File('../../packages/presets/data/platform.json').readAsStringSync()) as List<Object?>)
      .cast<Map<String, Object?>>();
  final newest = <String, Map<String, Object?>>{};
  for (final e in platform) {
    final key = e['originKey']! as String;
    if (((newest[key]?['platformVersion'] as int?) ?? 0) < (e['platformVersion']! as int)) newest[key] = e;
  }
  return [...newest.values];
}

/// [body], a platform body of [kind], with each origin key it holds where an ID goes put as the
/// team's ID in [ids], as the installer's `withIds` (packages/presets/src/install.ts) puts it.
Map<String, Object?> platformBodyWithIds(String kind, Map<String, Object?> body, Map<String, String> ids) {
  Object? id(Object? value) => value is String ? ids[value] ?? value : value;
  Map<String, Object?> lines(String field) => {
    field: [
      for (final line in (body[field]! as List<Object?>).cast<Map<String, Object?>>())
        {...line, 'itemId': id(line['itemId'])},
    ],
  };
  final copy = jsonDecode(jsonEncode(body)) as Map<String, Object?>;
  return switch (kind) {
    'item' => {...copy, 'categoryId': id(copy['categoryId'])},
    'bundle' || 'field_supply_map' || 'condition_supply_map' => {...copy, ...lines('lines')},
    'bag' => {...copy, ...lines('minimums')},
    'settings' => {...copy, ...lines('newBagMinimums')},
    _ => copy,
  };
}

/// Gives [teamId] on the phone's test server every platform preset, as the preset installer gives a
/// new team its copies (design 5.2; `installTeamPresets`): each origin key at its newest platform
/// version, a copy at version 1 under an ID of the team's own, its body naming the team's presets by
/// those IDs in place of origin keys, all under one revision, the team's next. Through the test
/// server's own way of holding a team's presets ([FakeSyncServer.presetsOf]). A helper of the tests,
/// not a rule the test server mirrors: it mirrors no installer (fake_server.dart, phase 5). Returns
/// the team's ID of each copy, by origin key.
Map<String, String> givePlatformPresets(FakeSyncServer server, String teamId) {
  final newest = newestPlatformPresets();
  final ids = {for (final e in newest) e['originKey']! as String: const Uuid().v4()};
  final revision = server.takePresetRevision(teamId);
  final team = server.presetsOf(teamId);
  for (final e in newest) {
    final key = e['originKey']! as String;
    final kind = e['kind']! as String;
    team.heads[ids[key]!] = FakePreset(ids[key]!, kind, key)
      ..versions[1] = platformBodyWithIds(kind, e['body']! as Map<String, Object?>, ids)
      ..currentVersion = 1
      ..revision = revision;
  }
  return ids;
}
