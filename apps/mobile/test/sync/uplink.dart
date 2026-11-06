import 'dart:convert';

import 'package:sineobex_field/api/transport.dart';

/// One request as the phone sent it: where, how big, and how many changes it carried.
typedef SentRequest = ({String path, int bytes, int changes});

/// The phone's side of the network: records every request, and with [bytesPerSecond] the uplink
/// is that slow. A request is given the time HttpTransport gives it; one whose upload takes
/// longer times out on the phone but still reaches the server, which commits it (the phone can't
/// take back what it already sent, and the upload goes on after the timeout).
class Uplink implements ApiTransport {
  Uplink(this.inner, {this.bytesPerSecond, this.elapse, List<SentRequest>? log}) : log = log ?? [];

  final ApiTransport inner;
  int? bytesPerSecond;

  /// Out of signal: every request fails at once.
  bool offline = false;

  /// Moves the test's clocks on by how long the phone waited.
  final void Function(Duration)? elapse;
  final List<SentRequest> log;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    if (offline) throw const NetworkException('offline');
    final bytes = body == null ? 0 : utf8.encode(jsonEncode(body)).length;
    log.add((path: path, bytes: bytes, changes: _changes(body)));
    final rate = bytesPerSecond;
    final upload = rate == null ? Duration.zero : Duration(milliseconds: bytes * 1000 ~/ rate);
    final allowed = HttpTransport.timeoutFor(bytes);
    if (upload <= allowed) {
      elapse?.call(upload);
      return inner.send(method, path, query: query, body: body);
    }
    elapse?.call(allowed);
    try {
      await inner.send(method, path, query: query, body: body);
    } on Exception {
      // The phone stopped waiting before any answer came.
    }
    throw const NetworkException('timeout');
  }

  /// Requests to [path] (a suffix), with what they carried.
  List<SentRequest> to(String path) => [
    for (final r in log)
      if (r.path.endsWith(path)) r,
  ];

  static int _changes(Object? body) {
    if (body is! Map<String, Object?>) return 0;
    final payload = body['payload'];
    final changes = body['changes'] ?? (payload is Map<String, Object?> ? payload['changes'] : null);
    return changes is List<Object?> ? changes.length : 0;
  }
}
