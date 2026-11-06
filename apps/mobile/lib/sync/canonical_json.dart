import 'dart:convert';

import 'package:crypto/crypto.dart';

/// Canonical JSON for hashing synced values (module 9: "A SHA-256 hash of the value").
///
/// The server hashes what it stored with services/api/src/sync/canonical.ts; a receipt confirms a
/// value only when both hashes match, so the two must produce identical text. Both are tested
/// against packages/contract/test-vectors/canonical-json.json.
///
/// Rules: object keys sorted by UTF-16 code unit, no whitespace; integers without a decimal point
/// (Dart's 38.0 is "38", as in JavaScript); other numbers in shortest round-trip form; -0 is 0;
/// strings escape only quote, backslash and control characters below U+0020.
String canonicalJson(Object? value) {
  final out = StringBuffer();
  _write(out, value);
  return out.toString();
}

/// Lowercase hex SHA-256 of the canonical JSON.
String valueHash(Object? value) => sha256.convert(utf8.encode(canonicalJson(value))).toString();

/// Largest integer JavaScript represents exactly. Beyond it the server would parse a different
/// number than the phone hashed, and the change could never be confirmed.
const maxSafeInteger = 9007199254740991;

/// Largest canonical value the server stores (MAX_VALUE_BYTES in the API).
const maxValueBytes = 64 * 1024;
const _maxDepth = 10;

/// Why the server would refuse to store [value], or null. Charting checks this before a change
/// enters the outbox, so a value that can never be confirmed never blocks the queue.
String? storableProblem(Object? value) {
  final problem = _problem(value, 0);
  if (problem != null) return problem;
  if (utf8.encode(canonicalJson(value)).length > maxValueBytes) return 'too large';
  return null;
}

final _loneSurrogate = RegExp(r'[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]');

String? _textProblem(String s) {
  if (s.contains('\u0000')) return 'contains a NUL character';
  if (_loneSurrogate.hasMatch(s)) return 'contains a broken character';
  return null;
}

String? _problem(Object? v, int depth) {
  if (depth > _maxDepth) return 'nested too deeply';
  switch (v) {
    case null || bool():
      return null;
    case int():
      return v.abs() > maxSafeInteger ? 'number too large to send exactly' : null;
    case double():
      return v.isFinite ? null : 'not a finite number';
    case String():
      return _textProblem(v);
    case List<Object?>():
      for (final e in v) {
        final p = _problem(e, depth + 1);
        if (p != null) return p;
      }
      return null;
    case Map<Object?, Object?>():
      for (final MapEntry(:key, :value) in v.entries) {
        if (key is! String) return 'has a key that is not text';
        final p = _textProblem(key) ?? _problem(value, depth + 1);
        if (p != null) return p;
      }
      return null;
    default:
      return 'not JSON';
  }
}

void _write(StringBuffer out, Object? v) {
  switch (v) {
    case null:
      out.write('null');
    case bool():
      out.write(v ? 'true' : 'false');
    case int():
      out.write(v.toString());
    case double():
      out.write(_number(v));
    case String():
      _quote(out, v);
    case List<Object?>():
      out.write('[');
      for (var i = 0; i < v.length; i++) {
        if (i > 0) out.write(',');
        _write(out, v[i]);
      }
      out.write(']');
    case Map<Object?, Object?>():
      final keys = v.keys.map((k) {
        if (k is! String) throw ArgumentError('canonical JSON object keys must be strings');
        return k;
      }).toList()..sort();
      out.write('{');
      for (var i = 0; i < keys.length; i++) {
        if (i > 0) out.write(',');
        _quote(out, keys[i]);
        out.write(':');
        _write(out, v[keys[i]]);
      }
      out.write('}');
    default:
      throw ArgumentError('canonical JSON cannot encode ${v.runtimeType}');
  }
}

/// JavaScript's Number.prototype.toString. Dart's double.toString uses the same shortest
/// round-trip algorithm and the same switch to exponents at 1e21; it only adds ".0" to integral
/// values. (Printing the exact integer instead would differ from JavaScript above 2^53, where
/// JavaScript pads the shortest digits with zeros: 2^60 is "1152921504606847000".)
String _number(double d) {
  if (!d.isFinite) throw ArgumentError('canonical JSON cannot encode NaN or Infinity');
  if (d == 0) return '0'; // -0 as well
  final s = d.toString();
  return s.endsWith('.0') ? s.substring(0, s.length - 2) : s;
}

const _short = {0x22: r'\"', 0x5c: r'\\', 0x08: r'\b', 0x0c: r'\f', 0x0a: r'\n', 0x0d: r'\r', 0x09: r'\t'};

void _quote(StringBuffer out, String s) {
  out.write('"');
  var start = 0;
  for (var i = 0; i < s.length; i++) {
    final c = s.codeUnitAt(i);
    final short = _short[c];
    if (short == null && c >= 0x20) continue;
    out.write(s.substring(start, i));
    out.write(short ?? '\\u${c.toRadixString(16).padLeft(4, '0')}');
    start = i + 1;
  }
  out.write(s.substring(start));
  out.write('"');
}
