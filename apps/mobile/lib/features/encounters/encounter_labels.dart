import '../../api/transport.dart' show NetworkException;
import '../../encounters/encounter_api.dart' show EncounterRequestFailed;
import '../../encounters/encounter_models.dart';
import '../../sync/local_store.dart' show ChartingPaused, LocalValidationError, RecordLocked;

/// Words for the encounter screens (phase 4 design, lifecycle 9). Fixed strings keyed by state and
/// problem code: a patient's details appear only where a screen shows that patient, never in a
/// title, a toast or an error. A refusal of the domain layer (`apps/mobile/lib/encounters/`) is shown
/// in its own words ([encounterErrorText]); these are the sentences the screens add.

// ---- titles: fixed, never a patient detail (10.2) ----

const newEncounterTitle = 'New encounter';
const encounterTitle = 'Encounter';
const noteTypesTitle = 'Note types';
const noteTitle = 'Note';
const summaryTitle = 'Summary';
const handoffTitle = 'EMS handoff';

// ---- Start (9.2) ----

const startTabLabel = 'Start';
const startSheetHeading = 'Start';
const newEncounterAction = 'New encounter';
const newEncounterLine = 'Chart a visit, with or without a registered patient.';

// ---- New encounter: Who and Where (9.2, 3.10) ----

/// "Step 1 of 3": where the person is in New encounter.
String stepText(int step, int of) => 'Step $step of $of';

const whoHeading = 'Who is this visit for?';
const patientSearchLabel = 'Search by name, street name or what they look like';
const searchAction = 'Search';
const showMoreAction = 'Show more';
const narrowSearch = 'More people match. Add letters to narrow it down.';
const searchUnavailable = 'Search isn’t available right now. Try again in a moment.';
const noPatientRecords = 'Your role in this team doesn’t include patient records.';

/// The count a search run found, said once per run.
String foundText(int count, {required bool onPhone}) => count == 0
    ? (onPhone ? 'No one found on this phone.' : 'No one found.')
    : '${count == 1 ? '1 patient' : '$count patients'} found${onPhone ? ' on this phone' : ''}';

const newPatientAction = 'New patient';
const newPatientLine = 'Register them, then start the visit from their chart.';
const noPatientAction = 'No patient';
const noPatientLine = 'For someone who’d rather not be registered. The visit takes Non-Medical notes only.';

const whereHeading = 'Where';

/// The place's field (`locationText`): the design's words.
const whereLabel = 'Where are you?';
const whereHelper = 'Optional';

// ---- Use my location (9.2, 12.1 #15): the place is never shown, only whether there is one ----

const useMyLocationAction = 'Use my location';
const findingLocation = 'Finding where you are…';
const stillFindingLocation = 'Still finding where you are. If you choose now, the visit starts without it.';
const findingBeforeStart = 'Finding where you are. If you start the visit now, it starts without it.';
const locationAdded = 'Your location is added.';
const locationRough = 'Your phone could tell only roughly where you are.';
const removeLocationAction = 'Remove';
const removeLocationSpoken = 'Remove my location';
const locationNotAllowed = 'You didn’t allow your location. Type the place instead.';
const locationBlocked =
    'Your phone doesn’t let this app use your location. Allow it in your phone’s settings, or type the place.';
const locationOff = 'Location is off on this phone. Turn it on in your phone’s settings, or type the place.';
const locationNotFound = 'Your phone couldn’t find where you are. Try again, or type the place.';
const locationUnavailable = 'Your location isn’t available on this phone. Type the place instead.';
const openSettingsAction = 'Open phone settings';

/// Who the visit is for, above Where.
String forPatientText(String name) => 'For $name';
const noPatientText = 'No patient';
const changePatientAction = 'Change';
const changePatientSpoken = 'Change who this visit is for';
const nextAction = 'Next';
const startVisitAction = 'Start the visit';

/// A patient with no name the phone can show: the chart's own words for it.
const noNameRecorded = 'No name recorded';

// ---- Medical or Non-Medical (9.3) ----

const kindHeading = 'Medical or Non-Medical';

/// The two kinds in words, on a button and as a visit's kind.
String kindText(VisitKind kind) => switch (kind) {
  VisitKind.medical => 'Medical',
  VisitKind.nonMedical => 'Non-Medical',
};

/// The line under each kind's button, as the design gives it (PRD main 379). The button reads the
/// whole line; it shows the kind above the rest of it.
String kindLine(VisitKind kind) => switch (kind) {
  VisitKind.medical => 'Medical: clinical notes, orders, signing',
  VisitKind.nonMedical => 'Non-Medical: outreach, supplies, social needs',
};

/// [kindLine] without its kind, for under the kind's name on the button.
String kindDetail(VisitKind kind) {
  final line = kindLine(kind).substring(kindText(kind).length + 2);
  return line[0].toUpperCase() + line.substring(1);
}

/// After `medical_note_needs_patient`: back to Who.
const choosePatientAction = 'Choose the patient';

const switchToMedicalAction = 'Switch to Medical';
const switchToMedicalTitle = 'Switch this visit to Medical?';
const switchToMedicalBody = 'The notes and their answers stay as they are. A visit can’t be switched back.';
const switchedToMedical = 'Switched to Medical';

/// Switch to Medical on a visit with no patient asks who first (3.10).
const switchNeedsPatient = 'A Medical visit needs a patient.';

// ---- The encounter screen (9.4) ----

/// The visit's kind in its header.
String visitKindText(VisitKind kind) => '${kindText(kind)} visit';

/// The place typed at Start.
String whereText(String place) => 'Where: $place';

/// A record made here that the server hasn't confirmed: phase 3's words.
const onThisPhoneOnly = 'On this phone only';

const notesHeading = 'Notes';
const chooseNoteTypeHeading = 'Choose a note type';
const addAnotherNoteType = 'Add another note type';

/// A teammate's note, named by the name its record carries (D108).
String byText(PersonRef person) => 'By ${personText(person)}';

/// Someone a record names; "a teammate" while the phone doesn't know the name (lifecycle 9.7).
String personText(PersonRef person) => person.name ?? 'a teammate';

/// The note's menu button, read with its note type.
String noteMenuSpoken(String title) => 'More for $title';
const removeNoteAction = 'Remove this note';
const removeNoteTitle = 'Remove this note?';
const removeNoteBody = 'Every answer in it is cleared, and the note counts for nothing.';
const removeNoteYes = 'Remove';
const noteRemoved = 'Note removed';

/// A note with no title the phone can show: its definition isn't here, and the server gave none.
const untitledNote = 'A note';

const visitNotOnPhone = 'This visit isn’t on this phone. Connect to open it.';

// ---- Note types (9.4) ----

/// A type the visit already has a draft of: tapping it opens that draft (`addNote`).
const draftOpensLine = 'A draft of this is in the visit. Tapping it opens the draft.';
const addAnotherAction = 'Add another';

/// [addAnotherAction], read with its note type.
String addAnotherSpoken(String title) => 'Add another $title';

/// A Non-Medical visit, to someone who may chart Medical notes: why no clinical type is listed.
const clinicalNeedsMedical = 'For clinical notes, switch this visit to Medical.';

/// No list on the phone yet: the domain layer's words for it (`no_red_flags_type`).
const noNoteTypes = 'Connect once to load your team’s note types.';

/// A role without `encounters.chart`: the domain layer's words for it (`not_charting`).
const notCharting = 'Your role doesn’t chart visits.';

// ---- The note form (9.5) ----

const saveAndCloseAction = 'Save & Close';
const continueAction = 'Continue';
const noteNotOnPhone = 'This note isn’t on this phone. Connect to open it.';

/// A note whose own version's form the phone lacks: the domain layer's words for it.
const noteFormNotOnPhone = 'This note’s form isn’t on this phone yet. Connect to load it, then try again.';

/// Above a form the person may read but not change now.
const readOnlyNote = 'You can read this note. It can’t be changed here.';
const addedToProblemList = 'Added to the problem list';

/// After Expand, when some quick answers weren't carried (forms 6.4, 10.1 #12).
const notCopiedTitle = 'Some answers weren’t copied';

/// The quick fields' labels, one to a line, then why.
String notCopiedBody(List<String> labels) =>
    '${labels.join('\n')}\n\nThe full note doesn’t take them as they are. They stay in the quick note.';
const notCopiedOk = 'Open the note';

// ---- The summary (9.6) ----

const notesToCompleteHeading = 'Notes';

/// A note of the person's own with no answer yet (their Red flags note, added by the app).
const noAnswersYet = 'No answers yet.';
const assessmentHeading = 'Assessment';
const assessmentLabel = 'Assessment';
const addToAssessmentLabel = 'Add to the assessment';

/// Under the locked assessment: what is added goes with Complete as an addendum to the visit (9.6).
const addToAssessmentHelp = 'The assessment is locked once a note is finished. What you add here is kept with it.';
const suggestionsHeading = 'Suggested next steps';

/// A suggestion chip, read with what it does.
String suggestionSpoken(String title) => 'Add $title';
const addReferralAction = 'Add referral';
const followUpHeading = 'Follow-up';
const noFollowUp = 'No follow-up recorded yet.';
const stopsHeading = 'Before you complete';

/// A line of what stops Complete is a button that opens the note there.
const stopOpensHint = 'Opens the note';

/// "{name}'s note stays a draft until they complete it." (9.6), a teammate unnamed as "A teammate".
String teammateDraftText(PersonRef author) => author.name == null
    ? 'A teammate’s note stays a draft until they complete it.'
    : '${author.name}’s note stays a draft until they complete it.';

/// The person's own note held for a Program Admin: not completed (3.3 as built).
String sentForReviewText(String title) => '$title: sent to a Program Admin for review.';

/// The Complete button, worded by what will happen (3.3).
const completeAction = 'Complete';
const completeAndSignAction = 'Complete and sign';
const completeAndSendAction = 'Complete and send for co-signature';

// ---- The EMS handoff (9.8) ----

const handoffDone = 'Done';
const handoffRecapHeading = 'Recap';

/// Who the handoff is about, as the portal's file words it (lifecycle 5.7, 12.1 #27).
const handoffNoPatient = 'No patient recorded';
const ageNotRecorded = 'Age not recorded';

/// Nothing for EMS: no note of this visit has an answer EMS may be shown.
const handoffNothing = 'Nothing in this visit is for EMS yet.';

// ---- The visit (9.7) ----

const visitTitle = 'Visit';

/// When the visit started, on this phone's clock, as the read view words a time ("November 2, 2026
/// at 10:00 AM"), and "time not verified" when the phone's clock wasn't checked (3.11).
String startedText(String when) => 'Started $when';
const timeNotVerified = 'time not verified';

/// A time a record carries, with "time not verified" when it wasn't checked.
String whenText(String date, String time, {required bool verified}) =>
    '$date at $time${verified ? '' : ', $timeNotVerified'}';

const visitAddendaHeading = 'Added to the visit';

/// A draft the person may change opens as its form (9.7).
const openNoteAction = 'Open the note';

/// [openNoteAction], read with its note type.
String openNoteSpoken(String title) => 'Open the note, $title';

const addAddendumAction = 'Add addendum';

/// [addAddendumAction], read with what it is added to.
String addAddendumSpoken(String title) => 'Add addendum to $title';
const addVisitAddendumSpoken = 'Add addendum to the visit';
const reopenAction = 'Reopen';

/// [reopenAction], read with its note type.
String reopenSpoken(String title) => 'Reopen $title';
const reopenTitle = 'Reopen this note?';
const reopenBody = 'It goes back to a draft you can change. Complete it again when it’s ready.';
const reopenYes = 'Reopen';
const correctAction = 'Correct';

/// [correctAction] under an answer, read with the answer's labels.
String correctSpoken(String labels) => 'Correct $labels';

/// Who a record names, and their credential in words where this app knows it.
String whoText(PersonRef person, String? credentialWords) => [personText(person), ?credentialWords].join(', ');

/// A sign-off below its note (9.7): Complete, a signature, a co-signature, by what it did as the
/// server stored it, or by what was asked while it waits here.
String signoffText({required String act, required String? effect, required String who, required String? when}) {
  final at = when == null ? '' : ', $when';
  return switch ((act, effect)) {
    (_, 'none') => 'Completed again by $who$at. The note was already finished, so nothing changed.',
    ('cosign', _) => 'Co-signed by $who$at',
    (_, 'signed') || ('sign', null) => 'Signed by $who$at',
    _ => 'Completed by $who$at',
  };
}

/// An attending's attestation below the signature it attests (9.7).
String attestedText({required String who, required String when}) => 'Attested by $who, $when';

/// An addendum's line, above its text.
String addendumByText({required String who, required String? when}) =>
    'Addendum by $who${when == null ? '' : ', $when'}';

/// A correction below its note (3.6, 9.7): the old values are struck through in the note itself;
/// this says who, when, what and why, by what the server decided, or as asked while it waits here.
String correctionText({
  required String? outcome,
  required bool requestedByPatient,
  required bool declined,
  required String who,
  required String? when,
  required List<String> answers,
}) {
  final at = when == null ? '' : ', $when';
  final what = answers.isEmpty ? '' : ': ${answers.join('; ')}';
  if (declined || outcome == 'declined') {
    final asked = answers.isEmpty ? 'an answer' : answers.join('; ');
    return 'The patient asked to change $asked. Declined by $who$at.';
  }
  return switch (outcome) {
    'no_change' => 'Correction by $who$at: nothing changed.',
    'draft_edit' => 'Changed in the draft by $who$at$what',
    'not_author' => 'Correction by $who$at: not made, as only the note’s author can correct it.',
    _ when requestedByPatient => 'Corrected at the patient’s request by $who$at$what',
    _ => 'Corrected by $who$at$what',
  };
}

/// A correction's reason, or an addendum's text, below its line.
String reasonText(String reason) => 'Reason: $reason';

/// A record made here that the server refused: it waits in Needs attention.
const inNeedsAttention = 'In Needs attention';

const madeAtVisitHeading = 'Made at this visit';

/// A record made at the visit whose visit has moved to someone else since (8.4, 12.1 #25): it stays
/// on the first chart, where it can be entered in error.
const onAnotherChartNow = 'On another chart now';
const enteredInErrorText = 'Entered in error';
String referralMadeText(String date, String details) => 'Referral, $date: $details';
String problemMadeText(String title) => 'Problem: $title';
String allergyMadeText(String substance) => 'Allergy: $substance';
String problemNoteMadeText(String problem, String text) => 'Note on $problem: $text';

/// A problem's note whose problem the read doesn't name.
const aProblem = 'a problem';

/// A record row opens where it can be entered in error.
const recordOpensHint = 'Opens where it can be entered in error';

// ---- Co-sign and Attest (3.7, 9.7, 9.9) ----

const cosignAction = 'Co-sign';
const attestAction = 'Attest';

/// Offline, the button greyed (9.7).
const connectToCosign = 'Connect to co-sign';
const connectToAttest = 'Connect to attest';
const cosignedDone = 'Co-signed';
const attestedDone = 'Attested';

/// After the visit was read from the server for a co-sign or an attestation: what is signed is what
/// the person now reads (lifecycle 5 as built).
String readThenText(String act) => 'This is the visit as it is now. Read it, then ${act.toLowerCase()}.';

// ---- The addendum sheet (3.6, 9.7) ----

/// Most characters an addendum holds (3.6).
const addendumMax = 4000;
const addendumLabel = 'Addendum';

/// What the addendum goes below.
String addendumToText(String title) => 'To $title';
const addendumToVisit = 'To the visit';
const addendumAdded = 'Addendum added';

/// A box's count, as the referral sheet counts its details.
String charactersText(String count, String of) => '$count of $of characters';

// ---- The correction sheet (3.6, 9.7) ----

const correctionTitle = 'Correct this note';

/// The answer as the note has it now, or none.
String nowText(String? value) => 'Now: ${value ?? noAnswerNow}';
const noAnswerNow = 'No answer';
const correctionReasonLabel = 'Reason';

/// Most characters a correction's reason holds (3.6).
const correctionReasonMax = 500;
const correctAnotherAction = 'Correct another answer';
const whichAnswerHeading = 'Which answer?';
const removeAnswerAction = 'Remove';

/// [removeAnswerAction], read with the answer it takes out of the correction.
String removeAnswerSpoken(String labels) => 'Remove $labels from this correction';
const patientAskedLabel = 'The patient asked for this change';
const saveCorrectionAction = 'Save the correction';
const makeChangeAction = 'Make the change';
const recordDeclinedAction = 'Record that it was declined';
const correctionSaved = 'Correction saved';
const declinedRecorded = 'Declined request recorded';
const changeAnAnswerFirst = 'Change an answer first.';
String tooManyChanges(int max) => 'A correction can change up to $max answers.';

/// Answers the domain layer named as needed once the change is made (`incomplete`).
const neededTooHeading = 'Needed with this change';

/// An answer whose field this phone can't draw: its form is a newer one.
const cantChangeHere = 'This answer can’t be changed on this phone.';

// ---- Referrals (7, 9.10) ----

const referralsHeading = 'Referrals';
const noReferrals = 'No referrals recorded.';

/// Who recorded a referral: a name only where the phone knows one (7 as built), else "a teammate".
String recordedByText(PersonRef person) => 'Recorded by ${personText(person)}';

/// A referral made at a visit of this chart's patient (8.4 as built).
const atAVisit = 'At a visit';
const referralInErrorAction = 'Entered in error';

/// [referralInErrorAction], read with the referral's date.
String referralInErrorSpoken(String date) => 'Mark the referral of $date entered in error';
const referralInErrorTitle = 'Mark this referral entered in error?';
const referralInErrorBody = 'It stays in the list, struck through, with your reason.';
const referralInErrorYes = 'Mark entered in error';
const referralInErrorQuick = ['Wrong patient', 'Typed by mistake', 'Not referred after all'];
const referralMarked = 'Marked entered in error';

/// A referral's mark, under it, as phase 3 words an allergy's.
String inErrorText(String reason) => 'Entered in error: $reason';

/// A referral as one row reads it: its date, its details, then the rest.
String referralSpoken({required String date, required String details, required List<String> rest}) =>
    ['Referral, $date: $details', ...rest].join('. ');

// ---- The profile: + Encounter, + Referral and the timeline (9.1) ----

/// The quick actions' words; each is read as what it opens.
const encounterQuickAction = 'Encounter';
const encounterQuickSpoken = 'New encounter';
const referralQuickAction = 'Referral';
const referralQuickSpoken = 'Add a referral';

const timelineHeading = 'Timeline';

/// The type filter's chips, in the PRD's order (PRD main 725).
String timelineGroupText(String group) => switch (group) {
  'clinical' => 'Clinical',
  'psych' => 'Psych',
  'social' => 'Social',
  'referrals' => 'Referrals',
  'outreach' => 'Outreach',
  'harm_reduction' => 'Harm reduction',
  'wound' => 'Wound',
  _ => group,
};
const timelineFilterSpoken = 'Show only';
const noTimeline = 'No visits or referrals yet.';
const noTimelineFiltered = 'Nothing of these types.';

/// A chart opened from the team's list, with no timeline of its own (5.2 as built).
const timelineNeedsChart = 'Visits recorded elsewhere show with the full chart.';
const showEarlierVisits = 'Show earlier visits';

/// A visit made here whose time the phone hasn't learned yet.
const startedHere = 'Started on this phone';

/// A note of a visit's row: its type and its state in words (9.1).
String noteChipText(String title, String state) => '$title: $state';

/// A visit's row opens the visit (9.7).
const visitOpensHint = 'Opens the visit';

/// A referral's row opens the Referrals sheet, where it can be entered in error.
const referralOpensHint = 'Opens the referrals';

// ---- Home's tiles (9.9) ----

const notesToFinishTitle = 'Notes to finish';

/// "3 notes to finish. 1 is older than a day." (9.9).
String notesToFinishText(int notes, int overdue) {
  final first = '$notes ${notes == 1 ? 'note' : 'notes'} to finish.';
  if (overdue == 0) return first;
  return '$first $overdue ${overdue == 1 ? 'is' : 'are'} older than a day.';
}

const cosignQueueTitle = 'Waiting for your co-signature';
const attestationQueueTitle = 'Waiting for attestation';

/// A queue's number on its tile: visits, as the server counts them (5.6).
String visitsWaitingText(int visits) => switch (visits) {
  0 => 'None waiting',
  1 => '1 visit',
  _ => '$visits visits',
};

/// A queue's tile offline (9.9).
const connectForQueueTile = 'Connect to see notes waiting for you';

// ---- Notes to finish (9.9) ----

/// When the note's visit started; the phone's clock, as the read view words a time.
String visitStartedText(String when) => 'Visit started $when';
const startNotKnown = 'Start not known yet';
const olderThanADay = 'Older than a day';

/// A draft the server listed that isn't on this phone: it opens only with signal (9.9).
const opensWithConnection = 'Opens with a connection';
const noNotesToFinish = 'No notes to finish.';

/// The server's list wasn't merged in: drafts kept on another phone aren't counted.
const onlyThisPhone = 'Showing the notes on this phone. Connect to see the rest.';

// ---- The queues (5.4, 9.9) ----

const noVisitsWaiting = 'No visits waiting.';
const tryAgainAction = 'Try again';

/// A waiting note in a queue row: its type, by whom, when completed.
String queueNoteText(String title, PersonRef author) => '$title, by ${personText(author)}';

/// Who signed it before a correction sent it back (3.7).
String signedBeforeText(PersonRef person) => 'Signed before by ${personText(person)}';

/// Who attested it before.
String attestedBeforeText(PersonRef person) => 'Attested before by ${personText(person)}';

/// A note the person can't act on (`canAct` false, 5.4): theirs, or one with a part they can't open.
const youWroteThis = 'You wrote this note.';
String cantActText(String act) => 'You can’t ${act.toLowerCase()} this note. Open the visit to see why.';

// ---- A note's state (lifecycle 3.1, 9.1) ----

/// Lifecycle 3.1's first column, as the timeline words it (9.1).
String noteShownText(NoteShown shown) => switch (shown) {
  NoteShown.draft => 'Draft',
  NoteShown.complete => 'Complete',
  NoteShown.waitingForCosigner => 'Waiting for a co-signer',
  NoteShown.signed => 'Signed',
  NoteShown.waitingForAttestation => 'Waiting for attestation',
  NoteShown.attested => 'Attested',
};

const waitingToSend = 'Waiting to send';
const sentForReview = 'Sent for review';

/// A note's state as the phone knows it (9.1 as built): "Sent for review" while a Program Admin
/// decides, "Waiting to send" until its sign-off is confirmed, else [noteShownText].
String noteStateText(NoteView note) => note.sentForReview
    ? sentForReview
    : note.waitingToSend
    ? waitingToSend
    : noteShownText(note.shown);

// ---- Refusals ----

/// The store's sentence while the clock check fails (`ChartingPaused`, D35): Start says why before
/// anything is pressed. test/features/encounters/encounter_labels_test.dart holds it to the store's.
const chartingPaused = 'Charting is paused until the phone’s clock is right.';

/// The store's lock on a note finished as this phone knows it, in Complete's words for it.
const noteFinished = 'This note is already finished.';

const needsConnection = 'This needs a connection. Try again when the phone is online.';
const didNotWork = 'That didn’t work. Try again.';

/// What a screen shows when the domain layer refuses: its own sentence, as it gives it, for every
/// refusal that has one; the store's lock and a lost connection in the screens' words; anything else
/// as a fault to try again. Never a value or a patient detail.
String encounterErrorText(Object error) => switch (error) {
  LocalValidationError(:final message) => message,
  ChartingPaused(:final message) => message,
  EncounterRequestFailed(:final message) => message,
  RecordLocked() => noteFinished,
  NetworkException() => needsConnection,
  _ => didNotWork,
};

/// The domain layer's problem code of [error], if it names one (`medical_note_needs_patient`, ...).
String? problemOf(Object error) => error is LocalValidationError ? error.problem : null;
