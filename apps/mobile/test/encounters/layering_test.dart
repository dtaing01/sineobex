import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The domain layer imports no widget library and nothing of the screens (phase 4 design, 9): the
/// types a note form takes from it (`AnswerConflict`, `AnswerState`) live in `lib/forms/`, which the
/// field host exports.
void main() {
  test('nothing under lib/encounters imports a widget library or a screen', () {
    final offending = [
      for (final file in Directory('lib/encounters').listSync().whereType<File>())
        if (file.path.endsWith('.dart'))
          for (final line in file.readAsLinesSync())
            if (RegExp(r'''^import '(package:flutter/(material|widgets|cupertino)\.dart|.*features/)''').hasMatch(line))
              '${file.path}: $line',
    ];
    expect(offending, isEmpty);
  });
}
