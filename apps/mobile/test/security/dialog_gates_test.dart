import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// D125, held for every dialog the app has and every one it gets (the coordinator's decision on
/// review findings VA-3 and VA-4): a modal route is not under its screen's freeze gate, so each one
/// that shows or takes something of a chart sits in a gate of its own (`sheet_gate.dart`): a
/// `SheetGate` over a sheet, a `DialogGate` over a dialog, `DialogGate.over` for a form field's
/// picker, and the `gate:` of `confirm` and `askReason`. This reads apps/mobile/lib and fails on a
/// call that is neither gated nor listed below with why it shows nothing of a chart.
void main() {
  /// Calls that show and take nothing of a chart, by file and a phrase of the call, with why.
  const allowed = <(String, String), String>{
    ('lib/features/encounters/start_sheet.dart', 'StartSheet('):
        'the ways to begin work: names no patient and takes nothing',
    ('lib/features/lock/lock_screens.dart', 'Sign out on this phone?'):
        'the lock screen: shown while the chart is locked away, and names no patient',
    ('lib/features/sync/sign_out_dialog.dart', '_SignOutDialog('):
        'Log out asks over counts of what waits to be sent, never what it is, and must still answer once the '
        'store froze: a frozen phone is signed out from it',
  };

  /// The calls that put a modal route up, and the two helpers that do it for a question.
  final opener = RegExp(
    r'(?<![\w.])(showDialog|showModalBottomSheet|showDatePicker|showTimePicker|showGeneralDialog|'
    r'showCupertinoDialog|showCupertinoModalPopup|showMenu|showSearch|confirm|askReason)\s*(<[^>()]*>)?\s*\(',
  );
  const gated = ['SheetGate', 'DialogGate', 'gate(', '_gated(', 'gate:'];

  /// The text of a call, from its open paren to the one that closes it.
  String callAt(String source, int open) {
    var depth = 0;
    for (var i = open; i < source.length; i++) {
      final c = source[i];
      if (c == '(') depth++;
      if (c == ')' && --depth == 0) return source.substring(open, i + 1);
    }
    return source.substring(open);
  }

  List<File> dartFiles(String dir) => [
    for (final f in Directory(dir).listSync(recursive: true))
      if (f is File && f.path.endsWith('.dart') && !f.path.contains('/generated/')) f,
  ]..sort((a, b) => a.path.compareTo(b.path));

  test('every dialog, sheet and picker in the app is gated, or listed with why it shows no chart detail', () {
    final ungated = <String>[];
    final used = <(String, String)>{};
    for (final file in dartFiles('lib')) {
      final source = file.readAsStringSync();
      for (final m in opener.allMatches(source)) {
        final lineStart = source.lastIndexOf('\n', m.start) + 1;
        final before = source.substring(lineStart, m.start).trim();
        // A declaration (`Future<bool> confirm(`, `void confirm(`), not a call.
        if (!before.endsWith('=>') && RegExp(r'(>|\bvoid)$').hasMatch(before)) continue;
        final call = callAt(source, source.indexOf('(', m.end - 1));
        if (gated.any(call.contains)) continue;
        final key = allowed.keys.where((k) => k.$1 == file.path && call.contains(k.$2)).firstOrNull;
        if (key != null) {
          used.add(key);
          continue;
        }
        final line = '\n'.allMatches(source.substring(0, m.start)).length + 1;
        ungated.add('${file.path}:$line ${m.group(1)}');
      }
    }
    expect(ungated, isEmpty, reason: 'gate these (sheet_gate.dart), or list them with why they show no chart detail');
    expect(used, allowed.keys.toSet(), reason: 'an allowed call that is gone, or moved: take it off the list');
  });

  test('every screen and sheet that draws a form field puts its pickers in a gate (DialogGateScope)', () {
    // A note's fields (FieldHost, DateField, TimeField, ProblemField, NoteForm) read through no services
    // of their own: their pickers are gated by the scope of the route they are drawn on.
    final field = RegExp(r'(?<![\w.])(FieldHost|DateField|TimeField|ProblemField|NoteForm)\(');
    final unscoped = <String>[];
    for (final file in dartFiles('lib')) {
      if (file.path.startsWith('lib/features/forms/')) continue;
      final source = file.readAsStringSync();
      if (field.hasMatch(source) && !source.contains('DialogGateScope(')) unscoped.add(file.path);
    }
    expect(unscoped, isEmpty);
  });
}
