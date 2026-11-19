import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../encounters/encounter_models.dart';
import '../../encounters/encounter_services.dart';
import '../../patients/patient_providers.dart';
import '../../sync/local_store.dart' show ChartingPaused, LocalValidationError;
import '../patients/patient_row.dart';
import '../patients/patient_widgets.dart';
import 'encounter_labels.dart';
import 'encounter_widgets.dart';
import 'kind_screen.dart';

/// **New encounter** (lifecycle 9.2, 9.3, 3.10): Who, then Where, then Medical or Non-Medical, each a
/// step of this one screen. Who is phase 3's patient search, with **New patient** (the intake) and
/// **No patient**; started from a profile it is skipped. Where is the place typed. A person not asked
/// the kind (`asksKind`: a credential that can't chart Medical) starts a Non-Medical visit from
/// Where. The visit is created when the last step is answered, and the encounter screen takes this
/// one's place; until then nothing is written. Start refuses, writing nothing, while the clock check
/// fails (D35), and says why before anything is pressed.
class NewEncounterScreen extends StatelessWidget {
  const NewEncounterScreen({super.key, this.patientId});

  /// The patient whose profile this was started from: Who is skipped.
  final String? patientId;

  @override
  Widget build(BuildContext context) => EncountersGate(
    title: newEncounterTitle,
    builder: (context, services) => _NewEncounter(services: services, patientId: patientId),
  );
}

enum _Step { who, where, kind }

class _NewEncounter extends ConsumerStatefulWidget {
  const _NewEncounter({required this.services, required this.patientId});
  final EncounterServices services;
  final String? patientId;

  @override
  ConsumerState<_NewEncounter> createState() => _NewEncounterState();
}

class _NewEncounterState extends ConsumerState<_NewEncounter> {
  final _place = TextEditingController();
  late _Step _step = widget.patientId == null ? _Step.who : _Step.where;

  /// Who the visit is for: none for **No patient**, and none before Who is answered.
  late String? _patientId = widget.patientId;

  /// Their name as the row they were chosen from showed it.
  String? _chosenName;
  bool _busy = false;
  String? _error;

  /// `medical_note_needs_patient`: Medical was chosen with no patient, and Who can still be asked.
  bool _needsPatient = false;

  EncounterServices get _s => widget.services;

  List<_Step> get _steps => [
    if (widget.patientId == null) _Step.who,
    _Step.where,
    if (_s.repository.asksKind) _Step.kind,
  ];

  @override
  void dispose() {
    _place.dispose();
    super.dispose();
  }

  void _goTo(_Step step) => setState(() {
    _step = step;
    _error = null;
    _needsPatient = false;
  });

  void _chose(String? patientId, {String? name}) {
    _patientId = patientId;
    _chosenName = name;
    _goTo(_Step.where);
  }

  void _back() {
    final at = _steps.indexOf(_step);
    if (at > 0) _goTo(_steps[at - 1]);
  }

  /// Creates the visit, the only write of New encounter, and puts the encounter screen in this one's
  /// place.
  void _start(VisitKind kind) {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _needsPatient = false;
    });
    try {
      final id = _s.repository.startEncounter(kind: kind, patientId: _patientId, locationText: _place.text);
      context.pushReplacement('/encounters/$id');
    } on LocalValidationError catch (e) {
      setState(() {
        _error = encounterErrorText(e);
        _needsPatient = e.problem == 'medical_note_needs_patient' && widget.patientId == null;
      });
    } on ChartingPaused catch (e) {
      setState(() => _error = encounterErrorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Asked at every build, whatever caused it: nothing read before a freeze shows again (V1).
    if (_s.store.frozenMessage case final frozen?) {
      return Scaffold(
        appBar: AppBar(title: const Text(newEncounterTitle)),
        body: FrozenNotice(frozen),
      );
    }
    final steps = _steps;
    final at = steps.indexOf(_step);
    final text = Theme.of(context).textTheme;
    final heading = switch (_step) {
      _Step.who => whoHeading,
      _Step.where => whereHeading,
      _Step.kind => kindHeading,
    };
    return PopScope(
      canPop: at <= 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        appBar: AppBar(title: const Text(newEncounterTitle)),
        body: SafeArea(
          child: ListView(
            key: ValueKey(_step),
            padding: const EdgeInsets.all(FieldSpace.s4),
            children: [
              if (steps.length > 1)
                Text(stepText(at + 1, steps.length), style: text.bodyLarge?.copyWith(color: context.field.inkMuted)),
              // Said when the step changes, so a screen reader hears where it is now.
              Semantics(header: true, liveRegion: true, child: Text(heading, style: text.headlineSmall)),
              const SizedBox(height: FieldSpace.s3),
              if (_s.store.chartingPaused) ...[
                const ErrorMessage(chartingPaused),
                const SizedBox(height: FieldSpace.s3),
              ],
              ...switch (_step) {
                _Step.who => _who(),
                _Step.where => _where(steps),
                _Step.kind => _kind(),
              },
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _who() {
    final patients = PatientServices.of(_s.store);
    return [
      if (patients == null || !patients.permissions.contains('patients.view'))
        const NoticeMessage(noPatientRecords)
      else
        PatientFinder(
          patients: patients,
          onChosen: (p) => _chose(p.patientId, name: listName(p)),
        ),
      const SizedBox(height: FieldSpace.s5),
      if (patients?.mayEdit ?? false) ...[
        // The intake opens the new chart when it saves; the visit starts there (+ Encounter).
        ChoiceTile(
          icon: LucideIcons.userPlus,
          label: newPatientAction,
          line: newPatientLine,
          onTap: () => context.pushReplacement('/patients/new'),
        ),
        const SizedBox(height: FieldSpace.s3),
      ],
      ChoiceTile(icon: LucideIcons.userX, label: noPatientAction, line: noPatientLine, onTap: () => _chose(null)),
    ];
  }

  List<Widget> _whoLine() {
    final text = Theme.of(context).textTheme;
    final id = _patientId;
    final who = id == null ? noPatientText : forPatientText(_chosenName ?? visitPatientName(_s.store, id));
    return [
      Wrap(
        spacing: FieldSpace.s2,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(who, style: text.titleMedium),
          if (widget.patientId == null)
            TextButton(
              onPressed: () => _goTo(_Step.who),
              child: Semantics(
                label: changePatientSpoken,
                excludeSemantics: true,
                child: const Text(changePatientAction),
              ),
            ),
        ],
      ),
      const SizedBox(height: FieldSpace.s3),
    ];
  }

  List<Widget> _where(List<_Step> steps) {
    final last = steps.last == _Step.where;
    return [
      ..._whoLine(),
      PhiField(
        name: 'locationText',
        label: whereLabel,
        helper: whereHelper,
        controller: _place,
        capitalization: TextCapitalization.sentences,
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => last ? _start(VisitKind.nonMedical) : _goTo(_Step.kind),
      ),
      const SizedBox(height: FieldSpace.s4),
      if (_error != null) ...[ErrorMessage(_error!), const SizedBox(height: FieldSpace.s3)],
      // A person not asked the kind starts a Non-Medical visit here (6.2).
      BusyButton(
        label: last ? startVisitAction : nextAction,
        busy: _busy,
        onPressed: () => last ? _start(VisitKind.nonMedical) : _goTo(_Step.kind),
      ),
    ];
  }

  List<Widget> _kind() => [
    ..._whoLine(),
    if (_error != null) ...[
      ErrorMessage(_error!),
      const SizedBox(height: FieldSpace.s2),
      if (_needsPatient) ...[
        WideButton(label: choosePatientAction, icon: LucideIcons.userSearch, onPressed: () => _goTo(_Step.who)),
        const SizedBox(height: FieldSpace.s2),
      ],
      const SizedBox(height: FieldSpace.s2),
    ],
    KindChoice(enabled: !_busy, onChosen: _start),
  ];
}
