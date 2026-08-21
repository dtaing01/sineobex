import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../widgets/app_badge.dart';
import '../../widgets/map_pin.dart';
import '../../widgets/mini_map.dart';
import 'layer_panels.dart';
import 'map_styling.dart';

/// Ports `MapView`.
class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key, this.initialLayer = MapLayer.patients});

  final MapLayer initialLayer;

  /// Per-layer route polylines, as defined in the prototype.
  static const routes = <MapLayer, List<LatLng>>{
    MapLayer.patients: [
      LatLng(42.3314, -83.0458), // Downtown
      LatLng(42.3350, -83.0500), // Grand Circus
      LatLng(42.3400, -83.0580), // Cass Park
      LatLng(42.3450, -83.0600), // Cass Corridor
      LatLng(42.3480, -83.0750), // Covenant House
    ],
    MapLayer.resources: [
      LatLng(42.3415, -83.0550), // Detroit Rescue Mission
      LatLng(42.3480, -83.0750), // Covenant House
      LatLng(42.3655, -83.0845), // COTS
      LatLng(42.3670, -83.0850), // Henry Ford
    ],
    MapLayer.heatmap: [
      LatLng(42.3450, -83.0600), // Cass Corridor
      LatLng(42.3380, -83.0450), // I-75
      LatLng(42.3680, -83.0750), // New Center
      LatLng(42.3150, -83.1000), // Southwest
    ],
    MapLayer.inventory: [
      LatLng(42.3410, -83.0590), // Cass Park
      LatLng(42.3280, -83.0440), // Hart Plaza
      LatLng(42.3370, -83.0510), // Grand Circus
      LatLng(42.3695, -83.0770), // New Center
    ],
  };

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen> {
  late MapLayer _layer = widget.initialLayer;

  @override
  void didUpdateWidget(MapScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialLayer != oldWidget.initialLayer) {
      setState(() => _layer = widget.initialLayer);
    }
  }

  @override
  Widget build(BuildContext context) {
    final patients = ref.watch(patientsProvider).valueOrNull ?? const [];
    final resources = ref.watch(resourcesProvider).valueOrNull ?? const [];
    final clinical = ref.watch(clinicalHotspotsProvider).valueOrNull ?? const [];
    final supply = ref.watch(supplyHotspotsProvider).valueOrNull ?? const [];

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x8,
      ),
      children: [
        _Header(
          layer: _layer,
          onLayerChanged: (l) => setState(() => _layer = l),
        ),
        const SizedBox(height: AppSpace.x4),
        _MapCanvas(
          layer: _layer,
          patients: patients,
          resources: resources,
          clinicalHotspots: clinical,
          supplyHotspots: supply,
        ),
        const SizedBox(height: AppSpace.x6),
        switch (_layer) {
          MapLayer.patients => PatientsLayerPanel(patients: patients),
          MapLayer.resources => ResourcesLayerPanel(resources: resources),
          MapLayer.heatmap => HeatmapLayerPanel(hotspots: clinical),
          MapLayer.inventory => InventoryLayerPanel(hotspots: supply),
        },
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.layer, required this.onLayerChanged});

  final MapLayer layer;
  final ValueChanged<MapLayer> onLayerChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Field Map: ${layer.label}',
          style: const TextStyle(
            fontSize: AppText.xxl,
            fontWeight: AppText.bold,
            color: AppColors.slate900,
          ),
        ),
        const SizedBox(height: AppSpace.x3),
        // The segmented pill switcher.
        Container(
          padding: const EdgeInsets.all(AppSpace.x1),
          decoration: BoxDecoration(
            color: AppColors.slate100,
            borderRadius: BorderRadius.circular(AppRadius.full),
          ),
          child: Row(
            children: [
              for (final l in MapLayer.values)
                Expanded(
                  child: GestureDetector(
                    onTap: () => onLayerChanged(l),
                    behavior: HitTestBehavior.opaque,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 150),
                      padding: const EdgeInsets.symmetric(
                        vertical: AppSpace.x1,
                      ),
                      decoration: BoxDecoration(
                        color: l == layer
                            ? AppColors.white
                            : AppColors.transparent,
                        borderRadius: BorderRadius.circular(AppRadius.full),
                        boxShadow: l == layer ? AppShadows.sm : null,
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        l.label.toUpperCase(),
                        style: TextStyle(
                          fontSize: AppText.micro,
                          fontWeight: AppText.bold,
                          color: l == layer
                              ? AppColors.blue600
                              : AppColors.slate400,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _MapCanvas extends StatelessWidget {
  const _MapCanvas({
    required this.layer,
    required this.patients,
    required this.resources,
    required this.clinicalHotspots,
    required this.supplyHotspots,
  });

  final MapLayer layer;
  final List<Patient> patients;
  final List<FieldResource> resources;
  final List<Hotspot> clinicalHotspots;
  final List<Hotspot> supplyHotspots;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 550,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.map),
        border: Border.all(color: AppColors.slate200),
        boxShadow: AppShadows.xxl,
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          FlutterMap(
            options: const MapOptions(
              initialCenter: detroitCenter,
              initialZoom: 14,
            ),
            children: [
              const OsmTileLayer(),
              PolylineLayer(
                polylines: [
                  dashedRoute(
                    MapScreen.routes[layer] ?? const [],
                    color: MapStyling.routeColor(layer),
                  ),
                ],
              ),
              // Heatmap circles render beneath markers so pins stay tappable.
              if (layer == MapLayer.heatmap)
                CircleLayer(circles: MapStyling.heatCircles(clinicalHotspots)),
              if (layer == MapLayer.inventory)
                CircleLayer(circles: MapStyling.supplyCircles(supplyHotspots)),
              if (layer == MapLayer.patients)
                MarkerLayer(
                  markers: [
                    for (final p in patients)
                      Marker(
                        point: p.position,
                        width: 140,
                        height: 26,
                        alignment: Alignment.topCenter,
                        child: _PatientMarker(patient: p),
                      ),
                  ],
                ),
              if (layer == MapLayer.resources)
                MarkerLayer(
                  markers: [
                    for (final r in resources)
                      Marker(
                        point: r.position,
                        width: 28,
                        height: 28,
                        child: _ResourceMarker(resource: r),
                      ),
                  ],
                ),
              if (layer == MapLayer.heatmap)
                MarkerLayer(
                  markers: [
                    for (final h in clinicalHotspots)
                      Marker(
                        point: h.position,
                        width: 24,
                        height: 24,
                        child: _HotspotHandle(hotspot: h),
                      ),
                  ],
                ),
              if (layer == MapLayer.inventory)
                MarkerLayer(
                  markers: [
                    for (final h in supplyHotspots)
                      Marker(
                        point: h.position,
                        width: 24,
                        height: 24,
                        child: _HotspotHandle(hotspot: h),
                      ),
                  ],
                ),
            ],
          ),
          Positioned(
            bottom: AppSpace.x6,
            right: AppSpace.x6,
            child: MapStyling.legendFor(layer),
          ),
          const Positioned(bottom: 0, left: 0, child: MapAttribution()),
        ],
      ),
    );
  }
}

/// A risk pin whose popup name navigates to the patient chart.
class _PatientMarker extends StatelessWidget {
  const _PatientMarker({required this.patient});

  final Patient patient;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => showModalBottomSheet<void>(
        context: context,
        backgroundColor: AppColors.white,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppRadius.xxl),
          ),
        ),
        builder: (sheetContext) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AppSpace.x5),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  patient.name,
                  style: const TextStyle(
                    fontSize: AppText.lg,
                    fontWeight: AppText.bold,
                    color: AppColors.blue600,
                  ),
                ),
                Text(
                  patient.loc,
                  style: const TextStyle(
                    fontSize: AppText.xs,
                    color: AppColors.slate500,
                  ),
                ),
                const SizedBox(height: AppSpace.x2),
                AppBadge.risk(patient.risk),
                const SizedBox(height: AppSpace.x4),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () {
                      Navigator.of(sheetContext).pop();
                      context.go(AppRoutes.patientDetail(patient.id));
                    },
                    child: const Text('Open chart'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      child: Align(
        alignment: Alignment.topCenter,
        child: MapPin.risk(patient.risk, size: 20),
      ),
    );
  }
}

class _ResourceMarker extends StatelessWidget {
  const _ResourceMarker({required this.resource});

  final FieldResource resource;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => showModalBottomSheet<void>(
        context: context,
        backgroundColor: AppColors.white,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppRadius.xxl),
          ),
        ),
        builder: (_) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AppSpace.x5),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  resource.name,
                  style: const TextStyle(
                    fontSize: AppText.lg,
                    fontWeight: AppText.bold,
                    color: AppColors.slate900,
                  ),
                ),
                const SizedBox(height: AppSpace.x2),
                _DetailRow(icon: LucideIcons.mapPin, text: resource.loc),
                _DetailRow(icon: LucideIcons.calendar, text: resource.hours),
                _DetailRow(icon: LucideIcons.phone, text: resource.phone),
                const SizedBox(height: AppSpace.x3),
                AppBadge(
                  resource.type.label,
                  background: AppColors.blue50,
                  foreground: AppColors.blue600,
                  fontSize: AppText.micro,
                ),
              ],
            ),
          ),
        ),
      ),
      child: ResourcePin(type: resource.type),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          children: [
            Icon(icon, size: 12, color: AppColors.slate400),
            const SizedBox(width: AppSpace.x1),
            Flexible(
              child: Text(
                text,
                style: const TextStyle(
                  fontSize: AppText.xs,
                  color: AppColors.slate600,
                ),
              ),
            ),
          ],
        ),
      );
}

/// An invisible tap target at the centre of a heat cloud, giving the circles
/// the popup behaviour Leaflet gave them.
class _HotspotHandle extends StatelessWidget {
  const _HotspotHandle({required this.hotspot});

  final Hotspot hotspot;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => showModalBottomSheet<void>(
        context: context,
        backgroundColor: AppColors.white,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppRadius.xxl),
          ),
        ),
        builder: (_) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AppSpace.x5),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  hotspot.name,
                  style: const TextStyle(
                    fontSize: AppText.lg,
                    fontWeight: AppText.bold,
                    color: AppColors.slate900,
                  ),
                ),
                const SizedBox(height: AppSpace.x2),
                AppBadge(
                  hotspot.type.label,
                  background: MapStyling.hotspotFill(hotspot.type),
                  foreground: MapStyling.hotspotText(hotspot.type),
                  fontSize: AppText.micro,
                ),
                if (hotspot.supply != null) ...[
                  const SizedBox(height: AppSpace.x2),
                  Text(
                    'Item: ${hotspot.supply}',
                    style: const TextStyle(
                      fontSize: AppText.xs,
                      fontWeight: AppText.medium,
                      color: AppColors.slate500,
                    ),
                  ),
                ],
                if (hotspot.patients > 0) ...[
                  const SizedBox(height: AppSpace.x1),
                  Text(
                    '${hotspot.patients} patients in this cluster',
                    style: const TextStyle(
                      fontSize: AppText.xs,
                      color: AppColors.slate500,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
      child: const SizedBox(width: 24, height: 24),
    );
  }
}
