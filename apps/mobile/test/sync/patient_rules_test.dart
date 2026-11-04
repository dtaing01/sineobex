import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/canonical_json.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import 'fake_server.dart';
import 'phone_harness.dart';

/// S1's patient-side sync rules (design 2.10 and the Status section's list), through the phone's
/// engine and store against the fake server, and the fake against the shared value vectors. The
/// same rules are services/api's (sync-patients.test.ts, problems-sync.test.ts); the live tests run
/// the starred scenarios against the real API.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  final start = DateTime.utc(2026, 10, 22, 15);

  late DateTime serverTime;
  late FakeSyncServer server;
  var seq = 0;
  final registered = <String>{};
  final phones = <TestPhone>[];
  var ids = 0;
  String uuid() => 'd0d00000-0000-4000-8000-${(++ids).toString().padLeft(12, '0')}';

  TestPhone phone(String user) {
    final p = TestPhone(userId: user, teamId: team, transport: () => server.transportFor(user, team), wall: start);
    phones.add(p);
    return p;
  }

  setUp(() {
    serverTime = start;
    server = FakeSyncServer(now: () => serverTime);
    registered.clear();
  });
  tearDown(() {
    for (final p in phones) {
      p.close();
    }
    phones.clear();
  });

  Map<String, Object?> intake({
    String? preferred = 'Del',
    Map<String, Object?>? legalName,
    String? descriptor,
    Map<String, Object?>? birth,
    Map<String, Object?>? matchCheck,
  }) => {
    'preferredName': ?preferred,
    'legalName': ?legalName,
    'visualDescriptor': ?descriptor,
    'birth': ?birth,
    'consent': {'id': uuid(), 'decision': 'given', 'method': 'verbal', 'scriptVersion': '2026-10-1', 'language': 'en'},
    'privacyNotice': {'id': uuid(), 'decision': 'acknowledged'},
    'matchCheck': ?matchCheck,
  };

  Future<SyncDone> sync(TestPhone p) async => await p.engine.syncAll(force: true) as SyncDone;

  /// A patient on the server, and a phone holding its chart at version 1 (as a download leaves it).
  Future<String> chartOn(List<TestPhone> on, {Map<String, Object?>? value}) async {
    final id = server.seed(entityPatient, value ?? intake(descriptor: 'Demo: green jacket'));
    for (final p in on) {
      expect(await p.engine.openServerRecord(entityPatient, id), isTrue);
    }
    return id;
  }

  /// One change pushed as a phone would, without the phone's own checks: what the server answers
  /// to a value the phone never sends.
  Future<Map<String, Object?>> push(String user, Map<String, Object?> change) async {
    final device = 'dev-$user';
    if (registered.add(device)) {
      await server.handle(user, team, 'POST', '/v1/devices', {
        'deviceId': device,
        'platform': 'android',
        'appVersion': 'test',
        'publicKey': 'key-$user',
      });
    }
    final value = change['value'];
    final res = await server.handle(user, team, 'POST', '/v1/sync/push', {
      'deviceId': device,
      'clock': {'deviceTime': serverTime.toIso8601String()},
      'unsynced': {'counts': <String, Object?>{}, 'oldest': null},
      'changes': [
        {
          'changeId': uuid(),
          'seq': ++seq,
          'baseVersion': 0,
          'deviceTime': serverTime.toIso8601String(),
          'correctedTime': serverTime.toIso8601String(),
          'clockVerified': true,
          'recordId': uuid(),
          ...change,
          'valueHash': valueHash(value),
        },
      ],
    }) as Map<String, Object?>;
    return ((res['results']! as List<Object?>).single! as Map<String, Object?>);
  }

  group('values (rule 1): the fake answers the shared vectors as the API does', () {
    final vectors = jsonDecode(
      File('../../packages/contract/test-vectors/sync-values.json').readAsStringSync(),
    ) as Map<String, Object?>;
    List<Map<String, Object?>> cases(String key) => (vectors[key]! as List<Object?>).cast<Map<String, Object?>>();
    setUp(() => serverTime = DateTime.parse('${vectors['today']}T12:00:00Z'));

    Future<Map<String, Object?>> pushCase(Map<String, Object?> c) =>
        push(alex, {'entity': c['entity'], 'op': c['op'], 'field': ?c['field'], 'value': c['value']});

    test('a valid change is refused only for the first parent the server lacks', () async {
      for (final c in cases('valid')) {
        server = FakeSyncServer(now: () => serverTime);
        registered.clear();
        final r = await pushCase(c);
        final parents = (c['parents']! as List<Object?>).cast<Map<String, Object?>>();
        final details = r['details'] as Map<String, Object?>?;
        if (c['op'] == 'set') {
          // A set's own record is missing first.
          expect(
            [r['reason'], details?['problem']],
            ['stale_reference', 'record_missing'],
            reason: c['name']! as String,
          );
        } else if (parents.isEmpty) {
          expect(r['status'], 'accepted', reason: c['name']! as String);
        } else {
          expect(
            [r['reason'], details?['problem']],
            ['stale_reference', '${parents.first['entity']}_missing'],
            reason: c['name']! as String,
          );
        }
      }
    });

    test('an invalid one fails at the same paths, or breaks the same named rule', () async {
      for (final c in cases('invalid')) {
        final expected = c['expect']! as Map<String, Object?>;
        server = FakeSyncServer(now: () => serverTime);
        registered.clear();
        final r = await pushCase(c);
        expect(r['reason'], 'validation', reason: c['name']! as String);
        final details = r['details']! as Map<String, Object?>;
        if (expected['paths'] case final List<Object?> paths) {
          final got = {for (final p in details['problems']! as List<Object?>) (p! as Map<String, Object?>)['path']};
          expect(got.toList()..sort(), paths, reason: c['name']! as String);
        } else if (c['op'] == 'create') {
          expect(details['problem'], expected['problem'], reason: c['name']! as String);
        }
      }
    });
  });

  group('permissions (rule 2)', () {
    test('a community health worker registers patients and is held for review on problems', () async {
      server.permissions[alex] = FakeSyncServer.chw;
      final p = phone(alex);
      final patient = p.store.createRecord(entityPatient, intake());
      p.store.createRecord(entityAlias, {'patientId': patient, 'alias': 'Dee'});
      final problem = p.store.createRecord(entityProblem, {'patientId': patient, 'title': 'Cough', 'status': 'new'});
      final done = await sync(p);
      expect([done.confirmed, done.rejected], [3, 0]);
      expect(server.records[patient], isNotNull);
      expect(server.records[problem], isNull);
      expect(server.held.values.single.reason, 'permission');
      expect(p.store.inReviewCount(), 1);
      expect(p.store.outbox(), isEmpty);
    });

    test('a retraction needs encounters.chart, and a problem’s also its author or reverse_resolved', () async {
      final a = phone(alex);
      final patient = a.store.createRecord(entityPatient, intake());
      final allergy = a.store.createRecord(entityAllergy, {'patientId': patient, 'substance': 'latex'});
      final problem = a.store.createRecord(entityProblem, {'patientId': patient, 'title': 'Cough', 'status': 'new'});
      await sync(a);
      final b = phone(blair);
      await b.engine.syncAll();
      expect(await b.engine.openServerRecord(entityProblem, problem), isTrue);
      b.store.setField(problem, 'enteredInError', const {'reason': 'Wrong patient'});
      await sync(b);
      expect(server.held.values.map((h) => h.reason), ['permission']);
      expect(server.records[problem]!.retracted, isFalse);

      server.permissions[blair] = {...FakeSyncServer.healthcareStaff, 'patients.reverse_resolved'};
      final r = await push(blair, {
        'entity': entityProblem,
        'op': 'set',
        'recordId': problem,
        'field': 'enteredInError',
        'value': {'reason': 'Wrong patient'},
      });
      expect(r['status'], 'accepted');
      expect(server.records[problem]!.retracted, isTrue);

      server.permissions[alex] = FakeSyncServer.chw;
      a.store.setField(allergy, 'enteredInError', const {'reason': 'Wrong patient'});
      await sync(a);
      expect(server.held.values.map((h) => h.reason), ['permission', 'permission']);
      expect(server.records[allergy]!.status, 'active');
    });
  });

  group('parents (rule 3)', () {
    test('a missing parent is a stale reference; the person’s own held create holds what names it', () async {
      final r = await push(alex, {
        'entity': entityEncounter,
        'op': 'create',
        'value': {'kind': 'medical', 'patientId': uuid()},
      });
      expect([r['reason'], (r['details']! as Map)['problem']], ['stale_reference', 'patient_missing']);

      final patient = server.seedPatient();
      final problem = server.seed(entityProblem, {'patientId': patient, 'title': 'Cough', 'status': 'new'});
      final status = await push(alex, {
        'entity': entityProblem,
        'op': 'set',
        'recordId': problem,
        'field': 'status',
        'baseVersion': 1,
        'value': {'status': 'ongoing', 'encounterId': uuid()},
      });
      expect([status['reason'], (status['details']! as Map)['problem']], ['stale_reference', 'encounter_missing']);

      // Removed from patients.edit while offline: the intake is held, and its street name with it.
      server.permissions[alex] = {'patients.view'};
      final p = phone(alex);
      final held = p.store.createRecord(entityPatient, intake());
      p.store.createRecord(entityAlias, {'patientId': held, 'alias': 'Dee'});
      await sync(p);
      server.permissions[alex] = FakeSyncServer.healthcareStaff;
      p.store.createRecord(entityAllergy, {'patientId': held, 'substance': 'latex'});
      await sync(p);
      expect(server.held.values.map((h) => h.reason), ['permission', 'permission', 'awaiting_review']);
      expect(p.store.inReviewCount(), 3);
      expect(p.store.needsAttention(), isEmpty);
    });
  });

  group('field classes (rule 4)', () {
    test('two phones disagree on Usually found: both confirm, one review, the chart keeps its value', () async {
      final a = phone(alex), b = phone(blair);
      final patient = await chartOn([a, b]);
      a.store.setField(patient, 'usualArea', 'Demo: Fifth Street');
      b.store.setField(patient, 'usualArea', 'Demo: the river path');
      await sync(a);
      final done = await sync(b);
      expect([done.confirmed, done.rejected, done.conflicts], [1, 0, 0]);
      expect(server.records[patient]!.fields['usualArea']!.value, 'Demo: Fifth Street');
      expect(server.reviews.values.single.needs, 'patients.edit');
      expect(b.store.record(patient)!.fields['usualArea']!.value, 'Demo: Fifth Street');
      expect(b.store.notices().single.kind, noticeKeptBoth);
      expect(b.store.needsAttention(), isEmpty);

      // The phone shows the chart's value at its version now, so an edit from there saw it.
      b.store.setField(patient, 'usualArea', 'Demo: the bus shelter');
      await sync(b);
      expect(server.records[patient]!.fields['usualArea']!.value, 'Demo: the bus shelter');
    });

    test('a field review’s second value follows a kept change as kept, not as a silent overwrite', () async {
      final a = phone(alex), b = phone(blair);
      final patient = await chartOn([a, b]);
      a.store.setField(patient, 'usualArea', 'Demo: Fifth Street');
      await sync(a);
      // Two offline edits on b: the first is kept both; the second follows it.
      b.store.setField(patient, 'usualArea', 'Demo: the river path');
      b.store.setField(patient, 'usualArea', 'Demo: the bus shelter');
      await sync(b);
      expect(server.records[patient]!.fields['usualArea']!.value, 'Demo: Fifth Street');
      expect(server.history.where((h) => h['kind'] == 'kept_both'), hasLength(2));
    });

    test('“not asked” is blank: an allergy screen or card choice from an older version fills it', () async {
      final a = phone(alex), b = phone(blair);
      final patient = await chartOn([a, b]);
      a.store.setField(patient, 'usualArea', 'Demo: pier');
      await sync(a);
      server.serverEdit(patient, 'idCardChoice', 'not_asked', by: alex);
      b.store.setField(patient, 'idCardChoice', 'wants');
      await sync(b);
      expect(server.records[patient]!.fields['idCardChoice']!.value, 'wants');
      expect(server.history.last['kind'], 'filled_blank');
    });

    test('identity: a stale fill and an estimate refined too far are kept for an admin', () async {
      final a = phone(alex), b = phone(blair);
      final patient = await chartOn(
        [a, b],
        value: intake(
          legalName: const {'given': 'Delbert', 'family': null},
          birth: const {'precision': 'estimated', 'year': 1980},
        ),
      );
      server.serverEdit(patient, 'legalName', const {'given': 'Delmar', 'family': null}, by: 'admin');
      // b saw {Delbert, -} and only adds the family name, but the admin corrected it since.
      b.store.setField(patient, 'legalName', const {'given': 'Delbert', 'family': 'Quillby'});
      a.store.setField(patient, 'birth', const {'precision': 'year', 'year': 1990});
      await sync(b);
      await sync(a);
      expect(server.records[patient]!.fields['legalName']!.value, {'given': 'Delmar', 'family': null});
      expect(server.records[patient]!.fields['birth']!.value, {'precision': 'estimated', 'year': 1980});
      expect(server.reviews.values.map((r) => (r.field, r.needs)), [
        ('legalName', 'patients.correct_identity'),
        ('birth', 'patients.correct_identity'),
      ]);
      // A change of a recorded value by someone who saw it is an admin's correction: refused.
      final r = await push(alex, {
        'entity': entityPatient,
        'op': 'set',
        'recordId': patient,
        'field': 'legalName',
        'baseVersion': 2,
        'value': {'given': 'Del', 'family': null},
      });
      expect((r['details']! as Map)['problem'], 'identity_admin_only');
    });

    test('two phones each clear a different name: one is kept in history, the patient keeps a name', () async {
      final a = phone(alex), b = phone(blair);
      final patient = await chartOn([a, b]);
      a.store.setField(patient, 'preferredName', null);
      b.store.setField(patient, 'visualDescriptor', null);
      await sync(a);
      final done = await sync(b);
      expect([done.confirmed, done.rejected], [1, 0]);
      expect(server.records[patient]!.fields['visualDescriptor']!.value, 'Demo: green jacket');
      expect(b.store.record(patient)!.fields['visualDescriptor']!.value, 'Demo: green jacket');
      expect(b.store.notices().single.kind, noticeNothingToRecognise);
      expect([a.store.needsAttention(), b.store.needsAttention()], [isEmpty, isEmpty]);
    });

    test('a second retraction is history; a resolution sent on these classes is nothing to resolve', () async {
      final a = phone(alex), b = phone(blair);
      final patient = server.seedPatient();
      final alias = server.seed(entityAlias, {'patientId': patient, 'alias': 'Dee'});
      for (final p in [a, b]) {
        await p.engine.syncAll();
        expect(await p.engine.openServerRecord(entityAlias, alias), isTrue);
      }
      a.store.setField(alias, 'removal', const {'reason': 'Wrong patient'});
      b.store.setField(alias, 'removal', const {'reason': 'Not a name he uses'});
      await sync(a);
      await sync(b);
      expect(server.records[alias]!.fields['removal']!.value, {'reason': 'Wrong patient'});
      expect(server.history.last['kind'], 'kept_both');
      expect(b.store.needsAttention(), isEmpty);
      final r = await push(alex, {
        'entity': entityPatient,
        'op': 'set',
        'recordId': patient,
        'field': 'usualArea',
        'baseVersion': 1,
        'resolution': 'replace',
        'value': 'Demo: dock',
      });
      expect((r['details']! as Map)['problem'], 'nothing_to_resolve');
    });

    test('no known allergies and an allergy, in either order: the allergy wins, nobody reviews', () async {
      final a = phone(alex), b = phone(blair);
      final first = await chartOn([a, b]);
      // The allergy first, then No known allergies from a phone that hadn't seen it.
      a.store.createRecord(entityAllergy, {'patientId': first, 'substance': 'penicillin'});
      await sync(a);
      b.store.setField(first, 'allergyScreen', 'none_known');
      await sync(b);
      expect(server.records[first]!.fields['allergyScreen']!.value, 'not_asked');
      expect(b.store.record(first)!.fields['allergyScreen']!.value, 'not_asked');

      // No known allergies first, then the allergy: the screen goes back to "not asked".
      final second = await chartOn([a]);
      a.store.setField(second, 'allergyScreen', 'none_known');
      await sync(a);
      b.store.createRecord(entityAllergy, {'patientId': second, 'substance': 'latex'});
      await sync(b);
      expect(server.records[second]!.fields['allergyScreen']!.value, 'not_asked');
      expect(server.history.last['kind'], 'cleared_by_allergy');
      expect(server.reviews, isEmpty);
    });
  });

  group('problem status (rule 5)', () {
    late TestPhone a, b;
    late String problem;
    setUp(() async {
      a = phone(alex);
      b = phone(blair);
      final patient = server.seedPatient();
      problem = server.seed(entityProblem, {'patientId': patient, 'title': 'Cough', 'status': 'new'}, at: start);
      for (final p in [a, b]) {
        await p.engine.syncAll();
        expect(await p.engine.openServerRecord(entityProblem, problem), isTrue);
      }
    });
    Map<String, Object?> status(String s) => {'status': s, 'encounterId': null};

    test('a confirmation is an observation: it bumps the version and the check date', () async {
      a.advance(const Duration(hours: 1));
      a.store.setField(problem, 'status', status('ongoing'));
      await sync(a);
      a.advance(const Duration(hours: 1));
      // Still ongoing, seen again in another encounter: a new observation of the same status.
      server.serverEdit(problem, 'status', status('ongoing'), by: alex);
      expect(server.records[problem]!.fields['status']!.version, 3);
    });

    test('“Still ongoing” from a phone bumps the version; an older unseen one stays history only', () async {
      // An hour passes for a and the server alike, so a's clock stays right.
      void later() {
        a.advance(const Duration(hours: 1));
        serverTime = serverTime.add(const Duration(hours: 1));
      }

      b.store.setField(problem, 'status', status('new'), observe: true);
      later();
      a.store.setField(problem, 'status', status('ongoing'));
      await sync(a);
      later();
      a.store.setField(problem, 'status', status('ongoing'), observe: true);
      final seen = await sync(a);
      expect([seen.sent, seen.confirmed], [1, 1]);
      final record = server.records[problem]!;
      expect([record.fields['status']!.version, record.status], [3, 'ongoing']);
      expect(server.history.last['kind'], 'confirmed');
      final checked = record.checkedAt;
      expect(checked, start.add(const Duration(hours: 2)));
      expect(a.store.record(problem)!.fields['status']!.serverVersion, 3);

      // b saw New at the start, before both of a's observations: kept in history, nothing moves.
      final late = await sync(b);
      expect([late.confirmed, late.conflicts, late.rejected], [1, 0, 0]);
      expect([record.fields['status']!.version, record.status, record.checkedAt], [3, 'ongoing', checked]);
      expect(server.history.last['kind'], 'kept_both');
      expect(b.store.record(problem)!.fields['status']!.value, status('ongoing'));
      expect(b.store.needsAttention(), isEmpty);
    });

    test('an older observation that didn’t see the current one is history, even when it agrees', () async {
      b.store.setField(problem, 'status', status('ongoing'));
      a.advance(const Duration(hours: 2));
      a.store.setField(problem, 'status', status('ongoing'));
      await sync(a);
      final checked = server.records[problem]!.checkedAt;
      await sync(b);
      expect(server.records[problem]!.fields['status']!.version, 2);
      expect(server.history.last['kind'], 'kept_both');
      expect(server.records[problem]!.checkedAt, checked);
      expect(b.store.needsAttention(), isEmpty);
    });

    test(
      'Resolved, then Ongoing observed later elsewhere: the problem card; back by the phone that saw it is refused',
      () async {
        a.store.setField(problem, 'status', status('resolved'));
        b.advance(const Duration(hours: 1));
        b.store.setField(problem, 'status', status('ongoing'));
        await sync(a);
        final done = await sync(b);
        expect(done.conflicts, 1);
        expect(server.records[problem]!.status, 'resolved');
        final r = await push(alex, {
          'entity': entityProblem,
          'op': 'set',
          'recordId': problem,
          'field': 'status',
          'baseVersion': 2,
          'value': status('new'),
        });
        expect((r['details']! as Map)['problem'], 'resolved_needs_admin');
      },
    );

    test('work on a problem marked entered in error is kept: the status as history, the note as sent', () async {
      server.serverEdit(problem, 'enteredInError', const {'reason': 'Wrong patient'}, by: 'admin');
      b.store.setField(problem, 'status', status('resolved'));
      final note = b.store.createRecord(entityProblemNote, {'problemId': problem, 'text': 'Better today.'});
      final done = await sync(b);
      expect([done.confirmed, done.rejected], [2, 0]);
      expect(server.records[problem]!.status, 'new');
      expect(server.records[note], isNotNull);
      expect(b.store.notices().map((n) => n.kind), [noticeProblemRetracted]);
    });
  });

  group('receipts and redirects (rules 6 and 7)', () {
    test('a replayed receipt answers the same, server and details included', () async {
      final a = phone(alex), b = phone(blair);
      final patient = await chartOn([a, b]);
      a.store.setField(patient, 'usualArea', 'Demo: Fifth Street');
      await sync(a);
      b.store.setField(patient, 'usualArea', 'Demo: the river path');
      // The server stores it, then the answer is lost: the retry gets the stored answer.
      server.dropPushResponses = 1;
      expect(await b.engine.syncAll(force: true), isA<SyncOffline>());
      expect(b.store.outbox(), hasLength(1));
      await sync(b);
      expect(b.store.record(patient)!.fields['usualArea']!.value, 'Demo: Fifth Street');
      expect(b.store.notices().single.kind, noticeKeptBoth);
      expect(server.reviews, hasLength(1));
    });

    test('a merged patient: sets go to the survivor, children are stored as sent, a card is refused', () async {
      final p = phone(alex);
      final survivor = server.seedPatient(preferredName: 'Del');
      final merged = await chartOn([p]);
      final problem = server.seed(entityProblem, {'patientId': merged, 'title': 'Cough', 'status': 'new'});
      final into = server.seed(entityProblem, {'patientId': survivor, 'title': 'Cough', 'status': 'new'});
      expect(await p.engine.openServerRecord(entityProblem, problem), isTrue);
      final mergeId = server.merge(merged, survivor);
      server.mergeProblem(problem, into);

      p.store.setField(merged, 'usualArea', 'Demo: south lot');
      final alias = p.store.createRecord(entityAlias, {'patientId': merged, 'alias': 'Dee'});
      p.store.setField(problem, 'status', {'status': 'ongoing', 'encounterId': null});
      final card = p.store.createRecord(entityIdLink, {
        'patientId': merged,
        'token': 'DDDDDDDDDDDDDDDDDDDDDD',
        'replacesLinkId': null,
        'reason': 'first_card',
      });
      final done = await sync(p);
      expect([done.confirmed, done.rejected], [3, 1]);
      expect(server.records[survivor]!.fields['usualArea']!.value, 'Demo: south lot');
      expect(
        server.history.firstWhere((h) => h['field'] == 'usualArea' && h['kind'] != 'created')['kind'],
        'redirected',
      );
      expect(server.records[alias]!.patientId, merged);
      expect(server.records[into]!.status, 'ongoing');
      expect(p.store.redirects()[merged]?.survivorId, survivor);
      expect(p.store.redirects()[merged]?.origin, 'receipt');
      final refused = p.store.needsAttention().single;
      expect(
        [refused.recordId, refused.reason, refused.details?['problem'], refused.details?['survivorId']],
        [card, 'stale_reference', 'patient_merged', survivor],
      );
      expect(server.merges[mergeId]!.mergedId, merged);
    });
  });

  group('caps and taken IDs (rule 8)', () {
    test('at most 20 active street names per patient record; a taken consent ID is refused', () async {
      final patient = server.seedPatient();
      for (var i = 0; i < 20; i++) {
        server.seed(entityAlias, {'patientId': patient, 'alias': 'Name $i'});
      }
      final r = await push(alex, {
        'entity': entityAlias,
        'op': 'create',
        'value': {'patientId': patient, 'alias': 'One more'},
      });
      expect((r['details']! as Map)['problem'], 'too_many_aliases');
      final consentId = server.records.values.firstWhere((x) => x.entity == entityConsent).id;
      final again = await push(alex, {
        'entity': entityConsent,
        'op': 'create',
        'recordId': consentId,
        'value': {
          'patientId': patient,
          'kind': 'privacy_notice',
          'decision': 'acknowledged',
          'method': 'verbal',
          'scriptVersion': '2026-10-1',
          'language': 'en',
        },
      });
      expect((again['details']! as Map)['problem'], 'record_exists');
    });

    test('at most 30 active allergies per patient record', () async {
      final patient = server.seedPatient();
      for (var i = 0; i < 30; i++) {
        server.seed(entityAllergy, {'patientId': patient, 'substance': 'Substance $i'});
      }
      final r = await push(alex, {
        'entity': entityAllergy,
        'op': 'create',
        'value': {'patientId': patient, 'substance': 'One more'},
      });
      expect((r['details']! as Map)['problem'], 'too_many_allergies');
    });
  });

  test('an offline search listing 50 patients joins the audit chain with its criteria (rule 9)', () async {
    final p = phone(alex);
    final shown = [for (var i = 0; i < 50; i++) uuid()];
    p.store.appendAudit(
      'patient.searched',
      patientIds: shown,
      resultCount: 55,
      criteria: const ['name', 'birth_year'],
      source: 'team_index',
    );
    await sync(p);
    final entry = server.audit.single;
    expect(
      [entry['action'], entry['patientIds'], entry['criteria'], entry['source']],
      [
        'patient.searched',
        shown,
        ['name', 'birth_year'],
        'team_index',
      ],
    );
  });

  group('matching at sync (rule 10)', () {
    test('a pair flagged against someone the creator wasn’t shown is told; one they were shown is not', () async {
      final a = phone(alex), b = phone(blair);
      final known = server.seedPatient(
        preferredName: 'Delbert',
        legalName: const {'given': 'Delbert', 'family': 'Quillby'},
        birth: const {'precision': 'day', 'date': '1971-03-14'},
      );
      final twin = a.store.createRecord(
        entityPatient,
        intake(
          preferred: 'Del',
          legalName: const {'given': 'Delbert', 'family': 'Quillby'},
          birth: const {'precision': 'day', 'date': '1971-03-14'},
        ),
      );
      await sync(a);
      expect(server.openPair(known, twin), isNotNull);
      expect(a.store.notices().map((n) => (n.kind, n.patientId)), [(noticePossibleDuplicate, twin)]);

      b.store.createRecord(
        entityPatient,
        intake(
          preferred: 'Delbert',
          legalName: const {'given': 'Delbert', 'family': 'Quillby'},
          birth: const {'precision': 'day', 'date': '1971-03-14'},
          matchCheck: {
            'checkId': uuid(),
            'where': 'phone',
            'indexVersion': null,
            'shown': [known, twin],
            'dismissed': [known, twin],
          },
        ),
      );
      await sync(b);
      expect(b.store.notices(), isEmpty);
      expect(server.pairs.where((x) => x.status == 'open'), hasLength(3));
    });
  });
}
