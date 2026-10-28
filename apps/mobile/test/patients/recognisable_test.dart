import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/patients/recognisable.dart';

/// The same cases as the server's recognisable.test.ts, and the patient creates of the shared sync
/// vectors: a create the server refuses with `nothing_to_recognise` must be one the phone refuses
/// before it enters the outbox.
void main() {
  final file = File('../../packages/contract/test-vectors/sync-values.json');
  final vectors = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
  List<Map<String, Object?>> patientCreates(String key) => (vectors[key]! as List<Object?>)
      .cast<Map<String, Object?>>()
      .where((c) => c['entity'] == 'patient' && c['op'] == 'create')
      .toList();

  test('agrees with the shared vectors on which intakes leave someone recognisable', () {
    final valid = patientCreates('valid');
    expect(valid, hasLength(greaterThan(3)));
    for (final c in valid) {
      expect(isRecognisable(c['value']! as Map<String, Object?>), isTrue, reason: c['name']! as String);
    }
    final refused = patientCreates('invalid')
        .where((c) => (c['expect']! as Map<String, Object?>)['problem'] == 'nothing_to_recognise')
        .toList();
    expect(refused, isNotEmpty);
    for (final c in refused) {
      expect(isRecognisable(c['value']! as Map<String, Object?>), isFalse, reason: c['name']! as String);
    }
  });

  test('names the three synced fields that hold the four columns', () {
    expect(recognisableFields, ['preferredName', 'legalName', 'visualDescriptor']);
    expect(isRecognisableField('usualArea'), isFalse);
    expect(isRecognisableField('legalName'), isTrue);
  });

  test('counts a preferred name, either legal name part, or a description', () {
    expect(isRecognisable({'preferredName': 'Del'}), isTrue);
    expect(
      isRecognisable({
        'legalName': {'given': null, 'family': 'Okoye'},
      }),
      isTrue,
    );
    expect(
      isRecognisable({
        'legalName': {'given': 'Rae', 'family': null},
      }),
      isTrue,
    );
    expect(isRecognisable({'visualDescriptor': 'Demo: man in blue wheelchair'}), isTrue);
    expect(isRecognisable({}), isFalse);
    expect(
      isRecognisable({
        'preferredName': null,
        'legalName': {'given': null, 'family': null},
        'visualDescriptor': '',
      }),
      isFalse,
    );
    expect(isRecognisable({'preferredName': '   '}), isFalse);
    // Only what identifies someone counts.
    expect(isRecognisable({'usualArea': 'Demo: by the library steps'}), isFalse);
  });

  test('refuses to clear the last of them, whichever it is', () {
    final both = {'preferredName': 'Sunny', 'visualDescriptor': 'Demo: red scarf', 'legalName': null};
    expect(recognisableAfter(both, 'visualDescriptor', null), isTrue);
    expect(recognisableAfter(both, 'preferredName', null), isTrue);
    // Two phones each clear one: the second write would leave nothing.
    final afterFirst = {'preferredName': 'Sunny', 'visualDescriptor': null, 'legalName': null};
    expect(recognisableAfter(afterFirst, 'preferredName', null), isFalse);
    expect(recognisableAfter(afterFirst, 'preferredName', 'Sun'), isTrue);
    final legalOnly = {
      'preferredName': null,
      'visualDescriptor': null,
      'legalName': {'given': 'Rae', 'family': 'Okoye'},
    };
    expect(recognisableAfter(legalOnly, 'legalName', {'given': null, 'family': 'Okoye'}), isTrue);
    expect(recognisableAfter(legalOnly, 'legalName', null), isFalse);
  });

  test('lets any other field change on a recognisable record', () {
    expect(recognisableAfter({'preferredName': 'Del'}, 'usualArea', null), isTrue);
    expect(recognisableAfter({}, 'usualArea', 'Demo: Elm St'), isFalse);
  });
}
