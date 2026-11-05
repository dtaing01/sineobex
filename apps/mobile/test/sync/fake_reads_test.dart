import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/patients/id_link_token.dart';
import 'package:sineobex_field/sync/canonical_json.dart';
import 'package:sineobex_field/sync/entities.dart';

import 'fake_server.dart';

/// The fake's patient read routes (design 3.1, 6, 7: services/api/src/patients/{team-index,
/// charts,search,match}.ts), decoded by the generated client as the phone will read them.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  late FakeSyncServer server;
  late SineobexApi api;
  final now = DateTime.utc(2026, 10, 22, 15);

  setUp(() {
    server = FakeSyncServer(now: () => now);
    api = SineobexApi(server.transportFor(alex, team));
  });

  const legal = {'given': 'Ysolde', 'family': 'Varrowick'};

  /// A patient with a street name, an allergy, a problem and a card.
  String chart() {
    final p = server.seedPatient(
      preferredName: 'Smitty',
      legalName: legal,
      visualDescriptor: 'Demo: red scarf',
      birth: const {'precision': 'day', 'date': '1970-05-06'},
    );
    server.seed(entityAlias, {'patientId': p, 'alias': 'Smitts'});
    server.seed(entityAllergy, {'patientId': p, 'substance': 'penicillin', 'severity': 'severe'});
    server.seed(entityProblem, {'patientId': p, 'title': 'Cough', 'status': 'new'});
    server.seed(entityProblem, {
      'patientId': p,
      'title': 'Low mood',
      'status': 'ongoing',
      'code': {'system': 'icd10cm', 'code': 'F32.9'},
    });
    server.seed(entityIdLink, {
      'patientId': p,
      'token': 'EEEEEEEEEEEEEEEEEEEEEE',
      'replacesLinkId': null,
      'reason': 'first_card',
    });
    return p;
  }

  group('the team index', () {
    test('holds the PRD’s list and bookkeeping, never a legal name, and pages by patient ID', () async {
      final p = chart();
      final merged = server.seedPatient(preferredName: 'Smit');
      server.merge(merged, p);
      for (var i = 0; i < 149; i++) {
        server.seedPatient(preferredName: 'Demo $i');
      }
      final raw = await server.handle(alex, team, 'POST', '/v1/patients/index', {'limit': 100});
      expect(jsonEncode(raw), isNot(matches(RegExp('Ysolde|Varrowick|ysolde|varrowick'))));
      final first = await api.downloadTeamIndex(body: const TeamIndexRequest(limit: 100));
      expect([first.status, first.entries.length, first.projection], [TeamIndexPageStatus.page, 100, 'idx1']);
      expect(first.redirects.single.mergedId, merged);
      final second = await api.downloadTeamIndex(body: TeamIndexRequest(after: first.next, limit: 100));
      expect([second.entries.length, second.next, second.redirects], [50, null, isEmpty]);
      final entry = [...first.entries, ...second.entries].firstWhere((e) => e.patientId == p);
      expect(entry.aliases.map((a) => (a.alias, a.kind, a.id == null)), [
        ('Smitts', IndexEntryAliasesItemKind.alias, false),
        ('Smit', IndexEntryAliasesItemKind.mergedName, true),
      ]);
      expect(entry.allergies.single.severity, AllergySeverity.severe);
      expect(entry.idLinks, hasLength(1));
      expect(entry.versions.preferredName, 1);
    });

    test('a Not sure pair shows in the index without its note; the chart keeps the note', () async {
      // Review finding P7: the note is free text, which can hold a legal name (D40).
      final p = chart();
      final other = server.seedPatient(preferredName: 'Demo Wren');
      server.pairs.add(
        FakePair('f1000000-0000-4000-8000-000000000001', p, other, 0.9, ['staff'])
          ..status = 'not_sure'
          ..note = 'Demo: Ysolde, check the card',
      );
      final raw = await server.handle(alex, team, 'POST', '/v1/patients/index', const <String, Object?>{});
      expect(jsonEncode(raw), isNot(contains('check the card')));
      final index = await api.downloadTeamIndex(body: const TeamIndexRequest());
      final entry = index.entries.firstWhere((e) => e.patientId == p);
      expect([entry.duplicate?.status, entry.duplicate?.note], [DuplicateHintStatus.notSure, null]);
      final open = await api.getPatient(patientId: p);
      expect(open.duplicate?.note, 'Demo: Ysolde, check the card');
    });

    test('`have` the current version answers unchanged; any change moves it', () async {
      final p = chart();
      final v1 = (await api.downloadTeamIndex(body: const TeamIndexRequest())).version;
      final same = await api.downloadTeamIndex(body: TeamIndexRequest(have: v1));
      expect([same.status, same.entries], [TeamIndexPageStatus.unchanged, isEmpty]);
      server.serverEdit(p, 'usualArea', 'Demo: pier', by: alex);
      final moved = await api.downloadTeamIndex(body: TeamIndexRequest(have: v1));
      expect(moved.status, TeamIndexPageStatus.page);
      expect(moved.version, isNot(v1));
    });

    test('a role without a field permission gets 403 index_not_permitted', () async {
      server.permissions[alex] = {'patients.view', 'billing.view_codes'};
      expect(
        () => api.downloadTeamIndex(body: const TeamIndexRequest()),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'index_not_permitted')),
      );
    });
  });

  group('charts', () {
    test('a merged ID answers its survivor’s chart with the redirects into it; unknown IDs are missing', () async {
      final p = chart();
      final merged = server.seedPatient(preferredName: 'Smit');
      server.merge(merged, p);
      const unknown = 'f0000000-0000-4000-8000-00000000000f';
      final bundle = await api.fetchCharts(
        body: const FetchCharts(patientIds: [unknown], reason: FetchChartsReason.opened).copyWithIds([merged, unknown]),
      );
      final c = bundle.charts.single;
      expect(
        [c.canonicalId, c.mergedFrom.single.patientId, bundle.missing],
        [
          p,
          merged,
          [unknown],
        ],
      );
      expect(bundle.redirects.single.survivorId, p);
      expect(c.patient.fields['legalName']!.value, legal);
      expect(c.aliases.single.attributes['alias'], 'Smitts');
      expect(c.problems!.map((r) => r.attributes['title']), unorderedEquals(['Cough', 'Low mood']));
      expect(c.idLinks.single.url, endsWith('/c#EEEEEEEEEEEEEEEEEEEEEE'));
      // The chart, and the card link it carries (design 10.6).
      expect(server.serverAudit.map((a) => (a['action'], (a['details']! as Map)['source'])), [
        ('patient.viewed', 'cache'),
        ('id_link.viewed', 'cache'),
      ]);
      expect((server.serverAudit.last['details']! as Map)['tokenRef'], idLinkTokenRef('EEEEEEEEEEEEEEEEEEEEEE'));
    });

    test('the projection: no problem list without its permissions, sensitive ones only with view_sensitive', () async {
      final p = chart();
      server.permissions[alex] = FakeSyncServer.chw;
      var c = (await api.fetchCharts(
        body: FetchCharts(patientIds: [p], reason: FetchChartsReason.refresh),
      )).charts.single;
      expect([c.problems, c.problemNotes], [null, null]);
      expect(c.idLinks.single.url, isNotNull);
      server.permissions[alex] = {'patients.view', 'encounters.chart'};
      c = (await api.fetchCharts(
        body: FetchCharts(patientIds: [p], reason: FetchChartsReason.refresh),
      )).charts.single;
      expect(c.problems!.map((r) => r.attributes['title']), ['Cough']);
      expect(c.idLinks.single.url, isNull);
      // Without a link to show, no link was read.
      expect(server.serverAudit.where((a) => a['action'] == 'id_link.viewed'), hasLength(1));
      await api.getPatient(patientId: p);
      expect(server.serverAudit.last['action'], 'patient.viewed');
    });
  });

  test('search finds a misspelled street name and shows no legal name on the phone', () async {
    final p = chart();
    server.seedPatient(preferredName: 'Bartholomew');
    final res = await api.searchPatients(
      body: const PatientSearch(name: 'Smity', surface: Surface.phone),
    );
    expect(res.hits.first.patientId, p);
    expect(res.hits.first.summary.legalName, isNull);
    expect(res.hits.first.summary.aliases, ['Smitts']);
    final portal = await api.searchPatients(
      body: const PatientSearch(name: 'Varrowick', surface: Surface.portal),
    );
    expect(portal.hits.single.summary.legalName?.family, 'Varrowick');
    expect(server.serverAudit.map((a) => a['action']), ['patient.searched', 'patient.searched']);
  });

  test('the match check finds the likely same person and leaves out the patient’s own group', () async {
    final p = chart();
    final res = await api.matchPatients(
      body: const PatientMatchRequest(
        legalName: LegalNameInput(given: 'Ysolde', family: 'Varrowick'),
        birth: BirthInput(precision: BirthPrecision.day, date: '1970-05-06'),
        surface: Surface.phone,
      ),
    );
    expect(res.candidates.single.patientId, p);
    expect(res.candidates.single.band, MatchBand.likely);
    final own = await api.matchPatients(
      body: PatientMatchRequest(preferredName: 'Smitty', excludePatientId: p, surface: Surface.phone),
    );
    expect(own.candidates, isEmpty);
  });

  test('card notices go to their issuers and are marked read', () async {
    final p = server.seedPatient();
    server.seed(entityIdLink, {
      'patientId': p,
      'token': 'FFFFFFFFFFFFFFFFFFFFFF',
      'replacesLinkId': null,
      'reason': 'first_card',
    }, by: 'b0000000-0000-4000-8000-00000000000b');
    // Made later on alex's phone without seeing that card: the newer wins.
    server.seed(
      entityIdLink,
      {'patientId': p, 'token': 'GGGGGGGGGGGGGGGGGGGGGG', 'replacesLinkId': null, 'reason': 'first_card'},
      by: alex,
      at: now.add(const Duration(minutes: 1)),
    );
    final mine = await api.listNotices();
    expect(mine.single.kind, 'id_link_kept');
    await api.markNoticeRead(noticeId: mine.single.id);
    expect((await api.listNotices()).single.readAt, isNotNull);
  });

  group('field reviews and history (review finding P10: the routes the phone calls)', () {
    const blair = 'b0000000-0000-4000-8000-00000000000b';
    const admin = 'ad000000-0000-4000-8000-0000000000ad';
    var seq = 0;
    var ids = 0;
    String id() => 'e0e00000-0000-4000-8000-${(++ids).toString().padLeft(12, '0')}';

    setUp(() {
      seq = 0;
      server.permissions[admin] = {...FakeSyncServer.healthcareStaff, 'patients.correct_identity'};
    });

    /// A set pushed by [user] that never saw the chart's value (baseVersion 0).
    Future<Map<String, Object?>> unseen(
      String user,
      String recordId,
      String field,
      Object? value, {
      String entity = entityPatient,
    }) async {
      final device = 'dev-$user';
      await server.handle(user, team, 'POST', '/v1/devices', {
        'deviceId': device,
        'platform': 'android',
        'appVersion': 'test',
        'publicKey': 'key-$user',
      });
      final at = now.toIso8601String();
      final res = await server.handle(user, team, 'POST', '/v1/sync/push', {
        'deviceId': device,
        'clock': {'deviceTime': at},
        'unsynced': {'counts': <String, Object?>{}},
        'changes': [
          {
            'changeId': id(),
            'seq': ++seq,
            'entity': entity,
            'recordId': recordId,
            'op': 'set',
            'field': field,
            'value': value,
            'valueHash': valueHash(value),
            'baseVersion': 0,
            'deviceTime': at,
            'clockVerified': true,
          },
        ],
      }) as Map<String, Object?>;
      return (res['results']! as List<Object?>).single! as Map<String, Object?>;
    }

    Future<ApiException> refused(Future<Object?> call) async {
      try {
        await call;
      } on ApiException catch (e) {
        return e;
      }
      fail('expected a refusal');
    }

    SineobexApi as(String user) => SineobexApi(server.transportFor(user, team));

    test('a decision keeps an alternate as its author’s, approved by the reviewer, once', () async {
      final p = server.seedPatient(usualArea: 'Demo: Elm Street underpass');
      final kept = await unseen(blair, p, 'usualArea', 'Demo: Oak Street lot');
      final reviewId = (kept['details']! as Map<String, Object?>)['reviewId']! as String;
      final chart = await api.getPatient(patientId: p);
      final open = chart.reviews.single;
      expect([open.id, open.patientId, open.current.version], [reviewId, p, 1]);
      final alternate = open.alternates.single;

      final stale = await refused(
        api.decideFieldReview(
          reviewId: reviewId,
          body: DecideFieldReview(
            keep: DecideFieldReviewKeep.alternate,
            historyId: alternate.historyId,
            baseVersion: 0,
          ),
        ),
      );
      expect(
        [stale.status, stale.code, stale.details],
        [
          409,
          'field_changed',
          {'field': 'usualArea', 'version': 1},
        ],
      );
      final unreadable = await refused(
        server.handle(alex, team, 'POST', '/v1/team/field-reviews/$reviewId/decision', {
          'keep': 'alternate',
          'baseVersion': 1,
        }),
      );
      expect(
        [unreadable.status, (unreadable.details!['fields']! as List).single],
        [
          422,
          {'path': 'historyId', 'problem': 'custom'},
        ],
      );
      final notOne = await refused(
        api.decideFieldReview(
          reviewId: reviewId,
          body: const DecideFieldReview(keep: DecideFieldReviewKeep.alternate, historyId: '1', baseVersion: 1),
        ),
      );
      expect([notOne.status, notOne.code], [422, 'not_an_alternate']);

      final decided = await api.decideFieldReview(
        reviewId: reviewId,
        body: DecideFieldReview(keep: DecideFieldReviewKeep.alternate, historyId: alternate.historyId, baseVersion: 1),
      );
      expect(
        [decided.status, decided.patientId, decided.current.value, decided.current.version],
        [FieldReviewViewStatus.decided, p, 'Demo: Oak Street lot', 2],
      );
      expect(decided.current.changedBy, blair);
      expect((await api.getPatient(patientId: p)).reviews, isEmpty);
      final again = await refused(
        api.decideFieldReview(
          reviewId: reviewId,
          body: const DecideFieldReview(keep: DecideFieldReviewKeep.current, baseVersion: 2),
        ),
      );
      expect([again.status, again.code], [409, 'already_decided']);
      final logged = server.serverAudit.where((a) => a['action'] == 'field_review.decided').single;
      expect(logged['patientId'], p);
      expect(logged['details'], {
        'reviewId': reviewId,
        'field': 'usualArea',
        'kept': 'alternate',
        'historyId': alternate.historyId,
        'version': 2,
      });

      final history = await api.getPatientHistory(patientId: p, field: 'usualArea');
      expect(history.entries.map((e) => (e.kind, e.version, e.changedBy.userId, e.approvedBy?.userId)), [
        (HistoryKind.reviewDecided, 2, blair, alex),
        (HistoryKind.keptBoth, 1, blair, null),
        (HistoryKind.created, 1, 'seed-user', null),
      ]);
      expect(history.entries.first.reviewId, reviewId);
    });

    test('a decision and the match check need patients.view too; a decision names who recorded the value', () async {
      // Review findings S5 (R2, 03b38d8) and W1 (R2, b99733e), mirrored.
      const editOnly = 'c0000000-0000-4000-8000-00000000000c';
      server.permissions[editOnly] = const {'patients.edit'};
      final p = server.seedPatient(usualArea: 'Demo: Elm Street underpass');
      final kept = await unseen(blair, p, 'usualArea', 'Demo: Oak Street lot');
      final reviewId = (kept['details']! as Map<String, Object?>)['reviewId']! as String;
      const body = {'keep': 'current', 'baseVersion': 1};
      final path = '/v1/team/field-reviews/$reviewId/decision';
      for (final call in [
        server.handle(editOnly, team, 'POST', path, body),
        server.handle(editOnly, team, 'POST', '/v1/patients/match', const {
          'preferredName': 'Demo',
          'surface': 'phone',
        }),
      ]) {
        final e = await refused(call);
        expect([e.status, e.code], [403, 'forbidden']);
      }
      expect(server.reviews[reviewId]!.status, 'open');

      // A chart's reviews are the chart's: no recorder there.
      final chart = await server.handle(alex, team, 'GET', '/v1/patients/$p', null) as Map<String, Object?>;
      expect((chart['reviews']! as List<Object?>).single, isNot(contains('currentBy')));
      final decided = await server.handle(alex, team, 'POST', path, body) as Map<String, Object?>;
      expect(decided['currentBy'], {'userId': 'seed-user', 'displayName': 'Demo user'});
      expect(FieldReviewView.fromJson(decided).status, FieldReviewViewStatus.decided);
    });

    test('legal name and birth: the review’s own permission, a recent sign-in and a comment', () async {
      final p = server.seedPatient(legalName: const {'given': 'Ysolde', 'family': null});
      final kept = await unseen(blair, p, 'legalName', const {'given': 'Ysolda', 'family': 'Varrowick'});
      final reviewId = (kept['details']! as Map<String, Object?>)['reviewId']! as String;
      final historyId = server.history.last['id']! as String;
      final body = DecideFieldReview(keep: DecideFieldReviewKeep.alternate, historyId: historyId, baseVersion: 1);

      final staff = await refused(api.decideFieldReview(reviewId: reviewId, body: body));
      expect([staff.status, staff.code], [403, 'forbidden']);
      server.staleSignIn.add(admin);
      final stale = await refused(as(admin).decideFieldReview(reviewId: reviewId, body: body));
      expect([stale.status, stale.code], [403, 'reauth_required']);
      server.staleSignIn.clear();
      final bare = await refused(as(admin).decideFieldReview(reviewId: reviewId, body: body));
      expect([bare.status, bare.code], [422, 'comment_required']);
      final missing = await refused(
        as(admin).decideFieldReview(reviewId: 'f0000000-0000-4000-8000-00000000000f', body: body),
      );
      expect([missing.status, missing.code], [404, 'not_found']);

      final decided = await as(admin).decideFieldReview(
        reviewId: reviewId,
        body: DecideFieldReview(
          keep: DecideFieldReviewKeep.alternate,
          historyId: historyId,
          baseVersion: 1,
          comment: '  Patient showed a card  ',
        ),
      );
      expect(decided.current.value, {'given': 'Ysolda', 'family': 'Varrowick'});
      final entry = (await as(admin).getPatientHistory(patientId: p, field: 'legalName')).entries.first;
      expect(
        [entry.kind, entry.approvedBy?.userId, entry.correctionId, entry.deviceTime],
        [HistoryKind.reviewDecided, admin, isNotNull, null],
      );
      final details =
          server.serverAudit.lastWhere((a) => a['action'] == 'field_review.decided')['details']!
              as Map<String, Object?>;
      expect(details['commentSha256'], hasLength(64));
      expect(details['correctionId'], entry.correctionId);
    });

    test(
      'history: the group’s records, problems with their permissions, never a card, newest first in pages',
      () async {
        final p = chart();
        final merged = server.seedPatient(preferredName: 'Smit');
        server.merge(merged, p);
        final allergy = server.records.values.singleWhere((r) => r.entity == entityAllergy).id;
        await unseen(blair, allergy, 'enteredInError', const {
          'reason': 'Demo: another patient',
        }, entity: entityAllergy);
        // Each is kept both on the survivor: 60 history rows of the group.
        for (var i = 0; i < 60; i++) {
          await unseen(blair, merged, 'preferredName', 'Smit $i');
        }
        final first = await api.getPatientHistory(patientId: merged);
        expect(first.entries, hasLength(FakeSyncServer.historyPage));
        final ids = [for (final e in first.entries) int.parse(e.id)];
        expect(ids, [...ids]..sort((a, b) => b.compareTo(a)));
        final rest = await api.getPatientHistory(patientId: p, afterId: first.nextAfterId);
        expect(rest.nextAfterId, isNull);
        final all = [...first.entries, ...rest.entries];
        // Both records' created fields, two problems, the allergy's retraction and the 60 kept.
        expect(all, hasLength(9 + 9 + 2 + 1 + 60));
        expect(all.map((e) => e.entity).toSet(), {entityPatient, entityAllergy, entityProblem});
        expect(all.where((e) => e.kind == HistoryKind.keptBoth).map((e) => e.recordId).toSet(), {p});
        expect(
          jsonEncode(await server.handle(alex, team, 'GET', '/v1/patients/$p/history', null)),
          isNot(contains('EEEE')),
        );
        final audited = server.serverAudit.where((a) => a['action'] == 'patient.history_viewed').toList();
        expect(audited.map((a) => a['patientId']).toSet(), {p});
        expect((audited.first['details']! as Map<String, Object?>)['count'], FakeSyncServer.historyPage);

        // A role without view_sensitive gets no sensitive problem; one without the problem list none.
        expect((await api.getPatientHistory(patientId: p, field: 'status')).entries, hasLength(2));
        server.permissions[alex] = FakeSyncServer.healthcareStaff.difference({'patients.view_sensitive'});
        var page = await api.getPatientHistory(patientId: p, field: 'status');
        expect(page.entries.map((e) => e.recordId).toSet(), hasLength(1));
        server.permissions[alex] = FakeSyncServer.chw;
        page = await api.getPatientHistory(patientId: p, field: 'status');
        expect(page.entries, isEmpty);
        server.permissions[alex] = const {'checkins.create'};
        expect((await refused(api.getPatientHistory(patientId: p))).status, 403);
        server.permissions.remove(alex);
        expect((await refused(api.getPatientHistory(patientId: 'f0000000-0000-4000-8000-00000000000f'))).status, 404);
      },
    );
  });
}

extension on FetchCharts {
  FetchCharts copyWithIds(List<String> ids) => FetchCharts(patientIds: ids, reason: reason);
}
