import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'security/error_redaction.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  redactErrors();
  runApp(const ProviderScope(child: SineobexApp()));
}
