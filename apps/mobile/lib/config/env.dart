/// Build-time configuration, passed with --dart-define. Nothing secret lives here: the app holds no
/// API keys, and sign-in goes through the identity provider.
enum DeploymentKind { local, preview, pilot, production }

class AppConfig {
  const AppConfig({required this.apiBaseUrl, required this.deployment});

  factory AppConfig.fromEnvironment() {
    const env = String.fromEnvironment('SINEOBEX_ENV', defaultValue: 'local');
    const api = String.fromEnvironment('SINEOBEX_API_URL', defaultValue: 'http://localhost:8787');
    return AppConfig(
      apiBaseUrl: Uri.parse(api),
      deployment: DeploymentKind.values.firstWhere((k) => k.name == env, orElse: () => DeploymentKind.local),
    );
  }

  final Uri apiBaseUrl;
  final DeploymentKind deployment;

  /// Local and preview builds may only ever hold made-up patients (Build plan, phase 0).
  bool get isDemo => deployment == DeploymentKind.local || deployment == DeploymentKind.preview;
}
