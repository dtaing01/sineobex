import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/tokens.dart';
import '../../core/util/formatting.dart';
import '../../data/models/models.dart';
import '../../widgets/app_badge.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_card.dart';
import '../../widgets/map_pin.dart';
import '../../widgets/mini_map.dart';
import 'encounter_form.dart';

/// Ports `PatientDetail`.
class PatientDetailScreen extends ConsumerWidget {
  const PatientDetailScreen({super.key, required this.patientId});

  final String patientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final patient = ref.watch(patientProvider(patientId)).valueOrNull;

    if (patient == null) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(AppSpace.x8),
          child: Text(
            'Patient record not found.',
            style: TextStyle(fontSize: AppText.sm, color: AppColors.slate400),
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x8,
      ),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: AppButton(
            label: 'Back to Care',
            icon: LucideIcons.chevronLeft,
            variant: AppButtonVariant.ghost,
            foreground: AppColors.slate500,
            onPressed: () => context.go(AppRoutes.patients),
          ),
        ),
        const SizedBox(height: AppSpace.x4),
        _Header(patient: patient),
        if (patient.flags.isNotEmpty) ...[
          const SizedBox(height: AppSpace.x6),
          _FlagChips(flags: patient.flags),
        ],
        const SizedBox(height: AppSpace.x6),
        _FieldIntelligenceMap(patient: patient),
        const SizedBox(height: AppSpace.x6),
        _MovementPatterns(locations: patient.commonLocations),
        const SizedBox(height: AppSpace.x6),
        _DemographicsAndBilling(patient: patient),
        const SizedBox(height: AppSpace.x6),
        EncounterForm(patient: patient),
        const SizedBox(height: AppSpace.x6),
        _EncounterHistory(history: patient.history),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.patient});

  final Patient patient;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                patient.name,
                style: const TextStyle(
                  fontSize: AppText.xxxl,
                  fontWeight: AppText.bold,
                  color: AppColors.slate900,
                  height: 1.15,
                ),
              ),
              Text(
                '${patient.age}y • DOB: ${patient.dobIso} • ${patient.loc}',
                style: const TextStyle(
                  fontSize: AppText.sm,
                  fontWeight: AppText.medium,
                  color: AppColors.slate500,
                ),
              ),
              if (patient.nextFollowUp != null) ...[
                const SizedBox(height: AppSpace.x1),
                Row(
                  children: [
                    const Icon(
                      LucideIcons.calendar,
                      size: 14,
                      color: AppColors.blue600,
                    ),
                    const SizedBox(width: AppSpace.x1),
                    Text(
                      'NEXT FOLLOW-UP: ${patient.nextFollowUpIso}',
                      style: const TextStyle(
                        fontSize: AppText.xs,
                        fontWeight: AppText.bold,
                        color: AppColors.blue600,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: AppSpace.x2),
        AppBadge.risk(patient.risk, fontSize: AppText.xs),
      ],
    );
  }
}

class _FlagChips extends StatelessWidget {
  const _FlagChips({required this.flags});

  final List<PatientFlag> flags;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpace.x2,
      runSpacing: AppSpace.x2,
      children: [
        for (final f in flags)
          AppBadge(
            '${f.emoji} ${f.label}',
            background: AppColors.blue600,
            foreground: AppColors.white,
            fontSize: AppText.micro,
            uppercase: false,
          ),
      ],
    );
  }
}

class _FieldIntelligenceMap extends StatelessWidget {
  const _FieldIntelligenceMap({required this.patient});

  final Patient patient;

  @override
  Widget build(BuildContext context) {
    final riskColor = MapPin.colorForRisk(patient.risk);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Field Intelligence Map', icon: LucideIcons.map),
        const SizedBox(height: AppSpace.x3),
        AppCard(
          padding: EdgeInsets.zero,
          radius: AppRadius.xxl,
          clip: true,
          shadows: AppShadows.sm,
          child: SizedBox(
            height: 224,
            child: Stack(
              children: [
                FlutterMap(
                  options: MapOptions(
                    initialCenter: patient.position,
                    initialZoom: 15,
                  ),
                  children: [
                    const OsmTileLayer(),
                    MarkerLayer(
                      markers: [
                        // Common locations sit under the current pin so the
                        // "where they are now" marker always wins the z-order.
                        for (final loc in patient.commonLocations)
                          Marker(
                            point: loc.position,
                            width: 14,
                            height: 18,
                            alignment: Alignment.topCenter,
                            child: Tooltip(
                              message: loc.name,
                              child: const MapPin(
                                color: AppColors.slate500,
                                size: 14,
                              ),
                            ),
                          ),
                        Marker(
                          point: patient.position,
                          width: 20,
                          height: 26,
                          alignment: Alignment.topCenter,
                          child: Tooltip(
                            message: 'Current: ${patient.loc}',
                            child: MapPin(color: riskColor, size: 20),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                Positioned(
                  top: AppSpace.x2,
                  right: AppSpace.x2,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      _LegendPill(color: riskColor, label: 'Current Location'),
                      const SizedBox(height: AppSpace.x1),
                      const _LegendPill(
                        color: AppColors.slate500,
                        label: 'Common Hubs',
                      ),
                    ],
                  ),
                ),
                Positioned(
                  bottom: AppSpace.x2,
                  left: AppSpace.x2,
                  right: AppSpace.x2,
                  child: SizedBox(
                    height: 34,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: patient.commonLocations.length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(width: AppSpace.x1),
                      itemBuilder: (_, i) {
                        final loc = patient.commonLocations[i];
                        return Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpace.x2,
                            vertical: AppSpace.x1,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.white.withValues(alpha: 0.9),
                            borderRadius: BorderRadius.circular(AppRadius.md),
                            border: Border.all(color: AppColors.slate200),
                            boxShadow: AppShadows.sm,
                          ),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                loc.name,
                                style: const TextStyle(
                                  fontSize: AppText.tiny,
                                  fontWeight: AppText.bold,
                                  color: AppColors.slate600,
                                ),
                              ),
                              Text(
                                '${loc.day}, ${loc.date} • ${loc.time}',
                                style: const TextStyle(
                                  fontSize: AppText.xxxs,
                                  fontWeight: AppText.medium,
                                  color: AppColors.slate400,
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
                ),
                const Positioned(bottom: 0, right: 0, child: MapAttribution()),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _LegendPill extends StatelessWidget {
  const _LegendPill({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpace.x2,
        vertical: AppSpace.x1,
      ),
      decoration: BoxDecoration(
        color: AppColors.white.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.slate200),
        boxShadow: AppShadows.sm,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: AppSpace.x1),
          Text(
            label,
            style: const TextStyle(
              fontSize: AppText.xxs,
              fontWeight: AppText.bold,
              color: AppColors.slate700,
            ),
          ),
        ],
      ),
    );
  }
}

class _MovementPatterns extends StatelessWidget {
  const _MovementPatterns({required this.locations});

  final List<CommonLocation> locations;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(
          'Historical Movement Patterns',
          icon: LucideIcons.clock,
        ),
        const SizedBox(height: AppSpace.x3),
        for (final loc in locations) ...[
          Container(
            padding: const EdgeInsets.all(AppSpace.x3),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(AppRadius.xl),
              border: Border.all(color: AppColors.slate100),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(AppSpace.x2),
                  decoration: BoxDecoration(
                    color: AppColors.slate50,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: const Icon(
                    LucideIcons.mapPin,
                    size: 16,
                    color: AppColors.slate400,
                  ),
                ),
                const SizedBox(width: AppSpace.x3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        loc.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: AppText.xs,
                          fontWeight: AppText.bold,
                          color: AppColors.slate900,
                        ),
                      ),
                      Text(
                        '${loc.day}, ${loc.date} • ${loc.time}',
                        style: const TextStyle(
                          fontSize: AppText.micro,
                          color: AppColors.slate500,
                        ),
                      ),
                    ],
                  ),
                ),
                if (loc.verified)
                  AppBadge.outline(
                    'Verified',
                    color: AppColors.blue600,
                    border: AppColors.blue100,
                    fill: AppColors.blue50,
                    fontSize: AppText.xxs,
                  ),
              ],
            ),
          ),
          const SizedBox(height: AppSpace.x2),
        ],
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: AppSpace.x1),
          child: Text(
            'Movement patterns help predict patient location for future '
            'outreach follow-ups.',
            style: TextStyle(
              fontSize: AppText.tiny,
              color: AppColors.slate400,
              fontStyle: FontStyle.italic,
            ),
          ),
        ),
      ],
    );
  }
}

class _DemographicsAndBilling extends StatelessWidget {
  const _DemographicsAndBilling({required this.patient});

  final Patient patient;

  @override
  Widget build(BuildContext context) {
    Widget cell(String label, String value) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        FieldLabel(label),
        const SizedBox(height: AppSpace.x1),
        Text(
          value,
          style: const TextStyle(
            fontSize: AppText.sm,
            fontWeight: AppText.medium,
            color: AppColors.slate900,
          ),
        ),
      ],
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Demographics & Billing', icon: LucideIcons.info),
        const SizedBox(height: AppSpace.x3),
        AppCard(
          child: Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: cell(
                      'Insurance Name',
                      patient.insuranceName ?? 'Self-Pay / Not Provided',
                    ),
                  ),
                  const SizedBox(width: AppSpace.x4),
                  Expanded(
                    child: cell('Member ID#', patient.memberId ?? 'N/A'),
                  ),
                ],
              ),
              const Padding(
                padding: EdgeInsets.symmetric(vertical: AppSpace.x3),
                child: Divider(color: AppColors.slate100),
              ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: cell(
                      'Primary Doctor',
                      patient.primaryDoctor ?? 'None Assigned',
                    ),
                  ),
                  const SizedBox(width: AppSpace.x4),
                  Expanded(
                    child: cell('Phone Number', patient.phone ?? 'No Phone'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _EncounterHistory extends StatelessWidget {
  const _EncounterHistory({required this.history});

  final List<Encounter> history;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Encounter History', icon: LucideIcons.history),
        const SizedBox(height: AppSpace.x4),
        if (history.isEmpty)
          const Padding(
            padding: EdgeInsets.only(left: AppSpace.x8),
            child: Text(
              'No previous encounters documented.',
              style: TextStyle(
                fontSize: AppText.xs,
                color: AppColors.slate400,
                fontStyle: FontStyle.italic,
              ),
            ),
          ),
        for (final h in history)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // The vertical timeline rail with its node dot.
                SizedBox(
                  width: 24,
                  child: Stack(
                    alignment: Alignment.topCenter,
                    children: [
                      Container(width: 2, color: AppColors.slate200),
                      Positioned(
                        top: AppSpace.x2,
                        child: Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: AppColors.blue500,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: AppColors.white,
                              width: 2,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpace.x2),
                Expanded(child: _EncounterCard(encounter: h)),
              ],
            ),
          ),
      ],
    );
  }
}

class _EncounterCard extends StatelessWidget {
  const _EncounterCard({required this.encounter});

  final Encounter encounter;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.x3),
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  encounter.provider.toUpperCase(),
                  style: const TextStyle(
                    fontSize: AppText.micro,
                    fontWeight: AppText.bold,
                    color: AppColors.slate900,
                  ),
                ),
                Text(
                  Fmt.isoDate(encounter.date),
                  style: const TextStyle(
                    fontSize: AppText.micro,
                    color: AppColors.slate400,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpace.x2),
            Row(
              children: [
                const Icon(
                  LucideIcons.mapPin,
                  size: 10,
                  color: AppColors.slate400,
                ),
                const SizedBox(width: AppSpace.x1),
                Flexible(
                  child: Text(
                    encounter.encounterLoc,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: AppText.micro,
                      fontWeight: AppText.medium,
                      color: AppColors.slate500,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpace.x2),
            const FieldLabel('Needs Addressed', color: AppColors.blue600),
            const SizedBox(height: 2),
            Text(
              encounter.needs,
              style: const TextStyle(
                fontSize: AppText.xs,
                fontWeight: AppText.medium,
                color: AppColors.slate800,
              ),
            ),
            const SizedBox(height: AppSpace.x2),
            const FieldLabel('Clinical Notes'),
            const SizedBox(height: 2),
            Text(
              encounter.notes,
              style: const TextStyle(
                fontSize: AppText.sm,
                color: AppColors.slate600,
                height: 1.6,
              ),
            ),
            if (encounter.supplies.isNotEmpty) ...[
              const SizedBox(height: AppSpace.x3),
              const FieldLabel('Materials Provided'),
              const SizedBox(height: AppSpace.x1),
              Wrap(
                spacing: AppSpace.x1,
                runSpacing: AppSpace.x1,
                children: [
                  for (final s in encounter.supplies)
                    AppBadge(
                      s,
                      background: AppColors.slate100,
                      foreground: AppColors.slate500,
                      fontSize: AppText.xxs,
                      uppercase: false,
                    ),
                ],
              ),
            ],
            if (encounter.followUpSet) ...[
              const SizedBox(height: AppSpace.x3),
              Container(
                padding: const EdgeInsets.all(AppSpace.x2),
                decoration: BoxDecoration(
                  color: AppColors.blue50,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(color: AppColors.blue100),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(
                          LucideIcons.calendar,
                          size: 10,
                          color: AppColors.blue600,
                        ),
                        const SizedBox(width: AppSpace.x1),
                        const Text(
                          'SCHEDULED FOLLOW-UP',
                          style: TextStyle(
                            fontSize: AppText.tiny,
                            fontWeight: AppText.bold,
                            color: AppColors.blue600,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpace.x1),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          encounter.followUpDate == null
                              ? '—'
                              : Fmt.isoDate(encounter.followUpDate!),
                          style: const TextStyle(
                            fontSize: AppText.micro,
                            fontWeight: AppText.bold,
                            color: AppColors.blue900,
                          ),
                        ),
                        Flexible(
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(
                                LucideIcons.mapPin,
                                size: 10,
                                color: AppColors.blue700,
                              ),
                              const SizedBox(width: 2),
                              Flexible(
                                child: Text(
                                  encounter.followUpLoc ?? '',
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: AppText.micro,
                                    color: AppColors.blue700,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpace.x1),
              AppBadge.outline(
                'Follow-up Required',
                color: AppColors.blue600,
                border: AppColors.blue200,
                fill: AppColors.blue50,
                fontSize: AppText.xxs,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
