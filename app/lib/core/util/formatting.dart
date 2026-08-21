import 'package:intl/intl.dart';

/// Formatting helpers matching the prototype's output exactly.
class Fmt {
  const Fmt._();

  static final _isoDate = DateFormat('yyyy-MM-dd');
  static final _weekday = DateFormat('EEEE');
  static final _clock12 = DateFormat('hh:mm a');
  static final _clock24 = DateFormat('HH:mm');
  static final _orderStamp = DateFormat('yyyy-MM-dd HH:mm');

  /// The prototype's `new Date().toISOString().split('T')[0]`.
  static String isoDate(DateTime d) => _isoDate.format(d);

  /// `Intl.DateTimeFormat('en-US', { weekday: 'long' })`
  static String weekday(DateTime d) => _weekday.format(d);

  /// `Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' })`
  static String time12(DateTime d) => _clock12.format(d).toUpperCase();

  static String time24(DateTime d) => _clock24.format(d);

  /// Matches `handleOrder`'s `YYYY-MM-DD HH:mm` stamp.
  static String orderStamp(DateTime d) => _orderStamp.format(d);

  /// The dashboard subtitle, e.g. "Saturday, April 11".
  static String dashboardDate(DateTime d) =>
      DateFormat('EEEE, MMMM d').format(d);

  /// True age. The prototype used `currentYear - birthYear`, which is off by
  /// up to a year before the birthday (plan defect D10).
  static int age(DateTime dob, {DateTime? asOf}) {
    final now = asOf ?? DateTime.now();
    var years = now.year - dob.year;
    final hadBirthday =
        now.month > dob.month || (now.month == dob.month && now.day >= dob.day);
    if (!hadBirthday) years -= 1;
    return years < 0 ? 0 : years;
  }

  /// `toLocaleString()`-style thousands separators for impact metrics.
  static String count(num v) => NumberFormat.decimalPattern('en_US').format(v);

  static DateTime? tryParseIso(String? s) {
    if (s == null || s.isEmpty) return null;
    return DateTime.tryParse(s);
  }
}
