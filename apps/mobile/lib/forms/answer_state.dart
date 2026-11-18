/// What a note form has of each answer, and where a change goes (phase 4 design, forms 8.1): the
/// types the domain layer gives the form (`NoteView.conflicts`) and the form's field host draws.
/// Plain Dart, so the domain layer imports no widget library; `field_host.dart` exports them.
library;

/// What the form has of one answer.
class AnswerState {
  const AnswerState({this.value, this.pending = false, this.conflict});

  /// As stored: what JSON decodes.
  final Object? value;

  /// Saved on this phone and not yet confirmed by the server.
  final bool pending;
  final AnswerConflict? conflict;
}

/// Who holds the other value of a conflict, in phase 2's words.
enum ConflictBy { teammate, youElsewhere, server }

/// Two people changed one answer: the value on the server beside the one on this phone, until the
/// person chooses (the draft rule, lifecycle 1.2; phase 2's choice, PRD main 100).
class AnswerConflict {
  const AnswerConflict({required this.theirs, required this.by, this.mine, this.at, this.onChoose});

  /// The value on the server.
  final Object? theirs;

  /// "Your value": what **Use my value** sends (the store's `myValue`, as Needs attention shows it),
  /// a cleared answer being `(value: null)`. It differs from the answer the field shows once the
  /// person kept theirs and the value moved on again: the field shows the value kept, and the choice
  /// carries their own. Null: the answer the field shows.
  final ({Object? value})? mine;
  final ConflictBy by;
  final DateTime? at;

  /// True keeps the value on this phone. Null while the person can't choose (charting is paused
  /// for the phone's clock).
  final Future<void> Function(bool keepMine)? onChoose;
}

/// The answers of the note open in the form, by path (entry part included), and where a change
/// goes. The form gives one; a widget's change reaches it as `change(path, value)`, `null` being
/// the clear of an answer.
abstract interface class FormAnswers {
  AnswerState at(String path);
  void change(String path, Object? value);
}
