import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';

import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../widgets/map_pin.dart';

/// Colour and geometry rules for the map layers, kept in one place so the
/// circles, legends, list badges, and route lines can't drift apart.
class MapStyling {
  const MapStyling._();

  /// Route polyline colour per layer.
  static Color routeColor(MapLayer layer) => switch (layer) {
        MapLayer.resources => AppColors.emerald500,
        MapLayer.inventory => AppColors.violet500,
        _ => AppColors.orange500,
      };

  /// Heat cloud colour by hotspot category.
  static Color hotspotColor(HotspotType type) => switch (type) {
        HotspotType.risingNeed => AppColors.yellow500,
        HotspotType.foodDesert => AppColors.green500,
        HotspotType.pharmacyDesert => AppColors.blue500,
        HotspotType.supplyUsage => AppColors.violet500,
        // Everything else is an infectious-disease cluster: red.
        _ => AppColors.red500,
      };

  static Color hotspotFill(HotspotType type) => switch (type) {
        HotspotType.risingNeed => AppColors.yellow100,
        HotspotType.foodDesert => AppColors.green100,
        HotspotType.pharmacyDesert => AppColors.blue100,
        HotspotType.supplyUsage => AppColors.purple100,
        _ => AppColors.red100,
      };

  static Color hotspotText(HotspotType type) => switch (type) {
        HotspotType.risingNeed => AppColors.yellow700,
        HotspotType.foodDesert => AppColors.green700,
        HotspotType.pharmacyDesert => AppColors.blue600,
        HotspotType.supplyUsage => AppColors.purple600,
        _ => AppColors.red600,
      };

  /// Three concentric translucent rings per hotspot, at 1.2× / 0.8× / 0.4× the
  /// base radius with rising opacity — the prototype's fake heatmap, which
  /// reads better than a real one at this data density.
  static const _ringScales = [1.2, 0.8, 0.4];
  static const _ringOpacities = [0.08, 0.12, 0.20];

  static List<CircleMarker> heatCircles(List<Hotspot> hotspots) => [
        for (final h in hotspots) ..._ringsFor(h, hotspotColor(h.type)),
      ];

  static List<CircleMarker> supplyCircles(List<Hotspot> hotspots) => [
        for (final h in hotspots) ..._ringsFor(h, AppColors.violet500),
      ];

  static List<CircleMarker> _ringsFor(Hotspot h, Color color) => [
        for (var i = 0; i < _ringScales.length; i++)
          CircleMarker(
            point: h.position,
            radius: h.intensity.baseRadiusMeters * _ringScales[i],
            useRadiusInMeter: true,
            color: color.withValues(alpha: _ringOpacities[i]),
            borderColor: AppColors.transparent,
            borderStrokeWidth: 0,
          ),
      ];

  /// The floating legend, whose contents switch with the active layer.
  static Widget legendFor(MapLayer layer) => switch (layer) {
        MapLayer.patients => const MapLegend(
            title: 'Risk Level',
            entries: [
              MapLegendEntry(label: 'Low', color: AppColors.blue500),
              MapLegendEntry(label: 'Moderate', color: AppColors.amber500),
              MapLegendEntry(label: 'High', color: AppColors.red500),
            ],
          ),
        MapLayer.resources => const MapLegend(
            title: 'Resources',
            entries: [
              MapLegendEntry(
                label: 'Shelters',
                emoji: '🏠',
                emojiFill: AppColors.green100,
                emojiBorder: AppColors.emerald500,
              ),
              MapLegendEntry(
                label: 'Clinics',
                emoji: '🏥',
                emojiFill: AppColors.green100,
                emojiBorder: AppColors.emerald500,
              ),
              MapLegendEntry(
                label: 'Services',
                emoji: '💊',
                emojiFill: AppColors.blue100,
                emojiBorder: AppColors.blue500,
              ),
            ],
          ),
        MapLayer.heatmap => MapLegend(
            title: 'Heatmap',
            entries: [
              MapLegendEntry(
                label: 'Infectious Disease',
                color: AppColors.red500.withValues(alpha: 0.4),
              ),
              MapLegendEntry(
                label: 'Rising Needs',
                color: AppColors.yellow500.withValues(alpha: 0.4),
              ),
              MapLegendEntry(
                label: 'Food Desert',
                color: AppColors.green500.withValues(alpha: 0.4),
              ),
              MapLegendEntry(
                label: 'Pharmacy Desert',
                color: AppColors.blue500.withValues(alpha: 0.4),
              ),
            ],
          ),
        MapLayer.inventory => MapLegend(
            title: 'Inventory',
            entries: [
              MapLegendEntry(
                label: 'Supply Usage',
                color: AppColors.purple500.withValues(alpha: 0.4),
              ),
            ],
          ),
      };
}
