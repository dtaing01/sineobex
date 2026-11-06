import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/patients/patient_screen.dart';
import 'package:sineobex_field/sync/local_store.dart';

import 'patient_kit.dart';

/// Edit details (design 11.5, 12.1): the intake form titled "Edit details" with **Update and
/// save**, recorded identity locked and announced as such, one change per changed field with the
/// version the form loaded (online and from the index offline, 13.1 step 4), the estimate's
/// refinement warning, and refusing to clear the last name or description.
void main() {
  List<OutboxEntry> sets(AppHarness h) => [
    for (final e in h.sync.store!.outbox())
      if (e.entity == entityPatient && e.op == 'set') e,
  ];

  for (final run in runs) {
    testWidgets('editing Del: locked identity, one set per changed field (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      expect(find.byType(PatientScreen), findsOneWidget);
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Edit'));

      expect(find.text('Edit details'), findsOneWidget);
      expect(find.text('Create patient'), findsNothing);
      final legal = find.bySemanticsLabel(
        'Legal name, Delbert Smithfield, locked. Only a Program Admin can correct this.',
      );
      await expectShown(tester, legal);
      final birth = find.bySemanticsLabel(
        'Date of birth, March 7, 1946, locked. Only a Program Admin can correct this.',
      );
      await expectShown(tester, birth);
      await expectScreenOk(tester);

      await type(tester, 'usualArea', 'Demo: by the library steps');
      await tapOn(tester, find.widgetWithText(FilledButton, 'Update and save'));
      expect(find.byType(PatientScreen), findsOneWidget);
      final changed = sets(h);
      expect(changed, hasLength(1));
      expect(changed.single.recordId, p1Id);
      expect(changed.single.field, 'usualArea');
      expect(changed.single.value, 'Demo: by the library steps');
      expect(changed.single.baseVersion, p1['fieldVersion']);
      handle.dispose();
    });
  }

  testWidgets('offline from the list: only the list’s fields change, on the list’s version', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    await go(tester, '/patients/$p1Id');
    await expectShown(tester, find.text('List only: the full chart opens when the phone reconnects.'));
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Edit'));
    await expectShown(tester, find.text('Living situation'));
    expect(find.textContaining('This needs the full chart. Connect to download it.'), findsWidgets);
    await type(tester, 'usualArea', 'Demo: by the library steps');
    await tapOn(tester, find.widgetWithText(FilledButton, 'Update and save'));
    final changed = sets(h);
    expect(changed, hasLength(1));
    expect(changed.single.field, 'usualArea');
    expect(changed.single.baseVersion, 1);
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('an estimate refined by more than 3 years says an admin will check it', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    final id = h.server.seedPatient(preferredName: 'Demo Ash', birth: {'precision': 'estimated', 'year': 1980});
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$id');
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Edit'));
    await expectShown(tester, find.textContaining('Recorded now: About 46 years old'));
    await type(tester, 'birth', '1970');
    await tester.pump(const Duration(milliseconds: 900));
    await expectShown(tester, find.text('That’s more than 3 years from the estimate. A Program Admin will check it.'));
    await expectScreenOk(tester);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Update and save'));
    final changed = sets(h);
    expect(changed.single.field, 'birth');
    expect(changed.single.value, {'precision': 'year', 'year': 1970});
    handle.dispose();
  });

  testWidgets('clearing the last name or description is refused', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    final id = h.server.seedPatient(preferredName: 'Demo Ash');
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$id');
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Edit'));
    await type(tester, 'preferredName', '');
    await tapOn(tester, find.widgetWithText(FilledButton, 'Update and save'));
    await expectShown(tester, find.text('Keep a name or a description so the team can recognise them.'));
    expect(sets(h), isEmpty);
    expect(find.text('Edit details'), findsOneWidget);
    await expectScreenOk(tester);
    handle.dispose();
  });
}
