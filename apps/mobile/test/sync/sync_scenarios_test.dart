import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/team_index.dart' show TeamIndexRefresher;
import 'package:sineobex_field/presets/preset_store.dart';
import 'package:sineobex_field/presets/presets_refresher.dart';
import 'package:sineobex_field/sync/clock.dart';
import 'package:sineobex_field/sync/entities.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart' show OpenTeam;
import 'package:sineobex_field/sync/sync_engine.dart';

import 'fake_server.dart';
import 'phone_harness.dart';
import 'test_note_types.dart';
import 'uplink.dart';

/// The test server behind a hand that names, in the next push's answers, a hash the phone never sent,
/// once: what a server holding another value under the change's ID would answer.
class _OtherHash implements ApiTransport {
  _OtherHash(this.inner);
  final ApiTransport inner;
  bool armed = false;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    final answer = await inner.send(method, path, query: query, body: body);
    if (!armed || path != '/v1/sync/push') return answer;
    armed = false;
    final copy = jsonDecode(jsonEncode(answer)) as Map<String, Object?>;
    for (final r in (copy['results']! as List<Object?>).cast<Map<String, Object?>>()) {
      if (r['hash'] is String) r['hash'] = '0' * 64;
    }
    return copy;
  }
}

/// The test server behind a hand that holds the next push, once [hold] is set, until it completes: a
/// push the API is still storing, waiting on the team's write lock. The server then stores it as of
/// when it was sent, as the API dates a change by when its push's transaction began. Every request
/// and answer is written down, in order.
class _HeldPush implements ApiTransport {
  _HeldPush(this.inner, {required this.serverTime, required this.setServerTime});
  final ApiTransport inner;
  final DateTime Function() serverTime;
  final void Function(DateTime) setServerTime;
  Completer<void>? hold;

  /// `sent <path>` and `answered <path>`, as they happened.
  final events = <String>[];

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    events.add('sent $path');
    final held = path == '/v1/sync/push' ? hold : null;
    final Object? answer;
    if (held == null) {
      answer = await inner.send(method, path, query: query, body: body);
    } else {
      hold = null;
      final began = serverTime();
      await held.future;
      final now = serverTime();
      setServerTime(began);
      try {
        answer = await inner.send(method, path, query: query, body: body);
      } finally {
        setServerTime(now);
      }
    }
    events.add('answered $path');
    return answer;
  }
}

/// A refresher whose download waits for [answer]: the note type list an unlock's run asks for first.
class _Waiting implements AfterSyncRefresher {
  _Waiting(this.answer);
  final Future<void> answer;

  @override
  Future<void> refresh(RefreshReason reason) => answer;
}

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

  /// The longest text an answer takes is 4,000 characters (the test note type's, forms 2.4): at 4
  /// bytes a character, about 16 KB.
  String longText(String label) => '$label ${'😴' * (3999 - label.runes.length)}';

  /// The text answer of entry [i] of the test note type's repeating section.
  String rowText(int i) => 'data.rows.e${'$i'.padLeft(7, '0')}.text';

  /// A note with 20 long free-text answers, about 16 KB each: 22 changes, about 320 KB, which takes
  /// longer than the transport allows to send at 5 KB/s.
  String chartLongNote(TestPhone p) {
    final encounter = p.store.createEncounter(kind: 'medical');
    final note = p.store.createNote(
      encounterId: encounter,
      noteTypeKey: testNote.key,
      noteTypeVersion: testNote.version,
    );
    for (var i = 0; i < 20; i++) {
      p.store.setField(note, rowText(i), longText('Demo narrative $i'));
    }
    return note;
  }

  /// One visit charted on [p]: an encounter, a note with vitals, an edit, and a chart view.
  ({String encounter, String note}) chartVisit(TestPhone p) {
    final encounter = p.store.createEncounter(kind: 'medical', location: {'lat': 42.33, 'lng': -83.05});
    final note = p.store.createNote(
      encounterId: encounter,
      noteTypeKey: testNote.key,
      noteTypeVersion: testNote.version,
      data: {'vitals.temp_c': 38.2},
    );
    p.store.setField(note, 'data.vitals.pulse', 96);
    p.store.setField(note, 'data.vitals.temp_c', 38.4);
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
      expect(
        p.store.record(visit.note)!.fields.keys,
        containsAll(['data.vitals.temp_c', 'data.vitals.pulse', 'status']),
      );

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
      expect(onServer['data.vitals.temp_c']!.value, 38.4);
      expect(onServer['data.vitals.temp_c']!.version, 2);
      expect(onServer['data.vitals.pulse']!.value, 96);
      expect(server.audit.single['action'], 'patient.viewed');
    });

    test('an open record keeps its confirmed values on screen until it is closed', () async {
      final p = phone(alex);
      final visit = chartVisit(p);
      await p.engine.syncAll();
      expect(p.store.outbox(), isEmpty);
      expect(p.store.record(visit.note)!.fields['data.vitals.temp_c']!.value, 38.4);
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
      expect(server.records[visit.note]!.fields['data.vitals.temp_c']!.version, 2);
    });

    test('changes made after a restart continue the sequence and keep building on unconfirmed ones', () async {
      final p = phone(alex);
      final visit = chartVisit(p);
      await p.restart();
      p.store.setField(visit.note, 'data.vitals.temp_c', 38.9);
      final seqs = p.store.outbox().map((e) => e.seq).toList();
      expect(seqs, List<int>.generate(seqs.length, (i) => i + 1));
      await p.engine.syncAll();
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit.note]!.fields['data.vitals.temp_c']!.value, 38.9);
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
          // Given time for its size, the whole batch goes at once, then the report of what's left.
          expect(pushes, [22, 0]);
        } else {
          expect(ticks, lessThanOrEqualTo(15));
          expect(pushes.first, 22);
        }
        // Batches that timed out were committed anyway; sent again, each change applied once.
        expect(server.records[note]!.fields[rowText(0)]!.version, 1);
        expect(server.records[note]!.fields[rowText(19)]!.version, 1);
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
      expect(() => p.store.setField(visit.note, 'data.vitals.pulse', 100), throwsA(isA<ChartingPaused>()));
      // Logging and syncing are unaffected.
      p.store.appendAudit('note.viewed', entity: 'encounter_note', entityId: visit.note);
      expect(await p.engine.syncAll(force: true), isA<SyncDone>());
      expect(p.store.outbox(), isEmpty);

      // The person turns on automatic time and taps Check again.
      p.wall = p.wall.add(const Duration(minutes: 7));
      expect((await p.clock.check()).state, ClockState.verified);
      p.store.setField(visit.note, 'data.vitals.pulse', 100);
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
      expect(b.store.record(visit.note)!.fields['data.vitals.temp_c']!.value, 38.4);
      a.store.setField(visit.note, 'data.care.plan', '');
      a.store.setField(visit.note, 'data.vitals.temp_c', 38.6);
      await a.engine.syncAll();
      b.store.setField(visit.note, 'data.vitals.temp_c', 39.0);
      b.store.setField(visit.note, 'data.care.plan', 'recheck Friday');
      b.store.setField(visit.note, 'data.care.allergies', 'penicillin');

      final res = await b.engine.syncAll();
      expect((res as SyncDone).conflicts, 1);
      // Blank on the server: filled in. New field: merged. Same field, different value: shown.
      final shown = b.store.needsAttention().single;
      expect(shown.field, 'data.vitals.temp_c');
      expect([shown.value, shown.server!.value, shown.server!.changedBy], [39.0, 38.6, alex]);
      expect(server.records[visit.note]!.fields['data.care.plan']!.value, 'recheck Friday');
      expect(server.records[visit.note]!.fields['data.care.allergies']!.value, 'penicillin');
      expect(server.history.where((h) => h['kind'] == 'filled_blank'), hasLength(1));

      b.store.resolveConflict(shown.changeId, keepMine: true);
      await b.engine.syncAll(force: true);
      expect(b.store.needsAttention(), isEmpty);
      expect(b.store.outbox(), isEmpty);
      expect(server.records[visit.note]!.fields['data.vitals.temp_c']!.value, 39.0);
      expect(server.history.last, containsPair('kind', 'replaced_after_review'));

      // Alex's phone takes Blair's value at its next sync, since Alex has no edit waiting.
      await a.engine.syncAll(force: true);
      expect(a.store.record(visit.note)!.fields['data.vitals.temp_c']!.value, 39.0);
    });

    test('keeping the other person’s value keeps mine in history and shows theirs here', () async {
      final a = phone(alex);
      final b = phone(blair);
      final visit = chartVisit(a);
      await a.engine.syncAll();
      await b.engine.openServerRecord(entityNote, visit.note);
      b.store.setField(visit.note, 'data.vitals.temp_c', 39.0);
      a.store.setField(visit.note, 'data.vitals.temp_c', 38.6);
      await a.engine.syncAll();
      await b.engine.syncAll();
      final shown = b.store.needsAttention().single;
      b.store.resolveConflict(shown.changeId, keepMine: false);
      await b.engine.syncAll(force: true);
      expect(b.store.outbox(), isEmpty);
      expect(b.store.record(visit.note)!.fields['data.vitals.temp_c']!.value, 38.6);
      expect(server.records[visit.note]!.fields['data.vitals.temp_c']!.value, 38.6);
      expect(server.history.last, containsPair('kind', 'kept_both'));
      expect(server.history.last, containsPair('value', 39.0));
    });

    test('a teammate’s encounter stays while a note on it is charted offline, then expires', () async {
      // Review finding: after a day without signal, any Save & Close purged the encounter, and
      // with it the patient, from under the note still open on it.
      // The server holds encounters only on its patients (migration 0013): the patient comes first.
      final patient = server.seedPatient(id: 'c0000000-0000-4000-8000-00000000000c');
      final a = phone(alex);
      final b = phone(blair);
      final encounter = b.store.createEncounter(kind: 'medical', patientId: patient);
      await b.engine.syncAll();
      await a.engine.syncAll();
      expect(await a.engine.openServerRecord(entityEncounter, encounter), isTrue);
      server.offline = true;
      final note = a.store.createNote(
        encounterId: encounter,
        noteTypeKey: testNote.key,
        noteTypeVersion: testNote.version,
      );
      final other = a.store.createEncounter(kind: 'non_medical');
      a.advance(const Duration(hours: 25));
      a.store.setField(note, 'data.vitals.temp_c', 38.2);
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
      final note = p.store.createNote(
        encounterId: '11111111-1111-4111-8111-111111111111',
        noteTypeKey: testNote.key,
        noteTypeVersion: testNote.version,
      );
      p.store.setField(note, 'data.vitals.temp_c', 38.0);
      await p.engine.syncAll();
      // The create and the edit sent with it are both rejected; the edit needs no fix of its own.
      final attention = p.store.needsAttention();
      expect(attention.map((e) => [e.op, e.reason]), [
        ['create', 'stale_reference'],
        ['set', 'stale_reference'],
      ]);
      final rejected = attention.first;

      p.store.fixRejected(rejected.changeId, {
        'encounterId': encounter,
        'noteTypeKey': testNote.key,
        'noteTypeVersion': testNote.version,
      });
      await p.engine.syncAll(force: true);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[note]!.fields['data.vitals.temp_c']!.value, 38.0);
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
      // A pulse the note type refuses (it takes 0 to 300), and a fix mistyped again: both refused.
      p.store.setField(visit.note, 'data.vitals.pulse', 400);
      await p.engine.syncAll(force: true);
      final first = p.store.needsAttention().single;
      expect(first.reason, 'validation');
      p.store.fixRejected(first.changeId, 1040);
      await p.engine.syncAll(force: true);
      final fix = p.store.needsAttention().single;
      expect([fix.supersedes, fix.reason], [first.changeId, 'validation']);

      p.store.fixRejected(fix.changeId, 104);
      await p.engine.syncAll(force: true);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit.note]!.fields['data.vitals.pulse']!.value, 104);
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
      // A pulse the note type refuses (it takes 0 to 300).
      p.store.setField(visit.note, 'data.vitals.pulse', 400);
      await p.engine.syncAll(force: true);
      final first = p.store.needsAttention().single;
      expect(first.reason, 'validation');
      // A teammate writes the pulse meanwhile, so the fix meets their value.
      server.serverEdit(visit.note, 'data.vitals.pulse', 100, by: blair);
      p.store.fixRejected(first.changeId, 104);
      await p.engine.syncAll(force: true);
      final shown = p.store.needsAttention().single;
      expect(shown.state, ChangeState.conflict);

      p.store.resolveConflict(shown.changeId, keepMine: true);
      await p.engine.syncAll(force: true);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit.note]!.fields['data.vitals.pulse']!.value, 104);
      expect(
        [
          for (final e in [first, shown]) server.receipts[e.changeId]!.resolved,
        ],
        [true, true],
      );
    });

    test('a change the person may no longer make is held by the server for review and leaves the phone', () async {
      final p = phone(alex);
      server.permissions[alex] = FakeSyncServer.chw;
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
      server.permissions[alex] = FakeSyncServer.chw;
      final encounter = p.store.createEncounter(kind: 'medical');
      final first = await p.engine.syncAll() as SyncDone;
      expect([first.confirmed, p.store.inReviewCount()], [1, 1]);

      // A Program Admin gives the role back, and the visit goes on.
      server.permissions.remove(alex);
      p.store.setField(encounter, 'location', {'lat': 42.33, 'lng': -83.05});
      p.store.createNote(
        encounterId: encounter,
        noteTypeKey: testNote.key,
        noteTypeVersion: testNote.version,
        data: {'vitals.temp_c': 38.2},
      );
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
      // Asked again after a backoff, not on every tick.
      expect(await p.engine.syncAll(), isA<SyncWaiting>());
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
      final note = p.store.createNote(
        encounterId: encounter,
        noteTypeKey: testNote.key,
        noteTypeVersion: testNote.version,
        data: {'vitals.temp_c': 38.1},
      );
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
      // At 4 bytes a character, 2,800 characters are about 11 KB.
      final p = phone(alex);
      final encounter = p.store.createEncounter(kind: 'medical');
      final note = p.store.createNote(
        encounterId: encounter,
        noteTypeKey: testNote.key,
        noteTypeVersion: testNote.version,
      );
      for (var i = 0; i < 98; i++) {
        p.store.setField(note, 'data.care.plan', 'Demo narrative $i ${'😴' * 2800}');
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
      final note = p.store.createNote(
        encounterId: '11111111-1111-4111-8111-111111111111',
        noteTypeKey: testNote.key,
        noteTypeVersion: testNote.version,
      );
      // Five answers of about 16 KB each: the most an answer holds, and 80 KB together.
      final answers = {
        'data.care.history': longText('Demo history'),
        'data.care.plan': longText('Demo plan'),
        for (var i = 1; i <= 3; i++) rowText(i): longText('Demo row $i'),
      };
      for (final MapEntry(key: field, :value) in answers.entries) {
        p.store.setField(note, field, value);
      }
      await p.engine.syncAll(force: true);
      final attention = p.store.needsAttention();
      expect(attention.map((e) => [e.op, e.reason]), [
        ['create', 'stale_reference'],
        for (final _ in answers.keys) ['set', 'stale_reference'],
      ]);

      p.store.fixRejected(attention.first.changeId, {
        'encounterId': encounter,
        'noteTypeKey': testNote.key,
        'noteTypeVersion': testNote.version,
      });
      final done = await p.engine.syncAll(force: true) as SyncDone;
      expect([done.confirmed, done.rejected], [2, 0]);
      expect(p.store.outbox(), isEmpty);
      final onServer = server.records[note]!.fields;
      expect({for (final field in answers.keys) field: onServer[field]!.value}, answers);
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
      final note = p.store.createNote(
        encounterId: encounter,
        noteTypeKey: testNote.key,
        noteTypeVersion: testNote.version,
        data: {'care.plan': 'rest'},
      );
      await p.engine.syncAll();
      server.serverEdit(note, 'data.care.plan', 'Demo teammate plan ${'y' * 30000}', by: blair);
      p.store.setField(note, 'data.care.plan', 'fluids');
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

    // Review finding: only the first batch's outcome counted. A wipe order, lost access, a spent
    // device ID or a failure on a later batch came back as SyncDone, so the controller marked the
    // phone synced and acted on none of them.
    for (final (what, onSecondPush, outcome) in <(String, void Function(), Matcher)>[
      ('a wipe order', () => server.devices.values.single.status = 'wipe_requested', isA<SyncWipeRequested>()),
      ('a removal', () => server.removedUsers.add(alex), isA<SyncAccessLost>()),
      ('a spent device ID', () => server.devices.values.single.status = 'wiped', isA<SyncDeviceSpent>()),
      ('a dropped connection', () => throw const NetworkException('offline'), isA<SyncOffline>()),
    ]) {
      test('$what on a later batch is what the sync ends with', () async {
        final p = phone(alex);
        await p.engine.syncAll();
        for (var i = 0; i < 150; i++) {
          p.store.createEncounter(kind: 'medical');
        }
        var pushes = 0;
        server.onRequest = (path) {
          if (path == '/v1/sync/push' && ++pushes == 2) onSecondPush();
        };
        expect(await p.engine.syncAll(), outcome);
        expect(p.store.outbox(), hasLength(50));
      });
    }

    test('after a sync, the server’s report of what the phone holds is what is left', () async {
      // Review finding: each push reports what the phone held before its batch, and nothing pushed
      // again, so the admin's devices page showed confirmed work as waiting on the phone ("Waiting
      // more than 24 hours", and "That work is lost" on a wipe).
      final p = phone(alex);
      await p.engine.syncAll();
      chartVisit(p);
      p.advance(const Duration(hours: 30));
      serverTime = serverTime.add(const Duration(hours: 30));
      final done = await p.engine.syncAll() as SyncDone;
      expect(done.confirmed, 5);
      final device = server.devices.values.single;
      expect(device.unsynced, isEmpty);
      expect(device.oldestUnsynced, isNull);
      // One push with no changes reported it, and that is all: nothing more is sent.
      expect(server.pushes, 3);
      await p.engine.syncAll(force: true);
      expect(server.pushes, 4);
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

    // Review finding S5: the phone's half of the hash-confirmed receipt. The case above spoils the
    // phone's own hash, so the server refuses it before any receipt; these answer with a receipt that
    // names a hash the phone never sent.
    TestPhone behind(_OtherHash link) {
      final p = TestPhone(userId: alex, teamId: team, transport: () => link, wall: start);
      phones.add(p);
      return p;
    }

    test('an accepted answer naming another hash confirms nothing: the change waits, and its stored receipt '
        'confirms it', () async {
      final link = _OtherHash(server.transportFor(alex, team));
      final p = behind(link);
      final id = p.store.createEncounter(kind: 'medical');
      link.armed = true;
      await p.engine.syncAll();
      expect(server.records.containsKey(id), isTrue, reason: 'the server took it');
      expect([for (final e in p.store.outbox()) (e.recordId, e.state)], [(id, ChangeState.pending)]);
      await p.engine.syncAll(force: true);
      expect(p.store.outbox(), isEmpty, reason: 'the stored receipt, naming the hash the phone sent, confirms it');
    });

    // Verification finding VS4: it was stored as a refusal no one could fix, so it and what followed it
    // waited for good, though the server held it.
    test('a held answer naming another hash confirms nothing: the change waits, and its stored receipt '
        'confirms it', () async {
      server.permissions[alex] = {...FakeSyncServer.healthcareStaff}..remove('encounters.chart');
      final link = _OtherHash(server.transportFor(alex, team));
      final p = behind(link);
      final id = p.store.createEncounter(kind: 'medical');
      link.armed = true;
      await p.engine.syncAll();
      expect(server.held, hasLength(1), reason: 'the server held it');
      expect([for (final e in p.store.outbox()) (e.recordId, e.state)], [(id, ChangeState.pending)]);
      expect(p.store.needsAttention(), isEmpty, reason: 'nothing for the person to fix');
      expect(p.store.inReviewCount(), 0, reason: 'nor counted as held there');
      await p.engine.syncAll(force: true);
      expect(p.store.outbox(), isEmpty, reason: 'the stored receipt, naming the hash the phone sent, confirms it');
      expect(p.store.inReviewCount(), 1);
    });
  });

  // Phase 5 (design 5.3, 6.2, 10.2; D135): a patient's flags are changes, each created once at its own
  // time, so two phones offline never overwrite each other, and a clear takes off only its own flag.
  // Written ahead of P5-phone-entity, P5-fake and P5-fake-reads: it fails until they land.
  group('two phones flag the same patient offline', () {
    test('both changes are kept, and a clear of a level the other phone replaced takes nothing off', () async {
      Map<String, Object?> flag(String name, int rank) => {
        'name': name,
        'tier': 'primary',
        'criteria': '',
        'color': 'red',
        'rank': rank,
        'sensitive': false,
      };
      final high = server.addPreset(team, 'flag', flag('High', 10), originKey: 'flag.high');
      final medium = server.addPreset(team, 'flag', flag('Medium', 20), originKey: 'flag.medium');
      final patient = server.seedPatient(preferredName: 'Demo Wren');
      // Both phones saw Medium set this morning.
      server.seed(entityFlagChange, {
        'patientId': patient,
        'flagId': medium,
        'action': 'set',
        'reason': 'Demo: missed a visit',
      }, at: start.subtract(const Duration(hours: 7)));

      final a = phone(alex);
      final b = phone(blair);
      server.offline = true;
      // Alex raises the risk level; five minutes later Blair, who never saw it, clears Medium.
      final raised = a.store.createRecord(entityFlagChange, {
        'patientId': patient,
        'flagId': high,
        'action': 'set',
        'reason': 'Demo: back from hospital today',
      });
      b.advance(const Duration(minutes: 5));
      final cleared = b.store.createRecord(entityFlagChange, {
        'patientId': patient,
        'flagId': medium,
        'action': 'clear',
        'reason': 'Demo: came to every visit this month',
      });
      expect(await a.engine.syncAll(), isA<SyncOffline>());
      expect(a.store.unsynced().counts, {'patients': 1});

      // Both come back online later; Blair's phone syncs first.
      server.offline = false;
      a.advance(const Duration(minutes: 20));
      b.advance(const Duration(minutes: 15));
      serverTime = start.add(const Duration(minutes: 20));
      expect(await b.engine.syncAll(), isA<SyncDone>());
      expect(await a.engine.syncAll(), isA<SyncDone>());
      for (final p in [a, b]) {
        expect(p.store.outbox(), isEmpty);
      }
      // Both kept, each at its own time.
      expect(server.records[raised]!.attributes['effectiveAt'], start.toIso8601String());
      expect(
        server.records[cleared]!.attributes['effectiveAt'],
        start.add(const Duration(minutes: 5)).toIso8601String(),
      );
      // When Blair's clear came, High was the risk level: it took nothing off.
      final chart = (await server.handle(alex, team, 'GET', '/v1/patients/$patient', null))! as Map<String, Object?>;
      final flags = chart['flags']! as Map<String, Object?>;
      expect((flags['primary']! as Map<String, Object?>)['flagId'], high);
      expect((flags['history']! as List<Object?>).length, 3);
    });
  });

  // Verification finding VS1: the server dates a change by when its push began, which can be before an
  // index that leaves it out was worked out (the push waiting on the team's write lock), and the phone
  // then takes that index as holding its change. So the phone runs its own pushes before its own
  // downloads: no refresher starts while a push's batches are under way, whatever asked for it.
  group('a push under way holds back every download until it is answered', () {
    late _HeldPush link;
    late TestPhone p;
    late PatientServices services;

    setUp(() async {
      link = _HeldPush(
        server.transportFor(alex, team),
        serverTime: () => serverTime,
        setServerTime: (t) => serverTime = t,
      );
      p = TestPhone(userId: alex, teamId: team, transport: () => link, wall: start);
      phones.add(p);
      services = PatientServices(
        OpenTeam(
          userId: alex,
          teamId: team,
          store: p.store,
          api: p.engine.api,
          clock: p.clock,
          permissions: FakeSyncServer.healthcareStaff.toList(),
        ),
        idLinkBaseUrl: 'http://localhost:3100',
        copy: (_) async => true,
        wallNow: () => p.wall,
      );
      // A push gives the phone its clock reference; the index refresher comes after, so none is held.
      await p.engine.syncAll();
      p.engine.refreshers.add(TeamIndexRefresher(services.index, p.engine.api, wallNow: () => p.wall));
      link.events.clear();
    });

    void advance(Duration d) {
      p.advance(d);
      serverTime = serverTime.add(d);
    }

    /// Lets everything already under way run as far as it can.
    Future<void> settle() async {
      for (var i = 0; i < 50; i++) {
        await Future<void>.delayed(Duration.zero);
      }
    }

    /// Starts a sync whose push the server holds, and waits until the phone has sent it.
    Future<(Future<SyncOutcome>, Completer<void>)> heldPush() async {
      final held = link.hold = Completer<void>();
      final push = p.engine.syncAll(force: true);
      for (var i = 0; i < 50 && !link.events.contains('sent /v1/sync/push'); i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(link.events, ['sent /v1/sync/push']);
      return (push, held);
    }

    /// The team index was asked for only once every push was answered.
    void indexAfterThePush() {
      final asked = link.events.indexOf('sent /v1/patients/index');
      expect(asked, isNot(-1), reason: 'the index downloads once the push is answered');
      expect(asked, greaterThan(link.events.lastIndexOf('answered /v1/sync/push')));
    }

    for (final reason in [RefreshReason.opened, RefreshReason.timer, RefreshReason.manual]) {
      test('a refresh asked for while a push is held (${reason.name}) asks for the index only once the push is '
          'answered', () async {
        p.store.createEncounter(kind: 'medical');
        final (push, held) = await heldPush();
        final refresh = p.engine.runRefreshers(reason);
        await settle();
        expect(link.events, ['sent /v1/sync/push'], reason: 'nothing is downloaded while the push is under way');
        held.complete();
        expect(await push, isA<SyncDone>());
        await refresh;
        indexAfterThePush();
        expect(p.store.outbox(), isEmpty);
      });
    }

    test('a run under way when a push begins starts no refresher after it until the push is answered', () async {
      // An unlock's run: its first refresher (the note type list) still waits on its answer when the
      // unlock's push begins, and the index's refresher comes next.
      final listed = Completer<void>();
      p.engine.refreshers.insert(0, _Waiting(listed.future));
      final run = p.engine.runRefreshers(RefreshReason.opened);
      p.store.createEncounter(kind: 'medical');
      final (push, held) = await heldPush();
      listed.complete();
      await settle();
      expect(link.events, ['sent /v1/sync/push'], reason: 'the index waits for the push');
      held.complete();
      expect(await push, isA<SyncDone>());
      await run;
      indexAfterThePush();
    });

    test('High set offline over the index’s Low, its push held while the index is asked for: the index comes '
        'after the push, with High, on the profile and the list row', () async {
      Map<String, Object?> flag(String name, int rank) => {
        'name': name,
        'tier': 'primary',
        'criteria': '',
        'color': 'red',
        'rank': rank,
        'sensitive': false,
      };
      final high = server.addPreset(team, 'flag', flag('Demo: High', 10));
      final low = server.addPreset(team, 'flag', flag('Demo: Low', 30));
      await PresetsRefresher(PresetStore(p.store), p.engine.api, current: () => true).refresh(RefreshReason.manual);
      final patient = server.seedPatient(preferredName: 'Demo Wren');
      server.seed(entityFlagChange, {
        'patientId': patient,
        'flagId': low,
        'action': 'set',
        'reason': 'Demo: doing ok',
      }, by: blair);
      advance(const Duration(minutes: 1));
      await p.engine.runRefreshers(RefreshReason.manual);
      expect(services.index.flagsOf(patient)?.primary, low);
      // Opened offline from the index: a list-only copy.
      server.offline = true;
      await services.patients.open(patient);
      expect(isPartialChart(p.store, patient), isTrue);
      advance(const Duration(minutes: 1));
      services.flags.record(patient, flagId: high, action: 'set', reason: 'Demo: worse tonight');
      server.offline = false;

      link.events.clear();
      final (push, held) = await heldPush();
      // The push waits on the team's write lock; two seconds on, the timer asks for the index.
      advance(const Duration(seconds: 2));
      final refresh = p.engine.runRefreshers(RefreshReason.timer);
      await settle();
      held.complete();
      expect(await push, isA<SyncDone>());
      await refresh;
      expect(p.store.outbox(), isEmpty, reason: 'confirmed');
      expect(isPartialChart(p.store, patient), isTrue);
      expect(
        [services.flags.flagsOf(patient).riskLevel?.flagId, services.flags.riskLevelOf(patient)?.flagId],
        [high, high],
        reason: 'the profile and the list row',
      );
      expect(services.index.flagsOf(patient)?.primary, high, reason: 'the index was worked out after the push');
      indexAfterThePush();
    });
  });
}
