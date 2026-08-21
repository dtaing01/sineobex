import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../data/seed/demo_seed.dart' as seed;
import '../../widgets/app_badge.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_card.dart';
import '../../widgets/progress_bar.dart';

/// Category filter, with an "All" option the enum alone can't express.
enum CategoryFilter {
  all('All'),
  medical('Medical'),
  essentials('Essentials'),
  clothing('Clothing');

  const CategoryFilter(this.label);
  final String label;

  bool matches(InventoryItem i) =>
      this == CategoryFilter.all || i.category.label == label;
}

enum StockFilter {
  all('All'),
  low('Low Stock'),
  out('Out of Stock'),
  inStock('In Stock');

  const StockFilter(this.label);
  final String label;

  bool matches(InventoryItem i) => switch (this) {
        StockFilter.all => true,
        StockFilter.low => i.stock > 0 && i.stock < i.min,
        StockFilter.out => i.stock == 0,
        StockFilter.inStock => i.stock >= i.min,
      };
}

/// Ports `InventoryView`.
class InventoryScreen extends ConsumerStatefulWidget {
  const InventoryScreen({super.key});

  @override
  ConsumerState<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends ConsumerState<InventoryScreen> {
  CategoryFilter _category = CategoryFilter.all;
  StockFilter _stock = StockFilter.all;

  /// Items the seasonal model flags for the current month.
  Set<String> get _seasonalItems {
    final month = _monthAbbrev(DateTime.now().month);
    final match = seed
        .demoSeasonalDemand()
        .where((d) => d.month == month)
        .firstOrNull;
    return (match?.items ?? const []).map((s) => s.toLowerCase()).toSet();
  }

  static String _monthAbbrev(int month) => const [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      ][month - 1];

  @override
  Widget build(BuildContext context) {
    final items = ref.watch(inventoryProvider).valueOrNull ?? const [];
    final usageLog = ref.watch(supplyUsageLogProvider).valueOrNull ?? const [];
    final filtered = items
        .where((i) => _category.matches(i) && _stock.matches(i))
        .toList();
    final seasonal = _seasonalItems;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x8,
      ),
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Inventory',
              style: TextStyle(
                fontSize: AppText.xxl,
                fontWeight: AppText.bold,
                color: AppColors.slate900,
              ),
            ),
            Row(
              children: [
                AppButton(
                  label: 'View Map',
                  icon: LucideIcons.map,
                  uppercase: true,
                  size: AppButtonSize.sm,
                  variant: AppButtonVariant.outline,
                  foreground: AppColors.purple600,
                  borderColor: AppColors.purple200,
                  onPressed: () => goToMapLayer(context, MapLayer.inventory),
                ),
                const SizedBox(width: AppSpace.x2),
                AppIconButton(
                  icon: LucideIcons.plus,
                  size: 32,
                  iconSize: 16,
                  onPressed: () => _showAddSheet(context),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: AppSpace.x4),
        const FieldLabel('Category'),
        const SizedBox(height: AppSpace.x2),
        FilterChipRow<CategoryFilter>(
          values: CategoryFilter.values,
          selected: _category,
          labelOf: (c) => c.label,
          onSelected: (c) => setState(() => _category = c),
          height: 28,
        ),
        const SizedBox(height: AppSpace.x4),
        const FieldLabel('Stock Status'),
        const SizedBox(height: AppSpace.x2),
        FilterChipRow<StockFilter>(
          values: StockFilter.values,
          selected: _stock,
          labelOf: (s) => s.label,
          onSelected: (s) => setState(() => _stock = s),
          selectedBackground: AppColors.blue100,
          selectedForeground: AppColors.blue700,
          height: 28,
        ),
        const SizedBox(height: AppSpace.x5),
        for (final item in filtered) ...[
          _InventoryCard(
            item: item,
            isSeasonalPriority: seasonal.any(
              (s) => item.name.toLowerCase().contains(s),
            ),
          ),
          const SizedBox(height: AppSpace.x3),
        ],
        const SizedBox(height: AppSpace.x3),
        _FieldUsageLog(entries: usageLog),
      ],
    );
  }

  void _showAddSheet(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Adding new supply types requires an admin sync.'),
      ),
    );
  }
}

class _InventoryCard extends ConsumerWidget {
  const _InventoryCard({required this.item, required this.isSeasonalPriority});

  final InventoryItem item;
  final bool isSeasonalPriority;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repo = ref.watch(inventoryRepositoryProvider);
    final user = ref.watch(currentUserProvider);

    final (border, background) = switch (item.status) {
      StockStatus.out => (AppColors.red200, AppColors.red50),
      StockStatus.low => (AppColors.orange200, AppColors.orange50),
      StockStatus.inStock => isSeasonalPriority
          ? (AppColors.blue200, AppColors.blue50)
          : (AppColors.slate100, AppColors.white),
    };

    final stockColor = switch (item.status) {
      StockStatus.out => AppColors.red600,
      StockStatus.low => AppColors.orange600,
      StockStatus.inStock => AppColors.slate900,
    };

    final barColor = switch (item.status) {
      StockStatus.out => AppColors.red500,
      StockStatus.low => AppColors.orange500,
      StockStatus.inStock => AppColors.blue500,
    };

    return AppCard(
      borderColor: border,
      background: background,
      clip: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: AppSpace.x2,
                      runSpacing: AppSpace.x1,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          item.name,
                          style: const TextStyle(
                            fontSize: AppText.base,
                            fontWeight: AppText.bold,
                            color: AppColors.slate900,
                          ),
                        ),
                        if (item.isOutOfStock)
                          const AppBadge(
                            'Out of Stock',
                            background: AppColors.red100,
                            foreground: AppColors.red700,
                            fontSize: AppText.xxs,
                          )
                        else if (item.isLow)
                          const AppBadge(
                            'Low Stock',
                            background: AppColors.orange100,
                            foreground: AppColors.orange700,
                            fontSize: AppText.xxs,
                          )
                        else if (isSeasonalPriority)
                          const AppBadge(
                            'Seasonal Priority',
                            background: AppColors.blue100,
                            foreground: AppColors.blue700,
                            fontSize: AppText.xxs,
                          ),
                      ],
                    ),
                    FieldLabel(item.category.label),
                  ],
                ),
              ),
              const SizedBox(width: AppSpace.x2),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '${item.stock}',
                    style: TextStyle(
                      fontSize: AppText.xl,
                      fontWeight: AppText.bold,
                      color: stockColor,
                    ),
                  ),
                  FieldLabel(item.unit),
                ],
              ),
            ],
          ),
          const SizedBox(height: AppSpace.x3),
          ProgressBar(value: item.fillPercent / 100, color: barColor),
          const SizedBox(height: AppSpace.x1),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const FieldLabel('0'),
              FieldLabel('Min: ${item.min}'),
            ],
          ),
          if (item.isLow) ...[
            const SizedBox(height: AppSpace.x3),
            Container(
              padding: const EdgeInsets.all(AppSpace.x2),
              decoration: BoxDecoration(
                color: AppColors.white.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(color: AppColors.slate100),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Row(
                        children: [
                          Icon(
                            LucideIcons.clock,
                            size: 10,
                            color: AppColors.slate500,
                          ),
                          SizedBox(width: AppSpace.x1),
                          Text(
                            'ORDER STATUS',
                            style: TextStyle(
                              fontSize: AppText.tiny,
                              fontWeight: AppText.bold,
                              color: AppColors.slate500,
                            ),
                          ),
                        ],
                      ),
                      if (item.isOnOrder)
                        AppButton(
                          label: 'Mark Received',
                          uppercase: true,
                          size: AppButtonSize.sm,
                          fontSize: AppText.xxs,
                          variant: AppButtonVariant.ghost,
                          foreground: AppColors.green600,
                          onPressed: () => _promptQuantity(context, repo, item),
                        )
                      else
                        AppButton(
                          label: 'Mark Ordered',
                          uppercase: true,
                          size: AppButtonSize.sm,
                          fontSize: AppText.xxs,
                          variant: AppButtonVariant.ghost,
                          foreground: AppColors.blue600,
                          onPressed: () => repo.markOrdered(item.id, user.name),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpace.x2),
                  if (item.isOnOrder)
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Flexible(
                          child: _KeyValue(
                            label: 'Ordered: ',
                            value: item.orderedAtLabel,
                          ),
                        ),
                        Flexible(
                          child: _KeyValue(
                            label: 'By: ',
                            value: item.orderedBy ?? '—',
                          ),
                        ),
                      ],
                    )
                  else
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'NEED TO ORDER',
                        style: TextStyle(
                          fontSize: AppText.tiny,
                          fontWeight: AppText.bold,
                          color: AppColors.red600,
                          letterSpacing: AppText.tighter,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// The prototype set stock to `max(stock, min + 10)` with no input at all
  /// (plan defect D7). Asking how many arrived costs one tap and makes the
  /// number mean something.
  Future<void> _promptQuantity(
    BuildContext context,
    dynamic repo,
    InventoryItem item,
  ) async {
    final controller = TextEditingController();
    final quantity = await showDialog<int?>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Received ${item.name}'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: InputDecoration(
            labelText: 'Quantity received (${item.unit})',
            hintText: 'Leave blank to restock to minimum + 10',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(
              int.tryParse(controller.text.trim()) ?? -1,
            ),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (quantity == null) return;
    await repo.markReceived(item.id, quantity: quantity < 0 ? null : quantity);
  }
}

class _KeyValue extends StatelessWidget {
  const _KeyValue({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => RichText(
        overflow: TextOverflow.ellipsis,
        text: TextSpan(
          style: const TextStyle(
            fontSize: AppText.micro,
            color: AppColors.slate600,
            fontFamily: AppText.family,
          ),
          children: [
            TextSpan(text: label),
            TextSpan(
              text: value,
              style: const TextStyle(fontWeight: AppText.bold),
            ),
          ],
        ),
      );
}

class _FieldUsageLog extends StatelessWidget {
  const _FieldUsageLog({required this.entries});

  final List<SupplyUsageLog> entries;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Field Usage Log', icon: LucideIcons.history),
        const SizedBox(height: AppSpace.x3),
        AppCard(
          background: AppColors.slate900,
          borderColor: null,
          child: entries.isEmpty
              ? Text(
                  'No supplies logged yet. Supplies recorded during an '
                  'encounter appear here.',
                  style: TextStyle(
                    fontSize: AppText.micro,
                    color: AppColors.white.withValues(alpha: 0.5),
                    fontStyle: FontStyle.italic,
                  ),
                )
              : Column(
                  children: [
                    for (var i = 0; i < entries.length; i++)
                      Container(
                        padding: EdgeInsets.only(
                          bottom: i == entries.length - 1 ? 0 : AppSpace.x2,
                          top: i == 0 ? 0 : AppSpace.x2,
                        ),
                        decoration: BoxDecoration(
                          border: i == entries.length - 1
                              ? null
                              : Border(
                                  bottom: BorderSide(
                                    color:
                                        AppColors.white.withValues(alpha: 0.1),
                                  ),
                                ),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '${entries[i].item} • '
                                    '${entries[i].quantityLabel}',
                                    style: const TextStyle(
                                      fontSize: AppText.micro,
                                      fontWeight: AppText.bold,
                                      color: AppColors.blue400,
                                    ),
                                  ),
                                  Text(
                                    entries[i].location,
                                    style: TextStyle(
                                      fontSize: AppText.micro,
                                      color: AppColors.white
                                          .withValues(alpha: 0.5),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Text(
                              entries[i].relativeLabel(),
                              style: TextStyle(
                                fontSize: AppText.micro,
                                color:
                                    AppColors.white.withValues(alpha: 0.5),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}
