import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/patients/id_card_screen.dart';
import 'package:sineobex_field/sync/local_store.dart';

import 'patient_kit.dart';

/// The ID card screen (design 10.4, 12.1): the state as a sentence with an icon, a first card made
/// offline and copied at once ("Link copied. It clears in 60 seconds." in a live region), the new
/// card's reasons as a radio group with nothing chosen and the consequence in words, the printing
/// guidance, and a card that lost to another one. Three themes, 200% text and 320 wide.
void main() {
  for (final run in runs) {
    testWidgets('a first card made offline, copied at once; a new card asks why (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      h.server.offline = true;
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open ID card'));
      expect(find.byType(IdCardScreen), findsOneWidget);
      await expectShown(tester, find.text('No card yet'));
      await expectShown(tester, find.text('Print only the code and your team’s contact line.'));
      await expectScreenOk(tester);

      await tapOn(tester, find.widgetWithText(FilledButton, 'Make a card'));
      await expectShown(
        tester,
        find.text('Pending: works on this phone now; other phones learn it after this phone syncs'),
      );
      final link = h.sync.store!.outbox().singleWhere((e) => e.entity == entityIdLink);
      expect((link.value! as Map)['reason'], 'first_card');

      await tapOn(tester, find.widgetWithText(FilledButton, 'Copy link'));
      final copied = find.text('Link copied. It clears in 60 seconds.');
      await expectShown(tester, copied);
      expect(tester.getSemantics(copied), isSemantics(isLiveRegion: true));
      expect(h.copied.single, startsWith('http://localhost:3100/c#'));
      await expectScreenOk(tester);

      await tapOn(tester, find.text('Card lost or damaged? Make a new card'));
      await expectShown(
        tester,
        find.text('The old card stops working on this phone now, and on every phone after this syncs.'),
      );
      for (final reason in ['Lost', 'Damaged', 'Stolen', 'Patient asked', 'Other']) {
        final chip = find.bySemanticsLabel(reason);
        await reveal(tester, chip);
        expect(tester.getSemantics(chip), isSemantics(isInMutuallyExclusiveGroup: true, isSelected: false));
      }
      final make = find.widgetWithText(FilledButton, 'Make the new card');
      expect(tester.widget<FilledButton>(make).onPressed, isNull);
      await expectGuidelines(tester);
      await tapOn(tester, find.text('Lost'));
      await tapOn(tester, make);
      final links = [
        for (final e in h.sync.store!.outbox())
          if (e.entity == entityIdLink) e.value! as Map,
      ];
      expect(links.last['reason'], 'lost');
      expect(links.last['replacesLinkId'], link.recordId);
      await expectShown(tester, find.text('Blocked: make a new card'));
      handle.dispose();
    });
  }

  testWidgets('a card that lost to a newer one says so first, from this phone’s own cards', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await tester.runAsync(() => h.patients.patients.open(p1Id));
    h.server.offline = true;
    h.patients.idLinks.makeCard(p1Id, reason: 'first_card');
    // Someone at the office makes a card a minute later, online.
    h.server
      ..offline = false
      ..seed(entityIdLink, {
        'patientId': p1Id,
        'token': 'CCCCCCCCCCCCCCCCCCCCCC',
        'replacesLinkId': null,
        'reason': 'first_card',
      }, at: h.wall.add(const Duration(minutes: 1)));
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open ID card'));
    final message = find.textContaining('Another new card for Del was made at');
    await expectShown(tester, message);
    expect(
      find.textContaining('That card is the valid one; the card you printed won’t open the chart.'),
      findsOneWidget,
    );
    // The message comes before the cards.
    expect(tester.getRect(message).top, lessThan(tester.getRect(find.text('Cards that open this chart')).top));
    await expectScreenOk(tester);
    await tapOn(tester, find.text('Copy the valid link'));
    expect(h.copied.single, endsWith('#CCCCCCCCCCCCCCCCCCCCCC'));
    await tapOn(tester, find.text('Got it'));
    expect(message, findsNothing);
    // Read on the phone, and on the server at the next contact.
    await syncAndRefresh(tester, h);
    final lost = h.server.notices.where((n) => n.kind == 'id_link_superseded').toList();
    expect(lost, hasLength(1));
    expect(lost.single.readAt, isNotNull);
    handle.dispose();
  });

  testWidgets('a card made while the clock is off waits for it', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open ID card'));
    h.serverAhead = const Duration(minutes: 7);
    await tester.runAsync(() => h.sync.syncNow());
    await settle(tester);
    await expectShown(tester, find.text('Cards can be made once the phone’s clock is right.'));
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Make a card')).onPressed, isNull);
    await expectScreenOk(tester);
    handle.dispose();
  });
}
