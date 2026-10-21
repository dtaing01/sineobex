import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/clock.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import 'fake_server.dart';
import 'phone_harness.dart';
import 'uplink.dart';

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

  /// A phone on a link that takes [bytesPerSecond] (or no time at all), and the link, which
  /// records what the phone sent.
  (TestPhone, Uplink) linkedPhone(String user, {int? bytesPerSecond}) {
    late final TestPhone p;
    final link = Uplink(
      server.transportFor(user, team),
      bytesPerSecond: bytesPerSecond,
      elapse: (d) {
        p.advance(d);
        serverTime = serverTime.add(d);
      },
    );
    p = TestPhone(userId: user, teamId: team, transport: () => link, wall: start);
    phones.add(p);
    return (p, link);
  }

  /// A note with 20 long free-text fields, about 40 KB each: 22 changes, about 800 KB.
  String chartLongNote(TestPhone p) {
    final encounter = p.store.createEncounter(kind: 'medical');
    final note = p.store.createNote(encounterId: encounter, noteTypeKey: 'wound_care');
    for (var i = 0; i < 20; i++) {
      p.store.setField(note, 'data.narrative_$i', 'Demo narrative $i ${'x' * 40000}');
    }
    return note;
  }

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

    // Review finding: on a weak uplink every push was packed to about 800 KB and timed out at 20 s,
    // then went again the same, so nothing ever synced, and a removal's hand-over never finished.
    for (final rate in [25000, 5000]) {
      test('a long note charted offline syncs on a ${rate ~/ 1000} KB/s uplink in a few tries', () async {
        final (p, link) = linkedPhone(alex, bytesPerSecond: rate);
        await p.engine.syncAll();
        final note = chartLongNote(p);
        // Out of signal first: a connection that fails at once says nothing about size.
        link.offline = true;
        for (var i = 0; i < 3; i++) {
          expect(await p.engine.syncAll(force: true), isA<SyncOffline>());
        }
        link.offline = false;
        // The controller's tick, every 20 seconds.
        var ticks = 0;
        for (; ticks < 30 && p.store.outbox().isNotEmpty; ticks++) {
          p.advance(const Duration(seconds: 20));
          serverTime = serverTime.add(const Duration(seconds: 20));
          await p.engine.syncAll();
        }
        expect(p.store.outbox(), isEmpty);
        final pushes = link.to('/v1/sync/push').skip(1).map((r) => r.changes).toList();
        if (rate == 25000) {
          // Given time for its size, the whole batch goes at once.
          expect(pushes, [22]);
        } else {
          expect(ticks, lessThanOrEqualTo(15));
          expect(pushes.first, 22);
        }
        // Batches that timed out were committed anyway; sent again, each change applied once.
        expect(server.records[note]!.fields['data.narrative_0']!.version, 1);
        expect(server.records[note]!.fields['data.narrative_19']!.version, 1);
      });

      test('a removal hands the same note over on a ${rate ~/ 1000} KB/s uplink in one go', () async {
        final (p, link) = linkedPhone(alex, bytesPerSecond: rate);
        await p.engine.syncAll();
        chartLongNote(p);
        server.removedUsers.add(alex);
        expect(await p.engine.uploadToQuarantine(), p.store.handOverIds());
        expect(server.quarantine, hasLength(22));
        expect(link.to('/quarantine').length, rate == 25000 ? 1 : lessThanOrEqualTo(20));
      });
    }
  });

  group('a 7-minute clock offset', () {
    test('a clock that jumps between checks pauses charting at once, and times stay the server’s', () async {
      // Review finding: the offset cached at the last check was trusted until the next one.
      final p = phone(alex);
      await p.engine.syncAll();
      expect(p.clock.status.state, ClockState.verified);
      p.wall = p.wall.add(const Duration(minutes: 10));
      expect(p.clock.status.paused, isTrue);
      expect(() => p.store.createEncounter(kind: 'medical'), throwsA(isA<ChartingPaused>()));
      p.store.appendAudit('patient.viewed', entity: 'patient', entityId: alex);
      final logged = p.store.outbox().last;
      expect([logged.deviceTime, logged.correctedTime, logged.clockVerified], [p.wall, start, true]);
    });

    test('a reply that takes minutes to arrive doesn’t set the clock; Check again asks afresh', () async {
      // Review finding: the midpoint of an 11-minute round trip paused a phone whose clock was right.
      final p = phone(alex);
      await p.engine.syncAll();
      p.store.createEncounter(kind: 'medical');
      server.onRequest = (path) {
        if (path == '/v1/sync/push') p.advance(const Duration(minutes: 11));
      };
      await p.engine.syncAll(force: true);
      server.onRequest = null;
      serverTime = serverTime.add(const Duration(minutes: 11));
      expect(p.store.outbox(), isEmpty);
      expect(p.clock.status.state, ClockState.verified);
      expect(p.clock.status.offset!.inSeconds.abs(), lessThan(1));

      final fresh = phone(blair)..wall = serverTime;
      expect(fresh.clock.status.state, ClockState.unverified);
      final status = await fresh.engine.refreshClock();
      expect(status.state, ClockState.verified);
    });

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

    test('a teammate’s encounter stays while a note on it is charted offline, then expires', () async {
      // Review finding: after a day without signal, any Save & Close purged the encounter, and
      // with it the patient, from under the note still open on it.
      const patient = 'c0000000-0000-4000-8000-00000000000c';
      final a = phone(alex);
      final b = phone(blair);
      final encounter = b.store.createEncounter(kind: 'medical', patientId: patient);
      await b.engine.syncAll();
      await a.engine.syncAll();
      expect(await a.engine.openServerRecord(entityEncounter, encounter), isTrue);
      server.offline = true;
      final note = a.store.createNote(encounterId: encounter, noteTypeKey: 'vitals');
      final other = a.store.createEncounter(kind: 'non_medical');
      a.advance(const Duration(hours: 25));
      a.store.setField(note, 'data.temp_c', 38.2);
      a.store.closeRecord(other);
      expect(a.clock.status.state, ClockState.verified);
      expect(a.store.record(encounter)!.fields['patientId']!.value, patient);
      expect(a.store.record(note)!.open, isTrue);

      // Back in signal, the note syncs and is closed. The encounter is a read-only copy again, so
      // it goes a day after it was last downloaded.
      server.offline = false;
      serverTime = serverTime.add(const Duration(hours: 25));
      await a.engine.syncAll(force: true);
      a.store.closeRecord(note);
      expect(a.store.record(note), isNull);
      expect(a.store.record(encounter), isNotNull);
      a.advance(const Duration(hours: 25));
      a.store.purge();
      expect(a.store.record(encounter), isNull);
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

    test('a fix of a fix settles every earlier attempt on the server, not only the one it names', () async {
      // Review finding: the server settled only the change a fix named, so the first rejection
      // stayed open there (the devices page said "1 rejected") though the phone held nothing.
      final p = phone(alex);
      final visit = chartVisit(p);
      await p.engine.syncAll();
      // The note is signed on the server for a while: a stand-in for anything a later fix gets past.
      server.serverEdit(visit.note, 'status', 'signed', by: blair);
      p.store.setField(visit.note, 'data.plan', 'rest');
      await p.engine.syncAll(force: true);
      final first = p.store.needsAttention().single;
      p.store.fixRejected(first.changeId, 'rest and fluids');
      await p.engine.syncAll(force: true);
      final fix = p.store.needsAttention().single;
      expect(fix.supersedes, first.changeId);

      server.serverEdit(visit.note, 'status', 'draft', by: blair);
      p.store.fixRejected(fix.changeId, 'rest, fluids and a recheck');
      await p.engine.syncAll(force: true);
      expect(p.store.outbox(), isEmpty);
      expect(
        [
          for (final e in [first, fix]) server.receipts[e.changeId]!.resolved,
        ],
        [true, true],
      );
    });

    test('a choice made on a fix that met a conflict settles the rejection it fixed, on the server too', () async {
      final p = phone(alex);
      final visit = chartVisit(p);
      await p.engine.syncAll();
      server.serverEdit(visit.note, 'status', 'signed', by: blair);
      p.store.setField(visit.note, 'data.plan', 'rest');
      await p.engine.syncAll(force: true);
      final first = p.store.needsAttention().single;
      // Unsigned again, and a teammate writes the plan meanwhile, so the fix meets their value.
      server.serverEdit(visit.note, 'status', 'draft', by: blair);
      server.serverEdit(visit.note, 'data.plan', 'clinic Friday', by: blair);
      p.store.fixRejected(first.changeId, 'rest and fluids');
      await p.engine.syncAll(force: true);
      final shown = p.store.needsAttention().single;
      expect(shown.state, ChangeState.conflict);

      p.store.resolveConflict(shown.changeId, keepMine: true);
      await p.engine.syncAll(force: true);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit.note]!.fields['data.plan']!.value, 'rest and fluids');
      expect(
        [
          for (final e in [first, shown]) server.receipts[e.changeId]!.resolved,
        ],
        [true, true],
      );
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

    test('changes to a record held for review are held with it, not refused as missing', () async {
      // Review finding: the held create counted as on the chart, so once the role was back the
      // edit and the note were sent and refused as stale references, which no fix could get past.
      final p = phone(alex);
      server.cannotChart.add(alex);
      final encounter = p.store.createEncounter(kind: 'medical');
      final first = await p.engine.syncAll() as SyncDone;
      expect([first.confirmed, p.store.inReviewCount()], [1, 1]);

      // A Program Admin gives the role back, and the visit goes on.
      server.cannotChart.remove(alex);
      p.store.setField(encounter, 'location', {'lat': 42.33, 'lng': -83.05});
      p.store.createNote(encounterId: encounter, noteTypeKey: 'vitals', data: {'temp_c': 38.2});
      final second = await p.engine.syncAll() as SyncDone;
      expect([second.sent, second.confirmed, second.rejected], [2, 2, 0]);
      expect(p.store.needsAttention(), isEmpty);
      expect(p.store.outbox(), isEmpty);
      expect(p.store.inReviewCount(), 3);
      expect(server.held.values.map((h) => h.reason), ['permission', 'awaiting_review', 'awaiting_review']);
      expect(server.records, isEmpty);
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
      final waiting = p.store.outbox().map((e) => e.changeId).toSet();
      expect(await p.engine.uploadToQuarantine(), waiting);
      // The chart view joins the audit chain as the person's; the four record changes wait for
      // a Program Admin.
      expect(server.quarantine, hasLength(4));
      expect(server.audit.single, containsPair('afterRemoval', true));
      final deviceId = (await p.device.existingDeviceId(team))!;
      await p.engine.confirmWiped(deviceId);
      expect(server.devices[deviceId]!.status, 'wiped');
    });

    test('a change the server can’t read becomes a rejection instead of stopping every sync', () async {
      final p = phone(alex);
      p.store.createEncounter(kind: 'medical');
      p.store.createEncounter(kind: 'non_medical');
      final bad = p.store.outbox().last;
      server.malformed.add(bad.changeId);
      final first = await p.engine.syncAll() as SyncDone;
      expect([first.rejected, first.confirmed], [1, 0]);
      expect(p.store.needsAttention().single.changeId, bad.changeId);
      await p.engine.syncAll(force: true);
      expect(p.store.outbox().map((e) => e.changeId), [bad.changeId]);
    });

    test('fixing a refused encounter sends it first; its note follows in the same sync and is confirmed', () async {
      final p = phone(alex);
      final encounter = p.store.createEncounter(kind: 'medical');
      final note = p.store.createNote(encounterId: encounter, noteTypeKey: 'vitals', data: {'temp_c': 38.1});
      final create = p.store.outbox().first;
      server.malformed.add(create.changeId);
      await p.engine.syncAll();
      expect(p.store.heldCount(), 1);
      p.store.fixRejected(create.changeId, {'kind': 'medical'});
      final done = await p.engine.syncAll(force: true) as SyncDone;
      expect([done.confirmed, done.rejected], [2, 0]);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[note], isNotNull);
    });

    test('batches stay under the API’s 1 MiB body limit, so large notes still sync', () async {
      // Review finding: 98 edits of an 11 KB narrative made one 1.1 MB push, refused every time.
      final p = phone(alex);
      final encounter = p.store.createEncounter(kind: 'medical');
      final note = p.store.createNote(encounterId: encounter, noteTypeKey: 'vitals');
      for (var i = 0; i < 98; i++) {
        p.store.setField(note, 'data.narrative', 'Demo narrative $i ${'x' * 11000}');
      }
      final done = await p.engine.syncAll() as SyncDone;
      expect([done.confirmed, done.unanswered], [100, 0]);
      expect(p.store.outbox(), isEmpty);
    });

    test('a refused note too large for one create is fixed and sent as a create and edits', () async {
      // Review finding: the fix folded 70 KB of fields into one create, over the API's 64 KiB
      // value limit, so it was refused on the phone and the note could never leave it.
      final p = phone(alex);
      final encounter = p.store.createEncounter(kind: 'medical');
      await p.engine.syncAll();
      final note = p.store.createNote(encounterId: '11111111-1111-4111-8111-111111111111', noteTypeKey: 'vitals');
      final history = 'Demo history ${'h' * 40000}';
      final plan = 'Demo plan ${'p' * 30000}';
      p.store.setField(note, 'data.history', history);
      p.store.setField(note, 'data.plan', plan);
      await p.engine.syncAll(force: true);
      final attention = p.store.needsAttention();
      expect(attention.map((e) => [e.op, e.reason]), [
        ['create', 'stale_reference'],
        ['set', 'stale_reference'],
        ['set', 'stale_reference'],
      ]);

      p.store.fixRejected(attention.first.changeId, {'encounterId': encounter, 'noteTypeKey': 'vitals'});
      final done = await p.engine.syncAll(force: true) as SyncDone;
      expect([done.confirmed, done.rejected], [2, 0]);
      expect(p.store.outbox(), isEmpty);
      final onServer = server.records[note]!.fields;
      expect([onServer['data.history']!.value, onServer['data.plan']!.value], [history, plan]);
      expect(attention.every((e) => server.receipts[e.changeId]!.resolved), isTrue);
    });

    test('removal hands over everything the server can read; an unreadable change doesn’t block it', () async {
      final p = phone(alex);
      p.store.createEncounter(kind: 'medical');
      p.store.createEncounter(kind: 'non_medical');
      final bad = p.store.outbox().last;
      server.malformed.add(bad.changeId);
      await p.engine.syncAll();
      server.malformed.clear();
      p.store.createEncounter(kind: 'medical');
      server.removedUsers.add(alex);
      final handed = await p.engine.uploadToQuarantine();
      expect(handed, p.store.handOverIds());
      expect(handed, hasLength(2));
      expect(handed, isNot(contains(bad.changeId)));
    });

    test('a full disk while recording an answer fails the sync without the value in any message', () async {
      final p = phone(alex);
      final encounter = p.store.createEncounter(kind: 'medical');
      final note = p.store.createNote(encounterId: encounter, noteTypeKey: 'vitals', data: {'plan': 'rest'});
      await p.engine.syncAll();
      server.serverEdit(note, 'data.plan', 'Demo teammate plan ${'y' * 30000}', by: blair);
      p.store.setField(note, 'data.plan', 'fluids');
      final pages = p.db.db.select('PRAGMA page_count').first.values.first! as int;
      p.db.db.execute('PRAGMA max_page_count = $pages');
      final outcome = await p.engine.syncAll(force: true);
      expect((outcome as SyncFailed).code, 'storage');
      expect(p.store.sendable().single.state, ChangeState.pending);
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
