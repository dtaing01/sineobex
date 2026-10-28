import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/patients/normalize.dart';

/// Hand-checked against `sineobex.normalize_name` on Postgres 16 until normalize.json, generated
/// from Postgres by the matching work, lands.
void main() {
  test('takes accents, case and punctuation off the way normalize_name does', () {
    const cases = {
      'José': 'jose',
      'JOSÉ': 'jose',
      "O'Brien": 'o brien',
      'Mary-Kate': 'mary kate',
      '  big   MIKE ': 'big mike',
      'Ñúñez': 'nunez',
      'Łukasz Wałęsa': 'lukasz walesa',
      'Ægir Øvreås': 'aegir ovreas',
      'Straße': 'strasse',
      'Œuvre': 'oeuvre',
      'Nguyễn Thị': 'nguyen thi',
      'Dvořák': 'dvorak',
      'Del #2 (Smitty)': 'del 2 smitty',
    };
    cases.forEach((input, expected) => expect(normalizeName(input), expected, reason: input));
  });

  test('drops decomposed marks with the letter kept', () {
    expect(normalizeName('José'), 'jose');
    expect(normalizeName('Nuñez'), 'nunez');
  });

  test('nothing left is null, as in Postgres', () {
    for (final input in [null, '', '   ', "'-.", 'Дмитрий', '李']) {
      expect(normalizeName(input), isNull, reason: '$input');
    }
    // Non-Latin scripts are dropped, Latin words around them kept (design risk 14.2-7).
    expect(normalizeName('Ana Дмитрий'), 'ana');
  });

  test('splits into tokens and drops weak words unless nothing else is left', () {
    expect(nameTokens(normalizeName('Big Mike Jones')), ['big', 'mike', 'jones']);
    expect(nameTokens(null), isEmpty);
    expect(scoringTokens(['big', 'mike']), ['mike']);
    expect(scoringTokens(['mr', 'jones', 'jr']), ['jones']);
    expect(scoringTokens(['big']), ['big']);
    expect(scoringTokens(['the', 'old']), ['the', 'old']);
  });
}
