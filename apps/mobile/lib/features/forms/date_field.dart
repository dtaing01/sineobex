import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../forms/definition.dart';
import '../../patients/dob.dart' show daysInMonth, monthNames;
import '../patients/patient_labels.dart' show isoDay, longDate;
import '../patients/patient_widgets.dart' show PhiField;
import '../patients/sheet_gate.dart' show DialogGate;
import 'text_field.dart' show ReadOnlyAnswer, TypingSaver;

/// How far back and ahead a date may be picked or typed when its range allows. PLAN-OPEN: how far a
/// note's date picker reaches (forms 10.1 #43): a hundred years back, ten ahead here; the definition
/// bounds only the side of today (forms 2.2).
const datePickerYearsBack = 100;
const datePickerYearsAhead = 10;

/// `YYYY-MM-DD` of [day].
String isoDate(DateTime day) =>
    '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';

/// The first and last day a date of [field] may be on [today]: today on the side its range closes,
/// the picker's reach on a side it leaves open.
({DateTime first, DateTime last}) dateBounds(DateDef field, DateTime today) {
  final day = DateTime(today.year, today.month, today.day);
  return (
    first: field.range == 'future' ? day : DateTime(day.year - datePickerYearsBack, day.month, day.day),
    last: field.range == 'past' ? day : DateTime(day.year + datePickerYearsAhead, day.month, day.day),
  );
}

/// What the three boxes of a typed date hold.
sealed class TypedDate {
  const TypedDate();
}

/// A date to store, `YYYY-MM-DD`, or null when all three boxes are empty.
final class DateTyped extends TypedDate {
  const DateTyped(this.iso);
  final String? iso;
}

/// Some boxes typed in, some empty: said only once the boxes are left.
final class DateHalfTyped extends TypedDate {
  const DateHalfTyped();
}

/// Not a date, or out of the field's range: [message] says why, and never repeats the date.
final class DateRefused extends TypedDate {
  const DateRefused(this.message);
  final String message;
}

const _halfTyped = 'Type the month, day and year, or clear all three.';

/// Reads a typed date: month first, as phase 3's birth date is read (dob.dart); the year in four
/// digits; held to [field]'s range on [today] and to the picker's reach.
///
/// PLAN-OPEN: how a date is typed (forms 10.1 #54). Three boxes, month first as the US pilot writes
/// a date (phase 3 design 14.1 #20), and a four-digit year: a two-digit one could be either side of
/// today on a field whose range is `any`. The calendar is the second way in.
TypedDate readTypedDate(String month, String day, String year, DateDef field, DateTime today) {
  final parts = [month.trim(), day.trim(), year.trim()];
  if (parts.every((p) => p.isEmpty)) return const DateTyped(null);
  if (parts.any((p) => p.isEmpty)) return const DateHalfTyped();
  if (!parts.every(RegExp(r'^\d+$').hasMatch)) {
    return const DateRefused('Type the month, day and year in numbers, like 3, 7 and 2026.');
  }
  final [m, d, y] = [for (final p in parts) int.parse(p)];
  if (m < 1 || m > 12) return const DateRefused('Type the month as a number from 1 to 12.');
  if (parts[2].length != 4) return const DateRefused('Type the year with 4 digits, like 2026.');
  if (d < 1) return const DateRefused('There is no day 0.');
  if (d > daysInMonth(y, m)) {
    // As phase 3's birth date says it (dob.dart's _daysMessage, which is private to it).
    if (m == 2 && d == 29) return DateRefused('$y isn’t a leap year, so February has 28 days.');
    if (m == 2) return const DateRefused('February has 28 or 29 days.');
    return DateRefused('${monthNames[m - 1]} has ${daysInMonth(y, m)} days.');
  }
  final date = DateTime(y, m, d);
  final todayDay = DateTime(today.year, today.month, today.day);
  if (field.range == 'past' && date.isAfter(todayDay)) return const DateRefused('The date can’t be after today.');
  if (field.range == 'future' && date.isBefore(todayDay)) return const DateRefused('The date can’t be before today.');
  final (:first, :last) = dateBounds(field, today);
  if (date.isBefore(first) || date.isAfter(last)) {
    return DateRefused('The date must be from ${longDate(first)} to ${longDate(last)}.');
  }
  return DateTyped(isoDate(date));
}

/// A date answer (forms 2.2 `date`), stored as `YYYY-MM-DD`. Its range bounds what is typed or
/// picked: `past` is today or earlier, `future` today or later, both including today. `checkAnswer`
/// has no clock, so a stored date outside the range now (a follow-up date that has passed) is still
/// shown as it is.
///
/// Typed in three boxes, month, day and year, saved as typing pauses or the boxes are left, as a
/// number is; a date that can't be saved leaves the answer as it was, and one line under the boxes
/// says why, once. The boxes are [PhiField]s, as a date is a patient detail. The calendar is a
/// second way in: its seven day columns can't be 48 px wide on a 320-wide phone, so the boxes are
/// the way that meets every rule (accessibility.md). The calendar has no typing mode: Material's
/// is a text box that the keyboard would learn from.
class DateField extends StatefulWidget {
  const DateField({
    super.key,
    required this.field,
    required this.value,
    required this.onChanged,
    this.enabled = true,
    this.today,
  });

  final DateDef field;
  final String? value;

  /// `YYYY-MM-DD`, or `null` to clear it.
  final ValueChanged<String?> onChanged;
  final bool enabled;

  /// The phone's day; null reads the clock.
  final DateTime? today;

  @override
  State<DateField> createState() => _DateFieldState();
}

class _DateFieldState extends State<DateField> {
  final _month = TextEditingController();
  final _day = TextEditingController();
  final _year = TextEditingController();
  late final _saver = TypingSaver(() => _save(left: false));

  /// What is stored, as this field last knew it.
  String? _saved;

  /// Why what is typed can't be saved, said once under the boxes.
  String? _line;

  /// A typed date was just saved: the line under the boxes reads it back, month spelled out.
  bool _readBack = false;

  DateTime get _today => widget.today ?? DateTime.now();

  @override
  void initState() {
    super.initState();
    _saved = widget.value;
    _show(widget.value);
  }

  @override
  void didUpdateWidget(DateField old) {
    super.didUpdateWidget(old);
    if (old.enabled && !widget.enabled) _saver.flushLater();
    if (widget.value != _saved) {
      // Changed elsewhere (a sync, a conflict choice): shown unless the person is typing over it.
      if (_showsSaved) {
        _show(widget.value);
        _line = null;
        _readBack = false;
      }
      _saved = widget.value;
    }
  }

  @override
  void dispose() {
    _saver.cancel();
    final typed = _read();
    if (!_showsSaved && typed is DateTyped && typed.iso != _saved) {
      // Leaving the screen saves what was typed, as a number's box does; after this frame, where
      // the form may not rebuild.
      final onChanged = widget.onChanged;
      _saved = typed.iso;
      scheduleMicrotask(() => onChanged(typed.iso));
    }
    _month.dispose();
    _day.dispose();
    _year.dispose();
    super.dispose();
  }

  void _show(String? iso) {
    final day = isoDay(iso);
    _month.text = day == null ? '' : '${day.month}';
    _day.text = day == null ? '' : '${day.day}';
    _year.text = day == null ? '' : '${day.year}';
  }

  /// The boxes hold what is stored, untouched: a stored date out of the range now is left alone.
  bool get _showsSaved {
    final day = isoDay(_saved);
    return day == null
        ? _month.text.isEmpty && _day.text.isEmpty && _year.text.isEmpty
        : _month.text == '${day.month}' && _day.text == '${day.day}' && _year.text == '${day.year}';
  }

  TypedDate _read() => readTypedDate(_month.text, _day.text, _year.text, widget.field, _today);

  /// Saves what was typed, or says why it can't be saved: when typing pauses or the boxes are
  /// [left], never at a keystroke. A date half typed is said only once the boxes are left, so moving
  /// from the month to the day says nothing.
  void _save({required bool left}) {
    if (!mounted) {
      final typed = _read();
      if (typed is DateTyped && typed.iso != _saved) widget.onChanged(typed.iso);
      return;
    }
    if (_showsSaved) {
      setState(() => _line = null);
      return;
    }
    final typed = _read();
    switch (typed) {
      case DateHalfTyped():
        if (left) setState(() => _line = _halfTyped);
      case DateRefused(:final message):
        setState(() => _line = message);
      case DateTyped(:final iso) when iso == _saved:
        // The same day typed another way (03 for 3): nothing new to store.
        setState(() => _line = null);
      case DateTyped(:final iso):
        setState(() {
          _line = null;
          _readBack = iso != null;
        });
        _saved = iso;
        widget.onChanged(iso);
    }
  }

  void _changed(String _) {
    // A line already said goes as soon as the boxes hold something new; a new one waits for the
    // pause.
    setState(() {
      _readBack = false;
      if (_read() is! DateRefused) _line = null;
    });
    _saver.typed();
  }

  void _left(bool hasFocus) {
    if (hasFocus) return;
    _saver.cancel();
    _save(left: true);
  }

  void _set(String? iso) {
    _saver.cancel();
    setState(() {
      _show(iso);
      _line = null;
      _readBack = false;
    });
    _saved = iso;
    widget.onChanged(iso);
  }

  Future<void> _pick(BuildContext context) async {
    final (:first, :last) = dateBounds(widget.field, _today);
    var initial = isoDay(widget.value) ?? DateTime(_today.year, _today.month, _today.day);
    if (initial.isBefore(first)) initial = first;
    if (initial.isAfter(last)) initial = last;
    // Headed with the field's label and open on the patient's date: it closes with the screen's gate
    // when the store freezes (D125; review finding PP-1).
    final gate = DialogGate.over<DateTime>(context);
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: last,
      currentDate: DateTime(_today.year, _today.month, _today.day),
      helpText: widget.field.label,
      initialEntryMode: DatePickerEntryMode.calendarOnly,
      builder: (_, child) => gate(child!),
    );
    if (picked != null && mounted) _set(isoDate(picked));
  }

  Widget _box(String part, String label, TextEditingController controller, int digits, {bool last = false}) => PhiField(
    name: 'form.${widget.field.id}.$part',
    label: label,
    controller: controller,
    keyboardType: TextInputType.number,
    capitalization: TextCapitalization.none,
    textInputAction: last ? TextInputAction.done : TextInputAction.next,
    maxLength: digits,
    // A count under a box of two digits says nothing worth hearing at each keystroke.
    showCounter: false,
    onChanged: _changed,
    onSubmitted: last ? (_) => _left(false) : null,
  );

  @override
  Widget build(BuildContext context) {
    final field = widget.field;
    final value = widget.value;
    final day = isoDay(value);
    final shown = value == null ? null : (day == null ? value : longDate(day));
    if (!widget.enabled) return ReadOnlyAnswer(label: field.label, value: shown, showLabel: false);
    final text = Theme.of(context).textTheme;
    final c = context.field;
    void pick() => unawaited(_pick(context));
    final month = _box('month', 'Month', _month, 2);
    final dayBox = _box('day', 'Day', _day, 2);
    final year = _box('year', 'Year', _year, 4, last: true);
    const gap = SizedBox(width: FieldSpace.s2, height: FieldSpace.s2);
    final saved = isoDay(_saved);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Named by the field's label, which the field host leaves to the control; each box says its
        // part.
        Semantics(
          container: true,
          explicitChildNodes: true,
          label: field.label,
          child: Focus(
            canRequestFocus: false,
            skipTraversal: true,
            onFocusChange: _left,
            child: LayoutBuilder(
              builder: (context, constraints) {
                // Side by side while each box still fits its label; one under another otherwise
                // (200% text), so nothing is cut off.
                final scale = MediaQuery.textScalerOf(context).scale(16) / 16;
                if (constraints.maxWidth < 264 * scale) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [month, gap, dayBox, gap, year],
                  );
                }
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(flex: 2, child: month),
                    gap,
                    Expanded(flex: 2, child: dayBox),
                    gap,
                    Expanded(flex: 3, child: year),
                  ],
                );
              },
            ),
          ),
        ),
        if (_line != null) ...[
          const SizedBox(height: FieldSpace.s1),
          // Said when it appears; its words don't change at each keystroke.
          Semantics(
            container: true,
            liveRegion: true,
            child: Text(
              _line!,
              style: text.bodyMedium?.copyWith(color: c.critical, fontWeight: FontWeight.w700),
            ),
          ),
        ] else if (_readBack && saved != null) ...[
          const SizedBox(height: FieldSpace.s1),
          // Read back once, month spelled out, as phase 3's birth date is: 3 7 2026 is March 7.
          Semantics(
            container: true,
            liveRegion: true,
            child: Text('Saved as ${longDate(saved)}.', style: text.bodyMedium?.copyWith(color: c.ink)),
          ),
        ],
        const SizedBox(height: FieldSpace.s2),
        Wrap(
          spacing: FieldSpace.s2,
          runSpacing: FieldSpace.s2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Semantics(
              container: true,
              button: true,
              label: '${field.label}: ${shown ?? 'no date'}',
              hint: shown == null ? 'Choose on the calendar' : 'Change on the calendar',
              onTap: pick,
              excludeSemantics: true,
              child: OutlinedButton.icon(
                onPressed: pick,
                icon: const Icon(LucideIcons.calendar),
                label: Text(shown ?? 'Choose on the calendar'),
              ),
            ),
            if (value != null)
              Semantics(
                container: true,
                button: true,
                label: 'Clear ${field.label}',
                onTap: () => _set(null),
                excludeSemantics: true,
                child: TextButton(onPressed: () => _set(null), child: const Text('Clear')),
              ),
          ],
        ),
      ],
    );
  }
}
