import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../forms/definition.dart';
import '../patients/patient_labels.dart' show count;
import '../patients/patient_widgets.dart' show PhiField;

/// How long typing pauses before what was typed is saved. Every save is a change to sync, with its
/// own history row, so a keystroke is not one; leaving the box, Done and leaving the screen save at
/// once. PLAN-OPEN: how long a pause in typing saves a typed answer (forms 10.1 #42): one second
/// here.
const typingPause = Duration(seconds: 1);

/// Saves what is typed into a form's boxes (lifecycle 3.2: "saves as the author types"): after
/// [typingPause] without typing, when focus leaves, on Done, and as the boxes leave the screen.
/// [save] works the answer out from the boxes and sends it when it differs from what was sent.
class TypingSaver {
  TypingSaver(this.save);
  final void Function() save;
  Timer? _pause;

  /// A keystroke: save once typing pauses.
  void typed() {
    _pause?.cancel();
    _pause = Timer(typingPause, save);
  }

  /// Save now.
  void flush() {
    _pause?.cancel();
    _pause = null;
    save();
  }

  /// Save after this frame: from `dispose` or `didUpdateWidget`, where the form may not rebuild.
  /// The answer still reaches the form, which must check that it is mounted before it rebuilds.
  void flushLater() {
    _pause?.cancel();
    _pause = null;
    scheduleMicrotask(save);
  }

  void cancel() => _pause?.cancel();
}

/// [text] cut to [max] Unicode code points: a definition's `maxLength` counts code points, as
/// Postgres does (forms 2.3), not what a person sees as one character.
String limitCodePoints(String text, int max) =>
    text.runes.length <= max ? text : String.fromCharCodes(text.runes.take(max));

/// A text answer (forms 2.2 `text`): one line or several, at most `maxLength` code points. What is
/// saved is trimmed, and a box of spaces clears the answer. It may hold patient details, so it is a
/// [PhiField]: no suggestions, no autocorrect, no learned words (forms 8.2).
class NoteTextField extends StatefulWidget {
  const NoteTextField({
    super.key,
    required this.field,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });

  final TextDef field;
  final String? value;

  /// The trimmed text, or `null` for none.
  final ValueChanged<String?> onChanged;

  /// False: shown read-only, said so to a screen reader.
  final bool enabled;

  @override
  State<NoteTextField> createState() => _NoteTextFieldState();
}

class _NoteTextFieldState extends State<NoteTextField> {
  late final TextEditingController _controller;
  final _focus = FocusNode();
  late final _saver = TypingSaver(_save);

  /// What the form has: the value it gave, or the last one sent to it.
  String? _saved;

  /// How close the text is to its limit: 0 under 90%, 1 from 90%, 2 at the limit. Crossing up into
  /// a band is said once, as phase 3's note counter is, never at each keystroke.
  late int _band;

  int get _max => widget.field.maxLength;

  @override
  void initState() {
    super.initState();
    // What the field opens with; a later value comes through didUpdateWidget.
    _controller = TextEditingController(text: widget.value ?? '');
    _saved = widget.value;
    _band = _bandOf(_controller.text);
    _focus.addListener(() {
      if (!_focus.hasFocus) _saver.flush();
    });
  }

  @override
  void didUpdateWidget(NoteTextField old) {
    super.didUpdateWidget(old);
    if (old.enabled && !widget.enabled) _saver.flushLater();
    if (widget.value != _saved) {
      // Changed elsewhere (a sync, a conflict choice): shown unless the person is typing over it.
      if (_typed() == _saved) _controller.text = widget.value ?? '';
      _saved = widget.value;
    }
  }

  @override
  void dispose() {
    if (_typed() != _saved) _saver.flushLater();
    _saver.cancel();
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  String? _typed() {
    final t = _controller.text.trim();
    return t.isEmpty ? null : t;
  }

  void _save() {
    final v = _typed();
    if (v == _saved) return;
    _saved = v;
    widget.onChanged(v);
  }

  int _bandOf(String text) {
    final n = text.runes.length;
    return n >= _max ? 2 : (n >= _max * 0.9 ? 1 : 0);
  }

  String? _bandText(int band) => switch (band) {
    1 => 'Near the ${count(_max)}-character limit.',
    2 => 'At the ${count(_max)}-character limit: it can’t be longer.',
    _ => null,
  };

  void _changed(String text) {
    final limited = limitCodePoints(text, _max);
    if (limited != text) {
      _controller.value = TextEditingValue(
        text: limited,
        selection: TextSelection.collapsed(offset: limited.length),
      );
    }
    _saver.typed();
    final band = _bandOf(limited);
    if (band != _band) {
      final up = band > _band;
      setState(() => _band = band);
      // Where the platform takes announcements (iOS), one now; elsewhere the band line is a live
      // region, and its words change only here.
      if (up && MediaQuery.supportsAnnounceOf(context)) {
        unawaited(SemanticsService.sendAnnouncement(View.of(context), _bandText(band)!, Directionality.of(context)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.field;
    final text = Theme.of(context).textTheme;
    if (!widget.enabled) return ReadOnlyAnswer(label: f.label, value: widget.value);
    final many = f.lines == 'many';
    final band = _bandText(_band);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PhiField(
          name: 'form.${f.id}',
          label: f.label,
          helper: f.help,
          controller: _controller,
          focusNode: _focus,
          maxLines: many ? 10 : 1,
          minLines: many ? 3 : null,
          // Its own counter: Material's counts what a person sees as one character.
          showCounter: false,
          capitalization: TextCapitalization.sentences,
          textInputAction: many ? TextInputAction.newline : TextInputAction.done,
          onChanged: _changed,
          onSubmitted: (_) => _saver.flush(),
        ),
        // Shown near the limit; read when explored, never live.
        if (band != null) ...[
          const SizedBox(height: FieldSpace.s1),
          ListenableBuilder(
            listenable: _controller,
            builder: (context, _) =>
                Text('${count(_controller.text.runes.length)} of ${count(_max)} characters', style: text.bodyMedium),
          ),
          // Its own node: merged with the counter, a live region would change at every keystroke.
          Semantics(
            container: true,
            liveRegion: !MediaQuery.supportsAnnounceOf(context),
            child: Text(band, style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
          ),
        ],
      ],
    );
  }
}

/// An answer that can't be changed (a finished note, a frozen store, a field a set flag clears):
/// its words at full contrast, as a disabled control's are not, and read as read-only.
class ReadOnlyAnswer extends StatelessWidget {
  const ReadOnlyAnswer({super.key, required this.label, required this.value, this.showLabel = true});

  /// Said first; shown too unless the field host shows it above ([showLabel] false).
  final String label;
  final bool showLabel;

  /// Written out; null for none.
  final String? value;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    return Semantics(
      container: true,
      readOnly: true,
      enabled: false,
      label: label,
      value: value ?? 'Blank',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.all(FieldSpace.s3),
        decoration: BoxDecoration(
          color: c.surfaceSunken,
          border: Border.all(color: c.line),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (showLabel) ...[
              Text(label, style: text.labelLarge?.copyWith(color: c.inkMuted)),
              const SizedBox(height: FieldSpace.s1),
            ],
            Text(value ?? '—', style: text.bodyLarge),
          ],
        ),
      ),
    );
  }
}
