import 'package:flutter_test/flutter_test.dart';

import '../auth/fakes.dart';
import '../sync/test_note_types.dart';
import 'app_harness.dart';

/// The harness's own helper, held to what the screens' tests lean on: tapText reaches a button a
/// lazy list built below the screen. Home's list guesses the height of the rows it has not built, so
/// scrolling Sync now into view can land short of it (at 115% text it did, and the tap missed).
void main() {
  for (final scale in [1.0, 1.15, 1.3, 1.6, 2.0]) {
    testWidgets('tapText reaches Sync now on Home below the screen, at ${(scale * 100).round()}% text', (tester) async {
      usePhoneSize(tester);
      final h = AppHarness();
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
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await tester.pumpAndSettle();

      // A change made offline waits, so Home offers Sync now under its tiles.
      h.server.offline = true;
      final store = h.sync.store!;
      store.createNote(
        encounterId: store.createEncounter(kind: 'medical'),
        noteTypeKey: testNote.key,
        noteTypeVersion: testNote.version,
        data: {'vitals.temp_c': 38.2},
      );
      await tester.runAsync(h.sync.syncNow);
      await tester.pumpAndSettle();
      expect(h.sync.snapshot.unsynced.total, 2);

      h.server.offline = false;
      await tapText(tester, 'Sync now');
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pumpAndSettle();
      // The tap reached Sync now: nothing waits. (At 160% and more its card's title is above the screen.)
      expect(h.sync.snapshot.unsynced.total, 0);
      expect(find.text('All saved to the server', skipOffstage: false), findsOneWidget);
    });
  }
}
