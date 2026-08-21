import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex/app/providers.dart';
import 'package:sineobex/core/theme/app_theme.dart';
import 'package:sineobex/data/local/database.dart';
import 'package:sineobex/data/models/models.dart';
import 'package:sineobex/data/seed/demo_seed.dart' as seed;
import 'package:sineobex/features/insights/insights_screen.dart';
import 'package:sineobex/features/inventory/inventory_screen.dart';
import 'package:sineobex/features/patients/patients_screen.dart';
import 'package:sineobex/features/profile/team_access_screen.dart';
import 'package:sineobex/widgets/app_button.dart';
import 'package:sineobex/widgets/insight_card.dart';

import 'helpers.dart';

void main() {
  late AppDatabase db;
  late ProviderContainer container;

  setUpAll(suppressDriftWarnings);

  setUp(() async {
    db = testDatabase();
    container = ProviderContainer(
      overrides: [databaseProvider.overrideWithValue(db)],
    );
    await container
        .read(patientRepositoryProvider)
        .replaceAll(seed.demoPatients());
    await container
        .read(inventoryRepositoryProvider)
        .replaceAll(seed.demoInventory());
    await container.read(teamRepositoryProvider).saveMembers(seed.demoMembers());
  });

  tearDown(() async {
    container.dispose();
    await db.close();
  });

  /// [settle] is false for screens carrying a deliberately perpetual
  /// animation (the pulsing "On Track" dot on Insights), where
  /// `pumpAndSettle` would never return.
  Future<void> pump(
    WidgetTester tester,
    Widget child, {
    bool settle = true,
  }) async {
    // A tall surface so vertically-scrolling content is mostly laid out, and
    // wide enough for the 448px content column.
    tester.view.physicalSize = const Size(500, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(body: child),
        ),
      ),
    );
    if (settle) {
      await tester.pumpAndSettle();
    } else {
      await tester.pump();
      await tester.pump(const Duration(seconds: 2));
    }
  }

  group('PatientsScreen', () {
    testWidgets('lists every seeded patient', (tester) async {
      await pump(tester, const PatientsScreen());
      expect(find.text('Patient Care'), findsOneWidget);
      expect(find.text('John Doe'), findsOneWidget);
      expect(find.text('Jane Smith'), findsOneWidget);
    });

    testWidgets('renders all seven filter chips', (tester) async {
      await pump(tester, const PatientsScreen());

      // The chip row scrolls horizontally, so later chips are built lazily.
      final row = find.byType(FilterChipRow<PatientFilter>);
      expect(row, findsOneWidget);

      for (final f in PatientFilter.values) {
        await tester.scrollUntilVisible(
          find.descendant(of: row, matching: find.text(f.label.toUpperCase())),
          200,
          scrollable: find.descendant(of: row, matching: find.byType(Scrollable)),
        );
        expect(
          find.descendant(of: row, matching: find.text(f.label.toUpperCase())),
          findsOneWidget,
          reason: 'filter chip "${f.label}" is missing',
        );
      }
    });

    testWidgets('search narrows the list by name', (tester) async {
      await pump(tester, const PatientsScreen());
      await tester.enterText(find.byType(TextField).first, 'Maria');
      await tester.pumpAndSettle();

      expect(find.text('Maria Garcia'), findsOneWidget);
      expect(find.text('John Doe'), findsNothing);
    });

    testWidgets('search matches a date of birth', (tester) async {
      await pump(tester, const PatientsScreen());
      await tester.enterText(find.byType(TextField).first, '1979-05-12');
      await tester.pumpAndSettle();

      expect(find.text('John Doe'), findsOneWidget);
      expect(find.text('Jane Smith'), findsNothing);
    });

    testWidgets('the High Risk filter excludes lower-risk patients',
        (tester) async {
      await pump(tester, const PatientsScreen());
      final row = find.byType(FilterChipRow<PatientFilter>);
      await tester.tap(
        find.descendant(of: row, matching: find.text('HIGH RISK')),
      );
      await tester.pumpAndSettle();

      expect(find.text('John Doe'), findsOneWidget); // High
      expect(find.text('Robert Williams'), findsNothing); // Low
    });

    testWidgets('the Pregnancy filter uses flags, not risk', (tester) async {
      await pump(tester, const PatientsScreen());
      final row = find.byType(FilterChipRow<PatientFilter>);
      await tester.scrollUntilVisible(
        find.descendant(of: row, matching: find.text('PREGNANCY')),
        200,
        scrollable: find.descendant(of: row, matching: find.byType(Scrollable)),
      );
      await tester.tap(
        find.descendant(of: row, matching: find.text('PREGNANCY')),
      );
      await tester.pumpAndSettle();

      expect(find.text('Jane Smith'), findsOneWidget);
      expect(find.text('John Doe'), findsNothing);
    });

    testWidgets('an empty result set explains itself', (tester) async {
      await pump(tester, const PatientsScreen());
      await tester.enterText(find.byType(TextField).first, 'zzzznobody');
      await tester.pumpAndSettle();

      expect(find.text('No patients match this search.'), findsOneWidget);
    });
  });

  group('InventoryScreen', () {
    testWidgets('shows stock state badges', (tester) async {
      await pump(tester, const InventoryScreen());
      expect(find.text('Inventory'), findsOneWidget);
      expect(find.text('OUT OF STOCK'), findsWidgets);
      expect(find.text('LOW STOCK'), findsWidgets);
    });

    testWidgets('the Out of Stock filter hides in-stock items',
        (tester) async {
      await pump(tester, const InventoryScreen());
      final row = find.byType(FilterChipRow<StockFilter>);
      await tester.scrollUntilVisible(
        find.descendant(of: row, matching: find.text('OUT OF STOCK')),
        200,
        scrollable: find.descendant(of: row, matching: find.byType(Scrollable)),
      );
      await tester.tap(
        find.descendant(of: row, matching: find.text('OUT OF STOCK')),
      );
      await tester.pumpAndSettle();

      // Socks are well stocked and must disappear.
      expect(find.text('Socks'), findsNothing);
      expect(find.text('Tetanus Vaccines'), findsWidgets);
    });

    testWidgets('the Clothing category filter narrows the list',
        (tester) async {
      await pump(tester, const InventoryScreen());
      final row = find.byType(FilterChipRow<CategoryFilter>);
      await tester.scrollUntilVisible(
        find.descendant(of: row, matching: find.text('CLOTHING')),
        200,
        scrollable: find.descendant(of: row, matching: find.byType(Scrollable)),
      );
      await tester.tap(
        find.descendant(of: row, matching: find.text('CLOTHING')),
      );
      await tester.pumpAndSettle();

      expect(find.text('Gauze'), findsNothing);
      expect(find.text('Socks'), findsWidgets);
    });

    testWidgets('an empty usage log says so rather than showing nothing',
        (tester) async {
      await pump(tester, const InventoryScreen());
      await tester.dragUntilVisible(
        find.textContaining('No supplies logged yet'),
        // The screen also holds two horizontal filter rows; target the
        // outer vertical list.
        find.byType(ListView).first,
        const Offset(0, -600),
      );
      await tester.pump();
      expect(find.textContaining('No supplies logged yet'), findsOneWidget);
    });
  });

  group('TeamAccessScreen', () {
    testWidgets('lists the roster and marks the signed-in user',
        (tester) async {
      await pump(tester, const TeamAccessScreen());
      expect(find.text('Team Access'), findsOneWidget);
      expect(find.text('Marcus Miller'), findsOneWidget);
      expect(find.text('YOU'), findsOneWidget);
    });

    testWidgets('offers no deactivate control for the signed-in user',
        (tester) async {
      await pump(tester, const TeamAccessScreen());
      // Three others in the roster, none of them self.
      expect(find.text('DEACTIVATE'), findsNWidgets(2));
      expect(find.text('RESTORE'), findsOneWidget);
    });

    testWidgets('deactivating a member flips their status', (tester) async {
      await pump(tester, const TeamAccessScreen());
      await tester.tap(find.text('DEACTIVATE').first);
      await tester.pumpAndSettle();

      expect(find.text('DEACTIVATE'), findsOneWidget);
      expect(find.text('RESTORE'), findsNWidgets(2));
    });
  });

  group('InsightsScreen', () {
    testWidgets('renders the major sections', (tester) async {
      await pump(tester, const InsightsScreen(), settle: false);
      expect(find.text('Program Insights'), findsOneWidget);
      expect(find.text('SEASONAL SUPPLY DEMAND'), findsOneWidget);
      expect(find.text('Encounters & Patient Mix'), findsOneWidget);
      expect(find.text('Patient Continuity Metrics'), findsOneWidget);
    });

    testWidgets('gives the two continuity rows different captions',
        (tester) async {
      await pump(tester, const InsightsScreen(), settle: false);
      await tester.dragUntilVisible(
        find.text(ContinuityMetric.primaryCareConnected.caption),
        find.byType(ListView),
        const Offset(0, -300),
      );
      await tester.pump();
      // The prototype showed the readmissions caption on both rows (D5).
      expect(
        find.text(ContinuityMetric.primaryCareConnected.caption),
        findsOneWidget,
      );
      expect(
        find.text(ContinuityMetric.hospitalReadmissions.caption),
        findsOneWidget,
      );
    });
  });

  group('InsightCard emphasis', () {
    test('renders **bold** as spans instead of literal asterisks', () {
      final spans = InsightCard.emphasisSpans(
        'Rising cluster near **Michigan & Trumbull** today.',
      );

      expect(spans, hasLength(3));
      expect(spans[0].text, 'Rising cluster near ');
      expect(spans[1].text, 'Michigan & Trumbull');
      expect(spans[1].style?.fontWeight, FontWeight.w700);
      expect(spans[2].text, ' today.');

      final joined = spans.map((s) => s.text).join();
      expect(joined, isNot(contains('*')));
    });

    test('leaves text without emphasis markers alone', () {
      final spans = InsightCard.emphasisSpans('No emphasis here.');
      expect(spans, hasLength(1));
      expect(spans.single.text, 'No emphasis here.');
    });

    test('handles multiple emphasised runs', () {
      final spans =
          InsightCard.emphasisSpans('**One** and **two** and three.');
      final bold = spans.where((s) => s.style?.fontWeight == FontWeight.w700);
      expect(bold.map((s) => s.text), ['One', 'two']);
    });
  });
}
