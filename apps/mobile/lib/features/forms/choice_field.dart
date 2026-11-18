import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../forms/definition.dart';
import '../../forms/paths.dart' show maxOtherText;
import 'text_field.dart' show NoteTextField, ReadOnlyAnswer;

/// The codes a stored choice holds: one code, or a list of codes. Anything else holds none.
List<String> pickedCodes(Object? stored) => switch (stored) {
  final String code => [code],
  final List<Object?> codes => [
    for (final c in codes)
      if (c is String) c,
  ],
  _ => const [],
};

/// A choice (forms 2.2 `choice`, 8.2): its options as chips that wrap, each a button that says its
/// label and whether it is selected. Choose-one stores a code; tapping the picked chip again clears
/// it. Choose-many stores the codes in the definition's order, so the answer is the same whatever
/// order they were tapped in (2.3). An exclusive option (None, Normal) clears the others, and
/// another clears it. A blocked pair is not picked: one line under the chips says why. So the
/// widget never stores what `checkAnswer` refuses (`exclusive_with_others`, `excluded_pair`).
///
/// An Other option opens a box for its text, which is its own answer beside the choice ([other],
/// [onOtherChanged]). Unpicking Other hides the box and leaves the text: it no longer counts
/// (7.1), and clearing it would be one more change to sync.
class ChoiceField extends StatefulWidget {
  const ChoiceField({
    super.key,
    required this.field,
    required this.value,
    required this.onChanged,
    this.other,
    this.onOtherChanged,
    this.enabled = true,
  });

  final ChoiceDef field;

  /// As stored: a code, a list of codes, or null.
  final Object? value;

  /// A code (choose-one), a list of codes in the definition's order (choose-many), or `null` when
  /// nothing is picked, never an empty list.
  final ValueChanged<Object?> onChanged;

  /// The Other text, as stored.
  final String? other;

  /// The Other text, trimmed, or `null` for none.
  final ValueChanged<String?>? onOtherChanged;

  /// False: shown read-only, said so to a screen reader.
  final bool enabled;

  @override
  State<ChoiceField> createState() => _ChoiceFieldState();
}

class _ChoiceFieldState extends State<ChoiceField> {
  /// What this widget last showed as picked. Two taps before the form draws again both count.
  late List<String> _picked = pickedCodes(widget.value);

  /// The line under the chips when a blocked pair was refused.
  String? _blocked;

  /// The box of the Other text: a one-line text answer of at most 200 code points (2.3), keyed by
  /// the field so its box is `phi.form.<id>_other`.
  late final TextDef? _otherText = otherTextField(widget.field);

  @override
  void didUpdateWidget(ChoiceField old) {
    super.didUpdateWidget(old);
    final now = pickedCodes(widget.value);
    // Changed by the form (a save, a sync, a conflict choice): shown.
    if (!_sameCodes(pickedCodes(old.value), now)) _picked = now;
  }

  ChoiceDef get _f => widget.field;

  String _label(String code) => _f.options.firstWhere((o) => o.code == code).label;

  bool _isExclusive(String code) => _f.options.any((o) => o.code == code && o.exclusive);

  bool _blocks(String a, String b) => _f.excludes.any((p) => (p.$1 == a && p.$2 == b) || (p.$1 == b && p.$2 == a));

  void _tap(OptionDef option) {
    final code = option.code;
    final List<String> next;
    if (_picked.contains(code)) {
      next = _f.many ? [..._picked.where((c) => c != code)] : const [];
    } else if (!_f.many || option.exclusive) {
      next = [code];
    } else {
      final kept = [..._picked.where((c) => !_isExclusive(c))];
      final clash = kept.where((c) => _blocks(code, c)).firstOrNull;
      if (clash != null) return _refuse('${option.label} can’t be picked with ${_label(clash)}.');
      next = [...kept, code];
    }
    final ordered = [
      for (final o in _f.options)
        if (next.contains(o.code)) o.code,
    ];
    setState(() {
      _picked = ordered;
      _blocked = null;
    });
    widget.onChanged(ordered.isEmpty ? null : (_f.many ? ordered : ordered.single));
  }

  /// Shows why a pick was refused. Said once: a second tap on the same chip says nothing new.
  void _refuse(String why) {
    if (why == _blocked) return;
    setState(() => _blocked = why);
    // Where the platform takes announcements (iOS), one now; elsewhere the line is a live region.
    if (MediaQuery.supportsAnnounceOf(context)) {
      unawaited(SemanticsService.sendAnnouncement(View.of(context), why, Directionality.of(context)));
    }
  }

  /// What is picked, written out as the read view writes it: labels in the definition's order, an
  /// Other option followed by its text.
  String? _written() {
    final labels = [
      for (final o in _f.options)
        if (_picked.contains(o.code))
          o.other && (widget.other?.isNotEmpty ?? false) ? '${o.label}: ${widget.other}' : o.label,
    ];
    return labels.isEmpty ? null : labels.join(', ');
  }

  @override
  Widget build(BuildContext context) {
    // The field host shows the label above.
    if (!widget.enabled) return ReadOnlyAnswer(label: _f.label, value: _written(), showLabel: false);
    final text = Theme.of(context).textTheme;
    final otherText = _f.options.any((o) => o.other && _picked.contains(o.code)) ? _otherText : null;
    return Semantics(
      container: true,
      label: _f.label,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(spacing: FieldSpace.s2, runSpacing: FieldSpace.s2, children: [for (final o in _f.options) _chip(o)]),
          if (_blocked != null) ...[
            const SizedBox(height: FieldSpace.s2),
            Semantics(
              container: true,
              liveRegion: !MediaQuery.supportsAnnounceOf(context),
              child: Text(
                _blocked!,
                style: text.bodyMedium?.copyWith(color: context.field.critical, fontWeight: FontWeight.w700),
              ),
            ),
          ],
          if (otherText != null) ...[
            const SizedBox(height: FieldSpace.s3),
            // Its own node: merged into the group, the box would be read as the field.
            Semantics(
              container: true,
              child: NoteTextField(
                field: otherText,
                value: widget.other,
                onChanged: (v) => widget.onOtherChanged?.call(v),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _chip(OptionDef o) {
    final on = _picked.contains(o.code);
    void tap() => _tap(o);
    // A picked chip's words on the accent, as the theme's selected label is.
    final chips = Theme.of(context).chipTheme;
    final style = on ? chips.secondaryLabelStyle : chips.labelStyle;
    // A picked choose-one chip clears the answer when tapped again, which a radio-like group
    // doesn't: said before it is done, as the tap's hint where the reader says one (Android), as the
    // chip's hint elsewhere (iOS), so it is said once.
    final clears = on && !_f.many;
    final hintsTap = !MediaQuery.supportsAnnounceOf(context);
    // One node per chip, the state on the button itself: "selected" or "not selected" comes from
    // the flag, so it is never said twice.
    return Semantics(
      container: true,
      button: true,
      selected: on,
      inMutuallyExclusiveGroup: !_f.many,
      enabled: true,
      label: o.other && on ? '${o.label}, text box below' : o.label,
      hint: clears && !hintsTap ? 'Double-tap to clear.' : null,
      onTapHint: clears && hintsTap ? 'clear' : null,
      onTap: tap,
      excludeSemantics: true,
      child: _f.many
          ? FilterChip(label: Text(o.label), labelStyle: style, selected: on, onSelected: (_) => tap())
          : ChoiceChip(
              label: Text(o.label),
              labelStyle: style,
              selected: on,
              showCheckmark: true,
              onSelected: (_) => tap(),
            ),
    );
  }
}

bool _sameCodes(List<String> a, List<String> b) =>
    a.length == b.length && [for (var i = 0; i < a.length; i++) a[i] == b[i]].every((same) => same);

/// The Other text of [field] as a text answer, so it is typed, limited, saved, read and offered in
/// a conflict as one is. Null for a field without an Other option.
TextDef? otherTextField(ChoiceDef field) {
  final option = field.options.where((o) => o.other).firstOrNull;
  if (option == null) return null;
  // A definition's fields are read only from JSON; the Other text is written here as one.
  return NoteTypeDef.fromJson({
        'key': 'other_text',
        'version': 1,
        'title': 'Other',
        'kinds': ['medical'],
        'group': 'clinical',
        'sensitivity': 'none',
        'sections': [
          {
            'id': 'other',
            'title': 'Other',
            'fields': [
              {
                'id': '${field.id}_other',
                'kind': 'text',
                'lines': 'one',
                'maxLength': maxOtherText,
                'label': 'Say what “${option.label}” is',
              },
            ],
          },
        ],
      }).sections.single.fields.single
      as TextDef;
}
