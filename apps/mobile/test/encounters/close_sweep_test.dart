import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/close_sweep.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';

/// When a visit and its notes leave the phone (lifecycle 3.2, 8.2; card L4-close-sweep): a finished
/// note once its sign-off and every change to it are confirmed, its visit once every note of it on
/// the phone is closed, and a draft nobody has touched for 7 days once nothing of it waits. A draft
/// stays on its author's phone until then, so they can complete it with no signal (3.2). The store
/// closes a record only when it is told to (`closeRecord`), and its purge then removes only what the
/// server confirmed.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  final start = DateTime.utc(2026, 10, 20, 15);

  late DateTime serverTime;
  late FakeSyncServer server;
  final phones = <TestPhone>[];

  TestPhone phone(String user) {
    final p = TestPhone(userId: user, teamId: team, transport: () => server.transportFor(user, team), wall: start);
    phones.add(p);
    return p;
  }

  setUp(() {
    serverTime = start;
    server = FakeSyncServer(now: () => serverTime)
      ..noteTypes[(testRedFlags.key, testRedFlags.version)] = redFlagsNoteType;
  });
  tearDown(() {
    for (final p in phones) {
      p.close();
    }
    phones.clear();
  });

  final definitions = {
    for (final d in [...testNoteTypes, redFlagsNoteType])
      (d['key']! as String, d['version']! as int): NoteTypeDef.fromJson(d),
  };

  EncounterRepository repo(TestPhone p) => EncounterRepository(
    p.store,
    user: EncounterUser(
      userId: p.userId,
      displayName: 'Demo Charter',
      credential: 'attending',
      permissions: FakeSyncServer.healthcareStaff,
    ),
    definitions: NoteDefinitions(held: (key, version) async => definitions[(key, version)]),
    openServerRecord: p.engine.openServerRecord,
  );

  CloseSweep sweeper(TestPhone p) => CloseSweep(p.store, now: () => p.wall);

  Future<SyncOutcome> sync(TestPhone p) => p.engine.syncAll(force: true);

  /// Days pass on the phone and on the server alike, so the clock check still holds.
  void later(TestPhone p, Duration d) {
    serverTime = serverTime.add(d);
    p.advance(d);
  }

  Future<String> charted(EncounterRepository r, String visit, TestNoteType type, Map<String, Object?> answers) async {
    final id = (await r.addNote(visit, definitions[(type.key, type.version)]!, another: true)).noteId;
    await r.openNote(id);
    for (final MapEntry(:key, :value) in answers.entries) {
      r.saveAnswer(id, key, value);
    }
    return id;
  }

  bool held(TestPhone p, String id) => p.store.record(id) != null;

  group('a finished note leaves the phone (lifecycle 8.2)', () {
    test('once its sign-off is confirmed, and its visit with it; not before', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final n = await charted(r, visit, testNote, {'vitals.pulse': 88});
      r.complete((await r.openComplete(visit))!);
      final sweep = sweeper(p);
      // Data leaves the phone only after a hash-confirmed receipt.
      expect(sweep.sweep(), isEmpty);
      expect([held(p, n), held(p, visit)], [true, true]);

      server.offline = false;
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      await sweep.refresh(RefreshReason.afterSync);
      expect([held(p, n), held(p, visit)], [false, false]);
      // It stays on the server, and the chart's timeline reads it from there (8.2).
      expect(server.records[n]!.fields['status']!.value, 'completed');
      expect(sweep.sweep(), isEmpty);
    });

    test('a note sent for review stays, so the refresh settles the accept and the notice finds it', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final flags = await charted(r, visit, testRedFlags, {'flags.any': 'no'});
      await sync(p);
      // The credential was lowered on the server and the phone's profile doesn't know (4.2).
      server.changeCredential(alex, 'chw');
      r.complete((await r.openComplete(visit))!);
      await sync(p);
      expect(p.store.sentForReview(flags), isTrue);
      expect(sweeper(p).sweep(), isEmpty);
      expect([p.store.record(flags)!.open, p.store.record(visit)!.open], [true, true]);
    });

    test('anything about it that waits keeps it: an addendum, a correction', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final n = await charted(r, visit, testNote, {'vitals.pulse': 88});
      r.complete((await r.openComplete(visit))!);
      await r.addAddendum(visit, noteId: n, text: 'Demo: results normal');
      server.offline = true;
      final sweep = sweeper(p);
      expect(sweep.sweep(), isEmpty);
      server.offline = false;
      await sync(p);
      server.offline = true;
      // The note's sign-off was confirmed; a correction made since still waits.
      await r.correct(visit, n, changes: {'vitals.pulse': 86}, reason: 'Demo: counted twice');
      expect(sweep.sweep(), isEmpty);
      expect(held(p, n), isTrue);
      server.offline = false;
      await sync(p);
      expect(sweep.sweep(), [n, visit]);
    });

    test('a visit stays while a note of it on the phone is still open', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final done = await charted(r, visit, testNote, {'vitals.pulse': 88});
      r.complete((await r.openComplete(visit))!);
      final draft = await charted(r, visit, testNote, {'care.plan': 'Demo: still talking'});
      await sync(p);
      expect(sweeper(p).sweep(), [done]);
      expect([held(p, done), held(p, draft), p.store.record(visit)!.open], [false, true, true]);
    });

    test('what a screen shows stays, with the notes of a visit shown', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final n = await charted(r, visit, testNote, {'vitals.pulse': 88});
      r.complete((await r.openComplete(visit))!);
      await sync(p);
      final sweep = sweeper(p)..showing.add(visit);
      expect(sweep.sweep(), isEmpty);
      sweep.showing
        ..clear()
        ..add(n);
      expect(sweep.sweep(), isEmpty);
      sweep.showing.clear();
      expect(sweep.sweep(), [n, visit]);
    });

    test('killed between the receipt and the sweep: the next start closes it', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final n = await charted(r, visit, testNote, {'vitals.pulse': 88});
      r.complete((await r.openComplete(visit))!);
      await sync(p);
      await p.restart();
      await sweeper(p).refresh(RefreshReason.opened);
      expect([held(p, n), held(p, visit)], [false, false]);
    });

    test('nothing is closed while the store is frozen for a hand-over', () async {
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = await charted(r, visit, testNote, {'vitals.pulse': 88});
      r.complete((await r.openComplete(visit))!);
      await sync(p);
      p.store.freeze('Demo: handing over');
      expect(sweeper(p).sweep(), isEmpty);
      expect(p.store.record(n)!.open, isTrue);
    });
  });

  group('a draft stays until it is finished, or untouched for 7 days (lifecycle 3.2)', () {
    test('released 7 days after its last change once nothing of it waits; a teammate’s change counts', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final n = await charted(r, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      final sweep = sweeper(p);
      expect(sweep.sweep(), isEmpty);
      later(p, const Duration(days: 6));
      expect(sweep.sweep(), isEmpty);
      // A teammate's change reaches the phone with the refresh: the draft was touched.
      server.serverEdit(n, 'data.care.plan', 'Demo: shelter tonight', by: blair);
      await sync(p);
      expect(p.store.record(n)!.fields['data.care.plan']!.value, 'Demo: shelter tonight');
      expect(sweep.sweep(), isEmpty);
      later(p, const Duration(days: 2));
      expect(sweep.sweep(), isEmpty);
      // Its own change waiting here keeps it whatever its age: a week offline loses nothing.
      server.offline = true;
      r.saveAnswer(n, 'vitals.pulse', 90);
      expect(sweep.sweep(), isEmpty);
      later(p, const Duration(days: 8));
      expect(sweep.sweep(), isEmpty);
      server.offline = false;
      await sync(p);
      expect(sweep.sweep(), isEmpty);
      later(p, const Duration(days: 7));
      expect(sweep.sweep(), [n, visit]);
      // It stays on the server, a draft, and opens again online.
      expect(server.records[n]!.fields['status']!.value, 'draft');
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', n), isTrue);
      expect(p.store.record(n)!.fields['data.vitals.pulse']!.value, 90);
    });

    test('the 7 days are counted across a restart', () async {
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = await charted(r, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      expect(sweeper(p).sweep(), isEmpty);
      later(p, const Duration(days: 4));
      await p.restart();
      expect(sweeper(p).sweep(), isEmpty);
      later(p, const Duration(days: 3));
      expect(sweeper(p).sweep(), [n, visit]);
    });

    test('a visit with no note is released the same way, never at once', () async {
      final p = phone(alex);
      server.offline = true;
      final visit = repo(p).startEncounter(kind: VisitKind.nonMedical);
      final sweep = sweeper(p);
      expect(sweep.sweep(), isEmpty);
      later(p, const Duration(days: 8));
      expect(sweep.sweep(), isEmpty);
      server.offline = false;
      await sync(p);
      expect(sweep.sweep(), isEmpty);
      later(p, const Duration(days: 7));
      expect(sweep.sweep(), [visit]);
      expect(held(p, visit), isFalse);
    });
  });
}
