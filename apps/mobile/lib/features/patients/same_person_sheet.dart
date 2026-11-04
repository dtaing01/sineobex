import 'package:flutter/material.dart';

import '../../design/tokens.dart';
import '../../patients/dob.dart';
import '../../patients/patient_search.dart';
import 'patient_row.dart';

/// What the Create sheet answers.
enum SamePersonAnswer { open, createNew }

/// On Create with a likely match still showing (design 8.1): one question, focus on its heading,
/// **Open Del's chart** first, **No, create a new patient** second, both full width. Back closes it
/// with nothing done (null).
Future<SamePersonAnswer?> askSamePerson(BuildContext context, FoundPatient p, DateTime today) =>
    showModalBottomSheet<SamePersonAnswer>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SamePersonSheet(patient: p, today: today),
    );

class SamePersonSheet extends StatelessWidget {
  const SamePersonSheet({super.key, required this.patient, required this.today});
  final FoundPatient patient;
  final DateTime today;

  /// "Is this Del, born March 7, 1946, usually by the Elm St underpass?"
  String get question {
    final p = patient;
    return '${[
      'Is this ${listName(p)}',
      if (p.birth case final b?)
        switch (b) {
          BirthDate(:final year, :final month, :final day) => 'born ${monthNames[month - 1]} $day, $year',
          BirthYear(:final year) => 'born in $year',
          BirthEstimate() => 'about ${ageOn(b, today)}',
        },
      if (p.usualArea != null) 'usually ${p.usualArea}',
    ].join(', ')}?';
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Focus(
              autofocus: true,
              child: Semantics(header: true, child: Text(question, style: text.titleLarge)),
            ),
            const SizedBox(height: FieldSpace.s2),
            Text('A chart that looks like the same person is already on the list.', style: text.bodyLarge),
            const SizedBox(height: FieldSpace.s4),
            SizedBox(
              height: FieldTap.large,
              child: FilledButton(
                onPressed: () => Navigator.of(context).pop(SamePersonAnswer.open),
                child: Text('Open ${listName(patient)}’s chart'),
              ),
            ),
            const SizedBox(height: FieldSpace.s2),
            SizedBox(
              height: FieldTap.large,
              child: OutlinedButton(
                onPressed: () => Navigator.of(context).pop(SamePersonAnswer.createNew),
                child: const Text('No, create a new patient'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
