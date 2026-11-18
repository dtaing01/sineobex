import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../forms/definition.dart';
import '../../forms/layout.dart' show displayValue;
import '../../forms/paths.dart' show NumberHolds;
import '../patients/patient_widgets.dart' show PhiField;
import 'text_field.dart' show ReadOnlyAnswer, TypingSaver;

final _number = RegExp(r'^-?(\d+(\.\d*)?|\.\d+)$');

/// [n] written plainly: no trailing zeros, no trailing point, no sign on zero.
String plainNumber(num n) {
  if (n == n.truncate()) return '${n.toInt()}';
  return n.toString().replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
}

/// [n] at [decimals] places, as it is stored: a whole number as an `int`, so JSON writes `99`,
/// never `99.0`.
num roundTo(num n, int decimals) {
  final v = double.parse(n.toStringAsFixed(decimals));
  return v == v.truncate() ? v.toInt() : v;
}

/// A number (forms 2.2 `number`): typed in a box with the numeric keyboard, its unit after it, or
/// "out of N" for a score; saved as typing pauses, as a text answer is. A value outside the field's
/// range is not saved: the line under the box says the range, and the answer stays what it was
/// (8.2). With a second unit (`altUnit`, inches beside cm) a two-way switch picks the unit typed in,
/// and the answer is stored in the base unit at the field's decimals. With `display: stepper`, one
/// fewer and one more sit beside the box.
class NumberField extends StatefulWidget {
  const NumberField({
    super.key,
    required this.field,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });

  final NumberDef field;

  /// In the base unit.
  final num? value;

  /// In the base unit at the field's decimals, or `null` when the box is empty.
  final ValueChanged<num?> onChanged;

  /// False: shown read-only, said so to a screen reader.
  final bool enabled;

  @override
  State<NumberField> createState() => _NumberFieldState();
}

/// What the box holds: a value in the base unit, none, or something that can't be saved.
sealed class _Typed {
  const _Typed();
}

class _Value extends _Typed {
  const _Value(this.value);
  final num? value;
}

class _Wrong extends _Typed {
  const _Wrong(this.message);
  final String message;
}

class _NumberFieldState extends State<NumberField> {
  late final _controller = TextEditingController();
  final _focus = FocusNode();
  late final _saver = TypingSaver(_save);
  num? _saved;
  String? _error;

  /// Typing in the second unit. PLAN-OPEN: which unit a field with a second one opens in (forms 10.1
  /// #44): the base unit here, each time.
  bool _alt = false;

  NumberDef get _f => widget.field;

  @override
  void initState() {
    super.initState();
    _saved = widget.value;
    _show(widget.value);
    _focus.addListener(() {
      if (!_focus.hasFocus) _saver.flush();
    });
  }

  @override
  void didUpdateWidget(NumberField old) {
    super.didUpdateWidget(old);
    if (old.enabled && !widget.enabled) _saver.flushLater();
    if (widget.value != _saved) {
      final typed = _typed();
      // Changed elsewhere (a sync, a conflict choice): shown unless the person is typing over it.
      if (typed is _Value && typed.value == _saved) _show(widget.value);
      _saved = widget.value;
    }
  }

  @override
  void dispose() {
    final typed = _typed();
    if (typed is _Value && typed.value != _saved) _saver.flushLater();
    _saver.cancel();
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  /// The second unit's number for [base]: one place more than the field keeps, as a conversion
  /// rarely comes out round.
  num _toShown(num base) => _alt ? roundTo(base / _f.altUnit!.perUnit, _f.decimals + 1) : base;

  void _show(num? base) => _controller.text = base == null ? '' : plainNumber(_toShown(base));

  String get _range {
    final unit = _f.unit == null || _f.display == 'outOf' ? '' : ' ${_f.unit}';
    return 'It must be from ${plainNumber(_f.min)} to ${plainNumber(_f.max)}$unit.';
  }

  _Typed _typed() {
    final text = _controller.text.trim().replaceAll(',', '.');
    if (text.isEmpty) return const _Value(null);
    if (!_number.hasMatch(text)) return const _Wrong('Type a number.');
    // Counted on the value, not the typing: 2.50 is 2.5, which a field of one decimal keeps (7.1).
    final places = text.contains('.')
        ? text.substring(text.indexOf('.') + 1).replaceFirst(RegExp(r'0+$'), '').length
        : 0;
    final num base;
    if (_alt) {
      // Rounded to the field's decimals in the base unit: what is stored is what checkAnswer takes.
      base = roundTo(double.parse(text) * _f.altUnit!.perUnit, _f.decimals);
    } else {
      if (places > _f.decimals) {
        return _Wrong(switch (_f.decimals) {
          0 => 'Type a whole number.',
          1 => 'Type at most 1 decimal place.',
          final n => 'Type at most $n decimal places.',
        });
      }
      base = roundTo(double.parse(text), _f.decimals);
    }
    return base < _f.min || base > _f.max ? _Wrong(_range) : _Value(base);
  }

  /// Saves what was typed, or says why it can't be saved: when typing pauses or the box is left,
  /// never at a keystroke, so typing 98.6 doesn't say the range at its 9.
  void _save() {
    final typed = _typed();
    // From dispose: the answer still goes, and there is nothing left to say it on.
    if (mounted) setState(() => _error = typed is _Wrong ? typed.message : null);
    if (typed is! _Value || typed.value == _saved) return;
    _saved = typed.value;
    widget.onChanged(typed.value);
  }

  void _changed(String _) {
    final typed = _typed();
    // Rebuilt at each keystroke for the second unit's "Saved as" line. A line already said goes as
    // soon as what is typed can be saved; a new one waits for the pause.
    setState(() {
      if (typed is! _Wrong) _error = null;
    });
    _saver.typed();
  }

  void _switchUnit(bool alt) {
    if (alt == _alt) return;
    final typed = _typed();
    setState(() {
      _alt = alt;
      // The same answer in the other unit; what can't be read is left as typed.
      if (typed is _Value) _show(typed.value);
    });
  }

  /// One more or one fewer of the box's number, kept inside the range. An empty box starts at the
  /// least. PLAN-OPEN: when a stepper's count is saved (forms 10.1 #45): when tapping pauses, as
  /// typing does, not at each tap, so going from 1 to 4 is one change to sync, not three.
  void _step(int by) {
    final typed = _typed();
    final now = typed is _Value ? typed.value : null;
    final next = now == null ? _f.min : (now + by).clamp(_f.min, _f.max);
    _show(roundTo(next, _f.decimals));
    _changed(_controller.text);
  }

  @override
  Widget build(BuildContext context) {
    final f = _f;
    final text = Theme.of(context).textTheme;
    if (!widget.enabled) {
      final v = widget.value;
      return ReadOnlyAnswer(
        label: f.label,
        value: v == null
            ? null
            : displayValue(NumberHolds(min: f.min, max: f.max, decimals: f.decimals, unit: f.unit), v, f),
      );
    }
    final alt = f.altUnit;
    final after = f.display == 'outOf' ? 'out of ${plainNumber(f.max)}' : (_alt ? alt!.unit : f.unit);
    final typed = _typed();
    final input = PhiField(
      name: 'form.${f.id}',
      label: f.label,
      helper: f.help,
      controller: _controller,
      focusNode: _focus,
      keyboardType: TextInputType.numberWithOptions(decimal: f.decimals > 0 || alt != null, signed: f.min < 0),
      textInputAction: TextInputAction.done,
      capitalization: TextCapitalization.none,
      suffix: after == null
          ? null
          : Padding(
              padding: const EdgeInsetsDirectional.only(end: FieldSpace.s3),
              child: Text(after, style: text.bodyLarge?.copyWith(color: context.field.inkMuted)),
            ),
      onChanged: _changed,
      onSubmitted: (_) => _saver.flush(),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (f.display == 'stepper')
          Row(
            children: [
              _StepButton(
                label: 'One fewer',
                icon: LucideIcons.minus,
                value: _controller.text,
                onTap: _canStep(-1, typed),
              ),
              const SizedBox(width: FieldSpace.s2),
              Expanded(child: input),
              const SizedBox(width: FieldSpace.s2),
              _StepButton(
                label: 'One more',
                icon: LucideIcons.plus,
                value: _controller.text,
                onTap: _canStep(1, typed),
              ),
            ],
          )
        else
          input,
        if (alt != null) ...[
          const SizedBox(height: FieldSpace.s2),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: SegmentedButton<bool>(
              segments: [
                ButtonSegment(value: false, label: Text(f.unit ?? '')),
                ButtonSegment(value: true, label: Text(alt.unit)),
              ],
              selected: {_alt},
              showSelectedIcon: false,
              onSelectionChanged: (picked) => _switchUnit(picked.single),
              style: SegmentedButton.styleFrom(minimumSize: const Size(FieldTap.min, FieldTap.min)),
            ),
          ),
          if (_alt && typed is _Value && typed.value != null) ...[
            const SizedBox(height: FieldSpace.s1),
            // Read when explored, never live: it changes at each keystroke.
            Text('Saved as ${plainNumber(typed.value!)} ${f.unit}.', style: text.bodyMedium),
          ],
        ],
        if (_error != null) ...[
          const SizedBox(height: FieldSpace.s1),
          // Said when it appears; its words don't change at each keystroke.
          Semantics(
            container: true,
            liveRegion: true,
            child: Text(
              _error!,
              style: text.bodyMedium?.copyWith(color: context.field.critical, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ],
    );
  }

  /// The step, or null where it would leave the range or there is nothing to step down from.
  VoidCallback? _canStep(int by, _Typed typed) {
    final now = typed is _Value ? typed.value : null;
    if (by < 0 && (now == null || now <= _f.min)) return null;
    if (by > 0 && now != null && now >= _f.max) return null;
    return () => _step(by);
  }
}

/// One fewer or one more: a button of the minimum target size that says the box's number with it.
class _StepButton extends StatelessWidget {
  const _StepButton({required this.label, required this.icon, required this.value, required this.onTap});
  final String label;
  final IconData icon;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    button: true,
    enabled: onTap != null,
    label: label,
    value: value,
    onTap: onTap,
    excludeSemantics: true,
    child: IconButton.outlined(
      onPressed: onTap,
      icon: Icon(icon),
      constraints: const BoxConstraints(minWidth: FieldTap.min, minHeight: FieldTap.min),
    ),
  );
}
