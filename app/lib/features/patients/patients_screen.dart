import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../widgets/app_badge.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_card.dart';
import '../../widgets/app_input.dart';

/// The seven filter chips from the prototype, in the same order.
enum PatientFilter {
  all('All'),
  highRisk('High Risk'),
  moderateRisk('Moderate Risk'),
  lowRisk('Low Risk'),
  pregnancy('Pregnancy'),
  mentalHealth('Mental Health'),
  chronic('Chronic');

  const PatientFilter(this.label);
  final String label;

  bool matches(Patient p) => switch (this) {
    PatientFilter.all => true,
    PatientFilter.highRisk => p.risk == RiskLevel.high,
    PatientFilter.moderateRisk => p.risk == RiskLevel.moderate,
    PatientFilter.lowRisk => p.risk == RiskLevel.low,
    PatientFilter.pregnancy => p.hasFlag(PatientFlag.pregnancy),
    PatientFilter.mentalHealth => p.hasFlag(PatientFlag.mentalHealth),
    PatientFilter.chronic => p.hasFlag(PatientFlag.chronicDisease),
  };
}

/// Ports `PatientsView`.
class PatientsScreen extends ConsumerStatefulWidget {
  const PatientsScreen({super.key});

  @override
  ConsumerState<PatientsScreen> createState() => _PatientsScreenState();
}

class _PatientsScreenState extends ConsumerState<PatientsScreen> {
  final _searchController = TextEditingController();
  PatientFilter _filter = PatientFilter.all;
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final patients = ref.watch(patientsProvider).valueOrNull ?? const [];
    final filtered = patients
        .where((p) => p.matchesSearch(_query) && _filter.matches(p))
        .toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x8,
      ),
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Patient Care',
              style: TextStyle(
                fontSize: AppText.xxl,
                fontWeight: AppText.bold,
                color: AppColors.slate900,
              ),
            ),
            AppIconButton(
              icon: LucideIcons.plus,
              shadows: AppShadows.md,
              onPressed: () => context.push(AppRoutes.patientsEnroll),
            ),
          ],
        ),
        const SizedBox(height: AppSpace.x4),
        AppInput(
          controller: _searchController,
          placeholder: 'Search by name or DOB (YYYY-MM-DD)...',
          leadingIcon: LucideIcons.search,
          height: 48,
          radius: AppRadius.xxl,
          onChanged: (v) => setState(() => _query = v),
        ),
        const SizedBox(height: AppSpace.x4),
        FilterChipRow<PatientFilter>(
          values: PatientFilter.values,
          selected: _filter,
          labelOf: (f) => f.label,
          onSelected: (f) => setState(() => _filter = f),
        ),
        const SizedBox(height: AppSpace.x4),
        if (filtered.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpace.x8),
            child: Text(
              patients.isEmpty
                  ? 'No patients enrolled yet. Tap + to enroll the first one.'
                  : 'No patients match this search.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: AppText.xs,
                color: AppColors.slate400,
                fontStyle: FontStyle.italic,
              ),
            ),
          ),
        for (final p in filtered) ...[
          PatientCard(patient: p),
          const SizedBox(height: AppSpace.x3),
        ],
      ],
    );
  }
}

class PatientCard extends StatelessWidget {
  const PatientCard({super.key, required this.patient});

  final Patient patient;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: () => context.go(AppRoutes.patientDetail(patient.id)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      patient.name,
                      style: const TextStyle(
                        fontSize: AppText.lg,
                        fontWeight: AppText.bold,
                        color: AppColors.slate900,
                      ),
                    ),
                    Text(
                      '${patient.age}y • DOB: ${patient.dobIso} • ${patient.loc}',
                      style: const TextStyle(
                        fontSize: AppText.xs,
                        color: AppColors.slate500,
                      ),
                    ),
                  ],
                ),
              ),
              AppBadge.risk(patient.risk),
            ],
          ),
          const SizedBox(height: AppSpace.x3),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Wrap(
                  spacing: AppSpace.x1,
                  runSpacing: AppSpace.x1,
                  children: [
                    for (final f in patient.flags)
                      AppBadge.outline(
                        f.label,
                        color: AppColors.blue600,
                        border: AppColors.blue100,
                        fill: AppColors.blue50,
                        fontSize: AppText.xxs,
                      ),
                  ],
                ),
              ),
              if (patient.nextFollowUp != null)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      LucideIcons.calendar,
                      size: 12,
                      color: AppColors.blue600,
                    ),
                    const SizedBox(width: AppSpace.x1),
                    Text(
                      'NEXT: ${patient.nextFollowUpIso}',
                      style: const TextStyle(
                        fontSize: AppText.micro,
                        fontWeight: AppText.bold,
                        color: AppColors.blue600,
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}
