import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/env/app_config.dart';
import '../data/local/database.dart';
import '../data/models/models.dart';
import '../data/remote/api_client.dart';
import '../data/repositories/audit_log.dart';
import '../data/repositories/field_repository.dart';
import '../data/repositories/insights_repository.dart';
import '../data/repositories/inventory_repository.dart';
import '../data/repositories/patient_repository.dart';
import '../data/repositories/team_repository.dart';
import '../data/seed/demo_seed.dart' as seed;
import '../data/sync/outbox.dart';
import '../data/sync/sync_service.dart';
import '../features/auth/session_controller.dart';

/// Overridden in `main()` with the encrypted instance, and in tests with an
/// in-memory one.
final databaseProvider = Provider<AppDatabase>(
  (ref) => throw UnimplementedError('databaseProvider must be overridden'),
);

/// The API client, wired to the session so every request carries a bearer
/// token and a 401 triggers exactly one refresh-and-retry.
///
/// The token provider is a closure rather than a direct dependency because
/// SessionController itself reads repositories that are built from this graph;
/// resolving it lazily at request time breaks what would otherwise be a
/// circular provider dependency.
final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    tokenProvider: ({bool forceRefresh = false}) => ref
        .read(sessionControllerProvider.notifier)
        .accessToken(forceRefresh: forceRefresh),
  );
});

final outboxProvider = Provider<Outbox>(
  (ref) => Outbox(ref.watch(databaseProvider)),
);

final auditLogProvider = Provider<AuditLog>(
  (ref) => AuditLog(ref.watch(databaseProvider)),
);

final syncServiceProvider = Provider<SyncService>((ref) {
  final service = SyncService(
    ref.watch(databaseProvider),
    ref.watch(outboxProvider),
    ref.watch(apiClientProvider),
  );
  ref.onDispose(service.dispose);
  return service;
});

final syncStatusProvider = StreamProvider<SyncStatus>(
  (ref) => ref.watch(syncServiceProvider).status,
);

final patientRepositoryProvider = Provider<PatientRepository>(
  (ref) => PatientRepository(
    ref.watch(databaseProvider),
    ref.watch(outboxProvider),
    ref.watch(auditLogProvider),
  ),
);

final inventoryRepositoryProvider = Provider<InventoryRepository>(
  (ref) => InventoryRepository(
    ref.watch(databaseProvider),
    ref.watch(outboxProvider),
  ),
);

final fieldRepositoryProvider = Provider<FieldRepository>(
  (ref) => FieldRepository(ref.watch(databaseProvider)),
);

final teamRepositoryProvider = Provider<TeamRepository>(
  (ref) => TeamRepository(ref.watch(databaseProvider)),
);

final insightsRepositoryProvider = Provider<InsightsRepository>(
  (ref) => InsightsRepository(
    ref.watch(patientRepositoryProvider),
    ref.watch(apiClientProvider),
  ),
);

// ---------------------------------------------------------------------------
// Reactive data
// ---------------------------------------------------------------------------

final patientsProvider = StreamProvider<List<Patient>>(
  (ref) => ref.watch(patientRepositoryProvider).watchAll(),
);

final patientProvider = StreamProvider.family<Patient?, String>(
  (ref, id) => ref.watch(patientRepositoryProvider).watchById(id),
);

final inventoryProvider = StreamProvider<List<InventoryItem>>(
  (ref) => ref.watch(inventoryRepositoryProvider).watchAll(),
);

final supplyUsageLogProvider = StreamProvider<List<SupplyUsageLog>>(
  (ref) => ref.watch(inventoryRepositoryProvider).watchUsageLog(),
);

final resourcesProvider = StreamProvider<List<FieldResource>>(
  (ref) => ref.watch(fieldRepositoryProvider).watchResources(),
);

final clinicalHotspotsProvider = StreamProvider<List<Hotspot>>(
  (ref) => ref.watch(fieldRepositoryProvider).watchClinicalHotspots(),
);

final supplyHotspotsProvider = StreamProvider<List<Hotspot>>(
  (ref) => ref.watch(fieldRepositoryProvider).watchSupplyHotspots(),
);

final teamTasksProvider = FutureProvider<List<TeamTask>>(
  (ref) => ref.watch(teamRepositoryProvider).tasks(),
);

final outreachActionsProvider = FutureProvider<List<OutreachAction>>(
  (ref) => ref.watch(teamRepositoryProvider).outreachActions(),
);

final teamMembersProvider = FutureProvider<List<TeamMember>>(
  (ref) => ref.watch(teamRepositoryProvider).members(),
);

final insightsProvider = FutureProvider<InsightsBundle>((ref) {
  // Recompute whenever the encounter record changes.
  ref.watch(patientsProvider);
  return ref.watch(insightsRepositoryProvider).load();
});

/// Signed-in user. Replaced by the Cognito ID token claims once a backend is
/// configured; falls back to the demo identity otherwise.
final currentUserProvider = StateProvider<AppUser>(
  (ref) => ref.watch(teamRepositoryProvider).placeholderUser,
);

// ---------------------------------------------------------------------------
// Derived views used by more than one screen
// ---------------------------------------------------------------------------

/// `patients.filter(p => p.risk === 'High')`
final highRiskPatientsProvider = Provider<List<Patient>>((ref) {
  final patients = ref.watch(patientsProvider).valueOrNull ?? const [];
  return patients.where((p) => p.risk == RiskLevel.high).toList();
});

/// `patients.filter(p => p.followUp && p.risk !== 'High')` — the dashboard
/// carousel deliberately excludes high-risk patients, who get their own
/// Urgent Attention section above it.
final routineFollowUpsProvider = Provider<List<Patient>>((ref) {
  final patients = ref.watch(patientsProvider).valueOrNull ?? const [];
  return patients.where((p) => p.followUp && p.risk != RiskLevel.high).toList();
});

/// Every patient flagged for follow-up, high-risk included.
final allFollowUpsProvider = Provider<List<Patient>>((ref) {
  final patients = ref.watch(patientsProvider).valueOrNull ?? const [];
  return patients.where((p) => p.followUp).toList();
});

/// `inventory.filter(i => i.stock < i.min)`
final lowStockProvider = Provider<List<InventoryItem>>((ref) {
  final items = ref.watch(inventoryProvider).valueOrNull ?? const [];
  return items.where((i) => i.isLow).toList();
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/// Seeds the local database on first launch.
///
/// Reference data (resources, hotspots, outreach plan) always loads so the map
/// is usable. Patient records load **only** under the demo flag — a build that
/// may hold real PHI must never start with 12 fictional charts in it.
final bootstrapProvider = FutureProvider<void>((ref) async {
  final field = ref.watch(fieldRepositoryProvider);
  final team = ref.watch(teamRepositoryProvider);
  final inventory = ref.watch(inventoryRepositoryProvider);
  final patients = ref.watch(patientRepositoryProvider);

  if (await field.isEmpty) {
    await field.replaceResources(seed.demoResources());
    await field.replaceHotspots(seed.demoHotspots());
  }

  if (await team.isEmpty) {
    await team.saveMembers(seed.demoMembers());
    await team.saveTasks(seed.demoTasks());
    await team.saveOutreachActions(seed.demoOutreachActions());
  }

  if (await inventory.isEmpty) {
    await inventory.replaceAll(seed.demoInventory());
  }

  if (AppConfig.demoSeed && await patients.isEmpty) {
    debugPrint('Loading SYNTHETIC demo patients — not real PHI.');
    await patients.replaceAll(seed.demoPatients());
  }

  ref.read(auditLogProvider).setActor(ref.read(currentUserProvider).id);
  ref.read(syncServiceProvider).start();
});
