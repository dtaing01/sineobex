import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/sync/canonical_json.dart';
import 'package:sineobex_field/sync/entities.dart';

import 'fake_server.dart';
import 'test_note_types.dart';

/// Where the fake used to answer differently from the API (review finding P8), each pinned to what
/// services/api does: notices (patients/id-links.ts, sync/entities/fields.ts, sync/review.ts), the
/// push (sync/push.ts, sync/apply.ts) and the sync read (routes/sync.ts, sync/review.ts). Phase 4's
/// rules (lifecycle 4.9) follow, each case named after the API test that holds the same rule.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  const casey = 'c0000000-0000-4000-8000-00000000000c';
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

  // Phase 4, lifecycle 4.9 rules 1 to 6 and 13. Each case has the name of the API test that holds
  // the same rule (services/api/test/sync-encounters.test.ts; rule 13's is
  // db/test/encounter-lifecycle.test.ts) and expects what that test expects of the API.
  group('phase 4: the encounter and its notes', () {
    setUp(() async {
      for (final user in [alex, blair, casey]) {
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
        expect(snapshot.attributes.keys.toList()..sort(), ['clockVerified', 'startedAt', 'startedDeviceTime']);
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
          expect(told(id), [for (final _ in changes) '$blair late_change_kept']);
          expect(server.notices.every((n) => n.entity == entityEncounter), isTrue);

          // Sent twice, it answers the same, and nothing more is kept or told.
          expect(await send(blair, changes), answered);
          expect(told(id), hasLength(changes.length));
        },
      );

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
