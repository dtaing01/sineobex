import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/normal.dart';

Map<String, Object?> _choice(String id) => {
  'id': id,
  'kind': 'choice',
  'many': false,
  'label': 'Demo $id',
  'options': [
    {'code': 'ok', 'label': 'Demo ok', 'normal': true},
    {'code': 'bad', 'label': 'Demo bad'},
  ],
};

Map<String, Object?> _text(String id, Map<String, Object?> showWhen) => {
  'id': id,
  'kind': 'text',
  'lines': 'one',
  'maxLength': 40,
  'label': 'Demo $id',
  'showWhen': showWhen,
};

/// What no vector case shows yet (conformance_test.dart runs those): one-tap Normal tries a normal
/// it passed over again once others are kept (forms 7.1), and keeps it when they let it hide nothing.
/// packages/forms/src/interp/normal.ts gives the same answer on this definition, which its
/// validator passes.
void main() {
  test('a normal passed over is tried again once a later one is kept', () {
    final definition = NoteTypeDef.fromJson({
      'key': 'demo_retry',
      'version': 1,
      'title': 'Demo retry',
      'kinds': ['medical'],
      'group': 'clinical',
      'sensitivity': 'none',
      'sections': [
        {
          'id': 'look',
          'title': 'Demo look',
          'normal': true,
          'fields': [
            _choice('a'),
            _choice('b'),
            _choice('c'),
            // Charted, and shown while a is not ok or b is: a alone would hide it, a with b does not.
            _text('d', {
              'any': [
                {
                  'not': {'field': 'look.a', 'is': 'ok'},
                },
                {'field': 'look.b', 'is': 'ok'},
              ],
            }),
            // Charted, and hidden by c's normal, so every normal at once hides an answer.
            _text('e', {
              'not': {'field': 'look.c', 'is': 'ok'},
            }),
          ],
        },
      ],
    });
    final charted = {'look.d': 'Demo: seen', 'look.e': 'Demo: seen'};
    expect(normalAnswers(definition, 'look', charted), {'look.a': 'ok', 'look.b': 'ok'});
  });
}
