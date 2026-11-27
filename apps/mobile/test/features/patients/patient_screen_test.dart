import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show LogicalKeyboardKey;
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/transport.dart' show NetworkException;
import 'package:sineobex_field/features/patients/flag_sheet.dart' show changeFlagsAction, flagSentForReviewText;
import 'package:sineobex_field/features/patients/patient_screen.dart';
import 'package:sineobex_field/presets/preset_store.dart';
import 'package:sineobex_field/sync/entities.dart' show entityFlagChange;
import 'package:sineobex_field/sync/local_store.dart';

import '../../sync/fake_server.dart';

import 'patient_kit.dart';

/// The profile (design 12.1): the header read first as one summary with the allergy badge right
/// after it, the sections, banners (merged, consent not recorded, two values), and Copy ID link with
/// two cards after a merge. Three themes, 200% text and 320 wide.
void main() {
  const otherStaff = 'c0000000-0000-4000-8000-0000000000c2';

  for (final run in runs) {
    testWidgets('Del’s profile: one summary, the badge, the sections (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
      seedP1(h.server);
      h.server.seed(entityProblem, {'patientId': p1Id, 'title': 'Demo: cough', 'status': 'ongoing'});
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      expect(find.byType(PatientScreen), findsOneWidget);
      // A generic title: the app switcher never shows the patient.
      expect(find.widgetWithText(AppBar, 'Patient'), findsOneWidget);

      final header = find.bySemanticsLabel('Del, age 80, born March 7, 1946, allergy: penicillin, severe');
      expect(header, findsOneWidget);
      expect(tester.getSemantics(header), isSemantics(isHeader: true));
      // The badge comes straight after the name, in words with its own icon.
      final badge = find.bySemanticsLabel('Allergy: penicillin, severe');
      expect(badge, findsOneWidget);
      expect(tester.getRect(badge).top, greaterThan(tester.getRect(header).top));
      expect(find.text('Allergy: penicillin (severe)'), findsOneWidget);
      // The legal name shows on the chart's own profile only.
      await expectShown(tester, find.text('Legal name: Delbert Smithfield'));
      await expectScreenOk(tester);

      for (final section in [
        'Problems',
        'Allergies',
        'Street names',
        'Consent',
        'Street Medicine ID card',
        'History',
      ]) {
        final heading = find.text(section);
        await expectShown(tester, heading);
        expect(tester.getSemantics(heading), isSemantics(isHeader: true));
      }
      await expectShown(tester, find.bySemanticsLabel(RegExp(r'^Demo: cough, Ongoing, No code')));
      await expectShown(tester, find.text('No card yet.'));
      await expectScreenOk(tester);
      handle.dispose();
    });
  }

  testWidgets('two cards after a merge: Copy ID link asks which, and says the link clears', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    final p2 = h.server.seedPatient(preferredName: 'Demo Smitty');
    for (final (patient, token) in [(p1Id, 'AAAAAAAAAAAAAAAAAAAAAA'), (p2, 'BBBBBBBBBBBBBBBBBBBBBB')]) {
      h.server.seed(entityIdLink, {
        'patientId': patient,
        'token': token,
        'replacesLinkId': null,
        'reason': 'first_card',
      });
    }
    h.server.merge(p2, p1Id);
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    await expectShown(tester, find.text('2 cards open this chart (two records were merged).'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Copy ID link'));
    expect(find.text('Copy which card’s link?'), findsOneWidget);
    await expectGuidelines(tester);
    await tapOn(tester, find.textContaining('Card made').first);
    final copied = find.text('Link copied. It clears in 60 seconds.');
    await expectShown(tester, copied);
    expect(tester.getSemantics(copied), isSemantics(isLiveRegion: true));
    expect(h.copied.single, matches(RegExp(r'^http://localhost:3100/c#[A-Z]{22}$')));
    expect([
      for (final e in h.sync.store!.outbox())
        if (e.entity == entityAudit) (e.value! as Map)['action'],
    ], contains('id_link.copied'));

    // The merged record opens with the banner, and editing from it is off.
    await go(tester, '/patients/$p2');
    await expectShown(tester, find.text('This chart was merged into another on Oct 22. Open the combined chart.'));
    expect(find.widgetWithText(OutlinedButton, 'Edit'), findsNothing);
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('consent not recorded: the banner, and Record consent now', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    final id = h.server.seed(entityPatient, {
      'preferredName': 'Demo Ash',
      'consent': {
        'id': '5eed0c00-0000-4000-8000-0000000000a1',
        'decision': 'unable',
        'method': 'not_applicable',
        'reason': 'In crisis',
        'scriptVersion': '2026-10-1',
        'language': 'en',
      },
      'privacyNotice': {'id': '5eed0c00-0000-4000-8000-0000000000a2', 'decision': 'unable', 'reason': 'In crisis'},
    });
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$id');
    await expectShown(tester, find.text('Consent not recorded yet. Ask at the next visit.'));
    await tapOn(tester, find.text('Record consent now'));
    await tapOn(tester, find.text('Agrees'));
    await expectGuidelines(tester);
    await tapOn(tester, find.text('Save'));
    final consent = h.sync.store!.outbox().singleWhere((e) => e.entity == entityConsent);
    expect((consent.value! as Map)['decision'], 'given');
    expect(find.text('Consent not recorded yet. Ask at the next visit.'), findsNothing);
    handle.dispose();
  });

  testWidgets('two values recorded: the banner, and the review offline is read-only', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    // A teammate changes where Del is found; this phone, not having seen it, changes it too.
    h.server.serverEdit(p1Id, 'usualArea', 'Demo: by the river', by: otherStaff);
    h.patients.patients.update(p1Id, {'usualArea': 'Demo: by the library steps'});
    await syncAndRefresh(tester, h);
    await tester.runAsync(() => h.patients.patients.open(p1Id));
    await settle(tester);
    await expectShown(tester, find.text('Two values for Usually found'));
    h.server.offline = true;
    await tester.runAsync(() => h.sync.syncNow());
    await settle(tester);
    await tapOn(tester, find.bySemanticsLabel('Choose the value for Usually found'));
    expect(find.text('Which is right?'), findsOneWidget);
    await expectShown(tester, find.text('Connect to save a choice. Until then both values stay on the chart.'));
    final save = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save choice'));
    expect(save.onPressed, isNull);
    await expectGuidelines(tester);
    handle.dispose();
  });

  testWidgets('focus goes to the list’s Add button once a row’s own action is used', (tester) async {
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    bool focused(Finder inside) => Focus.of(tester.element(inside)).hasPrimaryFocus;

    /// With a keyboard, or a switch: [action] is focused, pressed, and the reason given.
    Future<void> use(Finder action, {required String reason, required String confirm}) async {
      await reveal(tester, action);
      Focus.of(tester.element(action)).requestFocus();
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await settle(tester);
      await tapOn(tester, find.widgetWithText(ActionChip, reason));
      await tapOn(tester, find.widgetWithText(FilledButton, confirm));
    }

    await use(find.text('Remove'), reason: 'Typed by mistake', confirm: 'Remove');
    expect(h.sync.store!.outbox().where((e) => e.field == 'removal'), hasLength(1));
    expect(find.text('Remove'), findsNothing);
    expect(focused(find.text('Add street name')), isTrue);

    await use(find.text('Entered in error'), reason: 'Not an allergy', confirm: 'Mark entered in error');
    expect(h.sync.store!.outbox().where((e) => e.field == 'enteredInError'), hasLength(1));
    expect(focused(find.text('Add allergy')), isTrue);
  });

  group('a store frozen for a hand-over shows no chart, because it can log no view (V1)', () {
    const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';

    for (final run in runs) {
      testWidgets('opening the chart says why, reads nothing and logs nothing (${runName(run)})', (tester) async {
        final handle = tester.ensureSemantics();
        final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
        seedP1(h.server);
        await syncAndRefresh(tester, h);
        h.server.offline = true;
        final store = h.sync.store!..freeze(frozen);
        final before = auditEvents(store).length;
        await go(tester, '/patients/$p1Id');
        expect(find.text(frozen), findsOneWidget);
        expect(find.text('Del'), findsNothing);
        expectNoLegalName(tester);
        expect(auditEvents(store), hasLength(before));
        await expectScreenOk(tester);
        handle.dispose();
      });
    }

    testWidgets('a freeze while the open waits for the server: the chart is never read', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      // The chart is on the phone from an earlier open.
      await tester.runAsync(() => h.patients.patients.open(p1Id));
      final store = h.sync.store!;
      final before = auditEvents(store).length;
      // The hand-over starts while the screen asks the server for the chart, and the signal goes.
      h.server.onRequest = (path) {
        if (path != '/v1/patients/charts') return;
        store.freeze(frozen);
        throw const NetworkException('offline');
      };
      await go(tester, '/patients/$p1Id');
      expect(find.text(frozen), findsOneWidget);
      expect(find.text('Del'), findsNothing);
      expectNoLegalName(tester);
      expect(auditEvents(store), hasLength(before));

      // Access comes back before the hand-over ends. The view that was refused was never logged,
      // so the chart still isn't shown: it shows when it is opened again.
      h.server.onRequest = null;
      store.unfreeze();
      await tester.runAsync(() => h.sync.syncNow());
      await settle(tester);
      expect(find.text('Del'), findsNothing);
      expectNoLegalName(tester);
    });

    testWidgets('a chart on screen goes when the store freezes', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      await expectShown(tester, find.text('Legal name: Delbert Smithfield'));
      h.server.offline = true;
      h.sync.store!.freeze(frozen);
      // The controller tells its listeners after a freeze (here, a sync that finds no signal).
      await tester.runAsync(() => h.sync.syncNow());
      await settle(tester);
      expect(find.text(frozen), findsOneWidget);
      expect(find.text('Del'), findsNothing);
      expectNoLegalName(tester);
    });

    // The chart's read refuses while frozen. A screen rebuilds for more than the controller (its
    // services, its own state), and none of those may reach the read.
    testWidgets('a rebuild for the patient services while frozen reads nothing, on any chart screen', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      final cough = h.server.seed(entityProblem, {'patientId': p1Id, 'title': 'Demo: cough', 'status': 'new'});
      await syncAndRefresh(tester, h);
      await openPatientsTab(tester);
      await go(tester, '/patients/$p1Id');
      await expectShown(tester, find.text('Legal name: Delbert Smithfield'));
      for (final over in [null, '/patients/$p1Id/problems/$cough', '/patients/$p1Id/card']) {
        if (over != null) await go(tester, over);
        // The hand-over starts, and before the controller says so a download ends.
        h.sync.store!.freeze(frozen);
        h.patients.changed();
        await tester.pump();
        expect(tester.takeException(), isNull, reason: 'over ${over ?? 'nothing'}');
        expect(find.text(frozen), findsOneWidget);
        expect(find.text('Del'), findsNothing);
        expect(find.text('Demo: cough'), findsNothing);
        expectNoLegalName(tester);
        // Access is back, for the next screen.
        h.sync.store!.unfreeze();
        h.patients.changed();
        await settle(tester);
      }
    });

    testWidgets('a change refused by the freeze shows why in place of the chart', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      await tapOn(tester, find.text('Add street name'));
      await type(tester, 'newAlias', 'Demo Red');
      // Frozen with nothing told yet, so the dialog's own gate (VA-4) has not heard: the write is
      // what refuses.
      h.sync.store!.freeze(frozen);
      await tapOn(tester, find.widgetWithText(FilledButton, 'Add'));
      expect(tester.takeException(), isNull);
      expect(find.text(frozen), findsOneWidget);
      expect(find.text('Del'), findsNothing);
      expectNoLegalName(tester);
      expect(h.sync.store!.outbox().where((e) => e.entity == entityAlias), isEmpty);
    });
  });

  // A dialog or a sheet is not under the profile's gate: each sits in its own (phase 3's V1).
  group('what the profile asks goes when the store freezes for a hand-over (V1)', () {
    const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';

    Future<AppHarness> openDel(WidgetTester tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      return h;
    }

    for (final (how, tell) in <(String, Future<void> Function(WidgetTester, AppHarness))>[
      // A sync that finds no signal.
      ('the controller says so', (tester, h) => tester.runAsync(() => h.sync.syncNow())),
      ('a download ends before the controller says so', (tester, h) async => h.patients.changed()),
    ]) {
      /// The open dialog shows [named]; the store freezes and [tell] says so. The dialog closes as
      /// its Cancel would, with what it named, nothing is written or logged, and the profile says why.
      Future<void> freezeUnder(WidgetTester tester, AppHarness h, Finder named) async {
        expect(find.descendant(of: find.byType(Dialog), matching: named), findsOneWidget);
        h.server.offline = true;
        final store = h.sync.store!;
        final before = store.outbox().length;

        store.freeze(frozen);
        await tell(tester, h);
        await settle(tester);
        expect(tester.takeException(), isNull);
        expect(find.byType(Dialog), findsNothing);
        expect(find.descendant(of: find.byType(Navigator), matching: named), findsNothing);
        expect(find.text(frozen), findsOneWidget);
        expectNoLegalName(tester);
        expect(store.outbox(), hasLength(before));
      }

      testWidgets('Remove a street name: the question goes, naming it: $how', (tester) async {
        final h = await openDel(tester);
        await tapOn(tester, find.text('Remove'));
        await freezeUnder(tester, h, find.text('Remove “Smitty”?'));
      });

      // Review finding VA-4: what is typed is a patient's identifier.
      testWidgets('Add a street name: the dialog goes with the name typed into it: $how', (tester) async {
        final h = await openDel(tester);
        await tapOn(tester, find.text('Add street name'));
        await type(tester, 'newAlias', 'Demo Red');
        await freezeUnder(tester, h, find.text('Demo Red'));
        expect(find.text('Demo Red', skipOffstage: false), findsNothing);
        expect(h.sync.store!.outbox().where((e) => e.entity == entityAlias), isEmpty);
      });

      testWidgets('an allergy’s Entered in error: the question goes, naming it: $how', (tester) async {
        final h = await openDel(tester);
        await tapOn(tester, find.text('Entered in error'));
        await freezeUnder(tester, h, find.text('Mark “penicillin” entered in error?'));
      });

      testWidgets('Copy ID link with two cards: the question goes, with the cards’ dates: $how', (tester) async {
        final h = await signIn(tester);
        seedP1(h.server);
        final p2 = h.server.seedPatient(preferredName: 'Demo Smitty');
        for (final (patient, token) in [(p1Id, 'AAAAAAAAAAAAAAAAAAAAAA'), (p2, 'BBBBBBBBBBBBBBBBBBBBBB')]) {
          h.server.seed(entityIdLink, {
            'patientId': patient,
            'token': token,
            'replacesLinkId': null,
            'reason': 'first_card',
          });
        }
        h.server.merge(p2, p1Id);
        await syncAndRefresh(tester, h);
        await go(tester, '/patients/$p1Id');
        await tapOn(tester, find.widgetWithText(FilledButton, 'Copy ID link'));
        expect(find.textContaining('Card made'), findsNWidgets(2));
        await freezeUnder(tester, h, find.text('Copy which card’s link?'));
        expect(find.textContaining('Card made', skipOffstage: false), findsNothing);
        expect(h.copied, isEmpty);
      });

      testWidgets('Add allergy: the sheet keeps only why, and nothing is added: $how', (tester) async {
        final h = await openDel(tester);
        await tapOn(tester, find.text('Add allergy'));
        await type(tester, 'allergySubstance', 'Demo: latex');
        h.server.offline = true;

        h.sync.store!.freeze(frozen);
        await tell(tester, h);
        await settle(tester);
        expect(tester.takeException(), isNull);
        expect(find.descendant(of: find.byType(BottomSheet), matching: find.text(frozen)), findsOneWidget);
        expect(find.text('Demo: latex', skipOffstage: false), findsNothing);
        expect(find.byKey(const ValueKey('phi.allergySubstance'), skipOffstage: false), findsNothing);

        // Closing it adds nothing.
        await tester.binding.handlePopRoute();
        await settle(tester);
        expect(find.byType(BottomSheet), findsNothing);
        expect(h.sync.store!.outbox().where((e) => e.entity == entityAllergy), isEmpty);
      });
    }
  });

  // Phase 5 (design 8.2; cards P5-phone-sheet and P5-status-check), written ahead of their code: the
  // header's flag pills, never by colour alone, an archived flag's words, Sent for review, names from
  // the chart where the presets aren't held; and Status check due on the problem list.
  group('the profile’s flags (phase 5 design 8.2)', () {
    Map<String, Object?> flag(String name, String tier, String color, int rank) => {
      'name': name,
      'tier': tier,
      'criteria': '',
      'color': color,
      'rank': rank,
      'sensitive': false,
    };

    String change(AppHarness h, String flagId, {String action = 'set'}) => h.server.seed(entityFlagChange, {
      'patientId': p1Id,
      'flagId': flagId,
      'action': action,
      'reason': 'Demo: seen under the bridge',
    }, by: otherStaff);

    for (final run in runs) {
      testWidgets('the risk level and conditions show as pills that say their colour and name, offline '
          '(${runName(run)})', (tester) async {
        final handle = tester.ensureSemantics();
        final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
        seedP1(h.server);
        final team = h.patients.teamId;
        change(h, h.server.addPreset(team, 'flag', flag('Demo: High', 'primary', 'red', 10)));
        change(h, h.server.addPreset(team, 'flag', flag('Demo: Frost risk', 'secondary', 'blue', 10)));
        await syncAndRefresh(tester, h);
        await go(tester, '/patients/$p1Id');
        h.server.offline = true;
        await go(tester, '/patients/$p1Id');
        for (final (text, spoken) in [
          ('Red · Demo: High', 'Red, Demo: High'),
          ('Blue · Demo: Frost risk', 'Blue, Demo: Frost risk'),
        ]) {
          await expectShown(tester, find.text(text));
          expect(find.bySemanticsLabel(spoken), findsOneWidget);
        }
        await expectScreenOk(tester);
        handle.dispose();
      });
    }

    testWidgets('no flags: no pill and no words about them, only the flags row to set one', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      h.server.addPreset(h.patients.teamId, 'flag', flag('Demo: High', 'primary', 'red', 10));
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      await expectShown(tester, find.widgetWithText(OutlinedButton, changeFlagsAction));
      expect(find.textContaining('Demo: High'), findsNothing);
      expect(find.text('Sent for review'), findsNothing);
    });

    testWidgets('an archived flag the patient carries says it is no longer on the team’s list', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      final team = h.patients.teamId;
      final frost = h.server.addPreset(team, 'flag', flag('Demo: Frost risk', 'secondary', 'blue', 10));
      change(h, frost);
      h.server.archivePreset(team, frost);
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      await expectShown(tester, find.text('Blue · Demo: Frost risk'));
      await expectShown(tester, find.text('No longer on the team’s list'));
      await expectScreenOk(tester);
    });

    testWidgets('a change of this phone’s the server holds for review shows as Sent for review', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      final high = h.server.addPreset(h.patients.teamId, 'flag', flag('Demo: High', 'primary', 'red', 10));
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      // The person's role lost patients.edit at the desk; the phone set the flag before it knew.
      h.server.permissions[h.patients.userId] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
      h.sync.store!.createRecord(entityFlagChange, {
        'patientId': p1Id,
        'flagId': high,
        'action': 'set',
        'reason': 'Demo: left hospital',
      });
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      await expectShown(tester, find.text('Sent for review'));
      expect(find.text('Red · Demo: High'), findsNothing);
    });

    // Review finding F4: the server holds a mark of this phone's for review, so the flag still counts.
    testWidgets('a mark the server holds for review shows as Sent for review, and its flag stays, struck nowhere', (
      tester,
    ) async {
      final h = await signIn(tester);
      seedP1(h.server);
      final high = h.server.addPreset(h.patients.teamId, 'flag', flag('Demo: High', 'primary', 'red', 10));
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      final store = h.sync.store!;
      final id = store.createRecord(entityFlagChange, {
        'patientId': p1Id,
        'flagId': high,
        'action': 'set',
        'reason': 'Demo: left hospital',
      });
      await syncAndRefresh(tester, h);
      // The person's role lost patients.edit at the desk; the phone marked the change before it knew.
      h.server.permissions[h.patients.userId] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
      store.setField(id, 'enteredInError', {'reason': 'Demo: set on the wrong patient'});
      await syncAndRefresh(tester, h);
      expect(store.outbox().where((e) => e.entity == entityFlagChange), isEmpty, reason: 'held there');
      await go(tester, '/patients/$p1Id');
      await expectShown(tester, find.text('Sent for review'));
      await expectShown(tester, find.text('Red · Demo: High'));

      await tapOn(tester, find.widgetWithText(OutlinedButton, changeFlagsAction));
      final row = find.descendant(of: find.byType(BottomSheet), matching: find.text('Set Red · Demo: High'));
      await tester.ensureVisible(row);
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(row).style?.decoration, isNot(TextDecoration.lineThrough));
      expect(find.descendant(of: find.byType(BottomSheet), matching: find.text(flagSentForReviewText)), findsOneWidget);
      await expectScreenOk(tester);
    });

    testWidgets('where the presets aren’t held, the pills are named as the chart names them', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      change(h, h.server.addPreset(h.patients.teamId, 'flag', flag('Demo: High', 'primary', 'red', 10)));
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      h.server.offline = true;
      PresetStore(h.sync.store!).clear();
      await go(tester, '/patients/$p1Id');
      await expectShown(tester, find.text('Red · Demo: High'));
    });

    group('Status check due on the problem list (5.3; section 11, row 21)', () {
      String settings(AppHarness h, int days) => h.server.addPreset(h.patients.teamId, 'settings', {
        'name': 'Team settings',
        'bagMinimumsOn': false,
        'newBagMinimums': <Object?>[],
        'problemCheckDays': days,
      });

      String problem(AppHarness h, String title, String status, {required Duration ago}) {
        final id = h.server.seed(entityProblem, {
          'patientId': p1Id,
          'title': title,
          'status': status == 'resolved' ? 'ongoing' : status,
        }, at: h.wall.subtract(ago));
        if (status == 'resolved') {
          // No create is Resolved, and a set is dated now: its check time is put back by hand, as the
          // API's tests date one.
          h.server.serverEdit(id, 'status', {'status': 'resolved', 'encounterId': null}, by: otherStaff);
          h.server.records[id]!.checkedAt = h.wall.subtract(ago);
        }
        return id;
      }

      for (final run in runs) {
        testWidgets('beside a New or Ongoing problem not checked within the team’s window, offline '
            '(${runName(run)})', (tester) async {
          final handle = tester.ensureSemantics();
          final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
          seedP1(h.server);
          settings(h, 90);
          problem(h, 'Demo: cough', 'ongoing', ago: const Duration(days: 91));
          problem(h, 'Demo: rash', 'new', ago: const Duration(days: 10));
          await syncAndRefresh(tester, h);
          await go(tester, '/patients/$p1Id');
          h.server.offline = true;
          await go(tester, '/patients/$p1Id');
          final due = find.bySemanticsLabel(RegExp(r'^Demo: cough, Ongoing, .*status check due'));
          await expectShown(tester, due);
          expect(find.text('Status check due'), findsOneWidget);
          expect(find.bySemanticsLabel(RegExp(r'^Demo: rash, New, .*status check due')), findsNothing);
          await expectScreenOk(tester);
          handle.dispose();
        });
      }

      testWidgets('never beside a Resolved problem, and nowhere where the presets aren’t held', (tester) async {
        final h = await signIn(tester);
        seedP1(h.server);
        settings(h, 90);
        problem(h, 'Demo: old burn', 'resolved', ago: const Duration(days: 200));
        problem(h, 'Demo: cough', 'ongoing', ago: const Duration(days: 200));
        await syncAndRefresh(tester, h);
        await go(tester, '/patients/$p1Id');
        // The problem list sits below the header: each row is scrolled to before it is read.
        await expectShown(tester, find.bySemanticsLabel(RegExp(r'^Demo: cough, Ongoing, .*status check due')));
        expect(find.text('Status check due'), findsOneWidget);
        // The Resolved one, opened: never due, however long ago its status was checked.
        await tapOn(tester, find.text('Resolved (1)'));
        final burn = find.bySemanticsLabel(RegExp(r'^Demo: old burn, Resolved'));
        await expectShown(tester, burn);
        expect(tester.getSemantics(burn).label, isNot(contains('status check due')));
        h.server.offline = true;
        PresetStore(h.sync.store!).clear();
        await go(tester, '/patients/$p1Id');
        await expectShown(tester, find.bySemanticsLabel(RegExp(r'^Demo: cough, Ongoing')));
        expect(find.text('Status check due'), findsNothing);
        expect(find.bySemanticsLabel(RegExp('status check due')), findsNothing);
      });
    });
  });
}
