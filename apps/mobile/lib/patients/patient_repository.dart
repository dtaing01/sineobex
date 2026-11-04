import 'dart:convert';

import 'package:uuid/data.dart';
import 'package:uuid/rng.dart';
import 'package:uuid/uuid.dart';

import '../api/generated/api.dart' show ConsentView, DuplicateHint, FieldReviewView, PatientChartMergedFromItem;
import '../api/transport.dart';
import '../sync/entities.dart'
    show allergyCategories, allergySeverities, isBlankField, livingSituations, patientFieldNames;
import '../sync/local_store.dart';
import 'chart_cache.dart';
import 'consent_script.dart';
import 'display.dart';
import 'dob.dart';
import 'id_links.dart';
import 'normalize.dart';
import 'patient_search.dart' show addSearchName, writeSearchNames;
import 'problems.dart';
import 'team_index.dart';

/// Patients on the phone (design sections 6.5, 7, 11): opening a chart (online, from the cache, or
/// from the index while offline, each read audited), what a chart shows, and the intake and edits
/// that change it. Every change is a sync change in P1's store, checked there as the server would
/// check it; a refused one stays in Needs attention with what depends on it held.

/// How much of a chart this phone holds.
enum ChartCopy {
  /// The whole chart, downloaded (with field versions for offline edits).
  full,

  /// Opened from the index while offline (6.5): only the index's fields. "The full chart opens when
  /// the phone reconnects."
  partial,

  /// Made on this phone; what it holds is what was typed.
  local,
}

/// A street name. A merged record's preferred name is listed too, without an ID: it is no street
/// name record and is never offered for removal.
class AliasView {
  const AliasView({
    required this.id,
    required this.alias,
    required this.active,
    this.removedReason,
    this.pending = false,
  });
  final String? id;
  final String alias;
  final bool active;
  final String? removedReason;

  /// Added or removed here, not synced yet.
  final bool pending;
  bool get mergedName => id == null;
}

/// An allergy, with every detail the profile's Allergies section shows.
class AllergyView {
  const AllergyView({
    required this.id,
    required this.substance,
    required this.category,
    required this.severity,
    required this.reaction,
    required this.active,
    this.enteredInErrorReason,
    this.pending = false,
  });
  final String id;
  final String substance;
  final String? category;
  final String? severity;
  final String? reaction;

  /// False once marked entered in error (listed with its reason, never on the badge).
  final bool active;
  final String? enteredInErrorReason;
  final bool pending;
}

/// A consent decision on record (11.2).
class ConsentRecord {
  const ConsentRecord({
    required this.id,
    required this.kind,
    required this.decision,
    required this.method,
    this.recordedAt,
    this.recordedByName,
    this.pending = false,
  });
  final String id;

  /// `care_and_record` or `privacy_notice`.
  final String kind;
  final String decision;
  final String? method;
  final DateTime? recordedAt;
  final String? recordedByName;
  final bool pending;
}

/// A patient's chart as the profile and the edit form read it.
class PatientView {
  const PatientView({
    required this.patientId,
    required this.canonicalId,
    required this.mergedInto,
    required this.copy,
    required this.fields,
    required this.versions,
    required this.pendingFields,
    required this.editableFields,
    required this.aliases,
    required this.allergies,
    required this.badge,
    required this.consents,
    required this.consentNotRecorded,
    required this.problems,
    required this.duplicate,
    required this.reviewFields,
    required this.reviews,
    required this.cards,
    required this.notSynced,
    required this.lastSeenOn,
    required this.mergedFrom,
    required this.downloadFailed,
  });

  /// The ID that was opened.
  final String patientId;

  /// The chart that holds it now, as this phone knows.
  final String canonicalId;

  /// When [patientId] was merged into another chart: banner "This chart was merged into another on
  /// Oct 21. Open the combined chart." Editing from it is off.
  final PatientRedirect? mergedInto;
  final ChartCopy copy;

  /// The patient's fields by sync name, as the person sees them (their own edits included). A legal
  /// name is here only for a full chart or one made here (D40).
  final Map<String, Object?> fields;

  /// The server version each field's next edit builds on.
  final Map<String, int> versions;

  /// Fields with an edit made here that isn't synced yet.
  final Set<String> pendingFields;

  /// What Edit offers: every field on a full or local chart (the identity rules still apply), only
  /// the index's versioned fields on a partial one.
  final Set<String> editableFields;
  final List<AliasView> aliases;
  final List<AllergyView> allergies;
  final AllergyBadge badge;
  final List<ConsentRecord> consents;

  /// "Consent not recorded yet. Ask at the next visit": the latest care-and-record decision is
  /// unable. **Record consent now** on the profile.
  final bool consentNotRecorded;

  /// Null when the role doesn't see the problem list, or the chart is partial.
  final List<ProblemView>? problems;

  /// "Possible duplicate under review", with the reviewer's Not sure note.
  final DuplicateHint? duplicate;

  /// Fields with an open review ("Two values recorded").
  final List<String> reviewFields;

  /// The reviews themselves, with the values kept (a full chart only).
  final List<FieldReviewView> reviews;
  final List<IdCard> cards;

  /// "Not synced yet": the patient's create waits here.
  final bool notSynced;

  /// YYYY-MM-DD.
  final String? lastSeenOn;
  final List<PatientChartMergedFromItem> mergedFrom;

  /// "Part of this chart hasn't downloaded yet."
  final bool downloadFailed;

  String? get preferredName => fields['preferredName'] as String?;
  ({String? given, String? family})? get legalName {
    final v = fields['legalName'];
    return v is Map<String, Object?> ? (given: v['given'] as String?, family: v['family'] as String?) : null;
  }

  Birth? get birth => Birth.fromJson(fields['birth']);
  String? get visualDescriptor => fields['visualDescriptor'] as String?;
  String? get usualArea => fields['usualArea'] as String?;
  String? get preferredLanguage => fields['preferredLanguage'] as String?;
  ({String kind, String? other})? get livingSituation {
    final v = fields['livingSituation'];
    return v is Map<String, Object?> ? (kind: v['kind']! as String, other: v['other'] as String?) : null;
  }

  /// `not_asked` or `none_known`.
  String get allergyScreen => fields['allergyScreen'] as String? ?? 'not_asked';

  /// `not_asked`, `wants` or `declined`.
  String get idCardChoice => fields['idCardChoice'] as String? ?? 'not_asked';

  /// The cards that open this chart now.
  List<IdCard> get workingCards => [
    for (final c in cards)
      if (c.working) c,
  ];

  /// "Make the card once the phone's clock is right": the intake wanted a card and none was made.
  bool get cardWanted => idCardChoice == 'wants' && cards.isEmpty;

  /// Recorded legal name and birth parts are corrected only by a Program Admin (11.5); blank parts
  /// may be filled.
  bool isLocked(String field) => (field == 'legalName' || field == 'birth') && !isBlankField(field, fields[field]);
}

/// A new allergy as the intake or the profile collects it.
class NewAllergy {
  const NewAllergy({required this.substance, this.category, this.severity, this.reaction});
  final String substance;

  /// One of `drug`, `food`, `environment`, `other`, `unknown`.
  final String? category;

  /// One of `mild`, `moderate`, `severe`, `unknown`.
  final String? severity;
  final String? reaction;

  Map<String, Object?> value(String patientId) {
    final s = substance.trim();
    final r = reaction?.trim();
    if (s.isEmpty || s.length > 120) {
      throw const LocalValidationError('Name the allergy (up to 120 characters).', paths: {'substance'});
    }
    if (category != null && !allergyCategories.contains(category)) throw ArgumentError('unknown allergy category');
    if (severity != null && !allergySeverities.contains(severity)) throw ArgumentError('unknown allergy severity');
    return {
      'patientId': patientId,
      'substance': s,
      'category': ?category,
      'severity': ?severity,
      if (r != null && r.isNotEmpty) 'reaction': r,
    };
  }
}

/// The Street Medicine ID card question at intake.
enum IdCardAnswer { wants, declines, askLater }

/// What the intake form collected (11.1). Text is trimmed here; empty text counts as not given.
class Intake {
  const Intake({
    required this.consent,
    this.privacyNotice = PrivacyNoticeDecision.acknowledged,
    this.privacyNoticeReason,
    this.language = 'en',
    this.preferredName,
    this.legalGiven,
    this.legalFamily,
    this.birth,
    this.visualDescriptor,
    this.usualArea,
    this.livingSituation,
    this.livingSituationOther,
    this.preferredLanguage,
    this.aliases = const [],
    this.noKnownAllergies = false,
    this.allergies = const [],
    this.idCard = IdCardAnswer.askLater,
    this.matchCheck,
  });

  final ConsentAnswer consent;
  final PrivacyNoticeDecision privacyNotice;
  final String? privacyNoticeReason;

  /// The language the script was read in (a BCP 47 tag).
  final String language;
  final String? preferredName;
  final String? legalGiven;
  final String? legalFamily;
  final Birth? birth;
  final String? visualDescriptor;
  final String? usualArea;

  /// One of the 11.4 kinds; `other` takes [livingSituationOther].
  final String? livingSituation;
  final String? livingSituationOther;
  final String? preferredLanguage;
  final List<String> aliases;
  final bool noKnownAllergies;
  final List<NewAllergy> allergies;
  final IdCardAnswer idCard;

  /// [MatchRun.matchCheck] of the last check shown, with what was dismissed.
  final Map<String, Object?>? matchCheck;
}

/// What Create made.
class IntakeResult {
  const IntakeResult({required this.patientId, this.cardId, this.cardWaitsForClock = false});
  final String patientId;

  /// The new card, when they wanted one and the clock allowed it.
  final String? cardId;

  /// They wanted a card while charting was paused for the clock: the patient is saved with
  /// "wants" and no card; Make a card works once the clock check passes (review finding 17).
  final bool cardWaitsForClock;
}

String? _text(String? s) {
  final t = s?.trim();
  return t == null || t.isEmpty ? null : t;
}

/// Patients for one team's store.
class PatientRepository {
  PatientRepository(
    this.store, {
    required this.index,
    required this.charts,
    required this.idLinks,
    required this.problems,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final LocalStore store;
  final TeamIndex index;
  final ChartCache charts;
  final IdLinks idLinks;
  final Problems problems;
  final DateTime Function() _now;

  /// Called after a change made through this repository, so screens re-read.
  void Function()? onChanged;

  static const _uuid = Uuid(goptions: GlobalOptions(CryptoRNG()));
  static const draftKey = 'intake.draft';

  /// The fields an index entry carries with versions: all a partial chart can edit (6.5).
  static const partialFields = {'preferredName', 'visualDescriptor', 'usualArea', 'allergyScreen'};

  // ---- opening and reading ----

  /// Opens a chart (design 6.5, 7.1). Online, one download shows it and keeps it for 24 hours (the
  /// server audits it). Offline, or when the server is slow: the phone's copy, or, for a patient
  /// only in the index, a partial copy made from the entry; either way `patient.viewed` with its
  /// source is appended in the same transaction as the read, so a store that can't log (frozen)
  /// shows nothing. Returns null when the phone has nothing for [patientId].
  Future<PatientView?> open(String patientId) async {
    if (store.frozen) throw ChartingPaused(store.frozenMessage!);
    try {
      if (await charts.open(patientId)) {
        onChanged?.call();
        return read(patientId);
      }
    } on NetworkException {
      // Offline: the phone's own copy below.
    } on ApiException catch (e) {
      if (e.status < 500) rethrow;
    }
    return openOnPhone(patientId);
  }

  /// The offline half of [open].
  PatientView? openOnPhone(String patientId) {
    if (store.frozen) throw ChartingPaused(store.frozenMessage!);
    final view = store.transaction(() {
      final canonical = store.canonicalPatient(patientId);
      final meta = chartMetaOf(store, canonical);
      final String source;
      if (store.record(canonical) != null && meta?.partial != true) {
        source = meta == null ? 'local' : 'cache';
      } else {
        final entry = index.entry(canonical);
        if (entry == null && store.record(canonical) == null) return null;
        if (entry != null) importIndexEntry(store, entry, now: _now());
        store.addScope(canonical);
        source = 'team_index';
      }
      store.appendAudit(
        'patient.viewed',
        entity: entityPatient,
        entityId: canonical,
        patientId: canonical,
        source: source,
      );
      return read(patientId);
    });
    onChanged?.call();
    return view;
  }

  /// The chart as the phone holds it now, for a chart already opened (and audited) on screen. Null
  /// when the phone holds no record of it.
  PatientView? read(String patientId) {
    final canonical = store.canonicalPatient(patientId);
    final group = patientGroup(store, canonical);
    final rec =
        store.record(canonical) ?? group.map(store.record).nonNulls.where((r) => r.entity == entityPatient).firstOrNull;
    if (rec == null) return null;
    final meta = chartMetaOf(store, rec.id);
    final copy = meta == null
        ? ChartCopy.local
        : meta.partial
        ? ChartCopy.partial
        : ChartCopy.full;
    final outbox = store.outbox();
    final waiting = {for (final e in outbox) e.recordId};
    final fields = <String, Object?>{
      for (final MapEntry(:key, :value) in rec.fields.entries)
        if (key != chartMetaField) key: value.value,
      if (copy == ChartCopy.partial && rec.fields['birth'] == null) 'birth': meta!.indexBirth,
    };
    final aliases = <AliasView>[];
    final allergies = <AllergyView>[];
    final consents = <ConsentRecord>[
      for (final c in meta?.consents ?? const <ConsentView>[])
        ConsentRecord(
          id: c.id,
          kind: c.kind.wire,
          decision: c.decision.wire,
          method: c.method.wire,
          recordedAt: c.recordedAt,
          recordedByName: c.recordedBy.displayName,
        ),
    ];
    final aliasIds = meta?.aliasIds.toSet();
    final allergyIds = meta?.allergyIds.toSet();
    for (final p in group) {
      for (final id in store.recordIdsOfPatient(p)) {
        final r = store.record(id);
        if (r == null) continue;
        final mine = r.origin == 'local';
        switch (r.entity) {
          case entityAlias when aliasIds == null || aliasIds.contains(id) || mine:
            final removal = r.fields['removal']?.value;
            aliases.add(
              AliasView(
                id: id,
                alias: r.attributes['alias'] as String? ?? '',
                active: r.status == 'active' && removal == null,
                removedReason: removal is Map<String, Object?> ? removal['reason'] as String? : null,
                pending: waiting.contains(id),
              ),
            );
          case entityAllergy when allergyIds == null || allergyIds.contains(id) || mine:
            final error = r.fields['enteredInError']?.value;
            allergies.add(
              AllergyView(
                id: id,
                substance: r.attributes['substance'] as String? ?? '',
                category: r.attributes['category'] as String?,
                severity: r.attributes['severity'] as String?,
                reaction: r.attributes['reaction'] as String?,
                active: r.status == 'active' && error == null,
                enteredInErrorReason: error is Map<String, Object?> ? error['reason'] as String? : null,
                pending: waiting.contains(id),
              ),
            );
          case entityConsent when !consents.any((c) => c.id == id):
            consents.add(
              ConsentRecord(
                id: id,
                kind: r.attributes['kind'] as String? ?? 'care_and_record',
                decision: r.attributes['decision'] as String? ?? '',
                method: r.attributes['method'] as String?,
                pending: waiting.contains(id),
              ),
            );
        }
      }
    }
    // A patient made here carries its two consents in its create until a chart lists them.
    if (copy == ChartCopy.local) {
      for (final (kind, key) in [('care_and_record', 'consent'), ('privacy_notice', 'privacyNotice')]) {
        final c = rec.attributes[key];
        if (c is Map<String, Object?> && !consents.any((x) => x.id == c['id'])) {
          consents.insert(
            0,
            ConsentRecord(
              id: c['id']! as String,
              kind: kind,
              decision: c['decision']! as String,
              method: c['method'] as String?,
              pending: waiting.contains(rec.id),
            ),
          );
        }
      }
    }
    for (final name in meta?.mergedNames ?? const <String>[]) {
      aliases.add(AliasView(id: null, alias: name, active: true));
    }
    aliases.sort((a, b) => a.active == b.active ? 0 : (a.active ? -1 : 1));
    final care = [
      for (final c in consents)
        if (c.kind == 'care_and_record') c,
    ];
    final active = [
      for (final a in allergies)
        if (a.active) (substance: a.substance, severity: a.severity),
    ];
    final redirect = patientId == canonical ? null : store.redirects()[patientId];
    return PatientView(
      patientId: patientId,
      canonicalId: canonical,
      mergedInto: redirect,
      copy: copy,
      fields: fields,
      versions: {
        for (final MapEntry(:key, :value) in rec.fields.entries)
          if (key != chartMetaField) key: value.serverVersion,
      },
      pendingFields: {
        for (final MapEntry(:key, :value) in rec.fields.entries)
          if (key != chartMetaField && !value.confirmed) key,
      },
      editableFields: copy == ChartCopy.partial ? partialFields : patientFieldNames.toSet(),
      aliases: aliases,
      allergies: allergies,
      badge: allergyBadge(active, screen: fields['allergyScreen'] as String?),
      consents: consents,
      consentNotRecorded: care.isNotEmpty && care.last.decision == 'unable',
      problems: copy == ChartCopy.partial ? null : problems.problemsOf(canonical),
      duplicate: meta?.duplicate,
      reviewFields: meta?.reviewFields ?? const [],
      reviews: meta?.reviews ?? const [],
      cards: idLinks.cards(canonical),
      notSynced: outbox.any((e) => e.recordId == rec.id && e.op == 'create'),
      lastSeenOn: meta?.lastSeenOn,
      mergedFrom: meta?.mergedFrom ?? const [],
      downloadFailed: charts.downloadFailed(canonical),
    );
  }

  // ---- intake (11.1) ----

  /// **Create patient**: one SQLite transaction holds the patient create (with its two consents and
  /// the match check), each street name, each allergy, the ID card when wanted, the search names
  /// (origin `local`: preferred name, street names, description; never the legal name, D40) and the
  /// `opened` scope; the draft goes with it. A killed app never leaves half an intake. The clock
  /// never fails an intake: a card wanted while charting is paused waits ([IntakeResult]).
  IntakeResult createPatient(Intake i) {
    if (i.aliases.length > 20) {
      throw const LocalValidationError('Up to 20 street names.', problem: 'too_many_aliases');
    }
    if (i.noKnownAllergies && i.allergies.isNotEmpty) {
      throw const LocalValidationError('Choose No known allergies or add allergies, not both.');
    }
    final living = i.livingSituation;
    if (living != null && !livingSituations.contains(living)) throw ArgumentError('unknown living situation');
    final given = _text(i.legalGiven), family = _text(i.legalFamily);
    final value = <String, Object?>{
      'preferredName': ?_text(i.preferredName),
      if (given != null || family != null) 'legalName': {'given': given, 'family': family},
      'visualDescriptor': ?_text(i.visualDescriptor),
      if (i.birth != null) 'birth': i.birth!.toJson(),
      if (living != null)
        'livingSituation': {'kind': living, if (living == 'other') 'other': ?_text(i.livingSituationOther)},
      'usualArea': ?_text(i.usualArea),
      'preferredLanguage': ?_text(i.preferredLanguage),
      if (i.noKnownAllergies) 'allergyScreen': 'none_known',
      if (i.idCard != IdCardAnswer.askLater) 'idCardChoice': i.idCard == IdCardAnswer.wants ? 'wants' : 'declined',
      'consent': registrationConsent(_uuid.v4(), i.consent, language: i.language),
      'privacyNotice': privacyNotice(_uuid.v4(), i.privacyNotice, reason: i.privacyNoticeReason),
      'matchCheck': ?i.matchCheck,
    };
    final result = store.transaction(() {
      final id = store.createRecord(entityPatient, value);
      final aliases = [
        for (final a in i.aliases)
          if (_text(a) != null) _text(a)!,
      ];
      for (final a in aliases) {
        store.createRecord(entityAlias, {'patientId': id, 'alias': a});
      }
      for (final a in i.allergies) {
        store.createRecord(entityAllergy, a.value(id));
      }
      String? card;
      var waits = false;
      if (i.idCard == IdCardAnswer.wants) {
        if (store.chartingPaused) {
          waits = true;
        } else {
          try {
            card = idLinks.makeCard(id, reason: 'first_card');
          } on ChartingPaused {
            waits = true;
          }
        }
      }
      writeSearchNames(
        store.database,
        id,
        'local',
        preferred: value['preferredName'] as String?,
        aliases: aliases,
        descriptor: value['visualDescriptor'] as String?,
      );
      store.setKv(draftKey, '');
      return IntakeResult(patientId: id, cardId: card, cardWaitsForClock: waits);
    });
    onChanged?.call();
    return result;
  }

  /// The intake left before Create, kept in the encrypted database (11.1). It may hold what was
  /// typed, a legal name included, until Create or Discard.
  Map<String, Object?>? draft() {
    final v = store.kv(draftKey);
    if (v == null || v.isEmpty) return null;
    final d = jsonDecode(v);
    return d is Map<String, Object?> && d.isNotEmpty ? d : null;
  }

  void saveDraft(Map<String, Object?> draft) => store.setKv(draftKey, jsonEncode(draft));
  void discardDraft() => store.setKv(draftKey, '');

  // ---- edit (11.5) ----

  String _recordOf(String patientId) {
    final canonical = store.canonicalPatient(patientId);
    if (store.record(canonical)?.entity == entityPatient) return canonical;
    if (store.record(patientId)?.entity == entityPatient) return patientId;
    throw StateError('open the chart first');
  }

  /// The edit form is on screen: the record stays open, so nothing is purged under it.
  void startEditing(String patientId) => store.reopen(_recordOf(patientId));

  /// The form closed (Update and save, or back): the record closes and the `opened` scope keeps the
  /// chart for 24 hours.
  void finishEditing(String patientId) => store.closeRecord(_recordOf(patientId));

  /// **Update and save**: one `set` per changed field (sync names, values as the server takes them;
  /// text trimmed, empty text cleared), each with the version the form loaded, in one transaction.
  /// Unchanged fields send nothing. Values that add come before values that clear, so the person
  /// can swap a name for a description in one save. The store refuses what the server would: the
  /// last name or description cleared (`nothing_to_recognise`), a recorded legal name or birth
  /// changed (`identity_admin_only`). On a partial chart only the index's fields can change
  /// (`needs_full_chart`).
  void update(String patientId, Map<String, Object?> changes) {
    final id = _recordOf(patientId);
    final meta = chartMetaOf(store, id);
    final allowed = meta?.partial == true ? partialFields : patientFieldNames.toSet();
    final values = <String, Object?>{
      for (final MapEntry(:key, :value) in changes.entries) key: value is String ? _text(value) : value,
    };
    for (final field in values.keys) {
      if (!patientFieldNames.contains(field)) throw ArgumentError('not a patient field: $field');
      if (!allowed.contains(field)) {
        throw const LocalValidationError(
          'This needs the full chart. Connect to download it.',
          problem: 'needs_full_chart',
        );
      }
    }
    if (values['allergyScreen'] == 'none_known' && read(id)!.allergies.any((a) => a.active)) {
      throw const LocalValidationError(
        'An allergy is listed. Mark it entered in error before choosing No known allergies.',
        problem: 'allergy_listed',
      );
    }
    final ordered = [
      for (final f in values.keys)
        if (!isBlankField(f, values[f])) f,
      for (final f in values.keys)
        if (isBlankField(f, values[f])) f,
    ];
    store.transaction(() {
      for (final field in ordered) {
        store.setField(id, field, values[field]);
        if (field == 'preferredName' || field == 'visualDescriptor') {
          addSearchName(
            store.database,
            id,
            'local',
            field == 'preferredName' ? 'preferred' : 'descriptor',
            values[field] as String?,
          );
        }
      }
    });
    onChanged?.call();
  }

  /// **Attach to another patient** (Needs attention, for a create refused because its patient is
  /// missing on the server): the same street name, allergy, consent or problem, made again for
  /// [patientId] and sent as the fix of the refused one (`replaceRejected`), which settles it once
  /// confirmed. A street name's own search row moves with it. A card is never moved: its fix is a
  /// new card ([IdLinks.replaceRejected]). Returns the new record's ID.
  String attachToPatient(String changeId, String patientId) {
    final refused = store.entry(changeId);
    if (refused == null || refused.op != 'create') throw StateError('not a refused create');
    if (refused.entity == entityIdLink) throw ArgumentError('a card is fixed with a new card');
    final value = refused.value;
    if (value is! Map<String, Object?> || !value.containsKey('patientId')) {
      throw ArgumentError('this change names no patient');
    }
    final from = value['patientId']! as String;
    final target = store.canonicalPatient(patientId);
    final id = store.transaction(() {
      final id = store.replaceRejected(changeId, entity: refused.entity, value: {...value, 'patientId': target});
      if (refused.entity == entityAlias) {
        final alias = value['alias'] as String?;
        final norm = normalizeName(alias);
        final kept = store
            .recordIdsOfPatient(from)
            .map(store.record)
            .any(
              (r) => r != null && r.entity == entityAlias && normalizeName(r.attributes['alias'] as String?) == norm,
            );
        if (norm != null && !kept) {
          store.database.execute(
            "DELETE FROM patient_names WHERE patient_id = ? AND origin = 'local' AND source = 'alias' AND name = ?",
            [from, norm],
          );
        }
        addSearchName(store.database, target, 'local', 'alias', alias);
      }
      return id;
    });
    onChanged?.call();
    return id;
  }

  /// A street name, added to the chart open on screen (the ID it was opened under: if that patient
  /// was merged since, the server stores it as sent, 2.7).
  String addAlias(String patientId, String alias) {
    final a = _text(alias);
    if (a == null || a.length > 60) {
      throw const LocalValidationError('A street name is 1 to 60 characters.', paths: {'alias'});
    }
    final view = read(patientId);
    if (view != null && view.aliases.where((x) => x.active && !x.mergedName).length >= 20) {
      throw const LocalValidationError('A person can have up to 20 street names.', problem: 'too_many_aliases');
    }
    final target = store.canonicalPatient(patientId);
    final id = store.transaction(() {
      final id = store.createRecord(entityAlias, {'patientId': target, 'alias': a});
      addSearchName(store.database, target, 'local', 'alias', a);
      return id;
    });
    onChanged?.call();
    return id;
  }

  /// Removes a street name, with a reason ("Wrong patient" undoes work on the wrong Mike, 6.5).
  void removeAlias(String aliasId, String reason) {
    store.setField(aliasId, 'removal', {'reason': _reason(reason)});
    onChanged?.call();
  }

  /// An allergy recorded for the patient.
  String addAllergy(String patientId, NewAllergy allergy) {
    final id = store.createRecord(entityAllergy, allergy.value(store.canonicalPatient(patientId)));
    onChanged?.call();
    return id;
  }

  /// Marks an allergy entered in error, with a reason (`encounters.chart`; held for review without).
  void allergyEnteredInError(String allergyId, String reason) {
    store.setField(allergyId, 'enteredInError', {'reason': _reason(reason)});
    onChanged?.call();
  }

  /// **Record consent now** (11.2): a later care-and-record decision.
  String recordConsent(String patientId, ConsentAnswer answer, {String language = 'en'}) {
    final id = store.createRecord(
      entityConsent,
      laterConsent(store.canonicalPatient(patientId), answer, language: language),
    );
    onChanged?.call();
    return id;
  }

  /// A later privacy notice decision.
  String recordPrivacyNotice(
    String patientId,
    PrivacyNoticeDecision decision, {
    String language = 'en',
    String? reason,
  }) {
    final id = store.createRecord(
      entityConsent,
      laterPrivacyNotice(store.canonicalPatient(patientId), decision, language: language, reason: reason),
    );
    onChanged?.call();
    return id;
  }

  static String _reason(String reason) {
    final r = reason.trim();
    if (r.length < 3 || r.length > 300) {
      throw const LocalValidationError('Give a short reason (3 to 300 characters).', paths: {'reason'});
    }
    return r;
  }
}
