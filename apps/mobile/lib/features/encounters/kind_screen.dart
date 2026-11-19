import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../encounters/encounter_models.dart';
import '../../encounters/encounter_services.dart';
import '../../patients/patient_providers.dart';
import '../patients/patient_widgets.dart' show confirm, showDone;
import 'encounter_labels.dart';
import 'encounter_widgets.dart' show choosePatient;

/// **Medical or Non-Medical** (lifecycle 9.3): two large buttons, each with its line under its name
/// (PRD main 379), the last step of New encounter. A person whose credential can't chart Medical is
/// not shown it (`asksKind`): their visit starts Non-Medical.
class KindChoice extends StatelessWidget {
  const KindChoice({super.key, required this.onChosen, this.enabled = true});
  final ValueChanged<VisitKind> onChosen;
  final bool enabled;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final kind in VisitKind.values) ...[
        _KindButton(kind: kind, onTap: enabled ? () => onChosen(kind) : null),
        const SizedBox(height: FieldSpace.s3),
      ],
    ],
  );
}

class _KindButton extends StatelessWidget {
  const _KindButton({required this.kind, required this.onTap});
  final VisitKind kind;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    // One node, read as the design's line, with the tap on it for Switch Access and Voice Access.
    return Semantics(
      button: true,
      enabled: onTap != null,
      label: kindLine(kind),
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: c.surface,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: c.lineStrong, width: 2),
          borderRadius: BorderRadius.circular(FieldRadius.lg),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(FieldRadius.lg),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: FieldTap.large * 2),
            child: Padding(
              padding: const EdgeInsets.all(FieldSpace.s4),
              child: Row(
                children: [
                  Icon(kind == VisitKind.medical ? LucideIcons.stethoscope : LucideIcons.heartHandshake, color: c.ink),
                  const SizedBox(width: FieldSpace.s3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(kindText(kind), style: text.headlineSmall),
                        const SizedBox(height: FieldSpace.s1),
                        Text(kindDetail(kind), style: text.bodyLarge),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Whether the visit's header offers **Switch to Medical** (lifecycle 9.3): a Non-Medical visit,
/// to someone the kind is asked of, a role that charts with a credential that charts Medical.
bool offersSwitchToMedical(EncounterServices services, VisitView visit) =>
    visit.kind == VisitKind.nonMedical && services.repository.asksKind;

/// **Switch to Medical** (lifecycle 9.3, 3.10): on a visit with no patient, asks who the patient is
/// first, with phase 3's search; then whether to switch, since there is no switch back. The domain
/// layer sets the kind, and the patient with it, in one change, every answer kept. Returns the
/// refusal's words, or null when it switched or the person stopped.
Future<String?> switchVisitToMedical(BuildContext context, EncounterServices services, VisitView visit) async {
  String? patientId;
  if (visit.patientId == null) {
    final patients = PatientServices.of(services.store);
    if (patients == null || !patients.permissions.contains('patients.view')) return noPatientRecords;
    final chosen = await choosePatient(context, patients, line: switchNeedsPatient);
    if (chosen == null || !context.mounted) return null;
    patientId = chosen.patientId;
  }
  final yes = await confirm(
    context,
    title: switchToMedicalTitle,
    body: switchToMedicalBody,
    yes: switchToMedicalAction,
  );
  if (!yes || !context.mounted) return null;
  try {
    services.repository.switchToMedical(visit.encounterId, patientId: patientId);
  } on Exception catch (e) {
    return encounterErrorText(e);
  }
  showDone(context, switchedToMedical);
  return null;
}
