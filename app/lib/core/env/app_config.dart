/// Build-time configuration.
///
/// `demoSeed` gates the synthetic Detroit dataset. It defaults to **false** so
/// a release build never ships patient-shaped records alongside real PHI.
/// Enable explicitly for demos:
///
///   flutter run --dart-define=SINEOBEX_DEMO_SEED=true
class AppConfig {
  const AppConfig._();

  static const bool demoSeed = bool.fromEnvironment(
    'SINEOBEX_DEMO_SEED',
    defaultValue: false,
  );

  static const String apiBaseUrl = String.fromEnvironment(
    'SINEOBEX_API_URL',
    defaultValue: '',
  );

  static const String cognitoUserPoolId = String.fromEnvironment(
    'SINEOBEX_COGNITO_POOL_ID',
    defaultValue: '',
  );

  static const String cognitoClientId = String.fromEnvironment(
    'SINEOBEX_COGNITO_CLIENT_ID',
    defaultValue: '',
  );

  static const String awsRegion = String.fromEnvironment(
    'SINEOBEX_AWS_REGION',
    defaultValue: 'us-east-1',
  );

  /// Fallback tile endpoint: CARTO Positron, rendered from OpenStreetMap
  /// data. It matches the prototype's light basemap, and is the default only
  /// so the app is runnable out of the box.
  ///
  /// **It is not suitable for clinical use.** Tiles are fetched for the
  /// viewport the clinician is looking at, and on the patient detail screen
  /// that viewport is centred on a patient. Every request therefore discloses
  /// an approximate patient location to whoever serves the tiles. CARTO is not
  /// a business associate, so that is a disclosure of PHI to an uncovered
  /// third party. Pointing this at `tile.openstreetmap.org` instead does not
  /// fix it — it only changes which third party receives the location, and
  /// the OSMF tile usage policy does not permit an application like this one.
  ///
  /// The fix is to serve OpenStreetMap tiles from infrastructure covered by
  /// your own BAA and set [tileUrlTemplate] to it:
  ///
  ///   flutter build apk --dart-define=SINEOBEX_TILE_URL=https://tiles.internal/{z}/{x}/{y}.png
  ///
  /// See `docs/SETUP.md` §6 and the map-tile entry in `docs/HIPAA.md` §4.
  static const String _fallbackTileUrl =
      'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  static const String tileUrlTemplate = String.fromEnvironment(
    'SINEOBEX_TILE_URL',
    defaultValue: _fallbackTileUrl,
  );

  /// True while the app is fetching tiles from a public third-party CDN
  /// rather than an endpoint you control. Surfaced in the UI so nobody
  /// mistakes the fallback for a configured deployment.
  static bool get usesThirdPartyTiles => tileUrlTemplate == _fallbackTileUrl;

  static const String _tileAttributionOverride = String.fromEnvironment(
    'SINEOBEX_TILE_ATTRIBUTION',
  );

  /// Attribution is a licence condition of OpenStreetMap's ODbL, and it
  /// survives self-hosting — the data is still OSM's. Do not remove.
  static String get tileAttribution {
    if (_tileAttributionOverride.isNotEmpty) return _tileAttributionOverride;
    return usesThirdPartyTiles
        ? '© OpenStreetMap contributors © CARTO'
        : '© OpenStreetMap contributors';
  }

  static const String userAgentPackageName = 'org.streetmed.sineobex';

  /// Lock the app after this much inactivity (HIPAA §164.312(a)(2)(iii)).
  static const Duration inactivityLockTimeout = Duration(minutes: 10);

  static const String appVersion = '2.0.0';

  static bool get hasBackend => apiBaseUrl.isNotEmpty;
}
