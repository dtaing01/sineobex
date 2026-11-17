import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/action_field.dart';
import 'package:sineobex_field/features/forms/field_host.dart';
import 'package:sineobex_field/features/forms/note_form.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// The note form's shell (forms 8.1): its sections as an accordion in the definition's order, each
/// section's fields drawn by the field host, and only what shows: a section or a field whose
/// condition doesn't hold is not drawn, and its stored answer is left alone (7.1). A section that
/// needs a capability shows only to a credential that has it (6.2). A flag's cleared fields are
/// read-only while it is set (2.3). An action is offered only where the screen gives it something
/// to do.
void main() {
  final demo = definitionOf([
    {
      'id': 'visit',
      'title': 'Demo: visit',
      'fields': [
        {'id': 'seen', 'kind': 'flag', 'label': 'Seen today'},
        {
          'id': 'notes',
          'kind': 'text',
          'label': 'Visit notes',
          'lines': 'one',
          'maxLength': 200,
          'showWhen': {'field': 'visit.seen', 'filled': true},
        },
        {
          'id': 'unable',
          'kind': 'flag',
          'label': 'Unable to measure',
          'clears': ['length'],
        },
        {'id': 'length', 'kind': 'text', 'label': 'Length', 'lines': 'one', 'maxLength': 20},
        {
          'id': 'go',
          'kind': 'action',
          'label': 'Open the demo note',
          'action': 'open_note_type',
          'noteType': 'demo_other',
        },
      ],
    },
    {
      'id': 'later',
      'title': 'Demo: later',
      'showWhen': {'field': 'visit.seen', 'filled': true},
      'fields': [
        {'id': 'when', 'kind': 'text', 'label': 'When next', 'lines': 'one', 'maxLength': 50},
      ],
    },
    {
      'id': 'meds',
      'title': 'Demo: medication',
      'needs': 'orderMedications',
      'fields': [
        {'id': 'given', 'kind': 'text', 'label': 'Given', 'lines': 'one', 'maxLength': 50},
      ],
    },
  ]);

  Future<TestAnswers> openForm(
    WidgetTester tester,
    NoteTypeDef definition, {
    Map<String, Object?>? values,
    Run? run,
    bool enabled = true,
    Set<String> capabilities = const {},
    ActionHandler? actions,
    String? openSection,
  }) async {
    final answers = TestAnswers(values);
    await pumpField(
      tester,
      answering(
        answers,
        () => NoteForm(
          definition: definition,
          answers: answers.values,
          pending: answers.pending,
          conflicts: answers.conflicts,
          onChanged: answers.change,
          enabled: enabled,
          capabilities: capabilities,
          actions: actions,
          openSection: openSection,
        ),
      ),
      run: run,
    );
    return answers;
  }

  /// The IDs of the sections drawn, in order.
  List<String> sections() => [
    for (final e in find.byWidgetPredicate((w) => w.key is ValueKey<String>).evaluate())
      if ((e.widget.key! as ValueKey<String>).value case final k when k.startsWith('form.section.'))
        k.substring('form.section.'.length),
  ];

  Finder header(String id) => find.byKey(ValueKey('form.section.$id'));
  Finder host(String path) => find.byKey(ValueKey('host.$path'));

  Future<void> toggle(WidgetTester tester, String id) async {
    await tester.ensureVisible(header(id));
    await tester.pumpAndSettle();
    await tester.tap(header(id));
    await tester.pumpAndSettle();
  }

  forEachRun('the sections open one at a time, each to its fields', (tester, run) async {
    final quick = presetDefinition('quick_encounter');
    await openForm(
      tester,
      quick,
      run: run,
      values: {
        'visit.parts': ['general', 'wound'],
      },
    );
    expect(sections(), ['visit', 'general', 'wound']);
    await expectFieldOk(tester);
    // The first starts open.
    for (final (i, id) in sections().indexed) {
      if (i > 0) await toggle(tester, id);
      expect(
        tester.getSemantics(header(id)),
        isSemantics(isButton: true, hasTapAction: true, hasExpandedState: true, isExpanded: true),
      );
      await expectFieldOk(tester);
    }
  });

  testWidgets('a section header is a button that says whether it is open', (tester) async {
    final handle = tester.ensureSemantics();
    await openForm(tester, demo, values: {'visit.seen': true});
    // The first section that shows starts open.
    expect(
      tester.getSemantics(header('visit')),
      isSemantics(isButton: true, hasTapAction: true, hasExpandedState: true, isExpanded: true),
    );
    expect(
      tester.getSemantics(header('later')),
      isSemantics(isButton: true, hasTapAction: true, hasExpandedState: true, isExpanded: false),
    );
    expect(host('later.when'), findsNothing);
    // Opening one closes the other, and a screen reader's tap opens it as a finger does.
    tester.semantics.tap(find.semantics.byLabel('Demo: later'));
    await tester.pumpAndSettle();
    expect(host('later.when'), findsOneWidget);
    expect(host('visit.seen'), findsNothing);
    // Tapping the open one closes it.
    await toggle(tester, 'later');
    expect(host('later.when'), findsNothing);
    expect(tester.getSemantics(header('later')), isSemantics(hasExpandedState: true, isExpanded: false));
    handle.dispose();
  });

  testWidgets('the screen can open the form at a section', (tester) async {
    await openForm(tester, demo, values: {'visit.seen': true}, openSection: 'later');
    expect(host('later.when'), findsOneWidget);
    expect(host('visit.seen'), findsNothing);
  });

  testWidgets('a section whose condition does not hold is not drawn, and its answers are left alone', (tester) async {
    final answers = await openForm(tester, demo, values: {'later.when': 'Demo: Friday'});
    expect(sections(), ['visit']);
    // Ticking what the section hangs on shows it, with what it held.
    await tester.tap(find.text('Seen today'));
    await tester.pumpAndSettle();
    expect(sections(), ['visit', 'later']);
    await toggle(tester, 'later');
    expect(find.text('Demo: Friday'), findsOneWidget);
    await toggle(tester, 'visit');
    await tester.tap(find.text('Seen today'));
    await tester.pumpAndSettle();
    expect(sections(), ['visit']);
    expect(answers.changes, [('visit.seen', true), ('visit.seen', null)]);
    expect(answers.values['later.when'], 'Demo: Friday');
  });

  testWidgets('a field whose condition does not hold is not drawn, and its answer is left alone', (tester) async {
    final answers = await openForm(tester, demo, values: {'visit.notes': 'Demo: by the bridge'});
    expect(host('visit.notes'), findsNothing);
    expect(find.text('Demo: by the bridge'), findsNothing);
    await tester.tap(find.text('Seen today'));
    await tester.pumpAndSettle();
    expect(host('visit.notes'), findsOneWidget);
    expect(find.text('Demo: by the bridge'), findsOneWidget);
    await tester.tap(find.text('Seen today'));
    await tester.pumpAndSettle();
    expect(host('visit.notes'), findsNothing);
    expect(answers.changes.map((c) => c.$1), everyElement('visit.seen'));
  });

  testWidgets('a section that needs a capability shows only to a credential that has it', (tester) async {
    await openForm(tester, demo);
    expect(sections(), isNot(contains('meds')));
    await openForm(tester, demo, capabilities: {'orderMedications'});
    expect(sections(), contains('meds'));
    final quick = presetDefinition('quick_encounter');
    final parts = {
      'visit.parts': ['medication'],
    };
    await openForm(tester, quick, values: parts);
    expect(sections(), ['visit']);
    await openForm(tester, quick, values: parts, capabilities: {'orderMedications'});
    expect(sections(), ['visit', 'medication']);
  });

  testWidgets('while a flag of the section is set, the fields it clears are read-only', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = await openForm(tester, demo, values: {'visit.length': '4'});
    expect(find.byKey(const ValueKey('phi.form.length')), findsOneWidget);
    await tester.tap(find.text('Unable to measure'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('phi.form.length')), findsNothing);
    expect(
      tester.getSemantics(find.bySemanticsLabel(RegExp('^Length')).last),
      isSemantics(isReadOnly: true, hasEnabledState: true, isEnabled: false),
    );
    // Nothing is written to the field it clears, and it is answerable again once unticked.
    await tester.tap(find.text('Unable to measure'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('phi.form.length')), findsOneWidget);
    expect(answers.changes.map((c) => c.$1), everyElement('visit.unable'));
    expect(answers.values['visit.length'], '4');
    handle.dispose();
  });

  testWidgets('a flag in a group makes the fields it clears read-only', (tester) async {
    final wound = presetDefinition('wound_care');
    const e = 'e0000001';
    await openForm(
      tester,
      wound,
      values: {
        'wound.$e.entryAt': '2026-11-17T10:00:00Z',
        'wound.$e.measurements.unable': true,
        'wound.$e.measurements.length': 2,
      },
    );
    expect(tester.widget<FieldHost>(host('wound.$e.measurements.length')).enabled, isFalse);
    expect(tester.widget<FieldHost>(host('wound.$e.measurements.unable')).enabled, isTrue);
  });

  testWidgets('a field in a group shows by its own condition', (tester) async {
    final general = presetDefinition('general_primary_care');
    final values = <String, Object?>{
      'exam.systems': ['cardiovascular'],
    };
    await openForm(tester, general, values: values, openSection: 'heart');
    expect(host('heart.murmur.character'), findsNothing);
    await openForm(
      tester,
      general,
      values: {
        ...values,
        'heart.sounds': ['murmur'],
      },
      openSection: 'heart',
    );
    expect(host('heart.murmur.character'), findsOneWidget);
  });

  testWidgets('a grid draws a cell for each row and side, at the cell’s path', (tester) async {
    final general = presetDefinition('general_primary_care');
    await openForm(
      tester,
      general,
      values: {
        'exam.systems': ['cardiovascular'],
      },
      openSection: 'cv_perfusion',
    );
    for (final row in ['radial', 'dorsalis_pedis_dp', 'posterior_tibial_pt']) {
      for (final side in ['right', 'left']) {
        expect(host('cv_perfusion.pulses.$row.$side'), findsOneWidget, reason: '$row $side');
      }
    }
    // A collapsed grid is closed until tapped.
    expect(host('cv_perfusion.more_pulses.brachial.right'), findsNothing);
  });

  testWidgets('a grid of picked rows has a row for each option picked, and a cell shows by its row', (tester) async {
    final general = presetDefinition('general_primary_care');
    final values = <String, Object?>{
      'exam.systems': ['lymphatic'],
      'lymphatic.nodes': ['cervical', 'inguinal'],
      'lymphatic.node_findings.inguinal.findings': ['enlarged'],
    };
    await openForm(tester, general, values: values, openSection: 'lymphatic');
    expect(host('lymphatic.node_findings.cervical.findings'), findsOneWidget);
    expect(host('lymphatic.node_findings.inguinal.findings'), findsOneWidget);
    expect(host('lymphatic.node_findings.axillary.findings'), findsNothing);
    // Size shows once that row's findings are in (./findings, from the row).
    expect(host('lymphatic.node_findings.cervical.size'), findsNothing);
    expect(host('lymphatic.node_findings.inguinal.size'), findsOneWidget);
    // A row whose option is unpicked is not drawn, and what it held is left alone.
    await openForm(
      tester,
      general,
      values: {
        ...values,
        'lymphatic.nodes': ['cervical'],
      },
      openSection: 'lymphatic',
    );
    expect(host('lymphatic.node_findings.inguinal.findings'), findsNothing);
  });

  testWidgets('an action is offered only where the screen gives it something to do', (tester) async {
    await openForm(tester, demo);
    expect(find.text('Open the demo note'), findsNothing);
    final asked = <(String, String)>[];
    var opened = 0;
    await openForm(
      tester,
      demo,
      actions: (field, path) {
        asked.add((field.id, path));
        if (field.noteType != 'demo_other') return null;
        return () {
          opened++;
        };
      },
    );
    expect(asked, [('go', 'visit.go')]);
    await tester.ensureVisible(find.text('Open the demo note'));
    await tester.tap(find.text('Open the demo note'));
    expect(opened, 1);
    // Nothing to do there: not drawn at all, so it leaves no gap among the fields.
    await openForm(tester, demo, actions: (field, path) => null);
    expect(find.text('Open the demo note'), findsNothing);
    expect(find.byType(ActionField), findsNothing);
  });

  testWidgets('a read-only form opens its sections to be read, and offers nothing to change', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = await openForm(
      tester,
      demo,
      enabled: false,
      values: {'visit.seen': true, 'visit.notes': 'Demo: by the bridge', 'later.when': 'Demo: Friday'},
      actions: (field, path) => () {},
    );
    expect(find.byType(EditableText), findsNothing);
    expect(find.text('Demo: by the bridge'), findsOneWidget);
    expect(find.text('Open the demo note'), findsNothing);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Seen today')),
      isSemantics(hasEnabledState: true, isEnabled: false),
    );
    await toggle(tester, 'later');
    expect(find.text('Demo: Friday'), findsOneWidget);
    expect(answers.changes, isEmpty);
    handle.dispose();
  });
}
