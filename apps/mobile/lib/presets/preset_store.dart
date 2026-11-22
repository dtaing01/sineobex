/// The team's presets on this phone (phase 5 design 6.1): a server copy kept in the team database,
/// in the `presets` table (`local_db.dart`'s `_v3`) and the `kv` keys under `presets.`, written only
/// by a pull (`PresetsRefresher`) and gone with the team's other server copies
/// (`LocalStore.clearServerData`). Presets name no patient, so reading them audits nothing.
///
/// Written ahead of its code (P2-tests): every body that throws is P2-store's.
library;

import '../api/generated/api.dart' show PresetsPull;
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

/// The copy of one team's presets in that team's database.
class PresetStore {
  PresetStore(this.store, {DateTime Function()? now}) : now = now ?? DateTime.now;

  final LocalStore store;

  /// The clock [updatedAt] is read from.
  final DateTime Function() now;

  /// The revision the copy was pulled at: the next pull's `since`.
  static const revisionKey = 'presets.revision';

  /// The epoch the copy came from: the next pull's `epoch`.
  static const epochKey = 'presets.epoch';

  /// When a pull's answer was last written ("Updated 10:42"). Every key of the copy's bookkeeping
  /// is under `presets.`, and goes with it.
  static const updatedAtKey = 'presets.updatedAt';

  /// The revision held ([revisionKey]); null when none is, and the next pull sends no `since`.
  int? get revision => throw UnimplementedError('P2-store');

  /// The epoch held ([epochKey]); null when none is, and the next pull sends no `epoch`.
  String? get epoch => throw UnimplementedError('P2-store');

  /// A pull's answer was written since the copy last went. False is "Your team’s setup hasn’t
  /// downloaded yet. Connect to finish." (6.1), true even for a team that holds no preset.
  bool get downloaded => throw UnimplementedError('P2-store');

  /// When a pull's answer was last written, by [now], whether or not it changed anything: how old
  /// the copy is (12.1, risk 4). Null when none is held.
  DateTime? get updatedAt => throw UnimplementedError('P2-store');

  /// Every preset held, archived ones included, or only those of [kind]. In no particular order:
  /// a screen sorts what it shows.
  List<HeldPreset> presets({PresetKind? kind}) => throw UnimplementedError('P2-store');

  /// The preset [id], or null when it is not held.
  HeldPreset? preset(String id) => throw UnimplementedError('P2-store');

  /// Writes a pull's [answer]: its rows, its revision, its epoch and the time, in one local
  /// transaction, so a write cut short leaves the copy as it was and the next pull asks again from
  /// the same revision. A reset, or an answer under an epoch other than the one held, replaces every
  /// row; otherwise each row is put by its id. Archived rows are held. A row this phone can't read
  /// (a kind or a state it does not know, a body [parsePreset] refuses) is not held: one the table
  /// held under that id goes.
  void apply(PresetsPull answer) => throw UnimplementedError('P2-store');

  /// The team refused the pull (403): every row and every key under `presets.` go, so the next
  /// pull asks for everything.
  void clear() => throw UnimplementedError('P2-store');
}
