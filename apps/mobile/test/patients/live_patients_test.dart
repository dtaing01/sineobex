import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/auth/auth_provider.dart';
import 'package:sineobex_field/patients/consent_script.dart';
import 'package:sineobex_field/patients/display.dart';
import 'package:sineobex_field/patients/dob.dart';
import 'package:sineobex_field/patients/id_links.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/patient_repository.dart';
import 'package:sineobex_field/patients/patient_search.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/phone_harness.dart';

/// The phase 3 done-when (design 13.1) and the starred scenarios of 13.6 against the real API and
/// Postgres: the same patient code as done_when_test.dart and patient_scenarios_test.dart, with the
/// real server instead of the in-memory one. tools/live-sync.sh runs it after live_api_test.dart on
/// a freshly seeded database; the done-when reads P1 as db/seed/seed.ts inserted it from
/// done-when.json. Every other scenario makes its own invented patients through a phone push.
void main() {
  final apiUrl = Platform.environment['SINEOBEX_LIVE_API'];
  final idpUrl = Platform.environment['SINEOBEX_LIVE_IDP'];
  final skip = apiUrl == null || idpUrl == null ? 'set SINEOBEX_LIVE_API and SINEOBEX_LIVE_IDP to run' : null;
  if (Platform.environment['SINEOBEX_LIVE_REQUIRED'] == '1' && skip != null) {
    test('the live API is configured', () => fail(skip));
    return;
  }

  final fixture = jsonDecode(
    File('../../packages/contract/test-vectors/done-when.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final team = fixture['teamId']! as String;
  final client = http.Client();
  final phones = <_LivePhone>[];
  // Names unique to this run, so a scenario finds only its own patients.
  final run = Random().nextInt(1 << 30).toRadixString(36);
  String name(String base) => '$base$run';

  Future<({String userId, Tokens tokens, Me me})> signIn(String email) async {
    final auth = DevAuthProvider(url: Uri.parse(idpUrl!), client: client);
    final challenge = await auth.signIn(email, 'sineobex-demo') as MfaChallenge;
    final tokens = await auth.verifyMfa(challenge.tokens, challenge.factorId, '000000');
    final me = await SineobexApi(
      HttpTransport(baseUrl: Uri.parse(apiUrl!), client: client, accessToken: () => tokens.accessToken),
    ).getMe();
    return (userId: me.user.id, tokens: tokens, me: me);
  }

  /// The API as [email] (an admin's screens in the portal, a clinician's reads).
  Future<SineobexApi> as(String email) async {
    final who = await signIn(email);
    return SineobexApi(
      HttpTransport(
        baseUrl: Uri.parse(apiUrl!),
        client: client,
        accessToken: () => who.tokens.accessToken,
        teamId: () => team,
      ),
    );
  }

  Future<_LivePhone> phone(String email) async {
    final who = await signIn(email);
    final network = _Network(
      HttpTransport(
        baseUrl: Uri.parse(apiUrl!),
        client: client,
        accessToken: () => who.tokens.accessToken,
        teamId: () => team,
      ),
    );
    final permissions = [
      for (final t in who.me.teams)
        if (t.teamId == team) ...t.permissions.map((p) => p.wire),
    ];
    final p = _LivePhone(
      TestPhone(userId: who.userId, teamId: team, transport: () => network, realTime: DateTime.now),
      network,
      permissions,
      who.me.idLinkBaseUrl,
    );
    phones.add(p);
    return p;
  }

  tearDownAll(() {
    for (final p in phones) {
      p.phone.close();
    }
    client.close();
  });

  Intake intake(String preferred, {String? given, Birth? birth, String? descriptor}) => Intake(
    consent: const ConsentAnswer.given(),
    preferredName: preferred,
    legalGiven: given,
    birth: birth,
    visualDescriptor: descriptor,
  );

  /// A patient made online by [p] (an intake pushed at once).
  Future<String> registered(_LivePhone p, Intake i) async {
    final id = p.services.patients.createPatient(i).patientId;
    await p.phone.engine.syncAll(force: true);
    expect(p.store.outbox(), isEmpty);
    return id;
  }

  Future<DuplicatePairSummary?> pairOf(SineobexApi admin, String a, String b) async {
    String? after;
    do {
      final page = await admin.listDuplicates(afterId: after);
      for (final pair in page.pairs) {
        if ({pair.a.patientId, pair.b.patientId}.containsAll([a, b])) return pair;
      }
      after = page.nextAfterId;
    } while (after != null);
    return null;
  }

  test('★1 the done-when: found offline by a misspelled alias, edited, flagged at intake', () async {
    final p1 = fixture['p1']! as Map<String, Object?>;
    final p1Id = p1['id']! as String;
    final search = fixture['search']! as Map<String, Object?>;
    final edit = fixture['edit']! as Map<String, Object?>;
    final intakeFixture = fixture['intake']! as Map<String, Object?>;
    final match = (fixture['match']! as Map<String, Object?>)['expected']! as Map<String, Object?>;
    final p = await phone('clinician@example.com');

    // 1. Online sync: the index arrives, without the legal name.
    await p.phone.engine.syncAll(force: true);
    await p.refresh();
    expect(p.store.kv('index.version'), isNotNull);
    expect(p.services.index.entry(p1Id)!.allergies.single.substance, 'penicillin');
    final rows = [
      for (final r in p.store.database.select(
        "SELECT name FROM patient_names WHERE patient_id = ? AND origin = 'index'",
        [p1Id],
      ))
        r['name']! as String,
    ]..sort();
    expect(rows, [...(p1['phoneSearchRows']! as List<Object?>).cast<String>()]..sort());
    expect(
      p.store.database.select("SELECT 1 FROM patient_names WHERE name LIKE '%delbert%' OR name LIKE '%smithfield%'"),
      isEmpty,
    );

    // 2–3. Airplane mode; "Smity" finds P1 through its alias, audited, the text never stored.
    p.network.offline = true;
    final found = await p.services.search.search(search['text']! as String);
    final expected = search['expected']! as Map<String, Object?>;
    expect(found.source, ListSource.phone);
    expect(found.hits.first.patientId, expected['first']);
    expect(found.hits.first.reasons.map((r) => r.wire), expected['reasons']);
    expect(found.hits.first.score, closeTo(expected['phoneScore']! as double, 1e-9));
    expect(p.store.outbox().single.value, containsPair('source', 'team_index'));
    expect(p.store.database.select("SELECT 1 FROM outbox WHERE lower(value_json) LIKE '%smit%'"), isEmpty);

    // 4. Open P1 from the index and edit Usually found.
    expect((await p.services.patients.open(p1Id))!.copy, ChartCopy.partial);
    p.services.patients
      ..startEditing(p1Id)
      ..update(p1Id, {edit['field']! as String: edit['value']})
      ..finishEditing(p1Id);
    final set = p.store.outbox().where((e) => e.op == 'set').single;
    expect([set.recordId, set.field, set.baseVersion], [p1Id, edit['field'], edit['baseVersion']]);

    // 5. A new patient: P1 is likely; Not them; Create.
    final parsed = parseBirth(intakeFixture['typedBirth']! as String, BirthMode.date, DateTime.now()) as ParsedBirth;
    final legal = intakeFixture['legalName']! as Map<String, Object?>;
    final check = await p.services.search.checkMatches(
      MatchInput(
        preferredName: intakeFixture['preferredName']! as String,
        legalGiven: legal['given'] as String?,
        birth: parsed.birth,
      ),
    );
    final candidate = check.candidates.firstWhere((c) => c.patientId == p1Id);
    expect(candidate.band.wire, match['band']);
    expect(candidate.reasons.map((r) => r.wire), match['reasons']);
    expect(candidate.score, closeTo(match['phoneScore']! as double, match['tolerance']! as double));
    final p2 = p.services.patients
        .createPatient(
          Intake(
            consent: const ConsentAnswer.given(),
            preferredName: intakeFixture['preferredName']! as String,
            legalGiven: legal['given'] as String?,
            birth: parsed.birth,
            matchCheck: check.matchCheck(dismissed: [p1Id]),
          ),
        )
        .patientId;
    expect(
      p.store.database.select('SELECT name FROM patient_names WHERE patient_id = ?', [p2]).map((r) => r['name']),
      intakeFixture['phoneSearchRows'],
    );

    // 6. The app is killed and opened again.
    final before = [for (final e in p.store.outbox()) (e.changeId, e.valueHash)];
    await p.restart();
    expect([for (final e in p.store.outbox()) (e.changeId, e.valueHash)], before);

    // 7. Reconnect: every change confirmed by hash; the history and the queue show it.
    p.network.offline = false;
    expect(await p.phone.engine.syncAll(force: true), isA<SyncDone>());
    expect(p.store.outbox(), isEmpty);
    final clinician = await as('clinician@example.com');
    final history = await clinician.getPatientHistory(patientId: p1Id, field: edit['field']! as String);
    expect(history.entries.any((h) => h.value == edit['value'] && h.previousValue == edit['previousValue']), isTrue);
    final pair = (await pairOf(await as('admin@example.com'), p1Id, p2))!;
    expect(pair.status, DuplicateStatus.open);
    expect(pair.creatorDismissed, isTrue);
    expect(pair.reasons, contains(MatchReason.dobSwapped));
    expect(pair.score, greaterThanOrEqualTo(match['serverScoreAtLeast']! as double));

    // 8. The next refresh: both carry the hint; P2's own rows are gone; 25 hours on, the purge.
    await p.refresh();
    expect(p.services.index.entry(p1Id)!.duplicate?.status, DuplicateHintStatus.open);
    expect(p.services.index.entry(p2)!.duplicate?.status, DuplicateHintStatus.open);
    expect(
      p.store.database.select("SELECT 1 FROM patient_names WHERE patient_id = ? AND origin = 'local'", [p2]),
      isEmpty,
    );
    p.phone.skew = const Duration(hours: 25);
    p.store.purge();
    expect(p.store.record(p1Id), isNull);
    expect(p.store.record(p2), isNull);
    expect(p.store.database.select("SELECT 1 FROM patient_names WHERE origin IN ('cache', 'local')"), isEmpty);
  }, skip: skip);

  test('★2 two phones register the same person offline: one pair, the hint on both', () async {
    final a = await phone('clinician@example.com'), b = await phone('resident@example.com');
    a.network.offline = true;
    b.network.offline = true;
    const born = BirthDate(1971, 4, 9);
    final pa = a.services.patients.createPatient(intake(name('Rioq'), given: 'Ramonq', birth: born)).patientId;
    final pb = b.services.patients.createPatient(intake(name('Rioq'), given: 'Ramonq', birth: born)).patientId;
    a.network.offline = false;
    b.network.offline = false;
    await a.phone.engine.syncAll(force: true);
    await b.phone.engine.syncAll(force: true);
    expect([a.store.outbox(), b.store.outbox()], [isEmpty, isEmpty]);
    expect((await pairOf(await as('admin@example.com'), pa, pb))!.status, DuplicateStatus.open);
    for (final p in [a, b]) {
      await p.refresh();
      expect(p.services.index.entry(pa)!.duplicate?.status, DuplicateHintStatus.open);
      expect(p.services.index.entry(pb)!.duplicate?.status, DuplicateHintStatus.open);
    }
  }, skip: skip);

  test('★3 two phones edit Usually found offline: both confirm, one review, nothing to fix', () async {
    final a = await phone('clinician@example.com'), b = await phone('resident@example.com');
    final p = await registered(a, intake(name('Velq'), descriptor: 'Demo: green coat'));
    await a.services.patients.open(p);
    await b.services.patients.open(p);
    a.network.offline = true;
    b.network.offline = true;
    a.services.patients.update(p, {'usualArea': 'Demo: library steps'});
    b.services.patients.update(p, {'usualArea': 'Demo: bus depot'});
    a.network.offline = false;
    b.network.offline = false;
    await a.phone.engine.syncAll(force: true);
    await b.phone.engine.syncAll(force: true);
    expect([a.store.outbox(), b.store.outbox()], [isEmpty, isEmpty]);
    expect([a.store.needsAttention(), b.store.needsAttention()], [isEmpty, isEmpty]);
    final reviews = await (await as('admin@example.com')).listFieldReviews(status: ListFieldReviewsStatus.open);
    expect(reviews.reviews.where((r) => r.patientId == p && r.field == 'usualArea'), hasLength(1));
  }, skip: skip);

  test('★4 a merge while a phone works offline on the merged patient; a card for it refused; the undo', () async {
    final a = await phone('clinician@example.com');
    const born = BirthDate(1958, 11, 2);
    final kept = await registered(a, intake(name('Toloq'), given: 'Bartoq', birth: born));
    final merged = await registered(a, intake(name('Toloq'), given: 'Bartoq', birth: born));
    await a.refresh();
    await a.services.patients.open(merged);
    a.network.offline = true;
    a.services.patients.addAlias(merged, name('Tee'));
    a.services.patients.addAllergy(merged, const NewAllergy(substance: 'latex', category: 'environment'));
    a.services.patients.update(merged, {'usualArea': 'Demo: library steps'});
    final card = a.services.idLinks.makeCard(merged, reason: 'first_card');

    final admin = await as('admin@example.com');
    final pair = (await pairOf(admin, kept, merged))!;
    final detail = await admin.getDuplicatePair(pairId: pair.id);
    final decided = await admin.decideDuplicate(
      pairId: pair.id,
      body: DecideDuplicate(
        comment: 'Demo: same person',
        decision: DecideDuplicateDecision.merge,
        survivorId: kept,
        versions: DecideDuplicateVersions(a: detail.a.version, b: detail.b.version),
      ),
    );
    a.network.offline = false;
    await a.phone.engine.syncAll(force: true);
    final refused = a.store.needsAttention().single;
    expect([refused.recordId, refused.details?['problem']], [card, 'patient_merged']);
    expect(a.services.idLinks.cards(merged).firstWhere((c) => c.id == card).state, IdCardState.rejected);
    expect(a.store.redirects()[merged]?.survivorId, kept);
    await a.refresh();
    expect(a.store.redirects()[merged]!.origin, 'index');
    final view = (await a.services.patients.open(merged))!;
    expect(view.canonicalId, kept);
    expect(view.aliases.map((x) => x.alias), contains(name('Tee')));
    expect(view.allergies.map((x) => x.substance), contains('latex'));

    await admin.undoMerge(
      mergeId: decided.merge!.id,
      body: const UndoMerge(comment: 'Demo: not the same'),
    );
    await a.refresh();
    expect(a.store.redirects().containsKey(merged), isFalse);
    a.network.offline = true;
    a.services.patients.addAlias(merged, name('Tolo B'));
    final create = a.store.outbox().lastWhere((e) => e.entity == entityAlias);
    expect((create.value! as Map<String, Object?>)['patientId'], merged);
    a.network.offline = false;
    await a.phone.engine.syncAll(force: true);
    final chart = await (await as('clinician@example.com')).getPatient(patientId: merged);
    expect(chart.canonicalId, merged);
    expect(chart.aliases.map((x) => x.attributes['alias']), contains(name('Tolo B')));
  }, skip: skip);

  test('★5 two phones make a new card offline: the newer wins; the other is told and copies the valid link', () async {
    final a = await phone('clinician@example.com'), b = await phone('resident@example.com');
    final p = await registered(a, intake(name('Carq'), descriptor: 'Demo: red scarf'));
    final first = a.services.idLinks.makeCard(p, reason: 'first_card');
    await a.phone.engine.syncAll(force: true);
    await a.services.patients.open(p);
    await b.services.patients.open(p);
    a.network.offline = true;
    b.network.offline = true;
    final older = b.services.idLinks.makeCard(p, reason: 'lost');
    await Future<void>.delayed(const Duration(milliseconds: 1100));
    final newer = a.services.idLinks.makeCard(p, reason: 'lost');
    a.network.offline = false;
    b.network.offline = false;
    await a.phone.engine.syncAll(force: true);
    await b.phone.engine.syncAll(force: true);
    expect([a.store.outbox(), b.store.outbox()], [isEmpty, isEmpty]);
    final states = {for (final c in b.services.idLinks.cards(p)) c.id: c.state};
    expect(states[older], IdCardState.retired);
    expect(states[first], IdCardState.retired);
    expect(b.store.notices().where((n) => n.kind == noticeCardSuperseded).single.recordId, older);
    await b.services.charts.open(p);
    expect(b.services.idLinks.workingCards(p).single.id, newer);
    expect(await b.services.idLinks.copy(newer), CopyOutcome.copied);
    expect(b.copied.single, startsWith('${IdLinks.baseUrlOf(b.store)}/c#'));
  }, skip: skip);

  test('★11 two phones each clear a different recognisable field: one is kept, nothing to fix', () async {
    final a = await phone('clinician@example.com'), b = await phone('resident@example.com');
    final p = await registered(a, intake(name('Wenq'), descriptor: 'Demo: red cap'));
    await a.services.patients.open(p);
    await b.services.patients.open(p);
    a.network.offline = true;
    b.network.offline = true;
    a.services.patients.update(p, {'preferredName': null});
    b.services.patients.update(p, {'visualDescriptor': null});
    a.network.offline = false;
    b.network.offline = false;
    await a.phone.engine.syncAll(force: true);
    await b.phone.engine.syncAll(force: true);
    expect([a.store.outbox(), b.store.outbox()], [isEmpty, isEmpty]);
    expect([a.store.needsAttention(), b.store.needsAttention()], [isEmpty, isEmpty]);
    expect(b.store.notices().where((n) => n.kind == noticeNothingToRecognise), hasLength(1));
    final chart = await (await as('clinician@example.com')).getPatient(patientId: p);
    expect(chart.patient.fields['visualDescriptor']!.value, 'Demo: red cap');
  }, skip: skip);

  for (final allergyFirst in [false, true]) {
    test(
      '★12 no known allergies and an allergy from two phones (${allergyFirst ? 'allergy first' : 'allergy second'})',
      () async {
        final a = await phone('clinician@example.com'), b = await phone('resident@example.com');
        final p = await registered(a, intake(name('Allq'), descriptor: 'Demo: blue hat'));
        await a.services.patients.open(p);
        await b.services.patients.open(p);
        a.network.offline = true;
        b.network.offline = true;
        a.services.patients.update(p, {'allergyScreen': 'none_known'});
        b.services.patients.addAllergy(p, const NewAllergy(substance: 'penicillin', severity: 'severe'));
        a.network.offline = false;
        b.network.offline = false;
        for (final x in allergyFirst ? [b, a] : [a, b]) {
          await x.phone.engine.syncAll(force: true);
        }
        for (final x in [a, b]) {
          expect(x.store.needsAttention(), isEmpty);
          await x.services.patients.open(p);
          expect(x.services.patients.read(p)!.badge.kind, AllergyBadgeKind.allergies);
        }
        if (!allergyFirst) {
          final chart = await (await as('clinician@example.com')).getPatient(patientId: p);
          expect(chart.patient.fields['allergyScreen']!.value, 'not_asked');
        }
      },
      skip: skip,
    );
  }
}

/// One phone with its patient services, on the real API.
class _LivePhone {
  _LivePhone(this.phone, this.network, this.permissions, this.baseUrl) {
    attach();
  }

  final TestPhone phone;
  final _Network network;
  final List<String> permissions;
  final String baseUrl;
  late PatientServices services;
  final copied = <String>[];

  LocalStore get store => phone.store;

  void attach() {
    services = PatientServices(
      OpenTeam(
        userId: phone.userId,
        teamId: phone.teamId,
        store: phone.store,
        api: phone.engine.api,
        clock: phone.clock,
        permissions: permissions,
      ),
      idLinkBaseUrl: baseUrl,
      copy: (text) async {
        copied.add(text);
        return true;
      },
    );
    phone.engine.refreshers.addAll(services.refreshers);
  }

  Future<void> restart() async {
    await phone.restart();
    attach();
  }

  /// Pull to refresh: the index and the charts kept for work, now.
  Future<void> refresh() => phone.engine.runRefreshers(RefreshReason.manual);
}

/// The real API behind a switchable network.
class _Network implements ApiTransport {
  _Network(this.inner);
  final ApiTransport inner;
  bool offline = false;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    if (offline) throw const NetworkException('offline');
    return inner.send(method, path, query: query, body: body);
  }
}
