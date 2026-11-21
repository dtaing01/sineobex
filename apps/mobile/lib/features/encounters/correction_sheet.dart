import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../encounters/encounter_models.dart';
import '../../encounters/encounter_repository.dart' hide Expanded;
import '../../encounters/encounter_services.dart';
import '../../forms/field_at.dart' show Points, fieldAt;
import '../../forms/layout.dart' show sideLabels;
import '../../forms/read_model.dart' show ReadEntry, ReadItem, ReadModel, ReadSection;
import '../../sync/canonical_json.dart';
import '../../sync/entities.dart' show maxCorrectionChanges;
import '../../sync/local_store.dart' show LocalValidationError;
import '../forms/field_host.dart';
import '../forms/text_field.dart' show limitCodePoints;
import '../patients/patient_labels.dart' show count;
import '../patients/patient_widgets.dart' show PhiField, WideButton, focusFollows, focusInView, showDone;
import 'encounter_labels.dart';
import 'encounter_widgets.dart' show SheetGate;

/// **Correct** (lifecycle 3.6, 9.7): "the author picks the wrong field, enters the right value and
/// gives a reason" (PRD main 460). For each answer: its labels and its value now, then the field's own
/// input for the new value, starting from what the note says; **Correct another answer** adds one of
/// the note's other answers, up to ten changed together, since one answer can open another; a reason
/// of 3 to 500 characters; and the switch "The patient asked for this change", which turns the button
/// into the second choice, **Make the change** or **Record that it was declined** (a patient's
/// amendment request, PRD main 463).
///
/// [note] is the phone's copy of a finished note, with its answers ([NoteView.answers]) and its
/// definition; [path] is the answer tapped, as the read view gives it. `correct` holds every rule
/// (who may correct, an answer they may not change, an answer `checkAnswer` refuses, no change, a
/// note left missing what it needs, the reason's length, the version each answer was read at) and
/// words every refusal; the sheet shows them. When the change would leave the note missing an answer,
/// the answers it names are added below, to be filled with it. Returns the correction's ID, or null
/// when the sheet was closed without one.
Future<String?> showCorrectionSheet(
  BuildContext context,
  EncounterServices services, {
  required NoteView note,
  required String path,
}) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (context) => SheetGate(
    services: services,
    child: _Correction(services: services, note: note, path: path),
  ),
);

class _Correction extends StatefulWidget {
  const _Correction({required this.services, required this.note, required this.path});
  final EncounterServices services;
  final NoteView note;
  final String path;

  @override
  State<_Correction> createState() => _CorrectionState();
}

class _CorrectionState extends State<_Correction> {
  /// The answers in the sheet, by path, in the order added.
  late final List<String> _paths = [widget.path];

  /// Those the domain layer named as needed with the change (`incomplete`).
  final _needed = <String>{};

  /// What the inputs hold, starting from the note's answers.
  late final Map<String, Object?> _values = Map.of(widget.note.answers);

  /// The answers each input wrote, by the answer it was opened for: a region or a diagnosis writes
  /// its parts, a choice its Other text.
  final _touched = <String, Set<String>>{};

  final _reason = TextEditingController();
  bool _patientAsked = false;
  bool _choosing = false;
  String? _problem;
  bool _busy = false;

  NoteView get _note => widget.note;

  late final List<ReadItem> _items = readItems(_note.read);

  @override
  void dispose() {
    _reason.dispose();
    _anotherFocus.dispose();
    for (final f in _removeFocus.values) {
      f.dispose();
    }
    super.dispose();
  }

  /// Where focus goes when an answer's Remove takes it away: Correct another answer, which is there
  /// once fewer answers are named (review finding PX-5).
  final _anotherFocus = FocusNode(debugLabel: 'correct another answer');
  final _removeFocus = <String, FocusNode>{};

  ReadItem? _item(String path) => _items.where((i) => i.path == path).firstOrNull;

  /// An answer's labels: the read view's, else its field's own, with its side.
  String _labels(String path) {
    if (_item(path) case final item?) return item.labels.join(', ');
    final target = _note.definition == null ? null : fieldAt(_note.definition!, path);
    final label = target?.field?.label;
    if (label == null) return path;
    return [label, ?sideLabels[target!.side]].join(', ');
  }

  /// The changes made: each answer an input wrote whose value is not what the note says.
  Map<String, Object?> _changes() {
    final written = {for (final p in _paths) ...?_touched[p]};
    return {
      for (final p in written)
        if (canonicalJson(_values[p]) != canonicalJson(_note.answers[p])) p: _values[p],
    };
  }

  void _remove(String path) {
    final follow = focusFollows(context, _removeFocus[path] ??= FocusNode());
    setState(() {
      _paths.remove(path);
      _needed.remove(path);
      for (final p in _touched.remove(path) ?? const <String>{}) {
        _values[p] = _note.answers[p];
      }
    });
    _removeFocus.remove(path)?.dispose();
    if (follow) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) focusInView(_anotherFocus);
      });
    }
  }

  void _add(String path) => setState(() {
    if (!_paths.contains(path)) _paths.add(path);
    _choosing = false;
  });

  /// Cut at the limit as the form's text boxes cut theirs: in code points, as the server counts.
  void _typed(String typed) {
    final limited = limitCodePoints(typed, correctionReasonMax);
    if (limited != typed) {
      _reason.value = TextEditingValue(
        text: limited,
        selection: TextSelection.collapsed(offset: limited.length),
      );
    }
    setState(() {});
  }

  /// [declined] records a patient's request as declined, the note unchanged (3.6).
  Future<void> _save({required bool declined}) async {
    // What a box being typed in holds reaches the sheet as it loses focus.
    FocusManager.instance.primaryFocus?.unfocus();
    await Future<void>.delayed(Duration.zero);
    if (!mounted) return;
    final changes = _changes();
    if (changes.isEmpty) return setState(() => _problem = changeAnAnswerFirst);
    if (changes.length > maxCorrectionChanges) return setState(() => _problem = tooManyChanges(maxCorrectionChanges));
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      final id = await widget.services.repository.correct(
        _note.encounterId,
        _note.noteId,
        changes: changes,
        reason: _reason.text,
        requestedByPatient: _patientAsked,
        declined: declined,
      );
      if (!mounted) return;
      showDone(context, declined ? declinedRecorded : correctionSaved);
      Navigator.of(context).pop(id);
    } on LocalValidationError catch (e) {
      if (!mounted) return;
      setState(() {
        _problem = e.message;
        // The answers the change makes required: asked for here, to go with it.
        if (e.problem == 'incomplete') {
          for (final p in e.paths) {
            if (!_paths.contains(p)) {
              _paths.add(p);
              _needed.add(p);
            }
          }
        }
      });
    } on Exception catch (e) {
      if (mounted) setState(() => _problem = encounterErrorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final others = [
      for (final i in _items)
        if (!_paths.contains(i.path)) i,
    ];
    final firstNeeded = _paths.where(_needed.contains).firstOrNull;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
          children: [
            Semantics(header: true, child: Text(correctionTitle, style: text.titleLarge)),
            const SizedBox(height: FieldSpace.s1),
            Text(_note.title ?? untitledNote, style: text.bodyLarge),
            for (final p in _paths) ...[
              if (p == firstNeeded) ...[
                const SizedBox(height: FieldSpace.s4),
                Semantics(header: true, child: Text(neededTooHeading, style: text.titleMedium)),
              ],
              const SizedBox(height: FieldSpace.s3),
              _answer(context, p),
            ],
            if (_paths.length < maxCorrectionChanges && others.isNotEmpty) ...[
              const SizedBox(height: FieldSpace.s3),
              if (!_choosing)
                WideButton(
                  label: correctAnotherAction,
                  icon: LucideIcons.plus,
                  focusNode: _anotherFocus,
                  onPressed: () => setState(() => _choosing = true),
                )
              else ...[
                Semantics(header: true, child: Text(whichAnswerHeading, style: text.titleMedium)),
                for (final i in others) ...[
                  const SizedBox(height: FieldSpace.s2),
                  WideButton(label: i.labels.join(', '), onPressed: () => _add(i.path)),
                ],
              ],
            ],
            const SizedBox(height: FieldSpace.s4),
            PhiField(
              name: 'correctionReason',
              label: correctionReasonLabel,
              controller: _reason,
              maxLines: 5,
              minLines: 2,
              showCounter: false,
              capitalization: TextCapitalization.sentences,
              textInputAction: TextInputAction.newline,
              onChanged: _typed,
            ),
            const SizedBox(height: FieldSpace.s1),
            Text(charactersText(count(_reason.text.runes.length), count(correctionReasonMax)), style: text.bodyMedium),
            const SizedBox(height: FieldSpace.s2),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text(patientAskedLabel),
              value: _patientAsked,
              onChanged: (v) => setState(() => _patientAsked = v),
            ),
            if (_problem != null) ...[const SizedBox(height: FieldSpace.s2), ErrorMessage(_problem!)],
            const SizedBox(height: FieldSpace.s3),
            if (!_patientAsked)
              WideButton(
                label: saveCorrectionAction,
                filled: true,
                onPressed: _busy ? null : () => _save(declined: false),
              )
            else ...[
              WideButton(label: makeChangeAction, filled: true, onPressed: _busy ? null : () => _save(declined: false)),
              const SizedBox(height: FieldSpace.s2),
              WideButton(label: recordDeclinedAction, onPressed: _busy ? null : () => _save(declined: true)),
            ],
          ],
        ),
      ),
    );
  }

  /// One answer: its labels and its value now, the field's own input, and Remove for all but one.
  Widget _answer(BuildContext context, String path) {
    final text = Theme.of(context).textTheme;
    final c = context.field;
    final labels = _labels(path);
    return Container(
      padding: const EdgeInsets.all(FieldSpace.s3),
      decoration: BoxDecoration(
        border: Border.all(color: c.line),
        borderRadius: BorderRadius.circular(FieldRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The heading, the value now and the input, each a node of its own: one node would be both a
          // heading and the text box, its label said twice (review SAX-5).
          Semantics(container: true, header: true, child: Text(labels, style: text.titleMedium)),
          const SizedBox(height: FieldSpace.s1),
          Semantics(container: true, child: Text(nowText(_item(path)?.value), style: text.bodyLarge)),
          const SizedBox(height: FieldSpace.s3),
          Semantics(container: true, child: _input(path)),
          if (_paths.length > 1) ...[
            const SizedBox(height: FieldSpace.s2),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Semantics(
                container: true,
                button: true,
                label: removeAnswerSpoken(labels),
                excludeSemantics: true,
                onTap: () => _remove(path),
                child: TextButton.icon(
                  focusNode: _removeFocus[path] ??= FocusNode(debugLabel: 'remove $path'),
                  onPressed: () => _remove(path),
                  icon: const Icon(LucideIcons.x),
                  label: const Text(removeAnswerAction),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// The field's own input (forms 8.1, 8.2), the renderer's widget for its kind, writing into the
  /// sheet: an answer of a grid's cell drawn bare, as the grid draws it; any other at the field's own
  /// path, both sides for a field with sides.
  Widget _input(String path) {
    final definition = _note.definition;
    final target = definition == null ? null : fieldAt(definition, path);
    final field = target?.field;
    if (target == null || field == null || target.points == Points.entry || target.points == Points.option) {
      return Text(cantChangeHere, style: Theme.of(context).textTheme.bodyLarge);
    }
    final side = target.side;
    final own = side == null ? path : path.substring(0, path.length - side.length - 1);
    final answers = _SheetAnswers(
      _values,
      onChange: (p, v) => setState(() {
        _values[p] = v;
        (_touched[path] ??= {}).add(p);
      }),
    );
    return target.points == Points.cell
        ? FieldHost(field: field, path: path, answers: answers, cell: own)
        : FieldHost(field: field, path: own, answers: answers);
  }
}

/// A note's answers as its read view lists them, an entry's under its section, in order.
List<ReadItem> readItems(ReadModel? model) => [
  for (final ReadSection s in model?.sections ?? const <ReadSection>[]) ...[
    ...s.items,
    for (final ReadEntry e in s.entries ?? const <ReadEntry>[]) ...e.items,
  ],
];

/// The sheet's answers, as the form's field host reads and writes them: nothing waits and nothing
/// conflicts here, the note being finished.
class _SheetAnswers implements FormAnswers {
  _SheetAnswers(this.values, {required this.onChange});
  final Map<String, Object?> values;
  final void Function(String path, Object? value) onChange;

  @override
  AnswerState at(String path) => AnswerState(value: values[path]);

  @override
  void change(String path, Object? value) => onChange(path, value);
}
