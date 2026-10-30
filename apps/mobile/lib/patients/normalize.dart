import 'generated/weak_tokens.dart';

/// Name normalization for search and matching (design 5.1), exactly as `sineobex.normalize_name()`
/// (0001) does it in Postgres: accents removed (`unaccent`), lower case, every run of characters
/// other than `a-z0-9` one space, trimmed, null when nothing is left.
///
/// Dart has no Unicode normalization, so, like the server's normalize.ts, this reads a character map
/// generated from Postgres (packages/contract/data/unaccent-latin.json: what `lower(unaccent(c))`
/// leaves of each character, anything outside `a-z0-9` as a space). A character outside the map is
/// a separator, as Postgres's regular expression makes it; decomposed marks map to nothing.
/// normalize.json pins this function, the server's and Postgres to each other. Non-Latin scripts
/// normalize to nothing today (design 14.2).
String? normalizeName(String? input) {
  if (input == null) return null;
  final out = StringBuffer();
  for (final c in input.runes) {
    if ((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39)) {
      out.writeCharCode(c);
    } else if (c >= 0x41 && c <= 0x5a) {
      out.writeCharCode(c + 0x20);
    } else {
      out.write(c < 0x80 ? ' ' : (unaccentLatin[c] ?? ' '));
    }
  }
  final norm = out.toString().replaceAll(_spaces, ' ').trim();
  return norm.isEmpty ? null : norm;
}

final _spaces = RegExp(' +');

/// The words of a normalized string.
List<String> tokensOf(String norm) => norm.isEmpty ? const [] : norm.split(' ');

/// Words that say little about who someone is ("Big Mike", "Mr Jones").
final weakTokenSet = weakTokens.toSet();

/// The words that count for scoring: weak words ("big", "mr", "jr", ...) are dropped unless nothing
/// else is left, so "Big Mike" finds "Mike" and "Big" alone still searches.
List<String> scoringTokens(String norm) {
  final all = tokensOf(norm);
  final strong = [
    for (final t in all)
      if (!weakTokenSet.contains(t)) t,
  ];
  return strong.isEmpty ? all : strong;
}

/// unaccent-latin.json's map: code point to what `normalize_name` leaves of it.
///
/// A copy, because the phone can't read packages/contract at run time; normalize_test fails if it
/// differs from the JSON by one entry.
final Map<int, String> unaccentLatin = Map.unmodifiable({
  for (final pair in _unaccentPairs.split('|')) pair.runes.first: pair.substring(pair.runes.first > 0xffff ? 2 : 1),
});

/// Each entry is the character, then what it becomes (possibly nothing); entries are separated by
/// `|`, which no replacement holds.
const _unaccentPairs =
    '\u00a9 c |\u00ae r |\u00bc1 4|\u00bd1 2|\u00be3 4|\u00c0a|\u00c1a|\u00c2a|\u00c3a|\u00c4a|\u00c5a|'
    '\u00c6ae|\u00c7c|\u00c8e|\u00c9e|\u00cae|\u00cbe|\u00cci|\u00cdi|\u00cei|\u00cfi|\u00d0d|\u00d1n|'
    '\u00d2o|\u00d3o|\u00d4o|\u00d5o|\u00d6o|\u00d8o|\u00d9u|\u00dau|\u00dbu|\u00dcu|\u00ddy|\u00deth|'
    '\u00dfss|\u00e0a|\u00e1a|\u00e2a|\u00e3a|\u00e4a|\u00e5a|\u00e6ae|\u00e7c|\u00e8e|\u00e9e|\u00eae|'
    '\u00ebe|\u00eci|\u00edi|\u00eei|\u00efi|\u00f0d|\u00f1n|\u00f2o|\u00f3o|\u00f4o|\u00f5o|\u00f6o|\u00f8o|'
    '\u00f9u|\u00fau|\u00fbu|\u00fcu|\u00fdy|\u00feth|\u00ffy|\u0100a|\u0101a|\u0102a|\u0103a|\u0104a|'
    '\u0105a|\u0106c|\u0107c|\u0108c|\u0109c|\u010ac|\u010bc|\u010cc|\u010dc|\u010ed|\u010fd|\u0110d|\u0111d|'
    '\u0112e|\u0113e|\u0114e|\u0115e|\u0116e|\u0117e|\u0118e|\u0119e|\u011ae|\u011be|\u011cg|\u011dg|\u011eg|'
    '\u011fg|\u0120g|\u0121g|\u0122g|\u0123g|\u0124h|\u0125h|\u0126h|\u0127h|\u0128i|\u0129i|\u012ai|\u012bi|'
    '\u012ci|\u012di|\u012ei|\u012fi|\u0130i|\u0131i|\u0132ij|\u0133ij|\u0134j|\u0135j|\u0136k|\u0137k|'
    '\u0138q|\u0139l|\u013al|\u013bl|\u013cl|\u013dl|\u013el|\u013fl|\u0140l|\u0141l|\u0142l|\u0143n|\u0144n|'
    '\u0145n|\u0146n|\u0147n|\u0148n|\u0149 n|\u014an|\u014bn|\u014co|\u014do|\u014eo|\u014fo|\u0150o|'
    '\u0151o|\u0152oe|\u0153oe|\u0154r|\u0155r|\u0156r|\u0157r|\u0158r|\u0159r|\u015as|\u015bs|\u015cs|'
    '\u015ds|\u015es|\u015fs|\u0160s|\u0161s|\u0162t|\u0163t|\u0164t|\u0165t|\u0166t|\u0167t|\u0168u|\u0169u|'
    '\u016au|\u016bu|\u016cu|\u016du|\u016eu|\u016fu|\u0170u|\u0171u|\u0172u|\u0173u|\u0174w|\u0175w|\u0176y|'
    '\u0177y|\u0178y|\u0179z|\u017az|\u017bz|\u017cz|\u017dz|\u017ez|\u017fs|\u0180b|\u0181b|\u0182b|\u0183b|'
    '\u0187c|\u0188c|\u0189d|\u018ad|\u018bd|\u018cd|\u0190e|\u0191f|\u0192f|\u0193g|\u0195hv|\u0196i|'
    '\u0197i|\u0198k|\u0199k|\u019al|\u019dn|\u019en|\u01a0o|\u01a1o|\u01a2oi|\u01a3oi|\u01a4p|\u01a5p|'
    '\u01abt|\u01act|\u01adt|\u01aet|\u01afu|\u01b0u|\u01b2v|\u01b3y|\u01b4y|\u01b5z|\u01b6z|\u01c4dz|'
    '\u01c5dz|\u01c6dz|\u01c7lj|\u01c8lj|\u01c9lj|\u01canj|\u01cbnj|\u01ccnj|\u01cda|\u01cea|\u01cfi|\u01d0i|'
    '\u01d1o|\u01d2o|\u01d3u|\u01d4u|\u01d5u|\u01d6u|\u01d7u|\u01d8u|\u01d9u|\u01dau|\u01dbu|\u01dcu|\u01dea|'
    '\u01dfa|\u01e0a|\u01e1a|\u01e4g|\u01e5g|\u01e6g|\u01e7g|\u01e8k|\u01e9k|\u01eao|\u01ebo|\u01eco|\u01edo|'
    '\u01f0j|\u01f1dz|\u01f2dz|\u01f3dz|\u01f4g|\u01f5g|\u01f8n|\u01f9n|\u01faa|\u01fba|\u0200a|\u0201a|'
    '\u0202a|\u0203a|\u0204e|\u0205e|\u0206e|\u0207e|\u0208i|\u0209i|\u020ai|\u020bi|\u020co|\u020do|\u020eo|'
    '\u020fo|\u0210r|\u0211r|\u0212r|\u0213r|\u0214u|\u0215u|\u0216u|\u0217u|\u0218s|\u0219s|\u021at|\u021bt|'
    '\u021eh|\u021fh|\u0221d|\u0224z|\u0225z|\u0226a|\u0227a|\u0228e|\u0229e|\u022ao|\u022bo|\u022co|\u022do|'
    '\u022eo|\u022fo|\u0230o|\u0231o|\u0232y|\u0233y|\u0234l|\u0235n|\u0236t|\u0237j|\u0238db|\u0239qp|'
    '\u023aa|\u023bc|\u023cc|\u023dl|\u023et|\u023fs|\u0240z|\u0243b|\u0244u|\u0246e|\u0247e|\u0248j|\u0249j|'
    '\u024cr|\u024dr|\u024ey|\u024fy|\u0253b|\u0255c|\u0256d|\u0257d|\u025be|\u025fj|\u0260g|\u0261g|\u0262g|'
    '\u0266h|\u0267h|\u0268i|\u026ai|\u026bl|\u026cl|\u026dl|\u0271m|\u0272n|\u0273n|\u0274n|\u0276oe|'
    '\u027cr|\u027dr|\u027er|\u0280r|\u0282s|\u0288t|\u0289u|\u028bv|\u028fy|\u0290z|\u0291z|\u0299b|\u029bg|'
    '\u029ch|\u029dj|\u029fl|\u02a0q|\u02a3dz|\u02a5dz|\u02a6ts|\u02aals|\u02ablz|\u0300|\u0301|\u0302|'
    '\u0303|\u0304|\u0305|\u0306|\u0307|\u0308|\u0309|\u030a|\u030b|\u030c|\u030d|\u030e|\u030f|\u0310|'
    '\u0311|\u0312|\u0313|\u0314|\u0315|\u0316|\u0317|\u0318|\u0319|\u031a|\u031b|\u031c|\u031d|\u031e|'
    '\u031f|\u0320|\u0321|\u0322|\u0323|\u0324|\u0325|\u0326|\u0327|\u0328|\u0329|\u032a|\u032b|\u032c|'
    '\u032d|\u032e|\u032f|\u0330|\u0331|\u0332|\u0333|\u0334|\u0335|\u0336|\u0337|\u0338|\u0339|\u033a|'
    '\u033b|\u033c|\u033d|\u033e|\u033f|\u0340|\u0341|\u0342|\u0343|\u0344|\u0345|\u0346|\u0347|\u0348|'
    '\u0349|\u034a|\u034b|\u034c|\u034d|\u034e|\u034f|\u0350|\u0351|\u0352|\u0353|\u0354|\u0355|\u0356|'
    '\u0357|\u0358|\u0359|\u035a|\u035b|\u035c|\u035d|\u035e|\u035f|\u0360|\u0361|\u0362|\u1d00a|\u1d01ae|'
    '\u1d03b|\u1d04c|\u1d05d|\u1d06d|\u1d07e|\u1d0aj|\u1d0bk|\u1d0cl|\u1d0dm|\u1d0fo|\u1d18p|\u1d1bt|\u1d1cu|'
    '\u1d20v|\u1d21w|\u1d22z|\u1d6bue|\u1d6cb|\u1d6dd|\u1d6ef|\u1d6fm|\u1d70n|\u1d71p|\u1d72r|\u1d73r|'
    '\u1d74s|\u1d75t|\u1d76z|\u1d7ath|\u1d7bi|\u1d7dp|\u1d7eu|\u1d80b|\u1d81d|\u1d82f|\u1d83g|\u1d84k|'
    '\u1d85l|\u1d86m|\u1d87n|\u1d88p|\u1d89r|\u1d8as|\u1d8cv|\u1d8dx|\u1d8ez|\u1d8fa|\u1d91d|\u1d92e|\u1d93e|'
    '\u1d96i|\u1d99u|\u1e00a|\u1e01a|\u1e02b|\u1e03b|\u1e04b|\u1e05b|\u1e06b|\u1e07b|\u1e08c|\u1e09c|\u1e0ad|'
    '\u1e0bd|\u1e0cd|\u1e0dd|\u1e0ed|\u1e0fd|\u1e10d|\u1e11d|\u1e12d|\u1e13d|\u1e14e|\u1e15e|\u1e16e|\u1e17e|'
    '\u1e18e|\u1e19e|\u1e1ae|\u1e1be|\u1e1ce|\u1e1de|\u1e1ef|\u1e1ff|\u1e20g|\u1e21g|\u1e22h|\u1e23h|\u1e24h|'
    '\u1e25h|\u1e26h|\u1e27h|\u1e28h|\u1e29h|\u1e2ah|\u1e2bh|\u1e2ci|\u1e2di|\u1e2ei|\u1e2fi|\u1e30k|\u1e31k|'
    '\u1e32k|\u1e33k|\u1e34k|\u1e35k|\u1e36l|\u1e37l|\u1e38l|\u1e39l|\u1e3al|\u1e3bl|\u1e3cl|\u1e3dl|\u1e3em|'
    '\u1e3fm|\u1e40m|\u1e41m|\u1e42m|\u1e43m|\u1e44n|\u1e45n|\u1e46n|\u1e47n|\u1e48n|\u1e49n|\u1e4an|\u1e4bn|'
    '\u1e4co|\u1e4do|\u1e4eo|\u1e4fo|\u1e50o|\u1e51o|\u1e52o|\u1e53o|\u1e54p|\u1e55p|\u1e56p|\u1e57p|\u1e58r|'
    '\u1e59r|\u1e5ar|\u1e5br|\u1e5cr|\u1e5dr|\u1e5er|\u1e5fr|\u1e60s|\u1e61s|\u1e62s|\u1e63s|\u1e64s|\u1e65s|'
    '\u1e66s|\u1e67s|\u1e68s|\u1e69s|\u1e6at|\u1e6bt|\u1e6ct|\u1e6dt|\u1e6et|\u1e6ft|\u1e70t|\u1e71t|\u1e72u|'
    '\u1e73u|\u1e74u|\u1e75u|\u1e76u|\u1e77u|\u1e78u|\u1e79u|\u1e7au|\u1e7bu|\u1e7cv|\u1e7dv|\u1e7ev|\u1e7fv|'
    '\u1e80w|\u1e81w|\u1e82w|\u1e83w|\u1e84w|\u1e85w|\u1e86w|\u1e87w|\u1e88w|\u1e89w|\u1e8ax|\u1e8bx|\u1e8cx|'
    '\u1e8dx|\u1e8ey|\u1e8fy|\u1e90z|\u1e91z|\u1e92z|\u1e93z|\u1e94z|\u1e95z|\u1e96h|\u1e97t|\u1e98w|\u1e99y|'
    '\u1e9aa|\u1e9cs|\u1e9ds|\u1e9ess|\u1ea0a|\u1ea1a|\u1ea2a|\u1ea3a|\u1ea4a|\u1ea5a|\u1ea6a|\u1ea7a|'
    '\u1ea8a|\u1ea9a|\u1eaaa|\u1eaba|\u1eaca|\u1eada|\u1eaea|\u1eafa|\u1eb0a|\u1eb1a|\u1eb2a|\u1eb3a|\u1eb4a|'
    '\u1eb5a|\u1eb6a|\u1eb7a|\u1eb8e|\u1eb9e|\u1ebae|\u1ebbe|\u1ebce|\u1ebde|\u1ebee|\u1ebfe|\u1ec0e|\u1ec1e|'
    '\u1ec2e|\u1ec3e|\u1ec4e|\u1ec5e|\u1ec6e|\u1ec7e|\u1ec8i|\u1ec9i|\u1ecai|\u1ecbi|\u1ecco|\u1ecdo|\u1eceo|'
    '\u1ecfo|\u1ed0o|\u1ed1o|\u1ed2o|\u1ed3o|\u1ed4o|\u1ed5o|\u1ed6o|\u1ed7o|\u1ed8o|\u1ed9o|\u1edao|\u1edbo|'
    '\u1edco|\u1eddo|\u1edeo|\u1edfo|\u1ee0o|\u1ee1o|\u1ee2o|\u1ee3o|\u1ee4u|\u1ee5u|\u1ee6u|\u1ee7u|\u1ee8u|'
    '\u1ee9u|\u1eeau|\u1eebu|\u1eecu|\u1eedu|\u1eeeu|\u1eefu|\u1ef0u|\u1ef1u|\u1ef2y|\u1ef3y|\u1ef4y|\u1ef5y|'
    '\u1ef6y|\u1ef7y|\u1ef8y|\u1ef9y|\u1efall|\u1efbll|\u1efcv|\u1efdv|\u1efey|\u1effy|\u20a0ce|\u20a2cr|'
    '\u20a3fr |\u20a4l |\u20a7pts|\u20b9rs|\u20batl|\u20dd|\u20de|\u20df|\u20e0|\u20e2|\u20e3|\u20e4|'
    '\u2100a c|\u2101a s|\u2102c|\u2103 c|\u2105c o|\u2106c u|\u2109 f|\u210ag|\u210bh|\u210cx|\u210dh|'
    '\u210eh|\u2110i|\u2111i|\u2112l|\u2113l|\u2115n|\u2116no|\u2117 p |\u2118p|\u2119p|\u211aq|\u211br|'
    '\u211cr|\u211dr|\u211erx|\u2121tel|\u2124z|\u2128z|\u212ak|\u212cb|\u212dc|\u212fe|\u2130e|\u2131f|'
    '\u2133m|\u2134o|\u2139i|\u213bfax|\u2145d|\u2146d|\u2147e|\u2148i|\u2149j|\u21501 7|\u21511 9|'
    '\u21521 10|\u21531 3|\u21542 3|\u21551 5|\u21562 5|\u21573 5|\u21584 5|\u21591 6|\u215a5 6|\u215b1 8|'
    '\u215c3 8|\u215d5 8|\u215e7 8|\u215f1 |\u2160i|\u2161ii|\u2162iii|\u2163iv|\u2164v|\u2165vi|\u2166vii|'
    '\u2167viii|\u2168ix|\u2169x|\u216axi|\u216bxii|\u216cl|\u216dc|\u216ed|\u216fm|\u2170i|\u2171ii|'
    '\u2172iii|\u2173iv|\u2174v|\u2175vi|\u2176vii|\u2177viii|\u2178ix|\u2179x|\u217axi|\u217bxii|\u217cl|'
    '\u217dc|\u217ed|\u217fm|\u21890 3|\u2474 1 |\u2475 2 |\u2476 3 |\u2477 4 |\u2478 5 |\u2479 6 |\u247a 7 |'
    '\u247b 8 |\u247c 9 |\u247d 10 |\u247e 11 |\u247f 12 |\u2480 13 |\u2481 14 |\u2482 15 |\u2483 16 |'
    '\u2484 17 |\u2485 18 |\u2486 19 |\u2487 20 |\u24881 |\u24892 |\u248a3 |\u248b4 |\u248c5 |\u248d6 |'
    '\u248e7 |\u248f8 |\u24909 |\u249110 |\u249211 |\u249312 |\u249413 |\u249514 |\u249615 |\u249716 |'
    '\u249817 |\u249918 |\u249a19 |\u249b20 |\u249c a |\u249d b |\u249e c |\u249f d |\u24a0 e |\u24a1 f |'
    '\u24a2 g |\u24a3 h |\u24a4 i |\u24a5 j |\u24a6 k |\u24a7 l |\u24a8 m |\u24a9 n |\u24aa o |\u24ab p |'
    '\u24ac q |\u24ad r |\u24ae s |\u24af t |\u24b0 u |\u24b1 v |\u24b2 w |\u24b3 x |\u24b4 y |\u24b5 z |'
    '\u2c60l|\u2c61l|\u2c62l|\u2c63p|\u2c64r|\u2c65a|\u2c66t|\u2c67h|\u2c68h|\u2c69k|\u2c6ak|\u2c6bz|\u2c6cz|'
    '\u2c6em|\u2c71v|\u2c72w|\u2c73w|\u2c74v|\u2c78e|\u2c7ao|\u2c7es|\u2c7fz|\u30070|\u3371hpa|\u3372da|'
    '\u3373au|\u3374bar|\u3375ov|\u3376pc|\u3377dm|\u337aiu|\u3380pa|\u3381na|\u3383ma|\u3384ka|\u3385kb|'
    '\u3386mb|\u3387gb|\u3388cal|\u3389kcal|\u338apf|\u338bnf|\u338emg|\u338fkg|\u3390hz|\u3391khz|\u3392mhz|'
    '\u3393ghz|\u3394thz|\u3399fm|\u339anm|\u339cmm|\u339dcm|\u339ekm|\u33a7m s|\u33a9pa|\u33aakpa|\u33abmpa|'
    '\u33acgpa|\u33adrad|\u33aerad s|\u33b0ps|\u33b1ns|\u33b3ms|\u33b4pv|\u33b5nv|\u33b7mv|\u33b8kv|\u33b9mv|'
    '\u33bapw|\u33bbnw|\u33bdmw|\u33bekw|\u33bfmw|\u33c2a m |\u33c3bq|\u33c4cc|\u33c5cd|\u33c6c kg|\u33c7co |'
    '\u33c8db|\u33c9gy|\u33caha|\u33cbhp|\u33ccin|\u33cdkk|\u33cekm|\u33cfkt|\u33d0lm|\u33d1ln|\u33d2log|'
    '\u33d3lx|\u33d4mb|\u33d5mil|\u33d6mol|\u33d7ph|\u33d8p m |\u33d9ppm|\u33dapr|\u33dbsr|\u33dcsv|\u33ddwb|'
    '\u33dev m|\u33dfa m|\ua730f|\ua731s|\ua732aa|\ua733aa|\ua734ao|\ua735ao|\ua736au|\ua737au|\ua738av|'
    '\ua739av|\ua73aav|\ua73bav|\ua73cay|\ua73day|\ua740k|\ua741k|\ua742k|\ua743k|\ua744k|\ua745k|\ua746l|'
    '\ua747l|\ua748l|\ua749l|\ua74ao|\ua74bo|\ua74co|\ua74do|\ua74eoo|\ua74foo|\ua750p|\ua751p|\ua752p|'
    '\ua753p|\ua754p|\ua755p|\ua756q|\ua757q|\ua758q|\ua759q|\ua75ev|\ua75fv|\ua760vy|\ua761vy|\ua764th|'
    '\ua765th|\ua766th|\ua767th|\ua771d|\ua772l|\ua773m|\ua774n|\ua775r|\ua776r|\ua777t|\ua779d|\ua77ad|'
    '\ua77bf|\ua77cf|\ua786t|\ua787t|\ua790n|\ua791n|\ua792c|\ua793c|\ua7a0g|\ua7a1g|\ua7a2k|\ua7a3k|\ua7a4n|'
    '\ua7a5n|\ua7a6r|\ua7a7r|\ua7a8s|\ua7a9s|\ua7aah|\ufb00ff|\ufb01fi|\ufb02fl|\ufb03ffi|\ufb04ffl|\ufb05st|'
    '\ufb06st|\uff100|\uff111|\uff122|\uff133|\uff144|\uff155|\uff166|\uff177|\uff188|\uff199|\uff21a|'
    '\uff22b|\uff23c|\uff24d|\uff25e|\uff26f|\uff27g|\uff28h|\uff29i|\uff2aj|\uff2bk|\uff2cl|\uff2dm|\uff2en|'
    '\uff2fo|\uff30p|\uff31q|\uff32r|\uff33s|\uff34t|\uff35u|\uff36v|\uff37w|\uff38x|\uff39y|\uff3az|\uff41a|'
    '\uff42b|\uff43c|\uff44d|\uff45e|\uff46f|\uff47g|\uff48h|\uff49i|\uff4aj|\uff4bk|\uff4cl|\uff4dm|\uff4en|'
    '\uff4fo|\uff50p|\uff51q|\uff52r|\uff53s|\uff54t|\uff55u|\uff56v|\uff57w|\uff58x|\uff59y|\uff5az|'
    '\u{1f100}0 |\u{1f101}0 |\u{1f102}1 |\u{1f103}2 |\u{1f104}3 |\u{1f105}4 |\u{1f106}5 |\u{1f107}6 |'
    '\u{1f108}7 |\u{1f109}8 |\u{1f10a}9 |\u{1f110} a |\u{1f111} b |\u{1f112} c |\u{1f113} d |\u{1f114} e |'
    '\u{1f115} f |\u{1f116} g |\u{1f117} h |\u{1f118} i |\u{1f119} j |\u{1f11a} k |\u{1f11b} l |\u{1f11c} m |'
    '\u{1f11d} n |\u{1f11e} o |\u{1f11f} p |\u{1f120} q |\u{1f121} r |\u{1f122} s |\u{1f123} t |\u{1f124} u |'
    '\u{1f125} v |\u{1f126} w |\u{1f127} x |\u{1f128} y |\u{1f129} z ';
