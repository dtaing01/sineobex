import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import 'fake_server.dart';
import 'phone_harness.dart';
import 'test_note_types.dart';

/// The phone's store in phase 4 (lifecycle 4.8): the visit as the server keeps it. Each rule is
/// checked against the phone's test server, which mirrors the API (lifecycle 4.9): where the answer
/// is the server's, the test syncs and reads the store's state after the receipt.
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
    server = FakeSyncServer(now: () => serverTime);
  });
  tearDown(() {
    for (final p in phones) {
      p.close();
    }
    phones.clear();
  });

  String note(TestPhone p, String encounter, TestNoteType type, [Map<String, Object?> data = const {}]) =>
      p.store.createNote(encounterId: encounter, noteTypeKey: type.key, noteTypeVersion: type.version, data: data);

  Future<SyncOutcome> sync(TestPhone p) => p.engine.syncAll(force: true);

  group('the visit as the server keeps it (lifecycle 4.3)', () {
    test('a new visit holds its kind as a field beside the place typed by hand, and no status', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical', locationText: 'Demo: east underpass');
      final create = p.store.outbox().single;
      expect(create.value, {'kind': 'non_medical', 'locationText': 'Demo: east underpass'});
      final rec = p.store.record(visit)!;
      expect(rec.attributes, isEmpty);
      expect(rec.fields.keys, unorderedEquals(['patientId', 'location', 'locationText', 'kind']));
      expect([rec.fields['kind']!.value, rec.fields['locationText']!.value], ['non_medical', 'Demo: east underpass']);
      expect({for (final f in rec.fields.values) f.pendingChange}, {create.changeId});
      // The server stores text as it is sent, so the phone sends it trimmed and within its length.
      for (final bad in [' Demo: east underpass', 'x' * 201, '']) {
        expect(() => p.store.createEncounter(kind: 'medical', locationText: bad), throwsA(isA<LocalValidationError>()));
      }
      expect(p.store.outbox(), hasLength(1));

      expect(await sync(p), isA<SyncDone>());
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit]!.fields['locationText']!.value, 'Demo: east underpass');
      expect(p.store.record(visit)!.fields['kind']!.serverVersion, 1);

      // Switching to Medical is a set of the kind, from the version the create left it at.
      p.store.setField(visit, 'kind', 'medical');
      expect(p.store.outbox().single.baseVersion, 1);
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit]!.fields['kind']!.value, 'medical');
      expect(
        [p.store.record(visit)!.fields['kind']!.value, p.store.record(visit)!.fields['kind']!.serverVersion],
        ['medical', 2],
      );
    });

    test('a visit’s status is the one the server works out from its notes', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      expect(p.store.record(visit)!.status, 'draft');

      server.finishNote(n);
      expect(server.records[visit]!.status, 'completed');
      await sync(p);
      expect(p.store.record(visit)!.status, 'completed');
      expect(p.store.record(visit)!.fields.containsKey('status'), isFalse);

      // A teammate who opens the visit sees the same, and sees it change.
      final b = phone(blair);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(b.store.record(visit)!.status, 'completed');
      note(p, visit, testNote, {'vitals.pulse': 90});
      await sync(p);
      expect(server.records[visit]!.status, 'draft');
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect([p.store.record(visit)!.status, b.store.record(visit)!.status], ['draft', 'draft']);
    });

    test('a refused visit create is fixed with the place typed by hand the person has now', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical', locationText: 'Demo: east underpass');
      final refused = p.store.outbox().single;
      p.store.reject(refused, reason: 'validation');
      p.store.fixRejected(refused.changeId, {'kind': 'medical'});
      final fix = p.store.sendable().single;
      expect(fix.value, containsPair('locationText', 'Demo: east underpass'));
      expect(p.store.record(visit)!.fields['locationText']!.value, 'Demo: east underpass');

      // Changed since: the fix carries the new place, and nothing follows it.
      p.store.reject(fix, reason: 'validation');
      p.store.setField(visit, 'locationText', 'Demo: north lot');
      p.store.fixRejected(fix.changeId, {'kind': 'medical'});
      expect(p.store.sendable().single.value, containsPair('locationText', 'Demo: north lot'));
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit]!.fields['locationText']!.value, 'Demo: north lot');
    });
  });
}
