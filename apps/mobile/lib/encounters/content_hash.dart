/// The hash a sign-off carries (phase 4 design, lifecycle 4.5): what the person saw when they
/// pressed Complete, which the server works out again over what it holds and refuses the sign-off
/// with content_changed when the two differ. Pure: no database, no clock, no network.
///
/// The server's services/api/src/encounters/content-hash.ts gives the same hash, and both are
/// pinned by packages/contract/test-vectors/note-content-hash.json.
library;

import '../forms/conditions.dart';
import '../forms/definition.dart';
import '../forms/effective.dart';
import '../sync/canonical_json.dart';

/// What is hashed. The patient ([patientId], the encounter's, or null) and the [summary] (the
/// encounter's, or null) are on the screen where Complete is pressed, so a visit moved to another
/// patient, or a summary rewritten, before the server holds the sign-off refuses it. The answers
/// are only those that count: a signer is never shown an answer in a hidden field or a removed
/// entry, and a field cleared is a field never touched (effectiveAnswers leaves blanks out). The
/// note type's key and version are [definition]'s, the note's own version. Not in it: the kind,
/// addenda, later corrections, the time, the device.
Map<String, Object?> noteContent({
  required String noteId,
  required String encounterId,
  required String? patientId,
  required String? summary,
  required NoteTypeDef definition,
  required Answers answers,
}) => {
  'v': 1,
  'noteId': noteId,
  'encounterId': encounterId,
  'patientId': patientId,
  'noteTypeKey': definition.key,
  'noteTypeVersion': definition.version,
  'summary': summary,
  'answers': effectiveAnswers(definition, answers),
};

/// Lowercase hex SHA-256 of [noteContent]'s canonical JSON: the change hashes' own functions.
String noteContentHash({
  required String noteId,
  required String encounterId,
  required String? patientId,
  required String? summary,
  required NoteTypeDef definition,
  required Answers answers,
}) => valueHash(
  noteContent(
    noteId: noteId,
    encounterId: encounterId,
    patientId: patientId,
    summary: summary,
    definition: definition,
    answers: answers,
  ),
);
