import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:sineobex_field/api/generated/api.dart' show PatientChart, SineobexApi;
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/encounters/encounter_repository.dart' hide Expanded;
import 'package:sineobex_field/encounters/encounter_services.dart';
import 'package:sineobex_field/features/encounters/encounter_screen.dart';
import 'package:sineobex_field/features/encounters/note_screen.dart';
import 'package:sineobex_field/features/encounters/visit_screen.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/patients/chart_cache.dart' show importChart;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart' show OpenTeam;

import '../../auth/fakes.dart' show demoUser;
import '../patients/patient_kit.dart';

export '../patients/patient_kit.dart';

/// What the encounter screen tests share (lifecycle 9): a charting person signed in on the app
/// harness, the team's released note types on the phone's test server as the API installs them
/// (forms 3.2), the done-when fixture's P1 on the chart, and the reads of what the store holds.

/// A teammate on the visit, by the name the server gives their records (D108).
const blair = 'b0000000-0000-4000-8000-00000000000b';
const blairName = 'Demo Blair';

/// The demo person the harness signs in as.
final me = demoUser().userId;

/// Signs in as Healthcare Staff (or [permissions]) with an attending's credential, with the released
/// note types on the server and P1 on the phone, then goes offline when [offline] says so.
Future<AppHarness> signInToChart(
  WidgetTester tester, {
  Run? run,
  List<String>? permissions,
  bool offline = true,
}) async {
  final h = await signIn(
    tester,
    theme: run?.theme,
    scale: run?.scale ?? 1,
    narrow: run?.narrow ?? false,
    permissions: permissions,
  );
  for (final v in AppHarness.bundledPresets.cast<Map<String, Object?>>()) {
    h.server.noteTypes[(v['key']! as String, v['version']! as int)] = v['definition']! as Map<String, Object?>;
  }
  h.server.names[blair] = blairName;
  seedP1(h.server);
  await syncAndRefresh(tester, h);
  h.server.offline = offline;
  return h;
}

/// The person charting becomes one with [credential] in the open team, the server agreeing: the
/// harness signs everyone in with an attending's, and a person's credential is read once, as the team
/// opens. The encounter services are made again for the open team, as the app makes them.
Future<EncounterServices> asCredential(WidgetTester tester, AppHarness h, String credential) =>
    remakeServices(tester, h, credential: credential);

/// The open team's encounter services made again, as the app makes them for a person with
/// [credential] and [permissions] (the session's, unless given), and, with [noteTypes] false, no
/// note type list on the phone. The server is told the credential and the keys.
Future<EncounterServices> remakeServices(
  WidgetTester tester,
  AppHarness h, {
  String? credential,
  List<String>? permissions,
  bool noteTypes = true,
}) async {
  final engine = h.sync.engine!;
  final before = h.encounters.user;
  if (credential != null) h.server.credentials[me] = credential;
  if (permissions != null) h.server.permissions[me] = permissions.toSet();
  final services = EncounterServices(
    OpenTeam(
      userId: me,
      teamId: engine.teamId,
      store: engine.store,
      api: engine.api,
      clock: engine.clock,
      permissions: permissions ?? before.permissions.toList(),
    ),
    credential: credential ?? before.credential,
    displayName: before.displayName,
    definitionStore: noteTypes ? h.sync.definitions : null,
    openServerRecord: engine.openServerRecord,
  );
  // The screens find the open team's services through the controller: it tells them after a sync.
  await syncAndRefresh(tester, h);
  expect(identical(h.encounters, services), isTrue);
  return services;
}

/// The team's released note type [key], as the phone lists it.
Future<NoteTypeDef> noteType(WidgetTester tester, AppHarness h, String key) async =>
    (await tester.runAsync(h.encounters.noteTypes))!.firstWhere((t) => t.key == key);

/// Where the app is now, as the router has it: the location of the route on top, pushed or gone to.
String location(WidgetTester tester) {
  final context = tester.element(find.byType(Navigator).first);
  final config = GoRouter.of(context).routerDelegate.currentConfiguration;
  return switch (config.last) {
    final ImperativeRouteMatch pushed => pushed.matches.uri.toString(),
    _ => config.uri.toString(),
  };
}

/// The visits on the phone.
List<LocalRecord> visits(AppHarness h) => [
  for (final id in h.sync.store!.recordIds())
    if (h.sync.store!.record(id)!.entity == entityEncounter) h.sync.store!.record(id)!,
];

/// The notes on the phone, of [encounterId] when given.
List<LocalRecord> notesOf(AppHarness h, [String? encounterId]) => [
  for (final id in h.sync.store!.recordIds())
    if (h.sync.store!.record(id)! case final r
        when r.entity == entityNote && (encounterId == null || r.attributes['encounterId'] == encounterId))
      r,
];

/// A note's answers as the phone holds them, by path.
Map<String, Object?> answersOf(AppHarness h, String noteId) => {
  for (final MapEntry(:key, :value) in h.sync.store!.record(noteId)!.fields.entries)
    if (key.startsWith('data.')) key.substring('data.'.length): value.value,
};

/// [key]'s note in the visit, if the phone holds one.
LocalRecord? noteOfType(AppHarness h, String encounterId, String key) =>
    notesOf(h, encounterId).where((n) => n.attributes['noteTypeKey'] == key).firstOrNull;

/// The note [noteId] opened, where its form is (`/notes/<id>`, lifecycle 9.5).
void expectNoteOpened(WidgetTester tester, String noteId) {
  expect(location(tester), '/notes/$noteId');
  expect(find.byType(NoteScreen), findsOneWidget);
}

/// The note screen of [noteId], opened as a tap opens it.
Future<void> openNote(WidgetTester tester, String noteId) async {
  await go(tester, '/notes/$noteId');
  expectNoteOpened(tester, noteId);
}

/// A visit started on the phone, as New encounter starts it: for P1 unless [noPatient].
String startVisit(AppHarness h, {VisitKind kind = VisitKind.medical, bool noPatient = false}) => h.encounters.repository
    .startEncounter(kind: kind, patientId: noPatient ? null : p1Id, locationText: 'Demo: by the library');

/// A note of [key] added to [visit] with [answers], as the note types list and the form add them.
Future<String> chart(
  WidgetTester tester,
  AppHarness h,
  String visit,
  String key, [
  Map<String, Object?> answers = const {},
]) async {
  final r = h.encounters.repository;
  final type = await noteType(tester, h, key);
  final added = (await tester.runAsync(() => r.addNote(visit, type)))!;
  await tester.runAsync(() => r.openNote(added.noteId));
  for (final MapEntry(:key, :value) in answers.entries) {
    r.saveAnswer(added.noteId, key, value);
  }
  return added.noteId;
}

/// A teammate's Social needs draft in [visit], brought to the phone as opening it does (a phone
/// refreshes the records it holds; the server's copy of another is fetched).
Future<String> teammatesNote(WidgetTester tester, AppHarness h, String visit) async {
  final offline = h.server.offline;
  h.server.offline = false;
  await syncAndRefresh(tester, h);
  final id = h.server.seed(entityNote, {
    'encounterId': visit,
    'noteTypeKey': 'social_needs',
    'noteTypeVersion': 1,
    'data': {
      'needs.needs': ['food'],
    },
  }, by: blair);
  expect(await tester.runAsync(() => h.sync.engine!.openServerRecord(entityNote, id)), isTrue);
  h.server.offline = offline;
  return id;
}

/// The encounter screen of [visit], opened as a tap opens it.
Future<void> openVisit(WidgetTester tester, String visit) async {
  await go(tester, '/encounters/$visit');
  expect(location(tester), '/encounters/$visit');
  expect(find.byType(EncounterScreen), findsOneWidget);
}

/// Activates the semantics node labelled [label] as TalkBack, Switch Access and Voice Access do (its
/// own tap action, not a pointer), after scrolling it into view.
Future<void> semanticTap(WidgetTester tester, Pattern label) async {
  await reveal(tester, find.bySemanticsLabel(label));
  tester.semantics.tap(find.semantics.byLabel(label));
  await settle(tester);
}

/// What a screen reader moves through on screen, in its order (Flutter's simulated traversal): each
/// node's label, "[H] " before a heading's, "[F] " before a text field's.
List<String> readingOrder(WidgetTester tester) => [
  for (final n in tester.semantics.simulatedAccessibilityTraversal())
    if (n.getSemanticsData() case final d when d.label.isNotEmpty)
      '${d.flagsCollection.isHeader ? '[H] ' : ''}${d.flagsCollection.isTextField ? '[F] ' : ''}${d.label}',
];

/// Back from the route on top, as the system's back does (the router's own page for a location it
/// lacks has no back button).
Future<void> back(WidgetTester tester) async {
  GoRouter.of(tester.element(find.byType(Navigator).first)).pop();
  await settle(tester);
}

/// The visit screen of [visit] (lifecycle 9.7), opened as the timeline opens it.
Future<void> openVisitScreen(WidgetTester tester, String visit) async {
  await go(tester, '/encounters/$visit/visit');
  expect(location(tester), '/encounters/$visit/visit');
  expect(find.byType(VisitScreen), findsOneWidget);
}

/// A Medical visit for P1 charted and completed by the person, offline: General / primary care with
/// its chief concern, and the Red flags note the app adds, its follow-up at the next street clinic.
Future<({String visit, String general, String flags})> finishedVisit(
  WidgetTester tester,
  AppHarness h, {
  String concern = 'Demo: cough',
  String? summary = 'Demo: viral, rest and fluids',
}) async {
  final r = h.encounters.repository;
  final visit = startVisit(h);
  final general = await chart(tester, h, visit, 'general_primary_care', {'reason.concern': concern});
  final flags = noteOfType(h, visit, 'red_flags_disposition')!.id;
  await tester.runAsync(() => r.openNote(flags));
  r
    ..saveAnswer(flags, 'red_flags.emergency', 'no')
    ..saveAnswer(flags, 'follow_up.when', 'next_street_clinic');
  if (summary != null) r.saveSummary(visit, summary);
  r.complete((await tester.runAsync<CompletePlan?>(() => r.openComplete(visit)))!);
  return (visit: visit, general: general, flags: flags);
}

/// The API's online encounter routes, which the phone's test server lacks (lifecycle 5): the visit
/// read, co-sign and attest, each answered as a test scripts it, in front of the test server and the
/// forms routes, and without signal whenever the test server has none.
class EncounterRoutes implements ApiTransport {
  EncounterRoutes(this.h, this.inner);
  final AppHarness h;
  final ApiTransport inner;
  final _answers = <(String, String), Object? Function(Object? body)>{};

  /// What the scripted routes were asked, in order.
  final asked = <({String method, String path, Object? body})>[];

  void on(String method, String path, Object? Function(Object? body) answer) => _answers[(method, path)] = answer;

  /// Answers [method] [path] with the API's refusal.
  void refuse(String method, String path, int status, String code, {Map<String, Object?>? details}) =>
      on(method, path, (_) => throw ApiException(status, code, 'Refused.', details: details));

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    final answer = _answers[(method, path)];
    if (answer == null) return inner.send(method, path, query: query, body: body);
    if (h.server.offline) throw const NetworkException('offline');
    asked.add((method: method, path: path, body: body));
    return answer(body);
  }
}

/// The open team's encounter services made again with [EncounterRoutes] in front of the test server,
/// as the app makes them, for a person with [credential] (the harness's attending's unless given).
Future<EncounterRoutes> withEncounterRoutes(WidgetTester tester, AppHarness h, {String? credential}) async {
  final engine = h.sync.engine!;
  final routes = EncounterRoutes(h, h.forms.transportFor(engine.teamId, h.server.transportFor(me, engine.teamId)));
  final before = h.encounters.user;
  if (credential != null) h.server.credentials[me] = credential;
  final services = EncounterServices(
    OpenTeam(
      userId: me,
      teamId: engine.teamId,
      store: engine.store,
      api: SineobexApi(routes),
      clock: engine.clock,
      permissions: before.permissions.toList(),
    ),
    credential: credential ?? before.credential,
    displayName: before.displayName,
    definitionStore: h.sync.definitions,
    openServerRecord: engine.openServerRecord,
  );
  await syncAndRefresh(tester, h);
  expect(identical(h.encounters, services), isTrue);
  return routes;
}

/// The repository's note actions, for a test to set a scene with.
extension KitNoteActions on EncounterRepository {
  Future<String> addendumTo(WidgetTester tester, String visit, String? note, String text) async =>
      (await tester.runAsync(() => addAddendum(visit, noteId: note, text: text)))!;
}

/// The open bottom sheet's own list, which scrolls apart from the screen under it.
Finder get sheetList => find.descendant(of: find.byType(BottomSheet), matching: find.byType(Scrollable)).first;

/// Scrolls the open sheet until [finder] is built, then into view.
Future<void> revealInSheet(WidgetTester tester, Finder finder) async {
  if (finder.evaluate().isEmpty) {
    try {
      await tester.scrollUntilVisible(finder, 200, scrollable: sheetList, maxScrolls: 30);
    } on StateError {
      await tester.scrollUntilVisible(finder, -200, scrollable: sheetList, maxScrolls: 30);
    }
  }
  await tester.ensureVisible(finder.first);
  await tester.pumpAndSettle();
}

/// Scrolls the open sheet to [finder] and taps it.
Future<void> tapInSheet(WidgetTester tester, Finder finder) async {
  await revealInSheet(tester, finder);
  final rect = tester.getRect(finder.first);
  await tester.tapAt(rect.topLeft + Offset(16, rect.height < 48 ? rect.height / 2 : 24));
  await settle(tester);
}

/// [patientId]'s chart as the server reads it for the person, kept on the phone as opening it online
/// keeps it, with [extra] in the answer: the API's `timeline` and `recentVisits` (5.2), which the
/// phone's test server leaves out.
Future<void> cacheChart(WidgetTester tester, AppHarness h, String patientId, Map<String, Object?> extra) async {
  final offline = h.server.offline;
  h.server.offline = false;
  final read = await tester.runAsync(
    () => h.server.transportFor(me, h.sync.engine!.teamId).send('GET', '/v1/patients/$patientId'),
  );
  h.server.offline = offline;
  final json = jsonDecode(jsonEncode({...read! as Map<String, Object?>, ...extra})) as Map<String, dynamic>;
  importChart(h.sync.store!, PatientChart.fromJson(json), opened: true, now: h.wall);
  h.patients.changed();
  await settle(tester);
}

/// A visit of the chart's timeline (`TimelineVisit`, 5.2).
Map<String, Object?> timelineVisit(
  String id,
  String startedAt, {
  String kind = 'medical',
  String status = 'completed',
  List<Map<String, Object?>> notes = const [],
}) => {'encounterId': id, 'startedAt': startedAt, 'kind': kind, 'status': status, 'notes': notes};

/// A note of a timeline visit (`TimelineNote`).
Map<String, Object?> timelineNote(
  String id,
  String key, {
  String status = 'completed',
  String attestation = 'not_needed',
  String group = 'clinical',
}) => {'noteId': id, 'noteTypeKey': key, 'group': group, 'status': status, 'attestation': attestation};

/// A referral as the chart's timeline lists it (`RecordSnapshot`), recorded by [by].
Map<String, Object?> referralSnapshot(
  String id,
  String patientId, {
  required String referredOn,
  required String details,
  String by = blair,
  String? encounterId,
  String? enteredInError,
}) => {
  'entity': 'referral',
  'id': id,
  'status': 'active',
  'authorUserId': by,
  'createdAt': '${referredOn}T16:00:00.000Z',
  'updatedAt': '${referredOn}T16:00:00.000Z',
  'version': 1,
  'attributes': {
    'patientId': patientId,
    'referredOn': referredOn,
    'details': details,
    'encounterId': encounterId,
    'recordedAt': '${referredOn}T16:00:00.000Z',
    'clockVerified': true,
  },
  'fields': {
    'enteredInError': {
      'value': enteredInError == null ? null : {'reason': enteredInError},
      'version': enteredInError == null ? 0 : 1,
      'changedBy': enteredInError == null ? null : by,
      'changedAt': enteredInError == null ? null : '${referredOn}T17:00:00.000Z',
    },
  },
};
