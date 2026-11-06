import 'dart:async';
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

  test('a large body is given time to upload on a slow link; a small one isn’t', () async {
    // Review finding: a full sync batch takes about 32 s to send at 25 KB/s, and every try timed
    // out at 20 s.
    final client = MockClient.streaming((request, body) async {
      await body.drain<void>();
      await Future<void>.delayed(const Duration(milliseconds: 300));
      return http.StreamedResponse(Stream.value(utf8.encode('{}')), 200);
    });
    final transport = HttpTransport(
      baseUrl: Uri.parse('https://api.invalid'),
      client: client,
      timeout: const Duration(milliseconds: 100),
    );
    // 16 KiB is a second on the slowest uplink given time for.
    await transport.send('POST', '/v1/sync/push', body: {'note': 'x' * 16 * 1024});
    await expectLater(
      transport.send('POST', '/v1/sync/push', body: {'note': 'x'}),
      throwsA(isA<NetworkException>().having((e) => e.reason, 'reason', 'timeout')),
    );
    expect(HttpTransport.timeoutFor(900 * 1024), const Duration(seconds: 20 + 56, milliseconds: 250));
  });

  test('an answer that stalls after its headers times out instead of hanging its caller', () async {
    // Review finding: only the headers were timed, so one stalled body blocked every later
    // remote-wipe check on a locked phone.
    final never = StreamController<List<int>>();
    addTearDown(never.close);
    final client = MockClient.streaming((request, body) async => http.StreamedResponse(never.stream, 200));
    final transport = HttpTransport(
      baseUrl: Uri.parse('https://api.invalid'),
      client: client,
      timeout: const Duration(milliseconds: 50),
    );
    await expectLater(
      transport.send('GET', '/v1/time'),
      throwsA(isA<NetworkException>().having((e) => e.reason, 'reason', 'timeout')),
    );
  });
}
