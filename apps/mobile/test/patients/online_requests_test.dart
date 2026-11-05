import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show FieldReviewView;
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/patient_repository.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// The field review decision and History through the domain layer (review P10): online only, each
/// refusal named for the screen, and the chart opened again after a decision. The two routes are
/// answered here by script: what each request carries and how each answer maps.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const reviewId = 'e1e1e1e1-0000-4000-8000-000000000001';
  final start = DateTime.utc(2026, 10, 22, 15);

  late FakeSyncServer server;
  late _Scripted link;
  late TestPhone phone;
  late PatientServices services;

  setUp(() {
    server = FakeSyncServer(now: () => start);
    link = _Scripted(server.transportFor(alex, team));
    phone = TestPhone(userId: alex, teamId: team, transport: () => link, wall: start);
    services = PatientServices(
      OpenTeam(
        userId: alex,
        teamId: team,
        store: phone.store,
        api: phone.engine.api,
        clock: phone.clock,
        permissions: FakeSyncServer.healthcareStaff.toList(),
      ),
      copy: (_) async => true,
      wallNow: () => phone.wall,
    );
  });
  tearDown(() => phone.close());

  FieldReviewView review(String patientId) => FieldReviewView.fromJson({
    'id': reviewId,
    'patientId': patientId,
    'field': 'usualArea',
    'needs': 'patients.edit',
    'status': 'open',
    'openedAt': '2026-10-21T10:00:00.000Z',
    'current': {'value': 'Demo: north bridge', 'version': 3, 'changedBy': null, 'changedAt': null},
    'currentBy': null,
    'alternates': [
      {
        'historyId': 'a1a1a1a1-0000-4000-8000-000000000001',
        'value': 'Demo: south bridge',
        'by': {'userId': alex, 'displayName': 'Demo user'},
        'deviceTime': null,
      },
    ],
    'patient': null,
  });

  Map<String, Object?> decided(String patientId) => {...review(patientId).toJson(), 'status': 'decided'};

  test('a decision carries the version the person was shown, then the chart opens again', () async {
    final p = server.seedPatient(preferredName: 'Del', usualArea: 'Demo: north bridge');
    await services.patients.open(p);
    link.answer = (path, body) => decided(p);
    link.sent.clear();
    final view = await services.patients.decideFieldReview(
      review(p),
      keepCurrent: false,
      historyId: 'a1a1a1a1-0000-4000-8000-000000000001',
      comment: '  Demo: asked them  ',
    );
    expect(link.sent.first.path, '/v1/team/field-reviews/$reviewId/decision');
    expect(link.sent.first.body, {
      'baseVersion': 3,
      'comment': 'Demo: asked them',
      'historyId': 'a1a1a1a1-0000-4000-8000-000000000001',
      'keep': 'alternate',
    });
    expect(link.sent.map((s) => s.path), contains('/v1/patients/charts'), reason: 'opened again');
    expect(view!.canonicalId, p);
  });

  test('keeping the current value sends no alternate; an alternate must be named', () async {
    final p = server.seedPatient(preferredName: 'Del');
    await services.patients.open(p);
    link.answer = (path, body) => decided(p);
    await services.patients.decideFieldReview(review(p), keepCurrent: true, historyId: 'ignored');
    expect(link.sent.firstWhere((s) => s.path.endsWith('/decision')).body, {'baseVersion': 3, 'keep': 'current'});
    expect(() => services.patients.decideFieldReview(review(p), keepCurrent: false), throwsArgumentError);
  });

  test('history asks for the chart that holds the patient, a field and a page at a time', () async {
    final kept = server.seedPatient(preferredName: 'Del');
    final merged = server.seedPatient(preferredName: 'Delly');
    phone.store.replaceRedirects([PatientRedirect(mergedId: merged, survivorId: kept)], origin: 'index');
    link.answer = (path, body) => {'entries': const <Object?>[], 'nextAfterId': null};
    final page = await services.patients.history(
      merged,
      field: 'usualArea',
      after: 'f0f0f0f0-0000-4000-8000-000000000001',
    );
    expect(page.entries, isEmpty);
    expect(link.sent.single.path, '/v1/patients/$kept/history');
    expect(link.queries.single, {'field': 'usualArea', 'afterId': 'f0f0f0f0-0000-4000-8000-000000000001'});
  });

  test('every refusal reaches the screen as a problem it can put in words', () async {
    final p = server.seedPatient(preferredName: 'Del');
    await services.patients.open(p);
    final cases = <(Object, OnlineProblem)>[
      (const NetworkException('offline'), OnlineProblem.offline),
      (const ApiException(403, 'forbidden', ''), OnlineProblem.notAllowed),
      (const ApiException(403, 'reauth_required', ''), OnlineProblem.signInAgain),
      (const ApiException(404, 'not_found', ''), OnlineProblem.notFound),
      (const ApiException(409, 'already_decided', ''), OnlineProblem.alreadyDecided),
      (
        const ApiException(409, 'field_changed', '', details: {'field': 'usualArea', 'version': 5}),
        OnlineProblem.fieldChanged,
      ),
      (const ApiException(422, 'comment_required', ''), OnlineProblem.commentRequired),
      (const ApiException(422, 'not_an_alternate', ''), OnlineProblem.invalid),
      (const ApiException(422, 'validation', ''), OnlineProblem.invalid),
      (const ApiException(409, 'nothing_to_recognise', ''), OnlineProblem.nothingToRecognise),
      (const ApiException(503, 'unavailable', ''), OnlineProblem.failed),
    ];
    for (final (error, problem) in cases) {
      link.answer = (path, body) => throw error;
      await expectLater(
        services.patients.decideFieldReview(review(p), keepCurrent: true),
        throwsA(isA<OnlineRequestFailed>().having((e) => e.problem, '$error', problem)),
      );
      await expectLater(
        services.patients.history(p),
        throwsA(isA<OnlineRequestFailed>().having((e) => e.problem, '$error', problem)),
      );
    }
    link.answer = (path, body) => throw const ApiException(409, 'field_changed', '', details: {'version': 5});
    await expectLater(
      services.patients.decideFieldReview(review(p), keepCurrent: true),
      throwsA(isA<OnlineRequestFailed>().having((e) => e.version, 'version', 5)),
    );
  });

  test('a frozen store asks nothing', () async {
    final p = server.seedPatient(preferredName: 'Del');
    await services.patients.open(p);
    phone.store.freeze('Your access to this team ended.');
    link.sent.clear();
    await expectLater(
      services.patients.decideFieldReview(review(p), keepCurrent: true),
      throwsA(isA<ChartingPaused>()),
    );
    await expectLater(services.patients.history(p), throwsA(isA<ChartingPaused>()));
    expect(link.sent, isEmpty);
  });
}

/// The fake for every route but the two scripted ones, which [answer] answers (or throws).
class _Scripted implements ApiTransport {
  _Scripted(this.inner);
  final ApiTransport inner;
  Object? Function(String path, Object? body)? answer;
  final sent = <({String path, Object? body})>[];
  final queries = <Map<String, String>?>[];

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    sent.add((path: path, body: body));
    if (path.endsWith('/decision') || path.endsWith('/history')) {
      queries.add(query);
      return answer!(path, body);
    }
    return inner.send(method, path, query: query, body: body);
  }
}
