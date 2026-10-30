/// Build-time configuration, passed with --dart-define. Nothing secret lives here: the Supabase
/// anon key is a public identifier, and sign-in itself goes through the identity provider.
enum DeploymentKind { local, preview, pilot, production }

enum AuthKind { dev, supabase }

class AppConfig {
  const AppConfig({
    required this.apiBaseUrl,
    required this.deployment,
    this.authKind = AuthKind.dev,
    Uri? authUrl,
    this.authAnonKey = '',
    this.idleLockMinutes = 5,
  }) : authUrl = authUrl ?? apiBaseUrl;

  factory AppConfig.fromEnvironment() {
    const env = String.fromEnvironment('SINEOBEX_ENV', defaultValue: 'local');
    const api = String.fromEnvironment('SINEOBEX_API_URL', defaultValue: 'http://localhost:8787');
    const auth = String.fromEnvironment('SINEOBEX_AUTH', defaultValue: 'dev');
    const authUrl = String.fromEnvironment('SINEOBEX_AUTH_URL', defaultValue: 'http://localhost:8790');
    const anonKey = String.fromEnvironment('SINEOBEX_AUTH_ANON_KEY');
    final deployment = DeploymentKind.values.firstWhere((k) => k.name == env, orElse: () => DeploymentKind.local);
    final authKind = AuthKind.values.firstWhere((k) => k.name == auth, orElse: () => AuthKind.dev);
    if (authKind == AuthKind.dev && (deployment == DeploymentKind.pilot || deployment == DeploymentKind.production)) {
      throw StateError('The dev identity provider is for local builds only');
    }
    return AppConfig(
      apiBaseUrl: Uri.parse(api),
      deployment: deployment,
      authKind: authKind,
      authUrl: Uri.parse(authUrl),
      authAnonKey: anonKey,
    );
  }

  final Uri apiBaseUrl;
  final DeploymentKind deployment;
  final AuthKind authKind;
  final Uri authUrl;
  final String authAnonKey;

  /// Module 9: auto-lock after a team-set idle time, default 5 minutes. Never longer than 15.
  final int idleLockMinutes;

  Duration get idleLock => Duration(minutes: idleLockMinutes.clamp(1, 15));

  /// Local and preview builds may only ever hold made-up patients (Build plan, phase 0).
  bool get isDemo => deployment == DeploymentKind.local || deployment == DeploymentKind.preview;
}
