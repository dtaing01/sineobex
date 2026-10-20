import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';

void main() {
  test('sends auth, team and device headers and decodes typed responses', () async {
    late http.Request seen;
    final client = MockClient((req) async {
      seen = req;
      return http.Response(
        jsonEncode({'status': 'ok', 'environment': 'preview', 'demo': true, 'release': 'r1'}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = SineobexApi(
      HttpTransport(
        baseUrl: Uri.parse('https://x.supabase.co/functions/v1/api'),
        client: client,
        accessToken: () => 'tok',
        teamId: () => 'team-1',
        deviceId: () => 'device-1',
      ),
    );

    final health = await api.getHealth();
    expect(health.demo, isTrue);
    expect(health.environment, HealthEnvironment.preview);
    expect(seen.url.toString(), 'https://x.supabase.co/functions/v1/api/v1/health');
    expect(seen.headers['authorization'], 'Bearer tok');
    expect(seen.headers['x-team-id'], 'team-1');
    expect(seen.headers['x-device-id'], 'device-1');
  });

  test('turns error bodies into ApiException with the server code', () async {
    final client = MockClient(
      (_) async => http.Response(
        jsonEncode({
          'error': {'code': 'forbidden', 'message': 'Your role does not allow this.'},
        }),
        403,
      ),
    );
    final transport = HttpTransport(baseUrl: Uri.parse('https://api.invalid'), client: client);
    expect(
      () => transport.send('GET', '/v1/health'),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'forbidden').having((e) => e.status, 'status', 403)),
    );
  });

  test('turns dropped connections into NetworkException', () async {
    final client = MockClient((_) async => throw http.ClientException('reset'));
    final transport = HttpTransport(baseUrl: Uri.parse('https://api.invalid'), client: client);
    expect(() => transport.send('GET', '/v1/time'), throwsA(isA<NetworkException>()));
  });

  test('unknown enum values from a newer server do not break decoding', () {
    final h = Health.fromJson({'status': 'ok', 'environment': 'staging', 'demo': false, 'release': 'r'});
    expect(h.environment, HealthEnvironment.unknown);
  });
}
