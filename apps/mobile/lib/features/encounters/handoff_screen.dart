import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart' show syncControllerProvider;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../encounters/encounter_models.dart';
import '../../encounters/encounter_services.dart';
import '../../forms/conditions.dart' show Answers;
import '../../forms/handoff.dart';
import '../../forms/visible.dart';
import '../../patients/chart_cache.dart' show patientGroup;
import '../../patients/dob.dart';
import '../../patients/generated/sensitive_codes.dart';
import '../../patients/patient_providers.dart';
import '../../sync/local_store.dart' show ChartingPaused, LocalStore, entityEncounter;
import '../../sync/sync_controller.dart' show SyncController;
import '../patients/patient_labels.dart' show longDate;
import '../patients/patient_widgets.dart' show FrozenNotice, WideButton, todayOf;
import '../sync/sync_labels.dart' show timeOfDay;
import 'encounter_labels.dart';
import 'encounter_widgets.dart';

/// EMS as `visibleAnswers` reads them (D94; lifecycle 5.7, 9.8): a reader of every note type but the
/// sensitive ones, without `patients.view_sensitive` or `patients.view_sensitive_exams`, as the
/// server's `EMS_READER` (services/api/src/encounters/handoff.ts). So what reaches EMS does not
/// depend on who shows it: no note of a sensitive type and nothing a sensitive exam recorded, beside
/// the treatment records and sensitive diagnoses `handoffLines` leaves out for every reader.
///
/// PLAN-OPEN: should any of it reach EMS: a behavioral health, harm reduction or sexual health note,
/// or a sensitive exam's findings (lifecycle 12.1 #29)? Until the clinical team and counsel say,
/// none does, on the phone as in the file.
const emsReader = NoteReader(
  actsAsAuthor: false,
  viewSensitive: false,
  viewSensitiveExams: false,
  readsMedical: true,
  chartsMedical: true,
  ordersMedications: true,
  sensitiveCodes: sensitiveCodeRanges,
);

/// What EMS is shown of [note] (D94): what [emsReader] sees of it, and of that only what the person
/// showing it sees too; null for a note EMS may not see at all (a sensitive type), which is then not
/// named either. The server's `sentToEms`, on the phone's read model.
Answers? sentToEms(NoteView note) {
  final definition = note.definition;
  if (definition == null) return null;
  final sent = visibleAnswers(definition, note.answers, emsReader);
  if (sent == null) return null;
  return {
    for (final MapEntry(:key, :value) in sent.entries)
      if (note.answers.containsKey(key)) key: value,
  };
}

/// The EMS handoff (lifecycle 9.8; cards L5-handoff and F7-handoff): a full-screen page for the
/// medic, built by the forms part's `handoffLines` from the visit's notes as EMS may see them
/// ([sentToEms]), whoever shows it. Large text, high contrast in every theme, no app bar actions,
/// **Done** at the bottom. It has no copy and no share, and its text can't be selected (PRD main
/// 413). Who it is about: their preferred name, age in years and allergies, as the portal's file
/// heads it (12.1 #27), never the legal name or the birth date.
///
/// It works offline, from the phone's copy of the visit (`openVisit`, which logs what it reads), and
/// showing it is logged (`ems_handoff.shown`, on the visit, with its patient, 10.1) in the store
/// before anything shows: a showing that can't be logged shows nothing.
class HandoffScreen extends StatelessWidget {
  const HandoffScreen({super.key, required this.encounterId});
  final String encounterId;

  @override
  Widget build(BuildContext context) => EncountersGate(
    title: handoffTitle,
    builder: (context, services) => _Handoff(services: services, encounterId: encounterId),
  );
}

class _Handoff extends ConsumerStatefulWidget {
  const _Handoff({required this.services, required this.encounterId});
  final EncounterServices services;
  final String encounterId;

  @override
  ConsumerState<_Handoff> createState() => _HandoffState();
}

/// What the page shows, worked out once as it opens.
typedef _Shown = ({VisitView visit, List<({String title, String state})> notes, List<HandoffLine> lines});

class _HandoffState extends ConsumerState<_Handoff> {
  _Shown? _shown;
  bool _opening = true;
  String? _refused;
  late final SyncController _sync;

  EncounterServices get _s => widget.services;

  @override
  void initState() {
    super.initState();
    _sync = ref.read(syncControllerProvider);
    _s.sweep.showing.add(widget.encounterId);
    unawaited(_open());
  }

  @override
  void dispose() {
    _s.sweep.showing.remove(widget.encounterId);
    super.dispose();
  }

  Future<void> _open() async {
    try {
      final visit = await _s.repository.openVisit(widget.encounterId);
      if (!mounted) return;
      if (visit == null) return setState(() => _opening = false);
      final notes = <NoteView>[];
      final answers = <Answers>[];
      for (final n in visit.notes) {
        final sent = sentToEms(n);
        if (sent == null) continue;
        notes.add(n);
        answers.add(sent);
      }
      final lines = handoffLines([for (final n in notes) n.definition!], answers, sensitiveCodeRanges);
      // Logged before it shows, in the store: refused while frozen, and then nothing shows.
      _s.store.transaction(
        () => _s.store.appendAudit(
          'ems_handoff.shown',
          entity: entityEncounter,
          entityId: visit.encounterId,
          patientId: visit.patientId,
        ),
      );
      setState(() {
        _shown = (
          visit: visit,
          notes: [for (final n in notes) (title: n.title ?? untitledNote, state: noteStateText(n))],
          lines: lines,
        );
        _opening = false;
      });
    } on ChartingPaused catch (e) {
      if (mounted) {
        setState(() {
          _refused = e.message;
          _opening = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // High contrast in every theme: Day's page is High contrast's; Night run keeps its dark ground,
    // every word in full ink, none muted.
    final palette = Theme.of(context).extension<FieldPalette>()!;
    final theme = palette.theme == FieldTheme.night ? FieldTheme.night : FieldTheme.contrast;
    return Theme(
      data: buildFieldTheme(theme),
      child: Builder(builder: _page),
    );
  }

  Widget _page(BuildContext context) {
    final shown = _shown;
    Widget? instead;
    if (!encountersOpen(_sync, _s)) {
      instead = const SizedBox.shrink();
    } else if (_s.store.frozenMessage case final frozen?) {
      instead = FrozenNotice(frozen);
    } else if (_refused case final message?) {
      instead = FrozenNotice(message);
    } else if (_opening) {
      instead = const Center(child: CircularProgressIndicator());
    } else if (shown == null) {
      instead = const Padding(padding: EdgeInsets.all(FieldSpace.s4), child: Text(visitNotOnPhone));
    }
    return Scaffold(
      backgroundColor: context.field.surface,
      // No actions, and no way back but Done (or the system's back): nothing here to copy or share.
      appBar: AppBar(title: const Text(handoffTitle), automaticallyImplyLeading: false),
      body: SafeArea(child: instead ?? _lines(context, shown!)),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(FieldSpace.s4, FieldSpace.s2, FieldSpace.s4, FieldSpace.s3),
          child: WideButton(label: handoffDone, filled: true, onPressed: () => Navigator.of(context).pop()),
        ),
      ),
    );
  }

  Widget _lines(BuildContext context, _Shown shown) {
    final text = Theme.of(context).textTheme;
    final c = context.field;
    final big = text.titleLarge?.copyWith(color: c.ink);
    final heading = text.headlineSmall?.copyWith(color: c.ink, fontWeight: FontWeight.w700);
    final visit = shown.visit;
    final patientId = visit.patientId;
    final start = visit.startedAt?.toLocal();
    // Each note's lines under its title and state, in handoffLines' order (the portal's file too).
    Widget part(HandoffKind kind) {
      final lines = shown.lines.where((l) => l.kind == kind).toList();
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (i, line) in lines.indexed) ...[
            if (i == 0 || lines[i - 1].note != line.note)
              Padding(
                padding: const EdgeInsets.only(top: FieldSpace.s4, bottom: FieldSpace.s1),
                child: Semantics(
                  header: true,
                  child: Text(
                    '${shown.notes[line.note].title} (${shown.notes[line.note].state})',
                    style: big?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.only(bottom: FieldSpace.s2),
              child: Text('${line.label}: ${line.value}', style: big),
            ),
          ],
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.all(FieldSpace.s4),
      children: [
        if (patientId == null)
          Semantics(header: true, child: Text(handoffNoPatient, style: heading))
        else ...[
          Semantics(header: true, child: Text(visitPatientName(_s.store, patientId), style: heading)),
          const SizedBox(height: FieldSpace.s1),
          Text(_ageOf(_s.store, patientId, todayOf(ref)), style: big),
          Text(visitAllergyBadge(_s.store, patientId).text, style: big),
        ],
        if (start != null) ...[
          const SizedBox(height: FieldSpace.s2),
          Text(
            'Visit started ${longDate(start)}, ${timeOfDay(context, start)}'
            '${visit.clockVerified ? '' : ' (phone clock, not verified)'}',
            style: big,
          ),
        ],
        if (shown.lines.isEmpty) ...[
          const SizedBox(height: FieldSpace.s4),
          Text(handoffNothing, style: big),
        ] else ...[
          part(HandoffKind.field),
          if (shown.lines.any((l) => l.kind == HandoffKind.recap)) ...[
            const SizedBox(height: FieldSpace.s4),
            Semantics(header: true, child: Text(handoffRecapHeading, style: heading)),
            part(HandoffKind.recap),
          ],
        ],
      ],
    );
  }
}

/// The patient's age in years as the portal's file words it (lifecycle 5.7): "Age 52" from a full
/// birth date, "Age about 46" from a year or an estimate, "Age not recorded". From the record the
/// phone holds of their merged group, else the team's index; never the birth date itself.
String _ageOf(LocalStore store, String patientId, DateTime today) {
  final canonical = store.canonicalPatient(patientId);
  Birth? birth;
  for (final id in patientGroup(store, canonical)) {
    birth ??= Birth.fromJson(store.record(id)?.fields['birth']?.value);
  }
  birth ??= Birth.fromJson(PatientServices.of(store)?.index.entry(canonical)?.birth?.toJson());
  if (birth == null) return ageNotRecorded;
  final years = ageOn(birth, today);
  return birth is BirthDate ? 'Age $years' : 'Age about $years';
}
