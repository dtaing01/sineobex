import 'package:flutter/material.dart';

import '../../design/tokens.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Home')),
      body: ListView(
        padding: const EdgeInsets.all(FieldSpace.s4),
        children: [
          Text('Sineobex', style: text.headlineSmall),
          const SizedBox(height: FieldSpace.s2),
          Text('Field charting for street medicine.', style: text.bodyLarge),
        ],
      ),
    );
  }
}
