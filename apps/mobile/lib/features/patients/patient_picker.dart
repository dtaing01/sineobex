import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/transport.dart' show ApiException;
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../patients/patient_providers.dart';
import '../../patients/patient_search.dart';
import '../../sync/local_store.dart' show ChartingPaused;
import 'patient_row.dart';
import 'patient_widgets.dart';

/// Finds the patient a refused record should belong to (Needs attention, **Attach to another
/// patient**, design 2.6). Each search is a run of its own, audited like the Patients tab's.
/// Returns the chosen patient's ID, or null.
Future<String?> pickPatient(BuildContext context, PatientServices services, {required DateTime today}) =>
    showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _PickerSheet(services: services, today: today),
    );

class _PickerSheet extends StatefulWidget {
  const _PickerSheet({required this.services, required this.today});
  final PatientServices services;
  final DateTime today;

  @override
  State<_PickerSheet> createState() => _PickerSheetState();
}

class _PickerSheetState extends State<_PickerSheet> {
  final _query = TextEditingController();
  SearchRun? _run;
  String? _problem;
  int _seq = 0;

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final seq = ++_seq;
    try {
      final run = await widget.services.search.search(_query.text);
      if (mounted && seq == _seq) {
        setState(() {
          _run = run;
          _problem = null;
        });
      }
    } on ChartingPaused catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } on ApiException {
      if (mounted) setState(() => _problem = 'Search isn’t available right now. Try again in a moment.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final hits = _run?.hits ?? const <FoundPatient>[];
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
          children: [
            Semantics(
              header: true,
              child: Text('Attach to another patient', style: Theme.of(context).textTheme.titleLarge),
            ),
            const SizedBox(height: FieldSpace.s3),
            PhiField(
              name: 'attachSearch',
              label: 'Search by name, street name or what they look like',
              controller: _query,
              textInputAction: TextInputAction.search,
              prefixIcon: const Icon(LucideIcons.search),
              onSubmitted: (_) => unawaited(_search()),
            ),
            const SizedBox(height: FieldSpace.s2),
            OutlinedButton(onPressed: () => unawaited(_search()), child: const Text('Search')),
            const SizedBox(height: FieldSpace.s3),
            if (_problem != null) ErrorMessage(_problem!),
            if (_run != null)
              Semantics(
                liveRegion: true,
                child: Text(
                  hits.isEmpty
                      ? 'No one found.'
                      : '${hits.length == 1 ? '1 patient' : '${hits.length} patients'} found',
                ),
              ),
            for (final p in hits) ...[
              const SizedBox(height: FieldSpace.s2),
              PatientRow(patient: p, today: widget.today, onTap: () => Navigator.of(context).pop(p.patientId)),
            ],
          ],
        ),
      ),
    );
  }
}
