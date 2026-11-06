/// Birth dates: the structured value that syncs, and the rule that turns what a worker typed into
/// one (design 11.3).
///
/// Clients send only the structured [Birth]; the API never parses typed dates and checks ranges
/// only. apps/portal/src/lib/dob.ts parses the same way, and both are pinned by
/// packages/contract/test-vectors/dob.json, which fixes `today`.
library;

/// The earliest year a birth may be recorded in (the API refuses earlier ones).
const birthMinYear = 1900;

/// A birth as recorded: a full date, a year, or a year estimated from an age. Its JSON is the sync
/// value `birth` (`{precision, date}` or `{precision, year}`).
sealed class Birth {
  const Birth();

  /// The birth [json] holds, or null when it holds none this app knows (absent, or a precision a
  /// newer server added).
  static Birth? fromJson(Object? json) {
    if (json is! Map<Object?, Object?>) return null;
    switch (json['precision']) {
      case 'day':
        final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$')
            .firstMatch(json['date'] is String ? json['date']! as String : '');
        if (m == null) return null;
        return BirthDate(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
      case 'year':
        final y = json['year'];
        return y is num ? BirthYear(y.toInt()) : null;
      case 'estimated':
        final y = json['year'];
        return y is num ? BirthEstimate(y.toInt()) : null;
      default:
        return null;
    }
  }

  int get year;
  Map<String, Object?> toJson();
}

/// Born on a known day.
final class BirthDate extends Birth {
  const BirthDate(this.year, this.month, this.day);
  @override
  final int year;
  final int month;
  final int day;

  /// `YYYY-MM-DD`.
  String get iso =>
      '${year.toString().padLeft(4, '0')}-${month.toString().padLeft(2, '0')}-${day.toString().padLeft(2, '0')}';

  @override
  Map<String, Object?> toJson() => {'precision': 'day', 'date': iso};
  @override
  bool operator ==(Object other) =>
      other is BirthDate && other.year == year && other.month == month && other.day == day;
  @override
  int get hashCode => Object.hash('day', year, month, day);
  @override
  String toString() => 'BirthDate($iso)';
}

/// Born in a known year, the day not given.
final class BirthYear extends Birth {
  const BirthYear(this.year);
  @override
  final int year;
  @override
  Map<String, Object?> toJson() => {'precision': 'year', 'year': year};
  @override
  bool operator ==(Object other) => other is BirthYear && other.year == year;
  @override
  int get hashCode => Object.hash('year', year);
  @override
  String toString() => 'BirthYear($year)';
}

/// A year worked out from an age the worker heard or guessed ("about 46"); matched loosely.
final class BirthEstimate extends Birth {
  const BirthEstimate(this.year);
  @override
  final int year;
  @override
  Map<String, Object?> toJson() => {'precision': 'estimated', 'year': year};
  @override
  bool operator ==(Object other) => other is BirthEstimate && other.year == year;
  @override
  int get hashCode => Object.hash('estimated', year);
  @override
  String toString() => 'BirthEstimate($year)';
}

/// How the field was set: a date of birth, or an age. Age mode exists so "46" heard as an age can't
/// silently become a birth year.
enum BirthMode { date, age }

/// Why typed input was refused. [code] is the wire name dob.json uses.
enum BirthProblem {
  unreadable('unreadable'),
  badYear('bad_year'),
  invalidMonth('invalid_month'),
  invalidDay('invalid_day'),
  future('future'),
  before1900('before_1900');

  const BirthProblem(this.code);
  final String code;
}

sealed class BirthParse {
  const BirthParse();
}

/// What the phone understood, the sentence it reads back, and whether the worker must confirm it.
final class ParsedBirth extends BirthParse {
  const ParsedBirth(this.birth, {required this.readBack, required this.needsConfirmation});
  final Birth birth;
  final String readBack;

  /// The phone guessed: a two-digit year was expanded, day and month could be read either way, or
  /// the age is under 14 or over 100. **Yes, that's right** must be on before saving.
  final bool needsConfirmation;
}

final class BirthError extends BirthParse {
  const BirthError(this.problem, this.message);
  final BirthProblem problem;

  /// A fixed sentence for the field's error; it never repeats what was typed.
  final String message;
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

bool _leap(int y) => y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);

int daysInMonth(int year, int month) => switch (month) {
  2 => _leap(year) ? 29 : 28,
  4 || 6 || 9 || 11 => 30,
  _ => 31,
};

/// Whole years from [birth] to [today]: exact for a date, the difference of years otherwise.
int ageOn(Birth birth, DateTime today) => switch (birth) {
  BirthDate(:final year, :final month, :final day) =>
    today.year - year - (today.month < month || (today.month == month && today.day < day) ? 1 : 0),
  BirthYear(:final year) || BirthEstimate(:final year) => today.year - year,
};

/// The sentence read back after typing (dob.json `readBackFormats`), month spelled out, never
/// `03/07` (ambiguous).
String readBack(Birth birth, DateTime today) => switch (birth) {
  BirthDate(:final year, :final month, :final day) =>
    '${monthNames[month - 1]} $day, $year · age ${ageOn(birth, today)}',
  BirthYear(:final year) => 'Born in $year · about ${ageOn(birth, today)} (year only)',
  BirthEstimate(:final year) => 'About ${ageOn(birth, today)} years old · born around $year',
};

/// The date-of-birth rule (Oct 19): month first; a two-digit year always means the past.
///
/// In Date of birth mode the phone reads `3/7/46`, `03-07-46`, `030746`, `3/7/1946`, `03071946`,
/// `1946` and `46`. A two-digit year is the latest year ending in those digits whose full date is
/// not after [today]; for a year alone, the latest such year before the current one. In Age mode it
/// reads a whole number of years and stores an estimated birth year. [today] is the phone's date;
/// only its year, month and day are read.
///
/// PLAN-OPEN: day-month order (design 14.1, #20): month first for the US pilot; a team setting later.
/// PLAN-OPEN: the range that asks for confirmation (design 14.1, #21): an age under 14 or over 100.
BirthParse parseBirth(String input, BirthMode mode, DateTime today) {
  final text = input.trim();
  return switch (mode) {
    BirthMode.date => _parseDate(text, today),
    BirthMode.age => _parseAge(text, today),
  };
}

ParsedBirth _understood(Birth birth, DateTime today, {required bool guessed}) {
  final age = ageOn(birth, today);
  return ParsedBirth(birth, readBack: readBack(birth, today), needsConfirmation: guessed || age < 14 || age > 100);
}

BirthParse _parseAge(String text, DateTime today) {
  if (!RegExp(r'^\d{1,3}$').hasMatch(text)) {
    return const BirthError(BirthProblem.unreadable, 'Type the age in whole years, like 46.');
  }
  final year = today.year - int.parse(text);
  if (year < birthMinYear) {
    return const BirthError(BirthProblem.before1900, 'That age would mean a birth before 1900.');
  }
  return _understood(BirthEstimate(year), today, guessed: false);
}

final _separated = RegExp(r'^(\d{1,2})\s*[/.\-\s]\s*(\d{1,2})\s*[/.\-\s]\s*(\d+)$');

BirthParse _parseDate(String text, DateTime today) {
  if (RegExp(r'^\d+$').hasMatch(text)) {
    return switch (text.length) {
      2 || 4 => _year(text, today),
      6 || 8 => _date(int.parse(text.substring(0, 2)), int.parse(text.substring(2, 4)), text.substring(4), today),
      1 || 3 => _badYear,
      _ => _unreadable,
    };
  }
  final m = _separated.firstMatch(text);
  if (m == null) return _unreadable;
  return _date(int.parse(m[1]!), int.parse(m[2]!), m[3]!, today);
}

const _unreadable = BirthError(
  BirthProblem.unreadable,
  'Type the date as month, day and year, like 3/7/1946, or only the year.',
);
const _badYear = BirthError(BirthProblem.badYear, 'Type the year with 2 or 4 digits, like 46 or 1946.');

BirthParse _year(String digits, DateTime today) {
  final twoDigit = digits.length == 2;
  var year = int.parse(digits);
  if (twoDigit) {
    // The latest year ending in these digits before the current one: "26" in 2026 is 1926.
    final last = today.year - 1;
    year = last - (last - year) % 100;
  }
  if (year < birthMinYear) return const BirthError(BirthProblem.before1900, 'Years before 1900 can’t be recorded.');
  if (year > today.year) return const BirthError(BirthProblem.future, 'That year hasn’t come yet.');
  return _understood(BirthYear(year), today, guessed: twoDigit);
}

BirthParse _date(int month, int day, String yearDigits, DateTime today) {
  if (yearDigits.length != 2 && yearDigits.length != 4) return _badYear;
  if (month < 1 || month > 12) {
    return BirthError(
      BirthProblem.invalidMonth,
      'There is no month $month. Type the month first, like 3/7/1946 for March 7.',
    );
  }
  if (day < 1) return const BirthError(BirthProblem.invalidDay, 'There is no day 0.');
  final twoDigit = yearDigits.length == 2;
  var year = int.parse(yearDigits);
  if (twoDigit) {
    // The latest year ending in these digits whose date is not after today.
    year = today.year - (today.year - year) % 100;
    if (year == today.year && (month > today.month || (month == today.month && day > today.day))) year -= 100;
  }
  if (day > daysInMonth(year, month)) return BirthError(BirthProblem.invalidDay, _daysMessage(year, month, day));
  if (year < birthMinYear) return const BirthError(BirthProblem.before1900, 'Dates before 1900 can’t be recorded.');
  if (year > today.year || (year == today.year && (month > today.month || (month == today.month && day > today.day)))) {
    return const BirthError(BirthProblem.future, 'That date is after today.');
  }
  return _understood(BirthDate(year, month, day), today, guessed: twoDigit || (day <= 12 && day != month));
}

String _daysMessage(int year, int month, int day) {
  final name = monthNames[month - 1];
  if (month == 2 && day == 29) return '$year isn’t a leap year, so February has 28 days.';
  if (month == 2) return 'February has 28 or 29 days.';
  return '$name has ${daysInMonth(year, month)} days.';
}
