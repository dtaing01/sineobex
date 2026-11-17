import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/content_hash.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/effective.dart';
import 'package:sineobex_field/sync/canonical_json.dart';

/// The server's content-hash.ts answers the same vectors: it works out the hash a sign-off carries
/// again over what it holds, and a phone that hashed otherwise would have every Complete refused
/// with content_changed. This reader holds no answer of its own.
typedef Case = Map<String, Object?>;

/// The keys a case has, the optional ones ending in '?'. A case with another key would be read
/// without what it meant to say.
const keys = [
  'name',
  'why?',
  'definition',
  'noteId',
  'encounterId',
  'patientId',
  'summary',
  'answers',
  'effective',
  'content',
  'hash',
  'sameHashAs?',
];

List<String> keyFaults(Case c) {
  final known = {for (final k in keys) k.replaceAll('?', '')};
  return [
    for (final k in c.keys)
      if (!known.contains(k)) 'has no use for $k',
    for (final k in keys)
      if (!k.endsWith('?') && !c.containsKey(k)) 'needs $k',
  ];
}

Map<String, Object?> vector(String name) =>
    jsonDecode(File('../../packages/contract/test-vectors/$name').readAsStringSync()) as Map<String, Object?>;

void main() {
  final file = vector('note-content-hash.json');
  final cases = (file['cases']! as List<Object?>).cast<Case>();
  final definitions = (vector('forms-conformance.json')['definitions']! as Map<String, Object?>).map(
    (name, json) => MapEntry(name, NoteTypeDef.fromJson(json! as Map<String, Object?>)),
  );

  NoteTypeDef definitionOf(Case c) =>
      definitions[c['definition']] ?? (throw StateError('${c['name']}: no definition ${c['definition']}'));
  Map<String, Object?> answersOf(Case c) => c['answers']! as Map<String, Object?>;

  String contentOf(Case c) => canonicalJson(
    noteContent(
      noteId: c['noteId']! as String,
      encounterId: c['encounterId']! as String,
      patientId: c['patientId'] as String?,
      summary: c['summary'] as String?,
      definition: definitionOf(c),
      answers: answersOf(c),
    ),
  );

  String hashOf(Case c) => noteContentHash(
    noteId: c['noteId']! as String,
    encounterId: c['encounterId']! as String,
    patientId: c['patientId'] as String?,
    summary: c['summary'] as String?,
    definition: definitionOf(c),
    answers: answersOf(c),
  );

  test('the file holds a note and cases, each with exactly the keys it is read by', () {
    expect(file.keys.toList()..sort(), ['cases', 'note']);
    expect(cases, hasLength(greaterThan(15)));
    expect(cases.map((c) => c['name']).toSet(), hasLength(cases.length), reason: 'one name per case');
    for (final c in cases) {
      expect(keyFaults(c), isEmpty, reason: '${c['name']}');
      expect(definitions, contains(c['definition']), reason: '${c['name']}: a definition of forms-conformance.json');
      expect(c['hash'], matches(RegExp(r'^[0-9a-f]{64}$')), reason: '${c['name']}');
    }
  });

  test('it says which cases hash the same, and every other case hashes otherwise', () {
    final byName = {for (final c in cases) c['name']: c};
    for (final c in cases.where((c) => c.containsKey('sameHashAs'))) {
      final other = byName[c['sameHashAs']];
      expect(other, isNotNull, reason: '${c['name']}: sameHashAs names a case');
      expect(c['hash'], other!['hash'], reason: '${c['name']}');
    }
    final apart = [
      for (final c in cases)
        if (!c.containsKey('sameHashAs')) c['hash'],
    ];
    expect(apart.toSet(), hasLength(apart.length));
  });

  for (final c in cases) {
    test(c['name']! as String, () {
      // The answers that count are the forms interpreter's: a case whose effective answers it does
      // not give would pin a hash over something no signer sees.
      final effective = effectiveAnswers(definitionOf(c), answersOf(c));
      final expected = c['effective']! as Map<String, Object?>;
      expect(effective, expected);
      expect(effective.keys.toList(), expected.keys.toList(), reason: 'in UTF-16 code-unit order');

      expect(contentOf(c), c['content']);
      expect(hashOf(c), c['hash']);
    });
  }
}
