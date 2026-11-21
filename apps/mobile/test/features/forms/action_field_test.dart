import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:sineobex_field/features/forms/action_field.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// An action (forms 2.2 `action`): a button that asks the screen around the form to do something,
/// such as open another note type. It stores nothing, and is offered only where that screen says
/// the action can be taken.
void main() {
  final woundCare = presetField('general_primary_care', 'diabetic_foot.wound_care') as ActionDef;
  final redFlags = presetField('outreach', 'outreach.red_flags') as ActionDef;
  final handoff = presetField('red_flags_disposition', 'red_flags.show_handoff') as ActionDef;
  final referral = presetField('social_needs', 'needs.referral') as ActionDef;
  final helped = fieldOf({
    'id': 'go',
    'kind': 'action',
    'label': 'Demo: go on',
    'help': 'Demo: what going on does',
    'action': 'add_referral',
  }) as ActionDef;

  Future<void> open(
    WidgetTester tester,
    ActionDef field, {
    FutureOr<void> Function()? onPressed,
    bool enabled = true,
    Run? run,
  }) => pumpField(
    tester,
    ActionField(field: field, onPressed: onPressed, enabled: enabled),
    run: run,
  );

  forEachRun('each action is a labelled button', (tester, run) async {
    for (final field in [woundCare, redFlags, handoff, referral, helped]) {
      var taps = 0;
      await open(tester, field, onPressed: () => taps++, run: run);
      expect(controlNamed(tester, field.label), isSemantics(isButton: true, hasTapAction: true, isEnabled: true));
      await expectFieldOk(tester);
      await tester.tap(find.bySemanticsLabel(field.label));
      await tester.pumpAndSettle();
      expect(taps, 1, reason: field.id);
    }
  });

  testWidgets('a screen reader can take the action', (tester) async {
    final handle = tester.ensureSemantics();
    var taps = 0;
    await open(tester, redFlags, onPressed: () => taps++);
    tester.semantics.tap(find.semantics.byLabel(redFlags.label));
    await tester.pumpAndSettle();
    expect(taps, 1);
    handle.dispose();
  });

  testWidgets('the help is shown under the button', (tester) async {
    await open(tester, helped, onPressed: () {});
    expect(find.text('Demo: what going on does'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('Demo: what going on does')).dy,
      greaterThan(tester.getBottomLeft(find.bySemanticsLabel(helped.label)).dy - 1),
    );
  });

  testWidgets('nothing is offered where the screen says the action can’t be taken', (tester) async {
    // Outreach's Emergency in a Non-Medical visit, where the Red flags note can't be started
    // (forms 10.1 #39): the screen gives no action, and the field shows nothing at all.
    final handle = tester.ensureSemantics();
    await open(tester, redFlags);
    expect(find.byType(ActionField, skipOffstage: false), findsOneWidget);
    expect(find.text(redFlags.label), findsNothing);
    expect(find.bySemanticsLabel(redFlags.label), findsNothing);
    expect(find.byType(OutlinedButton), findsNothing);
    expect(tester.getSize(find.byType(ActionField, skipOffstage: false)).height, 0);
    handle.dispose();
  });

  testWidgets('a read-only note offers no action', (tester) async {
    var taps = 0;
    await open(tester, woundCare, onPressed: () => taps++, enabled: false);
    expect(find.text(woundCare.label), findsNothing);
    expect(find.byType(OutlinedButton), findsNothing);
    expect(taps, 0);
  });

  testWidgets('a second tap while the action runs does nothing', (tester) async {
    final done = Completer<void>();
    var taps = 0;
    await open(
      tester,
      woundCare,
      onPressed: () {
        taps++;
        return done.future;
      },
    );
    await tester.tap(find.byType(OutlinedButton));
    await tester.pump();
    await tester.tap(find.byType(OutlinedButton));
    await tester.pump();
    expect(taps, 1);
    done.complete();
    await tester.pumpAndSettle();
    await tester.tap(find.byType(OutlinedButton));
    await tester.pump();
    expect(taps, 2);
  });

  testWidgets('each kind of action has its own icon', (tester) async {
    for (final (field, icon) in [
      (woundCare, LucideIcons.arrowRight),
      (handoff, LucideIcons.clipboardList),
      (referral, LucideIcons.send),
    ]) {
      await open(tester, field, onPressed: () {});
      expect(find.byIcon(icon), findsOneWidget, reason: field.action);
    }
  });
}
