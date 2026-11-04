import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:sineobex_field/design/tokens.dart';
import 'package:sineobex_field/patients/consent_script.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart' show RefreshReason;

import '../../auth/fakes.dart';
import '../../helpers/app_harness.dart';
import '../../sync/fake_server.dart';

/// What the patient screen tests share: signing in as a field role, the done-when fixture's P1
/// (design 13.1) on the fake server, syncing, and the checks every patient screen must pass.

final fixture =
    jsonDecode(File('../../packages/contract/test-vectors/done-when.json').readAsStringSync()) as Map<String, Object?>;
final p1 = fixture['p1']! as Map<String, Object?>;
final p1Id = p1['id']! as String;

/// The fixture's day, mid-afternoon.
final fixtureNow = DateTime.parse('${fixture['today']}T15:00:00Z');

typedef Run = ({FieldTheme theme, double scale, bool narrow});

/// Every theme, then Day again at 200% text, and on a 320-wide phone: the runs a screen test
/// repeats.
final runs = <Run>[
  for (final t in FieldTheme.values) (theme: t, scale: 1.0, narrow: false),
  (theme: FieldTheme.day, scale: 2.0, narrow: false),
  (theme: FieldTheme.day, scale: 1.0, narrow: true),
];

String runName(Run r) => '${r.theme.name}${r.scale == 1 ? '' : ', 200% text'}${r.narrow ? ', 320 wide' : ''}';

/// Signs in on a fresh harness (Healthcare Staff unless [permissions] says otherwise) and opens
/// the team, at [scale] text size; [narrow] is a 320 × 640 phone.
Future<AppHarness> signIn(
  WidgetTester tester, {
  FieldTheme? theme,
  double scale = 1,
  bool narrow = false,
  List<String>? permissions,
}) async {
  usePhoneSize(tester);
  final h = AppHarness(theme: theme, permissions: permissions ?? FakeSyncServer.healthcareStaff.toList())
    ..wall = fixtureNow;
  await tester.pumpWidget(h.build());
  await tester.pumpAndSettle();
  await enter(tester, 'Email', 'clinician@example.com');
  await enter(tester, 'Password', validPassword);
  await tapText(tester, 'Continue');
  await enter(tester, '6-digit code', validCode);
  await tapText(tester, 'Sign in');
  await enter(tester, 'New PIN', '482913');
  await enter(tester, 'Type it again', '482913');
  await tapText(tester, 'Save PIN');
  await tester.runAsync(h.sync.ready);
  // The sign-in screens have their own tests; the patient screens are what runs at [scale] and
  // [narrow].
  if (narrow) tester.view.physicalSize = const Size(960, 1920);
  if (scale != 1) {
    tester.platformDispatcher.textScaleFactorTestValue = scale;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  }
  await tester.pumpAndSettle();
  return h;
}

/// P1 as db/seed/seed.ts inserts it from the done-when fixture.
void seedP1(FakeSyncServer server) {
  server.seed(entityPatient, {
    'preferredName': p1['preferredName'],
    'legalName': p1['legalName'],
    'birth': p1['birth'],
    'visualDescriptor': p1['visualDescriptor'],
    'usualArea': p1['usualArea'],
    'livingSituation': p1['livingSituation'],
    'preferredLanguage': p1['preferredLanguage'],
    'consent': {
      'id': '5eed0c00-0000-4000-8000-000000000001',
      'decision': 'given',
      'method': 'verbal',
      'scriptVersion': consentScriptVersion,
      'language': 'en',
    },
    'privacyNotice': {'id': '5eed0c00-0000-4000-8000-000000000002', 'decision': 'acknowledged'},
  }, id: p1Id);
  for (final a in (p1['aliases']! as List<Object?>).cast<Map<String, Object?>>()) {
    server.seed(entityAlias, {'patientId': p1Id, 'alias': a['alias']}, id: a['id']! as String);
  }
  for (final a in (p1['allergies']! as List<Object?>).cast<Map<String, Object?>>()) {
    server.seed(entityAllergy, {
      'patientId': p1Id,
      'substance': a['substance'],
      'category': a['category'],
      'severity': a['severity'],
    }, id: a['id']! as String);
  }
}

/// Lets real async work (the fake server, the store) finish, then settles the frames.
Future<void> settle(WidgetTester tester) async {
  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
  await tester.pumpAndSettle();
}

/// A sync and the refreshers (the index, the chart cache), as after a sync with signal.
Future<void> syncAndRefresh(WidgetTester tester, AppHarness h) async {
  await tester.runAsync(() async {
    await h.sync.syncNow();
    await h.sync.refreshNow(reason: RefreshReason.manual);
  });
  await tester.pumpAndSettle();
}

/// Goes to [location] as a tap in the app would (a pushed route).
Future<void> go(WidgetTester tester, String location) async {
  final context = tester.element(find.byType(Navigator).first);
  unawaited(GoRouter.of(context).push(location));
  await settle(tester);
  await settle(tester);
}

/// Opens the Patients tab from the bar.
Future<void> openPatientsTab(WidgetTester tester) async {
  await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Patients')));
  await settle(tester);
}

/// Scrolls the screen's list until [finder] is built, then into view.
Future<void> reveal(WidgetTester tester, Finder finder) async {
  if (finder.evaluate().isEmpty) {
    final scrollable = find.byType(Scrollable).first;
    try {
      await tester.scrollUntilVisible(finder, 200, scrollable: scrollable, maxScrolls: 30);
    } on StateError {
      await tester.scrollUntilVisible(finder, -200, scrollable: scrollable, maxScrolls: 30);
    }
  }
  await tester.ensureVisible(finder.first);
  await tester.pumpAndSettle();
}

/// [finder] is on the screen, once scrolled to: exactly one.
Future<void> expectShown(WidgetTester tester, Finder finder) async {
  await reveal(tester, finder);
  expect(finder, findsOneWidget);
}

/// The PHI field with key `phi.<name>`, scrolled into view.
Future<TextField> fieldNamed(WidgetTester tester, String name) async {
  final field = find.byKey(ValueKey('phi.$name'));
  await reveal(tester, field);
  return tester.widget<TextField>(field);
}

/// Types into a PHI field found by its `phi.` key.
Future<void> type(WidgetTester tester, String name, String text) async {
  final field = find.byKey(ValueKey('phi.$name'));
  await reveal(tester, field);
  await tester.enterText(field, text);
  await tester.pump();
}

/// Scrolls to [finder] and taps it.
Future<void> tapOn(WidgetTester tester, Finder finder) async {
  await reveal(tester, finder);
  // Near the top left: at 200% text a result row can be taller than what the screen shows.
  final rect = tester.getRect(finder.first);
  await tester.tapAt(rect.topLeft + Offset(16, rect.height < 48 ? rect.height / 2 : 24));
  await settle(tester);
}

/// Every text field on screen holds patient details or may: each has a `phi.` key, and none feeds
/// the keyboard's learned words or autocorrect (design 11.1, 13.5).
void expectPrivateFields(WidgetTester tester) {
  final fields = tester.widgetList<TextField>(find.byType(TextField)).toList();
  for (final f in fields) {
    final key = f.key;
    expect(key is ValueKey<String> && key.value.startsWith('phi.'), isTrue, reason: 'a text field without a phi. key');
    expect(f.enableIMEPersonalizedLearning, isFalse, reason: '$key learns words');
    expect(f.autocorrect, isFalse, reason: '$key autocorrects');
    expect(f.enableSuggestions, isFalse, reason: '$key suggests');
  }
}

/// The guidelines on what is on screen, and the private fields.
Future<void> expectScreenOk(WidgetTester tester) async {
  await expectGuidelines(tester);
  expectPrivateFields(tester);
}

/// No legal name of P1 anywhere on screen, in text or in what a screen reader hears (D40).
void expectNoLegalName(WidgetTester tester) {
  for (final part in ['Delbert', 'Smithfield']) {
    expect(find.textContaining(part), findsNothing);
    expect(find.bySemanticsLabel(RegExp(part)), findsNothing);
  }
}

/// The outbox's audit entries' events, in order.
List<String> auditEvents(LocalStore store) => [
  for (final e in store.outbox())
    if (e.entity == entityAudit) (e.value! as Map<String, Object?>)['action']! as String,
];
