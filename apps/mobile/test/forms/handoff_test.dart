import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/handoff.dart';

/// What the vectors cannot say (conformance_test.dart runs them): a case gives one list of notes,
/// each with its definition, so it can never pass the two lists of different lengths.
void main() {
  final definitions =
      (jsonDecode(File('../../packages/contract/test-vectors/forms-conformance.json').readAsStringSync())
              as Map<String, Object?>)['definitions']!
          as Map<String, Object?>;
  final ems = NoteTypeDef.fromJson(definitions['ems']! as Map<String, Object?>);

  test('handoffLines refuses a definition without its note, rather than pairing the wrong ones', () {
    expect(
      () => handoffLines(
        [ems, ems],
        [
          {'ems.called': '14:05'},
        ],
        const [],
      ),
      throwsA(isA<ArgumentError>().having((e) => '${e.message}', 'message', contains('2 definitions for 1 notes'))),
    );
  });
}
