import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/sync/canonical_json.dart';
import 'package:sineobex_field/sync/entities.dart';

import 'fake_server.dart';

/// Where the fake used to answer differently from the API (review finding P8), each pinned to what
/// services/api does: notices (patients/id-links.ts, sync/entities/fields.ts, sync/review.ts), the
/// push (sync/push.ts, sync/apply.ts) and the sync read (routes/sync.ts, sync/review.ts).
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
