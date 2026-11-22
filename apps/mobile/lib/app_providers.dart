import 'dart:io' show Directory, Platform;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'api/generated/api.dart';
import 'api/transport.dart';
import 'auth/auth_provider.dart';
import 'auth/session_controller.dart';
import 'config/env.dart';
import 'encounters/encounter_services.dart' show encounterRefreshers;
import 'encounters/note_definitions.dart' show heldNoteTypes;
import 'forms/definition_store.dart';
import 'patients/patient_providers.dart' show patientRefreshers;
import 'presets/presets_refresher.dart' show presetRefreshers;
import 'security/key_vault.dart';
import 'security/secure_store.dart';
import 'sync/clock.dart';
import 'sync/device_channel.dart';
import 'sync/sync_controller.dart';

final appConfigProvider = Provider<AppConfig>((ref) => AppConfig.fromEnvironment());

/// The phone's wall clock for what screens show (ages, "updated 2 hours ago"); tests fix it.
final wallClockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

final httpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

final authProvider = Provider<AuthProvider>((ref) {
  final config = ref.watch(appConfigProvider);
  final client = ref.watch(httpClientProvider);
  return switch (config.authKind) {
    AuthKind.supabase => SupabaseAuthProvider(url: config.authUrl, anonKey: config.authAnonKey, client: client),
    AuthKind.dev => DevAuthProvider(url: config.authUrl, client: client),
  };
});

final deviceStoreProvider = Provider<SecureStore>((ref) => deviceSecureStore());
final biometricStoreProvider = Provider<SecureStore>((ref) => biometricSecureStore());

final keyVaultProvider = Provider<KeyVault>(
  (ref) => KeyVault(store: ref.watch(deviceStoreProvider), biometricStore: ref.watch(biometricStoreProvider)),
);

/// The person and teams, from /v1/me, mapped into what the phone keeps.
LocalUser localUserFromMe(Me me) => LocalUser(
  userId: me.user.id,
  email: me.user.email,
  displayName: me.user.displayName,
  teams: [
    for (final t in me.teams.where((t) => t.teamStatus == MyTeamTeamStatus.active))
      TeamRef(
        id: t.teamId,
        name: t.teamName,
        roleName: t.roleName,
        credential: t.credential.wire,
        permissions: t.permissions.map((p) => p.wire).toList(),
      ),
  ],
);

/// Where Street Medicine ID card links point (`/v1/me` `idLinkBaseUrl`), from the last sign-in in
/// this run of the app. The team database keeps its own copy, so after a restart (no `/v1/me`
/// until the next sign-in) the links made offline still carry the right address.
class IdLinkBase {
  String? value;
}

final idLinkBaseProvider = Provider<IdLinkBase>((ref) => IdLinkBase());

final Provider<SessionController> sessionProvider = Provider<SessionController>((ref) {
  final config = ref.watch(appConfigProvider);
  final client = ref.watch(httpClientProvider);
  final linkBase = ref.watch(idLinkBaseProvider);
  final controller = SessionController(
    auth: ref.watch(authProvider),
    vault: ref.watch(keyVaultProvider),
    store: ref.watch(deviceStoreProvider),
    fetchMe: (token) async {
      final api = SineobexApi(HttpTransport(baseUrl: config.apiBaseUrl, client: client, accessToken: () => token));
      final me = await api.getMe();
      linkBase.value = me.idLinkBaseUrl;
      return localUserFromMe(me);
    },
    // Read when called, not now: the sync controller itself listens to this session.
    localData: DeferredLocalData(() => ref.read(syncControllerProvider)),
  );
  ref.onDispose(controller.dispose);
  return controller;
});

/// The API as the unlocked user, acting in their chosen team.
final apiProvider = Provider<SineobexApi>((ref) {
  final config = ref.watch(appConfigProvider);
  final session = ref.watch(sessionProvider);
  return SineobexApi(
    HttpTransport(
      baseUrl: config.apiBaseUrl,
      client: ref.watch(httpClientProvider),
      accessToken: session.accessToken,
      teamId: () => switch (session.state) {
        Unlocked(:final user) => user.teamId,
        _ => null,
      },
    ),
  );
});

/// Where the encrypted databases live: application support (not caches, which the system may
/// empty), kept out of device backups. The folder must exist before iOS can exclude it.
Future<String> databaseDirectory({Future<Directory> Function() base = getApplicationSupportDirectory}) async {
  final dir = p.join((await base()).path, 'sync');
  Directory(dir).createSync(recursive: true);
  await excludeFromBackup(dir);
  return dir;
}

/// The teams' note type definitions (phase 4 forms 3.4): plain files in a folder inside the
/// databases' folder, so backups leave them out as they do the databases, and the bundled presets.
DefinitionStore appDefinitionStore({Future<String> Function() databases = databaseDirectory}) {
  Future<String>? folder;
  return DefinitionStore(
    // Asked once: each call of [databaseDirectory] goes through the platform's backup exclusion,
    // and the store asks for its folder on every read. A failure is asked again next time.
    directory: () => folder ??= databases().then((dir) => p.join(dir, 'forms')).catchError((Object e) {
      folder = null;
      throw e;
    }),
    presets: DefinitionStore.bundledPresets,
  );
}

const appVersion = String.fromEnvironment('SINEOBEX_APP_VERSION', defaultValue: '0.2.0');

/// What the sync controller makes for each team database it opens (its `refreshers`): the team's
/// presets ([presetRefreshers]), the team index, the chart cache and the card hook
/// ([patientRefreshers]), then the visits and notes, with the close sweep among their refreshers
/// ([encounterRefreshers]). Each is made for the person the [session] unlocked: the presets written
/// only while [sync] holds the team's store open, the patient services with the keys the controller
/// opened the team with, the encounter services with the credential and name of the same profile,
/// the definitions [sync] holds, and the engine [sync] just opened for the team, which brings a
/// record that left the phone back to add to it. Copy link must work on a phone that never
/// downloaded a chart with a card, so [idLinkBaseUrl] is the sign-in's `/v1/me` address.
RefresherFactory appRefreshers({
  required SessionController session,
  required SyncController Function() sync,
  String? Function()? idLinkBaseUrl,
}) => (team) {
  final controller = sync();
  final engine = controller.engine;
  return [
    // First: the presets are a small answer that Team setup reads, and a slow index download
    // shouldn't hold them up.
    ...presetRefreshers(team, openStore: () => controller.store),
    ...patientRefreshers(team, idLinkBaseUrl: idLinkBaseUrl?.call()),
    ...encounterRefreshers(
      team,
      person: switch (session.state) {
        Unlocked(:final user) => user,
        _ => null,
      },
      definitionStore: controller.definitions,
      openServerRecord: engine != null && identical(engine.store, team.store) ? engine.openServerRecord : null,
    ),
  ];
};

final Provider<SyncController> syncControllerProvider = Provider<SyncController>((ref) {
  final config = ref.watch(appConfigProvider);
  final client = ref.watch(httpClientProvider);
  final session = ref.watch(sessionProvider);
  final linkBase = ref.watch(idLinkBaseProvider);
  late final SyncController controller;
  controller = SyncController(
    session: session,
    databaseDirectory: databaseDirectory,
    deviceStore: ref.watch(deviceStoreProvider),
    teamApi: (teamId) => SineobexApi(
      HttpTransport(baseUrl: config.apiBaseUrl, client: client, accessToken: session.accessToken, teamId: () => teamId),
    ),
    deviceApi: SineobexApi(HttpTransport(baseUrl: config.apiBaseUrl, client: client)),
    boot: PlatformBootClock(),
    platform: Platform.isIOS ? RegisterDevicePlatform.ios : RegisterDevicePlatform.android,
    appVersion: appVersion,
    refreshers: appRefreshers(session: session, sync: () => controller, idLinkBaseUrl: () => linkBase.value),
    definitions: appDefinitionStore(),
    // A draft on a version the team's list no longer names still opens offline (forms 3.4).
    heldNoteTypes: heldNoteTypes,
  );
  ref.onDispose(controller.dispose);
  return controller;
});
