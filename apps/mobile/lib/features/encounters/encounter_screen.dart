import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../design/widgets/status_chip.dart';
import '../../encounters/encounter_models.dart';
import '../../encounters/encounter_services.dart';
import '../patients/patient_widgets.dart' show SectionHeading, WideButton, confirm, focusInView, showDone;
import 'encounter_labels.dart';
import 'encounter_widgets.dart';
import 'kind_screen.dart';
import 'note_type_list.dart';

/// The visit while it is charted (lifecycle 9.4): its patient, its kind and the place typed, with
/// **Switch to Medical** on a Non-Medical visit (9.3); its notes as the person may see them, each
/// collapsed to its recap line, a teammate's naming whoever acts as its author, an empty draft left
/// out (3.1); a draft the person acts as the author of has **Remove this note** in its menu, asked
/// first; and **Add another note type** below. A visit with no note listed yet shows its note types
/// to choose from. A note opens its form, or its read view once finished.
///
/// Read from the phone's copy, each read logged in its own transaction (`openVisit`, 10.1), again
/// after every change, logging only what a read adds; the visit stays on the phone while it shows.
class EncounterScreen extends StatelessWidget {
  const EncounterScreen({super.key, required this.encounterId});
  final String encounterId;

  @override
  Widget build(BuildContext context) => EncountersGate(
    title: encounterTitle,
    builder: (context, services) => _Encounter(services: services, encounterId: encounterId),
  );
}

class _Encounter extends ConsumerStatefulWidget {
  const _Encounter({required this.services, required this.encounterId});
  final EncounterServices services;
  final String encounterId;

  @override
  ConsumerState<_Encounter> createState() => _EncounterState();
}

class _EncounterState extends ConsumerState<_Encounter> with VisitReading<_Encounter> {
  String? _problem;

  /// **Add another note type**: where focus goes when a removed note's row, and its menu, go.
  final _addFocus = FocusNode();

  @override
  EncounterServices get services => widget.services;
  @override
  String get encounterId => widget.encounterId;

  @override
  void dispose() {
    _addFocus.dispose();
    super.dispose();
  }

  Future<void> _switch(VisitView visit) async {
    setState(() => _problem = null);
    final problem = await switchVisitToMedical(context, services, visit);
    if (mounted) setState(() => _problem = problem);
  }

  Future<void> _remove(NoteView note) async {
    final yes = await confirm(context, title: removeNoteTitle, body: removeNoteBody, yes: removeNoteYes);
    if (!yes || !mounted) return;
    try {
      await services.repository.removeNote(note.noteId);
    } on Exception catch (e) {
      if (mounted) setState(() => _problem = encounterErrorText(e));
      return;
    }
    if (!mounted) return;
    setState(() => _problem = null);
    showDone(context, noteRemoved);
    // The row and its menu went: someone moving by focus continues from the list's Add button.
    if (MediaQuery.accessibleNavigationOf(context)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) focusInView(_addFocus);
      });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text(encounterTitle)),
    body: SafeArea(child: instead() ?? _body(context, visit!)),
  );

  Widget _body(BuildContext context, VisitView visit) {
    final text = Theme.of(context).textTheme;
    final c = context.field;
    final patient = visit.patientId == null ? noPatientText : visitPatientName(services.store, visit.patientId!);
    final place = visit.locationText;
    return ListView(
      padding: const EdgeInsets.all(FieldSpace.s4),
      children: [
        // ---- header ----
        Semantics(
          header: true,
          label: [patient, visitKindText(visit.kind), if (place != null) whereText(place)].join(', '),
          excludeSemantics: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(patient, style: text.headlineSmall),
              Text(visitKindText(visit.kind), style: text.titleMedium),
              if (place != null) Text(whereText(place), style: text.bodyLarge?.copyWith(color: c.ink)),
            ],
          ),
        ),
        if (visit.notSynced) ...[
          const SizedBox(height: FieldSpace.s2),
          const Align(
            alignment: AlignmentDirectional.centerStart,
            child: StatusChip(label: onThisPhoneOnly, icon: LucideIcons.smartphone, tone: ChipTone.info),
          ),
        ],
        if (offersSwitchToMedical(services, visit)) ...[
          const SizedBox(height: FieldSpace.s3),
          WideButton(
            label: switchToMedicalAction,
            icon: LucideIcons.stethoscope,
            onPressed: () => unawaited(_switch(visit)),
          ),
        ],
        if (_problem != null) ...[const SizedBox(height: FieldSpace.s3), ErrorMessage(_problem!)],

        // ---- the notes ----
        if (visit.notes.isEmpty) ...[
          const SectionHeading(chooseNoteTypeHeading),
          NoteTypeList(services: services, visit: visit),
        ] else ...[
          const SectionHeading(notesHeading),
          for (final note in visit.notes) ...[
            _NoteRow(
              note: note,
              onOpen: () => unawaited(context.push(noteLocation(note.noteId))),
              onRemove: note.actsAsAuthor && note.editable ? () => unawaited(_remove(note)) : null,
            ),
            const SizedBox(height: FieldSpace.s2),
          ],
          const SizedBox(height: FieldSpace.s2),
          Focus(
            focusNode: _addFocus,
            skipTraversal: true,
            child: WideButton(
              label: addAnotherNoteType,
              icon: LucideIcons.plus,
              onPressed: () => unawaited(context.push('/encounters/${visit.encounterId}/note-types')),
            ),
          ),
        ],
      ],
    );
  }
}

enum _NoteAction { remove }

/// One note of the visit, collapsed to its recap line: a button that opens it, and, for a draft the
/// person may remove, a menu with **Remove this note**.
class _NoteRow extends StatelessWidget {
  const _NoteRow({required this.note, required this.onOpen, required this.onRemove});
  final NoteView note;
  final VoidCallback onOpen;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final title = note.title ?? untitledNote;
    final by = note.actsAsAuthor ? null : byText(note.actingAuthor);
    // The recap (lifecycle 8.1): a line per section with an answer that counts, each naming its
    // answers; nothing from a sensitive exam, and only what the reader may see.
    final recap = [for (final l in note.recap) l.text];
    final spoken = [
      title,
      noteStateText(note),
      ?by,
      if (showsOnThisPhoneOnly(note)) onThisPhoneOnly,
      ...recap,
    ].join(', ');
    return Material(
      color: c.surface,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: c.line),
        borderRadius: BorderRadius.circular(FieldRadius.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            // The tap is on this node itself, so Switch Access and Voice Access can activate it.
            child: Semantics(
              button: true,
              label: spoken,
              excludeSemantics: true,
              onTap: onOpen,
              child: InkWell(
                borderRadius: BorderRadius.circular(FieldRadius.md),
                onTap: onOpen,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: FieldTap.large),
                  child: Padding(
                    padding: const EdgeInsets.all(FieldSpace.s3),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: text.titleMedium),
                        const SizedBox(height: FieldSpace.s1),
                        Wrap(
                          spacing: FieldSpace.s2,
                          runSpacing: FieldSpace.s1,
                          children: [
                            NoteStateChip(note: note),
                            if (showsOnThisPhoneOnly(note))
                              const StatusChip(
                                label: onThisPhoneOnly,
                                icon: LucideIcons.smartphone,
                                tone: ChipTone.info,
                              ),
                          ],
                        ),
                        if (by != null) ...[const SizedBox(height: FieldSpace.s1), Text(by, style: text.bodyLarge)],
                        if (recap.isNotEmpty) ...[
                          const SizedBox(height: FieldSpace.s1),
                          // Collapsed: three lines, then an ellipsis, as the form's closed section
                          // shows its recap (forms 10.1 #48); a screen reader hears all of it.
                          Text(recap.join('\n'), style: text.bodyMedium, maxLines: 3, overflow: TextOverflow.ellipsis),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (onRemove != null)
            PopupMenuButton<_NoteAction>(
              tooltip: noteMenuSpoken(title),
              icon: Icon(LucideIcons.ellipsisVertical, color: c.ink),
              onSelected: (_) => onRemove!(),
              itemBuilder: (_) => const [PopupMenuItem(value: _NoteAction.remove, child: Text(removeNoteAction))],
            ),
        ],
      ),
    );
  }
}
