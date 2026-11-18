import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/note_read_view.dart';
import 'package:sineobex_field/features/patients/patient_labels.dart' show longDate;
import 'package:sineobex_field/features/sync/sync_labels.dart' show timeOfDay;
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/read_model.dart';

import 'forms_test_helpers.dart';

/// The read view (forms 8.1, 8.3; lifecycle 9.7): a finished note as its read model lays it out,
/// tested on the conformance definitions, whose readModel cases the interpreter is held to.
void main() {
  final vectors = jsonDecode(
    File('../../packages/contract/test-vectors/forms-conformance.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final definitions = (vectors['definitions']! as Map<String, Object?>).map(
    (name, json) => MapEntry(name, NoteTypeDef.fromJson(json! as Map<String, Object?>)),
  );
  final cases = ((vectors['cases']! as Map<String, Object?>)['readModel']! as List<Object?>)
      .cast<Map<String, Object?>>();

  ReadModel modelOf(Map<String, Object?> c) => readModel(
    definitions[c['definition']]!,
    c['answers']! as Map<String, Object?>,
    [for (final row in (c['corrections']! as List<Object?>).cast<Map<String, Object?>>()) NoteCorrection.fromJson(row)],
  );
  Map<String, Object?> caseNamed(String start) => cases.firstWhere((c) => (c['name']! as String).startsWith(start));

  /// Who, when and why of a correction, as the view words it on this phone's clock.
  String changedBy(BuildContext context, String name, String credential, String at) {
    final t = DateTime.parse(at).toLocal();
    return 'Changed by $name, $credential, ${longDate(t)} at ${timeOfDay(context, t)}';
  }

  BuildContext viewContext(WidgetTester tester) => tester.element(find.byType(NoteReadView));

  // Every case of the conformance file, drawn: each section, entry and item the model holds, with
  // its labels and value, and each correction's old value under it.
  for (final c in cases) {
    testWidgets('draws what the read model holds: ${c['name']}', (tester) async {
      final handle = tester.ensureSemantics();
      final model = modelOf(c);
      await pumpField(tester, NoteReadView(model: model));
      final items = [
        for (final s in model.sections) ...[...s.items, for (final e in s.entries ?? const <ReadEntry>[]) ...e.items],
      ];
      for (final s in model.sections) {
        expect(find.text(s.title), findsWidgets, reason: s.title);
        for (final e in s.entries ?? const <ReadEntry>[]) {
          expect(find.text(e.title), findsOneWidget, reason: e.title);
        }
      }
      if (model.sections.isEmpty) expect(find.text(NoteReadView.nothing), findsOneWidget);
      for (final item in items) {
        final node = tester.getSemantics(find.byKey(ValueKey('read.${item.path}')));
        expect(node.label, item.labels.join(', '), reason: item.path);
        expect(node.value, item.value ?? 'No answer now', reason: item.path);
        if (item.value case final value?) expect(find.text(value), findsWidgets, reason: item.path);
        for (final (i, correction) in item.corrections.indexed) {
          final line = find.byKey(ValueKey('read.${item.path}.correction.$i'));
          expect(line, findsOneWidget);
          expect(
            tester.getSemantics(line).label,
            startsWith('Replaced: ${correction.old ?? 'blank'}'),
            reason: '${item.path} #$i',
          );
          expect(find.descendant(of: line, matching: find.text('Reason: ${correction.reason}')), findsOneWidget);
        }
      }
      await expectFieldOk(tester);
      handle.dispose();
    });
  }

  forEachRun('a corrected answer shows the new value, the old one struck through, who, when and why', (
    tester,
    run,
  ) async {
    await pumpField(tester, NoteReadView(model: modelOf(caseNamed('two corrections of one answer'))), run: run);
    expect(find.text('Demo vitals'), findsOneWidget);
    expect(find.text('Demo pulse'), findsOneWidget);
    expect(find.text('90 bpm'), findsOneWidget);
    for (final old in ['70 bpm', '80 bpm']) {
      final struck = tester.widget<Text>(find.text(old));
      expect(struck.style?.decoration, TextDecoration.lineThrough, reason: old);
    }
    final context = viewContext(tester);
    expect(find.text(changedBy(context, 'Demo Rivera', 'Nurse practitioner', '2026-11-02T10:00:00Z')), findsOneWidget);
    expect(find.text(changedBy(context, 'Demo Okafor', 'Attending physician', '2026-11-03T09:30:00Z')), findsOneWidget);
    expect(find.text('Reason: Demo: entered on the wrong line'), findsOneWidget);
    expect(find.text('Reason: Demo: second look'), findsOneWidget);
    // The old values in the order given, each read as what it replaced.
    final first = tester.getSemantics(find.byKey(const ValueKey('read.vitals.pulse.correction.0')));
    final second = tester.getSemantics(find.byKey(const ValueKey('read.vitals.pulse.correction.1')));
    expect(first.label, startsWith('Replaced: 70 bpm'));
    expect(first.label, contains('Reason: Demo: entered on the wrong line'));
    expect(second.label, startsWith('Replaced: 80 bpm'));
    expect(
      tester.getTopLeft(find.text('70 bpm')).dy,
      lessThan(tester.getTopLeft(find.text('80 bpm')).dy),
      reason: 'corrections in the order given',
    );
    expect(
      tester.getTopLeft(find.text('90 bpm')).dy,
      lessThan(tester.getTopLeft(find.text('70 bpm')).dy),
      reason: 'the new value above the old ones',
    );
    await expectFieldOk(tester);
  });

  forEachRun('an answer a correction took away shows no value, only the old one struck through', (tester, run) async {
    await pumpField(tester, NoteReadView(model: modelOf(caseNamed('a correction that cleared an answer'))), run: run);
    final item = tester.getSemantics(find.byKey(const ValueKey('read.heart.rhythm')));
    expect(item.label, 'Demo rhythm');
    expect(item.value, 'No answer now');
    expect(find.text('No answer now'), findsNothing, reason: 'no value is shown, only the old one');
    final struck = tester.widget<Text>(find.text('Demo regular'));
    expect(struck.style?.decoration, TextDecoration.lineThrough);
    expect(
      tester.getSemantics(find.byKey(const ValueKey('read.heart.rhythm.correction.0'))).label,
      startsWith('Replaced: Demo regular'),
    );
    await expectFieldOk(tester);
  });

  forEachRun('a repeating section: each entry under its title, and nothing to tap', (tester, run) async {
    await pumpField(tester, NoteReadView(model: modelOf(caseNamed('a repeating section'))), run: run);
    expect(find.text('Demo wounds'), findsOneWidget);
    expect(tester.getTopLeft(find.text('Demo wound 2')).dy, lessThan(tester.getTopLeft(find.text('Demo wound 3')).dy));
    expect(find.text('Demo purulent, Demo other: Demo: green'), findsOneWidget);
    expect(find.semantics.byAction(SemanticsAction.tap), findsNothing);
    await expectFieldOk(tester);
  });

  testWidgets('sections and entries are headings; an item is read as its labels, then its value', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpField(tester, NoteReadView(model: modelOf(caseNamed('grids with sides'))));
    final model = modelOf(caseNamed('grids with sides'));
    for (final s in model.sections) {
      expect(tester.getSemantics(find.bySemanticsLabel(s.title).first), isSemantics(isHeader: true, label: s.title));
    }
    final item = model.sections.expand((s) => s.items).firstWhere((i) => i.labels.length > 1);
    expect(find.text(item.labels.join(', ')), findsOneWidget);
    expect(
      tester.getSemantics(find.byKey(ValueKey('read.${item.path}'))),
      isSemantics(label: item.labels.join(', '), value: item.value, isReadOnly: true),
    );
    await pumpField(tester, NoteReadView(model: modelOf(caseNamed('a repeating section'))));
    expect(tester.getSemantics(find.bySemanticsLabel('Demo wound 2')), isSemantics(isHeader: true));
    handle.dispose();
  });

  testWidgets('an old value that was blank reads as blank', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpField(tester, NoteReadView(model: modelOf(caseNamed('one correction of two answers'))));
    final line = find.byKey(const ValueKey('read.vitals.pulse.correction.0'));
    expect(tester.getSemantics(line).label, startsWith('Replaced: blank'));
    expect(find.descendant(of: line, matching: find.text('(blank)')), findsOneWidget);
    await expectFieldOk(tester);
    handle.dispose();
  });

  testWidgets('a credential is worded; one this phone doesn’t know is left out', (tester) async {
    final handle = tester.ensureSemantics();
    ReadModel corrected(String credential, String at) {
      final model = readModel(
        definitions['visit']!,
        {'vitals.pulse': 80},
        [
          NoteCorrection(
            outcome: 'corrected',
            reason: 'Demo: wrong line',
            correctorName: 'Demo Ito',
            correctorCredential: credential,
            correctedAt: at,
            changes: const [CorrectionChange(field: 'data.vitals.pulse', oldValue: 70, newValue: 80)],
          ),
        ],
      );
      return model;
    }

    // The words themselves are credentialText's (test/encounters/credentials_test.dart).
    await pumpField(tester, NoteReadView(model: corrected('demo_new_credential', '2026-11-02T10:00:00Z')));
    final t = DateTime.parse('2026-11-02T10:00:00Z').toLocal();
    expect(find.text('Changed by Demo Ito, ${longDate(t)} at ${timeOfDay(viewContext(tester), t)}'), findsOneWidget);
    // A time this phone can't read is shown as it came.
    await pumpField(tester, NoteReadView(model: corrected('np', 'Demo: not a time')));
    expect(find.text('Changed by Demo Ito, Nurse practitioner, Demo: not a time'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('the screen can put an action under an answer', (tester) async {
    final handle = tester.ensureSemantics();
    final tapped = <String>[];
    await pumpField(
      tester,
      NoteReadView(
        model: modelOf(caseNamed('a corrected answer')),
        itemAction: (item) => item.path == 'vitals.pulse'
            ? TextButton(onPressed: () => tapped.add(item.path), child: const Text('Correct'))
            : null,
      ),
    );
    expect(find.text('Correct'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('Correct')).dy,
      greaterThan(tester.getTopLeft(find.text('70 bpm')).dy),
      reason: 'under the answer and its old values',
    );
    await tester.tap(find.text('Correct'));
    expect(tapped, ['vitals.pulse']);
    await expectFieldOk(tester);
    handle.dispose();
  });

  forEachRun('a note with nothing recorded says so', (tester, run) async {
    await pumpField(tester, NoteReadView(model: modelOf(caseNamed('no answer'))), run: run);
    expect(find.text(NoteReadView.nothing), findsOneWidget);
    await expectFieldOk(tester);
  });
}
