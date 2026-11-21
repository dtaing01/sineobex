import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/encounters/content_hash.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/effective.dart';
import 'package:sineobex_field/sync/canonical_json.dart';
import 'package:sineobex_field/sync/entities.dart';

import 'fake_server.dart';
import 'test_note_types.dart';

/// Where the fake used to answer differently from the API (review finding P8), each pinned to what
/// services/api does: notices (patients/id-links.ts, sync/entities/fields.ts, sync/review.ts), the
/// push (sync/push.ts, sync/apply.ts) and the sync read (routes/sync.ts, sync/review.ts). Phase 4's
/// rules (lifecycle 4.9) follow, each case named after the API test that holds the same rule.
/// A note as a phone holds it: enough to hash it the way the phone does (lifecycle 4.5).
typedef Held = ({
  String noteId,
  String encounterId,
  String? patientId,
  String? summary,
  TestNoteType type,
  Map<String, Object?> answers,
});

/// The note lifecycle's vectors (packages/contract/test-vectors), which the API's own readers hold
/// it to: the fake's sign-off, hash and credential rules answer every case the same.
Map<String, Object?> vectors(String name) =>
    jsonDecode(File('../../packages/contract/test-vectors/$name.json').readAsStringSync()) as Map<String, Object?>;

void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  const casey = 'c0000000-0000-4000-8000-00000000000c';
  const dana = 'd0000000-0000-4000-8000-00000000000d';
  const admin = 'ad000000-0000-4000-8000-0000000000ad';
  final now = DateTime.utc(2026, 10, 22, 15);
  late FakeSyncServer server;
  var seq = 0;
  var ids = 0;
  String uuid() => 'f0f00000-0000-4000-8000-${(++ids).toString().padLeft(12, '0')}';

  setUp(() {
    server = FakeSyncServer(now: () => now);
    seq = 0;
  });

  SineobexApi as(String user) => SineobexApi(server.transportFor(user, team));

  Future<void> register(String user, String device) => server.handle(user, team, 'POST', '/v1/devices', {
    'deviceId': device,
    'platform': 'android',
    'appVersion': 'test',
    'publicKey': 'key-$device',
  });

  /// A change as a phone sends it.
  Map<String, Object?> change(
    String entity,
    String op,
    Object? value, {
    String? recordId,
    String? field,
    int baseVersion = 0,
    Map<String, Object?> more = const {},
  }) => {
    'changeId': uuid(),
    'seq': ++seq,
    'entity': entity,
    'recordId': recordId ?? uuid(),
    'op': op,
    'field': ?field,
    'value': value,
    'valueHash': valueHash(value),
    'baseVersion': baseVersion,
    'deviceTime': now.toIso8601String(),
    'clockVerified': true,
    ...more,
  };

  Future<Map<String, Object?>> push(
    String user,
    String device,
    List<Map<String, Object?>> changes, {
    DateTime? clock,
  }) async => await server.handle(user, team, 'POST', '/v1/sync/push', {
    'deviceId': device,
    'clock': {'deviceTime': (clock ?? now).toIso8601String()},
    'unsynced': {'counts': <String, Object?>{}},
    'changes': changes,
  }) as Map<String, Object?>;

  List<Map<String, Object?>> results(Map<String, Object?> body) =>
      (body['results']! as List<Object?>).cast<Map<String, Object?>>();

  Map<String, Object?> consented(Map<String, Object?> v) => {
    ...v,
    'consent': {'id': uuid(), 'decision': 'given', 'method': 'verbal', 'scriptVersion': '2026-10-1', 'language': 'en'},
    'privacyNotice': {'id': uuid(), 'decision': 'acknowledged'},
  };

  test('a card conflict tells every member who manages the team’s people, naming the valid card', () async {
    server.permissions[admin] = {...FakeSyncServer.healthcareStaff, 'team.manage_users'};
    const gone = 'ad000000-0000-4000-8000-0000000000ae';
    server.permissions[gone] = {...FakeSyncServer.healthcareStaff, 'team.manage_users'};
    server.removedUsers.add(gone);
    final p = server.seedPatient();
    final card = {'patientId': p, 'replacesLinkId': null, 'reason': 'first_card'};
    final older = server.seed(entityIdLink, {...card, 'token': 'HHHHHHHHHHHHHHHHHHHHHH'}, by: alex);
    final newer = server.seed(
      entityIdLink,
      {...card, 'token': 'JJJJJJJJJJJJJJJJJJJJJJ'},
      by: blair,
      at: now.add(const Duration(minutes: 1)),
    );
    expect(
      [for (final n in server.notices) (n.userId, n.kind, n.recordId)],
      [(alex, 'id_link_superseded', older), (blair, 'id_link_kept', newer), (admin, 'id_link_conflict', newer)],
    );
    expect((await as(admin).listNotices()).single.kind, 'id_link_conflict');
  });

  test('“keep theirs” on a draft tells its author when the kept value was someone else’s', () async {
    final encounter = server.seed(entityEncounter, {'kind': 'medical'}, by: alex);
    server.serverEdit(encounter, 'location', const {'lat': 42.33, 'lng': -83.05}, by: blair);
    await register(casey, 'dev-casey');
    await register(alex, 'dev-alex');
    Future<List<String>> choose(String user, String device) async {
      final mine = change(
        entityEncounter,
        'set',
        const {'lat': 42.34, 'lng': -83.04},
        recordId: encounter,
        field: 'location',
        baseVersion: 1,
      );
      final keep = change(
        entityEncounter,
        'set',
        const {'lat': 42.34, 'lng': -83.04},
        recordId: encounter,
        field: 'location',
        baseVersion: 2,
        more: {'conflictOf': mine['changeId'], 'resolution': 'keep_server'},
      );
      return [
        for (final r in results(await push(user, device, [mine, keep]))) r['status']! as String,
      ];
    }

    // The author keeping a teammate's value hears nothing; someone else keeping it tells the author.
    expect(await choose(alex, 'dev-alex'), ['conflict', 'accepted']);
    expect(server.notices, isEmpty);
    expect(await choose(casey, 'dev-casey'), ['conflict', 'accepted']);
    expect(
      [for (final n in server.notices) (n.userId, n.kind, n.entity, n.recordId)],
      [(alex, 'conflict_resolved', entityEncounter, encounter)],
    );
  });

  test('a push measured more than 5 minutes off stores none of its times as verified', () async {
    await register(alex, 'dev-alex');
    final off = change(entityPatient, 'create', consented({'preferredName': 'Demo Fen'}));
    final res = await push(alex, 'dev-alex', [off], clock: now.subtract(const Duration(minutes: 7)));
    expect((res['clock']! as Map<String, Object?>)['flagged'], isTrue);
    expect(results(res).single['status'], 'accepted');
    final right = change(entityPatient, 'create', consented({'preferredName': 'Demo Gale'}));
    await push(alex, 'dev-alex', [right]);
    expect(
      [server.records[off['recordId']]!.clockVerified, server.records[right['recordId']]!.clockVerified],
      [false, true],
    );
    final chart = await as(alex).getPatient(patientId: off['recordId']! as String);
    expect(chart.patient.attributes['clockVerified'], isFalse);
  });

  test('a held change is answered without details, the same on a retry', () async {
    server.permissions[casey] = FakeSyncServer.chw;
    await register(casey, 'dev-casey');
    final p = server.seedPatient();
    final problem = change(entityProblem, 'create', {'patientId': p, 'title': 'Cough', 'status': 'new'});
    final first = results(await push(casey, 'dev-casey', [problem])).single;
    expect(first, {
      'changeId': problem['changeId'],
      'status': 'rejected',
      'reason': 'permission',
      'message': 'rejected: permission',
      'quarantined': true,
      'hash': problem['valueHash'],
    });
    expect(results(await push(casey, 'dev-casey', [problem])).single, first);

    // What a held change waits on is the server's to know (its audit event), not the phone's.
    server.permissions[casey] = FakeSyncServer.healthcareStaff;
    final note = change(entityProblemNote, 'create', {'problemId': problem['recordId'], 'text': 'Better today.'});
    final waiting = results(await push(casey, 'dev-casey', [note])).single;
    expect([waiting['reason'], waiting.containsKey('details')], ['awaiting_review', isFalse]);
    expect(server.held[note['changeId']]!.waitsOn, problem['changeId']);
  });

  test('a change ID someone else holds is refused as reused and never stored; a handed-over one stays held', () async {
    await register(alex, 'dev-alex');
    await register(alex, 'dev-alex-2');
    await register(blair, 'dev-blair');
    final p = server.seedPatient(usualArea: 'Demo: Elm Street underpass');
    final mine = change(entityPatient, 'set', 'Demo: Oak Street lot', recordId: p, field: 'usualArea', baseVersion: 1);
    final first = results(await push(alex, 'dev-alex', [mine])).single;
    expect(first['status'], 'accepted');
    for (final (user, device) in [(blair, 'dev-blair'), (alex, 'dev-alex-2')]) {
      expect(results(await push(user, device, [mine])).single, {
        'changeId': mine['changeId'],
        'status': 'rejected',
        'reason': 'validation',
        'message': 'This change ID was already used. The app will make a new one.',
        'details': {'problem': 'change_id_reused'},
      });
    }
    expect(results(await push(alex, 'dev-alex', [mine])).single, first);

    // Blair's change handed over after a removal, as the hand-over leaves it: no receipt, held.
    final handed = change(entityPatient, 'set', 'Demo: south lot', recordId: p, field: 'usualArea', baseVersion: 2);
    server.quarantine[handed['changeId']! as String] = handed;
    server.held[handed['changeId']! as String] = (
      userId: blair,
      deviceId: 'dev-blair',
      reason: 'access_removed',
      waitsOn: null,
    );
    expect(results(await push(alex, 'dev-alex', [handed])).single['details'], {'problem': 'change_id_reused'});
    final again = results(await push(blair, 'dev-blair', [handed])).single;
    expect(
      [again['reason'], again['details'], again['quarantined'], again['hash']],
      [
        'permission',
        {'problem': 'held_for_review', 'decision': 'pending'},
        true,
        handed['valueHash'],
      ],
    );
    expect(server.records[p]!.fields['usualArea']!.value, 'Demo: Oak Street lot');
    expect(server.receipts.containsKey(handed['changeId']), isFalse);
    // Rejected by a Program Admin, it still stays held, and says so ('a held change its phone pushes
    // normally once the person is back stays held for review', services/api/test/sync.test.ts).
    server.rejectHeld(handed['changeId']! as String);
    expect(results(await push(blair, 'dev-blair', [handed])).single['details'], {
      'problem': 'held_for_review',
      'decision': 'rejected',
    });
    expect(server.records[p]!.fields['usualArea']!.value, 'Demo: Oak Street lot');
  });

  test('a sync read needs each kind’s permission, hides sensitive problems, and is logged', () async {
    final p = server.seedPatient();
    final plain = server.seed(entityProblem, {'patientId': p, 'title': 'Cough', 'status': 'new'});
    final sensitive = server.seed(entityProblem, {
      'patientId': p,
      'title': 'Low mood',
      'status': 'ongoing',
      'code': {'system': 'icd10cm', 'code': 'F32.9'},
    });
    final note = server.seed(entityProblemNote, {'problemId': sensitive, 'text': 'Demo: talked it through.'});
    final encounter = server.seed(entityEncounter, {'kind': 'medical', 'patientId': p});
    final refs = [
      for (final (entity, id) in [
        (entityPatient, p),
        (entityProblem, plain),
        (entityProblem, sensitive),
        (entityProblemNote, note),
        (entityEncounter, encounter),
        (entityPatient, uuid()),
        (entityProblem, p),
      ])
        RecordRef(entity: RecordEntity.fromJson(entity), id: id),
    ];
    server.permissions[alex] = FakeSyncServer.healthcareStaff.difference({'patients.view_sensitive'});
    final got = await as(alex).fetchRecords(body: FetchRecords(records: refs));
    expect(got.records.map((r) => r.id), [p, plain, encounter]);
    expect(got.missing.map((r) => r.id), [sensitive, note, refs[5].id, p]);
    expect(
      [
        for (final a in server.serverAudit) [a['action'], a['entityId'], a['patientId'], a['details']],
      ],
      [
        [
          'patient.viewed',
          p,
          p,
          {'source': 'sync'},
        ],
        [
          'patient.viewed',
          plain,
          p,
          {'source': 'sync'},
        ],
        [
          'encounter.viewed',
          encounter,
          p,
          {'source': 'sync'},
        ],
      ],
    );

    server.permissions[alex] = FakeSyncServer.healthcareStaff;
    expect((await as(alex).fetchRecords(body: FetchRecords(records: refs.sublist(2, 4)))).records, hasLength(2));
    // A community health worker reads patient records, never problems or encounters.
    server.permissions[casey] = FakeSyncServer.chw;
    for (final ref in [refs[1], refs[4]]) {
      await expectLater(
        as(casey).fetchRecords(body: FetchRecords(records: [refs[0], ref])),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 403)),
      );
    }
  });

  // services/api/test/problems-sync.test.ts, 'a note on a problem names the problem’s patient in its
  // snapshot' (lifecycle 8.4, review finding LRA-1).
  test('a note on a problem names the problem’s patient in its snapshot', () async {
    final p = server.seedPatient();
    final problem = server.seed(entityProblem, {'patientId': p, 'title': 'Cough', 'status': 'new'});
    final note = server.seed(entityProblemNote, {'problemId': problem, 'text': 'Demo: dressing changed.'});
    final got = await as(alex).fetchRecords(
      body: FetchRecords(
        records: [RecordRef(entity: RecordEntity.problemNote, id: note)],
      ),
    );
    expect(got.records.single.attributes, {
      'problemId': problem,
      'text': 'Demo: dressing changed.',
      'encounterId': null,
      'writtenAt': now.toIso8601String(),
      'patientId': p,
    });
  });

  // Phase 4, lifecycle 4.9 rules 1 to 6 and 13. Each case has the name of the API test that holds
  // the same rule (services/api/test/sync-encounters.test.ts; rule 13's is
  // db/test/encounter-lifecycle.test.ts) and expects what that test expects of the API.
  group('phase 4: the encounter and its notes', () {
    setUp(() async {
      for (final user in [alex, blair, casey, dana]) {
        await register(user, 'dev-$user');
      }
    });

    Future<List<Map<String, Object?>>> send(String user, List<Map<String, Object?>> changes) async =>
        results(await push(user, 'dev-$user', changes));

    Map<String, Object?> setOn(
      String entity,
      String recordId,
      String field,
      Object? value,
      int baseVersion, {
      Map<String, Object?> more = const {},
    }) => change(entity, 'set', value, recordId: recordId, field: field, baseVersion: baseVersion, more: more);

    String visitOf({String? patientId, String kind = 'medical', String by = alex}) =>
        server.seed(entityEncounter, {'kind': kind, 'patientId': ?patientId}, by: by);

    Map<String, Object?> noteValue(String encounterId, TestNoteType type, [Map<String, Object?>? data]) => {
      'encounterId': encounterId,
      'noteTypeKey': type.key,
      'noteTypeVersion': type.version,
      'data': ?data,
    };

    String noteOn(String encounterId, {TestNoteType type = testNote, String by = alex}) =>
        server.seed(entityNote, noteValue(encounterId, type, const {'care.plan': 'Demo: rest and fluids'}), by: by);

    Map<String, Object?> taken(Map<String, Object?> c, int serverVersion) => {
      'changeId': c['changeId'],
      'status': 'accepted',
      'serverVersion': serverVersion,
      'hash': c['valueHash'],
    };

    /// Kept in history, not applied: the field as the record holds it, and why.
    Map<String, Object?> kept(Map<String, Object?> c, Object? value, int version, String problem) => {
      ...taken(c, version),
      'server': allOf(containsPair('value', value), containsPair('version', version)),
      'details': {'outcome': 'history_only', 'problem': problem},
    };

    Matcher refused(String problem) => allOf(
      containsPair('status', 'rejected'),
      containsPair('reason', 'validation'),
      containsPair('details', {'problem': problem}),
    );

    /// Refused, with exactly these details.
    Matcher refusedWith(Map<String, Object?> details) => allOf(
      containsPair('status', 'rejected'),
      containsPair('reason', 'validation'),
      containsPair('details', details),
    );

    /// Held for a Program Admin (lifecycle 4.2): the phone may let go of it, and is told nothing more.
    Map<String, Object?> heldOnly(Map<String, Object?> c) => {
      'changeId': c['changeId'],
      'status': 'rejected',
      'reason': 'permission',
      'message': 'rejected: permission',
      'quarantined': true,
      'hash': c['valueHash'],
    };

    Matcher refusedAt(String path) => allOf(
      containsPair('status', 'rejected'),
      containsPair('reason', 'validation'),
      containsPair('details', {
        'problems': [containsPair('path', path)],
      }),
    );

    List<String> told(String recordId) => [
      for (final n in server.notices)
        if (n.recordId == recordId) '${n.userId} ${n.kind}',
    ]..sort();

    /// Notices on a note, in the order made: who, what kind, and on which entity.
    List<String> noticesOn(String noteId) => [
      for (final n in server.notices)
        if (n.recordId == noteId) '${n.userId} ${n.kind} ${n.entity}',
    ];

    List<(String, Object?, String)> historyOf(String recordId, String field) => [
      for (final h in server.history)
        if (h['recordId'] == recordId && h['field'] == field) (h['kind']! as String, h['value'], '${h['version']}'),
    ];

    Future<RecordSnapshot> read(String entity, String id) async => (await as(alex).fetchRecords(
      body: FetchRecords(
        records: [RecordRef(entity: RecordEntity.fromJson(entity), id: id)],
      ),
    )).records.single;

    group('the encounter’s fields (lifecycle 4.3)', () {
      test('a create takes a place typed by hand; kind, place and summary are fields, and status is not', () async {
        final p = server.seedPatient();
        final create = change(entityEncounter, 'create', {
          'kind': 'non_medical',
          'patientId': p,
          'location': {'lat': 42.33, 'lng': -83.05},
          'locationText': 'Demo: by the river steps',
        });
        expect(await send(alex, [create]), [taken(create, 1)]);
        final id = create['recordId']! as String;
        expect(
          {for (final MapEntry(:key, :value) in server.records[id]!.fields.entries) key: value.version},
          {'patientId': 1, 'location': 1, 'locationText': 1, 'kind': 1},
        );
        expect(
          [
            for (final h in server.history)
              if (h['recordId'] == id && h['kind'] == 'created') h['field'],
          ]..sort(),
          ['kind', 'location', 'locationText', 'patientId'],
        );
        final snapshot = await read(entityEncounter, id);
        expect(snapshot.status, 'draft');
        expect(snapshot.attributes.keys.toList()..sort(), [
          'clockVerified',
          'hasFinishedNote',
          'startedAt',
          'startedDeviceTime',
        ]);
        expect(snapshot.attributes['hasFinishedNote'], isFalse);
        expect(snapshot.fields.keys.toList()..sort(), ['kind', 'location', 'locationText', 'patientId', 'summary']);
        expect([snapshot.fields['kind']!.value, snapshot.fields['kind']!.version], ['non_medical', 1]);
        expect(
          [snapshot.fields['locationText']!.value, snapshot.fields['locationText']!.version],
          ['Demo: by the river steps', 1],
        );
        expect([snapshot.fields['summary']!.value, snapshot.fields['summary']!.version], [null, 0]);
      });

      test(
        'summary and place are set by the draft rule: what was seen is replaced, what was not is a conflict',
        () async {
          final id = visitOf();
          final summary = setOn(entityEncounter, id, 'summary', 'Demo: cough for a week, no fever', 0);
          final place = setOn(entityEncounter, id, 'locationText', 'Demo: north parking lot', 1);
          expect(await send(alex, [summary, place]), [taken(summary, 1), taken(place, 2)]);
          final other = setOn(entityEncounter, id, 'summary', 'Demo: seen at the shelter door', 0);
          expect(await send(blair, [other]), [
            allOf(
              containsPair('status', 'conflict'),
              containsPair(
                'server',
                allOf(containsPair('value', 'Demo: cough for a week, no fever'), containsPair('version', 1)),
              ),
            ),
          ]);
          final cleared = setOn(entityEncounter, id, 'summary', null, 1);
          expect(await send(alex, [cleared]), [taken(cleared, 2)]);
          expect(server.records[id]!.fields['summary']!.value, isNull);
        },
      );

      // services/api/test/sync-answers-sent-back.test.ts, 'is held for review from a sender the sync
      // read withholds it from, whatever version it names', 'settles a choice … made on a conflict a
      // phone holds from before the hold' and 'is held, not kept in history, after a finished note'
      // (review findings PA-4, VS-1).
      test(
        'a Medical visit’s summary from a sender the sync read withholds it from is held, whatever version it names',
        () async {
          // Casey charts with encounters.chart alone: the sync read leaves a Medical visit's summary out,
          // and a conflict he could never see into would never settle.
          server.permissions[casey] = {'encounters.chart'};
          final id = visitOf(by: casey);
          final caseysFirst = setOn(entityEncounter, id, 'summary', 'Demo: Casey first words', 0);
          expect(await send(casey, [caseysFirst]), [heldOnly(caseysFirst)]);
          final alexs = setOn(entityEncounter, id, 'summary', 'Demo: Alex Medical assessment', 0);
          expect(await send(alex, [alexs]), [taken(alexs, 1)]);
          final caseys = setOn(entityEncounter, id, 'summary', 'Demo: Casey again', 1);
          expect(await send(casey, [caseys]), [heldOnly(caseys)]);
          expect(await send(casey, [caseys]), [
            allOf(containsPair('status', 'rejected'), containsPair('quarantined', true)),
          ]);
          // A choice made on a conflict a phone holds from before the hold, at version 0: held too.
          for (final resolution in ['replace', 'keep_server']) {
            final choice = setOn(
              entityEncounter,
              id,
              'summary',
              'Demo: Casey again',
              0,
              more: {'conflictOf': uuid(), 'resolution': resolution},
            );
            expect(await send(casey, [choice]), [heldOnly(choice)], reason: resolution);
          }
          expect(server.records[id]!.fields['summary']!.value, 'Demo: Alex Medical assessment');
          // Blair, who may read it, is sent it.
          final blairs = setOn(entityEncounter, id, 'summary', 'Demo: Blair from an old copy', 0);
          expect(
            (await send(blair, [blairs])).single['server'],
            containsPair('value', 'Demo: Alex Medical assessment'),
          );
          // Held, not kept in history, once the visit holds a finished note.
          server.finishNote(noteOn(id));
          final late = setOn(entityEncounter, id, 'summary', 'Demo: Casey late words', 1);
          expect(await send(casey, [late]), [heldOnly(late)]);
          // On a Non-Medical visit it goes as it is.
          final outreach = visitOf(kind: 'non_medical', by: casey);
          final words = setOn(entityEncounter, outreach, 'summary', 'Demo: Alex outreach words', 0);
          await send(alex, [words]);
          final mine = setOn(entityEncounter, outreach, 'summary', 'Demo: Casey outreach', 0);
          expect((await send(casey, [mine])).single['server'], containsPair('value', 'Demo: Alex outreach words'));
        },
      );

      // services/api/test/sync-answers-sent-back.test.ts, 'by the sync read’s rules for the record
      // (VA-1)': A1, 'a first answer to a sender who may edit but not read the patient …', A3 and 'a
      // conflict on it is held for review …'.
      test('a value sent back follows the sync read’s rules for the record: nothing of what the sender may not read, and a conflict on it is held', () async {
        const nothing = {'value': null, 'version': 0, 'changedBy': null, 'changedAt': null};
        final p = server.seedPatient(preferredName: 'Demo Robin');
        // A1: kept both, then the sender's role reads no patient record; the retry carries nothing.
        final name = change(entityPatient, 'set', 'Demo Robbie', recordId: p, field: 'preferredName');
        final first = (await send(dana, [name])).single;
        expect(first['details'], containsPair('outcome', 'kept_both'));
        expect(first['server'], containsPair('value', 'Demo Robin'));
        server.permissions[dana] = {'encounters.chart'};
        final reads = server.serverAudit.length;
        expect((await send(dana, [name])).single['server'], nothing);
        expect(server.serverAudit.length, reads);
        // A first answer to a sender who may edit the patient but not read it.
        server.permissions[casey] = {'patients.edit'};
        final edit = change(entityPatient, 'set', 'Demo Robbie', recordId: p, field: 'preferredName');
        final edited = (await send(casey, [edit])).single;
        expect(edited['details'], containsPair('outcome', 'kept_both'));
        expect(edited['server'], nothing);
        // A3: a sensitive problem, to a sender without patients.view_sensitive.
        server.permissions[blair] = {'patients.view', 'encounters.chart'};
        final problem = server.seed(entityProblem, {
          'patientId': p,
          'title': 'Low mood',
          'status': 'ongoing',
          'code': {'system': 'icd10cm', 'code': 'F32.9'},
        });
        server.serverEdit(problem, 'status', const {'status': 'resolved', 'encounterId': null}, by: alex);
        Map<String, Object?> observed(String at) => change(
          entityProblem,
          'set',
          const {'status': 'ongoing', 'encounterId': null},
          recordId: problem,
          field: 'status',
          baseVersion: 0,
          more: {'deviceTime': at, 'correctedTime': at},
        );
        final older = observed('2000-01-01T00:00:00.000Z');
        final kept = (await send(blair, [older])).single;
        expect(kept['details'], containsPair('outcome', 'history_only'));
        expect(kept['server'], nothing);
        expect((await send(blair, [older])).single['server'], nothing);
        // A newer observation out of Resolved is a conflict: held for review from this sender…
        final newer = observed('2099-01-01T00:00:00.000Z');
        expect(await send(blair, [newer]), [heldOnly(newer)]);
        // …and the conflict it was from one who may read the problem.
        final alexs = observed('2099-01-01T00:00:00.000Z');
        expect((await send(alex, [alexs])).single, containsPair('status', 'conflict'));
      });

      test('a summary holds 1 to 4,000 characters and a place 1 to 200, with no space at either end', () async {
        final id = visitOf();
        for (final (field, value) in [
          ('summary', ''),
          ('summary', 'x' * 4001),
          ('summary', ' Demo: a space before'),
          ('summary', 'Demo: a line end after\n'),
          ('summary', 42),
          ('locationText', ''),
          ('locationText', 'y' * 201),
          ('locationText', 'Demo: a space after '),
          ('kind', 'telehealth'),
          ('kind', null),
        ]) {
          expect(await send(alex, [setOn(entityEncounter, id, field, value, 0)]), [refusedAt('')], reason: field);
        }
        final longest = setOn(entityEncounter, id, 'summary', 'Demo:${'é' * 3995}', 0);
        final widest = setOn(entityEncounter, id, 'locationText', 'Demo:${'y' * 195}', 1);
        expect(
          [
            for (final r in await send(alex, [longest, widest])) r['status'],
          ],
          ['accepted', 'accepted'],
        );
        for (final locationText in ['', 'y' * 201, ' Demo: padded']) {
          final create = change(entityEncounter, 'create', {'kind': 'medical', 'locationText': locationText});
          expect(await send(alex, [create]), [refusedAt('locationText')]);
        }
        final withSummary = change(entityEncounter, 'create', {'kind': 'medical', 'summary': 'Demo: early'});
        expect(await send(alex, [withSummary]), [containsPair('reason', 'validation')]);
      });

      test('status is no longer a field: the database works it out from the notes', () async {
        final id = visitOf();
        for (final value in ['completed', 'draft']) {
          expect(await send(alex, [setOn(entityEncounter, id, 'status', value, 1)]), [refused('unknown_field')]);
        }
        expect((await read(entityEncounter, id)).status, 'draft');
        expect(historyOf(id, 'status'), isEmpty);
      });

      test('kind goes to Medical from any version, and a move back is kept in history, not applied', () async {
        final id = visitOf(kind: 'non_medical');
        // Blair never saw the kind (version 0): the switch applies all the same, since it only goes one way.
        final medical = setOn(entityEncounter, id, 'kind', 'medical', 0);
        expect(await send(blair, [medical]), [taken(medical, 2)]);
        final back = setOn(entityEncounter, id, 'kind', 'non_medical', 2);
        final answered = await send(alex, [back]);
        expect(answered, [
          {
            ...taken(back, 2),
            'server': allOf(
              containsPair('value', 'medical'),
              containsPair('version', 2),
              containsPair('changedBy', blair),
            ),
            'details': {'outcome': 'history_only', 'problem': 'kind_cannot_go_back'},
          },
        ]);
        expect(
          [server.records[id]!.fields['kind']!.value, server.records[id]!.fields['kind']!.version],
          ['medical', 2],
        );
        expect(historyOf(id, 'kind'), [
          ('created', 'non_medical', '1'),
          ('set', 'medical', '2'),
          ('kept_both', 'non_medical', '2'),
        ]);
        // Sent twice, it answers the same.
        expect(await send(alex, [back]), answered);

        // Medical again changes nothing; a kind never conflicts, so there is nothing to resolve.
        final again = setOn(entityEncounter, id, 'kind', 'medical', 1);
        final resolved = setOn(entityEncounter, id, 'kind', 'medical', 2, more: {'resolution': 'replace'});
        expect(await send(alex, [again, resolved]), [taken(again, 2), refused('nothing_to_resolve')]);
        expect(historyOf(id, 'kind'), hasLength(3));
        expect(server.notices, isEmpty);
      });

      const late = {'outcome': 'history_only', 'problem': 'encounter_has_finished_note'};

      test(
        'once a note is finished, a change to the patient, place or summary is kept in history, and the sender is told',
        () async {
          final [first, second] = [server.seedPatient(), server.seedPatient()];
          final id = visitOf(patientId: first);
          server.finishNote(noteOn(id));
          final before = {for (final MapEntry(:key, :value) in server.records[id]!.fields.entries) key: value.value};
          final changes = [
            setOn(entityEncounter, id, 'summary', 'Demo: written after the note was done', 0),
            setOn(entityEncounter, id, 'locationText', 'Demo: south parking lot', 1),
            setOn(entityEncounter, id, 'location', const {'lat': 42.3, 'lng': -83.0}, 1),
            setOn(entityEncounter, id, 'patientId', second, 1),
            // The answer to a conflict, which saw the value it replaces, is kept all the same.
            setOn(entityEncounter, id, 'locationText', 'Demo: by the clinic van', 1, more: {'resolution': 'replace'}),
          ];
          const held = {'summary': null, 'locationText': null, 'location': null};
          final answered = await send(blair, changes);
          expect(answered, [
            for (final c in changes)
              {
                ...taken(c, c['field'] == 'summary' ? 0 : 1),
                'server': allOf(
                  containsPair('value', c['field'] == 'patientId' ? first : held[c['field']]),
                  containsPair('version', c['field'] == 'summary' ? 0 : 1),
                ),
                'details': late,
              },
          ]);
          expect({for (final MapEntry(:key, :value) in server.records[id]!.fields.entries) key: value.value}, before);
          expect(
            [
              for (final h in server.history)
                if (h['recordId'] == id && h['kind'] != 'created') [h['field'], h['value'], h['kind']],
            ],
            [
              for (final c in changes) [c['field'], c['value'], 'kept_both'],
            ],
          );
          // ...and so is whoever acts as the note's author (3.6; review finding REC-2).
          expect(told(id), [
            for (final _ in changes) '$alex late_change_kept',
            for (final _ in changes) '$blair late_change_kept',
          ]);
          expect(server.notices.every((n) => n.entity == entityEncounter), isTrue);

          // Sent twice, it answers the same, and nothing more is kept or told.
          expect(await send(blair, changes), answered);
          expect(told(id), hasLength(2 * changes.length));
        },
      );

      test('a late change to the envelope tells whoever acts as the author of each finished note, once each, never the sender twice', () async {
        final id = visitOf(patientId: server.seedPatient());
        // Two of Alex's notes, one of Casey's, and a draft of Blair's, which settles nothing.
        server.finishNote(noteOn(id));
        server.finishNote(noteOn(id));
        server.finishNote(noteOn(id, by: casey));
        noteOn(id, by: blair);
        final fromBlair = setOn(entityEncounter, id, 'summary', 'Demo: one more line', 0);
        final fromCasey = setOn(entityEncounter, id, 'summary', 'Demo: another line', 0);
        expect((await send(blair, [fromBlair])).single['details'], late);
        expect((await send(casey, [fromCasey])).single['details'], late);
        final notices = [
          for (final n in server.notices)
            if (n.recordId == id) n.userId,
        ];
        expect(notices.sublist(0, 3), unorderedEquals([alex, blair, casey]));
        expect(notices.sublist(3), unorderedEquals([alex, casey]));
      });

      test(
        'a signed visit keeps a late change too, and takes a new note: an encounter is never locked whole',
        () async {
          final p = server.seedPatient();
          final id = visitOf(patientId: p);
          server.finishNote(noteOn(id, type: testMedical), status: 'signed');
          expect((await read(entityEncounter, id)).status, 'signed');
          final summary = setOn(entityEncounter, id, 'summary', 'Demo: one more line', 0);
          expect(await send(alex, [summary]), [allOf(containsPair('serverVersion', 0), containsPair('details', late))]);
          expect(told(id), ['$alex late_change_kept']);
          // The note is the unit (4.4): a teammate's new note on the signed visit is taken, and the visit
          // is a draft again while it is.
          final note = change(entityNote, 'create', noteValue(id, testNote, const {'care.plan': 'Demo: later'}));
          expect(await send(blair, [note]), [taken(note, 1)]);
          expect((await read(entityEncounter, id)).status, 'draft');
        },
      );

      test(
        'while every note of the visit is a draft, the draft rule applies; another visit’s finished note is no lock',
        () async {
          final finished = visitOf();
          server.finishNote(noteOn(finished));
          final open = visitOf();
          noteOn(open);
          final summary = setOn(entityEncounter, open, 'summary', 'Demo: still writing', 0);
          expect(await send(alex, [summary]), [taken(summary, 1)]);
          expect(server.records[open]!.fields['summary']!.value, 'Demo: still writing');
          expect(told(open), isEmpty);
        },
      );

      test('the kind still goes to Medical after a finished note, and still never back', () async {
        final id = visitOf(kind: 'non_medical');
        server.finishNote(noteOn(id));
        final medical = setOn(entityEncounter, id, 'kind', 'medical', 1);
        final back = setOn(entityEncounter, id, 'kind', 'non_medical', 2);
        expect(await send(alex, [medical, back]), [
          taken(medical, 2),
          containsPair('details', {'outcome': 'history_only', 'problem': 'kind_cannot_go_back'}),
        ]);
        expect(server.records[id]!.fields['kind']!.value, 'medical');
        expect(told(id), isEmpty);
      });

      test(
        'a visit with no patient can be given one after a finished note; one with the same value is no change',
        () async {
          final p = server.seedPatient();
          final id = visitOf();
          server.finishNote(noteOn(id));
          // Blair never saw the blank (version 0): a blank holds nothing to overwrite.
          final named = setOn(entityEncounter, id, 'patientId', p, 0);
          final same = setOn(entityEncounter, id, 'locationText', null, 0);
          expect(await send(blair, [named, same]), [taken(named, 2), taken(same, 1)]);
          expect(server.records[id]!.fields['patientId']!.value, p);
          expect([for (final h in historyOf(id, 'patientId')) h.$1], ['created', 'filled_blank']);
          expect(told(id), isEmpty);
          // Named now, it is held like the rest of the envelope.
          final moved = setOn(entityEncounter, id, 'patientId', server.seedPatient(), 2);
          expect(await send(blair, [moved]), [
            allOf(containsPair('status', 'accepted'), containsPair('details', late)),
          ]);
          expect(server.records[id]!.fields['patientId']!.value, p);
        },
      );

      test(
        'a visit moves its patient’s last seen to when it started: later only, and never past the server’s clock',
        () async {
          // Read where the phone reads it: the team index, its version, and the match check (FAK-5).
          final earlier = DateTime.utc(2026, 10, 1, 10);
          final p = server.seedPatient(at: earlier);
          Future<Map<String, Object?>> index() async =>
              await server.handle(alex, team, 'POST', '/v1/patients/index', {'limit': 100}) as Map<String, Object?>;
          String? lastSeenOn(Map<String, Object?> body) => [
            for (final e in (body['entries']! as List<Object?>).cast<Map<String, Object?>>())
              if (e['patientId'] == p) e['lastSeenOn'] as String?,
          ].single;
          final held = await index();
          expect(lastSeenOn(held), '2026-10-01');
          Map<String, Object?> visit(String? patientId, Map<String, Object?> time) =>
              change(entityEncounter, 'create', {'kind': 'medical', 'patientId': ?patientId}, more: time);

          // Started later than it was last seen (clock-corrected time): moved to the start.
          final seen = visit(p, {'correctedTime': '2026-10-20T14:30:04.000Z'});
          // Started earlier: not moved back.
          final older = visit(p, {'correctedTime': '2026-10-15T09:00:00.000Z'});
          expect(
            [
              for (final r in await send(alex, [seen, older])) r['status'],
            ],
            ['accepted', 'accepted'],
          );
          expect(server.records[p]!.seenAt, DateTime.utc(2026, 10, 20, 14, 30, 4));
          // The index the phone holds is no longer current.
          final moved = await server.handle(alex, team, 'POST', '/v1/patients/index', {
            'have': held['version'],
            'limit': 100,
          }) as Map<String, Object?>;
          expect(moved['version'], isNot(held['version']));
          expect(lastSeenOn(moved), '2026-10-20');
          // Stamped after the server's clock: moved to the server's clock, never past it (review
          // finding REC-4). The visit happened, and a phone's wrong clock sets no future.
          final ahead = visit(p, {'deviceTime': '2026-10-23T09:00:00.000Z'});
          expect(
            [
              for (final r in await send(alex, [ahead])) r['status'],
            ],
            ['accepted'],
          );
          expect(server.records[p]!.seenAt, now);

          // A patient set that applies moves the new patient's last seen to the visit's start.
          final q = server.seedPatient(at: earlier);
          final unnamed = visit(null, {'correctedTime': '2026-10-19T12:00:00.000Z'});
          expect(
            [
              for (final r in await send(alex, [unnamed])) r['status'],
            ],
            ['accepted'],
          );
          server.finishNote(noteOn(unnamed['recordId']! as String));
          final named = setOn(entityEncounter, unnamed['recordId']! as String, 'patientId', q, 1);
          expect(
            [
              for (final r in await send(alex, [named])) r['status'],
            ],
            ['accepted'],
          );
          expect(server.records[q]!.seenAt, DateTime.utc(2026, 10, 19, 12));

          // One kept in history moves nothing.
          final r = server.seedPatient(at: earlier);
          final again = setOn(entityEncounter, unnamed['recordId']! as String, 'patientId', r, 2);
          expect((await send(alex, [again])).single['details'], late);
          expect(server.records[r]!.seenAt, earlier);
        },
      );

      test('a patient is never taken off a visit', () async {
        final p = server.seedPatient();
        final named = visitOf(patientId: p);
        final off = setOn(entityEncounter, named, 'patientId', null, 1);
        expect(await send(alex, [off]), [kept(off, p, 1, 'patient_cannot_be_removed')]);
        expect(server.records[named]!.fields['patientId']!.value, p);
        expect(told(named), isEmpty);
        // A move to another patient, before any note is finished, is the draft rule's.
        final moved = setOn(entityEncounter, named, 'patientId', server.seedPatient(), 1);
        expect(await send(alex, [moved]), [taken(moved, 2)]);
        // Nobody to take off: nothing changes.
        final nobody = visitOf();
        final none = setOn(entityEncounter, nobody, 'patientId', null, 1);
        expect(await send(alex, [none]), [taken(none, 1)]);
      });
    });

    group('the note’s create (lifecycle 4.4)', () {
      test('a version past the largest a change may name is refused by the schema, and the queue goes on', () async {
        final visit = visitOf();
        final past = change(entityNote, 'create', {...noteValue(visit, testNote), 'noteTypeVersion': 3000000000});
        final known = change(entityNote, 'create', noteValue(visit, testNote));
        final answers = await send(alex, [past, known]);
        expect(answers.first, refusedAt('noteTypeVersion'));
        expect(answers.last, taken(known, 1));
        // Sent again, it answers the same from its receipt, and the queue still moves.
        expect((await send(alex, [past])).single['status'], 'rejected');
      });

      test('names a key and version the team holds, or is refused unknown_note_type, and the queue goes on', () async {
        final id = visitOf(patientId: server.seedPatient());
        final unknown = [
          change(entityNote, 'create', noteValue(id, (key: 'demo_unknown', version: 1))),
          change(entityNote, 'create', noteValue(id, (key: testNote.key, version: 2))),
          // A note with no version is a phase 2 preview row: no new one is made.
          change(entityNote, 'create', {'encounterId': id, 'noteTypeKey': testNote.key}),
        ];
        final known = change(entityNote, 'create', noteValue(id, testNote));
        expect(await send(alex, [...unknown, known]), [
          for (final _ in unknown) refused('unknown_note_type'),
          taken(known, 1),
        ]);
        for (final c in unknown) {
          expect(server.records[c['recordId']], isNull);
        }
        expect(server.records[known['recordId']]!.medical, isFalse);
      });

      test(
        'a Medical note needs a visit that names a patient, ahead of the Medical gate; named, the same create is taken',
        () async {
          final p = server.seedPatient();
          final id = visitOf();
          final medical = change(entityNote, 'create', noteValue(id, testMedical, const {'vitals.pulse': 88}));
          final social = change(entityNote, 'create', noteValue(id, testNote));
          expect(await send(alex, [medical, social]), [refused('medical_note_needs_patient'), taken(social, 1)]);
          expect(server.records[medical['recordId']], isNull);

          // The worker names the patient; the store sends the note's create again as the fix of the refused one.
          final named = setOn(entityEncounter, id, 'patientId', p, 1);
          final again = change(
            entityNote,
            'create',
            medical['value'],
            recordId: medical['recordId']! as String,
            more: {'supersedes': medical['changeId']},
          );
          expect(await send(alex, [named, again]), [taken(named, 2), taken(again, 1)]);
          expect(server.records[medical['recordId']]!.medical, isTrue);
          expect(server.records[medical['recordId']]!.fields['data.vitals.pulse']!.value, 88);
          expect(server.receipts[medical['changeId']]!.resolved, isTrue);
        },
      );

      test('a Medical note makes its visit Medical, as a change of the visit’s kind', () async {
        final p = server.seedPatient();
        final visit = change(entityEncounter, 'create', {'kind': 'non_medical', 'patientId': p});
        final id = visit['recordId']! as String;
        final social = change(entityNote, 'create', noteValue(id, testNote));
        expect(await send(alex, [visit, social]), [taken(visit, 1), taken(social, 1)]);
        expect(
          [server.records[id]!.fields['kind']!.value, server.records[id]!.fields['kind']!.version],
          ['non_medical', 1],
        );

        final medical = change(entityNote, 'create', noteValue(id, testMedical));
        expect(await send(alex, [medical]), [taken(medical, 1)]);
        final kind = server.records[id]!.fields['kind']!;
        expect([kind.value, kind.version, kind.by, kind.changeId], ['medical', 2, alex, medical['changeId']]);
        expect(
          [
            for (final h in server.history)
              if (h['recordId'] == id && h['field'] == 'kind')
                [h['version'], h['value'], h['previous'], h['kind'], h['by'], h['changeId']],
          ],
          [
            [1, 'non_medical', null, 'created', alex, visit['changeId']],
            [2, 'medical', 'non_medical', 'set', alex, medical['changeId']],
          ],
        );

        // Medical already: another Medical note leaves the visit as it is.
        final more = change(entityNote, 'create', noteValue(id, testMedical));
        expect(await send(alex, [more]), [taken(more, 1)]);
        expect(server.records[id]!.fields['kind']!.version, 2);

        // A Medical note held by the gate makes nothing Medical (review finding FAK-4).
        final other = change(entityEncounter, 'create', {'kind': 'non_medical', 'patientId': p});
        expect(await send(alex, [other]), [taken(other, 1)]);
        final otherId = other['recordId']! as String;
        server.credentials[dana] = 'chw';
        final held = change(entityNote, 'create', noteValue(otherId, testMedical));
        expect(await send(dana, [held]), [heldOnly(held)]);
        final otherKind = server.records[otherId]!.fields['kind']!;
        expect([otherKind.value, otherKind.version], ['non_medical', 1]);
        expect(
          [
            for (final h in server.history)
              if (h['recordId'] == otherId && h['field'] == 'kind') h['kind'],
          ],
          ['created'],
        );
      });

      test('is taken whatever state the visit’s other notes are in', () async {
        final id = visitOf(patientId: server.seedPatient());
        server.finishNote(noteOn(id, type: testMedical));
        final later = change(entityNote, 'create', noteValue(id, testNote, const {'care.followup': 'Demo: Friday'}));
        expect(await send(blair, [later]), [taken(later, 1)]);
      });
    });

    group('a finished note, and its reopen (lifecycle 4.4)', () {
      late String patient;
      setUp(() => patient = server.seedPatient());

      /// A visit of the patient with one draft note of [type], by Alex.
      String noteBy({TestNoteType type = testNote}) => noteOn(visitOf(patientId: patient), type: type);
      Map<String, Object?> setNote(
        String note,
        String field,
        Object? value, [
        int baseVersion = 1,
        Map<String, Object?> more = const {},
      ]) => setOn(entityNote, note, field, value, baseVersion, more: more);

      test('a late change to a finished note is kept in history: the sender is told, and the author when it is someone else', () async {
        final note = noteBy(type: testMedical);
        server.finishNote(note);
        final theirs = [
          setNote(note, 'data.care.plan', 'Demo: written after it was done'),
          setNote(note, 'data.vitals.pulse', 90, 0),
        ];
        final own = setNote(note, 'data.care.plan', 'Demo: the author, late');
        final answered = [
          ...await send(blair, theirs),
          ...await send(alex, [own]),
        ];
        expect(answered, [
          kept(theirs[0], 'Demo: rest and fluids', 1, 'note_finished'),
          kept(theirs[1], null, 0, 'note_finished'),
          kept(own, 'Demo: rest and fluids', 1, 'note_finished'),
        ]);
        expect(server.records[note]!.fields['data.care.plan']!.value, 'Demo: rest and fluids');
        expect(server.records[note]!.fields.containsKey('data.vitals.pulse'), isFalse);
        expect(
          [
            for (final h in server.history)
              if (h['recordId'] == note && h['field'] == 'data.care.plan' && h['kind'] != 'created')
                [h['version'], h['value'], h['previous'], h['kind']],
          ],
          [
            [1, theirs[0]['value'], 'Demo: rest and fluids', 'kept_both'],
            [1, own['value'], 'Demo: rest and fluids', 'kept_both'],
          ],
        );
        // Each person once a change: the sender, and the acting author when the sender is someone else.
        expect(
          told(note),
          [
            for (final id in [blair, alex, blair, alex, alex]) '$id late_change_kept',
          ]..sort(),
        );
        expect(server.notices.every((n) => n.entity == entityNote), isTrue);

        // Sent twice, it answers the same, and nothing more is kept or told.
        expect([
          ...await send(blair, theirs),
          ...await send(alex, [own]),
        ], answered);
        expect(told(note), hasLength(5));
      });

      test('a signed note keeps a late change as a completed one does: record_locked is gone', () async {
        final note = noteBy(type: testMedical);
        server.finishNote(note, status: 'signed');
        final late = setNote(note, 'data.care.plan', 'Demo: after signing');
        expect(await send(alex, [late]), [kept(late, 'Demo: rest and fluids', 1, 'note_finished')]);
        expect(told(note), ['$alex late_change_kept']);
      });

      test('the person who acts as the author is the one told: the assignee, once a note is assigned', () async {
        final note = noteBy(type: testMedical);
        server.finishNote(note);
        server.records[note]!.assignedTo = blair;
        final late = setNote(note, 'data.care.plan', 'Demo: from Casey');
        final assignees = setNote(note, 'data.care.plan', 'Demo: from Blair');
        expect(
          [
            for (final r in await send(casey, [late])) r['details'],
          ],
          [
            {'outcome': 'history_only', 'problem': 'note_finished'},
          ],
        );
        expect(
          [
            for (final r in await send(blair, [assignees])) r['details'],
          ],
          [
            {'outcome': 'history_only', 'problem': 'note_finished'},
          ],
        );
        expect(
          told(note),
          [
            for (final id in [casey, blair, blair]) '$id late_change_kept',
          ]..sort(),
        );
      });

      test('a late change is kept before its answer is checked, and says nothing of whether it would count', () async {
        final note = noteBy();
        server.finishNote(note);
        final changes = [
          setNote(note, 'data.vitals.pulse', 'fast', 0),
          setNote(note, 'data.vitals.bp', 120, 0),
          setNote(note, 'data.more.detail', 'Demo: one more thing', 0),
        ];
        expect(await send(alex, changes), [for (final c in changes) kept(c, null, 0, 'note_finished')]);
        // Phase 2's open pattern still answers first, before the note is loaded.
        expect(await send(alex, [setNote(note, 'data.Vitals', 1, 0)]), [refused('unknown_field')]);
      });

      test(
        'a late change goes through the draft rule’s first steps: the same value, and the answer to a conflict',
        () async {
          final note = noteBy();
          server.finishNote(note);
          final same = setNote(note, 'data.care.plan', 'Demo: rest and fluids', 0);
          final keep = setNote(note, 'data.care.plan', 'Demo: theirs', 1, {'resolution': 'keep_server'});
          final replace = setNote(note, 'data.care.plan', 'Demo: theirs', 1, {'resolution': 'replace'});
          expect(await send(blair, [same, keep, replace]), [
            taken(same, 1),
            taken(keep, 1),
            kept(replace, 'Demo: rest and fluids', 1, 'note_finished'),
          ]);
          expect(server.records[note]!.fields['data.care.plan']!.value, 'Demo: rest and fluids');
          // The keep_server answer tells the author as phase 2's draft rule does; the kept value, both.
          expect(told(note), ['$alex conflict_resolved', '$alex late_change_kept', '$blair late_change_kept']..sort());
        },
      );

      test('a stale answer to a conflict on a finished note is kept in history, never asked again', () async {
        final note = noteBy();
        server.finishNote(note);
        // Blair kept the value he was shown, which is not the one the note holds now (NOT-10).
        final keep = setNote(note, 'data.care.plan', 'Demo: theirs', 0, {'resolution': 'keep_server'});
        expect(await send(blair, [keep]), [kept(keep, 'Demo: rest and fluids', 1, 'note_finished')]);
        expect(server.records[note]!.fields['data.care.plan']!.value, 'Demo: rest and fluids');
        expect(historyOf(note, 'data.care.plan').where((h) => h.$1 != 'created'), [('kept_both', 'Demo: theirs', '1')]);
      });

      test('a late change at a new path is kept however many answers the note holds', () async {
        final note = server.seed(
          entityNote,
          noteValue(visitOf(patientId: patient), testNote, {
            for (var i = 0; i < maxNoteFields; i++) 'rows.e${'$i'.padLeft(7, '0')}.n': i,
          }),
          by: alex,
        );
        server.finishNote(note);
        final late = setNote(note, 'data.care.plan', 'Demo: one more', 0);
        expect(await send(alex, [late]), [kept(late, null, 0, 'note_finished')]);
      });

      group('the reopen: a set of status to draft', () {
        Map<String, Object?> reopen(String note, [int baseVersion = 1, Map<String, Object?> more = const {}]) =>
            setNote(note, 'status', 'draft', baseVersion, more);
        String visitOfNote(String note) => server.records[note]!.attributes['encounterId']! as String;

        test('applies for the author of a Medical note that waits for a co-signer and was never signed', () async {
          final note = noteBy(type: testMedical);
          server.finishNote(note);
          expect((await read(entityEncounter, visitOfNote(note))).status, 'completed');

          // The phone holds the status at its own version: a reopen never conflicts.
          final back = reopen(note, 0);
          expect(await send(alex, [back]), [taken(back, 2)]);
          final n = server.records[note]!;
          expect(
            [n.fields['status']!.value, n.fields['status']!.version, n.completedAt, n.completedBy],
            ['draft', 2, null, null],
          );
          expect((await read(entityEncounter, visitOfNote(note))).status, 'draft');
          expect(
            [
              for (final h in server.history)
                if (h['recordId'] == note && h['field'] == 'status' && h['kind'] != 'created')
                  [h['version'], h['value'], h['previous'], h['kind']],
            ],
            [
              [2, 'draft', 'completed', 'set'],
            ],
          );
          expect(told(note), isEmpty);

          // Now a draft: a reopen from anyone changes nothing, and the draft rule is back.
          final again = reopen(note, 0);
          final edit = setNote(note, 'data.care.plan', 'Demo: one more look');
          expect(await send(blair, [again]), [taken(again, 2)]);
          expect(await send(alex, [edit]), [taken(edit, 2)]);
          expect(historyOf(note, 'status'), hasLength(2));
          // Sent twice, it answers the same.
          expect(await send(alex, [back]), [taken(back, 2)]);
        });

        test(
          'keeps the rest in history: a note ever signed, a completed Non-Medical note, and someone else’s reopen',
          () async {
            final signedNote = noteBy(type: testMedical);
            server.finishNote(signedNote, status: 'signed');
            // A student's correction leaves a co-signed note completed: it was signed once.
            final onceSigned = noteBy(type: testMedical);
            server.finishNote(onceSigned, everSigned: true);
            final nonMedical = noteBy();
            server.finishNote(nonMedical);
            final waiting = noteBy(type: testMedical);
            server.finishNote(waiting);

            final own = [reopen(signedNote), reopen(onceSigned), reopen(nonMedical)];
            final theirs = [reopen(signedNote), reopen(nonMedical), reopen(waiting)];
            final answered = [...await send(alex, own), ...await send(blair, theirs)];
            expect(answered, [
              kept(own[0], 'signed', 1, 'note_finished'),
              kept(own[1], 'completed', 1, 'note_finished'),
              kept(own[2], 'completed', 1, 'note_finished'),
              kept(theirs[0], 'signed', 1, 'note_finished'),
              kept(theirs[1], 'completed', 1, 'note_finished'),
              kept(theirs[2], 'completed', 1, 'not_author'),
            ]);
            for (final id in [signedNote, onceSigned, nonMedical, waiting]) {
              expect(server.records[id]!.fields['status']!.value, isNot('draft'));
              expect(historyOf(id, 'status'), contains(('kept_both', 'draft', '1')));
            }
            List<String> late(List<String> ids) => [for (final id in ids) '$id late_change_kept']..sort();
            expect(told(signedNote), late([alex, blair, alex]));
            expect(told(onceSigned), late([alex]));
            expect(told(nonMedical), late([alex, blair, alex]));
            // "Only the note’s author can do that. Nothing was changed.": to the sender alone.
            expect(told(waiting), ['$blair change_not_applied']);
            expect([...await send(alex, own), ...await send(blair, theirs)], answered);
          },
        );

        test('the acting author reopens: the assignee once a note is assigned, and no longer its writer', () async {
          final note = noteBy(type: testMedical);
          server.finishNote(note);
          server.records[note]!.assignedTo = blair;
          final writers = reopen(note);
          final assignees = reopen(note);
          expect(await send(alex, [writers]), [kept(writers, 'completed', 1, 'not_author')]);
          expect(await send(blair, [assignees]), [taken(assignees, 2)]);
          expect(server.records[note]!.fields['status']!.value, 'draft');
        });

        test(
          'a status of completed is kept in history: Complete is a sign-off, and nothing else finishes a note',
          () async {
            final draft = noteBy(type: testMedical);
            final done = noteBy();
            server.finishNote(done);
            final changes = [setNote(draft, 'status', 'completed'), setNote(done, 'status', 'completed')];
            expect(await send(alex, changes), [
              kept(changes[0], 'draft', 1, 'use_signoff'),
              kept(changes[1], 'completed', 1, 'use_signoff'),
            ]);
            expect(server.records[draft]!.fields['status']!.value, 'draft');
            expect(told(draft), isEmpty);
            expect(told(done), isEmpty);
          },
        );

        test('a status set never conflicts, so there is nothing to resolve', () async {
          final note = noteBy(type: testMedical);
          server.finishNote(note);
          final answers = [
            reopen(note, 1, {'resolution': 'replace'}),
            reopen(note, 1, {'resolution': 'keep_server'}),
          ];
          expect(await send(alex, answers), [refused('nothing_to_resolve'), refused('nothing_to_resolve')]);
          expect(server.records[note]!.fields['status']!.value, 'completed');
        });
      });
    });

    // Rule 12: services/api/test/sync-encounters.test.ts, 'the Medical gate (lifecycle 4.2)'. Alex
    // is an attending, Blair a student, Casey a community health worker, Dana holds no credential.
    group('the Medical gate (lifecycle 4.2)', () {
      late String patient;
      setUp(() {
        patient = server.seedPatient();
        server.credentials
          ..[blair] = 'student'
          ..[casey] = 'chw'
          ..[dana] = 'none';
      });

      test('a Medical note’s create needs a credential that charts Medical: held for review, never refused', () async {
        final id = visitOf(patientId: patient);
        for (final who in [casey, dana]) {
          final create = change(entityNote, 'create', noteValue(id, testMedical, const {'vitals.pulse': 88}));
          expect(await send(who, [create]), [heldOnly(create)]);
          expect(server.records[create['recordId']], isNull);
          expect(server.held[create['changeId']]!.reason, 'permission');
        }
        for (final who in [alex, blair]) {
          final create = change(entityNote, 'create', noteValue(id, testMedical, const {'vitals.pulse': 88}));
          expect(await send(who, [create]), [taken(create, 1)]);
          expect(server.records[create['recordId']]!.medical, isTrue);
        }
      });

      test('a Non-Medical note is not gated and is not Medical', () async {
        final id = visitOf(patientId: patient);
        final typed = change(entityNote, 'create', noteValue(id, testNote, const {'care.plan': 'Demo: rest'}));
        expect(await send(dana, [typed]), [taken(typed, 1)]);
        expect(server.records[typed['recordId']]!.medical, isFalse);
        final edit = setOn(entityNote, typed['recordId']! as String, 'data.care.plan', 'Demo: fluids', 1);
        expect(await send(dana, [edit]), [taken(edit, 2)]);
      });

      test(
        'a set of an answer or of the status of a Medical note is held for someone who cannot chart Medical',
        () async {
          final note = server.seed(
            entityNote,
            noteValue(visitOf(patientId: patient), testMedical, const {'vitals.pulse': 88}),
            by: alex,
          );
          for (final who in [casey, dana]) {
            final changes = [
              setOn(entityNote, note, 'data.vitals.pulse', 90, 1),
              setOn(entityNote, note, 'status', 'draft', 1),
              // The gate comes first: an answer the type refuses is held too, and checked when accepted.
              setOn(entityNote, note, 'data.vitals.pulse', 'fast', 1),
            ];
            expect(await send(who, changes), [
              heldOnly(changes[0]),
              // A reopen from someone who does not act as the author changes nothing, whatever their
              // credential: not_author answers before the gate (4.1; RD-8). The author's is held.
              taken(changes[1], 1),
              heldOnly(changes[2]),
            ]);
          }
          expect(server.records[note]!.fields['data.vitals.pulse']!.value, 88);
          final own = setOn(entityNote, note, 'data.vitals.pulse', 92, 1);
          final students = setOn(entityNote, note, 'data.care.plan', 'Demo: fluids', 0);
          expect(await send(alex, [own]), [taken(own, 2)]);
          expect(await send(blair, [students]), [taken(students, 1)]);
        },
      );

      test(
        'a credential lowered while the phone was offline holds its change; an admin’s accept lets it through',
        () async {
          server.credentials[dana] = 'np';
          final create = change(
            entityNote,
            'create',
            noteValue(visitOf(patientId: patient, by: dana), testMedical, const {'vitals.temp_c': 38.2}),
          );
          expect(await send(dana, [create]), [taken(create, 1)]);
          final note = create['recordId']! as String;
          // Made offline, before the credential went down; sent after.
          final late = setOn(entityNote, note, 'data.vitals.temp_c', 38.6, 1);
          server.changeCredential(dana, 'chw');
          expect(await send(dana, [late]), [heldOnly(late)]);
          expect(server.records[note]!.fields['data.vitals.temp_c']!.value, 38.2);

          expect(
            server.acceptHeld(late['changeId']! as String, by: admin),
            taken(late, 2)
              ..remove('changeId')
              ..remove('hash'),
          );
          expect(server.records[note]!.fields['data.vitals.temp_c']!.value, 38.6);
          final written = server.history.lastWhere((h) => h['recordId'] == note && h['field'] == 'data.vitals.temp_c');
          expect([written['version'], written['by'], written['approvedBy']], [2, dana, admin]);
        },
      );

      // services/api/test/sync-reads.test.ts, 'the Medical gate (lifecycle 4.2; 4.9 rule 12)'.
      test('holds every kind of change to a Medical note from a credential lowered offline; an addendum changes no note and is taken', () async {
        server.noteTypes[(testRedFlags.key, testRedFlags.version)] = redFlagsNoteType;
        server.credentials[dana] = 'attending';
        final visit = visitOf(patientId: patient, by: dana);
        String noteBy(TestNoteType type, Map<String, Object?> data) =>
            server.seed(entityNote, noteValue(visit, type, data), by: dana);
        server.finishNote(noteBy(testRedFlags, const {'flags.any': 'no'}), status: 'signed');
        final draft = noteBy(testMedical, const {'care.plan': 'Demo: fluids'});
        final completed = noteBy(testMedical, const {'care.plan': 'Demo: rest'});
        server.finishNote(completed);
        final signed = noteBy(testMedical, const {'care.plan': 'Demo: sleep'});
        server.finishNote(signed, status: 'signed');

        // Made offline, before the credential went down; sent after.
        final created = change(entityNote, 'create', noteValue(visit, testMedical));
        final answer = setOn(entityNote, draft, 'data.care.plan', 'Demo: fluids and rest', 1);
        final reopen = setOn(entityNote, completed, 'status', 'draft', 1);
        final signoff = change(entitySignoff, 'create', {
          'noteId': draft,
          'act': 'sign',
          'contentHash': noteContentHash(
            noteId: draft,
            encounterId: visit,
            patientId: patient,
            summary: null,
            definition: NoteTypeDef.fromJson(server.noteTypes[(testMedical.key, 1)]!),
            answers: const {'care.plan': 'Demo: fluids'},
          ),
          'claimedCredential': 'attending',
          'statementVersion': 'sign-2026-11',
        });
        final correction = change(entityCorrection, 'create', {
          'noteId': signed,
          'changes': [
            {'field': 'data.care.plan', 'newValue': 'Demo: sleep and food', 'baseVersion': 1},
          ],
          'reason': 'Demo: left out',
          'requestedByPatient': false,
          'declined': false,
          'claimedCredential': 'attending',
          'signoffId': null,
        });
        final addendum = change(entityAddendum, 'create', {
          'encounterId': visit,
          'noteId': signed,
          'text': 'Demo: called back',
          'signoffId': null,
        });
        server.changeCredential(dana, 'chw');
        final gated = [created, answer, reopen, signoff, correction];
        expect(await send(dana, [...gated, addendum]), [for (final c in gated) heldOnly(c), taken(addendum, 1)]);

        // Nothing of the held changes reached the chart.
        expect(server.records[draft]!.fields['data.care.plan']!.value, 'Demo: fluids');
        expect(server.records[completed]!.fields['status']!.value, 'completed');
        expect(server.records[signed]!.fields['data.care.plan']!.value, 'Demo: sleep');
        for (final c in [created, signoff, correction]) {
          expect(server.records[c['recordId']], isNull);
        }
        expect([for (final c in gated) server.held[c['changeId']]!.reason], List.filled(gated.length, 'permission'));
      });

      test('a sign-off, a reopen or a correction from someone who does not act as the author is stored with no effect, whatever their credential', () async {
        // 4.1's second table: not_author answers before the gate, for all three alike (RD-8).
        server.noteTypes[(testRedFlags.key, testRedFlags.version)] = redFlagsNoteType;
        server.credentials[dana] = 'attending';
        server.credentials[blair] = 'attending';
        final visit = visitOf(patientId: patient, by: dana);
        String noteBy(TestNoteType type, Map<String, Object?> data) =>
            server.seed(entityNote, noteValue(visit, type, data), by: dana);
        server.finishNote(noteBy(testRedFlags, const {'flags.any': 'no'}), status: 'signed');
        final draft = noteBy(testMedical, const {'care.plan': 'Demo: fluids'});
        final completed = noteBy(testMedical, const {'care.plan': 'Demo: rest'});
        server.finishNote(completed);
        final signed = noteBy(testMedical, const {'care.plan': 'Demo: sleep'});
        server.finishNote(signed, status: 'signed');

        final signoff = change(entitySignoff, 'create', {
          'noteId': draft,
          'act': 'sign',
          'contentHash': noteContentHash(
            noteId: draft,
            encounterId: visit,
            patientId: patient,
            summary: null,
            definition: NoteTypeDef.fromJson(server.noteTypes[(testMedical.key, 1)]!),
            answers: const {'care.plan': 'Demo: fluids'},
          ),
          'claimedCredential': 'attending',
          'statementVersion': 'sign-2026-11',
        });
        final reopen = setOn(entityNote, completed, 'status', 'draft', 2);
        final correction = change(entityCorrection, 'create', {
          'noteId': signed,
          'changes': [
            {'field': 'data.care.plan', 'newValue': 'Demo: sleep and food', 'baseVersion': 1},
          ],
          'reason': 'Demo: left out',
          'requestedByPatient': false,
          'declined': false,
          'claimedCredential': 'attending',
          'signoffId': null,
        });
        server.changeCredential(blair, 'chw');
        final answers = await send(blair, [signoff, reopen, correction]);
        expect(
          [
            for (final r in answers) [r['status'], r['reason'], r['details']],
          ],
          [
            [
              'accepted',
              null,
              {'effect': 'none', 'reason': 'not_author', 'status': 'draft', 'attestation': 'not_needed'},
            ],
            [
              'accepted',
              null,
              {'outcome': 'history_only', 'problem': 'not_author'},
            ],
            [
              'accepted',
              null,
              {'outcome': 'not_author', 'status': 'signed', 'attestation': 'not_needed'},
            ],
          ],
        );
        expect(server.held, isEmpty);
        expect(server.records[completed]!.fields['status']!.value, 'completed');
        expect(server.records[signed]!.fields['data.care.plan']!.value, 'Demo: sleep');
      });
    });

    // Rule 14: services/api/test/sync-encounters.test.ts, 'a note’s answers (lifecycle 4.4)'. Alex and
    // Blair chart on the Non-Medical test type.
    group('a note’s answers (lifecycle 4.4)', () {
      late String visit;
      setUp(() => visit = visitOf(patientId: server.seedPatient()));
      String noteWith(Map<String, Object?> data) => server.seed(entityNote, noteValue(visit, testNote, data), by: alex);
      Map<String, Object?> setNote(String note, String field, Object? value, [int baseVersion = 0]) =>
          setOn(entityNote, note, field, value, baseVersion);
      String entry(int n) => 'rows.e${'$n'.padLeft(7, '0')}';
      const at = '2026-10-20T14:40:00.000Z';

      test('each answer is checked against the note’s type once the note is loaded', () async {
        final note = noteWith(const {'vitals.pulse': 88});
        final wrong = [
          ('data.vitals.pulse', 'fast', 'wrong_type'),
          ('data.vitals.pulse', 301, 'out_of_range'),
          // One decimal: 38.25 is not one of its values.
          ('data.vitals.temp_c', 38.25, 'out_of_range'),
          ('data.care.followup', 'Demo: ${'x' * 200}', 'too_long'),
          ('data.vitals.bp', 120, 'unknown_path'),
          ('data.rows.notanentry.text', 'Demo: a row', 'unknown_path'),
          ('data.rows.e0000001.n', 'two', 'wrong_type'),
          // A tick stores true; unticking writes null.
          ('data.more.none', false, 'wrong_type'),
        ];
        final sets = [for (final (field, value, _) in wrong) setNote(note, field, value)];
        final right = [
          setNote(note, 'data.vitals.pulse', 96, 1),
          setNote(note, 'data.vitals.temp_c', 38.2),
          // Null clears an answer, wherever one is stored.
          setNote(note, 'data.care.followup', null),
        ];
        expect(await send(alex, [...sets, ...right]), [
          for (final (_, _, problem) in wrong) refused(problem),
          taken(right[0], 2),
          taken(right[1], 1),
          taken(right[2], 0),
        ]);
        expect(
          [
            server.records[note]!.fields['data.vitals.pulse']!.value,
            server.records[note]!.fields['data.vitals.temp_c']!.value,
          ],
          [96, 38.2],
        );
        // Phase 2's open pattern still answers first, before the note is loaded.
        expect(await send(alex, [setNote(note, 'data.Vitals', 1)]), [refused('unknown_field')]);
      });

      test('a create’s answers are checked too, each refusal naming the answer’s path', () async {
        final cases = [
          (const {'vitals.pulse': 'fast'}, const {'problem': 'wrong_type', 'path': 'vitals.pulse'}),
          (const {'care.plan': 'Demo: rest', 'vitals.bp': 120}, const {'problem': 'unknown_path', 'path': 'vitals.bp'}),
          (const {'wound.length_cm': 100}, const {'problem': 'out_of_range', 'path': 'wound.length_cm'}),
        ];
        final creates = [for (final (data, _) in cases) change(entityNote, 'create', noteValue(visit, testNote, data))];
        final fine = change(
          entityNote,
          'create',
          noteValue(visit, testNote, const {'vitals.pulse': 88, 'care.plan': null}),
        );
        expect(await send(alex, [...creates, fine]), [
          for (final (_, details) in cases) refusedWith(details),
          taken(fine, 1),
        ]);
        for (final c in creates) {
          expect(server.records[c['recordId']], isNull);
        }
      });

      test('a note holds up to 1,000 answers', () async {
        expect(maxNoteFields, 1000);
        final data = {
          for (var i = 0; i < maxNoteFields / 2; i++) ...{'${entry(i)}.entryAt': at, '${entry(i)}.n': i},
        };
        final full = change(entityNote, 'create', noteValue(visit, testNote, data));
        final over = change(entityNote, 'create', noteValue(visit, testNote, {...data, 'care.plan': 'Demo: one more'}));
        final [made, refusedOver] = await send(alex, [full, over]);
        expect(made, taken(full, 1));
        expect(refusedOver, allOf(containsPair('status', 'rejected'), containsPair('reason', 'validation')));
        final again = setNote(full['recordId']! as String, 'data.${entry(0)}.n', 7, 1);
        final more = setNote(full['recordId']! as String, 'data.care.plan', 'Demo: one more');
        expect(await send(alex, [again, more]), [taken(again, 2), refused('too_many_fields')]);
      });

      test('an answer that will not count is taken, and its receipt says why', () async {
        // Blair removed the first row and ticked "Nothing more"; Alex, offline, wrote into both.
        final note = noteWith({
          '${entry(1)}.entryAt': at,
          '${entry(1)}.entryRemoved': true,
          '${entry(2)}.entryAt': at,
          'more.none': true,
        });
        Map<String, Object?> counted(Map<String, Object?> c, int version, [String? why]) => {
          ...taken(c, version),
          if (why != null) 'details': {'notCounted': why},
        };
        final sets = [
          setNote(note, 'data.${entry(1)}.text', 'Demo: the first row'),
          setNote(note, 'data.${entry(1)}.entryAt', at, 1),
          setNote(note, 'data.more.detail', 'Demo: more to say'),
          // In an entry that is there, and in a field that shows: nothing to say.
          setNote(note, 'data.${entry(2)}.text', 'Demo: the second row'),
          setNote(note, 'data.care.plan', 'Demo: rest'),
          // A clear holds no answer to count. The removal itself is what it says.
          setNote(note, 'data.more.detail', null, 1),
          setNote(note, 'data.${entry(2)}.entryRemoved', true),
          setNote(note, 'data.${entry(2)}.text', 'Demo: the second row, again', 1),
        ];
        final answered = await send(alex, sets);
        expect(answered, [
          counted(sets[0], 1, 'removed_entry'),
          counted(sets[1], 1, 'removed_entry'),
          counted(sets[2], 1, 'hidden_field'),
          counted(sets[3], 1),
          counted(sets[4], 1),
          counted(sets[5], 2),
          counted(sets[6], 1),
          counted(sets[7], 2, 'removed_entry'),
        ]);
        // Kept on the chart as sent: shown again if the field shows again.
        expect(server.records[note]!.fields['data.${entry(1)}.text']!.value, 'Demo: the first row');
        // Sent twice, it answers the same, from its receipt.
        expect(await send(alex, sets), answered);

        // Only a value on the chart is told so: a conflict, or the answer to one that keeps the
        // server's value, says nothing of it.
        final blairs = setNote(note, 'data.more.detail', 'Demo: from Blair', 2);
        expect(await send(blair, [blairs]), [counted(blairs, 3, 'hidden_field')]);
        final unseen = setNote(note, 'data.more.detail', 'Demo: from Alex', 2);
        final [conflict] = await send(alex, [unseen]);
        expect([conflict['status'], conflict.containsKey('details')], ['conflict', isFalse]);
        final keep = setOn(
          entityNote,
          note,
          'data.more.detail',
          'Demo: from Alex',
          3,
          more: {'conflictOf': unseen['changeId'], 'resolution': 'keep_server'},
        );
        expect(await send(alex, [keep]), [taken(keep, 3)]);
        // The same value again is still a value that does not count.
        final same = setNote(note, 'data.more.detail', 'Demo: from Blair', 3);
        expect(await send(blair, [same]), [counted(same, 3, 'hidden_field')]);
      });

      test(
        'a rule that throws on a definition is refused definition_error, writes nothing, and the queue goes on',
        () async {
          final testNoteType = testNoteTypes.first;
          // A row whose hash is not its definition's (D79).
          server.noteTypes[('test_forged', 1)] = {...testNoteType, 'key': 'test_forged'};
          server.forged.add(('test_forged', 1));
          // Two fields that each show only while the other is filled: the interpreter throws on it.
          server.noteTypes[('test_looped', 1)] = {
            ...testNoteType,
            'key': 'test_looped',
            'sections': [
              {
                'id': 'loop',
                'title': 'Loop',
                'fields': [
                  for (final (id, other) in [('a', 'b'), ('b', 'a')])
                    {
                      'id': id,
                      'kind': 'text',
                      'label': id.toUpperCase(),
                      'lines': 'one',
                      'maxLength': 200,
                      'showWhen': {'field': 'loop.$other', 'filled': true},
                    },
                ],
              },
            ],
          };
          final looped = change(entityNote, 'create', noteValue(visit, (key: 'test_looped', version: 1)));
          expect(await send(alex, [looped]), [taken(looped, 1)]);
          // A note naming a version the team does not hold, from before any check: none can be made now.
          final stray = noteWith(const {});
          server.records[stray]!.attributes['noteTypeVersion'] = 9;

          final throwing = [
            change(entityNote, 'create', noteValue(visit, (key: 'test_forged', version: 1))),
            setNote(looped['recordId']! as String, 'data.loop.a', 'Demo: round and round'),
            setNote(stray, 'data.care.plan', 'Demo: rest'),
          ];
          final after = change(entityNote, 'create', noteValue(visit, testNote));
          expect(await send(alex, [...throwing, after]), [
            for (final _ in throwing) refused('definition_error'),
            taken(after, 1),
          ]);
          expect(server.records[throwing[0]['recordId']], isNull);
          expect(server.records[looped['recordId']]!.fields.keys, ['status']);
          expect(historyOf(looped['recordId']! as String, 'data.loop.a'), isEmpty);
        },
      );
    });

    // Rule 16, a set: services/api/test/sync-reads.test.ts, 'a set of an answer the sender may not see
    // (4.4, 6.4 rule 5)'. Alex (Ana there) is an attending and the author; Dana (Ben) holds no
    // credential; Blair (Sky) is a student; Casey (Dee) has a custom role with patients.view and
    // encounters.chart only, and no credential.
    group('a set of an answer the sender may not see (4.4, 6.4 rule 5)', () {
      const e1 = 'e0000001';
      const e2 = 'e0000002';
      const at = '2026-10-20T14:50:00Z';
      const answers = <String, Object?>{
        'general.notes': 'Demo: walked over from the shelter',
        'exam.findings': 'Demo: no lesions seen',
        'moud.dose': 'Demo: 8 mg',
        'meds.given': 'Demo: none today',
        'systems.seen': ['heart', 'gu'],
        // A diagnosis whose code is on the sensitive list, and one whose code is not.
        'dx.$e1.entryAt': at,
        'dx.$e1.diagnosis.code': 'F11.20',
        'dx.$e1.diagnosis.label': 'Demo: opioid use',
        'dx.$e1.note': 'Demo: talk again next week',
        'dx.$e2.entryAt': at,
        'dx.$e2.diagnosis.code': 'J02.9',
        'dx.$e2.diagnosis.label': 'Demo: sore throat',
      };
      late String patient;
      setUp(() {
        for (final d in restrictedNoteTypes) {
          server.noteTypes[(d['key']! as String, d['version']! as int)] = d;
        }
        patient = server.seedPatient();
        server.credentials
          ..[dana] = 'none'
          ..[blair] = 'student'
          ..[casey] = 'none';
        server.permissions[casey] = {'patients.view', 'encounters.chart'};
      });
      String restrictedNote(Map<String, Object?> data, {TestNoteType type = testRestricted}) =>
          server.seed(entityNote, noteValue(visitOf(patientId: patient), type, data), by: alex);
      Map<String, Object?> set(String note, String path, Object? value, [int baseVersion = 1]) =>
          setOn(entityNote, note, 'data.$path', value, baseVersion);

      test('is held for review by what the answer could hold, never by what it holds: one set, one answer, on any note; the author always sets their own', () async {
        final n = restrictedNote(answers);
        // Nothing here the sender may not see: no exam, no treatment, no sensitive option picked, and
        // no sensitive diagnosis. Each set is answered here as on the note that holds them, so
        // whether it is held tells the sender nothing of what a note holds (review finding RD-10).
        const bareAnswers = <String, Object?>{
          'general.notes': 'Demo: walked over from the shelter',
          'systems.seen': ['heart'],
          'dx.$e2.entryAt': at,
          'dx.$e2.diagnosis.code': 'J02.9',
        };
        final bare = restrictedNote(bareAnswers);
        final notes = {
          n: {for (final path in answers.keys) path: 1},
          bare: {for (final path in bareAnswers.keys) path: 1},
        };
        final cases = <(String, String, Object?, String, int?)>[
          (dana, 'exam.findings', 'Demo: a small rash', 'held', null),
          // Not seen, and so a conflict with the answer held there, but held before that is asked.
          (dana, 'exam.findings', 'Demo: something else', 'held', 0),
          (dana, 'moud.dose', 'Demo: 12 mg', 'held', null),
          // An ordering credential's section.
          (dana, 'meds.given', 'Demo: one tablet', 'held', null),
          // A picker with a sensitive exam's option, whatever it holds and whatever is sent.
          (dana, 'systems.seen', ['lungs', 'gu'], 'held', null),
          (dana, 'systems.seen', ['heart'], 'held', null),
          (dana, 'systems.seen', ['heart', 'lungs'], 'held', null),
          (dana, 'general.notes', 'Demo: walked over from the park', 'accepted', null),
          // With patients.view_sensitive, any diagnosis's entry.
          (dana, 'dx.$e2.note', 'Demo: rest and fluids', 'accepted', null),
          // A student reads the treatment record, and orders nothing.
          (blair, 'moud.dose', 'Demo: 12 mg', 'accepted', null),
          (blair, 'meds.given', 'Demo: one tablet', 'held', null),
          // Without patients.view_sensitive, every answer of a section of diagnoses, sensitive or not.
          (casey, 'dx.$e1.note', 'Demo: something else', 'held', null),
          (casey, 'dx.$e2.note', 'Demo: rest and fluids', 'held', null),
          (casey, 'dx.$e2.entryRemoved', true, 'held', null),
          (casey, 'general.notes', 'Demo: back at the shelter', 'accepted', null),
        ];
        final heldOnN = <Map<String, Object?>>[];
        for (final (user, path, value, expected, base) in cases) {
          for (final MapEntry(key: note, value: versions) in notes.entries) {
            final c = set(note, path, value, base ?? versions[path] ?? 0);
            final answer = (await send(user, [c])).single;
            final label = '$user $path $value on ${note == n ? 'the full note' : 'the bare one'}';
            if (expected == 'held') {
              expect(answer, heldOnly(c), reason: label);
              if (note == n) heldOnN.add(c);
            } else {
              expect(answer, taken(c, answer['serverVersion']! as int), reason: label);
              versions[path] = answer['serverVersion']! as int;
            }
          }
        }
        // ...and any answer of a note they may not read at all.
        final talk = restrictedNote(const {'talk.notes': 'Demo: talked about sleep'}, type: testSensitive);
        final onTalk = set(talk, 'talk.notes', 'Demo: something else');
        expect(await send(casey, [onTalk]), [heldOnly(onTalk)]);
        // Whoever acts as the author sets every answer of their own note.
        final own = set(n, 'exam.findings', 'Demo: a small rash');
        expect(await send(alex, [own]), [taken(own, 2)]);
        final held = server.records[n]!.fields;
        expect(
          [
            for (final path in ['exam.findings', 'moud.dose', 'meds.given', 'systems.seen', 'dx.$e1.note'])
              held['data.$path']!.value,
          ],
          [
            'Demo: a small rash',
            'Demo: 12 mg',
            'Demo: none today',
            ['heart', 'gu'],
            'Demo: talk again next week',
          ],
        );
        expect(server.records[bare]!.fields['data.systems.seen']!.value, ['heart']);

        // An admin's accept is the approval: the held change applies as it was sent. Why it was
        // held is the reviewer's to read, never its sender's.
        final meds = heldOnN.firstWhere((c) => c['field'] == 'data.meds.given');
        expect(server.held[meds['changeId']]!.reason, 'permission');
        expect(server.acceptHeld(meds['changeId']! as String)['status'], 'accepted');
        expect(server.records[n]!.fields['data.meds.given']!.value, 'Demo: one tablet');
      });

      test('every place a sensitive exam’s mark can sit is held without the key, whatever the note holds: an option, its Other text, a region, a grid’s rows, an entry around one', () async {
        const w = 'e0000003';
        // What the mark hides is there on one note, and only what it does not hide on the other.
        const fullAnswers = <String, Object?>{
          'look.systems': ['other'],
          'look.systems_other': 'Demo: a scrape',
          'look.skin.region': 'groin',
          'look.rows.rectal': 'Demo: clear',
          'wounds.$w.entryAt': at,
          'wounds.$w.where': 'groin',
          'look.notes': 'Demo: walked over',
        };
        const bareAnswers = <String, Object?>{
          'look.systems': ['heart'],
          'look.skin.region': 'arm',
          'look.rows.head': 'Demo: clear',
          'wounds.$w.entryAt': at,
          'wounds.$w.where': 'arm',
          'wounds.$w.size': 'Demo: 2 cm',
          'look.notes': 'Demo: walked over',
        };
        final full = restrictedNote(fullAnswers, type: testMarked);
        final bare = restrictedNote(bareAnswers, type: testMarked);
        final notes = {
          full: {for (final path in fullAnswers.keys) path: 1},
          bare: {for (final path in bareAnswers.keys) path: 1},
        };
        final cases = <(String, Object?, String)>[
          ('look.systems', ['heart'], 'held'),
          ('look.systems_other', 'Demo: a cut', 'held'),
          ('look.skin.region', 'arm', 'held'),
          ('look.rows.head', 'Demo: a bump', 'held'),
          ('look.rows.rectal', 'Demo: a bump', 'held'),
          ('wounds.$w.where', 'arm', 'held'),
          ('wounds.$w.entryAt', at, 'held'),
          ('wounds.$w.size', 'Demo: 3 cm', 'accepted'),
          ('look.notes', 'Demo: walked back', 'accepted'),
        ];
        Future<void> sendAs(String user, String path, Object? value, String expected) async {
          for (final MapEntry(key: note, value: versions) in notes.entries) {
            final c = set(note, path, value, versions[path] ?? 0);
            final answer = (await send(user, [c])).single;
            final label = '$user $path on ${note == full ? 'the full note' : 'the bare one'}';
            if (expected == 'held') {
              expect(answer, heldOnly(c), reason: label);
            } else {
              expect(answer, taken(c, answer['serverVersion']! as int), reason: label);
              versions[path] = answer['serverVersion']! as int;
            }
          }
        }

        // Dana holds patients.view_sensitive and not patients.view_sensitive_exams.
        for (final (path, value, expected) in cases) {
          await sendAs(dana, path, value, expected);
        }
        // With the key, each is the draft rule's.
        server.permissions[dana] = {...FakeSyncServer.healthcareStaff, 'patients.view_sensitive_exams'};
        await sendAs(dana, 'look.skin.region', 'arm', 'accepted');
        await sendAs(dana, 'wounds.$w.entryAt', '2026-10-20T14:55:00Z', 'accepted');
        server.permissions.remove(dana);
        expect(
          [
            for (final path in ['look.systems', 'look.skin.region', 'look.rows.rectal', 'wounds.$w.where'])
              server.records[full]!.fields['data.$path']!.value,
          ],
          [
            ['other'],
            'arm',
            'Demo: clear',
            'groin',
          ],
        );
        // Whoever acts as the author is never held by it: the set check asks that first, and so does
        // the rule itself.
        final type = NoteTypeDef.fromJson(restrictedNoteTypes.firstWhere((d) => d['key'] == testMarked.key));
        final asAuthor = FakeSyncServer.noteReader({'patients.view', 'encounters.chart'}, 'none', actsAsAuthor: true);
        expect(FakeSyncServer.mayHoldHidden(type, 'look.systems', asAuthor), isFalse);
        final asOther = FakeSyncServer.noteReader({'patients.view', 'encounters.chart'}, 'none', actsAsAuthor: false);
        expect(FakeSyncServer.mayHoldHidden(type, 'look.systems', asOther), isTrue);
      });

      test('an answer that does not count is hidden by where it is: beside a sensitive diagnosis, or a pick of a sensitive exam', () async {
        const assess = <String, Object?>{
          'assess.diagnosis.code': 'F11.20',
          'assess.diagnosis.label': 'Demo: opioid use',
          'assess.none': true,
          // Does not count while assess.none is ticked, in the section the diagnosis takes with it.
          'assess.detail': 'Demo: takes it daily under the bridge',
        };
        final n = restrictedNote(assess, type: testAssess);
        // Not seen, and so a conflict, a fill or a write into a section Casey may not see: held.
        final caseys = [
          set(n, 'assess.detail', 'Demo: something else', 0),
          set(n, 'assess.detail', 'Demo: written blind'),
        ];
        expect(await send(casey, caseys), [for (final c in caseys) heldOnly(c)]);
        expect(server.records[n]!.fields['data.assess.detail']!.value, assess['assess.detail']);
        // Dana may see the section: an answer that does not count there is the draft rule's, as before.
        final danas = [set(n, 'assess.detail', 'Demo: from Dana', 0)];
        expect((await send(dana, danas)).single['status'], 'conflict');

        // A pick of a sensitive exam's option that does not count, beside a diagnosis that is not sensitive.
        final picked = restrictedNote(const {
          'assess.diagnosis.code': 'J02.9',
          'assess.none': true,
          'assess.seen': ['heart', 'gu'],
        }, type: testAssess);
        final onPicked = [
          set(picked, 'assess.seen', ['heart'], 0),
          set(picked, 'assess.seen', ['gu'], 0),
          set(picked, 'assess.detail', 'Demo: from Dana', 0),
        ];
        final answered = await send(dana, onPicked);
        expect(answered.sublist(0, 2), [for (final c in onPicked.sublist(0, 2)) heldOnly(c)]);
        expect(answered[2]['details'], {'notCounted': 'hidden_field'});

        // A correction of the answer that does not count is missing for Casey, and her late change is held.
        // It stays hidden, so it is stored as no change (lifecycle 4.7 step 7), and kept all the same.
        server.finishNote(n);
        final correction = change(entityCorrection, 'create', {
          'noteId': n,
          'changes': [
            {'field': 'data.assess.detail', 'newValue': 'Demo: uses daily under the bridge', 'baseVersion': 1},
          ],
          'reason': 'Demo: left out',
          'requestedByPatient': false,
          'declined': false,
          'claimedCredential': null,
          'signoffId': null,
        });
        expect((await send(alex, [correction])).single['details'], containsPair('outcome', 'no_change'));
        Future<List<String>> reads(String user) async => [
          for (final r in (await as(user).fetchRecords(
            body: FetchRecords(
              records: [RecordRef(entity: RecordEntity.noteCorrection, id: correction['recordId']! as String)],
            ),
          )).records)
            r.id,
        ];
        expect(await reads(casey), isEmpty);
        expect(await reads(dana), [correction['recordId']]);
        final late = [set(n, 'assess.detail', 'Demo: later', 0)];
        expect(await send(casey, late), [heldOnly(late.single)]);
      });

      // encounters-timeline.test.ts, 'a visit’s status, as the reader is shown it' (review finding
      // LRD-2): the stored status counts every note, so it told of a note the reader may not read.
      test('a visit’s status in the sync read is worked out from the notes the reader may read', () async {
        final visit = visitOf(patientId: patient, kind: 'non_medical');
        final talk = server.seed(
          entityNote,
          noteValue(visit, testSensitive, const {'talk.notes': 'Demo: talked about sleep'}),
          by: alex,
        );
        server.finishNote(talk);
        Future<List<String>> statusFor(String user) async => [
          for (final r in (await as(user).fetchRecords(
            body: FetchRecords(
              records: [RecordRef(entity: RecordEntity.encounter, id: visit)],
            ),
          )).records)
            r.status,
        ];
        expect(server.records[visit]!.status, 'completed');
        expect(await statusFor(casey), ['draft']);
        expect(await statusFor(alex), ['completed']);
      });

      // encounters-read.test.ts, 'a correction made while its entry held a sensitive diagnosis'
      // (review finding LRD-1): asked of the note as it is now, it was shown once a later correction
      // moved the code off the sensitive list.
      test('a correction made while its entry held a sensitive diagnosis stays missing once the code is corrected away, in any order', () async {
        Map<String, Object?> fix(String note, List<(String, Object?, int)> changes, [String? recordId]) =>
            change(entityCorrection, 'create', {
              'noteId': note,
              'changes': [
                for (final (path, value, base) in changes)
                  {'field': 'data.$path', 'newValue': value, 'baseVersion': base},
              ],
              'reason': 'Demo: fixing the entry',
              'requestedByPatient': false,
              'declined': false,
              'claimedCredential': null,
              'signoffId': null,
            }, recordId: recordId);
        Future<List<String>> reads(String user, List<String> ids) async => [
          for (final r in (await as(user).fetchRecords(
            body: FetchRecords(
              records: [for (final id in ids) RecordRef(entity: RecordEntity.noteCorrection, id: id)],
            ),
          )).records)
            r.id,
        ];
        // Two pushes, then one push holding both.
        for (final together in [false, true]) {
          final n = restrictedNote({
            'general.notes': 'Demo: walked over',
            'dx.$e1.entryAt': at,
            'dx.$e1.diagnosis.code': 'F11.20',
            'dx.$e1.diagnosis.label': 'Demo: opioid use',
            'dx.$e1.note': 'Demo: started buprenorphine',
          });
          server.finishNote(n);
          final first = fix(n, [('dx.$e1.note', 'Demo: buprenorphine 8 mg', 1)]);
          final second = fix(n, [
            ('dx.$e1.diagnosis.code', 'J02.9', 1),
            ('dx.$e1.diagnosis.label', 'Demo: sore throat', 1),
            ('dx.$e1.note', 'Demo: throat swab', 2),
          ]);
          final sent = together
              ? await send(alex, [first, second])
              : [
                  ...await send(alex, [first]),
                  ...await send(alex, [second]),
                ];
          expect([for (final a in sent) (a['details']! as Map)['outcome']], ['corrected', 'corrected']);
          final ids = [first['recordId']! as String, second['recordId']! as String];
          expect(await reads(casey, ids), isEmpty);
          expect(await reads(alex, ids), ids);
        }
      });

      test('a removal of an entry hidden from the sender, and a write into a removed one that holds a sensitive diagnosis, are held', () async {
        final n = restrictedNote(const {
          'general.notes': 'Demo: walked over from the shelter',
          'dx.$e1.entryAt': at,
          'dx.$e1.diagnosis.code': 'F11.20',
          'dx.$e2.entryAt': at,
          'dx.$e2.diagnosis.code': 'J02.9',
        });
        // Casey's phone still holds E1's ID from before its code became sensitive.
        final caseys = [
          set(n, 'dx.$e1.entryRemoved', true, 0),
          set(n, 'dx.$e1.note', 'Demo: something else', 0),
          // An entry she may see is held too: any entry of the section could hold one (RD-10).
          set(n, 'dx.$e2.entryRemoved', true, 0),
        ];
        expect(await send(casey, caseys), [for (final c in caseys) heldOnly(c)]);
        // Removed by its author, the entry still holds the diagnosis: nothing is written into it blind.
        final removal = set(n, 'dx.$e1.entryRemoved', true, 0);
        expect(await send(alex, [removal]), [taken(removal, 1)]);
        final into = set(n, 'dx.$e1.note', 'Demo: written blind', 0);
        expect(await send(casey, [into]), [heldOnly(into)]);
        // Dana, who may see the diagnosis, writes into the removed entry as the draft rule says.
        final danas = [set(n, 'dx.$e1.note', 'Demo: from Dana', 0)];
        expect((await send(dana, danas)).single['details'], {'notCounted': 'removed_entry'});
        final held = server.records[n]!.fields;
        expect(
          [
            for (final path in ['diagnosis.code', 'entryRemoved', 'note']) held['data.dx.$e1.$path']!.value,
          ],
          ['F11.20', true, 'Demo: from Dana'],
        );
      });

      test('a section that needs an ordering credential holds the author’s create, set and correction too, until an admin accepts', () async {
        // Blair is a student: she charts, and orders nothing. A resident lowered offline is the same.
        final visit = visitOf(patientId: patient, by: blair);
        final create = change(
          entityNote,
          'create',
          noteValue(visit, testRestricted, const {
            'general.notes': 'Demo: walked over',
            'meds.given': 'Demo: two tablets',
          }),
        );
        final own = server.seed(
          entityNote,
          noteValue(visit, testRestricted, const {'general.notes': 'Demo: walked over'}),
          by: blair,
        );
        final sets = [set(own, 'meds.given', 'Demo: one tablet', 0), set(own, 'general.notes', 'Demo: later')];
        final answered = await send(blair, [create, ...sets]);
        expect(answered.sublist(0, 2), [heldOnly(create), heldOnly(sets[0])]);
        expect(answered[2], taken(sets[1], 2));
        expect(server.records.containsKey(create['recordId']), isFalse);
        expect(server.records[own]!.fields.containsKey('data.meds.given'), isFalse);
        // A correction of a finished note's Medication section, by its author.
        final finished = restrictedNote(const {'meds.given': 'Demo: none today'});
        server.finishNote(finished);
        server.credentials[alex] = 'student';
        final correction = change(entityCorrection, 'create', {
          'noteId': finished,
          'changes': [
            {'field': 'data.meds.given', 'newValue': 'Demo: one tablet', 'baseVersion': 1},
          ],
          'reason': 'Demo: the wrong amount',
          'requestedByPatient': false,
          'declined': false,
          'claimedCredential': 'student',
          'signoffId': null,
        });
        expect(await send(alex, [correction]), [heldOnly(correction)]);
        server.credentials[alex] = 'attending';
        // An attending orders: the author's own set goes through.
        final anas = [set(finished, 'general.notes', 'Demo: later', 0)];
        expect((await send(alex, anas)).single['status'], 'accepted');
        // The admin's accept applies the held set as it was sent.
        expect(server.acceptHeld(sets[0]['changeId']! as String)['status'], 'accepted');
        expect(server.records[own]!.fields['data.meds.given']!.value, 'Demo: one tablet');
      });

      test('whoever acts as the author once a note is assigned reads and sets its hidden answers; the first author no longer does', () async {
        final n = restrictedNote(answers);
        // Assigned by an admin once Alex has left (3.8): Dana acts as the author now (review finding RD-9).
        server.records[n]!.assignedTo = dana;
        final danas = [set(n, 'exam.findings', 'Demo: a small rash')];
        final alexs = [set(n, 'exam.findings', 'Demo: something else', 2)];
        expect(await send(dana, danas), [taken(danas.single, 2)]);
        expect(await send(alex, alexs), [heldOnly(alexs.single)]);
        expect(server.records[n]!.fields['data.exam.findings']!.value, 'Demo: a small rash');
      });

      test('any change of a note the sender may not read at all is held, with nothing told of its state', () async {
        final talk = restrictedNote(const {'talk.notes': 'Demo: talked about sleep'}, type: testSensitive);
        server.finishNote(talk);
        final visit = server.records[talk]!.attributes['encounterId']! as String;
        // Casey holds the note's ID from before her role was lowered (review finding RD-11).
        final caseys = [
          change(entitySignoff, 'create', {
            'noteId': talk,
            'act': 'complete',
            'contentHash': '0' * 64,
            'claimedCredential': null,
            'statementVersion': 'complete-2026-11',
          }),
          setOn(entityNote, talk, 'status', 'draft', 1),
          change(entityCorrection, 'create', {
            'noteId': talk,
            'changes': [
              {'field': 'data.talk.notes', 'newValue': 'Demo: a guess', 'baseVersion': 1},
            ],
            'reason': 'Demo: the wrong field was picked',
            'requestedByPatient': false,
            'declined': false,
            'claimedCredential': null,
            'signoffId': null,
          }),
          change(entityAddendum, 'create', {
            'encounterId': visit,
            'noteId': talk,
            'text': 'Demo: called back',
            'signoffId': null,
          }),
        ];
        expect(await send(casey, caseys), [for (final c in caseys) heldOnly(c)]);
        // Dana may read it: hers is answered as before.
        final danas = [setOn(entityNote, talk, 'status', 'draft', 1)];
        expect((await send(dana, danas)).single['details'], containsPair('outcome', 'history_only'));
        expect(server.records[talk]!.fields['status']!.value, 'completed');
      });

      test('on a finished note too: held, where a late change would send back the answer it keeps', () async {
        final n = restrictedNote(answers);
        server.finishNote(n);
        final hidden = set(n, 'exam.findings', 'Demo: a small rash');
        final plain = set(n, 'general.notes', 'Demo: later');
        expect(await send(dana, [hidden, plain]), [
          heldOnly(hidden),
          kept(plain, answers['general.notes'], 1, 'note_finished'),
        ]);
      });
    });

    group('a retry is answered from its receipt, as the sender may see the field now (4.4, 6.4 rule 2)', () {
      const e2 = 'e0000002';
      const nothing = {'value': null, 'version': 0, 'changedBy': null, 'changedAt': null};
      late String patient;
      setUp(() {
        for (final d in restrictedNoteTypes) {
          server.noteTypes[(d['key']! as String, d['version']! as int)] = d;
        }
        patient = server.seedPatient();
        server.credentials
          ..[dana] = 'none'
          ..[casey] = 'none';
        server.permissions[casey] = {'patients.view', 'encounters.chart'};
      });
      String restrictedNote(Map<String, Object?> data) =>
          server.seed(entityNote, noteValue(visitOf(patientId: patient), testRestricted, data), by: alex);
      Map<String, Object?> set(String note, String path, Object? value, [int baseVersion = 1]) =>
          setOn(entityNote, note, 'data.$path', value, baseVersion);

      test('a conflict whose answer the sender may no longer see is sent with a field that holds nothing, whatever it holds; one still shown is sent as it is', () async {
        final n = restrictedNote(const {
          'general.notes': 'Demo: walked over from the shelter',
          'systems.seen': ['heart'],
          'dx.$e2.entryAt': '2026-10-20T14:50:00Z',
          'dx.$e2.diagnosis.code': 'J02.9',
        });
        final talk = server.seed(
          entityNote,
          noteValue(visitOf(patientId: patient), testSensitive, const {'talk.notes': 'Demo: talked about sleep'}),
          by: alex,
        );
        // Dana sees sensitive exams and Casey sensitive diagnoses when they push. Neither saw the
        // answer held there, which they may see: a conflict that shows it.
        final danas = [
          set(n, 'systems.seen', ['lungs'], 0),
          set(n, 'general.notes', 'Demo: from Dana', 0),
        ];
        final caseys = [
          set(n, 'dx.$e2.diagnosis.code', 'J03.9', 0),
          // A note Casey will not be able to read at all.
          set(talk, 'talk.notes', 'Demo: a guess', 0),
        ];
        server.permissions[dana] = {...FakeSyncServer.healthcareStaff, 'patients.view_sensitive_exams'};
        server.permissions[casey] = FakeSyncServer.healthcareStaff;
        final first = [...await send(dana, danas), ...await send(casey, caseys)];
        // Their roles are lowered again before the phones retry.
        server.permissions.remove(dana);
        server.permissions[casey] = {'patients.view', 'encounters.chart'};
        expect(
          [
            for (final r in first) [r['status'], (r['server']! as Map)['value']],
          ],
          [
            [
              'conflict',
              ['heart'],
            ],
            ['conflict', 'Demo: walked over from the shelter'],
            ['conflict', 'J02.9'],
            ['conflict', 'Demo: talked about sleep'],
          ],
        );
        // A retry answers as a fresh set would be held: by what the field could hold, so the same
        // before and after the author charts a GU exam and a sensitive diagnosis (review finding RD-10).
        Map<String, Object?> nothingFor(Map<String, Object?> c) => {
          'changeId': c['changeId'],
          'status': 'conflict',
          'serverVersion': 0,
          'server': nothing,
        };
        Future<List<Map<String, Object?>>> retried() async => [
          ...await send(dana, danas),
          ...await send(casey, caseys),
        ];
        final before = await retried();
        expect([before[0], before[2], before[3]], [nothingFor(danas[0]), nothingFor(caseys[0]), nothingFor(caseys[1])]);
        final alexs = [
          set(n, 'systems.seen', ['heart', 'gu']),
          set(n, 'dx.$e2.diagnosis.code', 'F11.20'),
          set(n, 'general.notes', 'Demo: walked over from the park'),
        ];
        expect([for (final r in await send(alex, alexs)) r['status']], ['accepted', 'accepted', 'accepted']);
        final again = await retried();
        expect([again[0], again[2], again[3]], [nothingFor(danas[0]), nothingFor(caseys[0]), nothingFor(caseys[1])]);
        expect(
          again[1]['server'],
          allOf(containsPair('value', 'Demo: walked over from the park'), containsPair('version', 2)),
        );
        // The author's own retry is answered with the field as it is.
        final own = [
          set(n, 'systems.seen', ['lungs'], 0),
        ];
        for (var i = 0; i < 2; i++) {
          expect(((await send(alex, own)).single['server']! as Map)['value'], ['heart', 'gu']);
        }
      });

      test('a late change kept in history is sent with a field that holds nothing once its sender may no longer see what it could hold', () async {
        final n = restrictedNote(const {
          'general.notes': 'Demo: walked over from the shelter',
          'systems.seen': ['heart'],
        });
        server.finishNote(n);
        final late = [
          set(n, 'systems.seen', ['lungs']),
        ];
        server.permissions[dana] = {...FakeSyncServer.healthcareStaff, 'patients.view_sensitive_exams'};
        final kept = (await send(dana, late)).single;
        server.permissions.remove(dana);
        expect(kept['server'], containsPair('value', ['heart']));
        expect(kept['details'], {'outcome': 'history_only', 'problem': 'note_finished'});
        // Nothing GU is charted, and the retry still shows nothing: the picker could hold one.
        expect((await send(dana, late)).single, {...kept, 'server': nothing});
        final correction = change(entityCorrection, 'create', {
          'noteId': n,
          'changes': [
            {
              'field': 'data.systems.seen',
              'newValue': ['heart', 'gu'],
              'baseVersion': 1,
            },
          ],
          'reason': 'Demo: the GU exam was left out',
          'requestedByPatient': false,
          'declined': false,
          'claimedCredential': null,
          'signoffId': null,
        });
        expect((await send(alex, [correction])).single['details'], containsPair('outcome', 'corrected'));
        expect((await send(dana, late)).single, {...kept, 'server': nothing});
      });
    });

    // Rules 7 to 10: services/api/test/sync-signoffs.test.ts and sync-corrections.test.ts. Alex is an
    // attending unless a case says otherwise. The phone's hash is worked out here from what the test
    // holds, as the API's tests do, never read from the fake.
    group('sign-offs (lifecycle 4.6)', () {
      late String patient;
      setUp(() {
        server.noteTypes[(testRedFlags.key, testRedFlags.version)] = redFlagsNoteType;
        patient = server.seedPatient();
      });

      Held noteHeld(String encounterId, TestNoteType type, Map<String, Object?> answers, {String by = alex}) {
        final visit = server.records[encounterId]!;
        return (
          noteId: server.seed(entityNote, noteValue(encounterId, type, answers), by: by),
          encounterId: encounterId,
          patientId: visit.fields['patientId']?.value as String?,
          summary: visit.fields['summary']?.value as String?,
          type: type,
          answers: answers,
        );
      }

      String hashOf(Held n) => noteContentHash(
        noteId: n.noteId,
        encounterId: n.encounterId,
        patientId: n.patientId,
        summary: n.summary,
        definition: NoteTypeDef.fromJson(server.noteTypes[(n.type.key, n.type.version)]!),
        answers: n.answers,
      );

      /// A sign-off as the phone makes one; a `sign` claims the credential its saved profile shows.
      Map<String, Object?> signoff(
        String user,
        Held n,
        String act, {
        String? hash,
        String? claimed,
        bool claimsNothing = false,
        String? recordId,
        String? supersedes,
        String? at,
        bool clockVerified = true,
      }) => change(
        entitySignoff,
        'create',
        {
          'noteId': n.noteId,
          'act': act,
          'contentHash': hash ?? hashOf(n),
          'claimedCredential': claimsNothing ? null : claimed ?? (act == 'sign' ? server.credentialOf(user) : null),
          'statementVersion': act == 'sign' ? 'sign-2026-11' : 'complete-2026-11',
        },
        recordId: recordId,
        more: {
          'supersedes': ?supersedes,
          if (at != null) ...{'deviceTime': at, 'correctedTime': at},
          'clockVerified': clockVerified,
        },
      );

      /// The same sign-off record sent again, as the phone's fix path sends it.
      Map<String, Object?> again(String user, Held n, String act, Map<String, Object?> refusedOne) => signoff(
        user,
        n,
        act,
        recordId: refusedOne['recordId']! as String,
        supersedes: refusedOne['changeId']! as String,
      );

      Map<String, Object?> applied(Map<String, Object?> c, String effect, String status, String attestation) => {
        ...taken(c, 1),
        'details': {'effect': effect, 'status': status, 'attestation': attestation, 'hashMatches': true},
      };

      /// Stored with no effect. `hashMatches` goes only to whoever acts as the author: null leaves it out.
      Map<String, Object?> noEffect(
        Map<String, Object?> c,
        String reason,
        String status,
        String attestation,
        bool? hashMatches,
      ) => {
        ...taken(c, 1),
        'details': {
          'effect': 'none',
          'reason': reason,
          'status': status,
          'attestation': attestation,
          'hashMatches': ?hashMatches,
        },
      };

      /// A visit of the patient with [by]'s Red flags note answered and a draft of [type].
      ({String visit, Held flags, Held note}) chartedVisit(
        String by, {
        TestNoteType type = testMedical,
        Map<String, Object?> answers = const {},
      }) {
        final visit = visitOf(patientId: patient, by: by);
        return (
          visit: visit,
          flags: noteHeld(visit, testRedFlags, const {'flags.any': 'no'}, by: by),
          note: noteHeld(visit, type, {'care.plan': 'Demo: rest and fluids', ...answers}, by: by),
        );
      }

      test('every case of signoffEffect in note-lifecycle.json, from the note as the server holds it', () async {
        final cases = ((vectors('note-lifecycle')['cases']! as Map<String, Object?>)['signoffEffect']! as List<Object?>)
            .cast<Map<String, Object?>>();
        expect(cases.length, greaterThanOrEqualTo(38));
        expect(cases.where((c) => (c['expected']! as Map<String, Object?>)['reason'] == 'empty'), hasLength(4));
        // Each test type with one required answer more, so the finish check can fail.
        TestNoteType withRequired(TestNoteType type) {
          final d = server.noteTypes[(type.key, type.version)]!;
          final key = '${type.key}_required';
          server.noteTypes[(key, 1)] = {
            ...d,
            'key': key,
            'sections': [
              ...d['sections']! as List<Object?>,
              {
                'id': 'must',
                'title': 'Must',
                'fields': [
                  {
                    'id': 'answer',
                    'kind': 'text',
                    'label': 'Answer',
                    'lines': 'one',
                    'maxLength': 200,
                    'required': true,
                  },
                ],
              },
            ],
          };
          return (key: key, version: 1);
        }

        final types = {false: withRequired(testNote), true: withRequired(testMedical)};
        final plainTypes = {false: testNote, true: testMedical};
        for (final c in cases) {
          final input = c['input']! as Map<String, Object?>;
          final expected = c['expected']! as Map<String, Object?>;
          final medical = input['medicalNote'] == true;
          // An empty draft holds no answer: its finish check passes only on a type with none required.
          final empty = input['emptyDraft'] == true;
          final signer = input['actsAsAuthor'] == true ? alex : blair;
          // The credential found at the signature: held then, raised to an attending since, so the
          // gate (which reads the credential now) lets every case through.
          final found = switch ((input['canSign'], input['needsAttestation'])) {
            (true, false) => 'attending',
            (true, true) => 'resident',
            (false, true) => 'student',
            _ => 'chw',
          };
          final visit = visitOf(patientId: patient);
          if (medical && input['redFlagsDone'] == true) {
            server.finishNote(noteHeld(visit, testRedFlags, const {'flags.any': 'no'}).noteId);
          }
          final n = empty
              ? noteHeld(visit, (input['finishOk'] == true ? plainTypes : types)[medical]!, const {})
              : noteHeld(visit, types[medical]!, {
                  'care.plan': 'Demo: rest and fluids',
                  if (input['finishOk'] == true) 'must.answer': 'Demo: done',
                });
          if (input['noteStatus'] != 'draft') server.finishNote(n.noteId, status: input['noteStatus']! as String);
          server.credentials[signer] = found;
          server.changeCredential(signer, 'attending', at: now.add(const Duration(minutes: 1)));
          final s = signoff(
            signer,
            n,
            input['act']! as String,
            hash: input['hashMatches'] == true ? null : '0' * 64,
            claimsNothing: true,
          );
          final answered = await send(signer, [s]);
          final reason = c['name']! as String;
          final status = server.records[n.noteId]!.fields['status']!.value;
          if (expected['refuse'] case final String problem) {
            expect(answered, [refused(problem)], reason: reason);
            expect([status, server.records[s['recordId']]], [input['noteStatus'], isNull], reason: reason);
          } else if (expected['effect'] == 'none') {
            expect(answered, [
              noEffect(
                s,
                expected['reason']! as String,
                input['noteStatus']! as String,
                'not_needed',
                // Told only to whoever acts as the author.
                input['actsAsAuthor'] == true ? input['hashMatches']! as bool : null,
              ),
            ], reason: reason);
            expect([status, server.records[s['recordId']]!.status], [input['noteStatus'], 'none'], reason: reason);
            expect(noticesOn(n.noteId), [
              if (expected['reason'] == 'not_author') '$signer change_not_applied $entityNote',
            ], reason: reason);
          } else {
            final effect = expected['effect']! as String;
            expect(answered, [
              applied(s, effect, expected['statusAfter']! as String, expected['attestationAfter']! as String),
            ], reason: reason);
            expect(status, expected['statusAfter'], reason: reason);
            expect(noticesOn(n.noteId), [
              if (effect == 'saved_unsigned') '$signer note_saved_unsigned $entityNote',
            ], reason: reason);
          }
          server.credentials.clear();
          server.credentialChanges.clear();
        }
      });

      test(
        'a Non-Medical note is completed: the sign-off row, then the note, in one change with one audit event',
        () async {
          server.credentials[dana] = 'none';
          final visit = visitOf(by: dana);
          final note = noteHeld(visit, testNote, const {'care.plan': 'Demo: rest and fluids'}, by: dana);
          final done = signoff(dana, note, 'complete');
          final answered = await send(dana, [done]);
          expect(answered, [applied(done, 'completed', 'completed', 'not_needed')]);
          final n = server.records[note.noteId]!;
          expect(
            [
              n.fields['status']!.value,
              n.fields['status']!.version,
              n.completedAt,
              n.completedBy,
              n.signoffId,
              n.everSigned,
            ],
            ['completed', 2, now.toIso8601String(), dana, null, false],
          );
          expect(server.records[done['recordId']]!.attributes, {
            'noteId': note.noteId,
            'act': 'complete',
            'effect': 'completed',
            'contentHash': (done['value']! as Map<String, Object?>)['contentHash'],
            'signerName': FakeSyncServer.defaultName,
            'signerCredential': 'none',
            'claimedCredential': null,
            'needsAttestation': false,
            'statementVersion': 'complete-2026-11',
            'signedAt': now.toIso8601String(),
            'clockVerified': true,
          });
          expect(historyOf(note.noteId, 'status'), [('created', 'draft', '1'), ('set', 'completed', '2')]);
          expect((await read(entityEncounter, visit)).status, 'completed');
          // Sent twice, it answers the same from its receipt, and nothing more is written.
          expect(await send(dana, [done]), answered);
          expect(historyOf(note.noteId, 'status'), hasLength(2));

          // A Non-Medical note is never signed: `sign` is a `complete`, whatever the credential.
          final social = noteHeld(visit, testNote, const {'care.plan': 'Demo: housing list'});
          final signs = signoff(alex, social, 'sign');
          expect(await send(alex, [signs]), [applied(signs, 'completed', 'completed', 'not_needed')]);
          expect(server.records[social.noteId]!.signoffId, isNull);
        },
      );

      test('a Medical note: an attending’s sign is signed with nothing held, a resident’s waits for attestation, and complete waits for a co-signer', () async {
        final ours = chartedVisit(alex, answers: const {'vitals.pulse': 88});
        final flags = signoff(alex, ours.flags, 'sign');
        final note = signoff(alex, ours.note, 'sign');
        expect(await send(alex, [flags, note]), [
          applied(flags, 'signed', 'signed', 'not_needed'),
          applied(note, 'signed', 'signed', 'not_needed'),
        ]);
        final n = server.records[ours.note.noteId]!;
        expect(
          [n.attestation, n.completedAt, n.completedBy, n.everSigned, n.signoffId],
          ['not_needed', now.toIso8601String(), alex, isTrue, note['recordId']],
        );
        expect(server.records[note['recordId']]!.attributes, containsPair('signerCredential', 'attending'));
        expect((await read(entityEncounter, ours.visit)).status, 'signed');

        server.credentials[blair] = 'resident';
        final hers = chartedVisit(blair);
        final blairs = [signoff(blair, hers.flags, 'sign'), signoff(blair, hers.note, 'sign')];
        expect(await send(blair, blairs), [for (final c in blairs) applied(c, 'signed', 'signed', 'waiting')]);
        expect(server.records[blairs[1]['recordId']]!.attributes, containsPair('needsAttestation', true));

        final waits = chartedVisit(alex);
        final completes = [signoff(alex, waits.flags, 'complete'), signoff(alex, waits.note, 'complete')];
        expect(await send(alex, completes), [
          for (final c in completes) applied(c, 'completed', 'completed', 'not_needed'),
        ]);
        expect(
          [server.records[waits.note.noteId]!.signoffId, server.records[waits.note.noteId]!.everSigned],
          [null, false],
        );
        expect((await read(entityEncounter, waits.visit)).status, 'completed');
      });

      test(
        'sign from a credential that cannot sign is saved unsigned for a co-signer, and the signer is told',
        () async {
          server.credentials[blair] = 'student';
          final his = chartedVisit(blair);
          // His phone's saved profile still showed resident.
          final flags = signoff(blair, his.flags, 'complete');
          final note = signoff(blair, his.note, 'sign', claimed: 'resident');
          expect(await send(blair, [flags, note]), [
            applied(flags, 'completed', 'completed', 'not_needed'),
            applied(note, 'saved_unsigned', 'completed', 'not_needed'),
          ]);
          expect(
            server.records[note['recordId']]!.attributes,
            allOf(
              containsPair('signerCredential', 'student'),
              containsPair('claimedCredential', 'resident'),
              containsPair('needsAttestation', true),
            ),
          );
          expect(noticesOn(his.note.noteId), ['$blair note_saved_unsigned $entityNote']);
          expect(noticesOn(his.flags.noteId), isEmpty);
        },
      );

      test('a second sign-off of a finished note is stored and changes nothing; its receipt says whether it saw what was signed', () async {
        final ours = chartedVisit(alex);
        await send(alex, [signoff(alex, ours.flags, 'sign'), signoff(alex, ours.note, 'sign')]);
        final versions = {
          for (final MapEntry(:key, :value) in server.records[ours.note.noteId]!.fields.entries) key: value.version,
        };
        final same = signoff(alex, ours.note, 'sign');
        final other = signoff(alex, ours.note, 'complete', hash: 'ab' * 32);
        expect(await send(alex, [same, other]), [
          noEffect(same, 'already_finished', 'signed', 'not_needed', true),
          noEffect(other, 'already_finished', 'signed', 'not_needed', false),
        ]);
        expect({
          for (final MapEntry(:key, :value) in server.records[ours.note.noteId]!.fields.entries) key: value.version,
        }, versions);
        expect([server.records[same['recordId']]!.status, server.records[other['recordId']]!.status], ['none', 'none']);
        expect(noticesOn(ours.note.noteId), isEmpty);
      });

      test(
        'the second phone’s hash is compared with the signature that finished the note, not with the note as it is now',
        () async {
          // A Non-Medical note on a visit with no patient, completed from one phone (NOT-7).
          final visit = visitOf(kind: 'non_medical');
          final note = noteHeld(visit, testNote, const {'care.plan': 'Demo: rest and fluids'});
          final first = signoff(alex, note, 'complete');
          expect(await send(alex, [first]), [applied(first, 'completed', 'completed', 'not_needed')]);
          // The visit is then given a patient, which is always allowed: the note's hash moves with it.
          expect(
            (await send(alex, [setOn(entityEncounter, visit, 'patientId', patient, 1)])).single['status'],
            'accepted',
          );

          // The second phone signed what the first one did: it saw exactly what was signed.
          final same = signoff(alex, note, 'complete');
          final now = signoff(alex, (
            noteId: note.noteId,
            encounterId: visit,
            patientId: patient,
            summary: null,
            type: testNote,
            answers: note.answers,
          ), 'complete');
          expect(await send(alex, [same, now]), [
            noEffect(same, 'already_finished', 'completed', 'not_needed', true),
            noEffect(now, 'already_finished', 'completed', 'not_needed', false),
          ]);

          // Reopened, changed and finished again: the later signature is the one compared with.
          final ours = chartedVisit(alex);
          final waits = [signoff(alex, ours.flags, 'sign'), signoff(alex, ours.note, 'complete')];
          expect((await send(alex, waits)).map((r) => (r['details']! as Map)['effect']), ['signed', 'completed']);
          final reopen = setOn(entityNote, ours.note.noteId, 'status', 'draft', 2);
          final plan = setOn(entityNote, ours.note.noteId, 'data.care.plan', 'Demo: rest, fluids and a recheck', 1);
          expect((await send(alex, [reopen, plan])).map((r) => [r['status'], r['details']]), [
            ['accepted', null],
            ['accepted', null],
          ]);
          final edited = (
            noteId: ours.note.noteId,
            encounterId: ours.note.encounterId,
            patientId: ours.note.patientId,
            summary: ours.note.summary,
            type: ours.note.type,
            answers: const <String, Object?>{'care.plan': 'Demo: rest, fluids and a recheck'},
          );
          final again = signoff(alex, edited, 'complete');
          expect((await send(alex, [again])).map((r) => (r['details']! as Map)['effect']), ['completed']);
          final old = signoff(alex, ours.note, 'complete');
          final fresh = signoff(alex, edited, 'complete');
          expect((await send(alex, [old, fresh])).map((r) => (r['details']! as Map)['hashMatches']), [false, true]);
        },
      );

      test(
        'a sign-off from someone who does not act as the author is stored with no effect, and the sender is told',
        () async {
          server.credentials[blair] = 'resident';
          final ours = chartedVisit(alex);
          final theirs = signoff(blair, ours.note, 'sign');
          // Whether a hash matches is told to the author only: to Blair it would check any guess (RD-2).
          final guess = signoff(blair, ours.note, 'sign', hash: 'ab' * 32);
          expect(await send(blair, [theirs, guess]), [
            noEffect(theirs, 'not_author', 'draft', 'not_needed', null),
            noEffect(guess, 'not_author', 'draft', 'not_needed', null),
          ]);
          expect(server.records[theirs['recordId']]!.author, blair);
          expect(noticesOn(ours.note.noteId), [
            '$blair change_not_applied $entityNote',
            '$blair change_not_applied $entityNote',
          ]);

          // Assigned to Blair after Alex left (3.8): Blair acts as the author now, and Alex no longer does.
          server.records[ours.note.noteId]!.assignedTo = blair;
          final flags = signoff(alex, ours.flags, 'sign');
          final writers = signoff(alex, ours.note, 'sign');
          expect(await send(alex, [flags, writers]), [
            applied(flags, 'signed', 'signed', 'not_needed'),
            noEffect(writers, 'not_author', 'draft', 'not_needed', null),
          ]);
          final assignees = signoff(blair, ours.note, 'sign');
          expect(await send(blair, [assignees]), [applied(assignees, 'signed', 'signed', 'waiting')]);
          // On a finished note too: the first writer, no longer the author, is not told whether it matches.
          final late = signoff(alex, ours.note, 'sign');
          expect(await send(alex, [late]), [noEffect(late, 'already_finished', 'signed', 'waiting', null)]);
          expect(
            [server.records[ours.note.noteId]!.completedBy, server.records[ours.note.noteId]!.signoffId],
            [blair, assignees['recordId']],
          );
        },
      );

      test('content_changed, incomplete and red_flags_first, each fixed by sending the same record again', () async {
        final visit = visitOf(patientId: patient);
        // The Red flags note the app added, its red-flag question not answered yet. (Not empty: an
        // empty draft's sign-off changes nothing, as below.)
        final flags = noteHeld(visit, testRedFlags, const {'flags.note': 'Demo: asked, no answer yet'});
        final note = noteHeld(visit, testMedical, const {'care.plan': 'Demo: rest'});
        final noteFirst = signoff(alex, note, 'sign', hash: 'cd' * 32);
        final flagsFirst = signoff(alex, flags, 'sign');
        expect(await send(alex, [noteFirst, flagsFirst]), [refused('content_changed'), refused('incomplete')]);
        final noteSecond = again(alex, note, 'sign', noteFirst);
        expect(await send(alex, [noteSecond]), [refused('red_flags_first')]);
        for (final n in [flags, note]) {
          expect(server.records[n.noteId]!.fields['status']!.value, 'draft');
        }
        for (final c in [noteFirst, flagsFirst]) {
          expect(server.records[c['recordId']], isNull);
        }

        // One Complete fixes them all: the red-flag answer, then the Red flags note first.
        final answer = setOn(entityNote, flags.noteId, 'data.flags.any', 'no', 0);
        final answered = (
          noteId: flags.noteId,
          encounterId: visit,
          patientId: patient,
          summary: null,
          type: testRedFlags,
          answers: const <String, Object?>{'flags.note': 'Demo: asked, no answer yet', 'flags.any': 'no'},
        );
        final flagsFix = again(alex, answered, 'sign', flagsFirst);
        final noteFix = again(alex, note, 'sign', noteSecond);
        expect(await send(alex, [answer, flagsFix, noteFix]), [
          taken(answer, 1),
          applied(flagsFix, 'signed', 'signed', 'not_needed'),
          applied(noteFix, 'signed', 'signed', 'not_needed'),
        ]);
        expect(
          [
            for (final c in [noteFirst, flagsFirst, noteSecond]) server.receipts[c['changeId']]!.resolved,
          ],
          [true, true, true],
        );
      });

      // sync-signoffs.test.ts, review finding SFN-7 as the coordinator decided.
      test('an empty draft’s sign-off changes nothing, and so settles the refusal of an earlier one', () async {
        final visit = visitOf(patientId: patient);
        final note = noteHeld(visit, testMedical, const {'care.plan': 'Demo: rest'});
        final first = signoff(alex, note, 'sign', hash: 'cd' * 32);
        expect(await send(alex, [first]), [refused('content_changed')]);
        final blank = setOn(entityNote, note.noteId, 'data.care.plan', null, 1);
        final removed = (
          noteId: note.noteId,
          encounterId: visit,
          patientId: patient,
          summary: null,
          type: testMedical,
          answers: const <String, Object?>{'care.plan': null},
        );
        final fix = again(alex, removed, 'sign', first);
        expect(await send(alex, [blank, fix]), [taken(blank, 2), noEffect(fix, 'empty', 'draft', 'not_needed', true)]);
        expect(server.records[note.noteId]!.fields['status']!.value, 'draft');
        expect(server.records[note.noteId]!.completedAt, isNull);
        expect(server.records[fix['recordId']]!.status, 'none');
        expect(noticesOn(note.noteId), isEmpty);
        expect(server.receipts[first['changeId']]!.resolved, isTrue);
      });

      test('only a finished Red flags note of the visit counts, and a Non-Medical note never waits for one', () async {
        final elsewhere = chartedVisit(alex);
        expect(
          (await send(alex, [signoff(alex, elsewhere.flags, 'sign')])).single['details'],
          containsPair('effect', 'signed'),
        );
        // This visit's Red flags note is answered but not finished; another visit's is finished.
        final here = chartedVisit(alex);
        final social = noteHeld(here.visit, testNote, const {'care.plan': 'Demo: housing list'});
        final medical = signoff(alex, here.note, 'complete');
        final nonMedical = signoff(alex, social, 'complete');
        expect(await send(alex, [medical, nonMedical]), [
          refused('red_flags_first'),
          applied(nonMedical, 'completed', 'completed', 'not_needed'),
        ]);
        // A completed Red flags note is finished: one that waits for a co-signer counts.
        final flags = signoff(alex, here.flags, 'complete');
        final fix = again(alex, here.note, 'sign', medical);
        expect(await send(alex, [flags, fix]), [
          applied(flags, 'completed', 'completed', 'not_needed'),
          applied(fix, 'signed', 'signed', 'not_needed'),
        ]);
      });

      test('a note with no version has no type to hash it by: definition_error, and the queue goes on', () async {
        final visit = visitOf();
        final preview = noteHeld(visit, testNote, const {});
        server.records[preview.noteId]!.attributes['noteTypeVersion'] = null;
        final stuck = signoff(alex, preview, 'complete', hash: 'ef' * 32);
        final next = signoff(alex, noteHeld(visit, testNote, const {'care.plan': 'Demo: rest'}), 'complete');
        expect(await send(alex, [stuck, next]), [
          refused('definition_error'),
          applied(next, 'completed', 'completed', 'not_needed'),
        ]);
        expect(server.records[stuck['recordId']], isNull);
      });

      group('the content hash (lifecycle 4.5)', () {
        test('covers the visit’s patient and summary: a sign-off on what changed since is refused, and the same record sent again is taken', () async {
          final visit = visitOf(patientId: patient);
          final summary = setOn(entityEncounter, visit, 'summary', 'Demo: seen by the river', 0);
          expect(await send(alex, [summary]), [taken(summary, 1)]);
          final flags = noteHeld(visit, testRedFlags, const {'flags.any': 'no'});
          final note = noteHeld(visit, testMedical, const {'care.plan': 'Demo: rest'});
          // Blair rewrites the summary while every note is a draft: the draft rule takes it.
          final rewrite = setOn(entityEncounter, visit, 'summary', 'Demo: seen by the bridge', 1);
          expect(await send(blair, [rewrite]), [taken(rewrite, 2)]);
          final stale = [signoff(alex, flags, 'sign'), signoff(alex, note, 'sign')];
          expect(await send(alex, stale), [refused('content_changed'), refused('content_changed')]);
          expect(server.records[note.noteId]!.fields['status']!.value, 'draft');

          // The person looks again and completes: the phone sends the same records with the new hash.
          Held seen(Held n) => (
            noteId: n.noteId,
            encounterId: n.encounterId,
            patientId: n.patientId,
            summary: 'Demo: seen by the bridge',
            type: n.type,
            answers: n.answers,
          );
          final fixes = [again(alex, seen(flags), 'sign', stale[0]), again(alex, seen(note), 'sign', stale[1])];
          expect(await send(alex, fixes), [for (final c in fixes) applied(c, 'signed', 'signed', 'not_needed')]);
          expect([for (final c in stale) server.receipts[c['changeId']]!.resolved], [true, true]);

          // A visit moved to another patient between what was seen and what is held: refused too.
          final moved = chartedVisit(alex);
          final other = server.seedPatient();
          final move = setOn(entityEncounter, moved.visit, 'patientId', other, 1);
          expect(await send(blair, [move]), [taken(move, 2)]);
          final old = signoff(alex, moved.flags, 'sign');
          expect(await send(alex, [old]), [refused('content_changed')]);
          final f = moved.flags;
          final fixed = again(
            alex,
            (
              noteId: f.noteId,
              encounterId: f.encounterId,
              patientId: other,
              summary: f.summary,
              type: f.type,
              answers: f.answers,
            ),
            'sign',
            old,
          );
          expect(await send(alex, [fixed]), [applied(fixed, 'signed', 'signed', 'not_needed')]);
        });

        test(
          'is taken over the answers that count, and a finished note keeps only those, each one dropped in its history',
          () async {
            const at = '2026-10-20T14:40:00.000Z';
            String entry(int n) => 'rows.e${'$n'.padLeft(7, '0')}';
            final visit = visitOf(patientId: patient);
            final flags = noteHeld(visit, testRedFlags, const {'flags.any': 'no'});
            final answers = <String, Object?>{
              'care.plan': 'Demo: dress daily',
              // A clear holds no answer.
              'care.followup': null,
              // Hidden while "Nothing more" is ticked.
              'more.none': true,
              'more.detail': 'Demo: one more thing',
              // A removed entry, and one that is there.
              '${entry(1)}.entryAt': at,
              '${entry(1)}.n': 3,
              '${entry(1)}.entryRemoved': true,
              '${entry(2)}.entryAt': at,
              '${entry(2)}.n': 4,
            };
            final note = noteHeld(visit, testMedical, answers);
            // A teammate's answer that does not count changes nothing that is signed.
            final hidden = setOn(entityNote, note.noteId, 'data.more.detail', 'Demo: from Blair', 1);
            expect((await send(blair, [hidden])).single['details'], {'notCounted': 'hidden_field'});
            final signs = [signoff(alex, flags, 'sign'), signoff(alex, note, 'sign')];
            expect(await send(alex, signs), [for (final c in signs) applied(c, 'signed', 'signed', 'not_needed')]);

            final fields = server.records[note.noteId]!.fields;
            expect(
              {
                for (final MapEntry(:key, :value) in fields.entries)
                  if (key.startsWith('data.') && value.value != null) key.substring(5): value.value,
              },
              {'care.plan': 'Demo: dress daily', 'more.none': true, '${entry(2)}.entryAt': at, '${entry(2)}.n': 4},
            );
            final dropped = {
              'care.followup': null,
              'more.detail': 'Demo: from Blair',
              '${entry(1)}.entryAt': at,
              '${entry(1)}.n': 3,
              '${entry(1)}.entryRemoved': true,
            };
            expect(
              {for (final path in dropped.keys) path: fields['data.$path']!.version},
              {for (final path in dropped.keys) path: path == 'more.detail' ? 3 : 2},
            );
            expect(
              {
                for (final h in server.history)
                  if (h['recordId'] == note.noteId &&
                      h['changeId'] == signs[1]['changeId'] &&
                      (h['field']! as String).startsWith('data.'))
                    (h['field']! as String).substring(5): [h['value'], h['previous']],
              },
              {
                for (final MapEntry(:key, :value) in dropped.entries) key: [null, value],
              },
            );
          },
        );

        test('every case of note-content-hash.json: the hash a sign-off is checked against, and what a finished note keeps', () async {
          final file = vectors('note-content-hash');
          final definitions = vectors('forms-conformance')['definitions']! as Map<String, Object?>;
          final cases = (file['cases']! as List<Object?>).cast<Map<String, Object?>>();
          expect(cases.length, greaterThanOrEqualTo(21));
          for (final c in cases) {
            final reason = c['name']! as String;
            final definition = definitions[c['definition']]! as Map<String, Object?>;
            final type = (key: definition['key']! as String, version: definition['version']! as int);
            server.noteTypes[(type.key, type.version)] = definition;
            final patientId = c['patientId'] as String?;
            final encounterId = c['encounterId']! as String;
            final noteId = c['noteId']! as String;
            // The note as the database holds it, each answer as stored: some the type refuses, or
            // that would not count.
            server.records.remove(noteId);
            if (!server.records.containsKey(encounterId)) {
              if (patientId != null && !server.records.containsKey(patientId)) server.seedPatient(id: patientId);
              server.seed(entityEncounter, {'kind': 'medical', 'patientId': ?patientId}, id: encounterId, by: alex);
            }
            server.records[encounterId]!.fields
              ..['patientId'] = FakeField(patientId, 1, alex, null, null)
              ..['summary'] = FakeField(c['summary'], 1, alex, null, null);
            final medical = !(definition['kinds']! as List<Object?>).contains('non_medical');
            server.records[noteId] = FakeRecord(
              id: noteId,
              entity: entityNote,
              author: alex,
              attributes: {'encounterId': encounterId, 'noteTypeKey': type.key, 'noteTypeVersion': type.version},
              fields: {
                'status': FakeField('draft', 1, alex, null, null),
                for (final MapEntry(:key, :value) in (c['answers']! as Map<String, Object?>).entries)
                  'data.$key': FakeField(value, 1, alex, null, null),
              },
            )..medical = medical;
            final held = (
              noteId: noteId,
              encounterId: encounterId,
              patientId: patientId,
              summary: c['summary'] as String?,
              type: type,
              answers: c['answers']! as Map<String, Object?>,
            );
            final wrong = signoff(alex, held, 'complete', hash: c['hash'] == 'ab' * 32 ? 'cd' * 32 : 'ab' * 32);
            expect(await send(alex, [wrong]), [refused('content_changed')], reason: reason);
            final right = signoff(alex, held, 'complete', hash: c['hash']! as String);
            final [answer] = await send(alex, [right]);
            // Past the hash, the note may still ask for an answer or for its Red flags note first.
            expect(answer['details'], isNot({'problem': 'content_changed'}), reason: reason);
            if (answer['status'] == 'accepted') {
              expect(
                {
                  for (final MapEntry(:key, :value) in server.records[noteId]!.fields.entries)
                    if (key.startsWith('data.') && value.value != null) key.substring(5): value.value,
                },
                c['effective'],
                reason: reason,
              );
            }
          }
        });
      });

      group('the credential a sign-off is recorded under, and the Medical gate (lifecycle 3.5, 4.2)', () {
        test('every case of signed-under.json, as the fake finds a credential', () {
          final cases = (vectors('signed-under')['cases']! as List<Object?>).cast<Map<String, Object?>>();
          expect(cases.length, greaterThanOrEqualTo(38));
          expect(FakeSyncServer.capabilities.keys.toSet(), credentials);
          for (final c in cases) {
            final input = c['input']! as Map<String, Object?>;
            final expected = c['expected']! as Map<String, Object?>;
            SignedUnder found() => FakeSyncServer.signedUnder(
              current: (input['current']! as Map<String, Object?>)['credential']! as String,
              laterChanges: [
                for (final change in (input['laterChanges']! as List<Object?>).cast<Map<String, Object?>>())
                  (
                    changedAt: change['changedAt']! as String,
                    oldCredential: (change['oldValue']! as Map<String, Object?>)['credential']! as String,
                  ),
              ],
              signedAt: input['signedAt']! as String,
              receivedAt: input['receivedAt']! as String,
              clockVerified: input['clockVerified']! as bool,
              notBefore: input['notBefore']! as String,
              claimed: input['claimed'] as String?,
            );
            if (expected['throws'] case final String message) {
              expect(
                found,
                throwsA(isA<StateError>().having((e) => e.message, 'message', message)),
                reason: c['name'] as String,
              );
              continue;
            }
            final f = found();
            expect(
              [f.credential, f.timeTrusted, f.canSign, f.needsAttestation, f.claimDiffers],
              [
                for (final k in ['credential', 'timeTrusted', 'canSign', 'needsAttestation', 'claimDiffers'])
                  expected[k],
              ],
              reason: c['name'] as String,
            );
          }
        });

        test('a signature’s time is the clock-corrected one; the phone’s own time is kept beside it', () async {
          final charted = chartedVisit(alex);
          expect((await send(alex, [signoff(alex, charted.flags, 'sign')])).single['status'], 'accepted');
          // The phone's clock runs three hours slow; its last measured offset corrects it.
          final corrected = now.toIso8601String();
          final device = now.subtract(const Duration(hours: 3)).toIso8601String();
          final sign = signoff(alex, charted.note, 'sign')
            ..['deviceTime'] = device
            ..['correctedTime'] = corrected;
          expect(await send(alex, [sign]), [applied(sign, 'signed', 'signed', 'not_needed')]);
          final row = server.records[sign['recordId']]!;
          expect([row.attributes['signedAt'], row.attributes['signerCredential']], [corrected, 'attending']);
          expect(server.records[charted.note.noteId]!.completedAt, corrected);
        });

        test('a note whose create was held is believed from when the server received the create, not when an admin accepted it', () async {
          final visit = visitOf(patientId: patient);
          server.finishNote(noteHeld(visit, testRedFlags, const {'flags.any': 'no'}).noteId);
          // Alex's credential is lowered while the phone is offline; the Medical note's create is held.
          server.changeCredential(alex, 'none', at: now.subtract(const Duration(minutes: 40)));
          const answers = {'care.plan': 'Demo: rest'};
          final create = change(entityNote, 'create', noteValue(visit, testMedical, answers));
          expect((await send(alex, [create])).single['reason'], 'permission');
          // Received half an hour before the admin's accept, which this server's fixed clock dates now.
          server.heldAt[create['changeId']! as String] = now.subtract(const Duration(minutes: 30));
          // Signed offline while holding none; then an admin restores the credential.
          final held = (
            noteId: create['recordId']! as String,
            encounterId: visit,
            patientId: patient as String?,
            summary: null as String?,
            type: testMedical,
            answers: answers,
          );
          final sign = signoff(
            alex,
            held,
            'sign',
            claimed: 'attending',
            at: now.subtract(const Duration(minutes: 20)).toIso8601String(),
          );
          server.changeCredential(alex, 'attending', at: now.subtract(const Duration(minutes: 10)));
          // The sign-off waits with its note, and an admin accepts both.
          expect((await send(alex, [sign])).single['reason'], 'awaiting_review');
          expect(server.acceptHeld(create['changeId']! as String)['status'], 'accepted');
          expect(server.acceptHeld(sign['changeId']! as String)['status'], 'accepted');
          // Signed after the server had the note, so the time is believed: none signs nothing.
          final row = server.records[sign['recordId']]!;
          expect([row.status, row.attributes['signerCredential']], ['saved_unsigned', 'none']);
        });

        test(
          'signed Monday, promoted Tuesday, synced Wednesday: the signature keeps the credential it was signed under',
          () async {
            server.credentials[blair] = 'resident';
            final synced = chartedVisit(blair);
            final unverified = chartedVisit(blair);
            // Monday: the drafts reach the server, then Blair completes them offline.
            final monday = now.add(const Duration(hours: 1)).toIso8601String();
            final flags = signoff(blair, synced.flags, 'sign', at: monday);
            final note = signoff(blair, synced.note, 'sign', at: monday);
            // A phone that could not check its clock: its time is its own word, and not believed.
            final unchecked = [
              signoff(blair, unverified.flags, 'sign', at: monday, clockVerified: false),
              signoff(blair, unverified.note, 'sign', at: monday, clockVerified: false),
            ];
            // Tuesday: an admin makes Blair an attending.
            server.changeCredential(blair, 'attending', at: now.add(const Duration(days: 1)));
            // Wednesday: everything syncs, and a whole visit charted offline reaches the server.
            final wednesday = now.add(const Duration(days: 2));
            server.now = () => wednesday;
            Future<List<Map<String, Object?>>> sync(List<Map<String, Object?>> changes) async =>
                results(await push(blair, 'dev-$blair', changes, clock: wednesday));
            expect(await sync([flags, note]), [
              applied(flags, 'signed', 'signed', 'waiting'),
              applied(note, 'signed', 'signed', 'waiting'),
            ]);
            expect(
              server.records[note['recordId']]!.attributes,
              allOf(
                containsPair('signerCredential', 'resident'),
                containsPair('claimedCredential', 'resident'),
                containsPair('needsAttestation', true),
                containsPair('signedAt', monday),
              ),
            );
            expect(await sync(unchecked), [for (final c in unchecked) applied(c, 'signed', 'signed', 'waiting')]);
            expect(
              server.records[unchecked[1]['recordId']]!.attributes,
              allOf(containsPair('signerCredential', 'attending'), containsPair('clockVerified', false)),
            );
            // The note reached the server after the time the signature claims: that time is not
            // believed, so the credential is the one held now, and the claim keeps it waiting.
            final offline = chartedVisit(blair);
            final early = signoff(blair, offline.flags, 'sign', at: monday, claimed: 'resident');
            final late = signoff(blair, offline.note, 'sign', at: monday, claimed: 'resident');
            expect(await sync([early, late]), [
              applied(early, 'signed', 'signed', 'waiting'),
              applied(late, 'signed', 'signed', 'waiting'),
            ]);
            expect(server.records[late['recordId']]!.attributes, containsPair('signerCredential', 'attending'));
          },
        );

        test('a credential lowered while the phone was offline holds the sign-off; an admin’s accept records it as it was signed', () async {
          server.credentials[dana] = 'np';
          final charted = chartedVisit(dana);
          final signs = [signoff(dana, charted.flags, 'sign'), signoff(dana, charted.note, 'sign')];
          server.changeCredential(dana, 'chw', at: now.add(const Duration(minutes: 1)));
          expect(await send(dana, signs), [for (final c in signs) heldOnly(c)]);
          for (final c in signs) {
            expect(server.records[c['recordId']], isNull);
            expect(server.acceptHeld(c['changeId']! as String, by: admin)['status'], 'accepted');
          }
          final n = server.records[charted.note.noteId]!;
          expect([n.fields['status']!.value, n.attestation], ['signed', 'waiting']);
          expect(
            server.records[signs[1]['recordId']]!.attributes,
            allOf(containsPair('signerCredential', 'np'), containsPair('needsAttestation', true)),
          );
          expect(server.records[signs[1]['recordId']]!.author, dana);
        });

        test('a held sign-off that will not reach the chart tells its sender the note needs completing again: rejected, or refused on accept as the note changed', () async {
          // Review finding NOT-12: the phone let go of the sign-off when it was held.
          server.credentials[dana] = 'np';
          final changed = chartedVisit(dana);
          final other = chartedVisit(dana);
          final sent = [
            signoff(dana, other.flags, 'sign'),
            signoff(dana, changed.note, 'sign'),
            signoff(dana, other.note, 'sign'),
            // Not a sign-off: rejected, it tells nobody anything.
            setOn(entityNote, other.note.noteId, 'data.care.plan', 'Demo: fluids and rest', 1),
          ];
          server.changeCredential(dana, 'chw', at: now.add(const Duration(minutes: 1)));
          expect(await send(dana, sent), [for (final c in sent) heldOnly(c)]);
          // A teammate rewrites the visit's summary while every note is a draft: the note no longer
          // matches what Dana signed.
          final rewrite = setOn(entityEncounter, changed.visit, 'summary', 'Demo: seen by the bridge', 0);
          expect(
            [
              for (final r in await send(alex, [rewrite])) r['status'],
            ],
            ['accepted'],
          );
          // On the held sign-off, by a kind of its own: the phone words it with no state of its own (SRC-2).
          final told = ['$dana signoff_not_applied $entitySignoff'];
          String id(Map<String, Object?> c) => c['recordId']! as String;

          // Accepted: on the chart, and nobody is told anything.
          expect(server.acceptHeld(sent[0]['changeId']! as String, by: admin)['status'], 'accepted');
          expect(noticesOn(id(sent[0])), isEmpty);
          expect(noticesOn(other.flags.noteId), isEmpty);
          // Refused on accept, as the note changed: still held, and Dana is told the note needs completing.
          expect(server.acceptHeld(sent[1]['changeId']! as String, by: admin), refused('content_changed'));
          expect(server.held.keys, contains(sent[1]['changeId']));
          expect(server.records[changed.note.noteId]!.fields['status']!.value, 'draft');
          expect(noticesOn(id(sent[1])), told);
          expect(noticesOn(changed.note.noteId), isEmpty);
          // Rejected then: that sign-off was told already.
          server.rejectHeld(sent[1]['changeId']! as String);
          expect(noticesOn(id(sent[1])), told);
          // A held change that is not a sign-off, rejected, tells nobody; a held sign-off, rejected, its sender.
          server.rejectHeld(sent[3]['changeId']! as String);
          expect(noticesOn(id(sent[3])), isEmpty);
          server.rejectHeld(sent[2]['changeId']! as String);
          expect(noticesOn(id(sent[2])), told);
          expect(noticesOn(other.note.noteId), isEmpty);
          expect(server.records[other.note.noteId]!.fields['status']!.value, 'draft');
        });

        test('an addendum or a correction held behind a held sign-off a reviewer rejects is accepted as if it named none, and so is one sent later', () async {
          // Review finding PS-2.
          server.credentials[dana] = 'np';
          final v = chartedVisit(dana);
          final s1 = signoff(dana, v.flags, 'sign');
          final s2 = signoff(dana, v.note, 'sign');
          final add = change(entityAddendum, 'create', {
            'encounterId': v.visit,
            'noteId': null,
            'text': 'Demo: added to the assessment',
            'signoffId': s1['recordId'],
          });
          final fix = change(entityCorrection, 'create', {
            'noteId': v.note.noteId,
            'changes': [
              {'field': 'data.care.plan', 'newValue': 'Demo: rest, fluids and a recheck', 'baseVersion': 1},
            ],
            'reason': 'Demo: the recheck was left out',
            'requestedByPatient': false,
            'declined': false,
            'claimedCredential': null,
            'signoffId': s2['recordId'],
          });
          server.changeCredential(dana, 'chw', at: now.add(const Duration(minutes: 1)));
          expect(
            [
              for (final r in await send(dana, [s1, s2, add, fix])) [r['status'], r['reason'], r['quarantined']],
            ],
            [
              ['rejected', 'permission', true],
              ['rejected', 'permission', true],
              ['rejected', 'awaiting_review', true],
              ['rejected', 'awaiting_review', true],
            ],
          );
          server
            ..rejectHeld(s1['changeId']! as String)
            ..rejectHeld(s2['changeId']! as String);
          expect(server.acceptHeld(add['changeId']! as String, by: admin)['status'], 'accepted');
          expect(server.acceptHeld(fix['changeId']! as String, by: admin)['status'], 'accepted');
          final addendum = server.records[add['recordId']]!;
          expect([addendum.attributes['noteId'], addendum.attributes['text']], [null, 'Demo: added to the assessment']);
          expect(server.records[fix['recordId']]!.status, 'draft_edit');
          final note = server.records[v.note.noteId]!;
          expect(
            [note.fields['status']!.value, note.fields['data.care.plan']!.value],
            ['draft', 'Demo: rest, fluids and a recheck'],
          );
          // One sent later, naming a sign-off a reviewer rejected, is taken the same way.
          final later = change(entityAddendum, 'create', {
            'encounterId': v.visit,
            'noteId': v.note.noteId,
            'text': 'Demo: written later',
            'signoffId': s2['recordId'],
          });
          expect(
            [
              for (final r in await send(dana, [later])) r['status'],
            ],
            ['accepted'],
          );
          // A sign-off that is simply not on the chart, rejected by no reviewer, is still a missing parent.
          final unknown = change(entityAddendum, 'create', {
            'encounterId': v.visit,
            'noteId': v.note.noteId,
            'text': 'Demo: names nothing known',
            'signoffId': '00000000-0000-4000-8000-0000000000ff',
          });
          expect(await send(dana, [unknown]), [
            allOf(
              containsPair('status', 'rejected'),
              containsPair('reason', 'stale_reference'),
              containsPair('details', {'problem': 'note_signoff_missing'}),
            ),
          ]);
        });

        // services/api/test/sync-signoffs.test.ts, 'a held correction refused at accept, or rejected,
        // tells its sender, naming the note, with no text of it' (review finding VS-6).
        test('a held correction refused at accept, or rejected, tells its sender, naming the note', () async {
          server.credentials[dana] = 'np';
          final v = chartedVisit(dana);
          final s1 = signoff(dana, v.flags, 'sign');
          final s2 = signoff(dana, v.note, 'sign');
          Map<String, Object?> correction(String plan) => change(entityCorrection, 'create', {
            'noteId': v.note.noteId,
            'changes': [
              {'field': 'data.care.plan', 'newValue': plan, 'baseVersion': 1},
            ],
            'reason': 'Demo: the recheck was left out',
            'requestedByPatient': false,
            'declined': false,
            'claimedCredential': null,
            'signoffId': s2['recordId'],
          });
          String id(Map<String, Object?> c) => c['recordId']! as String;
          final fix = correction('Demo: rest, fluids and a recheck');
          server.changeCredential(dana, 'chw', at: now.add(const Duration(minutes: 1)));
          expect(
            [
              for (final r in await send(dana, [s1, s2, fix])) [r['status'], r['reason']],
            ],
            [
              ['rejected', 'permission'],
              ['rejected', 'permission'],
              ['rejected', 'awaiting_review'],
            ],
          );
          server
            ..rejectHeld(s1['changeId']! as String)
            ..rejectHeld(s2['changeId']! as String)
            // A teammate edits the draft's answer: the correction's version is gone.
            ..serverEdit(v.note.noteId, 'data.care.plan', 'Demo: teammate plan', by: alex);
          expect(
            server.acceptHeld(fix['changeId']! as String, by: admin)['details'],
            containsPair('problem', 'field_changed'),
          );
          final told = ['$dana correction_not_applied $entityCorrection'];
          expect(noticesOn(id(fix)), told);
          expect(server.notices.where((n) => n.recordId == id(fix)).map((n) => n.noteId), [v.note.noteId]);
          server.rejectHeld(fix['changeId']! as String);
          expect(noticesOn(id(fix)), told);
          // A held correction rejected outright tells its sender too.
          final again = correction('Demo: rest and a recheck');
          await send(dana, [again]);
          server.rejectHeld(again['changeId']! as String);
          expect(noticesOn(id(again)), ['$dana correction_not_applied $entityCorrection']);
        });

        test('each held sign-off is told once, whether or not an earlier notice was read', () async {
          // Review findings SRC-1 and SRC-5: told by note, a second held Complete rejected before the
          // phone's read of the first notice arrived told nobody, and a late reject of the first one was
          // taken by the phone for the second, still held.
          server.credentials[dana] = 'np';
          final charted = chartedVisit(dana);
          server.changeCredential(dana, 'chw', at: now.add(const Duration(minutes: 1)));
          List<(String, String, bool)> toldOf(Map<String, Object?> c) => [
            for (final n in server.notices)
              if (n.userId == dana && n.recordId == c['recordId']) (n.kind, n.entity, n.readAt != null),
          ];
          const once = ('signoff_not_applied', entitySignoff, false);
          Future<Map<String, Object?>> held() async {
            // Signed as the phone's saved profile still shows Dana: a nurse practitioner.
            final s = signoff(dana, charted.flags, 'sign', claimed: 'np');
            expect(await send(dana, [s]), [heldOnly(s)]);
            return s;
          }

          // Held, rejected: told. Completed again, held again, and rejected before the first notice is
          // read: told again, on the second sign-off.
          final first = await held();
          server.rejectHeld(first['changeId']! as String);
          final second = await held();
          server.rejectHeld(second['changeId']! as String);
          expect(toldOf(first), [once]);
          expect(toldOf(second), [once]);
          expect(noticesOn(charted.flags.noteId), isEmpty);

          // Held, its accept refused as the note changed: told, and the person reads it.
          final third = await held();
          final edit = setOn(entityEncounter, charted.visit, 'summary', 'Demo: seen at the bridge', 0);
          expect(
            [
              for (final r in await send(alex, [edit])) r['status'],
            ],
            ['accepted'],
          );
          expect(server.acceptHeld(third['changeId']! as String, by: admin), refused('content_changed'));
          server.notices.singleWhere((n) => n.recordId == third['recordId']).readAt = now;
          // Completed again and held: still pending, a later sign-off of the same note.
          final fourth = await held();
          // The reviewer rejects the third later, as the refused accept invites: that sign-off was told
          // already, read or not, and nothing names the fourth, which is still held.
          server.rejectHeld(third['changeId']! as String);
          expect(toldOf(third), [('signoff_not_applied', entitySignoff, true)]);
          expect(toldOf(fourth), isEmpty);
          expect(server.held.keys, contains(fourth['changeId']));
        });

        test(
          'a held sign-off’s notice names its note, rejected or refused on accept; no other notice names one',
          () async {
            // D104: the notice names the held sign-off, which waits in the review queue and is never in
            // the sync read, so a phone that never held it finds the note by the notice alone.
            server.credentials[dana] = 'np';
            final rejected = chartedVisit(dana);
            final changed = chartedVisit(dana);
            final sent = [signoff(dana, rejected.flags, 'sign'), signoff(dana, changed.flags, 'sign')];
            server.changeCredential(dana, 'chw', at: now.add(const Duration(minutes: 1)));
            expect(await send(dana, sent), [for (final c in sent) heldOnly(c)]);
            // A teammate rewrites one visit's summary, so its Red flags note no longer matches what Dana
            // signed, and signs Dana's other note of it, which tells Alex about that note.
            final rewrite = setOn(entityEncounter, changed.visit, 'summary', 'Demo: seen under the bridge', 0);
            final theirs = signoff(alex, changed.note, 'sign');
            expect(
              [
                for (final r in await send(alex, [rewrite, theirs])) r['status'],
              ],
              ['accepted', 'accepted'],
            );
            server.rejectHeld(sent[0]['changeId']! as String);
            expect(server.acceptHeld(sent[1]['changeId']! as String, by: admin), refused('content_changed'));

            Future<List<(String, String?, String?, String?)>> listed(String user) async => [
              for (final n in await as(user).listNotices()) (n.kind, n.entity, n.recordId, n.noteId),
            ];
            // Newest first: the refused accept's, then the reject's.
            expect(await listed(dana), [
              ('signoff_not_applied', entitySignoff, sent[1]['recordId'], changed.flags.noteId),
              ('signoff_not_applied', entitySignoff, sent[0]['recordId'], rejected.flags.noteId),
            ]);
            expect(await listed(alex), [('change_not_applied', entityNote, changed.note.noteId, null)]);
            // Of every notice written here, only a held sign-off's names a note.
            expect({for (final n in server.notices.where((n) => n.noteId != null)) n.kind}, {'signoff_not_applied'});
          },
        );

        test(
          'a held sign-off’s time is checked against when its push arrived, not when an admin accepted it',
          () async {
            server.credentials[dana] = 'np';
            final charted = chartedVisit(dana);
            expect(
              (await send(dana, [signoff(dana, charted.flags, 'sign')])).single['details'],
              containsPair('effect', 'signed'),
            );
            final sign = signoff(dana, charted.note, 'sign');
            server.changeCredential(dana, 'chw', at: now.add(const Duration(minutes: 1)));
            expect(await send(dana, [sign]), [heldOnly(sign)]);
            // As if the push had arrived ten minutes before the time its signature claims: a phone clock
            // running ahead. Accepted now, that time would be believed; it was not when it arrived.
            server.heldAt[sign['changeId']! as String] = now.subtract(const Duration(minutes: 10));
            expect(server.acceptHeld(sign['changeId']! as String, by: admin)['status'], 'accepted');
            // So the credential is the one held now, which cannot sign.
            expect(
              server.records[sign['recordId']]!.attributes,
              allOf(containsPair('effect', 'saved_unsigned'), containsPair('signerCredential', 'chw')),
            );
            expect(server.records[charted.note.noteId]!.signoffId, isNull);
          },
        );
      });
    });

    // Rule 9: services/api/test/sync-corrections.test.ts, 'addenda (lifecycle 4.7)'.
    group('addenda (lifecycle 4.7)', () {
      Map<String, Object?> addendum(
        String encounterId,
        String? noteId, {
        String text = 'Demo: called back',
        String? at,
      }) => change(
        entityAddendum,
        'create',
        {'encounterId': encounterId, 'noteId': noteId, 'text': text, 'signoffId': null},
        more: {
          if (at != null) ...{'deviceTime': at, 'correctedTime': at},
        },
      );

      test('is taken in every state of its note, and below the visit itself, from anyone who charts', () async {
        final patient = server.seedPatient();
        final visit = visitOf(patientId: patient);
        final draft = noteOn(visit, type: testMedical);
        final completed = noteOn(visit);
        server.finishNote(completed);
        final signed = noteOn(visit, type: testMedical);
        server.finishNote(signed, status: 'signed');
        // Dana charts, and may not chart Medical: an addendum changes no note, so it needs no Medical credential.
        server.credentials[dana] = 'none';
        final addenda = [
          addendum(visit, draft),
          addendum(visit, completed),
          addendum(visit, signed),
          addendum(visit, null, text: 'Demo: the van ran late'),
        ];
        final answered = await send(dana, addenda);
        expect(answered, [for (final c in addenda) taken(c, 1)]);
        final made = server.records[addenda[2]['recordId']]!;
        expect(
          [made.status, made.author, made.attributes['noteId'], made.attributes['text']],
          ['written', dana, signed, 'Demo: called back'],
        );
        expect(
          [
            for (final id in [draft, completed, signed]) server.records[id]!.fields['status']!.value,
          ],
          ['draft', 'completed', 'signed'],
        );
        // Sent twice, it answers the same.
        expect(await send(dana, addenda), answered);
      });

      test('believes the time it was written only once the server had its visit (lifecycle 3.5)', () async {
        server.credentials[blair] = 'resident';
        server.changeCredential(blair, 'attending', at: now.subtract(const Duration(minutes: 30)));
        // A visit dated two hours back on the phone reaches the server only now.
        String back(int hours) => now.subtract(Duration(hours: hours)).toIso8601String();
        final create = change(
          entityEncounter,
          'create',
          {'kind': 'medical', 'patientId': server.seedPatient()},
          more: {'deviceTime': back(2), 'correctedTime': back(2)},
        );
        expect(await send(blair, [create]), [taken(create, 1)]);
        // Written an hour back, before the server knew of the visit: not believed, so the credential now.
        final written = addendum(create['recordId']! as String, null, at: back(1));
        expect(await send(blair, [written]), [taken(written, 1)]);
        expect(server.records[written['recordId']]!.attributes['authorCredential'], 'attending');
      });

      test('records its author as they were when it was written, as a signature does (lifecycle 3.5)', () async {
        server.credentials[blair] = 'resident';
        final visit = visitOf(patientId: server.seedPatient());
        final written = addendum(visit, null);
        server.changeCredential(blair, 'attending', at: now.add(const Duration(minutes: 1)));
        expect(await send(blair, [written]), [taken(written, 1)]);
        expect(server.records[written['recordId']]!.attributes['authorCredential'], 'resident');
      });

      test('names a note of its visit: another visit’s note answers stale_reference before the insert, as a missing one does', () async {
        final patient = server.seedPatient();
        final visit = visitOf(patientId: patient);
        final elsewhere = noteOn(visitOf(patientId: patient));
        final wrongVisit = addendum(visit, elsewhere);
        final missing = addendum(visit, uuid());
        expect(await send(alex, [wrongVisit, missing]), [
          for (final _ in [wrongVisit, missing])
            allOf(
              containsPair('status', 'rejected'),
              containsPair('reason', 'stale_reference'),
              containsPair('details', {'problem': 'encounter_note_missing'}),
            ),
        ]);
        expect(server.records[wrongVisit['recordId']], isNull);
      });
    });

    group('what an addendum and a correction name (lifecycle 4.7)', () {
      Matcher stale(String problem) => allOf(
        containsPair('status', 'rejected'),
        containsPair('reason', 'stale_reference'),
        containsPair('details', {'problem': problem}),
      );

      test('names a sign-off of its own note, or with no note of a note of its visit: any other is refused as a missing one is', () async {
        final patient = server.seedPatient();
        final visit = visitOf(patientId: patient);
        final other = visitOf(patientId: patient);
        final draft = noteOn(visit);
        final done = noteOn(visit);
        final ours = server.cosign(done, by: alex);
        final theirs = server.cosign(noteOn(other), by: alex);
        Map<String, Object?> naming(String? noteId, String signoffId) => change(entityAddendum, 'create', {
          'encounterId': visit,
          'noteId': noteId,
          'text': 'Demo: called back',
          'signoffId': signoffId,
        });
        final changes = [naming(draft, ours), naming(null, theirs), naming(done, ours), naming(null, ours)];
        final answers = await send(alex, changes);
        expect(answers.sublist(0, 2), [stale('note_signoff_missing'), stale('note_signoff_missing')]);
        expect([for (final r in answers.sublist(2)) r['status']], ['accepted', 'accepted']);
        expect([server.records[changes[0]['recordId']], server.records[changes[1]['recordId']]], [null, null]);
      });

      test(
        'names a sign-off of its own note: another note’s is refused as a missing one is, and the draft is not edited',
        () async {
          final visit = visitOf(patientId: server.seedPatient());
          final draft = server.seed(
            entityNote,
            noteValue(visit, testNote, const {'care.plan': 'Demo: before'}),
            by: alex,
          );
          final done = server.seed(entityNote, noteValue(visit, testNote, const {'care.plan': 'Demo: done'}), by: alex);
          final signed = server.cosign(done, by: alex);
          Map<String, Object?> correcting(String noteId, String newValue) => change(entityCorrection, 'create', {
            'noteId': noteId,
            'changes': [
              {'field': 'data.care.plan', 'newValue': newValue, 'baseVersion': 1},
            ],
            'reason': 'Demo: the wrong field was picked',
            'requestedByPatient': false,
            'declined': false,
            'claimedCredential': 'attending',
            'signoffId': signed,
          });
          final wrong = correcting(draft, 'Demo: after');
          final right = correcting(done, 'Demo: done today');
          final answers = await send(alex, [wrong, right]);
          expect(answers.first, stale('note_signoff_missing'));
          expect(answers.last['details'], containsPair('outcome', 'corrected'));
          expect(server.records[wrong['recordId']], isNull);
          expect(server.records[draft]!.fields['data.care.plan']!.value, 'Demo: before');
        },
      );
    });

    // Rule 10: services/api/test/sync-corrections.test.ts, 'corrections (lifecycle 3.6, 4.7)'. Dana
    // holds no credential, Alex is an attending, Blair a resident, Casey a student; the co-signer and
    // attester is the admin, an attending.
    group('corrections (lifecycle 3.6, 4.7)', () {
      late String patient;
      setUp(() {
        server.noteTypes[(testRedFlags.key, testRedFlags.version)] = redFlagsNoteType;
        patient = server.seedPatient();
        server.credentials
          ..[dana] = 'none'
          ..[blair] = 'resident'
          ..[casey] = 'student';
      });

      Map<String, Object?> answer(String path, Object? newValue, [int baseVersion = 1]) => {
        'field': 'data.$path',
        'newValue': newValue,
        'baseVersion': baseVersion,
      };
      Map<String, Object?> correction(
        String user,
        String noteId,
        List<Map<String, Object?>> changes, {
        String reason = 'Demo: the wrong field was picked',
        bool requestedByPatient = false,
        bool declined = false,
        String? recordId,
        String? supersedes,
      }) => change(
        entityCorrection,
        'create',
        {
          'noteId': noteId,
          'changes': changes,
          'reason': reason,
          'requestedByPatient': requestedByPatient,
          'declined': declined,
          'claimedCredential': server.credentialOf(user),
          'signoffId': null,
        },
        recordId: recordId,
        more: {'supersedes': ?supersedes},
      );
      Map<String, Object?> corrected(Map<String, Object?> c, String outcome, String status, String attestation) => {
        ...taken(c, 1),
        'details': {'outcome': outcome, 'status': status, 'attestation': attestation},
      };

      /// A Medical note of [by]'s, finished as a sign-off would leave it, after its visit's Red flags note.
      String finishedMedical(
        String by,
        String status, [
        Map<String, Object?> answers = const {'care.plan': 'Demo: rest and fluids'},
      ]) {
        final visit = visitOf(patientId: patient, by: by);
        server.finishNote(server.seed(entityNote, noteValue(visit, testRedFlags, const {'flags.any': 'no'}), by: by));
        final note = server.seed(entityNote, noteValue(visit, testMedical, answers), by: by);
        server.finishNote(note, status: status);
        if (status == 'signed') {
          server.records[note]!
            ..signoffId = uuid()
            ..attestation = server.credentialOf(by) == 'attending' ? 'not_needed' : 'waiting';
        }
        return note;
      }

      test('a finished note’s answers are corrected together: each written as corrected, the row keeps old and new, and the note shows the new', () async {
        final note = server.seed(
          entityNote,
          noteValue(visitOf(patientId: patient, by: dana), testNote, const {
            'care.plan': 'Demo: rest',
            'vitals.pulse': 80,
          }),
          by: dana,
        );
        server.finishNote(note);
        const reason = 'Demo: pulse taken twice, second reading';
        final fix = correction(dana, note, [
          answer('care.plan', 'Demo: rest and fluids'),
          answer('vitals.pulse', 88),
          // An answer the note did not hold is corrected in as well.
          answer('care.followup', 'Demo: clinic on Tuesday', 0),
        ], reason: reason);
        final receipt = await send(dana, [fix]);
        expect(receipt, [corrected(fix, 'corrected', 'completed', 'not_needed')]);
        final fields = server.records[note]!.fields;
        expect(
          [
            for (final f in ['data.care.plan', 'data.vitals.pulse', 'data.care.followup'])
              [fields[f]!.value, fields[f]!.version],
          ],
          [
            ['Demo: rest and fluids', 2],
            [88, 2],
            ['Demo: clinic on Tuesday', 1],
          ],
        );
        final rows = [
          for (final h in server.history)
            if (h['changeId'] == fix['changeId']) h,
        ];
        expect(
          [
            for (final h in rows) [h['field'], h['version'], h['value'], h['previous'], h['kind'], h['by']],
          ],
          [
            ['data.care.plan', 2, 'Demo: rest and fluids', 'Demo: rest', 'corrected', dana],
            ['data.vitals.pulse', 2, 88, 80, 'corrected', dana],
            ['data.care.followup', 1, 'Demo: clinic on Tuesday', null, 'corrected', dana],
          ],
        );
        final row = server.records[fix['recordId']]!;
        expect(row.attributes, {
          'noteId': note,
          'changes': [
            {'field': 'data.care.plan', 'oldValue': 'Demo: rest', 'newValue': 'Demo: rest and fluids'},
            {'field': 'data.vitals.pulse', 'oldValue': 80, 'newValue': 88},
            {'field': 'data.care.followup', 'oldValue': null, 'newValue': 'Demo: clinic on Tuesday'},
          ],
          'outcome': 'corrected',
          'reason': reason,
          'requestedByPatient': false,
          'correctorName': FakeSyncServer.defaultName,
          'correctorCredential': 'none',
          'claimedCredential': 'none',
          'correctedAt': now.toIso8601String(),
          'clockVerified': true,
        });
        expect(server.correctionHistory[fix['recordId']], {for (final h in rows) h['field']: h['id']});
        // Sent again, it answers from its receipt and writes nothing more.
        expect(await send(dana, [fix]), receipt);
        expect(fields['data.care.plan']!.version, 2);
      });

      test('the corrector’s credential decides what is left of a signature: each row of the table in 3.6', () async {
        // An attending's own note: unchanged, signed, and the same signature.
        final own = finishedMedical(alex, 'signed');
        final ownSignature = server.records[own]!.signoffId;
        // A resident's note waits for attestation, and waits again after a correction.
        final waits = finishedMedical(blair, 'signed');
        // A resident's note an attending attested: it waits again, and the attester is told.
        final attested = finishedMedical(blair, 'signed');
        server.attest(attested, by: admin);
        // A student's note an attending co-signed: back to waiting for a co-signer, and the co-signer is told.
        final cosigned = finishedMedical(casey, 'completed');
        server.cosign(cosigned, by: admin);
        // A student's note waiting for a co-signer: unchanged.
        final pending = finishedMedical(casey, 'completed');
        // An attested note its attending corrects: still attested, since the attending signs it.
        final kept = finishedMedical(alex, 'signed');
        server.attest(kept, by: admin);
        server.notices.clear();

        List<Map<String, Object?>> fix(String user, List<String> notes) => [
          for (final n in notes) correction(user, n, [answer('care.plan', 'Demo: fluids and rest')]),
        ];
        final alexs = fix(alex, [own, kept]);
        final blairs = fix(blair, [waits, attested]);
        final caseys = fix(casey, [cosigned, pending]);
        expect(await send(alex, alexs), [
          corrected(alexs[0], 'corrected', 'signed', 'not_needed'),
          corrected(alexs[1], 'corrected', 'signed', 'attested'),
        ]);
        expect(await send(blair, blairs), [for (final c in blairs) corrected(c, 'corrected', 'signed', 'waiting')]);
        expect(await send(casey, caseys), [
          for (final c in caseys) corrected(c, 'corrected', 'completed', 'not_needed'),
        ]);
        expect(server.records[own]!.signoffId, ownSignature);
        expect(
          [
            for (final n in [own, waits, attested, cosigned, pending, kept]) server.records[n]!.attestation,
          ],
          ['not_needed', 'waiting', 'waiting', 'not_needed', 'not_needed', 'attested'],
        );
        final student = server.records[cosigned]!;
        expect([student.fields['status']!.value, student.signoffId, student.everSigned], ['completed', null, isTrue]);
        // The status moved only where the signature went, and its history says so.
        expect(
          [
            for (final h in server.history)
              if (h['changeId'] == caseys[0]['changeId']) [h['field'], h['kind'], h['value'], h['previous']],
          ],
          [
            ['data.care.plan', 'corrected', 'Demo: fluids and rest', 'Demo: rest and fluids'],
            ['status', 'set', 'completed', 'signed'],
          ],
        );
        // "A note you signed was corrected. It needs your review again."
        expect(noticesOn(attested), ['$admin note_corrected $entityNote']);
        expect(noticesOn(cosigned), ['$admin note_corrected $entityNote']);
        for (final n in [own, waits, pending, kept]) {
          expect(noticesOn(n), isEmpty);
        }
      });

      test('the corrector is never told of their own correction, even when it undoes their attestation', () async {
        // Dana attests Blair's note, which is then assigned to Dana (3.8). Dana, now a resident,
        // corrects it: the note waits for attestation again, and its attester is Dana (REC-8).
        server.credentials[dana] = 'attending';
        final note = finishedMedical(blair, 'signed');
        server.attest(note, by: dana);
        server.records[note]!.assignedTo = dana;
        server.credentials[dana] = 'resident';
        server.notices.clear();
        final fix = correction(dana, note, [answer('care.plan', 'Demo: fluids and rest')]);
        expect(await send(dana, [fix]), [corrected(fix, 'corrected', 'signed', 'waiting')]);
        expect(noticesOn(note), isEmpty);
      });

      test(
        'the corrector’s credential is found as a signature’s is: corrected Monday, promoted Tuesday, synced Wednesday',
        () async {
          final note = finishedMedical(blair, 'signed');
          server.attest(note, by: admin);
          final fix = correction(blair, note, [answer('care.plan', 'Demo: fluids')]);
          server.changeCredential(blair, 'attending', at: now.add(const Duration(minutes: 1)));
          expect(await send(blair, [fix]), [corrected(fix, 'corrected', 'signed', 'waiting')]);
          expect(
            server.records[fix['recordId']]!.attributes,
            allOf(containsPair('correctorCredential', 'resident'), containsPair('claimedCredential', 'resident')),
          );
        },
      );

      test('1. whoever does not act as the author is told, and nothing changes: before the Medical gate', () async {
        final note = finishedMedical(alex, 'signed');
        final before = server.records[note]!.fields['data.care.plan']!;
        final fromBlair = correction(blair, note, [answer('care.plan', 'Demo: other plan')]);
        // Dana may not chart a Medical note; not being its author answers first, and nothing is held.
        final fromDana = correction(dana, note, [answer('care.plan', 'Demo: other plan')]);
        expect(await send(blair, [fromBlair]), [corrected(fromBlair, 'not_author', 'signed', 'not_needed')]);
        expect(await send(dana, [fromDana]), [corrected(fromDana, 'not_author', 'signed', 'not_needed')]);
        expect(server.records[note]!.fields['data.care.plan'], same(before));
        expect(server.records[fromBlair['recordId']]!.attributes['changes'], [
          {'field': 'data.care.plan', 'oldValue': 'Demo: rest and fluids', 'newValue': 'Demo: other plan'},
        ]);
        expect(noticesOn(note), ['$blair change_not_applied $entityNote', '$dana change_not_applied $entityNote']);
      });

      test(
        '3. the Medical gate holds a correction from someone who may no longer chart one; an admin’s accept applies it',
        () async {
          server.credentials[blair] = 'np';
          final note = finishedMedical(blair, 'signed');
          server.changeCredential(blair, 'chw');
          final fix = correction(blair, note, [answer('care.plan', 'Demo: fluids')]);
          expect(await send(blair, [fix]), [heldOnly(fix)]);
          expect(server.records[fix['recordId']], isNull);
          expect(server.acceptHeld(fix['changeId']! as String, by: admin)['status'], 'accepted');
          // Recorded under the credential Blair holds now, which cannot sign: the note waits for a co-signer.
          expect(
            server.records[fix['recordId']]!.attributes,
            allOf(containsPair('outcome', 'corrected'), containsPair('correctorCredential', 'chw')),
          );
          expect([server.records[note]!.fields['status']!.value, server.records[note]!.signoffId], ['completed', null]);
          expect(
            [
              for (final h in server.history)
                if (h['changeId'] == fix['changeId']) [h['field'], h['kind'], h['by'], h['approvedBy']],
            ],
            [
              ['data.care.plan', 'corrected', blair, admin],
              ['status', 'set', blair, admin],
            ],
          );
        },
      );

      test('4. a declined amendment request is stored and the note is unchanged; only a request is declined', () async {
        final note = finishedMedical(alex, 'signed');
        final declined = correction(
          alex,
          note,
          [answer('care.plan', 'Demo: what the patient asked for')],
          requestedByPatient: true,
          declined: true,
          reason: 'Demo: the plan was recorded as given',
        );
        final notARequest = correction(alex, note, [answer('care.plan', 'Demo: other')], declined: true);
        final accepted = correction(alex, note, [
          answer('care.plan', 'Demo: as the patient asked'),
        ], requestedByPatient: true);
        final answers = await send(alex, [declined, notARequest, accepted]);
        expect(answers[0], corrected(declined, 'declined', 'signed', 'not_needed'));
        expect(answers[1], refusedAt('declined'));
        expect(answers[2], corrected(accepted, 'corrected', 'signed', 'not_needed'));
        expect(server.records[declined['recordId']]!.attributes, containsPair('requestedByPatient', true));
        expect([
          for (final h in server.history)
            if (h['changeId'] == declined['changeId']) h,
        ], isEmpty);
      });

      test('5. each new value is one the note type takes, named by its field; checked before the version', () async {
        final note = server.seed(
          entityNote,
          noteValue(visitOf(by: dana), testNote, const {'vitals.pulse': 80}),
          by: dana,
        );
        server.finishNote(note);
        final changes = [
          correction(dana, note, [answer('care.plan', 'Demo: fine', 0), answer('vitals.pulse', 400)]),
          correction(dana, note, [answer('nope.here', 'Demo: x', 0)]),
          // A version the person did not see, and a value the type refuses: the value answers.
          correction(dana, note, [answer('vitals.pulse', 'fast', 7)]),
        ];
        expect(await send(dana, changes), [
          refusedWith(const {'problem': 'out_of_range', 'field': 'data.vitals.pulse'}),
          refusedWith(const {'problem': 'unknown_path', 'field': 'data.nope.here'}),
          refusedWith(const {'problem': 'wrong_type', 'field': 'data.vitals.pulse'}),
        ]);
        for (final c in changes) {
          expect(server.records[c['recordId']], isNull);
        }
        expect(server.records[note]!.fields['data.vitals.pulse']!.value, 80);
      });

      test(
        '6 and 7. an answer that moved since is field_changed: Correct again is taken, Leave it is no change',
        () async {
          final note = server.seed(
            entityNote,
            noteValue(visitOf(by: dana), testNote, const {'vitals.pulse': 80, 'care.plan': 'Demo: rest'}),
            by: dana,
          );
          server.finishNote(note);
          // Two phones correct the same answer from what each saw: the first is taken.
          final first = correction(dana, note, [answer('vitals.pulse', 88)]);
          final second = correction(dana, note, [answer('vitals.pulse', 92), answer('care.plan', 'Demo: fluids')]);
          final third = correction(dana, note, [answer('vitals.pulse', 84)]);
          expect(await send(dana, [first, second, third]), [
            corrected(first, 'corrected', 'completed', 'not_needed'),
            refusedWith(const {'problem': 'field_changed', 'field': 'data.vitals.pulse'}),
            refusedWith(const {'problem': 'field_changed', 'field': 'data.vitals.pulse'}),
          ]);
          expect(server.records[second['recordId']], isNull);
          // Correct again: the same record, with the version now seen. Leave it: the value the note holds.
          final correctAgain = correction(
            dana,
            note,
            [answer('vitals.pulse', 92, 2), answer('care.plan', 'Demo: fluids')],
            recordId: second['recordId']! as String,
            supersedes: second['changeId']! as String,
          );
          final leaveIt = correction(
            dana,
            note,
            [answer('vitals.pulse', 92, 3)],
            recordId: third['recordId']! as String,
            supersedes: third['changeId']! as String,
          );
          expect(await send(dana, [correctAgain]), [corrected(correctAgain, 'corrected', 'completed', 'not_needed')]);
          expect(await send(dana, [leaveIt]), [corrected(leaveIt, 'no_change', 'completed', 'not_needed')]);
          expect([
            for (final h in server.history)
              if (h['changeId'] == leaveIt['changeId']) h,
          ], isEmpty);
          expect(server.records[leaveIt['recordId']]!.attributes['changes'], [
            {'field': 'data.vitals.pulse', 'oldValue': 92, 'newValue': 92},
          ]);
          expect(
            [server.receipts[second['changeId']]!.resolved, server.receipts[third['changeId']]!.resolved],
            [true, true],
          );
          // The same value at a version the person did not see is still field_changed: step 6 comes first.
          final stale = correction(dana, note, [answer('vitals.pulse', 92, 2)]);
          expect(await send(dana, [stale]), [
            refusedWith(const {'problem': 'field_changed', 'field': 'data.vitals.pulse'}),
          ]);
        },
      );

      test('6. an answer Complete dropped, blank now, is corrected from blank by someone who held no version of it; '
          'one who held one is still told field_changed (D109)', () async {
        // "Nothing more" hides the detail, so Complete drops it: blank at its next version, which the
        // note's read leaves out (D107). The phone holds no version of it, and sends 0.
        const answers = {'vitals.pulse': 80, 'more.detail': 'Demo: walks with a cane', 'more.none': true};
        final visit = visitOf(by: dana);
        Future<String> finished() async {
          final note = server.seed(entityNote, noteValue(visit, testNote, answers), by: dana);
          final signoff = change(entitySignoff, 'create', {
            'noteId': note,
            'act': 'complete',
            'contentHash': noteContentHash(
              noteId: note,
              encounterId: visit,
              patientId: null,
              summary: null,
              definition: NoteTypeDef.fromJson(server.noteTypes[(testNote.key, testNote.version)]!),
              answers: answers,
            ),
            'claimedCredential': null,
            'statementVersion': 'complete-2026-11',
          });
          expect((await send(dana, [signoff])).single['details'], containsPair('effect', 'completed'));
          return note;
        }

        final note = await finished();
        final left = await finished();
        final fields = server.records[note]!.fields;
        expect([fields['data.more.detail']!.value, fields['data.more.detail']!.version], [null, 2]);

        // The version the person held is older than the blank: someone else changed it since.
        final held = correction(dana, note, [answer('more.none', null), answer('more.detail', 'Demo: uses a walker')]);
        expect(await send(dana, [held]), [
          refusedWith(const {'problem': 'field_changed', 'field': 'data.more.detail'}),
        ]);
        // Correct again with the version now seen, none: the blank is filled, as a draft edit fills one.
        final correctAgain = correction(
          dana,
          note,
          [answer('more.none', null), answer('more.detail', 'Demo: uses a walker', 0)],
          recordId: held['recordId']! as String,
          supersedes: held['changeId']! as String,
        );
        expect(await send(dana, [correctAgain]), [corrected(correctAgain, 'corrected', 'completed', 'not_needed')]);
        expect(
          [
            for (final f in ['data.more.none', 'data.more.detail']) [fields[f]!.value, fields[f]!.version],
          ],
          [
            [null, 2],
            ['Demo: uses a walker', 3],
          ],
        );
        expect(
          [
            for (final h in server.history)
              if (h['changeId'] == correctAgain['changeId']) [h['field'], h['version'], h['previous'], h['kind']],
          ],
          [
            ['data.more.none', 2, true, 'corrected'],
            ['data.more.detail', 3, null, 'corrected'],
          ],
        );
        expect(server.records[correctAgain['recordId']]!.attributes['changes'], [
          {'field': 'data.more.none', 'oldValue': true, 'newValue': null},
          {'field': 'data.more.detail', 'oldValue': null, 'newValue': 'Demo: uses a walker'},
        ]);
        expect(server.receipts[held['changeId']]!.resolved, isTrue);

        // Leave it, on an answer still blank: stored as no change.
        final leaveIt = correction(dana, left, [answer('more.detail', null, 0)]);
        expect(await send(dana, [leaveIt]), [corrected(leaveIt, 'no_change', 'completed', 'not_needed')]);
        // Never held, and not blank now: someone's answer is never written over unseen.
        final unseen = correction(dana, note, [answer('more.detail', 'Demo: no aid', 0)]);
        expect(await send(dana, [unseen]), [
          refusedWith(const {'problem': 'field_changed', 'field': 'data.more.detail'}),
        ]);
        expect(fields['data.more.detail']!.value, 'Demo: uses a walker');
      });

      test('6. an answer a correction hid, kept at its version, is shown again by someone who held no version of it; '
          'one who held one that moved is still told field_changed (D109, review F2)', () async {
        const answers = {'vitals.pulse': 80, 'more.detail': 'Demo: walks with a cane'};
        final visit = visitOf(by: dana);
        final note = server.seed(entityNote, noteValue(visit, testNote, answers), by: dana);
        final moved = server.seed(entityNote, noteValue(visit, testNote, answers), by: dana);
        server
          ..finishNote(note)
          ..finishNote(moved);
        final fields = server.records[note]!.fields;

        // "Nothing more" hides the detail. The note keeps it at its version (4.7), and the note's read
        // leaves it out, since it does not count, so the phone holds no version of it (D107).
        final hide = correction(dana, note, [answer('more.none', true, 0)]);
        expect(await send(dana, [hide]), [corrected(hide, 'corrected', 'completed', 'not_needed')]);
        expect(
          [fields['data.more.detail']!.value, fields['data.more.detail']!.version],
          ['Demo: walks with a cane', 1],
        );
        expect((await read(entityNote, note)).fields.keys, isNot(contains('data.more.detail')));

        // Shown again, from no version: taken, and the old value goes to history, to be struck through.
        final back = correction(dana, note, [
          answer('more.none', null),
          answer('more.detail', 'Demo: uses a walker', 0),
        ]);
        expect(await send(dana, [back]), [corrected(back, 'corrected', 'completed', 'not_needed')]);
        expect(
          [
            for (final f in ['data.more.none', 'data.more.detail']) [fields[f]!.value, fields[f]!.version],
          ],
          [
            [null, 2],
            ['Demo: uses a walker', 2],
          ],
        );
        expect(
          [
            for (final h in server.history)
              if (h['changeId'] == back['changeId']) [h['field'], h['version'], h['previous'], h['kind']],
          ],
          [
            ['data.more.none', 2, true, 'corrected'],
            ['data.more.detail', 2, 'Demo: walks with a cane', 'corrected'],
          ],
        );
        expect(server.records[back['recordId']]!.attributes['changes'], [
          {'field': 'data.more.none', 'oldValue': true, 'newValue': null},
          {'field': 'data.more.detail', 'oldValue': 'Demo: walks with a cane', 'newValue': 'Demo: uses a walker'},
        ]);
        expect((await read(entityNote, note)).fields['data.more.detail']?.version, 2);

        // Someone who held a version of it, corrected since and then hidden, is still told it changed.
        final first = correction(dana, moved, [answer('more.detail', 'Demo: uses a stick')]);
        final hideMoved = correction(dana, moved, [answer('more.none', true, 0)]);
        expect(await send(dana, [first, hideMoved]), [
          corrected(first, 'corrected', 'completed', 'not_needed'),
          corrected(hideMoved, 'corrected', 'completed', 'not_needed'),
        ]);
        final stale = correction(dana, moved, [
          answer('more.none', null),
          answer('more.detail', 'Demo: uses a walker'),
        ]);
        expect(await send(dana, [stale]), [
          refusedWith(const {'problem': 'field_changed', 'field': 'data.more.detail'}),
        ]);
        expect(
          [
            server.records[moved]!.fields['data.more.detail']!.value,
            server.records[moved]!.fields['data.more.none']!.value,
          ],
          ['Demo: uses a stick', true],
        );
      });

      test('7. a correction whose changed answers stay hidden changes nothing the note shows: no change, the signature '
          'as it was, nobody told (review F4)', () async {
        // "Nothing more" hides the detail. A correction hides it, then the note is co-signed (a
        // student's) or attested (a resident's), as it now shows.
        const answers = {'care.plan': 'Demo: rest', 'more.detail': 'Demo: walks with a cane'};
        final cosigned = finishedMedical(casey, 'completed', answers);
        final attested = finishedMedical(blair, 'signed', answers);
        final hideCosigned = correction(casey, cosigned, [answer('more.none', true, 0)]);
        expect(await send(casey, [hideCosigned]), [corrected(hideCosigned, 'corrected', 'completed', 'not_needed')]);
        final hideAttested = correction(blair, attested, [answer('more.none', true, 0)]);
        expect(await send(blair, [hideAttested]), [corrected(hideAttested, 'corrected', 'signed', 'waiting')]);
        server
          ..cosign(cosigned, by: admin)
          ..attest(attested, by: admin);
        server.notices.clear();
        String state(String note) {
          final r = server.records[note]!;
          return [
            r.fields['status']!.value,
            r.attestation,
            r.signoffId,
            for (final f in r.fields.entries.where((e) => e.key.startsWith('data.')))
              '${f.key}=${f.value.value}@${f.value.version}',
          ].join(' ');
        }

        final before = [state(cosigned), state(attested)];
        final historyBefore = server.history.length;

        // The hidden detail, from no version or from the one held, and Leave it with the phone's blank:
        // each stays hidden, so the note shows the same.
        final fixes = [
          correction(casey, cosigned, [answer('more.detail', 'Demo: uses a walker', 0)]),
          correction(casey, cosigned, [answer('more.detail', 'Demo: uses a stick')]),
          correction(casey, cosigned, [answer('more.detail', null, 0)]),
        ];
        expect(await send(casey, fixes), [for (final f in fixes) corrected(f, 'no_change', 'signed', 'not_needed')]);
        final fromBlair = correction(blair, attested, [answer('more.detail', 'Demo: uses a walker', 0)]);
        expect(await send(blair, [fromBlair]), [corrected(fromBlair, 'no_change', 'signed', 'attested')]);

        // Nothing written: the co-signature and the attestation stand, and nobody is told.
        expect([state(cosigned), state(attested)], before);
        expect(server.history, hasLength(historyBefore));
        expect([...noticesOn(cosigned), ...noticesOn(attested)], isEmpty);
        expect(server.records[fixes[0]['recordId']]!.attributes['changes'], [
          {'field': 'data.more.detail', 'oldValue': 'Demo: walks with a cane', 'newValue': 'Demo: uses a walker'},
        ]);
        expect(server.correctionHistory[fixes[0]['recordId']], isEmpty);

        // An answer the correction that hides it changes is written: it showed before. Beside an answer
        // that shows, a hidden one is still not written: from no version, it is written only by a
        // correction that makes it count again.
        final note = server.seed(
          entityNote,
          noteValue(visitOf(by: dana), testNote, const {'vitals.pulse': 80, 'more.detail': 'Demo: walks with a cane'}),
          by: dana,
        );
        server.finishNote(note);
        final hide = correction(dana, note, [
          answer('more.none', true, 0),
          answer('more.detail', 'Demo: walks with a stick'),
        ]);
        final both = correction(dana, note, [
          answer('vitals.pulse', 84),
          answer('more.detail', 'Demo: uses a walker', 0),
        ]);
        expect(await send(dana, [hide, both]), [
          corrected(hide, 'corrected', 'completed', 'not_needed'),
          corrected(both, 'corrected', 'completed', 'not_needed'),
        ]);
        List<Object?> wrote(Map<String, Object?> c) => [
          for (final h in server.history)
            if (h['changeId'] == c['changeId']) h['field'],
        ];
        expect(
          [wrote(hide), wrote(both)],
          [
            ['data.more.none', 'data.more.detail'],
            ['data.vitals.pulse'],
          ],
        );
        final fields = server.records[note]!.fields;
        expect(
          [
            for (final f in ['data.vitals.pulse', 'data.more.detail', 'data.more.none'])
              [fields[f]!.value, fields[f]!.version],
          ],
          [
            [84, 2],
            ['Demo: walks with a stick', 2],
            [true, 1],
          ],
        );
        // The correction names only the answer it wrote (review R1).
        expect(server.records[both['recordId']]!.attributes['changes'], [
          {'field': 'data.vitals.pulse', 'oldValue': 80, 'newValue': 84},
        ]);
      });

      test('7. beside an answer that shows, a hidden answer the sender held at its version is written; one they '
          'never held is not, and the correction names only what it wrote (review R1)', () async {
        final note = server.seed(
          entityNote,
          noteValue(visitOf(by: dana), testNote, const {'vitals.pulse': 80, 'more.detail': 'Demo: walks with a cane'}),
          by: dana,
        );
        server.finishNote(note);
        // One phone, offline: "Nothing more" hides the detail; then, from the same copy, which still shows
        // the detail at the version the person saw, the pulse and the detail.
        final hide = correction(dana, note, [answer('more.none', true, 0)], reason: 'Demo: nothing more');
        final held = correction(dana, note, [
          answer('vitals.pulse', 84),
          answer('more.detail', 'Demo: uses a walker'),
        ], reason: 'Demo: pulse and aid');
        expect(await send(dana, [hide, held]), [
          corrected(hide, 'corrected', 'completed', 'not_needed'),
          corrected(held, 'corrected', 'completed', 'not_needed'),
        ]);
        final fields = server.records[note]!.fields;
        expect(
          [
            for (final f in ['data.vitals.pulse', 'data.more.detail', 'data.more.none'])
              [fields[f]!.value, fields[f]!.version],
          ],
          [
            [84, 2],
            ['Demo: uses a walker', 2],
            [true, 1],
          ],
        );
        expect(
          [
            for (final h in server.history)
              if (h['changeId'] == held['changeId']) [h['field'], h['previous']],
          ],
          [
            ['data.vitals.pulse', 80],
            ['data.more.detail', 'Demo: walks with a cane'],
          ],
        );
        expect(server.records[held['recordId']]!.attributes['changes'], [
          {'field': 'data.vitals.pulse', 'oldValue': 80, 'newValue': 84},
          {'field': 'data.more.detail', 'oldValue': 'Demo: walks with a cane', 'newValue': 'Demo: uses a walker'},
        ]);

        // A detail never held, beside the pulse, is not written while it stays hidden, and the correction
        // does not name it.
        final unheld = correction(dana, note, [
          answer('vitals.pulse', 86, 2),
          answer('more.detail', 'Demo: uses a frame', 0),
        ], reason: 'Demo: pulse again');
        expect(await send(dana, [unheld]), [corrected(unheld, 'corrected', 'completed', 'not_needed')]);
        expect(fields['data.more.detail']!.value, 'Demo: uses a walker');
        expect(server.records[unheld['recordId']]!.attributes['changes'], [
          {'field': 'data.vitals.pulse', 'oldValue': 84, 'newValue': 86},
        ]);
        expect(server.correctionHistory[unheld['recordId']]!.keys, ['data.vitals.pulse']);
      });

      test(
        '8. one answer opens another: corrected alone it fails the finish check, together with the other it is taken',
        () async {
          // "EMS activated" Yes makes the time required, as the API's test-only EMS type does.
          final ems = {
            ...testNoteTypes[1],
            'key': 'test_ems',
            'sections': [
              {
                'id': 'ems',
                'title': 'EMS',
                'fields': [
                  {
                    'id': 'activated',
                    'kind': 'choice',
                    'label': 'EMS activated?',
                    'many': false,
                    'options': [
                      {'code': 'no', 'label': 'No'},
                      {'code': 'yes', 'label': 'Yes'},
                    ],
                  },
                  {
                    'id': 'called',
                    'kind': 'text',
                    'label': 'Called at',
                    'lines': 'one',
                    'maxLength': 200,
                    'required': true,
                    'showWhen': {'field': 'ems.activated', 'is': 'yes'},
                  },
                ],
              },
            ],
          };
          server.noteTypes[('test_ems', 1)] = ems;
          final visit = visitOf(patientId: patient);
          server.finishNote(
            server.seed(entityNote, noteValue(visit, testRedFlags, const {'flags.any': 'no'}), by: alex),
          );
          final note = server.seed(
            entityNote,
            noteValue(visit, (key: 'test_ems', version: 1), const {'ems.activated': 'no'}),
            by: alex,
          );
          server.finishNote(note, status: 'signed');
          final alone = correction(alex, note, [answer('ems.activated', 'yes')]);
          final together = correction(alex, note, [
            answer('ems.activated', 'yes'),
            answer('ems.called', 'Demo: 14:20', 0),
          ]);
          expect(await send(alex, [alone, together]), [
            refusedWith(const {'problem': 'incomplete'}),
            corrected(together, 'corrected', 'signed', 'not_needed'),
          ]);
          expect(server.records[alone['recordId']], isNull);
          expect(server.records[note]!.fields['data.ems.called']!.value, 'Demo: 14:20');
        },
      );

      test(
        '2. a note reopened since is edited as a draft, by the draft rule; a declined request still changes nothing',
        () async {
          final note = finishedMedical(casey, 'completed', const {'care.plan': 'Demo: rest', 'vitals.pulse': 80});
          final reopen = setOn(entityNote, note, 'status', 'draft', 1);
          expect(await send(casey, [reopen]), [taken(reopen, 2)]);
          // Someone else's edit to the draft since the person looked.
          server.serverEdit(note, 'data.care.plan', 'Demo: rest and fluids', by: alex);
          final changes = [
            correction(casey, note, [answer('vitals.pulse', 84), answer('care.allergies', 'Demo: none known', 3)]),
            // The plan the person saw has changed since: never overwritten silently.
            correction(casey, note, [answer('care.plan', 'Demo: fluids')]),
            correction(casey, note, [answer('vitals.pulse', 90, 2)], requestedByPatient: true, declined: true),
            // A draft's answers are checked against its type, as any set of them is.
            correction(casey, note, [answer('vitals.pulse', 999, 2)]),
          ];
          expect(await send(casey, changes), [
            corrected(changes[0], 'draft_edit', 'draft', 'not_needed'),
            refusedWith(const {'problem': 'field_changed', 'field': 'data.care.plan'}),
            corrected(changes[2], 'declined', 'draft', 'not_needed'),
            refusedWith(const {'problem': 'out_of_range', 'field': 'data.vitals.pulse'}),
          ]);
          final fields = server.records[note]!.fields;
          expect(
            [
              for (final f in ['care.plan', 'vitals.pulse', 'care.allergies']) fields['data.$f']!.value,
            ],
            ['Demo: rest and fluids', 84, 'Demo: none known'],
          );
          // The person saw the pulse; the allergies were blank, so they fill.
          expect(
            [
              for (final h in server.history)
                if (h['changeId'] == changes[0]['changeId']) [h['field'], h['kind']],
            ],
            [
              ['data.vitals.pulse', 'set'],
              ['data.care.allergies', 'filled_blank'],
            ],
          );
        },
      );

      test('a draft edit to a Medical note is held by the gate as any set of it is', () async {
        server.credentials[blair] = 'pa';
        final note = server.seed(
          entityNote,
          noteValue(visitOf(patientId: patient, by: blair), testMedical, const {'care.plan': 'Demo: rest'}),
          by: blair,
        );
        server.changeCredential(blair, 'none');
        final fix = correction(blair, note, [answer('care.plan', 'Demo: fluids')]);
        expect(await send(blair, [fix]), [heldOnly(fix)]);
        expect(server.records[note]!.fields['data.care.plan']!.value, 'Demo: rest');
      });

      test('a correction that leaves a signed note completed moves its visit with it', () async {
        final visit = visitOf(patientId: patient);
        final flags = server.seed(entityNote, noteValue(visit, testRedFlags, const {'flags.any': 'no'}), by: alex);
        server.finishNote(flags, status: 'signed');
        final note = server.seed(
          entityNote,
          noteValue(visit, testMedical, const {'care.plan': 'Demo: rest'}),
          by: alex,
        );
        server.finishNote(note, status: 'signed');
        server.records[note]!
          ..signoffId = uuid()
          ..attestation = 'not_needed';
        expect(server.records[visit]!.status, 'signed');
        // Lowered to a student, whose correction leaves no signature (3.6).
        server.credentials[alex] = 'student';
        final fix = correction(alex, note, [answer('care.plan', 'Demo: rest, fluids and sleep')]);
        expect(await send(alex, [fix]), [corrected(fix, 'corrected', 'completed', 'not_needed')]);
        expect(server.records[visit]!.status, 'completed');
      });

      test('a draft edit leaves an answer it names unchanged as it is: no new version', () async {
        final note = server.seed(
          entityNote,
          noteValue(visitOf(patientId: patient), testNote, const {
            'care.plan': 'Demo: rest',
            'care.followup': 'Demo: Friday',
          }),
          by: alex,
        );
        final edit = correction(alex, note, [
          answer('care.plan', 'Demo: rest'),
          answer('care.followup', 'Demo: Monday'),
        ]);
        expect(await send(alex, [edit]), [corrected(edit, 'draft_edit', 'draft', 'not_needed')]);
        final fields = server.records[note]!.fields;
        expect([fields['data.care.plan']!.version, fields['data.care.followup']!.version], [1, 2]);
        expect(
          [
            for (final h in server.history)
              if (h['recordId'] == note && h['changeId'] == edit['changeId']) h['field'],
          ],
          ['data.care.followup'],
        );
      });

      test(
        'a sign-off or a correction sent under a record ID already taken is refused record_exists, and changes nothing',
        () async {
          final note = server.seed(
            entityNote,
            noteValue(visitOf(), testNote, const {'care.plan': 'Demo: rest'}),
            by: alex,
          );
          final signoff = change(entitySignoff, 'create', {
            'noteId': note,
            'act': 'complete',
            'contentHash': noteContentHash(
              noteId: note,
              encounterId: server.records[note]!.attributes['encounterId']! as String,
              patientId: null,
              summary: null,
              definition: NoteTypeDef.fromJson(server.noteTypes[(testNote.key, testNote.version)]!),
              answers: const {'care.plan': 'Demo: rest'},
            ),
            'claimedCredential': null,
            'statementVersion': 'complete-2026-11',
          });
          expect((await send(alex, [signoff])).single['details'], containsPair('effect', 'completed'));
          final good = correction(alex, note, [answer('care.plan', 'Demo: fluids')]);
          expect((await send(alex, [good])).single['details'], containsPair('outcome', 'corrected'));
          final reused = [
            change(entitySignoff, 'create', signoff['value'], recordId: signoff['recordId']! as String),
            correction(alex, note, [answer('care.plan', 'Demo: sleep', 2)], recordId: good['recordId']! as String),
          ];
          expect(await send(alex, reused), [for (final _ in reused) refused('record_exists')]);
          expect(server.records[note]!.fields['data.care.plan']!.value, 'Demo: fluids');
        },
      );

      test('a correction of a phase 2 note is read whole by a teammate', () async {
        // A phase 2 preview row: no version, so no definition to hide anything by.
        final note = server.seed(
          entityNote,
          noteValue(visitOf(patientId: patient), testNote, const {'care.plan': 'Demo: rest'}),
          by: alex,
        );
        server.records[note]!.attributes['noteTypeVersion'] = null;
        final edit = correction(alex, note, [answer('care.plan', 'Demo: fluids')]);
        expect((await send(alex, [edit])).single['details'], containsPair('outcome', 'draft_edit'));
        final read = await as(dana).fetchRecords(
          body: FetchRecords(
            records: [RecordRef(entity: RecordEntity.noteCorrection, id: edit['recordId']! as String)],
          ),
        );
        expect(read.records.map((r) => r.id), [edit['recordId']]);
      });

      test('needs encounters.chart, names a note the team holds, and waits behind its sign-off', () async {
        final note = server.seed(entityNote, noteValue(visitOf(patientId: patient), testNote, const {}), by: alex);
        // A community health worker charts nothing, so corrects nothing: held for review.
        server.permissions[dana] = FakeSyncServer.chw;
        final fromDana = correction(dana, note, [answer('care.plan', 'Demo: x', 0)]);
        expect(await send(dana, [fromDana]), [heldOnly(fromDana)]);
        expect(server.records[fromDana['recordId']], isNull);
        final missing = correction(alex, uuid(), [answer('care.plan', 'Demo: x', 0)]);
        final unknownSignoff = change(entityCorrection, 'create', {
          ...correction(alex, note, [answer('care.plan', 'Demo: x', 0)])['value']! as Map<String, Object?>,
          'signoffId': uuid(),
        });
        Matcher stale(String problem) => allOf(
          containsPair('status', 'rejected'),
          containsPair('reason', 'stale_reference'),
          containsPair('details', {'problem': problem}),
        );
        expect(await send(alex, [missing, unknownSignoff]), [
          stale('encounter_note_missing'),
          stale('note_signoff_missing'),
        ]);

        // A sign-off held by the gate holds the correction made behind it.
        final flags = server.seed(
          entityNote,
          noteValue(visitOf(patientId: patient, by: blair), testRedFlags, const {'flags.any': 'no'}),
          by: blair,
        );
        server.changeCredential(blair, 'chw');
        final signs = change(entitySignoff, 'create', {
          'noteId': flags,
          'act': 'sign',
          'contentHash': 'ab' * 32,
          'claimedCredential': 'resident',
          'statementVersion': 'sign-2026-11',
        });
        final behind = change(entityCorrection, 'create', {
          ...correction(blair, flags, [answer('flags.note', 'Demo: none', 0)])['value']! as Map<String, Object?>,
          'signoffId': signs['recordId'],
        });
        expect(await send(blair, [signs, behind]), [
          heldOnly(signs),
          {...heldOnly(behind), 'reason': 'awaiting_review', 'message': 'rejected: awaiting_review'},
        ]);
        expect(server.held[behind['changeId']]!.waitsOn, signs['changeId']);
      });

      test('adds no answer past the bound on a note’s answers; an answer it holds is corrected', () async {
        final note = server.seed(
          entityNote,
          noteValue(visitOf(by: dana), testNote, const {'care.plan': 'Demo: rest'}),
          by: dana,
        );
        server.finishNote(note);
        // As if the note held the most answers a note may: their versions are what the bound counts.
        server.records[note]!.fields.addAll({
          for (var i = 1; i <= maxNoteFields - 1; i++) 'data.extra.n$i': FakeField(null, 1, dana, null, null),
        });
        final adds = correction(dana, note, [answer('care.followup', 'Demo: clinic', 0)]);
        final fixes = correction(dana, note, [answer('care.plan', 'Demo: fluids')]);
        expect(await send(dana, [adds, fixes]), [
          refused('too_many_fields'),
          corrected(fixes, 'corrected', 'completed', 'not_needed'),
        ]);
      });

      test('a correction can hide an answer, which stays in the note and counts again once shown', () async {
        final note = server.seed(
          entityNote,
          noteValue(visitOf(by: dana), testNote, const {'more.detail': 'Demo: walks with a cane'}),
          by: dana,
        );
        server.finishNote(note);
        final hide = correction(dana, note, [answer('more.none', true, 0)]);
        expect(await send(dana, [hide]), [corrected(hide, 'corrected', 'completed', 'not_needed')]);
        Map<String, Object?> data() => {
          for (final MapEntry(:key, :value) in server.records[note]!.fields.entries)
            if (key.startsWith('data.')) key.substring(5): value.value,
        };
        final definition = NoteTypeDef.fromJson(testNoteTypes.first);
        expect(data(), {'more.detail': 'Demo: walks with a cane', 'more.none': true});
        expect(effectiveAnswers(definition, data()), {'more.none': true});
        final show = correction(dana, note, [answer('more.none', null)]);
        expect(await send(dana, [show]), [corrected(show, 'corrected', 'completed', 'not_needed')]);
        expect(effectiveAnswers(definition, data()), containsPair('more.detail', 'Demo: walks with a cane'));
      });

      test(
        'a phase 2 note with no version has no type to check a correction by: definition_error, and the queue goes on',
        () async {
          final note = server.seed(
            entityNote,
            noteValue(visitOf(by: dana), testNote, const {'care.plan': 'Demo: dress daily'}),
            by: dana,
          );
          server.finishNote(note);
          server.records[note]!.attributes['noteTypeVersion'] = null;
          final stuck = correction(dana, note, [answer('care.plan', 'Demo: soak first')]);
          final other = server.seed(
            entityNote,
            noteValue(visitOf(by: dana), testNote, const {'care.plan': 'Demo: rest'}),
            by: dana,
          );
          server.finishNote(other);
          final next = correction(dana, other, [answer('care.plan', 'Demo: fluids')]);
          expect(await send(dana, [stuck, next]), [
            refused('definition_error'),
            corrected(next, 'corrected', 'completed', 'not_needed'),
          ]);
        },
      );
    });

    // Rule 11: services/api/test/sync-referrals.test.ts. Casey and Dana are community health workers
    // (referrals.create, no encounters.chart); Blair is Billing/Data, who makes no referral.
    group('referrals (lifecycle 4.7)', () {
      late String patientA;
      late String patientB;
      // Merged into A: one person, two records.
      late String patientC;
      setUp(() {
        patientA = server.seedPatient(preferredName: 'Demo Ash');
        patientB = server.seedPatient(preferredName: 'Demo Birch');
        patientC = server.seedPatient(preferredName: 'Demo Ash two');
        server.merge(patientC, patientA);
        server.permissions
          ..[casey] = FakeSyncServer.chw
          ..[dana] = FakeSyncServer.chw
          ..[blair] = const {'patients.view', 'billing.view_codes', 'inventory.view'};
      });
      Map<String, Object?> referral(
        String patientId, {
        String referredOn = '2026-10-20',
        String details = 'Demo: dental clinic on Main St',
        String? encounterId,
      }) => change(entityReferral, 'create', {
        'patientId': patientId,
        'referredOn': referredOn,
        'details': details,
        'encounterId': encounterId,
      });
      Map<String, Object?> mark(String referralId, [String reason = 'Demo: made for the wrong person']) =>
          setOn(entityReferral, referralId, 'enteredInError', {'reason': reason}, 0);
      Matcher staleBecause(String problem) => allOf(
        containsPair('status', 'rejected'),
        containsPair('reason', 'stale_reference'),
        containsPair('details', {'problem': problem}),
      );

      test(
        'is made by anyone who may make one, a community health worker included, and logged without its details',
        () async {
          final made = referral(patientA);
          final answer = await send(casey, [made]);
          expect(answer, [taken(made, 1)]);
          final row = server.records[made['recordId']]!;
          expect([row.status, row.author, row.patientId], ['active', casey, patientA]);
          expect(row.attributes, {
            'patientId': patientA,
            'referredOn': '2026-10-20',
            'details': 'Demo: dental clinic on Main St',
            'encounterId': null,
            'recordedAt': now.toIso8601String(),
            'clockVerified': true,
          });
          // Sent again, it answers from its receipt.
          expect(await send(casey, [made]), answer);
          // Billing/Data holds no referrals.create: held for a Program Admin, nothing stored.
          final fromBlair = referral(patientA);
          expect(await send(blair, [fromBlair]), [heldOnly(fromBlair)]);
          expect(server.records[fromBlair['recordId']], isNull);
        },
      );

      test('its snapshot names who recorded it, by their name now, wherever it is read', () async {
        // A referral keeps no name of its own: the recorder's name now, as a note names who acts as
        // its author (D108; unit L6).
        server.names[casey] = 'Casey (demo)';
        final made = referral(patientA, details: 'Demo: food bank on 5th');
        expect(await send(casey, [made]), [taken(made, 1)]);
        Future<Object?> authorName() async => (await as(dana).fetchRecords(
          body: FetchRecords(
            records: [RecordRef(entity: RecordEntity.referral, id: made['recordId']! as String)],
          ),
        )).records.single.attributes['authorName'];
        expect(await authorName(), 'Casey (demo)');
        server.names[casey] = 'Casey Rowe (demo)';
        expect(await authorName(), 'Casey Rowe (demo)');
      });

      test('is dated no more than a day after the server’s date (referral_in_future)', () async {
        // The server's clock reads 2026-10-22.
        final changes = [
          referral(patientA, referredOn: '2026-10-23'),
          referral(patientA, referredOn: '2026-10-24'),
          referral(patientA, referredOn: '2025-01-31'),
          referral(patientA, referredOn: '2026-02-30'),
          referral(patientA, referredOn: '22 Oct 2026'),
        ];
        final answers = await send(casey, changes);
        expect(answers.sublist(0, 3), [taken(changes[0], 1), refused('referral_in_future'), taken(changes[2], 1)]);
        for (final a in answers.sublist(3)) {
          expect(a, refusedAt('referredOn'));
        }
        expect(server.records[changes[1]['recordId']], isNull);
      });

      test('names a visit of its patient’s merged group, or none; a visit of someone else is refused, and sent without it is taken', () async {
        final ofA = visitOf(patientId: patientA);
        final ofB = visitOf(patientId: patientB);
        final ofC = visitOf(patientId: patientC);
        final nobody = visitOf();
        final changes = [
          referral(patientA, encounterId: ofA),
          referral(patientA, encounterId: ofB),
          // One person, two records: either names the other's visit.
          referral(patientA, encounterId: ofC),
          referral(patientC, encounterId: ofA),
          // A visit with no patient names nobody else.
          referral(patientB, encounterId: nobody),
          referral(patientA, encounterId: uuid()),
          referral(uuid()),
        ];
        expect(
          [
            ...await send(alex, changes.sublist(0, 3)),
            ...await send(casey, changes.sublist(3, 5)),
            ...await send(alex, changes.sublist(5)),
          ],
          [
            taken(changes[0], 1),
            staleBecause('encounter_other_patient'),
            taken(changes[2], 1),
            taken(changes[3], 1),
            taken(changes[4], 1),
            staleBecause('encounter_missing'),
            staleBecause('patient_missing'),
          ],
        );
        expect(server.records[changes[1]['recordId']], isNull);
        // Send without the visit: the same record, with no visit, settles the refusal.
        final without = change(
          entityReferral,
          'create',
          {...changes[1]['value']! as Map<String, Object?>, 'encounterId': null},
          recordId: changes[1]['recordId']! as String,
          more: {'supersedes': changes[1]['changeId']},
        );
        expect(await send(alex, [without]), [taken(without, 1)]);
        expect(server.receipts[changes[1]['changeId']]!.resolved, isTrue);
      });

      test('is entered in error once, by its author or by anyone who charts; anyone else is held for review', () async {
        final caseys = referral(patientA);
        final danas = referral(patientA);
        final others = referral(patientA);
        await send(casey, [caseys]);
        await send(dana, [danas, others]);
        const reason = 'Demo: made for the wrong person';
        // Casey takes back her own; Alex charts, and takes back Dana's.
        final byAuthor = mark(caseys['recordId']! as String, reason);
        final byClinician = mark(danas['recordId']! as String);
        expect(await send(casey, [byAuthor]), [taken(byAuthor, 1)]);
        expect(await send(alex, [byClinician]), [taken(byClinician, 1)]);
        final row = server.records[caseys['recordId']]!;
        expect(
          [row.status, row.fields['enteredInError']!.value, row.fields['enteredInError']!.by],
          [
            'entered_in_error',
            {'reason': reason},
            casey,
          ],
        );
        expect(
          [
            for (final h in historyOf(caseys['recordId']! as String, 'enteredInError')) [h.$1, h.$2, h.$3],
          ],
          [
            [
              'entered_in_error',
              {'reason': reason},
              '1',
            ],
          ],
        );
        // Set once: a second mark is kept in history, and the first stands.
        final second = mark(caseys['recordId']! as String, 'Demo: second thoughts');
        expect(await send(alex, [second]), [
          {
            ...taken(second, 1),
            'server': {
              'value': {'reason': reason},
              'version': 1,
              'changedBy': casey,
              'changedAt': now.toIso8601String(),
            },
            'details': {'outcome': 'history_only'},
          },
        ]);
        // Casey did not make Dana's other referral and charts nothing: held for a Program Admin.
        final notHers = mark(others['recordId']! as String);
        expect(await send(casey, [notHers]), [heldOnly(notHers)]);
        expect(server.records[others['recordId']]!.status, 'active');
        expect(server.acceptHeld(notHers['changeId']! as String, by: admin)['status'], 'accepted');
        expect(server.records[others['recordId']]!.status, 'entered_in_error');
        // A mark never conflicts, so there is nothing to resolve.
        final resolved = setOn(
          entityReferral,
          caseys['recordId']! as String,
          'enteredInError',
          const {'reason': 'Demo: keep mine'},
          1,
          more: const {'resolution': 'replace'},
        );
        expect(await send(casey, [resolved]), [refused('nothing_to_resolve')]);
      });

      test('changes only by its mark, and its value is checked before anything is read', () async {
        final made = referral(patientA);
        await send(casey, [made]);
        final value = made['value']! as Map<String, Object?>;
        Map<String, Object?> bad(Map<String, Object?> v) => change(entityReferral, 'create', {...value, ...v});
        final changes = [
          setOn(entityReferral, made['recordId']! as String, 'details', 'Demo: another clinic', 0),
          bad({'details': 'Demo: trailing space '}),
          bad({'details': 'D' * 2001}),
          bad({'details': ''}),
          bad({'status': 'completed'}),
          change(entityReferral, 'create', {...value}..remove('encounterId')),
          mark(made['recordId']! as String, 'No'),
          setOn(entityReferral, made['recordId']! as String, 'enteredInError', null, 0),
        ];
        final answered = await send(casey, changes);
        expect(answered.first, refused('unknown_field'));
        expect(
          [
            for (final a in answered.sublist(1))
              ((a['details']! as Map)['problems']! as List).map((p) => (p as Map)['path']).toList(),
          ],
          [
            ['details'],
            ['details'],
            ['details'],
            [''],
            ['encounterId'],
            ['reason'],
            [''],
          ],
        );
        expect(server.records[made['recordId']]!.status, 'active');
        final longest = bad({'details': 'D' * 2000});
        expect(await send(casey, [longest]), [taken(longest, 1)]);
      });
    });

    // Rule 15: services/api/test/sync-encounters.test.ts, 'offline reads of a visit (lifecycle 4.8, 10.1)'.
    test(
      'the EMS handoff shown and the notes to finish are reads a phone logs offline, each naming its patients',
      () async {
        final p = server.seedPatient();
        final visit = visitOf(patientId: p);
        final others = [uuid(), uuid()];
        final shown = change(entityAudit, 'append', {
          'action': 'ems_handoff.shown',
          'entity': 'encounter',
          'entityId': visit,
          'patientId': p,
        });
        final listed = change(entityAudit, 'append', {
          'action': 'notes_to_finish.viewed',
          'patientIds': [p, ...others],
          'resultCount': 3,
        });
        // The export is the online route's (5.7): a phone never logs it.
        final exported = change(entityAudit, 'append', {
          'action': 'ems_handoff.exported',
          'entity': 'encounter',
          'entityId': visit,
          'patientId': p,
        });
        expect(await send(alex, [shown, listed, exported]), [taken(shown, 1), taken(listed, 1), refusedAt('action')]);
        expect(
          [
            for (final a in server.audit)
              [a['action'], a['entityId'], a['patientId'], a['patientIds'], a['resultCount'], a['userId']],
          ],
          [
            ['ems_handoff.shown', visit, p, null, null, alex],
            [
              'notes_to_finish.viewed',
              null,
              null,
              [p, ...others],
              3,
              alex,
            ],
          ],
        );
      },
    );

    // services/api/test/sync-encounters.test.ts, 'an allergy and a problem’s note made at a visit'.
    test('name a visit of their patient’s merged group or none, as a problem does', () async {
      final p = server.seedPatient(preferredName: 'Demo Robin');
      final other = server.seedPatient(preferredName: 'Demo Wren');
      final twin = server.seedPatient(preferredName: 'Demo Robin two');
      server.merge(twin, p);
      final [ofP, ofOther, ofTwin] = [visitOf(patientId: p), visitOf(patientId: other), visitOf(patientId: twin)];
      final problem = server.seed(entityProblem, {'patientId': p, 'title': 'Demo: cough', 'status': 'new'}, by: alex);
      Map<String, Object?> allergy(String? encounterId) =>
          change(entityAllergy, 'create', {'patientId': p, 'substance': 'Demo: latex', 'encounterId': encounterId});
      Map<String, Object?> note(String? encounterId) => change(entityProblemNote, 'create', {
        'problemId': problem,
        'text': 'Demo: better today',
        'encounterId': encounterId,
      });
      final changes = [
        allergy(ofP),
        allergy(ofOther),
        allergy(ofTwin),
        allergy(null),
        note(ofP),
        note(ofOther),
        note(ofTwin),
        note(null),
      ];
      const ok = ['accepted', null, null];
      const elsewhere = ['rejected', 'stale_reference', 'encounter_other_patient'];
      expect(
        [
          for (final r in await send(alex, changes))
            [r['status'], r['reason'], (r['details'] as Map<String, Object?>?)?['problem']],
        ],
        [ok, elsewhere, ok, ok, ok, elsewhere, ok, ok],
      );
      expect([server.records[changes[1]['recordId']], server.records[changes[5]['recordId']]], [null, null]);
    });

    // services/api/test/sync-encounters.test.ts, 'a problem made at a visit (lifecycle 8.3, 4.7)'.
    test('is marked as made at a visit, and names a visit of its patient’s merged group or none', () async {
      final p = server.seedPatient(preferredName: 'Demo Rowan');
      final other = server.seedPatient(preferredName: 'Demo Sage');
      // One person, two records: a visit of either is a visit of the person.
      final twin = server.seedPatient(preferredName: 'Demo Rowan two');
      server.merge(twin, p);
      final [ofP, ofOther, ofTwin] = [visitOf(patientId: p), visitOf(patientId: other), visitOf(patientId: twin)];
      final nobody = visitOf();
      Map<String, Object?> problem([Object? encounterId = #none]) => change(entityProblem, 'create', {
        'patientId': p,
        'title': 'Demo: cellulitis, left shin',
        'status': 'new',
        if (encounterId != #none) 'encounterId': encounterId,
      });
      final changes = [problem(ofP), problem(), problem(null), problem(ofOther), problem(ofTwin), problem(nobody)];
      final answers = await send(alex, changes);
      expect(
        [
          for (final r in answers)
            [r['status'], r['reason'], (r['details'] as Map<String, Object?>?)?['problem'], r['quarantined']],
        ],
        [
          ['accepted', null, null, null],
          ['accepted', null, null, null],
          ['accepted', null, null, null],
          ['rejected', 'stale_reference', 'encounter_other_patient', null],
          ['accepted', null, null, null],
          ['accepted', null, null, null],
        ],
      );
      expect(
        [
          for (final c in changes)
            [
              server.records[c['recordId']]?.attributes['source'],
              server.records[c['recordId']]?.attributes['createdEncounterId'],
            ],
        ],
        [
          ['encounter', ofP],
          ['manual', null],
          ['manual', null],
          [null, null],
          ['encounter', ofTwin],
          ['encounter', nobody],
        ],
      );
      // Send without the visit (8.4): the same record with no visit settles the refusal.
      final without = change(
        entityProblem,
        'create',
        {...changes[3]['value']! as Map<String, Object?>, 'encounterId': null},
        recordId: changes[3]['recordId']! as String,
        more: {'supersedes': changes[3]['changeId']},
      );
      expect(await send(alex, [without]), [taken(without, 1)]);
      expect(server.records[without['recordId']]!.attributes['source'], 'manual');
      // The sync read shows a problem as its chart does (problem.ts load).
      final synced = (await as(alex).fetchRecords(
        body: FetchRecords(
          records: [RecordRef(entity: RecordEntity.fromJson(entityProblem), id: changes[0]['recordId']! as String)],
        ),
      )).records.single;
      expect([synced.attributes['source'], synced.attributes['createdEncounterId']], ['encounter', ofP]);
      expect(synced.attributes.keys.toSet(), {
        'patientId',
        'title',
        'code',
        'sensitive',
        'source',
        'createdEncounterId',
        'onsetDate',
        'recurrenceOf',
        'resolvedInErrorOf',
        'reversalRequest',
        'mergedInto',
        'statusChangedAt',
        'statusCheckedAt',
      });
      final chart = await as(alex).getPatient(patientId: p);
      expect(
        [
          for (final r in chart.problems!)
            if (r.id == changes[0]['recordId']) [r.attributes['source'], r.attributes['createdEncounterId']],
        ],
        [
          ['encounter', ofP],
        ],
      );
    });

    // Rule 17: the second table of lifecycle 4.1, row by row, on one visit. Each row's API test has its
    // own case above: 'a status of completed is kept in history...', 'kind goes to Medical from any
    // version...', 'a patient is never taken off a visit', 'a sign-off from someone who does not act as
    // the author...', 'keeps the rest in history: ... someone else’s reopen', '1. whoever does not act
    // as the author is told...', 'a Non-Medical note is completed: ...' and '2. a note reopened since
    // is edited as a draft...'. services/api/test/sync-corrections.test.ts walks the same rows under
    // this case's name (review finding FAK-7).
    test('what is accepted with no effect, in place of a refusal: each row of the second table of 4.1', () async {
      server.noteTypes[(testRedFlags.key, testRedFlags.version)] = redFlagsNoteType;
      final p = server.seedPatient();
      final visit = visitOf(patientId: p);
      final medical = noteOn(visit, type: testMedical);
      final social = noteOn(visit);
      final waiting = noteOn(visit, type: testMedical);
      server.finishNote(waiting);
      final finished = noteOn(visit, type: testMedical);
      server.finishNote(finished, status: 'signed');
      String hashOf(String note) => noteContentHash(
        noteId: note,
        encounterId: visit,
        patientId: p,
        summary: null,
        definition: NoteTypeDef.fromJson(server.noteTypes[(testMedical.key, 1)]!),
        answers: const {'care.plan': 'Demo: rest and fluids'},
      );
      Map<String, Object?> signoff(String note, String act, {String type = 'test_medical'}) =>
          change(entitySignoff, 'create', {
            'noteId': note,
            'act': act,
            'contentHash': type == 'test_medical'
                ? hashOf(note)
                : noteContentHash(
                    noteId: note,
                    encounterId: visit,
                    patientId: p,
                    summary: null,
                    definition: NoteTypeDef.fromJson(testNoteTypes.first),
                    answers: const {'care.plan': 'Demo: rest and fluids'},
                  ),
            'claimedCredential': null,
            'statementVersion': '$act-2026-11',
          });
      Map<String, Object?> correction(String note, {bool declined = false}) => change(entityCorrection, 'create', {
        'noteId': note,
        'changes': [
          {'field': 'data.care.plan', 'newValue': 'Demo: fluids', 'baseVersion': 1},
        ],
        'reason': 'Demo: the wrong field was picked',
        'requestedByPatient': declined,
        'declined': declined,
        'claimedCredential': null,
        'signoffId': null,
      });

      final rows = <(String, Map<String, Object?>, Object)>[
        // A set of a note's status to completed (an old build): kept in history.
        (
          'alex',
          setOn(entityNote, medical, 'status', 'completed', 1),
          containsPair('details', {'outcome': 'history_only', 'problem': 'use_signoff'}),
        ),
        // The kind back to Non-Medical, a patient taken off: kept in history.
        (
          'alex',
          setOn(entityEncounter, visit, 'kind', 'non_medical', 1),
          containsPair('details', {'outcome': 'history_only', 'problem': 'kind_cannot_go_back'}),
        ),
        (
          'alex',
          setOn(entityEncounter, visit, 'patientId', null, 1),
          containsPair('details', {'outcome': 'history_only', 'problem': 'patient_cannot_be_removed'}),
        ),
        // A sign-off, a reopen or a correction from someone who does not act as the author: stored
        // with no effect, and the sender told.
        ('blair', signoff(medical, 'sign'), containsPair('details', containsPair('reason', 'not_author'))),
        (
          'blair',
          setOn(entityNote, waiting, 'status', 'draft', 1),
          containsPair('details', {'outcome': 'history_only', 'problem': 'not_author'}),
        ),
        ('blair', correction(finished), containsPair('details', containsPair('outcome', 'not_author'))),
        // `sign` on a Non-Medical note is a `complete`.
        (
          'alex',
          signoff(social, 'sign', type: 'test_note'),
          containsPair('details', containsPair('effect', 'completed')),
        ),
        // A correction to a note that is a draft is an edit to the draft.
        ('alex', correction(medical), containsPair('details', containsPair('outcome', 'draft_edit'))),
      ];
      for (final (who, c, expected) in rows) {
        final answered = await send(who == 'alex' ? alex : blair, [c]);
        expect(answered, [
          allOf(containsPair('status', 'accepted'), expected),
        ], reason: '${c['entity']} ${c['field'] ?? c['op']}');
      }
      expect(
        [for (final n in server.notices) '${n.userId == blair ? 'blair' : 'alex'} ${n.kind}'],
        ['blair change_not_applied', 'blair change_not_applied', 'blair change_not_applied'],
      );
      expect(server.records[medical]!.fields['data.care.plan']!.value, 'Demo: fluids');
      expect(server.records[social]!.fields['status']!.value, 'completed');
    });

    test('the encounter’s status follows its notes', () async {
      final vectors = jsonDecode(
        File('../../packages/contract/test-vectors/note-lifecycle.json').readAsStringSync(),
      ) as Map<String, Object?>;
      final cases = ((vectors['cases']! as Map<String, Object?>)['encounterStatus']! as List<Object?>)
          .cast<Map<String, Object?>>();
      expect(cases.length, greaterThanOrEqualTo(19));
      final patient = server.seedPatient();
      for (final c in cases) {
        final id = visitOf(patientId: patient);
        for (final shape in (c['input']! as List<Object?>).cast<Map<String, Object?>>()) {
          final note = server.seed(
            entityNote,
            noteValue(
              id,
              shape['medical'] == true ? testMedical : testNote,
              shape['empty'] == true ? const {'care.plan': ''} : const {'care.plan': 'Demo: dressing changed'},
            ),
          );
          if (shape['status'] != 'draft') server.finishNote(note, status: shape['status']! as String);
        }
        expect((await read(entityEncounter, id)).status, c['expected'], reason: c['name']! as String);
      }

      // Its first real answer makes an empty draft count; blanked again, it is out of the way.
      final id = visitOf(patientId: patient);
      server.finishNote(noteOn(id));
      final picked = server.seed(entityNote, noteValue(id, testNote, const {'care.plan': ''}), by: alex);
      expect((await read(entityEncounter, id)).status, 'completed');
      expect(await send(alex, [setOn(entityNote, picked, 'data.care.plan', 'Demo: one answer', 1)]), hasLength(1));
      expect((await read(entityEncounter, id)).status, 'draft');
      await send(alex, [setOn(entityNote, picked, 'data.care.plan', '', 2)]);
      expect((await read(entityEncounter, id)).status, 'completed');
    });
  });

  test('notices are the newest 100, newest first', () async {
    for (var i = 0; i < 105; i++) {
      server.notices.add(
        FakeNotice(
          uuid(),
          alex,
          'conflict_resolved',
          entityEncounter,
          uuid(),
          now.add(Duration(minutes: i * 37 % 105)),
        ),
      );
    }
    server.notices.add(FakeNotice(uuid(), blair, 'conflict_resolved', entityEncounter, uuid(), now));
    final shown = await as(alex).listNotices();
    expect(shown, hasLength(FakeSyncServer.noticeLimit));
    final times = [for (final n in shown) n.createdAt];
    expect(times, [...times]..sort((a, b) => b.compareTo(a)));
    expect([times.first, times.last], [now.add(const Duration(minutes: 104)), now.add(const Duration(minutes: 5))]);
  });
}
