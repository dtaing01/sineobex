/// Build-time configuration.
///
/// `demoSeed` gates the synthetic Detroit dataset. It defaults to **false** so
/// a release build never ships patient-shaped records alongside real PHI.
/// Enable explicitly for demos:
///
///   flutter run --dart-define=SINEOBEX_DEMO_SEED=true
class AppConfig {
  const AppConfig._();

  static const bool demoSeed =
      bool.fromEnvironment('SINEOBEX_DEMO_SEED', defaultValue: false);

  static const String apiBaseUrl = String.fromEnvironment(
    'SINEOBEX_API_URL',
    defaultValue: '',
  );

  static const String cognitoUserPoolId =
      String.fromEnvironment('SINEOBEX_COGNITO_POOL_ID', defaultValue: '');

  static const String cognitoClientId =
      String.fromEnvironment('SINEOBEX_COGNITO_CLIENT_ID', defaultValue: '');

  static const String awsRegion =
      String.fromEnvironment('SINEOBEX_AWS_REGION', defaultValue: 'us-east-1');

  /// OpenStreetMap tile endpoint. CARTO Positron matches the prototype's
  /// light basemap and is OSM-derived.
  static const String tileUrlTemplate =
      'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  /// Required by both the OSM and CARTO tile licences. Do not remove.
  static const String tileAttribution =
      '© OpenStreetMap contributors © CARTO';

  static const String userAgentPackageName = 'org.streetmed.sineobex';

  /// Lock the app after this much inactivity (HIPAA §164.312(a)(2)(iii)).
  static const Duration inactivityLockTimeout = Duration(minutes: 10);

  static const String appVersion = '2.0.0';

  static bool get hasBackend => apiBaseUrl.isNotEmpty;
}
