/// Referrals (phase 4 design, lifecycle 4.7, 7, 9.10): "a referral records only a date and free-text
/// details" (PRD main 113, 507). The Referrals sheet, from the patient profile or an encounter's
/// summary screen, lists a patient's referrals and adds one; a row's menu marks one entered in
/// error. A referral is a patient-side record: made offline, it joins the patient's local work and
/// shows at once as "Waiting to send". It never waits for the clock check (3.11): its date is the one
/// the person picks. Every change goes through the store, which holds the API's values and rules.
library;

import '../api/generated/api.dart' show RecordSnapshot;
import '../patients/chart_cache.dart' show chartMetaOf, patientGroup;
import '../patients/problems.dart' show shownAtVisit;
import '../sync/entities.dart' show entityReferral;
import '../sync/local_store.dart';
import '../sync/sync_engine.dart' show serverRecordFrom;
import 'credentials.dart';
import 'encounter_models.dart';

/// A referral as the sheet, the timeline and the visit show it.
class ReferralView {
  const ReferralView({
    required this.id,
    required this.patientId,
    required this.referredOn,
    required this.details,
    required this.encounterId,
    required this.atVisit,
    required this.recordedBy,
    required this.recordedAt,
    required this.enteredInError,
    required this.markWaiting,
    required this.sending,
  });

  final String id;
  final String patientId;

  /// The date picked, `YYYY-MM-DD`.
  final String referredOn;
  final String details;

  /// The visit it was made at, whoever's chart that visit is on now.
  final String? encounterId;

  /// "at a visit" on this patient's chart: it names a visit, and that visit's patient is in the
  /// chart's merged group as far as the phone knows (8.4).
  final bool atVisit;

  /// Who recorded it: the name the server gives the record (`authorName`, their name now), else one
  /// the phone knows; none, and the screen says a teammate, for neither.
  final PersonRef recordedBy;

  /// When, by the server's record, or by this phone's clock while it waits here.
  final DateTime? recordedAt;

  /// The reason, once marked entered in error: the row stays, struck through (7).
  final String? enteredInError;

  /// The mark was made here and waits to send.
  final bool markWaiting;
  final Sending sending;
}

/// A team's referrals on this phone, for one person.
/// Whether Needs attention offers **Change the date** for [e] (PS-3): a refused create of a referral
/// dated after the server's day ahead (`referral_in_future`), the one value problem a referral meets
/// on the server, since every other rule of its value is checked here before it is made.
bool settledByDate(OutboxEntry e) =>
    e.state == ChangeState.rejected &&
    e.op == 'create' &&
    e.entity == entityReferral &&
    e.details?['problem'] == 'referral_in_future';

class Referrals {
  Referrals(this.store, {required this.user, this.nameOf});

  final LocalStore store;
  final EncounterUser user;

  /// A teammate's name, where the phone knows it.
  final String? Function(String userId)? nameOf;

  /// Called after a change made here, so screens read again.
  void Function()? onChanged;

  /// **Add referral** is offered: `referrals.create`, which a community health worker holds too, so
  /// a referral never needs a visit (7).
  bool get mayAdd => user.permissions.contains(_create);

  /// **Entered in error** is offered on [referral]: `referrals.create`, and its author or anyone who
  /// charts (4.7), on one not marked already.
  bool mayEnterInError(ReferralView referral) =>
      mayAdd && referral.enteredInError == null && (referral.recordedBy.userId == user.userId || user.charts);

  /// The referrals of [patientId]'s chart, newest first by their date (7): those this phone holds
  /// for every record of the merged group, and those of the chart's own list [chart] (the chart
  /// answer's snapshots, 5.2) it does not. A referral marked entered in error stays in the list.
  ///
  /// Each one shown is logged (`patient.viewed` on the referral, as the server's reads log one, 10.1)
  /// in the transaction that reads it, so a read that can't be logged shows nothing; [shownBefore]
  /// holds the IDs already on screen, which are not logged again. Throws [ChartingPaused] while the
  /// store is frozen.
  List<ReferralView> openReferrals(
    String patientId, {
    Iterable<RecordSnapshot> chart = const [],
    Set<String> shownBefore = const {},
  }) => _logged(() => referralsOf(patientId, chart: chart), shownBefore);

  /// [openReferrals] without its log: for a chart already opened, and logged, on screen (the
  /// profile's timeline, as phase 3's chart read lists the problems of the chart it logged).
  List<ReferralView> referralsOf(String patientId, {Iterable<RecordSnapshot> chart = const []}) {
    _guardFrozen();
    final group = patientGroup(store, patientId);
    final held = <String, ReferralView>{};
    for (final p in group) {
      for (final id in store.recordIdsOfPatient(p)) {
        final rec = store.record(id);
        if (rec != null && rec.entity == entityReferral) held[id] = _held(rec);
      }
    }
    for (final s in chart) {
      if (s.entity.wire != entityReferral || held.containsKey(s.id)) continue;
      if (!group.contains(s.attributes['patientId'])) continue;
      held[s.id] = _fromChart(s);
    }
    return _newestFirst(held.values);
  }

  /// The referrals made at the visit [encounterId], whichever chart they are on: the visit lists them
  /// so the clinician can find each one, a visit moved to someone else included (9.7, 12.1 #25).
  /// Logged as [openReferrals] logs.
  List<ReferralView> madeAt(String encounterId, {Set<String> shownBefore = const {}}) =>
      _logged(() => referralsMadeAt(encounterId), shownBefore);

  /// [madeAt] without its log, for a read that logs what it shows itself (`VisitRecords`): those
  /// this phone holds, and those of the charts it keeps (their timelines' referrals, 5.2) it does not.
  List<ReferralView> referralsMadeAt(String encounterId) {
    _guardFrozen();
    final out = <String, ReferralView>{};
    final charts = <RecordSnapshot>[];
    for (final id in store.recordIds()) {
      final rec = store.record(id);
      if (rec == null) continue;
      if (rec.entity == entityPatient) charts.addAll(chartMetaOf(store, id)?.referrals ?? const []);
      if (rec.entity != entityReferral || rec.attributes['encounterId'] != encounterId) continue;
      out[id] = _held(rec);
    }
    for (final s in charts) {
      if (s.entity.wire != entityReferral || s.attributes['encounterId'] != encounterId || out.containsKey(s.id)) {
        continue;
      }
      out[s.id] = _fromChart(s);
    }
    return _newestFirst(out.values);
  }

  /// **Add referral** (9.10): the date picked ([referredOn], its calendar day), the [details]
  /// (trimmed, 1 to 2,000 characters), and from an encounter's summary screen the visit it is made at
  /// ([encounterId]). Returns its ID.
  ///
  /// Throws, writing nothing: [ChartingPaused] while the store is frozen; a [LocalValidationError]
  /// with what the server would refuse, worded: `not_allowed` without `referrals.create` (the server
  /// would hold it for a Program Admin), `details`, `date` for a date that is not a real one,
  /// `referral_in_future` for a date more than a day ahead of the server's, and
  /// `encounter_other_patient` for a visit this phone holds of someone outside the patient's merged
  /// group (the server refuses it as a stale reference, 4.7, 8.4).
  String add(String patientId, {required DateTime referredOn, required String details, String? encounterId}) {
    _guardFrozen();
    if (!mayAdd) throw const LocalValidationError(_notAllowed, problem: 'not_allowed');
    final text = details.trim();
    if (text.isEmpty || text.length > 2000) {
      throw const LocalValidationError(_detailsLength, problem: 'details', paths: {'details'});
    }
    final canonical = store.canonicalPatient(patientId);
    if (encounterId != null) {
      final visit = store.record(encounterId);
      final visitPatient = visit?.fields['patientId']?.value;
      // A visit with no patient passes, as on the server (records.ts visitOfOtherPatient).
      if (visitPatient is String && !patientGroup(store, canonical).contains(store.canonicalPatient(visitPatient))) {
        throw const LocalValidationError(_otherPatient, problem: 'encounter_other_patient');
      }
    }
    final String id;
    try {
      id = store.createRecord(entityReferral, {
        'patientId': canonical,
        'referredOn': _date(referredOn),
        'details': text,
        'encounterId': encounterId,
      });
    } on LocalValidationError catch (e) {
      if (e.problem == 'referral_in_future') {
        throw const LocalValidationError(_inFuture, problem: 'referral_in_future', paths: {'referredOn'});
      }
      if (e.paths.contains('referredOn')) {
        throw const LocalValidationError(_notADate, problem: 'date', paths: {'referredOn'});
      }
      rethrow;
    }
    onChanged?.call();
    return id;
  }

  /// **Entered in error** (7): the referral [referralId] marked with a [reason] (trimmed, 3 to 300
  /// characters), once. One the phone does not hold yet, listed from the chart's own list [chart], is
  /// taken onto the phone in the same transaction, so it can be marked offline.
  ///
  /// Throws, writing nothing: [ChartingPaused] while the store is frozen; `not_allowed` for someone
  /// [mayEnterInError] refuses, whom the server would hold; `entered_in_error` for one marked already;
  /// `reason`. A [StateError] when neither the phone nor [chart] has it.
  void enterInError(String referralId, String reason, {Iterable<RecordSnapshot> chart = const []}) {
    _guardFrozen();
    final copy = chart.where((s) => s.id == referralId && s.entity.wire == entityReferral).firstOrNull;
    final rec = store.record(referralId);
    if (rec != null && rec.entity != entityReferral) throw StateError('not a referral');
    final ReferralView shown;
    if (rec != null) {
      shown = _held(rec);
    } else if (copy != null) {
      shown = _fromChart(copy);
    } else {
      throw StateError('no such referral on this phone');
    }
    if (shown.enteredInError != null) {
      throw const LocalValidationError(_marked, problem: 'entered_in_error');
    }
    if (!mayEnterInError(shown)) throw const LocalValidationError(_notYours, problem: 'not_allowed');
    final text = reason.trim();
    // In code points, as the store and the server count it: an astral character is one.
    final length = text.runes.length;
    if (length < 3 || length > 300) {
      throw const LocalValidationError(_reasonLength, problem: 'reason', paths: {'reason'});
    }
    store.transaction(() {
      if (rec == null) store.importServerRecord(serverRecordFrom(copy!), open: false);
      store.setField(referralId, 'enteredInError', {'reason': text});
    });
    onChanged?.call();
  }

  /// **Change the date** (the coordinator's decision on review finding PS-3): the referral whose
  /// create [changeId] the server refused for its date ([settledByDate]) sent again as it was, dated
  /// [referredOn], as the fix of the refused one, so the refusal settles once the server takes it.
  ///
  /// Throws, writing nothing: [ChartingPaused] while the store is frozen; `referral_in_future` for a
  /// date the phone takes no more than the server did; a [StateError] for a change [settledByDate]
  /// does not take.
  void changeRefusedDate(String changeId, DateTime referredOn) {
    _guardFrozen();
    final refused = store.entry(changeId);
    if (refused == null || !settledByDate(refused)) throw StateError('not a referral refused for its date');
    try {
      store.fixRejected(changeId, {...refused.value! as Map<String, Object?>, 'referredOn': _date(referredOn)});
    } on LocalValidationError catch (e) {
      if (e.problem == 'referral_in_future') {
        throw const LocalValidationError(_inFuture, problem: 'referral_in_future', paths: {'referredOn'});
      }
      rethrow;
    }
    onChanged?.call();
  }

  // ---- reading ----

  List<ReferralView> _logged(List<ReferralView> Function() read, Set<String> shownBefore) {
    _guardFrozen();
    return store.transaction(() {
      final list = read();
      for (final r in list) {
        if (shownBefore.contains(r.id)) continue;
        store.appendAudit(
          'patient.viewed',
          entity: entityReferral,
          entityId: r.id,
          patientId: r.patientId,
          // Made or worked on here, or a copy the server sent, as phase 3 logs a chart read offline.
          source: store.record(r.id)?.origin == 'local' ? 'local' : 'cache',
        );
      }
      return list;
    });
  }

  ReferralView _held(LocalRecord rec) {
    final a = rec.attributes;
    final mark = rec.fields['enteredInError'];
    final create = _createOf(rec.id);
    final encounterId = a['encounterId'] as String?;
    final authorId = rec.authorUserId ?? '';
    return ReferralView(
      id: rec.id,
      patientId: rec.patientId ?? a['patientId'] as String? ?? '',
      referredOn: a['referredOn'] as String? ?? '',
      details: a['details'] as String? ?? '',
      encounterId: encounterId,
      atVisit: _atVisit(encounterId, rec.patientId ?? a['patientId'] as String? ?? ''),
      // Who recorded it, by the name the server gives (`authorName`, their name now, D108).
      recordedBy: PersonRef(
        authorId,
        name: user.nameFor(authorId, named: a['authorName'], nameOf: nameOf),
      ),
      recordedAt: _time(a['recordedAt']) ?? create?.correctedTime ?? create?.deviceTime,
      enteredInError: _reason(mark?.value),
      markWaiting: mark != null && !mark.confirmed,
      sending: switch (create?.state) {
        null => Sending.sent,
        ChangeState.pending => Sending.waiting,
        _ => Sending.refused,
      },
    );
  }

  ReferralView _fromChart(RecordSnapshot s) {
    final a = s.attributes;
    final encounterId = a['encounterId'] as String?;
    return ReferralView(
      id: s.id,
      patientId: a['patientId'] as String? ?? '',
      referredOn: a['referredOn'] as String? ?? '',
      details: a['details'] as String? ?? '',
      encounterId: encounterId,
      atVisit: _atVisit(encounterId, a['patientId'] as String? ?? ''),
      recordedBy: PersonRef(
        s.authorUserId,
        name: user.nameFor(s.authorUserId, named: a['authorName'], nameOf: nameOf),
      ),
      recordedAt: _time(a['recordedAt']),
      enteredInError: _reason(s.fields['enteredInError']?.value),
      markWaiting: false,
      sending: Sending.sent,
    );
  }

  /// "at a visit" on the chart of the referral's patient [patientId] (8.4, `shownAtVisit`).
  bool _atVisit(String? encounterId, String patientId) =>
      patientId.isNotEmpty && shownAtVisit(store, patientId, encounterId);

  OutboxEntry? _createOf(String recordId) => store
      .outbox()
      .where((e) => e.recordId == recordId && e.op == 'create' && e.state != ChangeState.superseded)
      .lastOrNull;

  static List<ReferralView> _newestFirst(Iterable<ReferralView> referrals) => [...referrals]
    ..sort((a, b) {
      final byDate = b.referredOn.compareTo(a.referredOn);
      if (byDate != 0) return byDate;
      final at = (b.recordedAt ?? DateTime(0)).compareTo(a.recordedAt ?? DateTime(0));
      return at != 0 ? at : a.id.compareTo(b.id);
    });

  void _guardFrozen() {
    if (store.frozen) throw ChartingPaused(store.frozenMessage!);
  }

  static String? _reason(Object? mark) => mark is Map<String, Object?> ? mark['reason'] as String? : null;
  static DateTime? _time(Object? iso) => iso is String ? DateTime.tryParse(iso) : null;

  /// The calendar day of [day] as the person picked it, `YYYY-MM-DD`.
  static String _date(DateTime day) =>
      '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-'
      '${day.day.toString().padLeft(2, '0')}';
}

const _create = 'referrals.create';

// What the Referrals sheet says when it stops (lifecycle 9.10): this layer's words.
const _notAllowed = 'Your role can’t make referrals.';
const _notYours = 'Only the person who recorded this referral, or a clinician, can mark it entered in error.';
const _detailsLength = 'Write the referral’s details, up to 2,000 characters.';
const _notADate = 'Choose a real date.';
const _inFuture = 'A referral can’t be dated in the future.';
const _otherPatient = 'That visit is someone else’s. Add the referral from their chart, or without the visit.';
const _marked = 'This referral is already marked entered in error.';
const _reasonLength = 'Give a short reason (3 to 300 characters).';
