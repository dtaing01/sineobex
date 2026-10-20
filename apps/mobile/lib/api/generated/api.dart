// GENERATED FILE. Do not edit by hand.
// Source: packages/contract/openapi.json (Sineobex API 0.1.0).
// Regenerate with `pnpm contract:generate`; CI fails if this file is out of date.
// ignore_for_file: type=lint, unused_element

import 'transport.dart';

enum HealthEnvironment {
  local('local'),
  test('test'),
  preview('preview'),
  pilot('pilot'),
  production('production'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const HealthEnvironment(this.wire);
  final String wire;

  static HealthEnvironment fromJson(String value) =>
      HealthEnvironment.values.firstWhere((e) => e.wire == value, orElse: () => HealthEnvironment.unknown);

  String toJson() => wire;
}

class Health {
  const Health({
    required this.demo,
    required this.environment,
    required this.release,
    required this.status,
  });

  final bool demo;
  final HealthEnvironment environment;
  final String release;
  final String status;

  factory Health.fromJson(Map<String, dynamic> json) => Health(
        demo: json['demo'] as bool,
        environment: HealthEnvironment.fromJson(json['environment'] as String),
        release: json['release'] as String,
        status: json['status'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'demo': demo,
        'environment': environment.toJson(),
        'release': release,
        'status': status,
      };
}

class ServerTime {
  const ServerTime({
    required this.epochMs,
    required this.serverTime,
  });

  final int epochMs;
  final DateTime serverTime;

  factory ServerTime.fromJson(Map<String, dynamic> json) => ServerTime(
        epochMs: (json['epochMs'] as num).toInt(),
        serverTime: DateTime.parse(json['serverTime'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'epochMs': epochMs,
        'serverTime': serverTime.toUtc().toIso8601String(),
      };
}

/// Typed client for every operation in the API contract.
class SineobexApi {
  SineobexApi(this._transport);

  final ApiTransport _transport;

  /// Liveness, database reachability and whether this is a demo deployment
  Future<Health> getHealth() async {
    final json = await _transport.send('GET', '/v1/health');
    return Health.fromJson(json as Map<String, dynamic>);
  }

  /// Server time, used by the phone to measure its clock offset (module 9)
  Future<ServerTime> getServerTime() async {
    final json = await _transport.send('GET', '/v1/time');
    return ServerTime.fromJson(json as Map<String, dynamic>);
  }
}
