import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../core/env/app_config.dart';
import '../core/theme/tokens.dart';

/// Detroit downtown — the prototype's default map centre.
const detroitCenter = LatLng(42.3314, -83.0458);

/// The shared OpenStreetMap tile layer.
///
/// The endpoint comes from `SINEOBEX_TILE_URL`. Unset, it falls back to a
/// public CARTO CDN, which leaks the map viewport — and therefore approximate
/// patient locations — to a third party. See [AppConfig.tileUrlTemplate].
class OsmTileLayer extends StatelessWidget {
  const OsmTileLayer({super.key});

  @override
  Widget build(BuildContext context) => TileLayer(
    urlTemplate: AppConfig.tileUrlTemplate,
    userAgentPackageName: AppConfig.userAgentPackageName,
    retinaMode: RetinaMode.isHighDensity(context),
    maxNativeZoom: 20,
  );
}

/// The small print required by the tile licence.
class MapAttribution extends StatelessWidget {
  const MapAttribution({super.key});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
    color: AppColors.white.withValues(alpha: 0.7),
    child: Text(
      AppConfig.tileAttribution,
      style: const TextStyle(fontSize: AppText.xxxs, color: AppColors.slate500),
    ),
  );
}

/// Dashed route polyline. Colour varies by map layer, matching the
/// prototype's `dashArray` polylines.
Polyline dashedRoute(
  List<LatLng> points, {
  required Color color,
  double strokeWidth = 3,
  List<double> pattern = const [10, 10],
  double opacity = 0.6,
}) => Polyline(
  points: points,
  color: color.withValues(alpha: opacity),
  strokeWidth: strokeWidth,
  pattern: StrokePattern.dashed(segments: pattern),
);

/// Great-circle length of a route, in miles. Replaces the prototype's
/// hardcoded "1.4 miles" (plan defect D13).
double routeMiles(List<LatLng> points) {
  if (points.length < 2) return 0;
  const distance = Distance();
  var meters = 0.0;
  for (var i = 1; i < points.length; i++) {
    meters += distance.as(LengthUnit.Meter, points[i - 1], points[i]);
  }
  return meters / 1609.344;
}
