import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show PresetsPull;
import 'package:sineobex_field/presets/models.dart';
import 'package:sineobex_field/presets/preset_store.dart';
import 'package:sineobex_field/sync/local_db.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sqlite3/sqlite3.dart';

import 'presets_stand_in.dart';

const userId = '7d1c1b9e-5f6a-4c1e-9d3a-2b4c6d8e0f12';
final key = Uint8List.fromList(List<int>.generate(32, (i) => i * 7 % 256));

/// The phone's copy of its team's presets (phase 5 design 6.1): what a pull's answer writes, and how
/// it leaves. The pull itself, and when it runs, are presets_refresher_test.dart's.
///
/// Written ahead of P2-store (and the `presets` table of P2-local-db), whose code makes it pass.
void main() {
  late Directory dir;
  late LocalDatabase db;
  late LocalStore store;
  late PresetStore presets;
  var now = DateTime.utc(2026, 11, 2, 10, 42);

  setUp(() {
    dir = Directory.systemTemp.createTempSync('presets');
    now = DateTime.utc(2026, 11, 2, 10, 42);
    db = LocalDatabase.open(LocalDatabase.fileFor(dir.path, userId, 'team-1'), key);
    store = LocalStore(
      db,
      userId: userId,
      stamp: () => ClockStamp(deviceTime: now, correctedTime: now, verified: true),
      now: () => now,
    );
    presets = PresetStore(store, now: () => now);
  });
  tearDown(() {
    db.close();
    dir.deleteSync(recursive: true);
  });

  /// An answer as the generated client decodes it from the wire.
  PresetsPull answer({
    required int revision,
    String epoch = epochA,
    bool reset = false,
    List<Map<String, Object?>> rows = const [],
  }) => PresetsPull.fromJson(
    jsonDecode(jsonEncode(pullAnswer(revision: revision, epoch: epoch, reset: reset, presets: rows)))
        as Map<String, Object?>,
  );

  /// The table as it stands, by id.
  Map<String, Map<String, Object?>> rows() => {
    for (final r in db.db.select('SELECT id, kind, version, state, origin_key, body_json FROM presets'))
      r['id']! as String: {
        'kind': r['kind'],
        'version': r['version'],
        'state': r['state'],
        'originKey': r['origin_key'],
        'body': jsonDecode(r['body_json']! as String),
      },
  };

  /// A row as rows() shows it.
  Map<String, Object?> row(
    String kind,
    Map<String, Object?> body, {
    int version = 1,
    String state = 'active',
    String? originKey,
  }) => {'kind': kind, 'version': version, 'state': state, 'originKey': originKey, 'body': body};

  /// The copy's bookkeeping: every key under `presets.`.
  Map<String, Object?> keys() => {
    for (final r in db.db.select("SELECT key, value FROM kv WHERE key LIKE 'presets.%'"))
      r['key']! as String: r['value'],
  };

  /// Everything the copy is.
  Map<String, Object?> copy() => {'rows': rows(), 'keys': keys()};

  /// The copy of the Done when's first step: the platform's presets at revision 12.
  void holdPlatform() => presets.apply(
    answer(
      reset: true,
      revision: 12,
      rows: [
        pulled(labsId, 'order_category', labs(), originKey: 'order_category.labs'),
        pulled(suppliesId, 'order_category', supplies(), originKey: 'order_category.supplies'),
        pulled(gauzeId, 'item', gauze(), version: 2),
        pulled(highId, 'flag', high(), originKey: 'flag.high'),
        pulled(settingsId, 'settings', teamSettings(), originKey: 'settings.team'),
      ],
    ),
  );

  test('nothing is held before the first pull: no revision, no epoch, not downloaded', () {
    expect(rows(), isEmpty);
    expect([presets.revision, presets.epoch, presets.updatedAt, presets.downloaded], [null, null, null, false]);
    expect(presets.presets(), isEmpty);
  });

  test('a first pull writes every row as the server sent it, its revision, its epoch and when', () {
    holdPlatform();
    expect(rows(), {
      labsId: row('order_category', labs(), originKey: 'order_category.labs'),
      suppliesId: row('order_category', supplies(), originKey: 'order_category.supplies'),
      gauzeId: row('item', gauze(), version: 2),
      highId: row('flag', high(), originKey: 'flag.high'),
      settingsId: row('settings', teamSettings(), originKey: 'settings.team'),
    });
    expect(keys(), {'presets.revision': '12', 'presets.epoch': epochA, 'presets.updatedAt': now.toIso8601String()});
    expect([presets.revision, presets.epoch, presets.downloaded], [12, epochA, true]);
    expect(presets.updatedAt?.toUtc(), now);
  });

  test('each preset held reads with its kind, state, version, origin and body', () {
    holdPlatform();
    presets.apply(
      answer(revision: 13, rows: [pulled(frostRiskId, 'flag', frostRisk(), version: 3, state: 'archived')]),
    );
    final all = {for (final p in presets.presets()) p.id: p};
    expect(all.keys, unorderedEquals([labsId, suppliesId, gauzeId, highId, settingsId, frostRiskId]));
    final frost = all[frostRiskId]!;
    expect([frost.kind, frost.state, frost.version, frost.originKey], [PresetKind.flag, PresetState.archived, 3, null]);
    expect(frost.body, isA<FlagBody>().having((b) => b.name, 'name', 'Demo: Frost risk'));
    expect(all[labsId]!.originKey, 'order_category.labs');
    expect(all[gauzeId]!.body.toJson(), gauze());
    expect(presets.presets(kind: PresetKind.flag).map((p) => p.id), unorderedEquals([highId, frostRiskId]));
    expect(presets.presets(kind: PresetKind.bag), isEmpty);
    expect(presets.preset(settingsId)?.body, isA<SettingsBody>().having((b) => b.problemCheckDays, 'days', 90));
    expect(presets.preset('00000000-0000-4000-8000-000000009999'), isNull);
  });

  test('archived rows are held, for their names', () {
    presets.apply(
      answer(reset: true, revision: 4, rows: [pulled(highId, 'flag', high(), state: 'archived', version: 2)]),
    );
    expect(rows(), {highId: row('flag', high(), state: 'archived', version: 2)});
    expect(presets.preset(highId)?.state, PresetState.archived);
  });

  test('a body is held as the server sent it, a field this phone does not know included, and read without it', () {
    final later = {...frostRisk(), 'icon': 'Demo: snowflake'};
    presets.apply(answer(reset: true, revision: 2, rows: [pulled(frostRiskId, 'flag', later)]));
    expect(rows()[frostRiskId]!['body'], later);
    expect(presets.preset(frostRiskId)!.body.toJson(), frostRisk());
  });

  test('a reset replaces every row', () {
    holdPlatform();
    presets.apply(answer(reset: true, revision: 3, rows: [pulled(frostRiskId, 'flag', frostRisk())]));
    expect(rows(), {frostRiskId: row('flag', frostRisk())});
    expect([presets.revision, presets.epoch], [3, epochA]);
  });

  test('an answer under another epoch replaces every row, though it is no reset', () {
    holdPlatform();
    presets.apply(answer(epoch: epochB, revision: 14, rows: [pulled(frostRiskId, 'flag', frostRisk())]));
    expect(rows(), {frostRiskId: row('flag', frostRisk())});
    expect([presets.revision, presets.epoch], [14, epochB]);
  });

  test('the epoch held, sent back in capitals, is no other epoch: each row is put by its id', () {
    // The server compares epochs as UUIDs. Taken for another, a part answer would replace the copy.
    holdPlatform();
    presets.apply(answer(epoch: epochA.toUpperCase(), revision: 13, rows: [pulled(frostRiskId, 'flag', frostRisk())]));
    expect(rows().keys, unorderedEquals([labsId, suppliesId, gauzeId, highId, settingsId, frostRiskId]));
    expect(presets.revision, 13);
  });

  test('any other answer puts each row by its id and leaves the rest', () {
    holdPlatform();
    presets.apply(
      answer(
        revision: 15,
        rows: [
          pulled(gauzeId, 'item', {...gauze(), 'name': 'Demo: Gauze pads'}, version: 3, state: 'archived'),
          pulled(glucoseId, 'item', glucose()),
          pulled(footCheckId, 'bundle', footCheck()),
        ],
      ),
    );
    expect(rows(), {
      labsId: row('order_category', labs(), originKey: 'order_category.labs'),
      suppliesId: row('order_category', supplies(), originKey: 'order_category.supplies'),
      gauzeId: row('item', {...gauze(), 'name': 'Demo: Gauze pads'}, version: 3, state: 'archived'),
      highId: row('flag', high(), originKey: 'flag.high'),
      settingsId: row('settings', teamSettings(), originKey: 'settings.team'),
      glucoseId: row('item', glucose()),
      footCheckId: row('bundle', footCheck()),
    });
    expect([presets.revision, presets.epoch], [15, epochA]);
  });

  test('an answer with no rows changes no row, and still says when the copy was confirmed', () {
    holdPlatform();
    final held = rows();
    now = now.add(const Duration(hours: 3));
    presets.apply(answer(revision: 12));
    expect(rows(), held);
    expect(presets.revision, 12);
    expect(presets.updatedAt?.toUtc(), now);
  });

  test('a team that has taken no revision answers 0 and the nil epoch: nothing held, yet downloaded', () {
    holdPlatform();
    presets.apply(answer(reset: true, revision: 0, epoch: nilEpoch));
    expect(rows(), isEmpty);
    expect([presets.revision, presets.epoch, presets.downloaded], [0, nilEpoch, true]);
    expect(presets.presets(), isEmpty);
  });

  test('a row of a kind this phone does not know is skipped, and the rest are written', () {
    final codes = pulled('00000000-0000-4000-8000-00000000e001', 'billing_code_map', {
      'name': 'Demo: Wound care codes',
      'targetId': glucoseId,
      'codes': ['97597'],
    });
    presets.apply(answer(reset: true, revision: 5, rows: [codes, pulled(glucoseId, 'item', glucose())]));
    expect(rows().keys, [glucoseId]);
    presets.apply(
      answer(
        revision: 6,
        rows: [
          {...codes, 'version': 2},
          pulled(frostRiskId, 'flag', frostRisk()),
        ],
      ),
    );
    expect(rows().keys, unorderedEquals([glucoseId, frostRiskId]));
    expect(presets.revision, 6);
  });

  test('a row this phone can’t read is not held, and takes out the one held under its id', () {
    holdPlatform();
    presets.apply(
      answer(
        revision: 16,
        rows: [
          // A body the schema refuses (no unit), and a state this phone does not know.
          pulled(gauzeId, 'item', {...gauze(), 'unit': ''}, version: 3),
          pulled(highId, 'flag', high(), version: 2, state: 'retired'),
          pulled(glucoseId, 'item', glucose()),
        ],
      ),
    );
    expect(rows().keys, unorderedEquals([labsId, suppliesId, settingsId, glucoseId]));
    expect([presets.preset(gauzeId), presets.preset(highId)], [null, null]);
    expect(presets.revision, 16);
    presets.apply(
      answer(
        reset: true,
        revision: 17,
        rows: [
          pulled(gauzeId, 'item', {...gauze(), 'unit': ''}, version: 3),
          pulled(labsId, 'order_category', labs()),
        ],
      ),
    );
    expect(rows().keys, [labsId]);
  });

  group('rows, revision, epoch and time go in one transaction:', () {
    test('a write cut short leaves the copy as it was, and the same answer is written whole later', () {
      holdPlatform();
      final held = copy();
      now = now.add(const Duration(minutes: 5));
      failWritesOf(db.db, footCheckId);
      final next = answer(
        revision: 18,
        rows: [
          pulled(glucoseId, 'item', glucose()),
          pulled(footCheckId, 'bundle', footCheck()),
          pulled(gauzeId, 'item', gauze(), version: 3),
        ],
      );
      expect(() => presets.apply(next), throwsA(isA<SqliteException>()));
      expect(copy(), held);
      writesWork(db.db);
      presets.apply(next);
      expect(rows().keys, containsAll([glucoseId, footCheckId, gauzeId]));
      expect(presets.revision, 18);
    });

    test('a reset cut short leaves every row it would have replaced', () {
      holdPlatform();
      final held = copy();
      failWritesOf(db.db, frostRiskId);
      expect(
        () => presets.apply(
          answer(reset: true, epoch: epochB, revision: 2, rows: [pulled(frostRiskId, 'flag', frostRisk())]),
        ),
        throwsA(isA<SqliteException>()),
      );
      expect(copy(), held);
    });
  });

  test('a 403 takes every row and every key of the copy, so the next pull asks for everything', () {
    holdPlatform();
    store.setKv('intake.draft', '{}');
    store.setKv('index.version', '7.idx1');
    presets.clear();
    expect(copy(), {'rows': <String, Object?>{}, 'keys': <String, Object?>{}});
    expect([presets.revision, presets.epoch, presets.updatedAt, presets.downloaded], [null, null, null, false]);
    // What isn't the copy's stays.
    expect([store.kv('intake.draft'), store.kv('index.version')], ['{}', '7.idx1']);
  });

  test('a clear cut short leaves the copy whole: its rows without their revision', () {
    // Rows gone with the revision kept would be a copy that no later pull fills in again.
    holdPlatform();
    final held = copy();
    db.db.execute(
      "CREATE TRIGGER fail_clear BEFORE DELETE ON kv WHEN OLD.key LIKE 'presets.%' "
      "BEGIN SELECT RAISE(ABORT, 'demo: the delete failed'); END",
    );
    expect(() => presets.clear(), throwsA(isA<SqliteException>()));
    expect(copy(), held);
    db.db.execute('DROP TRIGGER fail_clear');
    presets.clear();
    expect(copy(), {'rows': <String, Object?>{}, 'keys': <String, Object?>{}});
  });
}
