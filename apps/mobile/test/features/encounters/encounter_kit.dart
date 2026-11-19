import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/encounters/encounter_services.dart';
import 'package:sineobex_field/features/encounters/encounter_screen.dart';
import 'package:sineobex_field/forms/definition.dart';
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

/// The note [noteId] opened, where its form is (`/notes/<id>`, lifecycle 9.5). Until the note screen
/// (card L5-note-screen) registers that route, the router draws its own page for a location it lacks,
/// which overflows a phone: that page is not this unit's, and its layout error is dropped.
void expectNoteOpened(WidgetTester tester, String noteId) {
  expect(location(tester), '/notes/$noteId');
  while (tester.takeException() != null) {}
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

/// Back from the route on top, as the system's back does (the router's own page for a location it
/// lacks has no back button).
Future<void> back(WidgetTester tester) async {
  GoRouter.of(tester.element(find.byType(Navigator).first)).pop();
  await settle(tester);
}
