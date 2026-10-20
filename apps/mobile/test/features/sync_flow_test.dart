import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/auth/session_controller.dart';
import 'package:sineobex_field/design/tokens.dart';
import 'package:sineobex_field/sync/local_db.dart';
import 'package:sineobex_field/sync/local_store.dart';

import '../auth/fakes.dart';
import '../helpers/app_harness.dart';

/// The Phase 2 screens: sync status, the clock pause, Needs attention with conflicts side by side,
/// signing out with unsynced work, remote wipe and removal. Every screen is checked against the
/// guidelines in all three themes.
void main() {
  Future<AppHarness> signedIn(WidgetTester tester, {FieldTheme? theme}) async {
    usePhoneSize(tester);
    final h = AppHarness(theme: theme);
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
    await tester.pumpAndSettle();
    return h;
  }

  LocalStore storeOf(AppHarness h) => h.sync.store!;

  Future<void> syncNow(WidgetTester tester, AppHarness h) async {
    await tester.runAsync(() => h.sync.syncNow());
    await tester.pumpAndSettle();
  }

  for (final theme in FieldTheme.values) {
    testWidgets('offline charting shows what waits, and syncing clears it (${theme.name})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signedIn(tester, theme: theme);
      expect(find.text('All saved to the server'), findsOneWidget);
      await expectGuidelines(tester);

      h.server.offline = true;
      final store = storeOf(h);
      final encounter = store.createEncounter(kind: 'medical');
      store.createNote(encounterId: encounter, noteTypeKey: 'vitals', data: {'temp_c': 38.2});
      await syncNow(tester, h);
      expect(find.text('No connection'), findsOneWidget);
      expect(find.textContaining('2 changes saved on this phone'), findsOneWidget);
      await expectGuidelines(tester);

      h.server.offline = false;
      await tapText(tester, 'Sync now');
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pumpAndSettle();
      expect(find.text('All saved to the server'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a conflict is shown side by side and the choice resolves it (${theme.name})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signedIn(tester, theme: theme);
      final store = storeOf(h);
      final encounter = store.createEncounter(kind: 'medical');
      final note = store.createNote(encounterId: encounter, noteTypeKey: 'vitals', data: {'temp_c': 38.2});
      await syncNow(tester, h);
      // A teammate changes the temperature on the server; this phone changes it too.
      h.server.serverEdit(note, 'data.temp_c', 38.6, by: 'c0000000-0000-4000-8000-00000000000c');
      store.setField(note, 'data.temp_c', 39.1);
      await syncNow(tester, h);

      expect(find.text('Needs attention'), findsOneWidget);
      await expectGuidelines(tester);
      await tapText(tester, 'Needs attention');
      expect(find.text('Temp c'), findsOneWidget);
      expect(find.text('Your value'), findsOneWidget);
      expect(find.text('39.1'), findsOneWidget);
      expect(find.textContaining('A teammate'), findsOneWidget);
      expect(find.text('38.6'), findsOneWidget);
      await expectGuidelines(tester);

      await tapText(tester, 'Use my value');
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pumpAndSettle();
      expect(find.text('Nothing needs attention.'), findsOneWidget);
      expect(h.server.records[note]!.fields['data.temp_c']!.value, 39.1);
      handle.dispose();
    });

    testWidgets('a clock 7 minutes off pauses charting until Check again finds it right (${theme.name})', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final h = await signedIn(tester, theme: theme);
      h.serverAhead = const Duration(minutes: 7);
      await syncNow(tester, h);
      expect(find.text('Charting is paused'), findsOneWidget);
      expect(find.textContaining('7 minutes behind the server'), findsOneWidget);
      await expectGuidelines(tester);
      expect(() => storeOf(h).createEncounter(kind: 'medical'), throwsA(isA<ChartingPaused>()));

      // The person turns on automatic time: the phone's clock jumps forward to the server's.
      h.wall = h.wall.add(const Duration(minutes: 7));
      h.serverAhead = Duration.zero;
      await tapText(tester, 'Check again');
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pumpAndSettle();
      expect(find.text('Charting is paused'), findsNothing);
      storeOf(h).createEncounter(kind: 'medical');
      handle.dispose();
    });

    testWidgets('signing out with unsynced work shows progress and keeps the data (${theme.name})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signedIn(tester, theme: theme);
      h.server.offline = true;
      final store = storeOf(h);
      final encounter = store.createEncounter(kind: 'medical');
      store.createNote(encounterId: encounter, noteTypeKey: 'vitals', data: {'temp_c': 38.2});
      store.appendAudit('patient.viewed', entity: 'patient', entityId: encounter);
      await tester.pumpAndSettle();

      await tapText(tester, 'Sign out');
      expect(find.text('Some records haven’t synced'), findsOneWidget);
      expect(find.text('Patient encounters: 0%'), findsOneWidget);
      expect(find.text('Notes: 0%'), findsOneWidget);
      expect(find.text('Activity log: 0%'), findsOneWidget);
      await expectGuidelines(tester);

      await tapText(tester, 'Sign out anyway');
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pumpAndSettle();
      expect(h.session.state, isA<SignedOut>());
      expect(find.textContaining('Unsynced records stay encrypted on this phone'), findsOneWidget);
      expect(LocalDatabase.filesForUser(h.dir.path, demoUser().userId), hasLength(1));

      // Signing in again on this phone asks for the same PIN, and the records are still there.
      await enter(tester, 'Email', 'clinician@example.com');
      await enter(tester, 'Password', validPassword);
      await tapText(tester, 'Continue');
      await enter(tester, '6-digit code', validCode);
      await tapText(tester, 'Sign in');
      expect(find.text('Choose a PIN'), findsNothing);
      await enter(tester, 'PIN', '482913');
      await tapText(tester, 'Unlock');
      await tester.runAsync(h.sync.ready);
      await tester.pumpAndSettle();
      expect(storeOf(h).unsynced().total, 3);
      h.server.offline = false;
      await syncNow(tester, h);
      expect(storeOf(h).unsynced().total, 0);
      handle.dispose();
    });
  }

  testWidgets('waiting in the sign-out dialog finishes the sync and then signs out cleanly', (tester) async {
    final h = await signedIn(tester);
    storeOf(h).createEncounter(kind: 'medical');
    await tester.pumpAndSettle();
    await tapText(tester, 'Sign out');
    await tapText(tester, 'Wait');
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
    expect(h.session.state, isA<SignedOut>());
    expect(find.text('You have signed out.'), findsOneWidget);
    // Nothing was left unsynced, so nothing is left on the phone.
    expect(LocalDatabase.filesForUser(h.dir.path, demoUser().userId), isEmpty);
  });

  testWidgets('a remote wipe erases the team’s data and signs out with a notice', (tester) async {
    final h = await signedIn(tester);
    storeOf(h).createEncounter(kind: 'medical');
    await syncNow(tester, h);
    h.server.devices.values.single.status = 'wipe_requested';
    storeOf(h).createEncounter(kind: 'non_medical');
    await syncNow(tester, h);
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
    expect(h.session.state, isA<SignedOut>());
    expect(find.textContaining('An administrator erased'), findsOneWidget);
    expect(LocalDatabase.filesForUser(h.dir.path, demoUser().userId), isEmpty);
    expect(h.server.devices.values.single.status, 'wiped');
  });

  testWidgets('removed from the team: unsynced work goes to quarantine, then the phone wipes', (tester) async {
    final h = await signedIn(tester);
    await syncNow(tester, h);
    final store = storeOf(h);
    final encounter = store.createEncounter(kind: 'medical');
    store.createNote(encounterId: encounter, noteTypeKey: 'vitals', data: {'temp_c': 38.2});
    h.server.removedUsers.add(demoUser().userId);
    await syncNow(tester, h);
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
    expect(h.server.quarantine, hasLength(2));
    expect(h.session.state, isA<SignedOut>());
    expect(find.textContaining('sent to a Program Admin to review'), findsOneWidget);
    expect(LocalDatabase.filesForUser(h.dir.path, demoUser().userId), isEmpty);
  });

  testWidgets('a refused sign-in alone never deletes anything', (tester) async {
    final h = await signedIn(tester);
    storeOf(h).createEncounter(kind: 'medical');
    // The server refuses the sign-in, but the device-key check says the phone and person are fine.
    h.server.refuseCode = 'team_suspended';
    await syncNow(tester, h);
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
    expect(h.session.state, isA<Unlocked>());
    expect(storeOf(h).unsynced().total, 1);
    expect(h.server.quarantine, isEmpty);
    expect(LocalDatabase.filesForUser(h.dir.path, demoUser().userId), hasLength(1));
  });
}
