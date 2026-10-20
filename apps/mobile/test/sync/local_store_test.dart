import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/canonical_json.dart';
import 'package:sineobex_field/sync/local_db.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sqlite3/sqlite3.dart';

const userId = '7d1c1b9e-5f6a-4c1e-9d3a-2b4c6d8e0f12';
final key = Uint8List.fromList(List<int>.generate(32, (i) => i * 7 % 256));

void main() {
  late Directory dir;
  late LocalDatabase db;
  late LocalStore store;
  var paused = false;
  var now = DateTime.utc(2026, 10, 20, 15);

  ClockStamp stamp() => ClockStamp(deviceTime: now, correctedTime: now, verified: true);

  setUp(() {
    dir = Directory.systemTemp.createTempSync('store');
    db = LocalDatabase.open(LocalDatabase.fileFor(dir.path, userId, 'team-1'), key);
    paused = false;
    now = DateTime.utc(2026, 10, 20, 15);
    store = LocalStore(db, userId: userId, stamp: stamp, chartingPaused: () => paused, now: () => now);
  });
  tearDown(() {
    db.close();
    dir.deleteSync(recursive: true);
  });

  OutboxEntry only(String changeId) => store.entry(changeId)!;
  String pendingOf(String recordId, String field) => store.record(recordId)!.fields[field]!.pendingChange!;

  test('the database is SQLCipher: the file holds no readable text and a wrong key is refused', () {
    final id = store.createEncounter(kind: 'medical');
    store.createNote(encounterId: id, noteTypeKey: 'wound_care', data: {'site': 'left forearm laceration'});
    db.close();
    final path = LocalDatabase.fileFor(dir.path, userId, 'team-1');
    expect(String.fromCharCodes(File(path).readAsBytesSync()).contains('forearm'), isFalse);
    expect(() => LocalDatabase.open(path, Uint8List(32)), throwsA(isA<SqliteException>()));
    db = LocalDatabase.open(path, key);
    store = LocalStore(db, userId: userId, stamp: stamp, now: () => now);
    expect(store.outbox(), hasLength(2));
  });

  test('every edit is a change entry with the hash of its canonical value, in sequence', () {
    final enc = store.createEncounter(kind: 'medical', location: {'lat': 42.33, 'lng': -83.05});
    final note = store.createNote(encounterId: enc, noteTypeKey: 'vitals', data: {'temp_c': 38.0});
    store.setField(note, 'data.pulse', 92);
    final entries = store.outbox();
    expect(entries.map((e) => e.seq), [1, 2, 3]);
    expect(entries.map((e) => e.op), ['create', 'create', 'set']);
    for (final e in entries) {
      expect(e.valueHash, valueHash(e.value));
    }
    // 38.0 hashes as 38, the way the server will.
    expect(
      entries[1].valueHash,
      valueHash({
        'encounterId': enc,
        'noteTypeKey': 'vitals',
        'data': {'temp_c': 38},
      }),
    );
    expect(store.unsynced().counts, {'encounters': 1, 'notes': 2});
  });

  test('a second edit before the first is confirmed follows it and keeps the same base version', () {
    final enc = store.createEncounter(kind: 'medical');
    final note = store.createNote(encounterId: enc, noteTypeKey: 'vitals', data: {'temp_c': 38});
    final create = pendingOf(note, 'data.temp_c');
    store.setField(note, 'data.temp_c', 38.4);
    final first = only(pendingOf(note, 'data.temp_c'));
    expect(first.follows, create);
    expect(first.baseVersion, 0);
    store.setField(note, 'data.temp_c', 38.6);
    final second = only(pendingOf(note, 'data.temp_c'));
    expect(second.follows, first.changeId);
    // Setting the same value again is not a change.
    store.setField(note, 'data.temp_c', 38.6);
    expect(store.outbox(), hasLength(4));
  });

  test('confirmed fields are purged only after Save & Close, and unconfirmed ones never', () {
    final enc = store.createEncounter(kind: 'medical');
    final note = store.createNote(encounterId: enc, noteTypeKey: 'vitals', data: {'temp_c': 38});
    store.setField(note, 'data.pulse', 92);
    final noteCreate = store.outbox()[1];
    final pulse = store.outbox()[2];

    store.confirm(noteCreate, serverVersion: 1);
    // Still open: the person is charting, so nothing disappears from the screen.
    expect(store.record(note)!.fields.keys, containsAll(['status', 'data.temp_c', 'data.pulse']));
    expect(store.record(note)!.fields['data.temp_c']!.confirmed, isTrue);

    store.closeRecord(note);
    // temp_c and status are confirmed and go; pulse is still waiting and stays.
    expect(store.record(note)!.fields.keys, ['data.pulse']);
    store.confirm(pulse, serverVersion: 1);
    expect(store.record(note), isNull);
    // The encounter's create is unconfirmed and the encounter is still open.
    expect(store.record(enc), isNotNull);
    expect(store.unsynced().counts, {'encounters': 1});
  });

  test('later changes wait while an earlier one they depend on is rejected or in conflict', () {
    final enc = store.createEncounter(kind: 'medical');
    final note = store.createNote(encounterId: enc, noteTypeKey: 'vitals');
    store.setField(note, 'data.temp_c', 38);
    store.setField(note, 'data.pulse', 90);
    final entries = store.outbox();
    store.confirm(entries[0], serverVersion: 1);
    store.reject(entries[1], reason: 'validation', message: 'fix it');
    // The note's create was rejected: everything on the note waits.
    expect(store.sendable(), isEmpty);
    expect(store.heldCount(), 2);
    expect(store.needsAttention().map((e) => e.changeId), [entries[1].changeId]);
  });

  test('a rejected create is fixed with a new create that carries the record’s later edits', () {
    final enc = store.createEncounter(kind: 'medical');
    final note = store.createNote(encounterId: enc, noteTypeKey: 'vitals', data: {'temp_c': 38});
    store.setField(note, 'data.pulse', 90);
    store.setField(note, 'status', 'completed');
    final create = store.outbox()[1];
    store.confirm(store.outbox()[0], serverVersion: 1);
    store.reject(create, reason: 'stale_reference');

    store.fixRejected(create.changeId, {'encounterId': enc, 'noteTypeKey': 'vitals'});
    final sendable = store.sendable();
    expect(sendable.map((e) => e.op), ['create', 'set']);
    expect(sendable.first.supersedes, create.changeId);
    expect(sendable.first.value, {
      'encounterId': enc,
      'noteTypeKey': 'vitals',
      'data': {'temp_c': 38, 'pulse': 90},
    });
    expect(sendable.last.field, 'status');
    expect(sendable.last.follows, sendable.first.changeId);
    expect(store.needsAttention(), isEmpty);

    store.confirm(sendable.first, serverVersion: 1);
    // The original rejection and the edits folded into the fix are gone with it.
    expect(store.outbox().map((e) => e.changeId), [sendable.last.changeId]);
  });

  test('a conflict is shown with both values; choosing mine sends one replace with my latest value', () {
    final enc = store.createEncounter(kind: 'medical');
    final note = store.createNote(encounterId: enc, noteTypeKey: 'vitals');
    for (final e in store.outbox()) {
      store.confirm(e, serverVersion: 1);
    }
    store.setField(note, 'data.temp_c', 39.1);
    final mine = only(pendingOf(note, 'data.temp_c'));
    store.conflict(mine, const ServerField(value: 38.2, version: 1, changedBy: 'someone-else'));
    // Edited again while the conflict was open: waits, and folds into the choice.
    store.setField(note, 'data.temp_c', 39.3);
    expect(store.sendable(), isEmpty);
    final shown = store.needsAttention().single;
    expect([shown.value, shown.server!.value], [39.1, 38.2]);

    store.resolveConflict(mine.changeId, keepMine: true);
    final choice = store.sendable().single;
    expect(choice.resolution, 'replace');
    expect(choice.conflictOf, mine.changeId);
    expect(choice.baseVersion, 1);
    expect(choice.value, 39.3);
    expect(store.record(note)!.fields['data.temp_c']!.value, 39.3);
    store.confirm(choice, serverVersion: 2);
    expect(store.outbox(), isEmpty);
    expect(store.record(note)!.fields['data.temp_c']!.serverVersion, 2);
  });

  test('keeping the server’s value shows it here and still sends mine to be kept in history', () {
    final enc = store.createEncounter(kind: 'medical');
    final note = store.createNote(encounterId: enc, noteTypeKey: 'vitals');
    for (final e in store.outbox()) {
      store.confirm(e, serverVersion: 1);
    }
    store.setField(note, 'data.temp_c', 39.1);
    final mine = only(pendingOf(note, 'data.temp_c'));
    store.conflict(mine, const ServerField(value: 38.2, version: 3));
    store.resolveConflict(mine.changeId, keepMine: false);
    final choice = store.sendable().single;
    expect([choice.resolution, choice.value, choice.baseVersion], ['keep_server', 39.1, 3]);
    expect(store.record(note)!.fields['data.temp_c']!.value, 38.2);
  });

  test('a server copy keeps local edits and takes the server’s value everywhere else', () {
    const id = '0b6a0a76-55a1-4a3e-9f0e-6f0b5e1c2d3e';
    ServerRecord copy(Map<String, ServerField> fields) => ServerRecord(
      entity: entityNote,
      id: id,
      status: 'draft',
      authorUserId: 'author-a',
      attributes: const {'noteTypeKey': 'vitals'},
      fields: fields,
    );
    store.importServerRecord(
      copy({
        'status': const ServerField(value: 'draft', version: 1),
        'data.temp_c': const ServerField(value: 38.2, version: 1),
        'data.plan': const ServerField(value: null, version: 0),
      }),
    );
    expect(store.record(id)!.fields['data.temp_c']!.serverVersion, 1);
    store.setField(id, 'data.plan', 'rest');
    store.importServerRecord(
      copy({
        'status': const ServerField(value: 'draft', version: 1),
        'data.temp_c': const ServerField(value: 38.5, version: 2),
        'data.plan': const ServerField(value: 'fluids', version: 1),
      }),
    );
    final fields = store.record(id)!.fields;
    expect([fields['data.temp_c']!.value, fields['data.temp_c']!.serverVersion], [38.5, 2]);
    // The person's unsent edit is untouched, and so is the version they built it on.
    expect([fields['data.plan']!.value, fields['data.plan']!.serverVersion], ['rest', 0]);
  });

  test('a read-only server copy expires after 24 hours even if left open', () {
    const id = '0b6a0a76-55a1-4a3e-9f0e-6f0b5e1c2d3f';
    store.importServerRecord(
      const ServerRecord(
        entity: entityNote,
        id: id,
        status: 'draft',
        authorUserId: 'author-a',
        attributes: {},
        fields: {'data.temp_c': ServerField(value: 38.2, version: 1)},
      ),
    );
    now = now.add(const Duration(hours: 23));
    store.purge();
    expect(store.record(id), isNotNull);
    now = now.add(const Duration(hours: 2));
    store.purge();
    expect(store.record(id), isNull);
  });

  test('hard stops on the phone: bad values, unknown fields, signed notes, a paused clock', () {
    final enc = store.createEncounter(kind: 'medical');
    final note = store.createNote(encounterId: enc, noteTypeKey: 'vitals');
    expect(() => store.setField(note, 'data.x', maxSafeInteger + 2), throwsA(isA<LocalValidationError>()));
    expect(() => store.setField(note, 'data.x', 'broken \ud800'), throwsA(isA<LocalValidationError>()));
    expect(() => store.setField(note, 'kind', 'x'), throwsA(isA<LocalValidationError>()));
    expect(() => store.setField(note, 'status', 'signed'), throwsA(isA<LocalValidationError>()));
    expect(() => store.createEncounter(kind: 'telehealth'), throwsA(isA<LocalValidationError>()));
    expect(
      () => store.createEncounter(kind: 'medical', location: {'lat': 120, 'lng': 0}),
      throwsA(isA<LocalValidationError>()),
    );
    store.importServerRecord(
      ServerRecord(
        entity: entityNote,
        id: note,
        status: 'signed',
        authorUserId: userId,
        attributes: const {},
        fields: const {'status': ServerField(value: 'signed', version: 2)},
      ),
    );
    // The local status edit is pending (draft), so the server's signed status waits too; once
    // confirmed, a signed note is locked here as on the server.
    final status = store.outbox().firstWhere((e) => e.recordId == note);
    store.confirm(status, serverVersion: 1);
    store.importServerRecord(
      ServerRecord(
        entity: entityNote,
        id: note,
        status: 'signed',
        authorUserId: userId,
        attributes: const {},
        fields: const {'status': ServerField(value: 'signed', version: 2)},
      ),
    );
    expect(() => store.setField(note, 'data.x', 1), throwsA(isA<RecordLocked>()));

    paused = true;
    expect(() => store.createEncounter(kind: 'medical'), throwsA(isA<ChartingPaused>()));
    expect(() => store.setField(enc, 'patientId', null), throwsA(isA<ChartingPaused>()));
    // Logging what the person looked at never pauses.
    store.appendAudit('patient.viewed', entity: 'patient', entityId: enc);
    expect(store.unsynced().counts['activity'], 1);
  });
}
