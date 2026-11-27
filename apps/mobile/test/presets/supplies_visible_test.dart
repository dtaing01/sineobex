import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/visible.dart';
import 'package:sineobex_field/presets/models.dart';
import 'package:sineobex_field/presets/supplies.dart';

/// suggestSupplies reads only the answers it is given, which are what the suggesting person may see
/// of the note: visibleAnswers' (forms 7.1), never the note's own. supply-suggest.json gives it
/// those answers ready made; this holds the two together on the phone, through its own interpreter.
/// An answer a sensitive exam put there fires nothing and gives no quantity for a reader who may not
/// see it, a map with no path's and a grid row's included, and the same note suggests every line to
/// a reader who may see it all. A supply line suggested from a hidden answer would tell them what
/// was found.
void main() {
  final definition = NoteTypeDef.fromJson({
    'key': 'demo_visit_supplies',
    'version': 1,
    'title': 'Demo visit supplies',
    'kinds': ['medical', 'non_medical'],
    'group': 'clinical',
    'sensitivity': 'none',
    'sections': [
      {
        'id': 'visit',
        'title': 'Demo visit',
        'fields': [
          {
            'id': 'given',
            'label': 'Demo given',
            'kind': 'choice',
            'many': true,
            'options': [
              {'code': 'water', 'label': 'Demo water'},
              {'code': 'socks', 'label': 'Demo socks'},
            ],
          },
        ],
      },
      {
        'id': 'exam',
        'title': 'Demo private exam',
        'sensitiveExam': true,
        'fields': [
          {'id': 'done', 'label': 'Demo exam done', 'kind': 'flag'},
          {'id': 'swabs', 'label': 'Demo swabs used', 'kind': 'number', 'min': 0, 'max': 99, 'decimals': 0},
        ],
      },
      {
        'id': 'skin',
        'title': 'Demo skin',
        'fields': [
          {
            'id': 'areas',
            'label': 'Demo areas',
            'kind': 'grid',
            'rows': [
              {'code': 'arm', 'label': 'Demo arm'},
              {'code': 'groin', 'label': 'Demo groin', 'sensitiveExam': true},
            ],
            'cell': {'id': 'pads', 'label': 'Demo pads used', 'kind': 'number', 'min': 0, 'max': 99, 'decimals': 0},
          },
        ],
      },
    ],
  });
  String item(int n) => '00000000-0000-4000-8000-00000000a00$n';
  final items = {for (var n = 1; n <= 5; n++) item(n): PresetState.active};
  SupplyMap map(String id, Map<String, Object?> body) => (
    id: id,
    body:
        parsePreset('field_supply_map', {'name': 'Demo: $id', 'noteTypeKey': 'demo_visit_supplies', ...body})!
            as FieldSupplyMapBody,
  );
  final maps = [
    // Once for every note, its quantity read from the exam.
    map('swabs', {
      'lines': [
        {
          'itemId': item(1),
          'qty': {'fromPath': 'exam.swabs'},
        },
      ],
    }),
    map('exam kit', {
      'path': 'exam.done',
      'when': {'equals': true},
      'lines': [
        {'itemId': item(2), 'qty': 1},
      ],
    }),
    // A grid's cells: one in a row a sensitive exam marks, one in a row it does not.
    map('groin pads', {
      'path': 'skin.areas.groin',
      'when': {'answered': true},
      'lines': [
        {
          'itemId': item(3),
          'qty': {'fromPath': 'skin.areas.groin'},
        },
      ],
    }),
    map('arm pads', {
      'path': 'skin.areas.arm',
      'when': {'answered': true},
      'lines': [
        {
          'itemId': item(4),
          'qty': {'fromPath': 'skin.areas.arm'},
        },
      ],
    }),
    map('water', {
      'path': 'visit.given',
      'when': {'includes': 'water'},
      'lines': [
        {'itemId': item(5), 'qty': 1},
      ],
    }),
  ];
  final note = <String, Object?>{
    'visit.given': ['water'],
    'exam.done': true,
    'exam.swabs': 3,
    'skin.areas.arm': 2,
    'skin.areas.groin': 4,
  };
  NoteReader reader({bool actsAsAuthor = false, bool viewSensitiveExams = false}) => NoteReader(
    actsAsAuthor: actsAsAuthor,
    viewSensitive: true,
    viewSensitiveExams: viewSensitiveExams,
    readsMedical: true,
    chartsMedical: true,
    ordersMedications: false,
    sensitiveCodes: const [],
  );
  List<SupplySuggestion> suggestedTo(NoteReader reader) => suggestSupplies(
    maps: maps,
    items: items,
    noteTypeKey: 'demo_visit_supplies',
    definition: definition,
    answers: visibleAnswers(definition, note, reader)!,
  );

  const everything = [
    (itemId: '00000000-0000-4000-8000-00000000a001', qty: 3, mapId: 'swabs'),
    (itemId: '00000000-0000-4000-8000-00000000a002', qty: 1, mapId: 'exam kit'),
    (itemId: '00000000-0000-4000-8000-00000000a003', qty: 4, mapId: 'groin pads'),
    (itemId: '00000000-0000-4000-8000-00000000a004', qty: 2, mapId: 'arm pads'),
    (itemId: '00000000-0000-4000-8000-00000000a005', qty: 1, mapId: 'water'),
  ];

  test('suggest every line to the note’s author, and to a reader who may see sensitive exams', () {
    expect(suggestedTo(reader(actsAsAuthor: true)), everything);
    expect(suggestedTo(reader(viewSensitiveExams: true)), everything);
  });

  test('suggest nothing from what a sensitive exam put there to a reader who may not see it', () {
    // The map with no path still fires for the note, but the quantity it reads is hidden, so 0.
    expect(suggestedTo(reader()), [
      (itemId: '00000000-0000-4000-8000-00000000a004', qty: 2, mapId: 'arm pads'),
      (itemId: '00000000-0000-4000-8000-00000000a005', qty: 1, mapId: 'water'),
    ]);
  });
}
