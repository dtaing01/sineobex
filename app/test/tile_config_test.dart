import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex/core/env/app_config.dart';

/// The tile endpoint discloses approximate patient locations to whoever serves
/// it, so it has to be pointable at infrastructure covered by your own BAA.
/// These hold under both configurations — run the suite with
/// `--dart-define=SINEOBEX_TILE_URL=...` to exercise the self-hosted branch.
void main() {
  group('tile configuration', () {
    test('the third-party flag tracks the endpoint actually in use', () {
      expect(
        AppConfig.usesThirdPartyTiles,
        AppConfig.tileUrlTemplate.contains('cartocdn.com'),
      );
    });

    test('attribution credits OpenStreetMap however tiles are served', () {
      // A licence condition of the ODbL that survives self-hosting: the data
      // is still OSM's even when the pixels come from your own server.
      expect(AppConfig.tileAttribution, contains('OpenStreetMap'));
    });

    test('CARTO is credited only when CARTO is serving', () {
      expect(
        AppConfig.tileAttribution.contains('CARTO'),
        AppConfig.usesThirdPartyTiles,
      );
    });
  });
}
