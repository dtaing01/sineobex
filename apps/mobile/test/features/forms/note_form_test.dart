import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/action_field.dart';
import 'package:sineobex_field/features/forms/field_host.dart';
import 'package:sineobex_field/forms/recap.dart';

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

  forEachRun('the sections open one at a time, each to its fields', (tester, run) async {
    final quick = presetDefinition('quick_encounter');
    await pumpForm(
      tester,
      quick,
      run: run,
      values: {
        'visit.parts': ['general', 'wound'],
      },
    );
    expect(formSections(), ['visit', 'general', 'wound']);
    await expectFieldOk(tester);
    // The first starts open.
    for (final (i, id) in formSections().indexed) {
      if (i > 0) await toggleSection(tester, id);
      expect(
        tester.getSemantics(sectionHeader(id)),
        isSemantics(isButton: true, hasTapAction: true, hasExpandedState: true, isExpanded: true),
      );
      await expectFieldOk(tester);
    }
  });

  testWidgets('a section header is a button that says whether it is open', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpForm(tester, demo, values: {'visit.seen': true});
    // The first section that shows starts open.
    expect(
      tester.getSemantics(sectionHeader('visit')),
      isSemantics(isButton: true, hasTapAction: true, hasExpandedState: true, isExpanded: true),
    );
    expect(
      tester.getSemantics(sectionHeader('later')),
      isSemantics(isButton: true, hasTapAction: true, hasExpandedState: true, isExpanded: false),
    );
    expect(fieldHost('later.when'), findsNothing);
    // Opening one closes the other, and a screen reader's tap opens it as a finger does.
    tester.semantics.tap(find.semantics.byLabel('Demo: later'));
    await tester.pumpAndSettle();
    expect(fieldHost('later.when'), findsOneWidget);
    expect(fieldHost('visit.seen'), findsNothing);
    // Tapping the open one closes it.
    await toggleSection(tester, 'later');
    expect(fieldHost('later.when'), findsNothing);
    expect(tester.getSemantics(sectionHeader('later')), isSemantics(hasExpandedState: true, isExpanded: false));
    handle.dispose();
  });

  testWidgets('the screen can open the form at a section', (tester) async {
    await pumpForm(tester, demo, values: {'visit.seen': true}, openSection: 'later');
    expect(fieldHost('later.when'), findsOneWidget);
    expect(fieldHost('visit.seen'), findsNothing);
  });

  testWidgets('a closed section’s header shows its recap line, and an open one its fields', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = await pumpForm(
      tester,
      demo,
      values: {'visit.seen': true, 'visit.length': '4', 'later.when': 'Demo: Friday'},
    );
    // Visit is open: its fields show what it holds, so its line is not repeated.
    expect(find.text('Seen today: Yes; Length: 4'), findsNothing);
    expect(find.text('When next: Demo: Friday'), findsOneWidget);
    expect(
      tester.getSemantics(sectionHeader('later')),
      isSemantics(label: 'Demo: later', value: 'When next: Demo: Friday', isButton: true),
    );
    await toggleSection(tester, 'later');
    expect(find.text('When next: Demo: Friday'), findsNothing);
    expect(find.text('Seen today: Yes; Length: 4'), findsOneWidget);
    expect(tester.getSemantics(sectionHeader('visit')), isSemantics(value: 'Seen today: Yes; Length: 4'));
    // The line follows the answers: an answer that stops counting leaves it.
    answers.change('visit.unable', true);
    await tester.pumpAndSettle();
    expect(find.text('Seen today: Yes; Unable to measure: Yes'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('a section with no answer that counts has no recap line', (tester) async {
    final handle = tester.ensureSemantics();
    // Visit notes are hidden until Seen today is ticked, so what they hold is not in the line.
    await pumpForm(tester, demo, values: {'visit.notes': 'Demo: by the bridge'}, capabilities: {'orderMedications'});
    await toggleSection(tester, 'visit');
    expect(find.textContaining('Demo: by the bridge'), findsNothing);
    expect(tester.getSemantics(sectionHeader('visit')), isSemantics(label: 'Demo: visit', value: ''));
    handle.dispose();
  });

  testWidgets('a sensitive exam’s findings are never in a header', (tester) async {
    final handle = tester.ensureSemantics();
    final general = presetDefinition('general_primary_care');
    final values = <String, Object?>{
      'exam.systems': ['skin', 'gu'],
      'gu.general': ['dysuria'],
      'skin.overall': ['warm', 'dry'],
    };
    await pumpForm(tester, general, values: values, openSection: 'reason');
    final lines = {for (final l in recapLines(general, values)) l.section: l.text};
    expect(lines.keys, isNot(contains('gu')));
    expect(find.text(lines['skin']!), findsOneWidget);
    expect(tester.getSemantics(sectionHeader('gu')), isSemantics(label: 'Genitourinary (GU)', value: ''));
    handle.dispose();
  });

  testWidgets('a section whose condition does not hold is not drawn, and its answers are left alone', (tester) async {
    final answers = await pumpForm(tester, demo, values: {'later.when': 'Demo: Friday'});
    expect(formSections(), ['visit']);
    // Ticking what the section hangs on shows it, with what it held.
    await tester.tap(find.text('Seen today'));
    await tester.pumpAndSettle();
    expect(formSections(), ['visit', 'later']);
    await toggleSection(tester, 'later');
    expect(find.text('Demo: Friday'), findsOneWidget);
    await toggleSection(tester, 'visit');
    await tester.tap(find.text('Seen today'));
    await tester.pumpAndSettle();
    expect(formSections(), ['visit']);
    expect(answers.changes, [('visit.seen', true), ('visit.seen', null)]);
    expect(answers.values['later.when'], 'Demo: Friday');
  });

  testWidgets('a field whose condition does not hold is not drawn, and its answer is left alone', (tester) async {
    final answers = await pumpForm(tester, demo, values: {'visit.notes': 'Demo: by the bridge'});
    expect(fieldHost('visit.notes'), findsNothing);
    expect(find.text('Demo: by the bridge'), findsNothing);
    await tester.tap(find.text('Seen today'));
    await tester.pumpAndSettle();
    expect(fieldHost('visit.notes'), findsOneWidget);
    expect(find.text('Demo: by the bridge'), findsOneWidget);
    await tester.tap(find.text('Seen today'));
    await tester.pumpAndSettle();
    expect(fieldHost('visit.notes'), findsNothing);
    expect(answers.changes.map((c) => c.$1), everyElement('visit.seen'));
  });

  testWidgets('a section that needs a capability shows only to a credential that has it', (tester) async {
    await pumpForm(tester, demo);
    expect(formSections(), isNot(contains('meds')));
    await pumpForm(tester, demo, capabilities: {'orderMedications'});
    expect(formSections(), contains('meds'));
    final quick = presetDefinition('quick_encounter');
    final parts = {
      'visit.parts': ['medication'],
    };
    await pumpForm(tester, quick, values: parts);
    expect(formSections(), ['visit']);
    await pumpForm(tester, quick, values: parts, capabilities: {'orderMedications'});
    expect(formSections(), ['visit', 'medication']);
  });

  testWidgets('while a flag of the section is set, the fields it clears are read-only', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = await pumpForm(tester, demo, values: {'visit.length': '4'});
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

  // What counts, not what is stored (forms 2.3, 7.1): a flag or a picker whose condition doesn't
  // hold keeps its answer, and that answer clears nothing and picks no row.
  final hidden = definitionOf([
    {
      'id': 'visit',
      'title': 'Demo: visit',
      'fields': [
        {'id': 'seen', 'kind': 'flag', 'label': 'Seen today'},
        {
          'id': 'unable',
          'kind': 'flag',
          'label': 'Unable to measure',
          'clears': ['length'],
          'showWhen': {'field': 'visit.seen', 'filled': true},
        },
        {'id': 'length', 'kind': 'text', 'label': 'Length', 'lines': 'one', 'maxLength': 20},
        {
          'id': 'nodes',
          'kind': 'choice',
          'many': true,
          'label': 'Demo: nodes',
          'showWhen': {'field': 'visit.seen', 'filled': true},
          'options': [
            {'code': 'neck', 'label': 'Demo: neck'},
            {'code': 'groin', 'label': 'Demo: groin'},
          ],
        },
        {
          'id': 'node_findings',
          'kind': 'grid',
          'label': 'Demo: findings for each node',
          'rows': {'pickedIn': 'visit.nodes'},
          'cell': {'id': 'tender', 'kind': 'flag', 'label': 'Demo: tender'},
        },
      ],
    },
  ]);

  testWidgets('a set flag that doesn’t count clears nothing', (tester) async {
    await pumpForm(tester, hidden, values: {'visit.unable': true, 'visit.length': '4'});
    expect(fieldHost('visit.unable'), findsNothing);
    expect(tester.widget<FieldHost>(fieldHost('visit.length')).enabled, isTrue);
    await pumpForm(tester, hidden, values: {'visit.seen': true, 'visit.unable': true, 'visit.length': '4'});
    expect(tester.widget<FieldHost>(fieldHost('visit.length')).enabled, isFalse);
  });

  testWidgets('a grid draws no row for an option picked in a picker that doesn’t count', (tester) async {
    await pumpForm(
      tester,
      hidden,
      values: {
        'visit.nodes': ['neck'],
      },
    );
    expect(fieldHost('visit.nodes'), findsNothing);
    expect(find.text('Demo: neck'), findsNothing);
    expect(fieldHost('visit.node_findings.neck'), findsNothing);
    await pumpForm(
      tester,
      hidden,
      values: {
        'visit.seen': true,
        'visit.nodes': ['neck'],
      },
    );
    expect(fieldHost('visit.node_findings.neck'), findsOneWidget);
  });

  testWidgets('a flag in a group makes the fields it clears read-only', (tester) async {
    final wound = presetDefinition('wound_care');
    const e = 'e0000001';
    await pumpForm(
      tester,
      wound,
      values: {
        'wound.$e.entryAt': '2026-11-17T10:00:00Z',
        'wound.$e.measurements.unable': true,
        'wound.$e.measurements.length': 2,
      },
    );
    expect(tester.widget<FieldHost>(fieldHost('wound.$e.measurements.length')).enabled, isFalse);
    expect(tester.widget<FieldHost>(fieldHost('wound.$e.measurements.unable')).enabled, isTrue);
  });

  testWidgets('a field in a group shows by its own condition', (tester) async {
    final general = presetDefinition('general_primary_care');
    final values = <String, Object?>{
      'exam.systems': ['cardiovascular'],
    };
    await pumpForm(tester, general, values: values, openSection: 'heart');
    expect(fieldHost('heart.murmur.character'), findsNothing);
    await pumpForm(
      tester,
      general,
      values: {
        ...values,
        'heart.sounds': ['murmur'],
      },
      openSection: 'heart',
    );
    expect(fieldHost('heart.murmur.character'), findsOneWidget);
  });

  testWidgets('a grid draws a cell for each row and side, at the cell’s path', (tester) async {
    final general = presetDefinition('general_primary_care');
    await pumpForm(
      tester,
      general,
      values: {
        'exam.systems': ['cardiovascular'],
      },
      openSection: 'cv_perfusion',
    );
    for (final row in ['radial', 'dorsalis_pedis_dp', 'posterior_tibial_pt']) {
      for (final side in ['right', 'left']) {
        expect(fieldHost('cv_perfusion.pulses.$row.$side'), findsOneWidget, reason: '$row $side');
      }
    }
    // A collapsed grid is closed until tapped.
    expect(fieldHost('cv_perfusion.more_pulses.brachial.right'), findsNothing);
  });

  testWidgets('a grid’s cell is drawn bare, its row’s label standing for its own', (tester) async {
    final general = presetDefinition('general_primary_care');
    await pumpForm(
      tester,
      general,
      values: {
        'exam.systems': ['cardiovascular'],
      },
      openSection: 'cv_perfusion',
    );
    // Pulses is the grid's own label; Pulse, its cell's, is not shown.
    expect(find.text('Pulse'), findsNothing);
    expect(find.text('Radial'), findsOneWidget);
  });

  testWidgets('a choice’s Other text in a grid row with sides is kept before the side', (tester) async {
    final demo = definitionOf([
      {
        'id': 'feet',
        'title': 'Demo: feet',
        'fields': [
          {
            'id': 'check',
            'kind': 'grid',
            'label': 'Demo: checks',
            'sides': true,
            'rows': [
              {'code': 'toes', 'label': 'Demo toes'},
            ],
            'cell': {
              'id': 'result',
              'kind': 'choice',
              'label': 'Demo: result',
              'many': false,
              'options': [
                {'code': 'fine', 'label': 'Demo fine'},
                {'code': 'other', 'label': 'Demo other', 'other': true},
              ],
            },
          },
        ],
      },
    ]);
    final answers = await pumpForm(tester, demo, values: {'feet.check.toes.right': 'other'});
    await tester.enterText(find.byKey(const ValueKey('phi.form.result_other')), 'Demo: bruised');
    await tester.pump(const Duration(seconds: 2));
    expect(answers.changes.last, ('feet.check.toes_other.right', 'Demo: bruised'));
  });

  testWidgets('a grid of picked rows has a row for each option picked, and a cell shows by its row', (tester) async {
    final general = presetDefinition('general_primary_care');
    final values = <String, Object?>{
      'exam.systems': ['lymphatic'],
      'lymphatic.nodes': ['cervical', 'inguinal'],
      'lymphatic.node_findings.inguinal.findings': ['enlarged'],
    };
    await pumpForm(tester, general, values: values, openSection: 'lymphatic');
    expect(fieldHost('lymphatic.node_findings.cervical.findings'), findsOneWidget);
    expect(fieldHost('lymphatic.node_findings.inguinal.findings'), findsOneWidget);
    expect(fieldHost('lymphatic.node_findings.axillary.findings'), findsNothing);
    // Size shows once that row's findings are in (./findings, from the row).
    expect(fieldHost('lymphatic.node_findings.cervical.size'), findsNothing);
    expect(fieldHost('lymphatic.node_findings.inguinal.size'), findsOneWidget);
    // A row whose option is unpicked is not drawn, and what it held is left alone.
    await pumpForm(
      tester,
      general,
      values: {
        ...values,
        'lymphatic.nodes': ['cervical'],
      },
      openSection: 'lymphatic',
    );
    expect(fieldHost('lymphatic.node_findings.inguinal.findings'), findsNothing);
  });

  testWidgets('an action is offered only where the screen gives it something to do', (tester) async {
    await pumpForm(tester, demo);
    expect(find.text('Open the demo note'), findsNothing);
    final asked = <(String, String)>[];
    var opened = 0;
    await pumpForm(
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
    await pumpForm(tester, demo, actions: (field, path) => null);
    expect(find.text('Open the demo note'), findsNothing);
    expect(find.byType(ActionField), findsNothing);
  });

  testWidgets('a read-only form opens its sections to be read, and offers nothing to change', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = await pumpForm(
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
    await toggleSection(tester, 'later');
    expect(find.text('Demo: Friday'), findsOneWidget);
    expect(answers.changes, isEmpty);
    handle.dispose();
  });
}
