/// Trigram similarity as Postgres `pg_trgm` defines it (design 5.1), for scoring on the phone.
///
/// Each word is padded with two spaces before and one after, its 3-character windows form a set,
/// and the similarity of two strings is `|A ∩ B| / |A ∪ B|` over the sets of all their words. The
/// strings are normalized names (`[a-z0-9 ]`); anything else separates words, as in `pg_trgm`.
/// Postgres works in single precision; this is the exact ratio in double precision, as the server's
/// scorer computes it.
library;

final _separator = RegExp('[^a-z0-9]+');

/// The trigram set of [normalized].
Set<String> trigrams(String normalized) {
  final out = <String>{};
  for (final word in normalized.split(_separator)) {
    if (word.isEmpty) continue;
    final padded = '  $word ';
    for (var i = 0; i + 3 <= padded.length; i++) {
      out.add(padded.substring(i, i + 3));
    }
  }
  return out;
}

/// `similarity(a, b)`: 0 when either has no trigram.
double trigramSimilarity(String a, String b) => trigramSetSimilarity(trigrams(a), trigrams(b));

/// The same over sets already made, for scoring one string against many.
double trigramSetSimilarity(Set<String> a, Set<String> b) {
  if (a.isEmpty || b.isEmpty) return 0;
  final common = a.length <= b.length ? a.where(b.contains).length : b.where(a.contains).length;
  return common / (a.length + b.length - common);
}
