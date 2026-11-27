import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/patients/patient_screen.dart';
import 'package:sineobex_field/patients/dob.dart' show BirthMode;
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

  testWidgets('the edit form, legal name and all, goes when the store freezes for a hand-over (V1)', (tester) async {
    final handle = tester.ensureSemantics();
    const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Edit'));
    await expectShown(
      tester,
      find.bySemanticsLabel('Legal name, Delbert Smithfield, locked. Only a Program Admin can correct this.'),
    );
    h.server.offline = true;
    h.sync.store!.freeze(frozen);
    // The controller tells its listeners after a freeze (here, a sync that finds no signal).
    await tester.runAsync(() => h.sync.syncNow());
    await settle(tester);
    expect(tester.takeException(), isNull);
    expect(find.text(frozen), findsOneWidget);
    expect(find.text('Update and save'), findsNothing);
    expectNoLegalName(tester);
    handle.dispose();
  });

  // A dialog is not under the edit form's gate: it closes as its Cancel would (phase 3's V1).
  for (final (how, tell) in <(String, Future<void> Function(WidgetTester, AppHarness))>[
    // A sync that finds no signal.
    ('the controller says so', (tester, h) => tester.runAsync(() => h.sync.syncNow())),
    ('a download ends before the controller says so', (tester, h) async => h.patients.changed()),
  ]) {
    testWidgets('a freeze for a hand-over closes Remove “Smitty”?: $how (V1)', (tester) async {
      const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
      final h = await signIn(tester);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Edit'));
      await tapOn(tester, find.bySemanticsLabel('Remove street name Smitty'));
      final question = find.text('Remove “Smitty”?', skipOffstage: false);
      expect(find.descendant(of: find.byType(Dialog), matching: question), findsOneWidget);
      h.server.offline = true;
      final store = h.sync.store!;
      final before = store.outbox().length;

      store.freeze(frozen);
      await tell(tester, h);
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(find.byType(Dialog), findsNothing);
      expect(question, findsNothing);
      expect(store.outbox(), hasLength(before));
      // The screen under it says why once the controller does.
      await tester.runAsync(() => h.sync.syncNow());
      await settle(tester);
      expect(find.text(frozen), findsOneWidget);
      expect(find.text('Smitty', skipOffstage: false), findsNothing);
      expectNoLegalName(tester);
      expect(store.outbox(), hasLength(before));
    });
  }

  testWidgets('a list-only chart’s birth can’t be typed, so it can’t be dropped (V8)', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    final id = h.server.seedPatient(preferredName: 'Demo Wren', birth: {'precision': 'year', 'year': 1950});
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    await go(tester, '/patients/$id');
    await expectShown(tester, find.text('List only: the full chart opens when the phone reconnects.'));
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Edit'));
    final birth = await fieldNamed(tester, 'birth');
    expect(birth.enabled, isFalse);
    expect(birth.decoration!.helperText, 'This needs the full chart. Connect to download it.');
    final age = tester.widget<SegmentedButton<BirthMode>>(find.byType(SegmentedButton<BirthMode>));
    expect(age.onSelectionChanged, isNull);
    await expectScreenOk(tester);
    handle.dispose();
  });

  group('Update and save is one transaction, and lengths are checked when added (V9)', () {
    Future<AppHarness> editDel(WidgetTester tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Edit'));
      return h;
    }

    List<OutboxEntry> aliases(AppHarness h, String alias) => [
      for (final e in h.sync.store!.outbox())
        if (e.entity == entityAlias && (e.value! as Map)['alias'] == alias) e,
    ];

    testWidgets('a street name over 60 characters is refused when added, not part way through saving', (tester) async {
      final h = await editDel(tester);
      await type(tester, 'alias', 'Demo Ace');
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Add'));
      await type(tester, 'alias', 'Demo ${'x' * 60}');
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Add'));
      await expectShown(tester, find.text('A street name is 1 to 60 characters.'));
      expect(find.bySemanticsLabel(RegExp('^Remove street name Demo xxx')), findsNothing);
      await tapOn(tester, find.widgetWithText(FilledButton, 'Update and save'));
      expect(aliases(h, 'Demo Ace'), hasLength(1));
      expect(h.sync.store!.outbox().where((e) => e.entity == entityAlias), hasLength(1));
    });

    testWidgets('an allergy named in over 120 characters is refused when added', (tester) async {
      final h = await editDel(tester);
      await tapOn(tester, find.text('Add allergy'));
      await type(tester, 'allergySubstance', 'Demo ${'x' * 120}');
      await tapOn(tester, find.text('Add this allergy'));
      await expectShown(tester, find.text('Name the allergy in up to 120 characters.'));
      await tapOn(tester, find.widgetWithText(FilledButton, 'Update and save'));
      // Still on the form: the started allergy is still to fix.
      expect(find.text('Edit details'), findsOneWidget);
      expect(h.sync.store!.outbox().where((e) => e.entity == entityAllergy), isEmpty);
    });

    testWidgets('a refusal part way leaves nothing queued, so trying again sends each change once', (tester) async {
      final h = await editDel(tester);
      await type(tester, 'usualArea', 'Demo: by the library steps');
      await type(tester, 'alias', 'Demo Ace');
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Add'));
      // The hand-over starts right after the first change of the save is written.
      const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
      final store = h.sync.store!;
      void freeze() => store.freeze(frozen);
      h.patients.addListener(freeze);
      await tapOn(tester, find.widgetWithText(FilledButton, 'Update and save'));
      h.patients.removeListener(freeze);
      await expectShown(tester, find.text(frozen));
      expect(store.outbox().where((e) => e.entity == entityPatient && e.op == 'set'), isEmpty);
      expect(aliases(h, 'Demo Ace'), isEmpty);

      // Access is back; the same save again.
      store.unfreeze();
      await tapOn(tester, find.widgetWithText(FilledButton, 'Update and save'));
      expect(find.byType(PatientScreen), findsOneWidget);
      final changed = store.outbox().where((e) => e.entity == entityPatient && e.op == 'set').toList();
      expect(changed, hasLength(1));
      expect(changed.single.field, 'usualArea');
      expect(aliases(h, 'Demo Ace'), hasLength(1));
    });
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
