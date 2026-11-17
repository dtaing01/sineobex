import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show AssetBundle, rootBundle;
import 'package:path/path.dart' as p;

import '../sync/canonical_json.dart';
import 'definition.dart';

/// One version a team's list names (phase 4 design, forms 3.3): enough to find its definition.
/// The list's other fields are the definition's own, so the phone reads them from the definition.
@immutable
class ListedVersion {
  const ListedVersion({required this.key, required this.version, required this.hash});

  final String key;
  final int version;

  /// SHA-256 of the definition's canonical JSON.
  final String hash;

  Map<String, Object?> toJson() => {'key': key, 'version': version, 'hash': hash};
}

/// A definition the phone will not keep: not the one its team's list names, or not one this app
/// can read. Says which version and why, and nothing else (a definition holds no patient data).
class DefinitionRefused implements Exception {
  const DefinitionRefused(this.key, this.version, this.reason);

  final String key;
  final int version;
  final String reason;

  @override
  String toString() => 'DefinitionRefused($key v$version: $reason)';
}

/// A team's list as the phone last fetched it, each version with its definition, in the list's
/// order (by key).
@immutable
class TeamNoteTypes {
  TeamNoteTypes(List<NoteTypeDef> listed) : listed = List.unmodifiable(listed);

  final List<NoteTypeDef> listed;

  /// The definition a new note of [key] starts on, only when [version] is the one the list names:
  /// a phone starts a note only on a key and version from the team's list (forms 3.4).
  NoteTypeDef? startable(String key, int version) =>
      listed.where((d) => d.key == key && d.version == version).firstOrNull;
}

/// The phone's copy of its teams' note type definitions (phase 4 design, forms 3.4).
///
/// A definition is looked for in the bundled presets (`assets/forms/presets.json`) first, then in
/// plain JSON files under [directory], one per person, team, key and version. Definitions hold no
/// patient data, so they are not encrypted and are readable before an unlock; they are still the
/// team's data, kept beside the team's databases and deleted with them: at sign-out
/// ([forgetUser]) and at a wipe ([forgetTeam]).
///
/// Each version file names the hash the team's list gave for that version, and holds the
/// definition itself unless a bundled preset has that hash. A team's own version can share a key
/// and version with a preset (forms 3.2 never overwrites a row with another hash), so the hash, not
/// the key and version, picks the definition. Nothing is kept whose hash is not the one asked for,
/// or that [NoteTypeDef.fromJson] cannot read; a file changed on disk is ignored and deleted.
///
/// Every version a team ever listed is kept, so a draft started on an older version still opens
/// offline after the list moves on.
class DefinitionStore extends ChangeNotifier {
  DefinitionStore({required this.directory, required this.presets});

  /// Where the files live (the app's support folder, beside the databases).
  final Future<String> Function() directory;

  /// The bundled presets, decoded: a list of `{key, version, hash, definition}` ([bundledPresets]).
  final Future<List<Object?>> Function() presets;

  /// The presets file the export writes, from the app's assets.
  static Future<List<Object?>> bundledPresets([AssetBundle? bundle]) async =>
      jsonDecode(await (bundle ?? rootBundle).loadString('assets/forms/presets.json')) as List<Object?>;

  Future<Map<String, Map<String, Object?>>>? _presets;

  /// [_presets] once read. Handed back as it is, not through the future: a future's callbacks run
  /// in the zone that made it, and a widget test signs in on its fake clock (whose callbacks run
  /// only when it pumps) and syncs in real time.
  Map<String, Map<String, Object?>>? _presetsRead;

  /// Definitions read and checked, by hash.
  final _read = <String, NoteTypeDef>{};

  /// Version files read and checked in this run of the app, with the hash each holds.
  final _checked = <String, String>{};

  /// Teams' lists as read, by folder.
  final _teams = <String, TeamNoteTypes?>{};

  /// Bumped when every file of a person's is deleted ([forgetUser]), by person.
  final _people = <String, int>{};

  /// Bumped when one team's files are deleted ([forgetTeam]), by person and team.
  final _forgotten = <String, int>{};

  /// Bumped when a team's files are written ([keep], [keepList]), by person and team.
  final _written = <String, int>{};

  /// Changes whenever [userId]'s files of [teamId] are deleted: at sign-out, and at a wipe of that
  /// team. A fetch takes it when it starts and hands it to [keep] and [keepList], which write
  /// nothing when it has changed meanwhile: a download still on its way at sign-out must not write
  /// the team's data back. A wipe of one team leaves the others' fetches alone.
  int generation(String userId, String teamId) =>
      (_people[_who(userId)] ?? 0) + (_forgotten[_teamKey(userId, teamId)] ?? 0);

  /// The team's list with each version's definition; null when this phone holds no list for the
  /// team (Start then asks to connect once). A version whose definition is missing or changed on
  /// disk is left out until the next fetch brings it back.
  Future<TeamNoteTypes?> team(String userId, String teamId) async {
    final key = _teamKey(userId, teamId);
    final began = (generation(userId, teamId), _written[key] ?? 0);
    final folder = _teamFolder(await directory(), userId, teamId);
    if (_teams.containsKey(folder)) return _teams[folder];
    final listed = _readList(folder);
    TeamNoteTypes? team;
    if (listed != null) {
      final defs = <NoteTypeDef>[];
      for (final v in listed) {
        final def = await _resolve(folder, v.key, v.version, v.hash);
        if (def != null) defs.add(def);
      }
      team = TeamNoteTypes(defs);
    }
    // A list kept, or the files deleted, while this read waited: what it read is older than what
    // is there now, and must not be what the screens are given from now on.
    if ((generation(userId, teamId), _written[key] ?? 0) != began) return this.team(userId, teamId);
    return _teams[folder] = team;
  }

  /// The team's definition of [key] at [version], from the presets or the files: any version the
  /// team listed or the phone downloaded for it, listed now or not. Null when the phone doesn't
  /// hold it.
  Future<NoteTypeDef?> definition(String userId, String teamId, String key, int version) async {
    final folder = _teamFolder(await directory(), userId, teamId);
    return _resolve(folder, key, version, null);
  }

  /// Whether the phone holds the definition [listed] names, for the team: then nothing needs
  /// downloading for it.
  Future<bool> holds(String userId, String teamId, ListedVersion listed) async {
    final folder = _teamFolder(await directory(), userId, teamId);
    _checkKey(listed.key, listed.version);
    return await _definitionFor(folder, listed.key, listed.version, listed.hash) != null;
  }

  /// Keeps [definition] as the team's version [listed] names. Throws [DefinitionRefused], keeping
  /// nothing, when its hash is not [listed]'s, it names another key or version, or the phone can't
  /// read it; throws a [StateError] when the person was forgotten since [generation].
  Future<NoteTypeDef> keep(
    String userId,
    String teamId,
    ListedVersion listed,
    Map<String, Object?> definition, {
    required int generation,
  }) async {
    final folder = _teamFolder(await directory(), userId, teamId);
    _checkKey(listed.key, listed.version);
    if (valueHash(definition) != listed.hash) {
      throw DefinitionRefused(listed.key, listed.version, 'its hash is not the one listed');
    }
    final NoteTypeDef def;
    try {
      def = NoteTypeDef.fromJson(definition);
    } on FormatException {
      throw DefinitionRefused(listed.key, listed.version, 'this app can’t read it');
    }
    if (def.key != listed.key || def.version != listed.version) {
      throw DefinitionRefused(listed.key, listed.version, 'it is another key or version');
    }
    final bundled = (await _bundled())[listed.hash] != null;
    _checkGeneration(userId, teamId, generation);
    final path = _versionFile(folder, listed.key, listed.version);
    _write(path, {...listed.toJson(), if (!bundled) 'definition': definition});
    _checked[path] = listed.hash;
    _wrote(userId, teamId, folder);
    _read[listed.hash] = def;
    // A screen waiting on this version (an old draft's) can open it now.
    notifyListeners();
    return def;
  }

  /// Keeps [listed] as the team's list. Every version it names must be held already ([holds],
  /// [keep]), so a list is never kept that the phone can't start a note from; otherwise a
  /// [StateError], and the list kept before stays. A [StateError] too, writing nothing, when the
  /// person was forgotten since [generation].
  Future<void> keepList(String userId, String teamId, List<ListedVersion> listed, {required int generation}) async {
    final folder = _teamFolder(await directory(), userId, teamId);
    final defs = <NoteTypeDef>[];
    for (final v in listed) {
      _checkKey(v.key, v.version);
      final def = await _definitionFor(folder, v.key, v.version, v.hash);
      if (def == null) throw StateError('${v.key} v${v.version} is not held');
      defs.add(def);
    }
    _checkGeneration(userId, teamId, generation);
    for (final v in listed) {
      // A preset listed for the first time: its file records that this team's version is it.
      final file = _versionFile(folder, v.key, v.version);
      if (_readVersion(file)?.hash != v.hash) {
        _write(file, v.toJson());
        _checked[file] = v.hash;
      }
    }
    _write(p.join(folder, _listFile), {
      'noteTypes': [for (final v in listed) v.toJson()],
    });
    _wrote(userId, teamId, folder);
    _teams[folder] = TeamNoteTypes(defs);
    notifyListeners();
  }

  /// Deletes every file of [userId]'s, every team's (sign-out, the tenth wrong PIN).
  Future<void> forgetUser(String userId) async {
    final who = _who(userId);
    _people[who] = (_people[who] ?? 0) + 1;
    final folder = p.join(await directory(), who);
    _teams.removeWhere((path, _) => p.isWithin(folder, path));
    _checked.removeWhere((path, _) => p.isWithin(folder, path));
    _read.clear();
    _delete(folder);
    notifyListeners();
  }

  /// Deletes [userId]'s files of one team (a remote wipe of that team, a removal's hand-over).
  Future<void> forgetTeam(String userId, String teamId) async {
    final key = _teamKey(userId, teamId);
    _forgotten[key] = (_forgotten[key] ?? 0) + 1;
    final folder = _teamFolder(await directory(), userId, teamId);
    _teams.remove(folder);
    _checked.removeWhere((path, _) => p.isWithin(folder, path));
    _read.clear();
    _delete(folder);
    notifyListeners();
  }

  // ---- files ----

  static const _listFile = 'list.json';

  /// 0017's key pattern: a key is a safe file name.
  static final _keyPattern = RegExp(r'^[a-z][a-z0-9_]{1,60}$');

  /// Team IDs are UUIDs; anything that could name another folder is refused.
  static final _teamPattern = RegExp(r'^[A-Za-z0-9-]{1,64}$');

  static final _hashPattern = RegExp(r'^[0-9a-f]{64}$');

  /// The person, as the databases name them (LocalDatabase.fileFor): never their ID in clear.
  static String _who(String userId) => sha256.convert(userId.codeUnits).toString().substring(0, 16);

  static String _teamFolder(String dir, String userId, String teamId) => p.join(dir, _teamKey(userId, teamId));

  static String _teamKey(String userId, String teamId) {
    if (!_teamPattern.hasMatch(teamId)) throw ArgumentError.value(teamId, 'teamId', 'not a team ID');
    return p.join(_who(userId), teamId);
  }

  static void _checkKey(String key, int version) {
    if (!_keyPattern.hasMatch(key)) throw ArgumentError.value(key, 'key', 'not a note type key');
    if (version < 1) throw ArgumentError.value(version, 'version', 'not a version');
  }

  static String _versionFile(String folder, String key, int version) => p.join(folder, '$key.$version.json');

  void _checkGeneration(String userId, String teamId, int generation) {
    if (generation != this.generation(userId, teamId)) throw StateError('Deleted since this fetch began.');
  }

  /// The team's files changed: a list read before this is not what is there now.
  void _wrote(String userId, String teamId, String folder) {
    final key = _teamKey(userId, teamId);
    _written[key] = (_written[key] ?? 0) + 1;
    _teams.remove(folder);
  }

  /// Written whole or not at all: a file cut short by the app dying would otherwise read as
  /// changed on disk, and be fetched again.
  static void _write(String path, Map<String, Object?> json) {
    Directory(p.dirname(path)).createSync(recursive: true);
    final tmp = File('$path.tmp')..writeAsStringSync(jsonEncode(json), flush: true);
    tmp.renameSync(path);
  }

  static void _delete(String folder) {
    final dir = Directory(folder);
    if (dir.existsSync()) dir.deleteSync(recursive: true);
  }

  static List<ListedVersion>? _readList(String folder) {
    final file = File(p.join(folder, _listFile));
    if (!file.existsSync()) return null;
    try {
      final json = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
      final listed = [
        for (final e in (json['noteTypes']! as List<Object?>).cast<Map<String, Object?>>())
          ListedVersion(key: e['key']! as String, version: e['version']! as int, hash: e['hash']! as String),
      ];
      return listed.every((v) => _keyPattern.hasMatch(v.key) && v.version >= 1) ? listed : null;
    } on Object {
      // Unreadable: as if never fetched; the next fetch writes it again.
      return null;
    }
  }

  /// A version file's hash and definition, or null when it is missing or not one this store wrote.
  static ({String hash, Map<String, Object?>? definition})? _readVersion(String path) {
    final file = File(path);
    if (!file.existsSync()) return null;
    try {
      final json = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
      final hash = json['hash']! as String;
      if (!_hashPattern.hasMatch(hash)) return null;
      return (hash: hash, definition: json['definition'] as Map<String, Object?>?);
    } on Object {
      return null;
    }
  }

  /// The team's definition of [key] at [version]: the one with [hash], or with whatever hash the
  /// team's file names when [hash] is null.
  Future<NoteTypeDef?> _resolve(String folder, String key, int version, String? hash) async {
    _checkKey(key, version);
    final file = _readVersion(_versionFile(folder, key, version));
    if (file == null || (hash != null && file.hash != hash)) return null;
    return _definitionFor(folder, key, version, file.hash);
  }

  /// The definition with [hash] for [key] at [version], from the presets or the team's file.
  Future<NoteTypeDef?> _definitionFor(String folder, String key, int version, String hash) async {
    final bundled = (await _bundled())[hash];
    final path = _versionFile(folder, key, version);
    final known = _read[hash];
    if (known != null && (bundled != null || _checked[path] == hash)) {
      return known.key == key && known.version == version ? known : null;
    }
    final Map<String, Object?>? json;
    if (bundled != null) {
      json = bundled;
    } else {
      final file = _readVersion(path);
      json = file?.hash == hash ? file?.definition : null;
      if (json == null) return null;
      if (valueHash(json) != hash) {
        // Changed on disk since it was checked: not this version any more.
        File(path).deleteSync();
        return null;
      }
    }
    try {
      final def = NoteTypeDef.fromJson(json);
      if (def.key != key || def.version != version) return null;
      if (bundled == null) _checked[path] = hash;
      return _read[hash] = def;
    } on FormatException {
      return null;
    }
  }

  /// The bundled presets by hash, each checked once: a preset whose hash is not its definition's is
  /// left out, and the phone downloads that version as it would any other.
  Future<Map<String, Map<String, Object?>>> _bundled() async => _presetsRead ??= await (_presets ??= () async {
    final byHash = <String, Map<String, Object?>>{};
    for (final entry in (await presets()).cast<Map<String, Object?>>()) {
      final definition = entry['definition'] as Map<String, Object?>?;
      final hash = entry['hash'];
      if (definition == null || hash is! String || valueHash(definition) != hash) continue;
      if (definition['key'] != entry['key'] || definition['version'] != entry['version']) continue;
      byHash[hash] = definition;
    }
    return byHash;
  }());
}
