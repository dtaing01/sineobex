import 'package:flutter/material.dart';

import '../../design/tokens.dart';
import '../../forms/definition.dart';
import 'choice_field.dart';
import 'text_field.dart' show ReadOnlyAnswer;

/// What a region holds: its three parts, each a code or none (forms 2.3).
typedef RegionAnswer = ({String? region, String? side, String? surface});

/// The parts a region stores at, after the field's path, in the order the read view writes them.
const regionParts = ['region', 'side', 'surface'];

/// The parts of a region as stored: [stored] gives what is at each part. Anything but a code is none.
RegionAnswer regionAnswer(Object? Function(String part) stored) {
  String? code(String part) => switch (stored(part)) {
    final String c when c.isNotEmpty => c,
    _ => null,
  };
  return (region: code('region'), side: code('side'), surface: code('surface'));
}

/// A region written out as the read view writes it: the labels of the parts held, joined by ', '.
/// A code the field's lists do not hold is shown as stored. Null when no part is held.
String? regionText(RegionDef field, RegionAnswer value) {
  String label(List<OptionDef>? options, String code) =>
      options?.where((o) => o.code == code).firstOrNull?.label ?? code;
  final parts = [
    if (value.region case final c?) label(field.options, c),
    if (value.side case final c?) label(field.side, c),
    if (value.surface case final c?) label(field.surface, c),
  ];
  return parts.isEmpty ? null : parts.join(', ');
}

/// A region (forms 2.2 `region`, 2.3): where on the body. Until the body map is drawn (10.1 #3) it
/// is a list: one region from the field's options, then the side from the shared list the field
/// names, then front or back (its `surface`) where the field asks. Each is a choose-one of chips,
/// stored at its own part of the field's path, and tapping the picked chip again clears that part
/// alone. A region is never sided (D80): it has a side of its own.
///
/// PLAN-OPEN: how the body map is drawn (forms 10.1 #3). Until the team decides, the regions are
/// one list in the shared list's order, and front or back is the surface's own choice: nothing in
/// the definition says which view a region belongs to (Arms and Head are on both), and only the
/// surface stores front or back.
class RegionField extends StatelessWidget {
  const RegionField({
    super.key,
    required this.field,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });

  final RegionDef field;
  final RegionAnswer value;

  /// One part changed: [part] is one of [regionParts], [code] the code picked or null for none.
  final void Function(String part, String? code) onChanged;

  /// False: shown read-only, said so to a screen reader.
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    // The field host shows the label above.
    if (!enabled) return ReadOnlyAnswer(label: field.label, value: regionText(field, value), showLabel: false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _part(context, 'region', field.label, field.options, value.region, heading: false),
        if (field.side case final side?) ...[
          const SizedBox(height: FieldSpace.s4),
          _part(context, 'side', 'Side', side, value.side),
        ],
        if (field.surface case final surface?) ...[
          const SizedBox(height: FieldSpace.s4),
          _part(context, 'surface', 'Front or back', surface, value.surface),
        ],
      ],
    );
  }

  Widget _part(
    BuildContext context,
    String part,
    String label,
    List<OptionDef> options,
    String? code, {
    bool heading = true,
  }) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (heading) ...[
        // The chips' group says it to a screen reader.
        ExcludeSemantics(child: Text(label, style: Theme.of(context).textTheme.labelLarge)),
        const SizedBox(height: FieldSpace.s1),
      ],
      ChoiceField(
        key: ValueKey('region.$part'),
        field: _choiceOf(field.id, part, label, options),
        value: code,
        onChanged: (v) => onChanged(part, v is String ? v : null),
      ),
    ],
  );
}

/// One part of a region as a choose-one, so its chips are drawn, read and cleared as a choice's.
ChoiceDef _choiceOf(String id, String part, String label, List<OptionDef> options) {
  // A definition's fields are read only from JSON; the part is written here as one.
  return NoteTypeDef.fromJson({
        'key': 'region_part',
        'version': 1,
        'title': 'Region',
        'kinds': ['medical'],
        'group': 'clinical',
        'sensitivity': 'none',
        'sections': [
          {
            'id': 'region',
            'title': 'Region',
            'fields': [
              {
                'id': '${id}_$part',
                'kind': 'choice',
                'many': false,
                'label': label,
                'options': [
                  // A region's lists hold no Other and no exclusive option (validate.region_option_flag).
                  for (final o in options) {'code': o.code, 'label': o.label},
                ],
              },
            ],
          },
        ],
      }).sections.single.fields.single
      as ChoiceDef;
}
