import 'package:flutter/material.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../forms/definition.dart';
import '../../forms/layout.dart' show displayValue;
import '../../forms/paths.dart' show DurationHolds, maxDurationDays;
import '../patients/patient_widgets.dart' show PhiField;
import 'text_field.dart' show ReadOnlyAnswer, TypingSaver;

final _whole = RegExp(r'^\d{1,6}$');

/// A duration in weeks and days (forms 2.2 `duration`: gestational age), stored as whole days,
/// from 0 to the definition's most (D85), or a hundred years without one. Weeks and days are typed
/// in two boxes; what they add up to is saved as typing pauses, as a text answer is. Days past six
/// are taken and shown as weeks the next time the answer is drawn. A total over the most is not
/// saved: the line under the boxes says the most, and the answer stays what it was.
class DurationField extends StatefulWidget {
  const DurationField({
    super.key,
    required this.field,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });

  final DurationDef field;

  /// Whole days.
  final int? value;

  /// Whole days, or `null` when both boxes are empty.
  final ValueChanged<int?> onChanged;
  final bool enabled;

  @override
  State<DurationField> createState() => _DurationFieldState();
}

/// What the boxes hold: a number of days, none, or something that can't be saved.
sealed class _Typed {
  const _Typed();
}

class _Days extends _Typed {
  const _Days(this.days);
  final int? days;
}

class _Wrong extends _Typed {
  const _Wrong(this.message);
  final String message;
}

class _DurationFieldState extends State<DurationField> {
  late final _weeks = TextEditingController();
  late final _days = TextEditingController();
  final _weeksFocus = FocusNode();
  final _daysFocus = FocusNode();
  late final _saver = TypingSaver(_save);
  int? _saved;
  String? _error;

  int get _max => widget.field.max ?? maxDurationDays;

  @override
  void initState() {
    super.initState();
    _saved = widget.value;
    _show(widget.value);
    for (final node in [_weeksFocus, _daysFocus]) {
      node.addListener(() {
        // Moving from one box to the other is still typing the same answer.
        if (!_weeksFocus.hasFocus && !_daysFocus.hasFocus) _saver.flush();
      });
    }
  }

  void _show(int? days) {
    _weeks.text = days == null ? '' : '${days ~/ 7}';
    _days.text = days == null ? '' : '${days % 7}';
  }

  @override
  void didUpdateWidget(DurationField old) {
    super.didUpdateWidget(old);
    if (old.enabled && !widget.enabled) _saver.flushLater();
    if (widget.value != _saved) {
      final typed = _typed();
      // Changed elsewhere: shown unless the person is typing over it.
      if (typed is _Days && typed.days == _saved) _show(widget.value);
      _saved = widget.value;
    }
  }

  @override
  void dispose() {
    final typed = _typed();
    if (typed is _Days && typed.days != _saved) _saver.flushLater();
    _saver.cancel();
    _weeks.dispose();
    _days.dispose();
    _weeksFocus.dispose();
    _daysFocus.dispose();
    super.dispose();
  }

  String get _most => displayValue(DurationHolds(_max), _max, widget.field);

  _Typed _typed() {
    final w = _weeks.text.trim();
    final d = _days.text.trim();
    if (w.isEmpty && d.isEmpty) return const _Days(null);
    if ((w.isNotEmpty && !_whole.hasMatch(w)) || (d.isNotEmpty && !_whole.hasMatch(d))) {
      return const _Wrong('Type whole weeks and days.');
    }
    final total = (w.isEmpty ? 0 : int.parse(w)) * 7 + (d.isEmpty ? 0 : int.parse(d));
    return total > _max ? _Wrong('It can be at most $_most.') : _Days(total);
  }

  void _save() {
    final typed = _typed();
    if (typed is! _Days || typed.days == _saved) return;
    _saved = typed.days;
    widget.onChanged(typed.days);
  }

  void _changed(String _) {
    final typed = _typed();
    final error = typed is _Wrong ? typed.message : null;
    if (error != _error) setState(() => _error = error);
    _saver.typed();
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.field;
    if (!widget.enabled) {
      final v = widget.value;
      return ReadOnlyAnswer(
        label: f.label,
        value: v == null ? null : displayValue(DurationHolds(_max), v, f),
        showLabel: false,
      );
    }
    Widget box(String name, String label, TextEditingController controller, FocusNode focus, TextInputAction action) =>
        SizedBox(
          width: 160,
          child: PhiField(
            name: 'form.${f.id}.$name',
            label: label,
            controller: controller,
            focusNode: focus,
            keyboardType: TextInputType.number,
            textInputAction: action,
            capitalization: TextCapitalization.none,
            onChanged: _changed,
            onSubmitted: (_) {
              if (action == TextInputAction.done) _saver.flush();
            },
          ),
        );
    return Semantics(
      container: true,
      label: f.label,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: FieldSpace.s3,
            runSpacing: FieldSpace.s2,
            children: [
              box('weeks', 'Weeks', _weeks, _weeksFocus, TextInputAction.next),
              box('days', 'Days', _days, _daysFocus, TextInputAction.done),
            ],
          ),
          if (_error != null) ...[
            const SizedBox(height: FieldSpace.s1),
            // Said when it appears; its words don't change at each keystroke.
            Semantics(
              container: true,
              liveRegion: true,
              child: Text(
                _error!,
                style: Theme.of(context).textTheme.bodyMedium
                    ?.copyWith(color: context.field.critical, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
