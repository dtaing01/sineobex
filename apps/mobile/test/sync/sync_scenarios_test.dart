import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/clock.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import 'fake_server.dart';
import 'phone_harness.dart';

/// Phase 2 done-when: charting in airplane mode, killing the app mid-sync, reconnecting on a slow
/// network, a 7-minute clock offset, and two people editing the same draft.
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

  /// One visit charted on [p]: an encounter, a note with vitals, an edit, and a chart view.
  ({String encounter, String note}) chartVisit(TestPhone p) {
    final encounter = p.store.createEncounter(kind: 'medical', location: {'lat': 42.33, 'lng': -83.05});
    final note = p.store.createNote(encounterId: encounter, noteTypeKey: 'vitals', data: {'temp_c': 38.2});
    p.store.setField(note, 'data.pulse', 96);
    p.store.setField(note, 'data.temp_c', 38.4);
    p.store.appendAudit('patient.viewed', entity: 'patient', entityId: encounter);
    return (encounter: encounter, note: note);
  }

  group('charting in airplane mode', () {
    test('everything is kept on the phone, then confirmed and purged after Save & Close', () async {
      final p = phone(alex);
      server.offline = true;
      final visit = chartVisit(p);
      expect(await p.engine.syncAll(), isA<SyncOffline>());
      expect(p.store.unsynced().counts, {'encounters': 1, 'notes': 3, 'activity': 1});
      // A second try right away waits out the backoff instead of draining the battery.
      expect(await p.engine.syncAll(), isA<SyncWaiting>());

      p.store.closeRecord(visit.note);
      p.store.closeRecord(visit.encounter);
      // Closed but unconfirmed: nothing is purged.
      expect(p.store.record(visit.note)!.fields.keys, containsAll(['data.temp_c', 'data.pulse', 'status']));

      server.offline = false;
      p.advance(const Duration(minutes: 20));
      serverTime = serverTime.add(const Duration(minutes: 20));
      final done = await p.engine.syncAll();
      expect(done, isA<SyncDone>());
      expect((done as SyncDone).confirmed, 5);
      expect(p.store.outbox(), isEmpty);
      expect(p.store.record(visit.note), isNull);
      expect(p.store.record(visit.encounter), isNull);
      final onServer = server.records[visit.note]!.fields;
      expect(onServer['data.temp_c']!.value, 38.4);
      expect(onServer['data.temp_c']!.version, 2);
      expect(onServer['data.pulse']!.value, 96);
      expect(server.audit.single['action'], 'patient.viewed');
    });

    test('an open record keeps its confirmed values on screen until it is closed', () async {
      final p = phone(alex);
      final visit = chartVisit(p);
      await p.engine.syncAll();
      expect(p.store.outbox(), isEmpty);
      expect(p.store.record(visit.note)!.fields['data.temp_c']!.value, 38.4);
      p.store.closeRecord(visit.note);
      expect(p.store.record(visit.note), isNull);
    });
  });

  group('killing the app mid-sync', () {
    test('the server committed but the answer was lost: after a restart the same receipts confirm it', () async {
      final p = phone(alex);
      final visit = chartVisit(p);
      server.dropPushResponses = 1;
      expect(await p.engine.syncAll(), isA<SyncOffline>());
      // Committed on the server, still unconfirmed here.
      expect(server.records, contains(visit.note));
      expect(p.store.outbox(), hasLength(5));

      await p.restart();
      p.advance(const Duration(minutes: 1));
      expect(await p.engine.syncAll(force: true), isA<SyncDone>());
      expect(p.store.outbox(), isEmpty);
      // Applied once: one audit entry, versions as if sent once.
      expect(server.audit, hasLength(1));
      expect(server.records[visit.note]!.fields['data.temp_c']!.version, 2);
    });

    test('changes made after a restart continue the sequence and keep building on unconfirmed ones', () async {
      final p = phone(alex);
      final visit = chartVisit(p);
      await p.restart();
      p.store.setField(visit.note, 'data.temp_c', 38.9);
      final seqs = p.store.outbox().map((e) => e.seq).toList();
      expect(seqs, List<int>.generate(seqs.length, (i) => i + 1));
      await p.engine.syncAll();
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit.note]!.fields['data.temp_c']!.value, 38.9);
    });

    test('a server failure mid-batch leaves the rest unconfirmed, in order, for the next try', () async {
      final p = phone(alex);
      chartVisit(p);
      server.stopAfter = 2;
      final first = await p.engine.syncAll();
      expect(first, isA<SyncDone>());
      expect(p.store.outbox(), hasLength(3));
      server.stopAfter = null;
      p.advance(const Duration(minutes: 11));
      await p.engine.syncAll();
      expect(p.store.outbox(), isEmpty);
    });
  });

  group('reconnecting on a slow network', () {
    test('a timeout after the server committed is a retry, and the clock still measures right', () async {
      final p = phone(alex);
      chartVisit(p);
      // The phone runs 2 minutes behind; each request takes 8 seconds and the first times out.
      p.wall = start.subtract(const Duration(minutes: 2));
      server.onRequest = (_) {
        p.advance(const Duration(seconds: 4));
        serverTime = serverTime.add(const Duration(seconds: 4));
      };
      server.dropPushResponses = 1;
      expect(await p.engine.syncAll(), isA<SyncOffline>());
      p.advance(const Duration(seconds: 30));
      serverTime = serverTime.add(const Duration(seconds: 30));
      expect(await p.engine.syncAll(force: true), isA<SyncDone>());
      expect(p.store.outbox(), isEmpty);
      // Server time is taken at the middle of the round trip, so 8 s each way costs nothing.
      final offset = p.clock.status.offset!;
      expect((offset - const Duration(minutes: 2)).abs(), lessThan(const Duration(seconds: 5)));
      expect(p.clock.status.state, ClockState.verified);
    });

    test('backoff grows to a ten minute ceiling and resets after a success', () async {
      final p = phone(alex);
      chartVisit(p);
      server.offline = true;
      final waits = <Duration>[];
      for (var i = 0; i < 9; i++) {
        await p.engine.syncAll(force: true);
        waits.add(p.engine.nextAttempt!.difference(p.wall));
      }
      expect(waits.first, lessThanOrEqualTo(const Duration(seconds: 5)));
      expect(waits.last, lessThanOrEqualTo(const Duration(minutes: 10)));
      expect(waits.last, greaterThanOrEqualTo(const Duration(minutes: 5)));
      server.offline = false;
      await p.engine.syncAll(force: true);
      expect(p.engine.nextAttempt, isNull);
    });
  });

  group('a 7-minute clock offset', () {
    test('charting pauses, saved data and syncing go on, and it resumes once the clock is fixed', () async {
      final p = phone(alex);
      final visit = chartVisit(p);
      p.wall = start.subtract(const Duration(minutes: 7));
      await p.engine.syncAll();
      expect(p.clock.status.state, ClockState.off);
      expect(p.clock.status.offset!.inMinutes, 7);
      expect(() => p.store.createEncounter(kind: 'medical'), throwsA(isA<ChartingPaused>()));
      expect(() => p.store.setField(visit.note, 'data.pulse', 100), throwsA(isA<ChartingPaused>()));
      // Logging and syncing are unaffected.
      p.store.appendAudit('note.viewed', entity: 'encounter_note', entityId: visit.note);
      expect(await p.engine.syncAll(force: true), isA<SyncDone>());
      expect(p.store.outbox(), isEmpty);

      // The person turns on automatic time and taps Check again.
      p.wall = p.wall.add(const Duration(minutes: 7));
      expect((await p.clock.check()).state, ClockState.verified);
      p.store.setField(visit.note, 'data.pulse', 100);
    });

    test('the check works offline: the clock changed after the last sync is caught by uptime', () async {
      final p = phone(alex);
      await p.engine.syncAll();
      expect((await p.clock.check()).state, ClockState.verified);
      server.offline = true;
      p.advance(const Duration(hours: 2));
      expect((await p.clock.check()).state, ClockState.verified);
      // Someone sets the phone 7 minutes back while it's offline.
      p.wall = p.wall.subtract(const Duration(minutes: 7));
      expect((await p.clock.check()).state, ClockState.off);
      expect(() => p.store.createEncounter(kind: 'medical'), throwsA(isA<ChartingPaused>()));
    });

    test('after an offline restart of the phone, charting goes on and times are flagged unverified', () async {
      final p = phone(alex);
      await p.engine.syncAll();
      server.offline = true;
      p.boot.reboot();
      p.wall = p.wall.subtract(const Duration(minutes: 7));
      await p.restart();
      expect(p.clock.status.state, ClockState.unverified);
      final id = p.store.createEncounter(kind: 'medical');
      final create = p.store.outbox().singleWhere((e) => e.recordId == id);
      expect(create.clockVerified, isFalse);
      expect(create.correctedTime, isNull);
      expect(create.deviceTime, p.wall);
    });

    test('within the limit, times are corrected by the measured offset and both are kept', () async {
      final p = phone(alex);
      p.wall = start.subtract(const Duration(minutes: 3));
      await p.engine.syncAll();
      final id = p.store.createEncounter(kind: 'medical');
      final create = p.store.outbox().singleWhere((e) => e.recordId == id);
      expect(create.clockVerified, isTrue);
      expect(create.correctedTime!.difference(create.deviceTime).inMinutes, 3);
    });
  });

  group('two people editing the same draft', () {
    test('fields merge; a different value on the same field is shown side by side; the choice is sent', () async {
      final a = phone(alex);
      final b = phone(blair);
      final visit = chartVisit(a);
      await a.engine.syncAll();

      // Blair opens Alex's draft. Then Alex adds a blank plan and changes the temperature, while
      // Blair, out of signal, edits the temperature, the plan and the allergies.
      expect(await b.engine.openServerRecord(entityNote, visit.note), isTrue);
      expect(b.store.record(visit.note)!.fields['data.temp_c']!.value, 38.4);
      a.store.setField(visit.note, 'data.plan', '');
      a.store.setField(visit.note, 'data.temp_c', 38.6);
      await a.engine.syncAll();
      b.store.setField(visit.note, 'data.temp_c', 39.0);
      b.store.setField(visit.note, 'data.plan', 'recheck Friday');
      b.store.setField(visit.note, 'data.allergies', 'penicillin');

      final res = await b.engine.syncAll();
      expect((res as SyncDone).conflicts, 1);
      // Blank on the server: filled in. New field: merged. Same field, different value: shown.
      final shown = b.store.needsAttention().single;
      expect(shown.field, 'data.temp_c');
      expect([shown.value, shown.server!.value, shown.server!.changedBy], [39.0, 38.6, alex]);
      expect(server.records[visit.note]!.fields['data.plan']!.value, 'recheck Friday');
      expect(server.records[visit.note]!.fields['data.allergies']!.value, 'penicillin');
      expect(server.history.where((h) => h['kind'] == 'filled_blank'), hasLength(1));

      b.store.resolveConflict(shown.changeId, keepMine: true);
      await b.engine.syncAll(force: true);
      expect(b.store.needsAttention(), isEmpty);
      expect(b.store.outbox(), isEmpty);
      expect(server.records[visit.note]!.fields['data.temp_c']!.value, 39.0);
      expect(server.history.last, containsPair('kind', 'replaced_after_review'));

      // Alex's phone takes Blair's value at its next sync, since Alex has no edit waiting.
      await a.engine.syncAll(force: true);
      expect(a.store.record(visit.note)!.fields['data.temp_c']!.value, 39.0);
    });

    test('keeping the other person’s value keeps mine in history and shows theirs here', () async {
      final a = phone(alex);
      final b = phone(blair);
      final visit = chartVisit(a);
      await a.engine.syncAll();
      await b.engine.openServerRecord(entityNote, visit.note);
      b.store.setField(visit.note, 'data.temp_c', 39.0);
      a.store.setField(visit.note, 'data.temp_c', 38.6);
      await a.engine.syncAll();
      await b.engine.syncAll();
      final shown = b.store.needsAttention().single;
      b.store.resolveConflict(shown.changeId, keepMine: false);
      await b.engine.syncAll(force: true);
      expect(b.store.outbox(), isEmpty);
      expect(b.store.record(visit.note)!.fields['data.temp_c']!.value, 38.6);
      expect(server.records[visit.note]!.fields['data.temp_c']!.value, 38.6);
      expect(server.history.last, containsPair('kind', 'kept_both'));
      expect(server.history.last, containsPair('value', 39.0));
    });
  });

  group('rejections, quarantine and wipe', () {
    test('a rejection waits in Needs attention, holds what depends on it, and the fix confirms both', () async {
      final p = phone(alex);
      final encounter = p.store.createEncounter(kind: 'medical');
      // The server doesn't have the encounter this note points to (it was never synced from here).
      p.store.closeRecord(encounter);
      server.records.clear();
      final note = p.store.createNote(encounterId: '11111111-1111-4111-8111-111111111111', noteTypeKey: 'vitals');
      p.store.setField(note, 'data.temp_c', 38.0);
      await p.engine.syncAll();
      // The create and the edit sent with it are both rejected; the edit needs no fix of its own.
      final attention = p.store.needsAttention();
      expect(attention.map((e) => [e.op, e.reason]), [
        ['create', 'stale_reference'],
        ['set', 'stale_reference'],
      ]);
      final rejected = attention.first;

      p.store.fixRejected(rejected.changeId, {'encounterId': encounter, 'noteTypeKey': 'vitals'});
      await p.engine.syncAll(force: true);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[note]!.fields['data.temp_c']!.value, 38.0);
      expect(server.receipts[rejected.changeId]!.resolved, isTrue);
      expect(server.receipts[attention.last.changeId]!.resolved, isTrue);
      expect(p.store.needsAttention(), isEmpty);
    });

    test('a change the person may no longer make is held by the server for review and leaves the phone', () async {
      final p = phone(alex);
      server.cannotChart.add(alex);
      final visit = chartVisit(p);
      p.store.closeRecord(visit.note);
      p.store.closeRecord(visit.encounter);
      await p.engine.syncAll();
      expect(p.store.outbox(), isEmpty);
      expect(p.store.inReviewCount(), 4);
      expect(server.quarantine, hasLength(4));
      expect(p.store.record(visit.note), isNull);
    });

    test('removed while offline: the phone proves itself with its key and hands its work to quarantine', () async {
      final p = phone(alex);
      await p.engine.syncAll();
      chartVisit(p);
      server.removedUsers.add(alex);
      final outcome = await p.engine.syncAll();
      expect(outcome, isA<SyncAccessLost>());
      expect((outcome as SyncAccessLost).code, 'not_a_member');
      final status = await p.engine.signedStatus();
      expect(status!.access.wire, 'removed');
      expect(await p.engine.uploadToQuarantine(), isTrue);
      expect(server.quarantine, hasLength(5));
      final deviceId = (await p.device.existingDeviceId(team))!;
      await p.engine.confirmWiped(deviceId);
      expect(server.devices[deviceId]!.status, 'wiped');
    });

    test('a remote wipe stops the phone from sending anything more', () async {
      final p = phone(alex);
      await p.engine.syncAll();
      chartVisit(p);
      server.devices.values.single.status = 'wipe_requested';
      expect(await p.engine.syncAll(), isA<SyncWipeRequested>());
      expect(server.records, isEmpty);
    });

    test('a hash the server computes differently never confirms anything', () async {
      final p = phone(alex);
      final id = p.store.createEncounter(kind: 'medical');
      // Simulate corruption: the stored hash no longer matches the value.
      p.db.db.execute('UPDATE outbox SET value_hash = ? WHERE record_id = ?', ['0' * 64, id]);
      await p.engine.syncAll();
      expect(p.store.outbox(), hasLength(1));
      expect(p.store.needsAttention(), isEmpty);
      expect(server.records, isEmpty);
    });
  });
}
