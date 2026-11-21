import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_services.dart';
import 'package:sineobex_field/patients/patient_providers.dart';

import '../auth/fakes.dart';
import '../helpers/app_harness.dart';

/// The shared app harness opens a team as the app does (app_providers.dart `appRefreshers`): the
/// patient services, then the encounter services for the person the session unlocked, so a screen
/// test finds both, and the close sweep runs after its syncs.
void main() {
  testWidgets('a team opened in the harness has its patient and encounter services', (tester) async {
    usePhoneSize(tester);
    final h = AppHarness();
    await tester.pumpWidget(h.build());
    await tester.pumpAndSettle();
    await enter(tester, 'Email', 'clinician@example.com');
    await enter(tester, 'Password', validPassword);
    await tapText(tester, 'Continue');
    await enter(tester, '6-digit code', validCode);
    await tapText(tester, 'Sign in');
    await enter(tester, 'New PIN', '482913');
    await enter(tester, 'Type it again', '482913');
    await tapText(tester, 'Save PIN');
    await tester.runAsync(h.sync.ready);
    await tester.pumpAndSettle();

    final store = h.sync.store!;
    expect(PatientServices.of(store), isNotNull);
    final encounters = EncounterServices.of(store);
    expect(encounters, isNotNull);
    expect(identical(h.encounters, encounters), isTrue);
    final person = demoUser();
    expect(
      [encounters!.user.userId, encounters.user.displayName, encounters.user.credential],
      [person.userId, person.displayName, person.teams.first.credential],
    );
    expect(h.sync.engine!.refreshers, containsAllInOrder([...h.patients.refreshers, ...encounters.refreshers]));
  });
}
