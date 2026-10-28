import 'generated/weak_tokens.dart';

/// Name normalization for search and duplicate matching (design 5.1), the phone's copy of
/// `sineobex.normalize_name` (0001): accents removed, lower case, every run of characters other
/// than `a-z0-9` one space, trimmed; nothing left is null. Dart has no Unicode normalization, so
/// accents come off through a character map taken from Postgres `unaccent`, which also takes
/// decomposed marks (U+0300–U+036F) to nothing and ligatures to their letters (Æ to AE, ß to ss).
/// Non-Latin scripts are dropped, as on the server (design risk 14.2-7).
String? normalizeName(String? input) {
  if (input == null) return null;
  final out = StringBuffer();
  for (final unit in input.codeUnits) {
    final mapped = _unaccent[unit];
    if (mapped != null) {
      out.write(mapped);
    } else {
      out.writeCharCode(unit);
    }
  }
  final text = _lowerAscii(out.toString()).replaceAll(_notToken, ' ').trim();
  return text.isEmpty ? null : text;
}

final _notToken = RegExp('[^a-z0-9]+');

/// Postgres `lower()` changes more than ASCII, but anything else it changes is dropped next.
String _lowerAscii(String s) => String.fromCharCodes(s.codeUnits.map((c) => c >= 0x41 && c <= 0x5a ? c + 0x20 : c));

/// The words of a normalized name.
List<String> nameTokens(String? normalized) =>
    normalized == null || normalized.isEmpty ? const [] : normalized.split(' ');

/// Words that say little about who someone is ("Big Mike", "Mr Jones").
final weakTokenSet = weakTokens.toSet();

/// The tokens a score compares: [tokens] without [weakTokenSet], unless nothing else is left
/// ("Big Mike" finds "Mike"; "Big" alone still searches).
List<String> scoringTokens(List<String> tokens) {
  final strong = [
    for (final t in tokens)
      if (!weakTokenSet.contains(t)) t,
  ];
  return strong.isEmpty ? tokens : strong;
}

/// UTF-16 code unit to its replacement, from `unaccent` over U+00C0–U+024F, U+0300–U+036F and
/// U+1E00–U+1EFF (characters it leaves unchanged are absent).
// Interim: read from Postgres 16 with `select chr(c), unaccent(chr(c))` over those ranges, until
// packages/contract/data/unaccent-latin.json and its generated module land with the matching work.
final Map<int, String> _unaccent = {
  for (final pair in _unaccentPairs.split(' ')) pair.codeUnitAt(0): pair.substring(1),
};

/// Each pair is the character, then what it becomes (possibly nothing); pairs are separated by spaces.
const _unaccentPairs =
    '\u00c0A \u00c1A \u00c2A \u00c3A \u00c4A \u00c5A \u00c6AE \u00c7C \u00c8E \u00c9E \u00caE \u00cbE '
    '\u00ccI \u00cdI \u00ceI \u00cfI \u00d0D \u00d1N \u00d2O \u00d3O \u00d4O \u00d5O \u00d6O \u00d7* '
    '\u00d8O \u00d9U \u00daU \u00dbU \u00dcU \u00ddY \u00deTH \u00dfss \u00e0a \u00e1a \u00e2a \u00e3a '
    '\u00e4a \u00e5a \u00e6ae \u00e7c \u00e8e \u00e9e \u00eae \u00ebe \u00eci \u00edi \u00eei \u00efi '
    '\u00f0d \u00f1n \u00f2o \u00f3o \u00f4o \u00f5o \u00f6o \u00f7/ \u00f8o \u00f9u \u00fau \u00fbu '
    '\u00fcu \u00fdy \u00feth \u00ffy \u0100A \u0101a \u0102A \u0103a \u0104A \u0105a \u0106C \u0107c '
    '\u0108C \u0109c \u010aC \u010bc \u010cC \u010dc \u010eD \u010fd \u0110D \u0111d \u0112E \u0113e '
    '\u0114E \u0115e \u0116E \u0117e \u0118E \u0119e \u011aE \u011be \u011cG \u011dg \u011eG \u011fg '
    '\u0120G \u0121g \u0122G \u0123g \u0124H \u0125h \u0126H \u0127h \u0128I \u0129i \u012aI \u012bi '
    '\u012cI \u012di \u012eI \u012fi \u0130I \u0131i \u0132IJ \u0133ij \u0134J \u0135j \u0136K \u0137k '
    '\u0138q \u0139L \u013al \u013bL \u013cl \u013dL \u013el \u013fL \u0140l \u0141L \u0142l \u0143N '
    '\u0144n \u0145N \u0146n \u0147N \u0148n \u0149\'n \u014aN \u014bn \u014cO \u014do \u014eO \u014fo '
    '\u0150O \u0151o \u0152OE \u0153oe \u0154R \u0155r \u0156R \u0157r \u0158R \u0159r \u015aS \u015bs '
    '\u015cS \u015ds \u015eS \u015fs \u0160S \u0161s \u0162T \u0163t \u0164T \u0165t \u0166T \u0167t '
    '\u0168U \u0169u \u016aU \u016bu \u016cU \u016du \u016eU \u016fu \u0170U \u0171u \u0172U \u0173u '
    '\u0174W \u0175w \u0176Y \u0177y \u0178Y \u0179Z \u017az \u017bZ \u017cz \u017dZ \u017ez \u017fs '
    '\u0180b \u0181B \u0182B \u0183b \u0187C \u0188c \u0189D \u018aD \u018bD \u018cd \u0190E \u0191F '
    '\u0192f \u0193G \u0195hv \u0196I \u0197I \u0198K \u0199k \u019al \u019dN \u019en \u01a0O \u01a1o '
    '\u01a2OI \u01a3oi \u01a4P \u01a5p \u01abt \u01acT \u01adt \u01aeT \u01afU \u01b0u \u01b2V \u01b3Y '
    '\u01b4y \u01b5Z \u01b6z \u01c4DZ \u01c5Dz \u01c6dz \u01c7LJ \u01c8Lj \u01c9lj \u01caNJ \u01cbNj '
    '\u01ccnj \u01cdA \u01cea \u01cfI \u01d0i \u01d1O \u01d2o \u01d3U \u01d4u \u01d5U \u01d6u \u01d7U '
    '\u01d8u \u01d9U \u01dau \u01dbU \u01dcu \u01deA \u01dfa \u01e0A \u01e1a \u01e4G \u01e5g \u01e6G '
    '\u01e7g \u01e8K \u01e9k \u01eaO \u01ebo \u01ecO \u01edo \u01f0j \u01f1DZ \u01f2Dz \u01f3dz \u01f4G '
    '\u01f5g \u01f8N \u01f9n \u01faA \u01fba \u0200A \u0201a \u0202A \u0203a \u0204E \u0205e \u0206E '
    '\u0207e \u0208I \u0209i \u020aI \u020bi \u020cO \u020do \u020eO \u020fo \u0210R \u0211r \u0212R '
    '\u0213r \u0214U \u0215u \u0216U \u0217u \u0218S \u0219s \u021aT \u021bt \u021eH \u021fh \u0221d '
    '\u0224Z \u0225z \u0226A \u0227a \u0228E \u0229e \u022aO \u022bo \u022cO \u022do \u022eO \u022fo '
    '\u0230O \u0231o \u0232Y \u0233y \u0234l \u0235n \u0236t \u0237j \u0238db \u0239qp \u023aA \u023bC '
    '\u023cc \u023dL \u023eT \u023fs \u0240z \u0243B \u0244U \u0246E \u0247e \u0248J \u0249j \u024cR '
    '\u024dr \u024eY \u024fy \u0300 \u0301 \u0302 \u0303 \u0304 \u0305 \u0306 \u0307 \u0308 \u0309 '
    '\u030a \u030b \u030c \u030d \u030e \u030f \u0310 \u0311 \u0312 \u0313 \u0314 \u0315 \u0316 \u0317 '
    '\u0318 \u0319 \u031a \u031b \u031c \u031d \u031e \u031f \u0320 \u0321 \u0322 \u0323 \u0324 \u0325 '
    '\u0326 \u0327 \u0328 \u0329 \u032a \u032b \u032c \u032d \u032e \u032f \u0330 \u0331 \u0332 \u0333 '
    '\u0334 \u0335 \u0336 \u0337 \u0338 \u0339 \u033a \u033b \u033c \u033d \u033e \u033f \u0340 \u0341 '
    '\u0342 \u0343 \u0344 \u0345 \u0346 \u0347 \u0348 \u0349 \u034a \u034b \u034c \u034d \u034e \u034f '
    '\u0350 \u0351 \u0352 \u0353 \u0354 \u0355 \u0356 \u0357 \u0358 \u0359 \u035a \u035b \u035c \u035d '
    '\u035e \u035f \u0360 \u0361 \u0362 \u1e00A \u1e01a \u1e02B \u1e03b \u1e04B \u1e05b \u1e06B \u1e07b '
    '\u1e08C \u1e09c \u1e0aD \u1e0bd \u1e0cD \u1e0dd \u1e0eD \u1e0fd \u1e10D \u1e11d \u1e12D \u1e13d '
    '\u1e14E \u1e15e \u1e16E \u1e17e \u1e18E \u1e19e \u1e1aE \u1e1be \u1e1cE \u1e1de \u1e1eF \u1e1ff '
    '\u1e20G \u1e21g \u1e22H \u1e23h \u1e24H \u1e25h \u1e26H \u1e27h \u1e28H \u1e29h \u1e2aH \u1e2bh '
    '\u1e2cI \u1e2di \u1e2eI \u1e2fi \u1e30K \u1e31k \u1e32K \u1e33k \u1e34K \u1e35k \u1e36L \u1e37l '
    '\u1e38L \u1e39l \u1e3aL \u1e3bl \u1e3cL \u1e3dl \u1e3eM \u1e3fm \u1e40M \u1e41m \u1e42M \u1e43m '
    '\u1e44N \u1e45n \u1e46N \u1e47n \u1e48N \u1e49n \u1e4aN \u1e4bn \u1e4cO \u1e4do \u1e4eO \u1e4fo '
    '\u1e50O \u1e51o \u1e52O \u1e53o \u1e54P \u1e55p \u1e56P \u1e57p \u1e58R \u1e59r \u1e5aR \u1e5br '
    '\u1e5cR \u1e5dr \u1e5eR \u1e5fr \u1e60S \u1e61s \u1e62S \u1e63s \u1e64S \u1e65s \u1e66S \u1e67s '
    '\u1e68S \u1e69s \u1e6aT \u1e6bt \u1e6cT \u1e6dt \u1e6eT \u1e6ft \u1e70T \u1e71t \u1e72U \u1e73u '
    '\u1e74U \u1e75u \u1e76U \u1e77u \u1e78U \u1e79u \u1e7aU \u1e7bu \u1e7cV \u1e7dv \u1e7eV \u1e7fv '
    '\u1e80W \u1e81w \u1e82W \u1e83w \u1e84W \u1e85w \u1e86W \u1e87w \u1e88W \u1e89w \u1e8aX \u1e8bx '
    '\u1e8cX \u1e8dx \u1e8eY \u1e8fy \u1e90Z \u1e91z \u1e92Z \u1e93z \u1e94Z \u1e95z \u1e96h \u1e97t '
    '\u1e98w \u1e99y \u1e9aa \u1e9cs \u1e9ds \u1e9eSS \u1ea0A \u1ea1a \u1ea2A \u1ea3a \u1ea4A \u1ea5a '
    '\u1ea6A \u1ea7a \u1ea8A \u1ea9a \u1eaaA \u1eaba \u1eacA \u1eada \u1eaeA \u1eafa \u1eb0A \u1eb1a '
    '\u1eb2A \u1eb3a \u1eb4A \u1eb5a \u1eb6A \u1eb7a \u1eb8E \u1eb9e \u1ebaE \u1ebbe \u1ebcE \u1ebde '
    '\u1ebeE \u1ebfe \u1ec0E \u1ec1e \u1ec2E \u1ec3e \u1ec4E \u1ec5e \u1ec6E \u1ec7e \u1ec8I \u1ec9i '
    '\u1ecaI \u1ecbi \u1eccO \u1ecdo \u1eceO \u1ecfo \u1ed0O \u1ed1o \u1ed2O \u1ed3o \u1ed4O \u1ed5o '
    '\u1ed6O \u1ed7o \u1ed8O \u1ed9o \u1edaO \u1edbo \u1edcO \u1eddo \u1edeO \u1edfo \u1ee0O \u1ee1o '
    '\u1ee2O \u1ee3o \u1ee4U \u1ee5u \u1ee6U \u1ee7u \u1ee8U \u1ee9u \u1eeaU \u1eebu \u1eecU \u1eedu '
    '\u1eeeU \u1eefu \u1ef0U \u1ef1u \u1ef2Y \u1ef3y \u1ef4Y \u1ef5y \u1ef6Y \u1ef7y \u1ef8Y \u1ef9y '
    '\u1efaLL \u1efbll \u1efcV \u1efdv \u1efeY \u1effy';
