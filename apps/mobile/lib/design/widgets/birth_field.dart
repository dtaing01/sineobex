import 'dart:async';

import 'package:flutter/material.dart';

import '../../patients/dob.dart';
import '../theme.dart';
import '../tokens.dart';

/// What the birth field holds: the typed text, the mode, what the phone understood, and whether the
/// worker confirmed a guess.
@immutable
class BirthEntry {
  const BirthEntry({this.text = '', this.mode = BirthMode.date, this.parsed, this.confirmed = false});

  final String text;
  final BirthMode mode;

  /// Null while nothing is typed.
  final BirthParse? parsed;

  /// **Yes, that's right** is on.
  final bool confirmed;

  bool get isEmpty => text.trim().isEmpty;
  Birth? get birth => switch (parsed) {
    ParsedBirth(:final birth) => birth,
    _ => null,
  };

  /// The phone guessed (a two-digit year, day and month either way, an age under 14 or over 100).
  bool get needsConfirmation => switch (parsed) {
    ParsedBirth(:final needsConfirmation) => needsConfirmation,
    _ => false,
  };

  String? get error => switch (parsed) {
    BirthError(:final message) => message,
    _ => null,
  };

  /// Saving may go ahead: nothing typed, or a birth understood (and confirmed where the phone
  /// guessed). Create and Update and save stay off otherwise (design 11.3).
  bool get ready => isEmpty || (birth != null && (!needsConfirmation || confirmed));

  Map<String, Object?> toDraft() => {'text': text, 'mode': mode.name};

  static BirthEntry fromDraft(Object? d, DateTime today) {
    if (d is! Map<String, Object?>) return const BirthEntry();
    final text = d['text'] as String? ?? '';
    final mode = d['mode'] == 'age' ? BirthMode.age : BirthMode.date;
    return BirthEntry(text: text, mode: mode, parsed: text.trim().isEmpty ? null : parseBirth(text, mode, today));
  }
}

/// Date of birth or age, one field (design 11.3): a segmented **Date of birth | Age**, the typed
/// text read back as one sentence (month spelled out) in a polite live region when the field loses
/// focus or after 800 ms without typing, and **Yes, that's right** when the phone guessed. Changing
/// the text turns the confirmation off.
class BirthField extends StatefulWidget {
  const BirthField({
    super.key,
    required this.today,
    required this.onChanged,
    this.initial = const BirthEntry(),
    this.allowAge = true,
    this.focusNode,
    this.onFocusLost,
    this.helper,
    this.fieldKey = const ValueKey('phi.birth'),
  });

  final DateTime today;
  final ValueChanged<BirthEntry> onChanged;
  final BirthEntry initial;

  /// The Born filter on the Patients tab takes a year or a date only.
  final bool allowAge;
  final FocusNode? focusNode;

  /// The duplicate check runs when a birth field loses focus (8.1).
  final VoidCallback? onFocusLost;
  final String? helper;

  /// PHI fields carry a `phi.` key (design 13.5).
  final Key fieldKey;

  @override
  State<BirthField> createState() => _BirthFieldState();
}

class _BirthFieldState extends State<BirthField> {
  late final _controller = TextEditingController(text: widget.initial.text);
  late final FocusNode _focus = widget.focusNode ?? FocusNode();
  late BirthEntry _entry = widget.initial;
  bool _shown = false;
  Timer? _idle;

  static const _idleDelay = Duration(milliseconds: 800);

  @override
  void initState() {
    super.initState();
    _shown = !widget.initial.isEmpty;
    _focus.addListener(_focusChanged);
  }

  @override
  void dispose() {
    _idle?.cancel();
    _focus.removeListener(_focusChanged);
    if (widget.focusNode == null) _focus.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _focusChanged() {
    if (_focus.hasFocus) return;
    _idle?.cancel();
    setState(() => _shown = true);
    widget.onFocusLost?.call();
  }

  void _set(BirthEntry next) {
    setState(() => _entry = next);
    widget.onChanged(next);
  }

  void _typed(String text) {
    _idle?.cancel();
    _shown = false;
    _set(
      BirthEntry(
        text: text,
        mode: _entry.mode,
        parsed: text.trim().isEmpty ? null : parseBirth(text, _entry.mode, widget.today),
      ),
    );
    _idle = Timer(_idleDelay, () {
      if (mounted) setState(() => _shown = true);
    });
  }

  void _mode(BirthMode mode) {
    final text = _controller.text;
    _set(BirthEntry(text: text, mode: mode, parsed: text.trim().isEmpty ? null : parseBirth(text, mode, widget.today)));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context).textTheme;
    final c = context.field;
    final age = _entry.mode == BirthMode.age;
    final parsed = _entry.parsed;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.allowAge) ...[
          SegmentedButton<BirthMode>(
            segments: const [
              ButtonSegment(value: BirthMode.date, label: Text('Date of birth')),
              ButtonSegment(value: BirthMode.age, label: Text('Age')),
            ],
            selected: {_entry.mode},
            showSelectedIcon: false,
            onSelectionChanged: (s) => _mode(s.first),
            style: SegmentedButton.styleFrom(minimumSize: const Size(FieldTap.min, FieldTap.min)),
          ),
          const SizedBox(height: FieldSpace.s2),
        ],
        TextField(
          key: widget.fieldKey,
          controller: _controller,
          focusNode: _focus,
          keyboardType: age ? TextInputType.number : TextInputType.datetime,
          autocorrect: false,
          enableSuggestions: false,
          enableIMEPersonalizedLearning: false,
          textInputAction: TextInputAction.next,
          onChanged: _typed,
          decoration: InputDecoration(
            labelText: age ? 'Age in years' : (widget.allowAge ? 'Date of birth or year' : 'Born (year or date)'),
            hintText: age ? 'Like 46' : 'Month first: 3/7/1946, or 1946',
            helperText: widget.helper,
            helperMaxLines: 3,
            errorText: _shown ? _entry.error : null,
            errorMaxLines: 3,
          ),
        ),
        if (_shown && parsed is ParsedBirth) ...[
          const SizedBox(height: FieldSpace.s2),
          Semantics(
            liveRegion: true,
            container: true,
            child: Text(parsed.readBack, style: theme.titleMedium?.copyWith(color: c.ink)),
          ),
          // A tap, not a dialog: the worker confirms while the patient is there to correct them.
          if (parsed.needsConfirmation) ...[
            const SizedBox(height: FieldSpace.s1),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Yes, that’s right'),
              subtitle: _entry.confirmed ? null : const Text('Check it with them, then turn this on.'),
              value: _entry.confirmed,
              onChanged: (on) => _set(BirthEntry(text: _entry.text, mode: _entry.mode, parsed: parsed, confirmed: on)),
            ),
          ],
        ],
      ],
    );
  }
}
