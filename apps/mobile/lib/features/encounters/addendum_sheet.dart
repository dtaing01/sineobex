import 'package:flutter/material.dart';

import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../encounters/encounter_repository.dart' hide Expanded;
import '../../encounters/encounter_services.dart';
import '../forms/text_field.dart' show limitCodePoints;
import '../patients/patient_labels.dart' show count;
import '../patients/patient_widgets.dart' show PhiField, WideButton, showDone;
import 'encounter_labels.dart';
import 'encounter_widgets.dart' show SheetGate;

/// **Add addendum** (lifecycle 3.6, 9.7): "a dated entry by its author attached below the note"
/// (PRD main 459), one text box of up to 4,000 characters, below the note [noteId] of the visit
/// [encounterId], or below the visit itself when [noteId] is null. [to] names what it goes below.
/// `addAddendum` holds every rule (who may add one, a note they may not read, the length, waiting
/// behind a sign-off not yet sent, a note brought from the server first) and words every refusal;
/// the sheet shows them. Returns the addendum's ID, or null when the sheet was closed without one.
Future<String?> showAddendumSheet(
  BuildContext context,
  EncounterServices services, {
  required String encounterId,
  required String? noteId,
  required String to,
}) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (context) => SheetGate(
    services: services,
    child: _Addendum(services: services, encounterId: encounterId, noteId: noteId, to: to),
  ),
);

class _Addendum extends StatefulWidget {
  const _Addendum({required this.services, required this.encounterId, required this.noteId, required this.to});
  final EncounterServices services;
  final String encounterId;
  final String? noteId;
  final String to;

  @override
  State<_Addendum> createState() => _AddendumState();
}

class _AddendumState extends State<_Addendum> {
  final _text = TextEditingController();
  String? _problem;
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  /// Cut at the limit as the form's text boxes cut theirs: in code points, as the server counts.
  void _typed(String typed) {
    final limited = limitCodePoints(typed, addendumMax);
    if (limited != typed) {
      _text.value = TextEditingValue(
        text: limited,
        selection: TextSelection.collapsed(offset: limited.length),
      );
    }
    setState(() {});
  }

  Future<void> _add() async {
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      final id = await widget.services.repository.addAddendum(
        widget.encounterId,
        noteId: widget.noteId,
        text: _text.text,
      );
      if (!mounted) return;
      showDone(context, addendumAdded);
      Navigator.of(context).pop(id);
    } on Exception catch (e) {
      if (mounted) setState(() => _problem = encounterErrorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
          children: [
            Semantics(header: true, child: Text(addAddendumAction, style: text.titleLarge)),
            const SizedBox(height: FieldSpace.s1),
            Text(widget.noteId == null ? addendumToVisit : addendumToText(widget.to), style: text.bodyLarge),
            const SizedBox(height: FieldSpace.s3),
            PhiField(
              name: 'addendum',
              label: addendumLabel,
              controller: _text,
              maxLines: 10,
              minLines: 4,
              showCounter: false,
              capitalization: TextCapitalization.sentences,
              textInputAction: TextInputAction.newline,
              onChanged: _typed,
            ),
            const SizedBox(height: FieldSpace.s1),
            Text(charactersText(count(_text.text.runes.length), count(addendumMax)), style: text.bodyMedium),
            if (_problem != null) ...[const SizedBox(height: FieldSpace.s2), ErrorMessage(_problem!)],
            const SizedBox(height: FieldSpace.s3),
            WideButton(label: addAddendumAction, filled: true, onPressed: _busy ? null : _add),
          ],
        ),
      ),
    );
  }
}
