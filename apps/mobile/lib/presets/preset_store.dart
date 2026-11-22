/// The team's presets on this phone (phase 5 design 6.1): a server copy kept in the team database,
/// in the `presets` table (`local_db.dart`'s `_v3`) and the `kv` keys under `presets.`, written only
/// by a pull (`PresetsRefresher`) and gone with the team's other server copies
/// (`LocalStore.clearServerData`). Presets name no patient, so reading them audits nothing.
library;

import 'dart:convert';

import '../api/generated/api.dart' show PresetsPull, PulledPreset;
import '../sync/local_store.dart';
import 'models.dart';

/// One preset the phone holds, at the version the last pull answered.
class HeldPreset {
  const HeldPreset({
    required this.id,
    required this.kind,
    required this.state,
    required this.version,
    required this.originKey,
    required this.body,
  });

  final String id;
  final PresetKind kind;

  /// An archived preset is held for its name, and never offered.
  final PresetState state;
  final int version;

  /// The platform preset it came from; null for the team's own.
  final String? originKey;
  final PresetBody body;
}

/// The copy of one team's presets in that team's database. It keeps nothing in memory: the
/// refresher's store and each screen's read the same rows.
class PresetStore {
  PresetStore(this.store, {DateTime Function()? now}) : now = now ?? DateTime.now;

  final LocalStore store;

  /// The clock [updatedAt] is read from.
  final DateTime Function() now;

  /// The revision the copy was pulled at: the next pull's `since`.
  static const revisionKey = '${presetsKvPrefix}revision';

  /// The epoch the copy came from: the next pull's `epoch`.
  static const epochKey = '${presetsKvPrefix}epoch';

  /// When a pull's answer was last written ("Updated 10:42"). Every key of the copy's bookkeeping
  /// is under `presets.`, and goes with it.
  static const updatedAtKey = '${presetsKvPrefix}updatedAt';

  static const _columns = 'id, kind, version, state, origin_key, body_json';

  /// The revision held ([revisionKey]); null when none is, and the next pull sends no `since`.
  int? get revision => int.tryParse(store.kv(revisionKey) ?? '');

  /// The epoch held ([epochKey]); null when none is, and the next pull sends no `epoch`.
  String? get epoch => store.kv(epochKey);

  /// A pull's answer was written since the copy last went. False is "Your team’s setup hasn’t
  /// downloaded yet. Connect to finish." (6.1), true even for a team that holds no preset.
  bool get downloaded => store.kv(revisionKey) != null;

  /// When a pull's answer was last written, by [now], whether or not it changed anything: how old
  /// the copy is (12.1, risk 4). Null when none is held.
  DateTime? get updatedAt => DateTime.tryParse(store.kv(updatedAtKey) ?? '');

  /// Every preset held, archived ones included, or only those of [kind]. In no particular order:
  /// a screen sorts what it shows.
  List<HeldPreset> presets({PresetKind? kind}) {
    final rows = kind == null
        ? store.database.select('SELECT $_columns FROM presets')
        : store.database.select('SELECT $_columns FROM presets WHERE kind = ?', [kind.code]);
    return [for (final row in rows) ?_held(row)];
  }

  /// The preset [id], or null when it is not held.
  HeldPreset? preset(String id) {
    final row = store.database.select('SELECT $_columns FROM presets WHERE id = ?', [id]).firstOrNull;
    return row == null ? null : _held(row);
  }

  /// Writes a pull's [answer]: its rows, its revision, its epoch and the time, in one local
  /// transaction, so a write cut short leaves the copy as it was and the next pull asks again from
  /// the same revision. A reset, or an answer under an epoch other than the one held, replaces every
  /// row; otherwise each row is put by its id. Archived rows are held. A row this phone can't read
  /// (a kind or a state it does not know, a body [parsePreset] refuses) is not held: one the table
  /// held under that id goes.
  void apply(PresetsPull answer) => store.transaction(() {
    final db = store.database;
    // A restored server database renews its epoch (4.2): rows from before it are of another
    // history, whatever the answer says.
    if (answer.reset || !_sameEpoch(answer.epoch, epoch)) db.execute('DELETE FROM presets');
    final put = db.prepare(
      'INSERT OR REPLACE INTO presets (kind, id, version, state, origin_key, body_json) VALUES (?, ?, ?, ?, ?, ?)',
    );
    final drop = db.prepare('DELETE FROM presets WHERE id = ?');
    try {
      for (final p in answer.presets) {
        switch (_row(p)) {
          case final row?:
            put.execute(row);
          case null:
            // Kept, it would stand for a version the server has moved on from.
            drop.execute([p.id]);
        }
      }
    } finally {
      put.close();
      drop.close();
    }
    store
      ..setKv(revisionKey, '${answer.revision}')
      ..setKv(epochKey, answer.epoch)
      ..setKv(updatedAtKey, now().toUtc().toIso8601String());
  });

  /// The team refused the pull to a person no longer its member (403 `not_a_member`): every row
  /// and every key under `presets.` go, so the next pull asks for everything. One transaction: rows
  /// gone with their revision kept would be a copy missing rows that no later pull sends again.
  void clear() => store.transaction(() {
    store.database
      ..execute('DELETE FROM presets')
      ..execute("DELETE FROM kv WHERE key LIKE '$presetsKvPrefix%'");
  });

  /// The server compares epochs as UUIDs, whatever their case.
  static bool _sameEpoch(String answered, String? held) => held != null && answered.toLowerCase() == held.toLowerCase();

  /// [p] as the table holds it, or null for a preset this phone can't read: a kind or a state it
  /// does not know (the generated client reads either as `unknown`), or a body [parsePreset]
  /// refuses. The body is kept as the server sent it, a field this phone does not know included,
  /// so a later version of the app reads that field without asking again.
  static List<Object?>? _row(PulledPreset p) {
    final kind = PresetKind.byCode(p.kind.wire);
    final state = PresetState.byCode(p.state.wire);
    if (kind == null || state == null) return null;
    try {
      if (parsePreset(kind.code, p.body) == null) return null;
    } on PresetBodyRefused {
      return null;
    }
    return [kind.code, p.id, p.version, state.name, p.originKey, jsonEncode(p.body)];
  }

  /// A row as it reads, or null for one this version of the app can't read (another version wrote
  /// it, or the file is damaged): it is left out, as a pull leaves out a preset it can't read.
  static HeldPreset? _held(Map<String, Object?> row) {
    final kind = PresetKind.byCode(row['kind']! as String);
    final state = PresetState.byCode(row['state']! as String);
    if (kind == null || state == null) return null;
    final PresetBody? body;
    try {
      body = parsePreset(kind.code, jsonDecode(row['body_json']! as String));
    } on FormatException {
      return null;
    } on PresetBodyRefused {
      return null;
    }
    if (body == null) return null;
    return HeldPreset(
      id: row['id']! as String,
      kind: kind,
      state: state,
      version: row['version']! as int,
      originKey: row['origin_key'] as String?,
      body: body,
    );
  }
}
