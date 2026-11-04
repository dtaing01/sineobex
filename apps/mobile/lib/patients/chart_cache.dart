import 'dart:async';

import '../api/generated/api.dart' hide PatientRedirect;
import '../api/transport.dart';
import '../sync/local_store.dart';
import '../sync/sync_engine.dart';
import 'id_links.dart';
import 'patient_search.dart' show writeSearchNames;

/// Charts kept on the phone (design section 7): the charts a person opened or worked on, for 24
/// hours, downloaded in D24-style batches. Phase 7 adds a route as one more [CacheSource]; the purge
/// (P1's store) only asks whether a live scope or local work covers a patient, so it needs no
/// change then.
///
/// A chart's records go into the store's `records` and `fields` (closed, kept by scopes), so an
/// offline edit carries real field versions. What a chart says beyond its records (consents,
/// reviews, the duplicate hint, problem history and notes, which records it lists) rides in the
/// patient record as the server-only field [chartMetaField], so it has exactly the chart's
/// lifetime: imported with it, refreshed with it, purged with it.

/// The patient record's field holding what the chart says beyond its records ([ChartMeta]).
/// Version 0, never set by the phone, so a refresh always replaces it.
const chartMetaField = '_chart';

/// The canonical patient [patientId] belongs to, as this phone knows it, and every record merged
/// into it.
Set<String> patientGroup(LocalStore store, String patientId) {
  final canonical = store.canonicalPatient(patientId);
  return {
    canonical,
    for (final r in store.redirects().values)
      if (store.canonicalPatient(r.mergedId) == canonical) r.mergedId,
  };
}

/// What the phone keeps of a chart besides its records.
class ChartMeta {
  const ChartMeta(this.json);

  factory ChartMeta.ofChart(PatientChart c, DateTime downloadedAt) => ChartMeta({
    'partial': false,
    'downloadedAt': downloadedAt.toUtc().toIso8601String(),
    'projection': c.projection,
    'aliasIds': [for (final a in c.aliases) a.id],
    'allergyIds': [for (final a in c.allergies) a.id],
    'problemIds': c.problems == null ? null : [for (final p in c.problems!) p.id],
    'consents': [for (final x in c.consents) x.toJson()],
    'problemHistory': c.problemHistory?.map((e) => e.toJson()).toList(),
    'problemNotes': c.problemNotes?.map((e) => e.toJson()).toList(),
    'reviews': [for (final r in c.reviews) r.toJson()],
    'duplicate': c.duplicate?.toJson(),
    'mergedFrom': [for (final m in c.mergedFrom) m.toJson()],
    'lastSeenOn': (c.patient.attributes['lastSeenAt'] as String?)?.substring(0, 10),
  });

  /// An index entry opened offline (design 6.5): only the index's fields, marked partial.
  factory ChartMeta.ofIndex(IndexEntry e, DateTime downloadedAt) => ChartMeta({
    'partial': true,
    'downloadedAt': downloadedAt.toUtc().toIso8601String(),
    'aliasIds': [
      for (final a in e.aliases)
        if (a.id != null) a.id,
    ],
    'mergedNames': [
      for (final a in e.aliases)
        if (a.id == null) a.alias,
    ],
    'allergyIds': [for (final a in e.allergies) a.id],
    'birth': e.birth?.toJson(),
    'lastSeenOn': e.lastSeenOn,
    'duplicate': e.duplicate?.toJson(),
    'reviewFields': e.reviews,
  });

  final Map<String, Object?> json;

  bool get partial => json['partial'] == true;
  DateTime? get downloadedAt => json['downloadedAt'] == null ? null : DateTime.parse(json['downloadedAt']! as String);
  String? get projection => json['projection'] as String?;
  List<String> _ids(String key) => [...?(json[key] as List<Object?>?)?.cast<String>()];
  List<String> get aliasIds => _ids('aliasIds');
  List<String> get allergyIds => _ids('allergyIds');

  /// Null when the role doesn't see the problem list (the chart had none).
  List<String>? get problemIds => json['problemIds'] == null ? null : _ids('problemIds');
  List<String> get mergedNames => _ids('mergedNames');
  String? get lastSeenOn => json['lastSeenOn'] as String?;

  /// A partial copy's birth, from the index (a full chart's is a field).
  Map<String, Object?>? get indexBirth => json['birth'] as Map<String, Object?>?;

  List<Map<String, Object?>> _maps(String key) => [...?(json[key] as List<Object?>?)?.cast<Map<String, Object?>>()];
  List<ConsentView> get consents => [for (final c in _maps('consents')) ConsentView.fromJson(c)];
  List<ProblemStatusEvent> get problemHistory => [
    for (final e in _maps('problemHistory')) ProblemStatusEvent.fromJson(e),
  ];
  List<ProblemNoteView> get problemNotes => [for (final n in _maps('problemNotes')) ProblemNoteView.fromJson(n)];
  List<FieldReviewView> get reviews => [for (final r in _maps('reviews')) FieldReviewView.fromJson(r)];

  /// Fields with an open review: a full chart's reviews, or a partial copy's index list.
  List<String> get reviewFields =>
      json.containsKey('reviewFields') ? _ids('reviewFields') : ({for (final r in reviews) r.field}.toList()..sort());
  DuplicateHint? get duplicate =>
      json['duplicate'] == null ? null : DuplicateHint.fromJson(json['duplicate']! as Map<String, Object?>);
  List<PatientChartMergedFromItem> get mergedFrom => [
    for (final m in _maps('mergedFrom')) PatientChartMergedFromItem.fromJson(m),
  ];
}

/// The chart meta of [patientId]'s record here, if it was downloaded (or opened from the index).
ChartMeta? chartMetaOf(LocalStore store, String patientId) {
  final v = store.record(patientId)?.fields[chartMetaField]?.value;
  return v is Map<String, Object?> ? ChartMeta(v) : null;
}

ServerField _field(FieldState f) =>
    ServerField(value: f.value, version: f.version, changedBy: f.changedBy, changedAt: f.changedAt);

ServerRecord _record(RecordSnapshot s, {Map<String, ServerField> extra = const {}}) => ServerRecord(
  entity: s.entity.wire,
  id: s.id,
  status: s.status,
  authorUserId: s.authorUserId,
  attributes: s.attributes,
  fields: {for (final MapEntry(:key, :value) in s.fields.entries) key: _field(value), ...extra},
);

/// Imports one downloaded chart into the store, in one transaction: the patient record with the
/// chart's meta, the group's street names, allergies and problems (closed: scopes keep them), its
/// ID links (tokens only when the role may copy them), and its search names (origin `cache`: the
/// preferred name, street names and description, never the legal name, D40). [opened] adds or
/// extends the 24-hour `opened` scope; a refresh never extends one (design 7.2).
void importChart(LocalStore store, PatientChart chart, {required bool opened, required DateTime now}) {
  store.transaction(() {
    final canonical = chart.canonicalId;
    store.importServerRecord(
      _record(
        chart.patient,
        extra: {chartMetaField: ServerField(value: ChartMeta.ofChart(chart, now).json, version: 0)},
      ),
      open: false,
    );
    for (final s in [...chart.aliases, ...chart.allergies, ...?chart.problems]) {
      store.importServerRecord(_record(s), open: false);
    }
    IdLinks.importChartLinks(store, canonical, chart.idLinks);
    final fields = chart.patient.fields;
    writeSearchNames(
      store.database,
      canonical,
      'cache',
      preferred: fields['preferredName']?.value as String?,
      aliases: [
        for (final a in chart.aliases)
          if (a.status == 'active') a.attributes['alias'] as String?,
      ].nonNulls,
      descriptor: fields['visualDescriptor']?.value as String?,
    );
    if (opened) store.addScope(canonical);
  });
}

/// Opens an index entry as a partial server copy (design 6.5): the patient record holding only
/// the index's versioned fields at the index's versions, its street names (with IDs, so one can be
/// removed offline) and allergies, and its active card IDs. The caller audits the read and adds the
/// scope in the same transaction.
void importIndexEntry(LocalStore store, IndexEntry e, {required DateTime now}) {
  store.transaction(() {
    final v = e.versions;
    store.importServerRecord(
      ServerRecord(
        entity: entityPatient,
        id: e.patientId,
        status: 'active',
        authorUserId: '',
        attributes: const {},
        fields: {
          'preferredName': ServerField(value: e.preferredName, version: v.preferredName),
          'visualDescriptor': ServerField(value: e.visualDescriptor, version: v.visualDescriptor),
          'usualArea': ServerField(value: e.usualArea, version: v.usualArea),
          'allergyScreen': ServerField(value: e.allergyScreen.wire, version: v.allergyScreen),
          // An existing full copy stays full: the index has less than the chart.
          if (!(chartMetaOf(store, e.patientId)?.partial == false))
            chartMetaField: ServerField(value: ChartMeta.ofIndex(e, now).json, version: 0),
        },
      ),
      open: false,
    );
    for (final a in e.aliases) {
      final id = a.id;
      if (id == null) continue;
      store.importServerRecord(
        ServerRecord(
          entity: entityAlias,
          id: id,
          status: 'active',
          authorUserId: '',
          attributes: {'patientId': e.patientId, 'alias': a.alias},
          fields: const {'removal': ServerField(value: null, version: 0)},
        ),
        open: false,
      );
    }
    for (final a in e.allergies) {
      store.importServerRecord(
        ServerRecord(
          entity: entityAllergy,
          id: a.id,
          status: 'active',
          authorUserId: '',
          attributes: {
            'patientId': e.patientId,
            'substance': a.substance,
            'category': a.category.wire,
            'severity': a.severity.wire,
          },
          fields: const {'enteredInError': ServerField(value: null, version: 0)},
        ),
        open: false,
      );
    }
    IdLinks.importIndexLinks(store, e.patientId, e.idLinks);
  });
}

// ------------------------------------------------------------------------------------------------
// Sources and the cache
// ------------------------------------------------------------------------------------------------

/// Why charts are kept (design 7.3): what a source wants on the phone and for how long. Phase 3 has
/// [OpenedSource]; phase 7 adds a route.
abstract interface class CacheSource {
  /// The scope kind: `opened`, or in phase 7 `route`.
  String get kind;

  /// '' or a route ID.
  String get ref;
  Set<String> patientIds();
  DateTime expiresAt(DateTime downloadedAt);
}

/// Charts the person opened: kept 24 hours after the download (or the last edit).
class OpenedSource implements CacheSource {
  const OpenedSource(this.ids);
  final Set<String> ids;
  @override
  String get kind => scopeOpened;
  @override
  String get ref => '';
  @override
  Set<String> patientIds() => ids;
  @override
  DateTime expiresAt(DateTime downloadedAt) => downloadedAt.add(serverCopyLifetime);
}

/// What one download did.
class ChartFetch {
  const ChartFetch({required this.imported, required this.missing, required this.failed, required this.offline});

  /// Canonical IDs of the charts imported.
  final Set<String> imported;

  /// Asked for, and the server has no such patient (an intake not synced yet, or none at all).
  final Set<String> missing;

  /// Still timing out on their own: retried on a later run ("Part of this chart hasn't downloaded
  /// yet").
  final Set<String> failed;

  /// The phone lost the network part way: what arrived is kept.
  final bool offline;
}

/// Downloads charts for the phone (design 7). Batches follow D24 (review finding 20): the first
/// request asks for [firstBatch] charts, a timeout halves the next down to 1, each answer doubles
/// it back up to [maxBatch]. Each answered batch is imported (and audited by the server) on its own,
/// so a dead zone keeps what already arrived.
class ChartCache {
  ChartCache(this.store, this.api, {DateTime Function()? now}) : _now = now ?? DateTime.now;

  final LocalStore store;
  final SineobexApi api;
  final DateTime Function() _now;

  static const firstBatch = 10;
  static const maxBatch = 50;

  int _batch = firstBatch;

  /// How many charts the next request asks for.
  int get batchSize => _batch;

  final _failed = <String>{};

  /// Charts that timed out alone on the last try: the profile says part of the chart hasn't
  /// downloaded yet.
  bool downloadFailed(String patientId) => _failed.contains(store.canonicalPatient(patientId));

  /// Called after every import, so screens re-read.
  void Function()? onChanged;

  /// Downloads the charts of [patientIds] (any IDs: merged ones answer their survivor's chart).
  /// [opened] gives each the 24-hour `opened` scope; a refresh doesn't.
  Future<ChartFetch> fetch(
    Iterable<String> patientIds, {
    required FetchChartsReason reason,
    bool opened = false,
  }) async {
    final queue = [
      ...{...patientIds},
    ];
    final imported = <String>{};
    final missing = <String>{};
    final failed = <String>{};
    var offline = false;
    while (queue.isNotEmpty) {
      if (store.frozen) break;
      final batch = queue.take(_batch).toList();
      final ChartBundle bundle;
      try {
        bundle = await api.fetchCharts(
          body: FetchCharts(patientIds: batch, reason: reason),
        );
      } on NetworkException catch (e) {
        if (e.reason != 'timeout') {
          offline = true;
          break;
        }
        if (batch.length == 1) {
          // One chart that still doesn't fit: the others go first, it waits for a later run.
          queue.removeAt(0);
          failed.add(batch.single);
          _failed.add(store.canonicalPatient(batch.single));
        } else {
          _batch = (_batch ~/ 2).clamp(1, maxBatch);
        }
        continue;
      }
      _import(bundle, batch, opened: opened);
      queue.removeRange(0, batch.length);
      _batch = (_batch * 2).clamp(1, maxBatch);
      for (final c in bundle.charts) {
        imported.add(c.canonicalId);
        _failed.remove(c.canonicalId);
      }
      missing.addAll(bundle.missing);
      for (final id in batch) {
        _failed.remove(id);
      }
    }
    if (imported.isNotEmpty) onChanged?.call();
    return ChartFetch(imported: imported, missing: missing, failed: failed, offline: offline);
  }

  void _import(ChartBundle bundle, List<String> asked, {required bool opened}) {
    final now = _now();
    store.transaction(() {
      // The bundle's redirects are the server's word on the IDs asked for and the groups returned
      // (D27): a merge since undone loses its redirect here.
      store.replaceRedirects(
        [
          for (final r in bundle.redirects)
            PatientRedirect(mergedId: r.mergedId, survivorId: r.survivorId, mergedAt: r.mergedAt),
        ],
        origin: 'chart',
        covering: {...asked, for (final c in bundle.charts) c.canonicalId},
      );
      for (final c in bundle.charts) {
        importChart(store, c, opened: opened, now: now);
      }
    });
  }

  /// Opens a chart online (design 7.1): one download shows it and keeps it for 24 hours. Answers
  /// within [wait]; a download still running then carries on and is imported when it arrives (the
  /// profile then fills in), while the caller shows what the phone has. Returns whether the chart
  /// is here now; throws [NetworkException] when the phone is offline.
  Future<bool> open(String patientId, {Duration wait = const Duration(seconds: 5)}) async {
    final download = fetch([patientId], reason: FetchChartsReason.opened, opened: true);
    try {
      final got = await download.timeout(wait);
      if (got.offline) throw const NetworkException('offline');
      return got.imported.contains(store.canonicalPatient(patientId));
    } on TimeoutException {
      unawaited(download.then((_) {}, onError: (Object _) {}));
      return false;
    }
  }

  /// Downloads what each source wants and the phone lacks (design 7.3), and gives it the source's
  /// scope until the source's expiry. Charts the sources no longer want simply expire.
  Future<void> reconcile(List<CacheSource> sources) async {
    for (final source in sources) {
      final wanted = {for (final id in source.patientIds()) store.canonicalPatient(id)};
      final lacking = [
        for (final id in wanted)
          if (chartMetaOf(store, id)?.partial != false) id,
      ];
      final got = lacking.isEmpty
          ? null
          : await fetch(
              lacking,
              reason: source.kind == scopeOpened ? FetchChartsReason.opened : FetchChartsReason.refresh,
            );
      final now = _now();
      store.transaction(() {
        for (final id in wanted) {
          if (got != null && lacking.contains(id) && !got.imported.contains(store.canonicalPatient(id))) continue;
          store.addScope(
            store.canonicalPatient(id),
            kind: source.kind,
            ref: source.ref,
            expiresAt: source.expiresAt(now),
          );
        }
      });
    }
  }

  /// The charts worth downloading again (design 7.2): the ones a person is working on (local work),
  /// and copies opened from the index while offline, which become full charts once the phone is
  /// back. Charts only opened simply expire, which keeps background disclosures (and their audit
  /// events) down.
  Set<String> refreshable() {
    final live = {
      for (final s in store.scopes())
        if (s.expiresAt.isAfter(_now())) store.canonicalPatient(s.patientId),
    };
    return {
      for (final p in store.localWorkPatients())
        if (chartMetaOf(store, store.canonicalPatient(p)) != null) store.canonicalPatient(p),
      for (final p in live)
        if (chartMetaOf(store, p)?.partial ?? false) p,
    };
  }
}

/// Keeps the charts a person relies on current (design 7.2): after a sync (at most every
/// [minInterval]), on the controller's timer, at an unlock and on pull to refresh, the charts with
/// local work or a partial copy are downloaded again (`reason: 'refresh'`). It also learns where
/// ID links point (`/v1/me`), once, if the phone doesn't know yet.
class ChartCacheRefresher implements AfterSyncRefresher {
  ChartCacheRefresher(this.cache, {this.minInterval = const Duration(minutes: 2), DateTime Function()? now})
    : _now = now ?? DateTime.now;

  final ChartCache cache;
  final Duration minInterval;
  final DateTime Function() _now;
  DateTime? _last;
  bool _askedBaseUrl = false;

  @override
  Future<void> refresh(RefreshReason reason) async {
    final store = cache.store;
    if (store.frozen) return;
    final now = _now();
    final last = _last;
    if (reason == RefreshReason.afterSync && last != null && now.difference(last) < minInterval) return;
    _last = now;
    if (!_askedBaseUrl && IdLinks.baseUrlOf(store) == null) {
      _askedBaseUrl = true;
      try {
        IdLinks.rememberBaseUrl(store, (await cache.api.getMe()).idLinkBaseUrl);
      } on Exception {
        // Learned from the next chart with a card link instead.
      }
    }
    final ids = cache.refreshable();
    if (ids.isEmpty) return;
    await cache.fetch(ids, reason: FetchChartsReason.refresh);
  }
}
