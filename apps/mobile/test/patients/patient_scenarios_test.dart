import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show FetchChartsReason;
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/patients/consent_script.dart';
import 'package:sineobex_field/patients/display.dart';
import 'package:sineobex_field/patients/dob.dart';
import 'package:sineobex_field/patients/id_link_token.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/patient_repository.dart';
import 'package:sineobex_field/patients/patient_search.dart';
import 'package:sineobex_field/patients/team_index.dart';
import 'package:sineobex_field/sync/clock.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// Times out any chart answer larger than [maxBytes] (a weak uplink, after the server did its work).
class _Weak implements ApiTransport {
  _Weak(this.inner);
  final ApiTransport inner;
  int? maxBytes;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    final result = await inner.send(method, path, query: query, body: body);
    final limit = maxBytes;
    if (limit != null && path == '/v1/patients/charts' && utf8.encode(jsonEncode(result)).length > limit) {
      throw const NetworkException('timeout');
    }
    return result;
  }
}

/// One phone with its patient services, on a link the test can weaken.
class _Phone {
  _Phone(FakeSyncServer server, this.userId, this.team, DateTime start, {List<String>? permissions})
    : permissions = permissions ?? FakeSyncServer.healthcareStaff.toList(),
      link = _Weak(server.transportFor(userId, team)) {
    phone = TestPhone(userId: userId, teamId: team, transport: () => link, wall: start);
    attach();
  }

  final String userId;
  final String team;
  final List<String> permissions;
  final _Weak link;
  late final TestPhone phone;
  late PatientServices services;

  LocalStore get store => phone.store;

  void attach() {
    services = PatientServices(
      OpenTeam(
        userId: userId,
        teamId: team,
        store: phone.store,
        api: phone.engine.api,
        clock: phone.clock,
        permissions: permissions,
      ),
      idLinkBaseUrl: 'http://localhost:3100',
      copy: (_) async => true,
      wallNow: () => phone.wall,
    );
    phone.engine.refreshers.addAll(services.refreshers);
  }

  Future<void> restart() async {
    await phone.restart();
    attach();
  }
}

/// The patient scenarios of design 13.6 against the in-memory server; the starred ones also run
/// against the real API in live_patients_test.dart.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  final start = DateTime.utc(2026, 10, 22, 15);

  late DateTime serverTime;
  late FakeSyncServer server;
  final phones = <_Phone>[];

  _Phone phone(String user, {List<String>? permissions}) {
    final p = _Phone(server, user, team, start, permissions: permissions);
    phones.add(p);
    return p;
  }

  setUp(() {
    serverTime = start;
    server = FakeSyncServer(now: () => serverTime);
  });

  /// Time passes for everyone: every phone's clock and the server's move together.
  void advance(Duration d) {
    for (final p in phones) {
      p.phone.advance(d);
    }
    serverTime = serverTime.add(d);
  }

  /// A sync, and the refreshers after it (the after-sync check runs at most every 2 minutes, so
  /// time moves on first).
  Future<void> syncAndRefresh(_Phone p) async {
    advance(const Duration(minutes: 3));
    await p.phone.engine.syncAll(force: true);
  }

  tearDown(() {
    for (final p in phones) {
      p.phone.close();
    }
    phones.clear();
  });

  Intake intake(String preferred, {String? given, Birth? birth, List<String> aliases = const []}) => Intake(
    consent: const ConsentAnswer.given(),
    preferredName: preferred,
    legalGiven: given,
    birth: birth,
    aliases: aliases,
  );

  test('★2 two phones register the same person offline: one pair, and both indexes show the hint', () async {
    final a = phone(alex), b = phone(blair);
    await syncAndRefresh(a);
    await syncAndRefresh(b);
    server.offline = true;
    const born = BirthDate(1971, 4, 9);
    final pa = a.services.patients.createPatient(intake('Rio', given: 'Ramon', birth: born)).patientId;
    final pb = b.services.patients.createPatient(intake('Rio', given: 'Ramon', birth: born)).patientId;
    server.offline = false;
    await syncAndRefresh(a);
    await syncAndRefresh(b);
    expect(a.store.outbox(), isEmpty);
    expect(b.store.outbox(), isEmpty);
    expect(server.pairs.where((p) => {p.a, p.b}.containsAll([pa, pb])), hasLength(1));
    // The second phone was never shown the first patient, so it is told.
    expect(b.store.notices().where((n) => n.kind == noticePossibleDuplicate).single.patientId, pb);
    await syncAndRefresh(a);
    for (final p in [a, b]) {
      expect(p.services.index.entry(pa)!.duplicate?.status.wire, 'open');
      expect(p.services.index.entry(pb)!.duplicate?.status.wire, 'open');
      expect(p.services.search.searchOnPhone('Rio').hits.every((h) => h.possibleDuplicate), isTrue);
    }
  });

  test('★3 two phones edit Usually found offline: both confirm, one review, nothing to fix', () async {
    final a = phone(alex), b = phone(blair);
    final p = server.seedPatient(preferredName: 'Del', usualArea: 'Demo: pier');
    await a.services.patients.open(p);
    await b.services.patients.open(p);
    server.offline = true;
    a.services.patients.update(p, {'usualArea': 'Demo: library steps'});
    b.services.patients.update(p, {'usualArea': 'Demo: bus depot'});
    server.offline = false;
    await syncAndRefresh(a);
    await syncAndRefresh(b);
    expect([a.store.outbox(), b.store.outbox()], [isEmpty, isEmpty]);
    expect([a.store.needsAttention(), b.store.needsAttention()], [isEmpty, isEmpty]);
    expect(server.reviews.values.where((r) => r.status == 'open' && r.field == 'usualArea'), hasLength(1));
    expect(b.store.notices().where((n) => n.kind == noticeKeptBoth), hasLength(1));
    // Each phone's chart says two values were recorded once it is downloaded again.
    await b.services.patients.open(p);
    expect(b.services.patients.read(p)!.reviewFields, ['usualArea']);
  });

  test('★4 a merge while a phone works offline on the merged patient, then the undo', () async {
    final a = phone(alex);
    final kept = server.seedPatient(preferredName: 'Del');
    final merged = server.seedPatient(preferredName: 'Delly', usualArea: 'Demo: pier');
    await syncAndRefresh(a);
    await a.services.patients.open(merged);
    server.offline = true;
    a.services.patients.addAlias(merged, 'Dee');
    a.services.patients.addAllergy(merged, const NewAllergy(substance: 'latex', category: 'environment'));
    a.services.patients.update(merged, {'usualArea': 'Demo: library steps'});
    final mergeId = server.merge(merged, kept);
    server.offline = false;
    await a.phone.engine.syncAll(force: true);
    expect(a.store.outbox(), isEmpty);
    expect(a.store.redirects()[merged]?.survivorId, kept);
    // The set went to the kept chart; the street name and allergy are stored as sent.
    expect(server.records[kept]!.fields['usualArea']!.value, 'Demo: library steps');
    await syncAndRefresh(a);
    expect(a.store.redirects()[merged]!.origin, 'index');
    final view = (await a.services.patients.open(merged))!;
    expect([view.canonicalId, view.mergedInto?.survivorId], [kept, kept]);
    expect(view.aliases.map((x) => x.alias), contains('Dee'));
    expect(view.allergies.map((x) => x.substance), contains('latex'));

    server.undoMerge(mergeId);
    await syncAndRefresh(a);
    expect(a.store.redirects().containsKey(merged), isFalse);
    server.offline = true;
    final hits = a.services.search.searchOnPhone('Delly').hits;
    expect(hits.first.patientId, merged);
    a.services.patients.addAlias(merged, 'Delly Bee');
    final create = a.store.outbox().lastWhere((e) => e.entity == entityAlias);
    expect((create.value! as Map<String, Object?>)['patientId'], merged);
    server.offline = false;
    await a.phone.engine.syncAll(force: true);
    expect(server.records[create.recordId]!.patientId, merged);
  });

  test('6 a problem resolved elsewhere and set Ongoing here later: the conflict card’s choices', () async {
    final a = phone(alex), b = phone(blair);
    final p = server.seedPatient(preferredName: 'Del');
    final burn = server.seed(entityProblem, {'patientId': p, 'title': 'Demo: burn, left forearm', 'status': 'new'});
    final cough = server.seed(entityProblem, {'patientId': p, 'title': 'Demo: cough', 'status': 'new'});
    await a.services.patients.open(p);
    await b.services.patients.open(p);
    a.services.problems
      ..move(burn, 'resolved')
      ..move(cough, 'resolved');
    await a.phone.engine.syncAll(force: true);
    server.offline = true;
    advance(const Duration(minutes: 30));
    b.services.problems
      ..move(burn, 'ongoing')
      ..move(cough, 'ongoing');
    server.offline = false;
    await b.phone.engine.syncAll(force: true);
    final cards = {for (final e in b.store.needsAttention()) e.recordId: e};
    expect(cards.keys.toSet(), {burn, cough});
    final again = b.services.problems.keepServerAndAdd(cards[burn]!.changeId, cameBack: true)!;
    final request = b.services.problems.keepServerAndAdd(cards[cough]!.changeId, cameBack: false)!;
    expect(b.store.needsAttention(), isEmpty);
    await b.phone.engine.syncAll(force: true);
    expect(b.store.outbox(), isEmpty);
    expect(server.records[again]!.attributes['recurrenceOf'], burn);
    expect(server.records[request]!.attributes['resolvedInErrorOf'], cough);
    expect(server.records[burn]!.fields['status']!.value, containsPair('status', 'resolved'));
    // Moving it back is refused on the phone, as the server would.
    expect(
      () => b.services.problems.move(burn, 'ongoing'),
      throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'resolved_needs_admin')),
    );
  });

  test('Still ongoing reaches the server as an observation; not while the clock is off', () async {
    final a = phone(alex);
    final p = server.seedPatient(preferredName: 'Del');
    final problem = server.seed(entityProblem, {'patientId': p, 'title': 'Demo: cough', 'status': 'ongoing'});
    await a.services.patients.open(p);
    await a.phone.engine.syncAll(force: true);
    a.services.problems.confirmStatus(problem);
    final sent = a.store.outbox().single;
    expect(
      [sent.entity, sent.field, sent.value],
      [
        entityProblem,
        'status',
        {'status': 'ongoing', 'encounterId': null},
      ],
    );
    final before = server.records[problem]!.fields['status']!.version;
    await a.phone.engine.syncAll(force: true);
    expect(a.store.outbox(), isEmpty);
    expect(server.records[problem]!.fields['status']!.version, before + 1);
    a.phone.wall = a.phone.wall.add(const Duration(minutes: 7));
    await a.phone.clock.check();
    expect(a.phone.clock.status.state, ClockState.off);
    expect(() => a.services.problems.confirmStatus(problem), throwsA(isA<ChartingPaused>()));
    expect(a.store.outbox(), isEmpty);
  });

  test('7 an intake offline, the app killed mid-sync, reconnecting slowly: each change confirmed once', () async {
    final a = phone(alex);
    await syncAndRefresh(a);
    server.offline = true;
    final created = a.services.patients.createPatient(
      const Intake(
        consent: ConsentAnswer.given(),
        preferredName: 'Rio',
        aliases: ['Ri', 'Rio Grande'],
        allergies: [NewAllergy(substance: 'penicillin', severity: 'severe')],
        idCard: IdCardAnswer.wants,
      ),
    );
    expect(created.cardId, isNotNull);
    final before = [for (final e in a.store.outbox()) e.changeId];
    server
      ..offline = false
      ..dropPushResponses = 1;
    expect(await a.phone.engine.syncAll(force: true), isA<SyncOffline>());
    await a.restart();
    expect([for (final e in a.store.outbox()) e.changeId], before);
    await a.phone.engine.syncAll(force: true);
    expect(a.store.outbox(), isEmpty);
    final p = created.patientId;
    expect(server.records.values.where((r) => r.entity == entityPatient && r.id == p), hasLength(1));
    expect(server.records.values.where((r) => r.entity == entityAlias && r.patientId == p), hasLength(2));
    expect(server.idLinks[created.cardId]!.status, 'active');
    expect(a.services.idLinks.workingCards(p).single.state.name, 'active');
  });

  test('8 a week offline: the index goes; search still covers kept charts and local work', () async {
    final a = phone(alex);
    final opened = server.seedPatient(preferredName: 'Ada Demo');
    final worked = server.seedPatient(preferredName: 'Bo Demo');
    await syncAndRefresh(a);
    await a.services.patients.open(opened);
    await a.services.patients.open(worked);
    server.offline = true;
    a.services.patients.addAlias(worked, 'Bobo');
    final made = a.services.patients.createPatient(intake('Cy Demo')).patientId;
    advance(const Duration(days: 7, minutes: 1));
    final hits = {for (final h in a.services.search.searchOnPhone('Demo').hits) h.patientId};
    expect(a.services.index.state.removed, IndexRemoval.expired);
    expect(hits, {worked, made});
    expect(a.store.record(opened), isNull);
  });

  test('9 sign-out clears server copies and keeps work; a chart kept by work stays findable', () async {
    final a = phone(alex);
    final opened = server.seedPatient(preferredName: 'Ada Demo');
    final worked = server.seedPatient(preferredName: 'Bo Demo');
    server.seed(entityIdLink, {
      'patientId': opened,
      'token': newIdLinkToken(),
      'replacesLinkId': null,
      'reason': 'first_card',
    });
    await syncAndRefresh(a);
    await a.services.patients.open(opened);
    await a.services.patients.open(worked);
    server.offline = true;
    a.services.patients.addAlias(worked, 'Bobo');
    final outbox = [for (final e in a.store.outbox()) e.changeId];
    a.store.clearServerData();
    expect(a.store.database.select('SELECT 1 FROM team_index'), isEmpty);
    expect(a.store.database.select('SELECT 1 FROM id_links WHERE patient_id = ?', [opened]), isEmpty);
    expect(a.store.record(opened), isNull);
    expect([for (final e in a.store.outbox()) e.changeId], outbox);
    expect(a.services.search.searchOnPhone('Bo Demo').hits.single.patientId, worked);
    expect(a.services.search.searchOnPhone('Ada Demo').hits.where((h) => h.patientId == opened), isEmpty);
  });

  test('10 registering without patients.edit: held for review with what follows, accepted in order', () async {
    final a = phone(alex);
    await syncAndRefresh(a);
    server.permissions[alex] = {'patients.view', 'checkins.create'};
    final p = a.services.patients.createPatient(intake('Rio', aliases: ['Ri', 'Rio Grande'])).patientId;
    await a.phone.engine.syncAll(force: true);
    expect(a.store.outbox(), isEmpty);
    expect(a.store.inReviewCount(), 3);
    final held = [
      for (final MapEntry(:key, :value) in server.quarantine.entries)
        (id: key, entity: value['entity'], seq: value['seq']! as int),
    ]..sort((x, y) => x.seq.compareTo(y.seq));
    expect(held.map((h) => h.entity), [entityPatient, entityAlias, entityAlias]);
    for (final h in held) {
      expect(server.acceptHeld(h.id)['status'], 'accepted');
    }
    expect(server.records[p]!.status, 'active');
    expect(server.records.values.where((r) => r.entity == entityAlias && r.patientId == p), hasLength(2));
  });

  test('★11 two phones each clear a different recognisable field: one is kept, nothing to fix', () async {
    final a = phone(alex), b = phone(blair);
    final p = server.seedPatient(preferredName: 'Del', visualDescriptor: 'Demo: red cap');
    await a.services.patients.open(p);
    await b.services.patients.open(p);
    server.offline = true;
    a.services.patients.update(p, {'preferredName': null});
    b.services.patients.update(p, {'visualDescriptor': null});
    server.offline = false;
    await syncAndRefresh(a);
    await syncAndRefresh(b);
    expect([a.store.outbox(), b.store.outbox()], [isEmpty, isEmpty]);
    expect([a.store.needsAttention(), b.store.needsAttention()], [isEmpty, isEmpty]);
    expect(b.store.notices().where((n) => n.kind == noticeNothingToRecognise), hasLength(1));
    final fields = server.records[p]!.fields;
    expect(fields['visualDescriptor']!.value, 'Demo: red cap');
    expect(b.services.patients.read(p)!.visualDescriptor, 'Demo: red cap');
  });

  for (final allergyFirst in [false, true]) {
    test(
      '★12 no known allergies and an allergy from two phones (${allergyFirst ? 'allergy first' : 'allergy second'})',
      () async {
        final a = phone(alex), b = phone(blair);
        final p = server.seedPatient(preferredName: 'Del');
        await a.services.patients.open(p);
        await b.services.patients.open(p);
        server.offline = true;
        a.services.patients.update(p, {'allergyScreen': 'none_known'});
        b.services.patients.addAllergy(p, const NewAllergy(substance: 'penicillin', severity: 'severe'));
        server.offline = false;
        for (final x in allergyFirst ? [b, a] : [a, b]) {
          await syncAndRefresh(x);
        }
        for (final x in [a, b]) {
          await syncAndRefresh(x);
        }
        for (final x in [a, b]) {
          expect(x.store.needsAttention(), isEmpty);
          await x.services.patients.open(p);
          expect(x.services.patients.read(p)!.badge.kind, AllergyBadgeKind.allergies);
          expect(x.services.index.entry(p)!.allergies.single.substance, 'penicillin');
        }
        if (!allergyFirst) expect(server.records[p]!.fields['allergyScreen']!.value, 'not_asked');
      },
    );
  }

  test('13 a problem marked entered in error online while a phone resolves it and adds a note', () async {
    final a = phone(alex);
    final p = server.seedPatient(preferredName: 'Del');
    final problem = server.seed(entityProblem, {'patientId': p, 'title': 'Demo: cough', 'status': 'new'});
    await a.services.patients.open(p);
    server.offline = true;
    a.services.problems.move(problem, 'resolved');
    final note = a.services.problems.addNote(problem, 'Demo: cleared up');
    server.serverEdit(problem, 'enteredInError', {'reason': 'Demo: wrong patient'}, by: blair);
    server.offline = false;
    await a.phone.engine.syncAll(force: true);
    expect([a.store.outbox(), a.store.needsAttention()], [isEmpty, isEmpty]);
    expect(a.store.notices().where((n) => n.kind == noticeProblemRetracted), hasLength(1));
    expect(server.records[note]!.attributes['problemId'], problem);
    await a.services.patients.open(p);
    expect(a.services.problems.problemsOf(p), isEmpty);
    final retracted = a.services.problems.problemsOf(p, includeRetracted: true)!.single;
    expect(retracted.enteredInError, 'Demo: wrong patient');
    expect(retracted.notes.map((n) => n.text), contains('Demo: cleared up'));
  });

  test('14 weak signal: 30 charts with notes refresh over an uplink that drops big answers', () async {
    final a = phone(alex);
    final ids = <String>[];
    for (var i = 0; i < 30; i++) {
      final p = server.seedPatient(preferredName: 'Demo $i');
      final problem = server.seed(entityProblem, {'patientId': p, 'title': 'Demo: wound $i', 'status': 'new'});
      for (var n = 0; n < 2; n++) {
        server.seed(entityProblemNote, {'problemId': problem, 'text': 'Demo note $n ${'x' * 1500}'});
      }
      ids.add(p);
    }
    a.link.maxBytes = 40 * 1024;
    final got = await a.services.charts.fetch(ids, reason: FetchChartsReason.refresh);
    expect(got.imported, ids.toSet());
    expect(got.failed, isEmpty);
    expect(server.chartRequests.first, 10);
    expect(server.chartRequests.where((n) => n == 10).length, lessThan(server.chartRequests.length));
  });

  test('15 a field role loses its field permissions: the next index request clears the phone', () async {
    final a = phone(alex, permissions: FakeSyncServer.chw.toList());
    server.permissions[alex] = FakeSyncServer.chw;
    final opened = server.seedPatient(preferredName: 'Ada Demo');
    final worked = server.seedPatient(preferredName: 'Bo Demo');
    await syncAndRefresh(a);
    await a.services.patients.open(opened);
    await a.services.patients.open(worked);
    // The edit form is open on one chart: work in progress keeps it.
    a.services.patients.startEditing(worked);
    server.permissions[alex] = {'patients.view'};
    await syncAndRefresh(a);
    expect(a.services.index.state.removed, IndexRemoval.notPermitted);
    expect(a.store.database.select("SELECT 1 FROM patient_names WHERE origin = 'index'"), isEmpty);
    expect(a.store.record(opened), isNull);
    expect(a.store.record(worked), isNotNull);
  });

  test('a frozen store asks the server nothing: no search, no check (D21)', () async {
    final a = phone(alex);
    server.seedPatient(preferredName: 'Del');
    await syncAndRefresh(a);
    a.store.freeze('Your access to this team ended.');
    await expectLater(a.services.search.search('Del'), throwsA(isA<ChartingPaused>()));
    await expectLater(
      a.services.search.checkMatches(const MatchInput(preferredName: 'Del')),
      throwsA(isA<ChartingPaused>()),
    );
    expect(server.serverAudit.where((e) => e['action'] != 'patient.index_downloaded'), isEmpty);
  });

  test(
    'Attach to another patient: a street name refused for a missing patient, sent again for the right one',
    () async {
      final a = phone(alex);
      final right = server.seedPatient(preferredName: 'Del');
      await a.services.patients.open(right);
      const missing = 'deadbeef-0000-4000-8000-000000000000';
      a.store.createRecord(entityAlias, {'patientId': missing, 'alias': 'Smitty'});
      a.store.database.execute(
        "INSERT INTO patient_names (name, patient_id, source, origin) VALUES ('smitty', ?, 'alias', 'local')",
        [missing],
      );
      await a.phone.engine.syncAll(force: true);
      final refused = a.store.needsAttention().single;
      expect(refused.reason, 'stale_reference');
      final id = a.services.patients.attachToPatient(refused.changeId, right);
      expect(a.store.needsAttention(), isEmpty);
      final names = a.store.database.select(
        "SELECT patient_id FROM patient_names WHERE name = 'smitty' AND origin = 'local'",
      );
      expect(names.map((r) => r['patient_id']), [right]);
      await a.phone.engine.syncAll(force: true);
      expect(a.store.outbox(), isEmpty);
      expect(server.records[id]!.patientId, right);
      expect(() => a.services.patients.attachToPatient(refused.changeId, right), throwsStateError);
    },
  );
}
