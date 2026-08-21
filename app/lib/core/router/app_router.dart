import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/models.dart';
import '../../features/dashboard/dashboard_screen.dart';
import '../../features/followups/followups_screen.dart';
import '../../features/insights/insights_screen.dart';
import '../../features/inventory/inventory_screen.dart';
import '../../features/map/map_screen.dart';
import '../../features/patients/patient_detail_screen.dart';
import '../../features/patients/patient_enroll_screen.dart';
import '../../features/patients/patients_screen.dart';
import '../../features/profile/profile_screen.dart';
import '../../features/profile/team_access_screen.dart';
import '../../app/app_shell.dart';

/// Replaces the prototype's `switch (activeTab)`.
///
/// Every screen now has a URL, which gives back-button semantics on Android,
/// deep links from push notifications ("follow-up due for patient X"), and
/// state restoration — none of which a string in `useState` can provide.
class AppRoutes {
  const AppRoutes._();

  static const dashboard = '/dashboard';
  static const patients = '/patients';
  static const patientsEnroll = '/patients/enroll';
  static const map = '/map';
  static const inventory = '/inventory';
  static const insights = '/insights';
  static const profile = '/profile';
  static const teamAccess = '/profile/team';
  static const followUps = '/follow-ups';

  static String patientDetail(String id) => '/patients/$id';
}

final rootNavigatorKey = GlobalKey<NavigatorState>();

GoRouter buildRouter() => GoRouter(
      navigatorKey: rootNavigatorKey,
      initialLocation: AppRoutes.dashboard,
      routes: [
        StatefulShellRoute.indexedStack(
          builder: (context, state, shell) => AppShell(shell: shell),
          branches: [
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: AppRoutes.dashboard,
                  builder: (_, __) => const DashboardScreen(),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: AppRoutes.patients,
                  builder: (_, __) => const PatientsScreen(),
                  routes: [
                    GoRoute(
                      path: 'enroll',
                      parentNavigatorKey: rootNavigatorKey,
                      builder: (_, __) => const PatientEnrollScreen(),
                    ),
                    GoRoute(
                      path: ':id',
                      builder: (_, state) => PatientDetailScreen(
                        patientId: state.pathParameters['id']!,
                      ),
                    ),
                  ],
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: AppRoutes.map,
                  builder: (_, state) => MapScreen(
                    initialLayer: MapLayer.fromLabel(
                      state.uri.queryParameters['layer'],
                    ),
                  ),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: AppRoutes.inventory,
                  builder: (_, __) => const InventoryScreen(),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: AppRoutes.insights,
                  builder: (_, __) => const InsightsScreen(),
                ),
              ],
            ),
          ],
        ),
        GoRoute(
          path: AppRoutes.profile,
          parentNavigatorKey: rootNavigatorKey,
          builder: (_, __) => const ProfileScreen(),
          routes: [
            GoRoute(
              path: 'team',
              parentNavigatorKey: rootNavigatorKey,
              builder: (_, __) => const TeamAccessScreen(),
            ),
          ],
        ),
        GoRoute(
          path: AppRoutes.followUps,
          parentNavigatorKey: rootNavigatorKey,
          builder: (_, __) => const FollowUpsScreen(),
        ),
      ],
    );

/// Opens the map on a specific layer, matching the prototype's
/// `onNavigate('map', 'Inventory')`.
void goToMapLayer(BuildContext context, MapLayer layer) =>
    context.go('${AppRoutes.map}?layer=${layer.label}');
