import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/generated/api.dart' show MatchBand;
import '../../api/transport.dart' show ApiException;
import '../../app_providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/birth_field.dart';
import '../../design/widgets/form_bits.dart';
import '../../design/widgets/status_chip.dart';
import '../../patients/consent_script.dart';
import '../../patients/dob.dart';
import '../../patients/match_constants.dart' show estimateRange;
import '../../patients/patient_providers.dart';
import '../../patients/patient_repository.dart';
import '../../patients/patient_search.dart';
import '../../sync/local_store.dart' show ChartingPaused, LocalValidationError;
import 'duplicate_panel.dart';
import 'patient_labels.dart';
import 'patient_row.dart';
import 'patient_widgets.dart';
import 'same_person_sheet.dart';

/// **New patient** and **Edit details** (design 11): one scrolling form, nothing hidden behind
/// "More", each section a heading, a sticky main button above the keyboard. New patient asks for
/// consent first and checks for possible duplicates as names and the birth are typed (8.1); Edit
/// opens the same form filled from the chart, with **Update and save**, the identity rules of 11.5,
/// and one change per changed field.
class IntakeScreen extends StatelessWidget {
  const IntakeScreen({super.key, this.start, this.editing});

  final IntakeStart? start;

  /// The patient being edited; null for a new patient.
  final String? editing;

  @override
  Widget build(BuildContext context) => PatientsGate(
    title: editing == null ? 'New patient' : 'Edit details',
    builder: (context, services) => _IntakeForm(services: services, start: start, editing: editing),
  );
}

enum _Consent { agrees, unable, declines }

enum _Allergies { notAsked, noneKnown, adding }

/// An existing street name on the edit form, and the reason given to remove it.
class _ExistingAlias {
  _ExistingAlias(this.view);
  final AliasView view;
  String? removal;
}

class _IntakeForm extends ConsumerStatefulWidget {
  const _IntakeForm({required this.services, required this.start, required this.editing});
  final PatientServices services;
  final IntakeStart? start;
  final String? editing;

  @override
  ConsumerState<_IntakeForm> createState() => _IntakeFormState();
}

class _IntakeFormState extends ConsumerState<_IntakeForm> {
  final _scroll = ScrollController();
  final _preferred = TextEditingController();
  final _aliasInput = TextEditingController();
  final _given = TextEditingController();
  final _family = TextEditingController();
  final _descriptor = TextEditingController();
  final _area = TextEditingController();
  final _livingOther = TextEditingController();
  final _substance = TextEditingController();
  final _reaction = TextEditingController();
  final _noticeReason = TextEditingController();

  final _preferredFocus = FocusNode();
  final _aliasFocus = FocusNode();
  final _givenFocus = FocusNode();
  final _familyFocus = FocusNode();
  final _birthFocus = FocusNode();
  final _descriptorFocus = FocusNode();
  final _livingOtherFocus = FocusNode();
  final _substanceFocus = FocusNode();
  final _noticeReasonFocus = FocusNode();
  final _errorsKey = GlobalKey();
  final _consentKey = GlobalKey();

  _Consent? _consent;
  String _method = 'verbal';
  UnableReason? _unable;

  // PLAN-OPEN: the privacy notice answer an intake starts from (design 11.2; counsel): "They took
  // it", since the script offers it in the same breath as the consent question; the worker changes
  // it when they didn't. It is recorded, never blocking.
  PrivacyNoticeDecision _notice = PrivacyNoticeDecision.acknowledged;

  final _aliases = <String>[];
  BirthEntry _birth = const BirthEntry();
  String? _living;
  String? _language;
  _Allergies _allergyScreen = _Allergies.notAsked;
  final _allergies = <NewAllergy>[];
  String? _category;
  String? _severity;
  IdCardAnswer _card = IdCardAnswer.askLater;

  MatchRun? _match;
  String? _matchKey;
  int _matchSeq = 0;
  final _dismissed = <String>{};

  List<({String message, FocusNode? focus, GlobalKey? key})> _errors = const [];
  String? _saveError;
  bool _saving = false;

  // ---- edit mode ----
  PatientView? _view;
  final _existingAliases = <_ExistingAlias>[];
  bool _editing = false;

  PatientServices get _s => widget.services;
  bool get _isEdit => widget.editing != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      _loadForEdit();
    } else if (widget.start?.fromDraft ?? false) {
      _loadDraft();
    } else if (widget.start?.name case final name?) {
      _preferred.text = name;
    }
  }

  @override
  void dispose() {
    if (_editing) {
      try {
        _s.patients.finishEditing(widget.editing!);
      } on StateError {
        // The chart went (a purge, a wipe): nothing to close.
      }
    }
    for (final c in [
      _scroll,
      _preferred,
      _aliasInput,
      _given,
      _family,
      _descriptor,
      _area,
      _livingOther,
      _substance,
      _reaction,
      _noticeReason,
    ]) {
      c.dispose();
    }
    for (final f in [
      _preferredFocus,
      _aliasFocus,
      _givenFocus,
      _familyFocus,
      _birthFocus,
      _descriptorFocus,
      _livingOtherFocus,
      _substanceFocus,
      _noticeReasonFocus,
    ]) {
      f.dispose();
    }
    super.dispose();
  }

  // ---------------------------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------------------------

  void _loadForEdit() {
    final view = _s.patients.read(widget.editing!);
    _view = view;
    if (view == null || view.mergedInto != null) return;
    try {
      _s.patients.startEditing(widget.editing!);
      _editing = true;
    } on StateError {
      _view = null;
      return;
    }
    _preferred.text = view.preferredName ?? '';
    _given.text = view.legalName?.given ?? '';
    _family.text = view.legalName?.family ?? '';
    _descriptor.text = view.visualDescriptor ?? '';
    _area.text = view.usualArea ?? '';
    _living = view.livingSituation?.kind;
    _livingOther.text = view.livingSituation?.other ?? '';
    _language = view.preferredLanguage;
    _allergyScreen = view.allergyScreen == 'none_known' ? _Allergies.noneKnown : _Allergies.notAsked;
    for (final a in view.aliases) {
      if (a.active && !a.mergedName) _existingAliases.add(_ExistingAlias(a));
    }
  }

  void _loadDraft() {
    final d = _s.patients.draft();
    if (d == null) return;
    String text(String key) => d[key] is String ? d[key]! as String : '';
    _consent = _Consent.values.where((c) => c.name == d['consent']).firstOrNull;
    _method = d['method'] == 'written' ? 'written' : 'verbal';
    _unable = UnableReason.values.where((u) => u.name == d['unable']).firstOrNull;
    _notice = PrivacyNoticeDecision.values.where((n) => n.name == d['notice']).firstOrNull ?? _notice;
    _noticeReason.text = text('noticeReason');
    _preferred.text = text('preferred');
    _aliases.addAll([...?(d['aliases'] as List<Object?>?)?.whereType<String>()]);
    _given.text = text('given');
    _family.text = text('family');
    _birth = BirthEntry.fromDraft(d['birth'], todayOf(ref));
    _descriptor.text = text('descriptor');
    _area.text = text('area');
    _living = d['living'] as String?;
    _livingOther.text = text('livingOther');
    _language = d['language'] as String?;
    _allergyScreen = _Allergies.values.where((a) => a.name == d['allergyScreen']).firstOrNull ?? _allergyScreen;
    for (final a in [...?(d['allergies'] as List<Object?>?)?.whereType<Map<String, Object?>>()]) {
      _allergies.add(
        NewAllergy(
          substance: a['substance'] as String? ?? '',
          category: a['category'] as String?,
          severity: a['severity'] as String?,
          reaction: a['reaction'] as String?,
        ),
      );
    }
    _card = IdCardAnswer.values.where((c) => c.name == d['card']).firstOrNull ?? _card;
  }

  /// The draft: what was typed, kept in the encrypted database (11.1), never in plain storage.
  Map<String, Object?> _draft() => {
    'consent': _consent?.name,
    'method': _method,
    'unable': _unable?.name,
    'notice': _notice.name,
    'noticeReason': _noticeReason.text,
    'preferred': _preferred.text,
    'aliases': _aliases,
    'given': _given.text,
    'family': _family.text,
    'birth': _birth.toDraft(),
    'descriptor': _descriptor.text,
    'area': _area.text,
    'living': _living,
    'livingOther': _livingOther.text,
    'language': _language,
    'allergyScreen': _allergyScreen.name,
    'allergies': [
      for (final a in _allergies)
        {'substance': a.substance, 'category': a.category, 'severity': a.severity, 'reaction': a.reaction},
    ],
    'card': _card.name,
  };

  bool get _typedAnything =>
      [
        _preferred,
        _aliasInput,
        _given,
        _family,
        _descriptor,
        _area,
        _livingOther,
        _substance,
        _reaction,
      ].any((c) => c.text.trim().isNotEmpty) ||
      _aliases.isNotEmpty ||
      !_birth.isEmpty ||
      _allergies.isNotEmpty ||
      _consent != null ||
      _living != null ||
      _language != null;

  // ---------------------------------------------------------------------------------------------
  // The duplicate check (8.1)
  // ---------------------------------------------------------------------------------------------

  MatchInput _matchInput() => MatchInput(
    preferredName: _preferred.text,
    legalGiven: _given.text,
    legalFamily: _family.text,
    aliases: List.of(_aliases),
    birth: _birth.birth,
  );

  String _keyOf(MatchInput i) => [
    i.preferredName?.trim(),
    i.legalGiven?.trim(),
    i.legalFamily?.trim(),
    ...i.aliases,
    i.birth?.toJson().toString(),
  ].join('\u0000');

  /// Runs when a name, street name or birth field loses focus, and on Create when anything changed
  /// since. Each check is audited by whoever produced it (the phone in its own transaction).
  Future<MatchRun?> _check() async {
    if (_isEdit || _consent == _Consent.declines) return _match;
    final input = _matchInput();
    final key = _keyOf(input);
    if (key == _matchKey) return _match;
    if (!input.hasName) {
      setState(() {
        _match = null;
        _matchKey = key;
      });
      return null;
    }
    final seq = ++_matchSeq;
    try {
      final run = await _s.search.checkMatches(input);
      if (!mounted || seq != _matchSeq) return run;
      setState(() {
        _match = run;
        _matchKey = key;
      });
      return run;
    } on ChartingPaused catch (e) {
      if (mounted) setState(() => _saveError = e.message);
    } on ApiException {
      // The check is a help, not a gate: the server checks again when the patient syncs.
    }
    return _match;
  }

  Future<void> _thisIsThem(FoundPatient p) async {
    final typed = TypedDetails(
      aliases: List.of(_aliases),
      usualArea: _area.text.trim().isEmpty ? null : _area.text.trim(),
      livingSituation: _living == null
          ? null
          : {
              'kind': _living,
              if (_living == 'other' && _livingOther.text.trim().isNotEmpty) 'other': _livingOther.text.trim(),
            },
    );
    final yes = await confirm(
      context,
      title: 'Open ${listName(p)}’s chart?',
      body:
          'Nothing new is created. What you typed here is discarded'
          '${typed.isEmpty ? '.' : ', and the chart offers to add the street names, where they’re usually found and their living situation.'}',
      yes: 'Open the chart',
    );
    if (!yes || !mounted) return;
    _s.patients.discardDraft();
    context.pushReplacement('/patients/${p.patientId}', extra: typed.isEmpty ? null : typed);
  }

  // ---------------------------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------------------------

  bool get _livingOtherMissing => _living == 'other' && _livingOther.text.trim().isEmpty;

  bool _recognisable() =>
      [_preferred, _given, _family, _descriptor].any((c) => c.text.trim().isNotEmpty) ||
      (_isEdit && _view!.isLocked('legalName'));

  List<({String message, FocusNode? focus, GlobalKey? key})> _validate() => [
    if (!_isEdit && _consent == null)
      (message: 'Choose whether they agree to the team keeping a record.', focus: null, key: _consentKey),
    if (!_isEdit && _consent == _Consent.unable && _unable == null)
      (message: 'Choose why they can’t consent now.', focus: null, key: _consentKey),
    if (!_isEdit &&
        (_notice == PrivacyNoticeDecision.notOffered || _notice == PrivacyNoticeDecision.unable) &&
        _noticeReason.text.trim().length < 3)
      (message: 'Say why the privacy notice wasn’t given.', focus: _noticeReasonFocus, key: null),
    if (!_recognisable())
      (
        message: _isEdit
            ? 'Keep a name or a description so the team can recognise them.'
            : 'Add a name or what they look like, so the team can recognise them.',
        focus: _preferredFocus,
        key: null,
      ),
    if (_birth.error case final e?) (message: e, focus: _birthFocus, key: null),
    if (_livingOtherMissing)
      (message: 'Say what “Other” means for their living situation.', focus: _livingOtherFocus, key: null),
    if (_substance.text.trim().isNotEmpty)
      (message: 'Add the allergy you started, or clear it.', focus: _substanceFocus, key: null),
  ];

  /// Errors listed at the top in a live region, each linked to its field; focus to the first.
  bool _showErrors() {
    final errors = _validate();
    setState(() => _errors = errors);
    if (errors.isEmpty) return true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = _errorsKey.currentContext;
      if (ctx != null) unawaited(Scrollable.ensureVisible(ctx));
      errors.first.focus?.requestFocus();
    });
    return false;
  }

  void _goTo(({String message, FocusNode? focus, GlobalKey? key}) e) {
    if (e.focus != null) {
      e.focus!.requestFocus();
    } else if (e.key?.currentContext case final ctx?) {
      unawaited(Scrollable.ensureVisible(ctx));
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Create (11.1) and Update and save (11.5)
  // ---------------------------------------------------------------------------------------------

  String? _t(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();

  Future<void> _create() async {
    if (_saving || !_showErrors()) return;
    setState(() {
      _saving = true;
      _saveError = null;
    });
    try {
      final run = await _check();
      if (!mounted) return;
      final likely = [
        for (final c in run?.candidates ?? const <FoundPatient>[])
          if (c.band == MatchBand.likely && !_dismissed.contains(c.patientId)) c,
      ];
      if (likely.isNotEmpty) {
        final answer = await askSamePerson(context, likely.first, todayOf(ref));
        if (!mounted || answer == null) return;
        if (answer == SamePersonAnswer.open) {
          setState(() => _saving = false);
          await _thisIsThem(likely.first);
          return;
        }
        setState(() => _dismissed.addAll(likely.map((c) => c.patientId)));
      }
      final result = _s.patients.createPatient(
        Intake(
          consent: _consent == _Consent.unable
              ? ConsentAnswer.unable(_unable!.label)
              : ConsentAnswer.given(method: _method),
          privacyNotice: _notice,
          privacyNoticeReason: _t(_noticeReason),
          language: consentScriptFor(_language).language,
          preferredName: _t(_preferred),
          legalGiven: _t(_given),
          legalFamily: _t(_family),
          birth: _birth.birth,
          visualDescriptor: _t(_descriptor),
          usualArea: _t(_area),
          livingSituation: _living,
          livingSituationOther: _t(_livingOther),
          preferredLanguage: _language,
          aliases: List.of(_aliases),
          noKnownAllergies: _allergyScreen == _Allergies.noneKnown && _allergies.isEmpty,
          allergies: List.of(_allergies),
          idCard: _card,
          matchCheck: run?.matchCheck(dismissed: _dismissed),
        ),
      );
      if (!mounted) return;
      showDone(context, result.cardWaitsForClock ? 'Saved. Make the card once the phone’s clock is right.' : 'Saved');
      context.pushReplacement('/patients/${result.patientId}');
    } on LocalValidationError catch (e) {
      if (mounted) setState(() => _saveError = e.message);
    } on ChartingPaused catch (e) {
      if (mounted) setState(() => _saveError = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Map<String, Object?> _changes() {
    final v = _view!;
    final changes = <String, Object?>{};
    void text(String field, TextEditingController c, String? was) {
      if (!v.editableFields.contains(field)) return;
      if ((_t(c) ?? '') != (was ?? '')) changes[field] = _t(c);
    }

    text('preferredName', _preferred, v.preferredName);
    text('visualDescriptor', _descriptor, v.visualDescriptor);
    text('usualArea', _area, v.usualArea);
    final legal = v.legalName;
    if (v.editableFields.contains('legalName') &&
        ((_t(_given) ?? '') != (legal?.given ?? '') || (_t(_family) ?? '') != (legal?.family ?? ''))) {
      changes['legalName'] = _t(_given) == null && _t(_family) == null
          ? null
          : {'given': _t(_given), 'family': _t(_family)};
    }
    if (v.editableFields.contains('birth') && !_birth.isEmpty && _birth.birth != null && _birth.birth != v.birth) {
      changes['birth'] = _birth.birth!.toJson();
    }
    if (v.editableFields.contains('livingSituation')) {
      final was = v.livingSituation;
      final other = _living == 'other' ? _t(_livingOther) : null;
      if (_living != was?.kind || (other ?? '') != (was?.kind == 'other' ? was?.other ?? '' : '')) {
        changes['livingSituation'] = _living == null ? null : {'kind': _living, 'other': ?other};
      }
    }
    if (v.editableFields.contains('preferredLanguage') && _language != v.preferredLanguage) {
      changes['preferredLanguage'] = _language;
    }
    final screen = _allergyScreen == _Allergies.noneKnown ? 'none_known' : 'not_asked';
    if (v.editableFields.contains('allergyScreen') && screen != v.allergyScreen && _allergies.isEmpty) {
      changes['allergyScreen'] = screen;
    }
    return changes;
  }

  Future<void> _update() async {
    if (_saving || !_showErrors()) return;
    final id = widget.editing!;
    setState(() {
      _saving = true;
      _saveError = null;
    });
    try {
      final changes = _changes();
      if (changes.isNotEmpty) _s.patients.update(id, changes);
      for (final a in _existingAliases) {
        if (a.removal != null && a.view.id != null) _s.patients.removeAlias(a.view.id!, a.removal!);
      }
      for (final a in _aliases) {
        _s.patients.addAlias(id, a);
      }
      for (final a in _allergies) {
        _s.patients.addAllergy(id, a);
      }
      _aliases.clear();
      _allergies.clear();
      if (!mounted) return;
      showDone(context, 'Saved');
      context.pop();
    } on LocalValidationError catch (e) {
      if (mounted) setState(() => _saveError = e.message);
    } on ChartingPaused catch (e) {
      if (mounted) setState(() => _saveError = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _back() async {
    if (_isEdit) {
      if (_view != null &&
          (_changes().isNotEmpty ||
              _aliases.isNotEmpty ||
              _allergies.isNotEmpty ||
              _existingAliases.any((a) => a.removal != null))) {
        final discard = await confirm(
          context,
          title: 'Discard your changes?',
          body: 'Nothing you changed here is saved.',
          yes: 'Discard',
          no: 'Keep editing',
        );
        if (!discard) return;
      }
      if (mounted) context.pop();
      return;
    }
    if (!_typedAnything) {
      if (mounted) context.pop();
      return;
    }
    final choice = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Keep this as a draft?'),
        content: const Text(
          'The draft stays encrypted on this phone. The Patients tab offers to continue it. Nothing is sent.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Discard')),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Keep draft')),
        ],
      ),
    );
    if (choice == null || !mounted) return;
    if (choice) {
      _s.patients.saveDraft(_draft());
    } else {
      _s.patients.discardDraft();
    }
    if (mounted) context.pop();
  }

  // ---------------------------------------------------------------------------------------------
  // The form
  // ---------------------------------------------------------------------------------------------

  void _addAlias() {
    final a = _aliasInput.text.trim();
    if (a.isEmpty) return;
    if (_aliases.length + _existingAliases.where((x) => x.removal == null).length >= 20) {
      setState(() => _saveError = 'A person can have up to 20 street names.');
      return;
    }
    setState(() {
      _aliases.add(a);
      _aliasInput.clear();
    });
    _aliasFocus.requestFocus();
    unawaited(_check());
  }

  void _addAllergy() {
    final substance = _substance.text.trim();
    if (substance.isEmpty) {
      setState(() => _saveError = 'Name the allergy before adding it.');
      _substanceFocus.requestFocus();
      return;
    }
    setState(() {
      _allergies.add(
        NewAllergy(substance: substance, category: _category, severity: _severity, reaction: _t(_reaction)),
      );
      _substance.clear();
      _reaction.clear();
      _category = null;
      _severity = null;
      _saveError = null;
    });
  }

  Future<void> _removeExistingAlias(_ExistingAlias a) async {
    final reason = await askReason(
      context,
      title: 'Remove “${a.view.alias}”?',
      body: 'Say why. The street name stays in the chart’s history.',
      action: 'Remove',
      quick: const ['Wrong patient', 'Typed by mistake', 'They don’t use it'],
    );
    if (reason == null || !mounted) return;
    setState(() => a.removal = reason);
  }

  @override
  Widget build(BuildContext context) {
    final sync = ref.watch(syncControllerProvider);
    final today = todayOf(ref);
    if (_isEdit && (_view == null || _view!.mergedInto != null)) {
      return Scaffold(
        appBar: AppBar(title: const Text('Edit details')),
        body: Padding(
          padding: const EdgeInsets.all(FieldSpace.s4),
          child: NoticeMessage(
            _view?.mergedInto != null
                ? 'This chart was merged into another. Edit the combined chart.'
                : 'This chart isn’t on this phone. Open it from the Patients tab first.',
          ),
        ),
      );
    }
    final declined = _consent == _Consent.declines;
    final ready = _birth.ready && !_saving && !declined;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_back());
      },
      child: Scaffold(
        appBar: AppBar(title: Text(_isEdit ? 'Edit details' : 'New patient')),
        body: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: ListView(
                  controller: _scroll,
                  padding: const EdgeInsets.all(FieldSpace.s4),
                  children: [
                    if (_errors.isNotEmpty) ...[
                      KeyedSubtree(
                        key: _errorsKey,
                        child: _ErrorList(errors: _errors, onTap: _goTo),
                      ),
                      const SizedBox(height: FieldSpace.s3),
                    ],
                    if (_saveError != null) ...[ErrorMessage(_saveError!), const SizedBox(height: FieldSpace.s3)],
                    if (_isEdit) ..._editHeader() else ..._consentSection(today),
                    if (!declined) ...[
                      ..._nameSection(),
                      ..._birthSection(today),
                      if (_match case final run?)
                        DuplicatePanel(
                          run: run,
                          dismissed: _dismissed,
                          today: today,
                          now: ref.read(wallClockProvider)(),
                          onThisIsThem: (p) => unawaited(_thisIsThem(p)),
                          onNotThem: (p) => setState(() => _dismissed.add(p.patientId)),
                          onUndo: (p) => setState(() => _dismissed.remove(p.patientId)),
                        ),
                      ..._lookSection(),
                      ..._livingSection(),
                      ..._allergySection(),
                      if (!_isEdit) ..._cardSection(sync.snapshot.clock.paused),
                      if (!_isEdit) ...[
                        const SectionHeading('Photo'),
                        // Phase 8 adds photos; an empty slot is never read out.
                        ExcludeSemantics(
                          child: Container(
                            height: 72,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: context.field.surfaceSunken,
                              borderRadius: BorderRadius.circular(FieldRadius.md),
                            ),
                            child: Text('Coming soon', style: Theme.of(context).textTheme.bodyLarge),
                          ),
                        ),
                      ],
                    ],
                  ],
                ),
              ),
              if (!declined)
                Padding(
                  padding: const EdgeInsets.fromLTRB(FieldSpace.s4, FieldSpace.s2, FieldSpace.s4, FieldSpace.s2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (!_birth.ready && _birth.needsConfirmation)
                        Padding(
                          padding: const EdgeInsets.only(bottom: FieldSpace.s1),
                          child: Text(
                            'Confirm the date of birth first.',
                            style: Theme.of(context).textTheme.bodyMedium,
                            textAlign: TextAlign.center,
                          ),
                        ),
                      BusyButton(
                        label: _isEdit ? 'Update and save' : 'Create patient',
                        busy: _saving,
                        onPressed: ready ? () => unawaited(_isEdit ? _update() : _create()) : null,
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  // ---- consent (11.2) ----

  List<Widget> _consentSection(DateTime today) {
    final script = consentScriptFor(_language);
    final text = Theme.of(context).textTheme;
    final c = context.field;
    return [
      KeyedSubtree(key: _consentKey, child: const SectionHeading('Consent')),
      Container(
        padding: const EdgeInsets.all(FieldSpace.s4),
        decoration: BoxDecoration(
          color: c.surface,
          border: Border.all(color: c.lineStrong),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Read this to them:', style: text.bodyMedium?.copyWith(color: c.inkMuted)),
            const SizedBox(height: FieldSpace.s2),
            Text('“${script.text}”', style: text.titleLarge?.copyWith(fontWeight: FontWeight.w400, height: 1.4)),
            if (!script.translated && _language != null && _language != 'en') ...[
              const SizedBox(height: FieldSpace.s2),
              Text(
                'No translation yet: shown in English. Use an interpreter if they need one.',
                style: text.bodyMedium,
              ),
            ],
          ],
        ),
      ),
      const SizedBox(height: FieldSpace.s3),
      RadioChips<_Consent>(
        label: 'Do they agree?',
        options: const {
          _Consent.agrees: 'Agrees',
          _Consent.unable: 'Unable to consent now',
          _Consent.declines: 'Declines',
        },
        selected: _consent,
        onSelected: (v) => setState(() => _consent = v),
      ),
      if (_consent == _Consent.agrees) ...[
        const SizedBox(height: FieldSpace.s3),
        RadioChips<String>(
          label: 'How',
          options: const {'verbal': 'Said yes', 'written': 'Signed a form'},
          selected: _method,
          onSelected: (v) => setState(() => _method = v),
        ),
      ],
      if (_consent == _Consent.unable) ...[
        const SizedBox(height: FieldSpace.s3),
        RadioChips<UnableReason>(
          label: 'Why not now?',
          options: {for (final r in UnableReason.values) r: r.label},
          selected: _unable,
          onSelected: (v) => setState(() => _unable = v),
        ),
        const SizedBox(height: FieldSpace.s2),
        Text(
          'The chart is made. It shows “Consent not recorded yet” until someone asks again.',
          style: text.bodyMedium,
        ),
      ],
      if (_consent == _Consent.declines) ...[
        const SizedBox(height: FieldSpace.s3),
        const NoticeMessage(
          'No record is made. You can still give care; the visit can be charted without a patient record.',
        ),
        const SizedBox(height: FieldSpace.s3),
        WideButton(
          label: 'Close without saving',
          onPressed: () {
            _s.patients.discardDraft();
            context.pop();
          },
        ),
      ],
      if (_consent != _Consent.declines) ...[
        const SizedBox(height: FieldSpace.s4),
        RadioChips<PrivacyNoticeDecision>(
          label: 'Privacy notice',
          options: const {
            PrivacyNoticeDecision.acknowledged: 'They took it',
            PrivacyNoticeDecision.declined: 'They didn’t want it',
            PrivacyNoticeDecision.unable: 'Unable to take it now',
            PrivacyNoticeDecision.notOffered: 'Not offered',
          },
          selected: _notice,
          onSelected: (v) => setState(() => _notice = v),
        ),
        if (_notice == PrivacyNoticeDecision.unable || _notice == PrivacyNoticeDecision.notOffered) ...[
          const SizedBox(height: FieldSpace.s2),
          PhiField(
            name: 'noticeReason',
            label: 'Why not?',
            controller: _noticeReason,
            focusNode: _noticeReasonFocus,
            capitalization: TextCapitalization.sentences,
            maxLength: 300,
          ),
        ],
      ],
      if (isMinor(_birth.birth, today) && _consent != _Consent.declines) ...[
        const SizedBox(height: FieldSpace.s3),
        // PLAN-OPEN: minors' consent (design 14.1, #1; counsel): the team's guidance, shown, not enforced.
        const StatusBanner(
          icon: LucideIcons.info,
          tone: ChipTone.info,
          text: 'Under 18',
          detail: 'Follow your team’s guidance for consent from minors before going on.',
        ),
      ],
    ];
  }

  // ---- edit header: consent on record ----

  List<Widget> _editHeader() {
    final v = _view!;
    return [
      if (v.copy == ChartCopy.partial) ...[
        const NoticeMessage(
          'List only: the full chart opens when the phone reconnects. Until then you can change what the list '
          'holds, street names, allergies and consent.',
        ),
        const SizedBox(height: FieldSpace.s2),
      ],
      const SectionHeading('Consent'),
      if (v.consents.isEmpty)
        const Text('No consent decisions on this phone.')
      else
        for (final c in v.consents) Text('${consentText(c.kind, c.decision)}${c.pending ? ' · not synced yet' : ''}'),
      if (v.consentNotRecorded) ...[
        const SizedBox(height: FieldSpace.s2),
        const Text('Record consent from the chart: Record consent now.'),
      ],
    ];
  }

  bool _editable(String field) => !_isEdit || _view!.editableFields.contains(field);

  static const _needsFull = 'This needs the full chart. Connect to download it.';

  // ---- names ----

  List<Widget> _nameSection() {
    final v = _view;
    final large = MediaQuery.textScalerOf(context).scale(1) > 1.3;
    final legal = v?.legalName;
    final givenLocked = v != null && (legal?.given?.isNotEmpty ?? false);
    final familyLocked = v != null && (legal?.family?.isNotEmpty ?? false);
    Widget legalPart(String label, String name, TextEditingController c, FocusNode f, bool locked) => locked
        ? _LockedValue(label: label, value: c.text)
        : PhiField(
            name: name,
            label: label,
            controller: c,
            focusNode: f,
            enabled: _editable('legalName'),
            helper: _isEdit
                ? (_editable('legalName') ? 'Not recorded yet. Add it if they give it.' : _needsFull)
                : null,
            onSubmitted: (_) => unawaited(_check()),
          );
    final given = legalPart('Given name', 'legalGiven', _given, _givenFocus, givenLocked);
    final family = legalPart('Family name', 'legalFamily', _family, _familyFocus, familyLocked);
    return [
      const SectionHeading('Name'),
      Focus(
        onFocusChange: (has) {
          if (!has) unawaited(_check());
        },
        child: PhiField(
          name: 'preferredName',
          label: 'What do they go by?',
          controller: _preferred,
          focusNode: _preferredFocus,
          enabled: _editable('preferredName'),
          helper: _editable('preferredName') ? null : _needsFull,
        ),
      ),
      const SizedBox(height: FieldSpace.s4),
      Semantics(header: true, child: Text('Street names', style: Theme.of(context).textTheme.titleMedium)),
      const SizedBox(height: FieldSpace.s2),
      for (final a in _existingAliases)
        _ListItem(
          text: a.removal == null ? a.view.alias : '${a.view.alias} (removed: ${a.removal})',
          action: a.removal == null ? 'Remove' : 'Keep',
          spoken: a.removal == null ? 'Remove street name ${a.view.alias}' : 'Keep street name ${a.view.alias}',
          onPressed: () => a.removal == null ? unawaited(_removeExistingAlias(a)) : setState(() => a.removal = null),
        ),
      for (final (i, a) in _aliases.indexed)
        _ListItem(
          text: a,
          action: 'Remove',
          spoken: 'Remove street name $a',
          onPressed: () {
            setState(() => _aliases.removeAt(i));
            unawaited(_check());
          },
        ),
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: PhiField(
              name: 'alias',
              label: 'Street name',
              controller: _aliasInput,
              focusNode: _aliasFocus,
              onSubmitted: (_) => _addAlias(),
            ),
          ),
          const SizedBox(width: FieldSpace.s2),
          OutlinedButton(onPressed: _addAlias, child: const Text('Add')),
        ],
      ),
      const SizedBox(height: FieldSpace.s4),
      Semantics(header: true, child: Text('Legal name, if given', style: Theme.of(context).textTheme.titleMedium)),
      const SizedBox(height: FieldSpace.s2),
      Focus(
        onFocusChange: (has) {
          if (has) return;
          // The given name fills "What do they go by?" when that is empty (11.1 #4).
          if (!_isEdit && _preferred.text.trim().isEmpty && _given.text.trim().isNotEmpty && !_givenFocus.hasFocus) {
            setState(() => _preferred.text = _given.text.trim());
          }
          unawaited(_check());
        },
        child: large
            ? Column(
                children: [
                  given,
                  const SizedBox(height: FieldSpace.s3),
                  family,
                ],
              )
            : Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: given),
                  const SizedBox(width: FieldSpace.s3),
                  Expanded(child: family),
                ],
              ),
      ),
      if (givenLocked || familyLocked) ...[const SizedBox(height: FieldSpace.s1), const _AdminOnly()],
    ];
  }

  // ---- birth (11.3) ----

  List<Widget> _birthSection(DateTime today) {
    final v = _view;
    final current = v?.birth;
    final locked = v != null && current is BirthDate;
    final estimate = current is BirthEstimate ? current : null;
    final refined = _birth.birth;
    final far =
        estimate != null &&
        refined != null &&
        refined is! BirthEstimate &&
        (refined.year - estimate.year).abs() > estimateRange;
    return [
      const SectionHeading('Date of birth or age'),
      if (locked)
        _LockedValue(label: 'Date of birth', value: readBack(current, today).split(' · ').first)
      else ...[
        if (current != null) ...[
          Text('Recorded now: ${readBack(current, today)}', style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: FieldSpace.s2),
        ],
        BirthField(
          today: today,
          initial: _birth,
          focusNode: _birthFocus,
          helper: !_editable('birth')
              ? _needsFull
              : current is BirthYear
              ? 'Add the day and month if they give them.'
              : estimate != null
              ? 'Replace the estimate with the year or date they give.'
              : null,
          onChanged: (e) => setState(() => _birth = e),
          onFocusLost: () => unawaited(_check()),
        ),
        if (far) ...[
          const SizedBox(height: FieldSpace.s2),
          const StatusBanner(
            icon: LucideIcons.info,
            tone: ChipTone.warning,
            text: 'That’s more than 3 years from the estimate. A Program Admin will check it.',
          ),
        ],
      ],
      if (locked) ...[const SizedBox(height: FieldSpace.s1), const _AdminOnly()],
    ];
  }

  // ---- how to recognise them ----

  List<Widget> _lookSection() => [
    const SectionHeading('What they look like'),
    PhiField(
      name: 'visualDescriptor',
      label: 'What they look like',
      controller: _descriptor,
      focusNode: _descriptorFocus,
      maxLines: 3,
      minLines: 1,
      maxLength: 200,
      capitalization: TextCapitalization.sentences,
      enabled: _editable('visualDescriptor'),
      helper: _editable('visualDescriptor')
          ? 'Lasting things help most: height, tattoos, a wheelchair, a scar. Clothes change.'
          : _needsFull,
    ),
    const SizedBox(height: FieldSpace.s3),
    PhiField(
      name: 'usualArea',
      label: 'Usually found',
      controller: _area,
      maxLength: 200,
      capitalization: TextCapitalization.sentences,
      enabled: _editable('usualArea'),
      helper: _editable('usualArea') ? null : _needsFull,
    ),
  ];

  // ---- living situation (11.4) and language ----

  List<Widget> _livingSection() => [
    const SectionHeading('Living situation'),
    if (!_editable('livingSituation'))
      const Text(_needsFull)
    else ...[
      RadioChips<String>(
        options: livingSituationLabels,
        selected: _living,
        spoken: (v, on) => v == 'other' && on ? 'Other, selected, text box below' : livingSituationLabels[v]!,
        onSelected: (v) {
          setState(() => _living = v);
          if (v == 'other') WidgetsBinding.instance.addPostFrameCallback((_) => _livingOtherFocus.requestFocus());
        },
      ),
      if (_living == 'other') ...[
        const SizedBox(height: FieldSpace.s3),
        PhiField(
          name: 'livingOther',
          label: 'Other living situation',
          controller: _livingOther,
          focusNode: _livingOtherFocus,
          maxLength: 200,
          capitalization: TextCapitalization.sentences,
          error: _errors.isNotEmpty && _livingOtherMissing ? 'Say what “Other” means.' : null,
        ),
      ],
    ],
    const SectionHeading('Preferred language'),
    if (!_editable('preferredLanguage'))
      const Text(_needsFull)
    else
      DropdownButtonFormField<String?>(
        initialValue: _language,
        isExpanded: true,
        decoration: const InputDecoration(labelText: 'Preferred language'),
        items: [
          const DropdownMenuItem(value: null, child: Text('Not recorded')),
          for (final MapEntry(:key, :value) in languageLabels.entries) DropdownMenuItem(value: key, child: Text(value)),
        ],
        onChanged: (v) => setState(() => _language = v),
      ),
  ];

  // ---- allergies ----

  List<Widget> _allergySection() {
    final v = _view;
    final listed = [
      for (final a in v?.allergies ?? const <AllergyView>[])
        if (a.active) a,
    ];
    return [
      const SectionHeading('Allergies'),
      for (final a in listed)
        Padding(
          padding: const EdgeInsets.only(bottom: FieldSpace.s1),
          child: Text(
            '${a.substance}${a.severity == null ? '' : ' · ${allergySeverityLabels[a.severity] ?? a.severity}'}',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
        ),
      RadioChips<_Allergies>(
        options: {
          if (listed.isEmpty && _allergies.isEmpty) _Allergies.notAsked: 'Not asked yet',
          if (listed.isEmpty && _allergies.isEmpty) _Allergies.noneKnown: 'No known allergies',
          _Allergies.adding: 'Add allergy',
        },
        selected: _allergyScreen,
        enabled: _editable('allergyScreen') || _allergyScreen == _Allergies.adding,
        onSelected: (v) => setState(() => _allergyScreen = v),
      ),
      for (final (i, a) in _allergies.indexed)
        _ListItem(
          text: [
            a.substance,
            if (a.category != null) allergyCategoryLabels[a.category],
            if (a.severity != null) allergySeverityLabels[a.severity],
            ?a.reaction,
          ].join(' · '),
          action: 'Remove',
          spoken: 'Remove allergy ${a.substance}',
          onPressed: () => setState(() => _allergies.removeAt(i)),
        ),
      if (_allergyScreen == _Allergies.adding) ...[
        const SizedBox(height: FieldSpace.s3),
        PhiField(name: 'allergySubstance', label: 'Allergic to', controller: _substance, focusNode: _substanceFocus),
        const SizedBox(height: FieldSpace.s3),
        RadioChips<String>(
          label: 'Kind',
          options: allergyCategoryLabels,
          selected: _category,
          onSelected: (v) => setState(() => _category = v),
        ),
        const SizedBox(height: FieldSpace.s3),
        RadioChips<String>(
          label: 'How bad',
          options: allergySeverityLabels,
          selected: _severity,
          onSelected: (v) => setState(() => _severity = v),
        ),
        const SizedBox(height: FieldSpace.s3),
        PhiField(
          name: 'allergyReaction',
          label: 'Reaction (optional)',
          controller: _reaction,
          maxLength: 200,
          capitalization: TextCapitalization.sentences,
        ),
        const SizedBox(height: FieldSpace.s2),
        WideButton(label: 'Add this allergy', icon: LucideIcons.plus, onPressed: _addAllergy),
      ],
    ];
  }

  // ---- the ID card question ----

  List<Widget> _cardSection(bool paused) => [
    const SectionHeading('Street Medicine ID card'),
    RadioChips<IdCardAnswer>(
      options: const {
        IdCardAnswer.wants: 'Wants a card',
        IdCardAnswer.declines: 'Declines',
        IdCardAnswer.askLater: 'Ask later',
      },
      selected: _card,
      onSelected: (v) => setState(() => _card = v),
    ),
    if (_card == IdCardAnswer.wants) ...[
      const SizedBox(height: FieldSpace.s2),
      Text(
        paused
            ? 'The card can be made once the phone’s clock is right.'
            : 'The card is made when you create the patient, and works on this phone at once.',
        style: Theme.of(context).textTheme.bodyLarge,
      ),
    ],
  ];
}

class _ErrorList extends StatelessWidget {
  const _ErrorList({required this.errors, required this.onTap});
  final List<({String message, FocusNode? focus, GlobalKey? key})> errors;
  final void Function(({String message, FocusNode? focus, GlobalKey? key})) onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(FieldSpace.s3),
        decoration: BoxDecoration(
          color: c.criticalSoft,
          border: Border.all(color: c.critical, width: 2),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              errors.length == 1 ? 'One thing to fix' : '${errors.length} things to fix',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(color: c.critical),
            ),
            for (final e in errors)
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: c.ink,
                  alignment: Alignment.centerLeft,
                  padding: EdgeInsets.zero,
                ),
                onPressed: () => onTap(e),
                child: Text(
                  e.message,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(decoration: TextDecoration.underline),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A recorded legal name part or birth date on the edit form: read-only, with a lock, announced as
/// "Legal name, Delbert Smithfield, locked. Only a Program Admin can correct this."
class _LockedValue extends StatelessWidget {
  const _LockedValue({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    return Semantics(
      label: '$label, $value, locked. Only a Program Admin can correct this.',
      excludeSemantics: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(FieldSpace.s3),
        decoration: BoxDecoration(
          color: c.surfaceSunken,
          border: Border.all(color: c.lineStrong),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: Row(
          children: [
            Icon(LucideIcons.lock, size: 20, color: c.ink),
            const SizedBox(width: FieldSpace.s2),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: text.bodyMedium?.copyWith(color: c.inkMuted)),
                  Text(value, style: text.bodyLarge),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AdminOnly extends StatelessWidget {
  const _AdminOnly();
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: Text('Only a Program Admin can correct this.', style: Theme.of(context).textTheme.bodyMedium),
  );
}

/// A row of a list on the form with its 48 px action.
class _ListItem extends StatelessWidget {
  const _ListItem({required this.text, required this.action, required this.spoken, required this.onPressed});
  final String text;
  final String action;
  final String spoken;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: FieldSpace.s1),
    child: Row(
      children: [
        Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyLarge)),
        TextButton(
          onPressed: onPressed,
          child: Semantics(label: spoken, excludeSemantics: true, child: Text(action)),
        ),
      ],
    ),
  );
}
