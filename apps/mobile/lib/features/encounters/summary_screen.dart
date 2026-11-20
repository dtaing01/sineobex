import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app_providers.dart' show syncControllerProvider;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../encounters/encounter_models.dart';
import '../../encounters/encounter_repository.dart' hide Expanded;
import '../../encounters/encounter_services.dart';
import '../../forms/definition.dart';
import '../../forms/effective.dart' show effectiveAnswers;
import '../../forms/layout.dart' show layOut;
import '../../forms/suggestions.dart';
import '../../sync/local_store.dart' show ChartingPaused;
import '../forms/text_field.dart' show NoteTextField, ReadOnlyAnswer;
import '../../sync/canonical_json.dart' show canonicalJson;
import '../patients/patient_widgets.dart' show SectionHeading, WideButton, confirm;
import 'encounter_labels.dart';
import 'encounter_widgets.dart';
import 'note_type_list.dart' show noteLocation;
import 'referrals_sheet.dart';

/// Most characters the assessment holds, and what is added to it once locked (lifecycle 9.6).
const assessmentMax = 4000;

/// "Every encounter ends on a summary screen" (lifecycle 9.6, PRD main 433). From the top: the recap
/// of each note Complete will finish, under its type's name, from Complete's plan (`openComplete`),
/// whose hashes Complete sends, so the person signs what they were shown (review LCM-7); a teammate's
/// draft named, which stays a draft; the assessment, typed and saved as it is typed until the visit
/// has a finished note, and then **Add to the assessment**, an addendum made with Complete; the
/// suggested next steps, each adding a note type the visit does not have; **Add referral**; the
/// follow-up as the notes record it; what stops Complete, each line opening its note at the section
/// to fill; the signing sentence; **Save & Close** and the Complete button, worded by what will
/// happen (3.3). After Complete the patient's chart opens (8.2), and a sync is asked for.
///
/// The visit is read from the phone's copy (`openVisit`), which logs what it shows (10.1); the plan
/// logs nothing of its own. Hard stop 5 with no note to open (the person has no Red flags note) adds
/// theirs (`addRedFlagsNote`), and the summary plans again (forms 6.2 as built).
class SummaryScreen extends StatelessWidget {
  const SummaryScreen({super.key, required this.encounterId});
  final String encounterId;

  @override
  Widget build(BuildContext context) => EncountersGate(
    title: summaryTitle,
    builder: (context, services) => _Summary(services: services, encounterId: encounterId),
  );
}

class _Summary extends ConsumerStatefulWidget {
  const _Summary({required this.services, required this.encounterId});
  final EncounterServices services;
  final String encounterId;

  @override
  ConsumerState<_Summary> createState() => _SummaryState();
}

class _SummaryState extends ConsumerState<_Summary> with VisitReading<_Summary> {
  /// Complete's plan, as drawn, and how many assessment saves it had seen.
  ({CompletePlan plan, int saves})? _drawn;
  int _planSeq = 0;
  List<NoteTypeDef> _listed = const [];

  /// What Complete or an action last refused, in the domain layer's words.
  List<String> _refused = const [];
  bool _busy = false;
  bool _askedRedFlags = false;

  /// Assessment saves that queued a change: the hash covers the assessment, so a plan drawn before
  /// one is stale (lifecycle 4.5).
  int _saves = 0;

  /// What is added to a locked assessment, kept until Complete sends it with the sign-offs. In memory
  /// only: never in browser or key-value storage (10.2).
  String? _addition;

  /// Each note's answers as the summary last drew it, and the notes whose answers someone else
  /// changed since (a sync brought it in): each says so above its recap, and Complete asks for one
  /// more look before it signs what was redrawn (9.6 item 1; review SFL-2).
  final _drawnAnswers = <String, Map<String, Object?>>{};
  final _changedElsewhere = <String>{};

  @override
  EncounterServices get services => widget.services;
  @override
  String get encounterId => widget.encounterId;

  EncounterRepository get _repo => services.repository;

  /// Online, whether the visit already has a finished Red flags note the phone lacks (8.2, D113):
  /// asked as the summary opens, once, before Complete is planned.
  late final RedFlagsOnline _redFlags = RedFlagsOnline(services, encounterId, ref.read(syncControllerProvider));

  @override
  void initState() {
    super.initState();
    unawaited(_loadTypes());
  }

  Future<void> _loadTypes() async {
    final listed = await services.noteTypes();
    if (mounted) setState(() => _listed = listed);
  }

  /// The visit read again, then Complete planned again from what the phone now holds.
  @override
  Future<void> reread() async {
    await super.reread();
    await _plan();
  }

  Future<void> _plan() async {
    final seq = ++_planSeq;
    if (!mounted || visit == null || services.store.frozen) return;
    final saves = _saves;
    try {
      final flags = await _redFlags.finished;
      if (!mounted || seq != _planSeq) return;
      final plan = await _repo.openComplete(encounterId, redFlagsFinished: flags);
      if (!mounted || seq != _planSeq || plan == null) return;
      // Hard stop 5 with no note to open: the person has no Red flags note. The app adds theirs and
      // plans again (forms 6.2 as built); asked once, so a refusal is shown, not repeated.
      if (!_askedRedFlags && plan.stops.any((s) => s.stop == CompleteStop.redFlagsFirst && s.noteId == null)) {
        _askedRedFlags = true;
        try {
          if (await _repo.addRedFlagsNote(encounterId, redFlagsFinished: flags) != null) return;
        } on Exception catch (e) {
          if (mounted) setState(() => _refused = [encounterErrorText(e)]);
        }
      }
      _noteChangesElsewhere();
      setState(() => _drawn = (plan: plan, saves: saves));
    } on ChartingPaused {
      // The visit's read says why.
    }
  }

  /// Marks each note whose answers changed since the summary drew it, in an answer that waits for
  /// nothing of the person's own: someone else's change, brought in by a sync.
  void _noteChangesElsewhere() {
    for (final n in visit?.notes ?? const <NoteView>[]) {
      final before = _drawnAnswers[n.noteId];
      if (before != null) {
        final changed = {...before.keys, ...n.answers.keys}.where(
          (path) => canonicalJson(before[path]) != canonicalJson(n.answers[path]) && !n.pendingPaths.contains(path),
        );
        if (changed.isNotEmpty) _changedElsewhere.add(n.noteId);
      }
      _drawnAnswers[n.noteId] = n.answers;
    }
  }

  // ---- the assessment ----

  void _saveAssessment(String? text) {
    try {
      if (_repo.saveSummary(encounterId, text)) _saves++;
    } on Exception catch (e) {
      if (mounted) setState(() => _refused = [encounterErrorText(e)]);
    }
  }

  Future<void> _flushTyping() async {
    FocusManager.instance.primaryFocus?.unfocus();
    await Future<void>.delayed(Duration.zero);
  }

  // ---- the buttons ----

  Future<void> _saveAndClose(VisitView visit) async {
    await _flushTyping();
    if (!mounted) return;
    // What was added to a locked assessment goes only with Complete: asked before it is dropped.
    if (visit.envelopeLocked && (_addition?.trim().isNotEmpty ?? false)) {
      final leave = await confirm(context, title: leaveAdditionTitle, body: leaveAdditionBody, yes: leaveAdditionYes);
      if (!leave || !mounted) return;
    }
    // The app's messenger: the summary goes, and the chart under it says what was done.
    final said = ScaffoldMessenger.of(context);
    leaveVisit(context, services.store, visit.patientId);
    said
      ..removeCurrentSnackBar()
      ..showSnackBar(const SnackBar(content: Text(savedAsDraftDone)));
    unawaited(ref.read(syncControllerProvider).syncNow());
  }

  /// **Complete** (lifecycle 3.3): the notes of the plan drawn, with the hashes worked out as it was
  /// drawn. When the assessment was saved since (it is in each note's hash, 4.5), the plan is made
  /// again and taken only when every recap shown is the same; otherwise the screen shows the new one:
  /// "This note changed. Read it again."
  Future<void> _complete(VisitView visit) async {
    final drawn = _drawn;
    if (drawn == null || _busy) return;
    setState(() {
      _busy = true;
      _refused = const [];
    });
    try {
      await _flushTyping();
      // Someone else's change redrew a recap: the person reads it once more before signing it.
      if (_changedElsewhere.isNotEmpty) {
        _changedElsewhere.clear();
        throw const CompleteRefused([CompleteBlock(CompleteStop.noteChanged, noteChangedText)]);
      }
      var plan = drawn.plan;
      if (_saves != drawn.saves) {
        final fresh = await _repo.openComplete(encounterId, redFlagsFinished: await _redFlags.finished);
        if (fresh == null || !_sameRecaps(plan, fresh)) {
          throw const CompleteRefused([CompleteBlock(CompleteStop.noteChanged, noteChangedText)]);
        }
        plan = fresh;
      }
      _repo.complete(plan, addToAssessment: visit.envelopeLocked ? _addition : null);
      if (!mounted) return;
      // Said on the chart that opens, by what the button said would happen (3.3), heard once.
      final said = ScaffoldMessenger.of(context);
      leaveVisit(context, services.store, visit.patientId);
      said
        ..removeCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(switch (plan.button) {
              CompleteButton.complete => completedDone,
              CompleteButton.completeAndSign => signedDone,
              CompleteButton.completeAndSendForCosignature => sentForCosignatureDone,
            }),
          ),
        );
      unawaited(ref.read(syncControllerProvider).syncNow());
    } on CompleteRefused catch (e) {
      if (mounted) setState(() => _refused = [for (final s in e.stops) s.message]);
      await _plan();
    } on Exception catch (e) {
      if (mounted) setState(() => _refused = [encounterErrorText(e)]);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  static bool _sameRecaps(CompletePlan a, CompletePlan b) {
    String shown(CompletePlan p) => [
      for (final n in p.notes) [n.noteId, n.settlesOnly, for (final l in n.recap) '${l.section}=${l.text}'].join('|'),
    ].join('\n');
    return shown(a) == shown(b);
  }

  /// A suggested note type: the visit's draft of it, or a new one (`addNote`), which opens.
  Future<void> _addType(NoteTypeDef type) async {
    try {
      final added = await _repo.addNote(encounterId, type, redFlagsFinished: await _redFlags.finished);
      if (mounted) unawaited(context.push(noteLocation(added.noteId)));
    } on Exception catch (e) {
      if (mounted) setState(() => _refused = [encounterErrorText(e)]);
    }
  }

  // ---- drawing ----

  @override
  Widget build(BuildContext context) {
    final shown = instead();
    final drawn = _drawn;
    return Scaffold(
      appBar: AppBar(title: const Text(summaryTitle)),
      body: SafeArea(
        child:
            shown ??
            (drawn == null ? const Center(child: CircularProgressIndicator()) : _body(context, visit!, drawn.plan)),
      ),
    );
  }

  Widget _body(BuildContext context, VisitView visit, CompletePlan plan) {
    final text = Theme.of(context).textTheme;
    final titles = {for (final n in visit.notes) n.noteId: n.title ?? untitledNote};
    final stops = plan.stops;
    final suggested = _suggested(visit);
    final followUp = _followUp(visit);
    final mayRefer = visit.patientId != null && services.referrals.mayAdd;
    return ListView(
      padding: const EdgeInsets.all(FieldSpace.s4),
      children: [
        VisitPatientHeader(store: services.store, patientId: visit.patientId, line: visitKindText(visit.kind)),

        // ---- 1. each note's recap, from the plan ----
        const SectionHeading(notesToCompleteHeading),
        for (final n in plan.notes)
          if (!n.settlesOnly) ...[
            if (_changedElsewhere.contains(n.noteId)) ...[
              const NoticeMessage(noteChangedText),
              const SizedBox(height: FieldSpace.s2),
            ],
            _Recap(title: n.definition.title, lines: [for (final l in n.recap) l.text]),
            const SizedBox(height: FieldSpace.s3),
          ],
        for (final d in plan.teammateDrafts) ...[
          Text(teammateDraftText(d.author), style: text.bodyLarge),
          const SizedBox(height: FieldSpace.s2),
        ],
        for (final id in plan.sentForReview) ...[
          Text(sentForReviewText(titles[id] ?? untitledNote), style: text.bodyLarge),
          const SizedBox(height: FieldSpace.s2),
        ],

        // ---- 2. the assessment ----
        if (!visit.summaryHidden) ...[
          const SectionHeading(assessmentHeading),
          if (!visit.envelopeLocked)
            NoteTextField(field: _assessmentField, value: visit.summary, onChanged: _saveAssessment)
          else ...[
            ReadOnlyAnswer(label: assessmentLabel, value: visit.summary),
            const SizedBox(height: FieldSpace.s3),
            Text(addToAssessmentHelp, style: text.bodyLarge),
            const SizedBox(height: FieldSpace.s2),
            NoteTextField(field: _additionField, value: _addition, onChanged: (v) => _addition = v),
          ],
        ],

        // ---- 3. suggested next steps ----
        if (suggested.isNotEmpty) ...[
          const SectionHeading(suggestionsHeading),
          Wrap(
            spacing: FieldSpace.s2,
            runSpacing: FieldSpace.s2,
            children: [
              for (final type in suggested)
                Semantics(
                  button: true,
                  label: suggestionSpoken(type.title),
                  excludeSemantics: true,
                  onTap: () => unawaited(_addType(type)),
                  child: ActionChip(
                    avatar: const Icon(LucideIcons.plus),
                    label: Text(type.title),
                    onPressed: () => unawaited(_addType(type)),
                  ),
                ),
            ],
          ),
        ],

        // ---- 4. Add referral ----
        if (mayRefer) ...[
          const SizedBox(height: FieldSpace.s4),
          WideButton(
            label: addReferralAction,
            icon: LucideIcons.send,
            // The whole Referrals sheet (9.10, decided item 12): the patient's referrals, then Add referral.
            onPressed: () =>
                unawaited(showReferrals(context, services, patientId: visit.patientId!, encounterId: encounterId)),
          ),
        ],

        // ---- 5. follow-up, as the notes record it ----
        const SectionHeading(followUpHeading),
        if (followUp.isEmpty)
          Text(noFollowUp, style: text.bodyLarge)
        else
          for (final line in followUp) Text(line, style: text.bodyLarge),

        // ---- 6. what stops Complete ----
        if (stops.isNotEmpty) ...[
          const SectionHeading(stopsHeading),
          for (final s in stops) ...[
            _StopRow(
              block: s,
              onOpen: switch ((s.noteId, s.stop)) {
                (final id?, _) => () => unawaited(context.push(noteLocation(id), extra: s.section)),
                // Hard stop 2: what waits is fixed in Needs attention (9.6 item 6, review SFL-6).
                (null, CompleteStop.needsAttention) => () => unawaited(context.push('/attention')),
                _ => null,
              },
            ),
            const SizedBox(height: FieldSpace.s2),
          ],
        ],

        // ---- 7 and 8. the signing sentence and the buttons ----
        const SizedBox(height: FieldSpace.s4),
        for (final message in _refused) ...[ErrorMessage(message), const SizedBox(height: FieldSpace.s2)],
        if (plan.signingSentence case final sentence?) ...[
          Text(sentence, style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: FieldSpace.s3),
        ],
        WideButton(
          label: switch (plan.button) {
            CompleteButton.complete => completeAction,
            CompleteButton.completeAndSign => completeAndSignAction,
            CompleteButton.completeAndSendForCosignature => completeAndSendAction,
          },
          icon: LucideIcons.circleCheck,
          filled: true,
          onPressed: plan.canComplete && !_busy ? () => unawaited(_complete(visit)) : null,
        ),
        const SizedBox(height: FieldSpace.s2),
        WideButton(label: saveAndCloseAction, onPressed: () => unawaited(_saveAndClose(visit))),
      ],
    );
  }

  /// The note types the options picked suggest (forms 7.1), each one the visit does not have and
  /// the person may start in it, in the order the notes suggest them.
  List<NoteTypeDef> _suggested(VisitView visit) {
    final inVisit = {for (final n in visit.notes) n.noteTypeKey};
    final offered = {for (final t in _repo.noteTypesOffered(_listed, visit.kind)) t.key: t};
    final keys = <String>[];
    for (final n in visit.notes) {
      final definition = n.definition;
      if (definition == null || !n.editable) continue;
      for (final key in suggestions(definition, n.answers)) {
        if (!inVisit.contains(key) && offered.containsKey(key) && !keys.contains(key)) keys.add(key);
      }
    }
    // A Medical note needs the visit's patient (3.10).
    return [
      for (final key in keys)
        if (!isMedicalType(offered[key]!) || visit.patientId != null) offered[key]!,
    ];
  }

  /// The follow-up as the notes record it (lifecycle 9.6 item 5): in a Medical visit the Red flags and
  /// disposition note's, which asks the visit's follow-up (forms 6.2); in a Non-Medical one each note's.
  /// The follow-up is a section, or a field, named `follow_up` in the released note types: the format
  /// marks none, so the summary reads those IDs.
  List<String> _followUp(VisitView visit) => [
    for (final n in visit.notes)
      if (n.definition case final definition? when !visit.medical || definition.auto == 'medical')
        for (final section in layOut(
          definition,
          effectiveAnswers(definition, n.answers),
          skip: (node) => node.section.section.id != 'follow_up' && node.field.id != 'follow_up',
        ))
          for (final item in section.items)
            if (item.value case final value?) '${item.labels.join(', ')}: $value',
  ];
}

/// The visit's assessment, typed as a note's text answer is: saved as typing pauses, at most 4,000
/// characters, its counter speaking near the limit and at it (lifecycle 9.6; forms 8.2).
final _assessmentField = _textField('summary', assessmentLabel);

/// What is added to a locked assessment, which goes with Complete as an addendum to the visit.
final _additionField = _textField('summary_addition', addToAssessmentLabel);

TextDef _textField(String id, String label) =>
    NoteTypeDef.fromJson({
          'key': 'visit_summary',
          'version': 1,
          'title': label,
          'kinds': ['medical', 'non_medical'],
          'group': 'clinical',
          'sensitivity': 'none',
          'sections': [
            {
              'id': 'summary',
              'title': label,
              'fields': [
                {'id': id, 'kind': 'text', 'lines': 'many', 'maxLength': assessmentMax, 'label': label},
              ],
            },
          ],
        }).sections.single.fields.single
        as TextDef;

/// A note's recap under its type's name: three lines, then an ellipsis, as the form's closed
/// section shows it; a screen reader hears all of it.
class _Recap extends StatelessWidget {
  const _Recap({required this.title, required this.lines});
  final String title;
  final List<String> lines;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final c = context.field;
    final shown = lines.isEmpty ? noAnswersYet : lines.join('\n');
    return Container(
      padding: const EdgeInsets.all(FieldSpace.s3),
      decoration: BoxDecoration(
        color: c.surface,
        border: Border.all(color: c.line),
        borderRadius: BorderRadius.circular(FieldRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(container: true, header: true, child: Text(title, style: text.titleMedium)),
          const SizedBox(height: FieldSpace.s1),
          Semantics(
            container: true,
            label: shown,
            excludeSemantics: true,
            child: Text(shown, style: text.bodyLarge),
          ),
        ],
      ),
    );
  }
}

/// A line of what stops Complete, in the domain layer's words; one that names a note opens it at the
/// section to fill.
class _StopRow extends StatelessWidget {
  const _StopRow({required this.block, required this.onOpen});
  final CompleteBlock block;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final row = Padding(
      padding: const EdgeInsets.all(FieldSpace.s3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(LucideIcons.circleAlert, color: c.critical),
          const SizedBox(width: FieldSpace.s2),
          Expanded(child: Text(block.message, style: text.bodyLarge)),
          if (onOpen != null) ...[const SizedBox(width: FieldSpace.s2), Icon(LucideIcons.chevronRight, color: c.ink)],
        ],
      ),
    );
    return Semantics(
      button: onOpen != null,
      label: block.message,
      hint: onOpen == null ? null : stopOpensHint,
      excludeSemantics: true,
      onTap: onOpen,
      child: Material(
        color: c.surface,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: c.lineStrong),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: onOpen == null
            ? row
            : InkWell(
                borderRadius: BorderRadius.circular(FieldRadius.md),
                onTap: onOpen,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: FieldTap.min),
                  child: row,
                ),
              ),
      ),
    );
  }
}
