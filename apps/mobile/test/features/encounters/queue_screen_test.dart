import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_api.dart' show SecondAct;
import 'package:sineobex_field/features/encounters/queue_screen.dart';

import '../../encounters/scripted_api.dart' show userRef;
import 'encounter_kit.dart';

/// Home's queue tiles and the queues (lifecycle 5.4, 9.9; card L5-queues): **Waiting for your
/// co-signature** to a credential that signs, **Waiting for attestation** to one that attests, each
/// with the server's number online and "Connect to see notes waiting for you" offline; a queue lists
/// one row per visit with the patient's preferred name, when it started and each waiting note by its
/// author, says why a note can't be acted on, and opens the visit. Online only: the phone's test
/// server has no queue routes, so each test answers them as the API does. Three themes, 200% text,
/// 320 wide.
void main() {
  const v1 = 'e0000000-0000-4000-8000-0000000000d1';
  const v2 = 'e0000000-0000-4000-8000-0000000000d2';
  const n1 = 'f0000000-0000-4000-8000-0000000000d3';
  const n2 = 'f0000000-0000-4000-8000-0000000000d4';
  const n3 = 'f0000000-0000-4000-8000-0000000000d5';
  const n4 = 'f0000000-0000-4000-8000-0000000000d6';
  const avery = 'a0000000-0000-4000-8000-0000000000a7';
  final blairRef = userRef(blair, blairName);
  final meRef = userRef(me, 'Jordan Lee (demo)');

  /// A time as the screens word one: a date, "at", a time.
  const at = r' at \d{1,2}:\d{2}\s?[AP]M';

  Map<String, Object?> queueNote(
    String id,
    String key,
    Map<String, Object?> author, {
    bool canAct = true,
    String? heldBecause,
  }) => {
    'noteId': id,
    'noteTypeKey': key,
    'author': author,
    'completedAt': '2026-10-20T16:00:00.000Z',
    'signedBefore': null,
    'attestedBefore': null,
    'canAct': canAct,
    'heldBecause': ?heldBecause,
  };

  /// Two visits of P1: Demo Blair's note the person may act on, and one of the person's own, with a
  /// note of Blair's they can't, signed before a correction sent it back.
  Map<String, Object?> queue() => {
    'rows': [
      {
        'encounterId': v1,
        'patientId': p1Id,
        'preferredName': 'Del',
        'startedAt': '2026-10-20T15:00:00.000Z',
        'notes': [queueNote(n1, 'general_primary_care', blairRef)],
      },
      {
        'encounterId': v2,
        'patientId': p1Id,
        'preferredName': 'Del',
        'startedAt': '2026-10-21T15:00:00.000Z',
        'notes': [
          queueNote(n2, 'wound_care', meRef, canAct: false, heldBecause: 'wrote'),
          // Given to the person after Blair left: they act as its author, and aren't told they wrote it.
          {
            ...queueNote(n3, 'general_primary_care', blairRef, canAct: false, heldBecause: 'acts_as_author'),
            'signedBefore': userRef(avery, 'Demo Avery'),
          },
          queueNote(n4, 'social_needs', blairRef, canAct: false),
        ],
      },
    ],
  };

  Future<EncounterRoutes> scripted(WidgetTester tester, AppHarness h, {String? credential}) async {
    final routes = await withEncounterRoutes(tester, h, credential: credential);
    routes
      ..on('GET', '/v1/me/counts', (_) => {'notesToFinish': 0, 'cosignWaiting': 2, 'attestationWaiting': 1})
      ..on('GET', '/v1/team/cosign-queue', (_) => queue())
      ..on('GET', '/v1/team/attestation-queue', (_) => {'rows': <Object?>[]});
    // Home asked for its counts as the services were made: a sync's end asks again.
    await syncAndRefresh(tester, h);
    return routes;
  }

  Future<void> home(WidgetTester tester) async {
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Home')));
    await settle(tester);
  }

  for (final run in runs) {
    testWidgets('the tiles and the co-sign queue, offline then online (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final routes = await scripted(tester, h);
      await home(tester);
      // Offline: each tile, without a number.
      final cosign = find.bySemanticsLabel(RegExp('^Waiting for your co-signature'));
      await expectShown(tester, find.text('Waiting for your co-signature'));
      await expectShown(tester, find.text('Waiting for attestation'));
      expect(find.text('Connect to see notes waiting for you'), findsNWidgets(2));
      await expectScreenOk(tester);

      await tapOn(tester, cosign);
      expect(location(tester), queueLocation(SecondAct.cosign));
      expect(find.widgetWithText(AppBar, 'Waiting for your co-signature'), findsOneWidget);
      await expectShown(tester, find.text('Connect to see notes waiting for you.'));
      // Said once, as a live region (review finding PX-6).
      expect(
        tester.getSemantics(find.bySemanticsLabel('Connect to see notes waiting for you.')),
        isSemantics(isLiveRegion: true),
      );
      await expectScreenOk(tester);
      expect(routes.asked, isEmpty);

      h.server.offline = false;
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Try again'));
      expect(routes.asked.map((a) => a.path), contains('/v1/team/cosign-queue'));
      final first = find.bySemanticsLabel(
        RegExp('^Del, Visit started October 20, 2026$at, General / primary care, by Demo Blair\$'),
      );
      final second = find.bySemanticsLabel(
        RegExp(
          '^Del, Visit started October 21, 2026$at, Wound care, by Jordan Lee \\(demo\\)\\. You wrote this note, so '
          'someone else has to co-sign it\\., General / primary care, by Demo Blair\\. Signed before by Demo Avery\\. '
          'This note was assigned to you, so someone else has to co-sign it\\., Social needs, by Demo Blair\\. '
          'Someone else has to co-sign this note\\.\$',
        ),
      );
      await expectShown(tester, first);
      expect(tester.getSemantics(first), isSemantics(isButton: true, hasTapAction: true));
      await expectShown(tester, second);
      await expectScreenOk(tester);
      expectNoLegalName(tester);

      // A row opens the visit, where Co-sign is (9.7).
      await tapOn(tester, first);
      expect(location(tester), '/encounters/$v1/visit');
      handle.dispose();
    });
  }

  testWidgets('online, each tile shows the server’s number; back on top, the queue is asked again', (tester) async {
    final h = await signInToChart(tester, offline: false);
    final routes = await scripted(tester, h);
    await home(tester);
    await expectShown(tester, find.text('2 visits'));
    await expectShown(tester, find.text('1 visit'));
    await tapOn(tester, find.text('Waiting for attestation'));
    expect(location(tester), queueLocation(SecondAct.attest));
    await expectShown(tester, find.text('No visits waiting.'));
    await back(tester);
    await tapOn(tester, find.text('Waiting for your co-signature'));
    final asked = routes.asked.where((a) => a.path == '/v1/team/cosign-queue').length;
    await tapOn(tester, find.bySemanticsLabel(RegExp('^Del, Visit started October 20')));
    await back(tester);
    expect(routes.asked.where((a) => a.path == '/v1/team/cosign-queue').length, asked + 1);
  });

  testWidgets('online, a tile the server gives no number for is not shown: its word wins', (tester) async {
    final h = await signInToChart(tester, offline: false);
    final routes = await scripted(tester, h);
    // The person's credential was lowered on the server since this phone saved it.
    routes.on('GET', '/v1/me/counts', (_) => {'notesToFinish': 0, 'cosignWaiting': 2});
    await syncAndRefresh(tester, h);
    await home(tester);
    await expectShown(tester, find.text('2 visits'));
    expect(find.text('Waiting for attestation'), findsNothing);
    expect(find.text('Connect to see notes waiting for you'), findsNothing);
  });

  testWidgets('each tile shows only to a credential that may act', (tester) async {
    final h = await signInToChart(tester);
    await scripted(tester, h, credential: 'resident');
    await home(tester);
    await expectShown(tester, find.text('Waiting for your co-signature'));
    expect(find.text('Waiting for attestation'), findsNothing);
    await scripted(tester, h, credential: 'student');
    await settle(tester);
    expect(find.text('Waiting for your co-signature'), findsNothing);
    expect(find.text('Waiting for attestation'), findsNothing);
  });
}
