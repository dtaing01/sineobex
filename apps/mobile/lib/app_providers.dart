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
import 'security/key_vault.dart';
import 'security/secure_store.dart';
import 'sync/clock.dart';
import 'sync/device_channel.dart';
import 'sync/sync_controller.dart';

final appConfigProvider = Provider<AppConfig>((ref) => AppConfig.fromEnvironment());

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

final Provider<SessionController> sessionProvider = Provider<SessionController>((ref) {
  final config = ref.watch(appConfigProvider);
  final client = ref.watch(httpClientProvider);
  final controller = SessionController(
    auth: ref.watch(authProvider),
    vault: ref.watch(keyVaultProvider),
    store: ref.watch(deviceStoreProvider),
    fetchMe: (token) async {
      final api = SineobexApi(HttpTransport(baseUrl: config.apiBaseUrl, client: client, accessToken: () => token));
      return localUserFromMe(await api.getMe());
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

const appVersion = String.fromEnvironment('SINEOBEX_APP_VERSION', defaultValue: '0.2.0');

final Provider<SyncController> syncControllerProvider = Provider<SyncController>((ref) {
  final config = ref.watch(appConfigProvider);
  final client = ref.watch(httpClientProvider);
  final session = ref.watch(sessionProvider);
  final controller = SyncController(
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
  );
  ref.onDispose(controller.dispose);
  return controller;
});
