import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/tokens.dart';
import '../../encounters/encounter_services.dart';
import 'encounter_labels.dart';
import 'encounter_widgets.dart' show ChoiceTile;

/// The tab bar's **Start (+)** (lifecycle 9.2, PRD main 743): the ways to begin work. In phase 4 one
/// choice, **New encounter**; Quick check-in and Scan ID link arrive in phase 9, and Brief call
/// note is PLAN-OPEN 12.1 #14.
Future<void> showStartSheet(BuildContext context) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => StartSheet(router: GoRouter.of(context)),
);

class StartSheet extends ConsumerWidget {
  const StartSheet({super.key, required this.router});

  /// The app's router, from under the sheet: a choice closes the sheet, then opens its screen.
  final GoRouter router;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final services = ref.watch(encounterServicesProvider);
    // A role without `encounters.chart` starts no visit: the choice says why instead (6.1).
    final charts = services?.user.charts ?? false;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(header: true, child: Text(startSheetHeading, style: Theme.of(context).textTheme.titleLarge)),
            const SizedBox(height: FieldSpace.s3),
            ChoiceTile(
              icon: LucideIcons.clipboardPlus,
              label: newEncounterAction,
              line: charts ? newEncounterLine : notCharting,
              onTap: charts
                  ? () {
                      Navigator.of(context).pop();
                      unawaited(router.push('/encounters/new'));
                    }
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}
