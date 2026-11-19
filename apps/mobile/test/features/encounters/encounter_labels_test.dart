import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/transport.dart' show NetworkException;
import 'package:sineobex_field/encounters/encounter_api.dart' show EncounterProblem, EncounterRequestFailed;
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/features/encounters/encounter_labels.dart';
import 'package:sineobex_field/sync/local_store.dart' show ChartingPaused, LocalValidationError, RecordLocked;

/// The encounter screens' words (lifecycle 9; card L5-labels): a word for every state a note can
/// be shown in, a kind's line as the design gives it, the domain layer's refusals shown in its own
/// words, and nothing worded with a straight apostrophe.
void main() {
  test('every state a note is shown in has its own words, as lifecycle 3.1 and 9.1 give them', () {
    expect(
      {for (final s in NoteShown.values) s: noteShownText(s)},
      {
        NoteShown.draft: 'Draft',
        NoteShown.complete: 'Complete',
        NoteShown.waitingForCosigner: 'Waiting for a co-signer',
        NoteShown.signed: 'Signed',
        NoteShown.waitingForAttestation: 'Waiting for attestation',
        NoteShown.attested: 'Attested',
      },
    );
  });

  test('each kind’s line is the design’s, and the button shows it under the kind’s name', () {
    expect(kindLine(VisitKind.medical), 'Medical: clinical notes, orders, signing');
    expect(kindLine(VisitKind.nonMedical), 'Non-Medical: outreach, supplies, social needs');
    expect(kindDetail(VisitKind.medical), 'Clinical notes, orders, signing');
    expect(kindDetail(VisitKind.nonMedical), 'Outreach, supplies, social needs');
    expect([for (final k in VisitKind.values) visitKindText(k)], ['Medical visit', 'Non-Medical visit']);
  });

  test('a person the phone can’t name is a teammate', () {
    expect(byText(const PersonRef('b')), 'By a teammate');
    expect(byText(const PersonRef('b', name: 'Demo Blair')), 'By Demo Blair');
  });

  test('a refusal is shown in the domain layer’s own words; the lock and a lost connection in the screens’', () {
    const refusal = LocalValidationError(
      'A clinical note needs a patient. Choose who this visit is for.',
      problem: 'medical_note_needs_patient',
    );
    expect(encounterErrorText(refusal), refusal.message);
    expect(problemOf(refusal), 'medical_note_needs_patient');
    expect(encounterErrorText(const ChartingPaused(chartingPaused)), chartingPaused);
    expect(
      encounterErrorText(const EncounterRequestFailed(EncounterProblem.offline, 'Connect to co-sign.')),
      'Connect to co-sign.',
    );
    expect(encounterErrorText(const RecordLocked()), 'This note is already finished.');
    expect(encounterErrorText(const NetworkException('offline')), needsConnection);
    expect(encounterErrorText(StateError('a fault')), 'That didn’t work. Try again.');
    expect(problemOf(const RecordLocked()), isNull);
  });

  test('the words use curly apostrophes, as the existing copy does', () {
    // Every string is in single quotes, which hold a straight apostrophe only escaped.
    final code = [
      for (final line in File('lib/features/encounters/encounter_labels.dart').readAsLinesSync())
        if (!line.trim().startsWith('//')) line,
    ];
    expect(code.where((l) => l.contains('"') || l.contains(r"\'")), isEmpty);
  });
}
