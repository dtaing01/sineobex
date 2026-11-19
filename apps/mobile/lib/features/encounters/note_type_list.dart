import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../encounters/encounter_models.dart';
import '../../encounters/encounter_services.dart';
import '../../forms/definition.dart' show NoteTypeDef;
import '../patients/patient_widgets.dart' show SectionHeading;
import 'encounter_labels.dart';
import 'encounter_widgets.dart';

/// Where a note opens: its form, or its read view once finished (lifecycle 9.5, 9.7). The route
/// carries the note's UUID only (10.2).
String noteLocation(String noteId) => '/notes/$noteId';

/// The note types a visit offers the person (lifecycle 9.4, 6.2): "Choose an encounter type ... to
/// load its template" (PRD main 380). The team's list as the phone holds it, in its order, as
/// `noteTypesOffered` gives it for the visit's kind and the person's credential; the Red flags note
/// is never among them, since the app adds it (forms 6.2). Tapping a type is `addNote`: it opens the
/// draft of that type the visit already has (the person's own first, then a teammate's they may
/// see), else makes the note, with the person's Red flags note beside a Medical one, and the note's
/// form opens. A type the visit shows a draft of says so, and offers **Add another**, a second note
/// of the type (4.4).
class NoteTypeList extends ConsumerStatefulWidget {
  const NoteTypeList({super.key, required this.services, required this.visit, this.replace = false});
  final EncounterServices services;
  final VisitView visit;

  /// The note opens in this route's place (the Note types screen), so going back from it lands on
  /// the encounter screen.
  final bool replace;

  @override
  ConsumerState<NoteTypeList> createState() => _NoteTypeListState();
}

class _NoteTypeListState extends ConsumerState<NoteTypeList> {
  List<NoteTypeDef>? _listed;
  bool _busy = false;
  String? _problem;

  EncounterServices get _s => widget.services;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  /// The team's list from the phone's files, offline too.
  Future<void> _load() async {
    final listed = await _s.noteTypes();
    if (mounted) setState(() => _listed = listed);
  }

  Future<void> _add(NoteTypeDef type, {bool another = false}) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      final added = await _s.repository.addNote(widget.visit.encounterId, type, another: another);
      if (!mounted) return;
      final location = noteLocation(added.noteId);
      if (widget.replace) {
        context.pushReplacement(location);
      } else {
        unawaited(context.push(location));
      }
    } on Exception catch (e) {
      if (mounted) setState(() => _problem = encounterErrorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_s.user.charts) return const NoticeMessage(notCharting);
    final listed = _listed;
    if (listed == null) return const Center(child: CircularProgressIndicator());
    if (listed.isEmpty) return const NoticeMessage(noNoteTypes);
    final visit = widget.visit;
    final offered = _s.repository.noteTypesOffered(listed, visit.kind);
    final drafts = {
      for (final n in visit.notes)
        if (!n.finished && !n.sentForReview) n.noteTypeKey,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_problem != null) ...[ErrorMessage(_problem!), const SizedBox(height: FieldSpace.s3)],
        for (final type in offered) ...[
          _TypeRow(
            type: type,
            hasDraft: drafts.contains(type.key),
            onTap: _busy ? null : () => unawaited(_add(type)),
            onAnother: _busy ? null : () => unawaited(_add(type, another: true)),
          ),
          const SizedBox(height: FieldSpace.s2),
        ],
        if (visit.kind == VisitKind.nonMedical && _s.user.can.chartMedical) ...[
          const SizedBox(height: FieldSpace.s2),
          Text(clinicalNeedsMedical, style: Theme.of(context).textTheme.bodyLarge),
        ],
      ],
    );
  }
}

/// One note type: a button reading its title, and, when the visit has a draft of it, the line that
/// says the draft opens and **Add another**.
class _TypeRow extends StatelessWidget {
  const _TypeRow({required this.type, required this.hasDraft, required this.onTap, required this.onAnother});
  final NoteTypeDef type;
  final bool hasDraft;
  final VoidCallback? onTap;
  final VoidCallback? onAnother;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final row = Semantics(
      button: true,
      enabled: onTap != null,
      label: hasDraft ? '${type.title}. $draftOpensLine' : type.title,
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: c.surface,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: c.lineStrong),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(FieldRadius.md),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: FieldTap.large),
            child: Padding(
              padding: const EdgeInsets.all(FieldSpace.s3),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(type.title, style: text.titleMedium),
                        if (hasDraft) Text(draftOpensLine, style: text.bodyMedium?.copyWith(color: c.ink)),
                      ],
                    ),
                  ),
                  ExcludeSemantics(child: Icon(LucideIcons.chevronRight, color: c.ink)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    if (!hasDraft) return row;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        row,
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: TextButton.icon(
            onPressed: onAnother,
            icon: const Icon(LucideIcons.plus),
            label: Semantics(
              label: addAnotherSpoken(type.title),
              excludeSemantics: true,
              child: const Text(addAnotherAction),
            ),
          ),
        ),
      ],
    );
  }
}

/// **Add another note type** from the encounter screen (lifecycle 9.4): the visit's note types, on a
/// screen of their own. The note opens in this screen's place.
class NoteTypesScreen extends StatelessWidget {
  const NoteTypesScreen({super.key, required this.encounterId});
  final String encounterId;

  @override
  Widget build(BuildContext context) => EncountersGate(
    title: noteTypesTitle,
    builder: (context, services) => _NoteTypes(services: services, encounterId: encounterId),
  );
}

class _NoteTypes extends ConsumerStatefulWidget {
  const _NoteTypes({required this.services, required this.encounterId});
  final EncounterServices services;
  final String encounterId;

  @override
  ConsumerState<_NoteTypes> createState() => _NoteTypesState();
}

class _NoteTypesState extends ConsumerState<_NoteTypes> with VisitReading<_NoteTypes> {
  @override
  EncounterServices get services => widget.services;
  @override
  String get encounterId => widget.encounterId;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text(noteTypesTitle)),
    body: SafeArea(
      child:
          instead() ??
          ListView(
            padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
            children: [
              const SectionHeading(chooseNoteTypeHeading),
              NoteTypeList(services: services, visit: visit!, replace: true),
            ],
          ),
    ),
  );
}
