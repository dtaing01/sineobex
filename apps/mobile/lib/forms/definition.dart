/// A resolved note type definition (phase 4 design, forms 2 and 3.4), as the server and the bundled
/// presets hand it to the phone: one version of one note type, its includes and shared lists already
/// copied in. packages/forms/src/resolve.ts and types.ts describe the same shape; the definition is
/// checked there, by the validator, before anything stores it, so this only reads it.
///
/// Every class here is immutable and pure. The interpreter (one file per function in this folder)
/// reads a definition and a note's answers, and nothing else.
library;

/// Who a note type is offered to. [code] is the wire value.
enum NoteKind {
  medical('medical'),
  nonMedical('non_medical');

  const NoteKind(this.code);
  final String code;
}

/// `sensitive`: reading it needs patients.view_sensitive.
enum Sensitivity { none, sensitive }

/// One version of one note type, resolved.
class NoteTypeDef {
  const NoteTypeDef({
    required this.key,
    required this.version,
    required this.title,
    required this.kinds,
    required this.group,
    required this.sensitivity,
    required this.sections,
    this.quick = false,
    this.auto,
  });

  /// Reads a resolved definition from its JSON. A shape the validator would never pass throws a
  /// [FormatException] naming where it is, never a cast error.
  factory NoteTypeDef.fromJson(Map<String, Object?> json) {
    final r = _Reader(json, r'$');
    return NoteTypeDef(
      key: r.string('key'),
      version: r.integer('version'),
      title: r.string('title'),
      kinds: [for (final k in r.strings('kinds')) _byCode(NoteKind.values, (v) => v.code, k, r.at('kinds'))],
      group: r.string('group'),
      sensitivity: _byCode(Sensitivity.values, (v) => v.name, r.string('sensitivity'), r.at('sensitivity')),
      quick: r.flag('quick'),
      auto: r.maybeString('auto'),
      sections: r.list('sections', SectionDef._read),
    );
  }

  final String key;
  final int version;
  final String title;
  final List<NoteKind> kinds;

  /// Its timeline filter (lifecycle 5.2).
  final String group;
  final Sensitivity sensitivity;

  /// The Quick encounter.
  final bool quick;

  /// `medical`: added by itself with the first Medical note of an encounter (6.2).
  final String? auto;
  final List<SectionDef> sections;
}

/// A repeating section's entries are added one at a time; `itemTitle` is "Wound {n}".
class RepeatDef {
  const RepeatDef({required this.max, required this.itemTitle});
  final int max;
  final String itemTitle;
}

class SectionDef {
  const SectionDef({
    required this.id,
    required this.title,
    required this.fields,
    this.showWhen,
    this.sensitiveExam = false,
    this.treatmentRecord = false,
    this.needs,
    this.normal = false,
    this.repeat,
  });

  static SectionDef _read(_Reader r) => SectionDef(
    id: r.string('id'),
    title: r.string('title'),
    showWhen: r.maybe('showWhen', Condition._read),
    sensitiveExam: r.flag('sensitiveExam'),
    treatmentRecord: r.flag('treatmentRecord'),
    needs: r.maybeString('needs'),
    normal: r.flag('normal'),
    repeat: r.maybe('repeat', (r) => RepeatDef(max: r.integer('max'), itemTitle: r.string('itemTitle'))),
    fields: r.list('fields', FieldDef._read),
  );

  /// The first part of every path in it.
  final String id;
  final String title;
  final Condition? showWhen;

  /// Reading it needs patients.view_sensitive_exams.
  final bool sensitiveExam;

  /// Substance use treatment: reading it needs a clinical credential.
  final bool treatmentRecord;

  /// `orderMedications`: shown to, and changed by, a credential with that capability only.
  final String? needs;

  /// Offers one-tap Normal.
  final bool normal;
  final RepeatDef? repeat;
  final List<FieldDef> fields;
}

class OptionDef {
  const OptionDef({
    required this.code,
    required this.label,
    this.exclusive = false,
    this.other = false,
    this.normal = false,
    this.unable = false,
    this.icon,
    this.suggests,
    this.sensitiveExam = false,
  });

  static OptionDef _read(_Reader r) => OptionDef(
    code: r.string('code'),
    label: r.string('label'),
    exclusive: r.flag('exclusive'),
    other: r.flag('other'),
    normal: r.flag('normal'),
    unable: r.flag('unable'),
    icon: r.maybeString('icon'),
    suggests: r.maybeString('suggests'),
    sensitiveExam: r.flag('sensitiveExam'),
  );

  final String code;
  final String label;

  /// Picking it clears the others (None, Normal, No).
  final bool exclusive;

  /// Needs a short text, stored beside the answer.
  final bool other;

  /// Set by one-tap Normal.
  final bool normal;

  /// "Unable to assess": neither normal nor abnormal.
  final bool unable;
  final String? icon;

  /// A note type key to suggest on the summary screen.
  final String? suggests;

  /// In the exam picker: a system whose name is itself sensitive (6.6).
  final bool sensitiveExam;
}

/// When a section or a field shows. `field` is a path in the same note type; inside a repeating
/// section it may start `./`, from the entry, and inside a grid's cell `./` starts from the row.
sealed class Condition {
  const Condition();

  static Condition _read(_Reader r) {
    if (r.has('all')) return AllCondition(r.list('all', _read));
    if (r.has('any')) return AnyCondition(r.list('any', _read));
    if (r.has('not')) return NotCondition(r.object('not', _read));
    final field = r.string('field');
    if (r.has('filled')) return FilledCondition(field);
    // `is` is one code or a list of them; either holds when one of them is picked.
    final codes = r.value('is') is String ? [r.string('is')] : r.strings('is');
    return IsCondition(field, codes);
  }
}

class IsCondition extends Condition {
  const IsCondition(this.field, this.codes);
  final String field;
  final List<String> codes;
}

class FilledCondition extends Condition {
  const FilledCondition(this.field);
  final String field;
}

class AllCondition extends Condition {
  const AllCondition(this.all);
  final List<Condition> all;
}

class AnyCondition extends Condition {
  const AnyCondition(this.any);
  final List<Condition> any;
}

class NotCondition extends Condition {
  const NotCondition(this.not);
  final Condition not;
}

/// A field of any of the fourteen kinds. What every kind carries is here; each kind adds its own.
sealed class FieldDef {
  FieldDef(_Common c)
    : id = c.id,
      label = c.label,
      help = c.help,
      showWhen = c.showWhen,
      required = c.required,
      sides = c.sides,
      noNormal = c.noNormal,
      recap = c.recap,
      handoff = c.handoff,
      mapsTo = c.mapsTo;

  static FieldDef _read(_Reader r) {
    final c = _Common(r);
    final kind = r.string('kind');
    return switch (kind) {
      'choice' => ChoiceDef._(
        c,
        many: r.boolean('many'),
        options: r.list('options', OptionDef._read),
        excludes: r.pairs('excludes'),
      ),
      'text' => TextDef._(c, lines: r.string('lines'), maxLength: r.integer('maxLength')),
      'number' => NumberDef._(
        c,
        min: r.number('min'),
        max: r.number('max'),
        decimals: r.integer('decimals'),
        unit: r.maybeString('unit'),
        altUnit: r.maybe('altUnit', (r) => AltUnit(unit: r.string('unit'), perUnit: r.number('perUnit'))),
        display: r.maybeString('display'),
        normal: r.has('normal') ? r.number('normal') : null,
      ),
      'flag' => FlagDef._(c, clears: r.has('clears') ? r.strings('clears') : const []),
      'date' => DateDef._(c, range: r.string('range')),
      'time' => TimeDef._(c),
      'duration' => DurationDef._(c),
      'group' => GroupDef._(
        c,
        layout: r.string('layout'),
        collapsed: r.flag('collapsed'),
        fields: r.list('fields', _read),
      ),
      'grid' => GridDef._(
        c,
        collapsed: r.flag('collapsed'),
        rows: r.value('rows') is List ? r.list('rows', OptionDef._read) : null,
        pickedIn: r.value('rows') is List ? null : r.object('rows', (r) => r.string('pickedIn')),
        cell: r.object('cell', _read),
      ),
      'region' => RegionDef._(
        c,
        options: r.list('options', OptionDef._read),
        side: r.has('side') ? r.list('side', OptionDef._read) : null,
        surface: r.has('surface') ? r.list('surface', OptionDef._read) : null,
      ),
      'problem' => ProblemDef._(c),
      'photo' => PhotoDef._(c, max: r.integer('max')),
      'action' => ActionDef._(c, action: r.string('action'), noteType: r.maybeString('noteType')),
      'info' => InfoDef._(c),
      _ => throw r.fault('kind', 'one of the fourteen kinds'),
    };
  }

  /// One path part.
  final String id;

  /// May be a full question.
  final String label;
  final String? help;
  final Condition? showWhen;

  /// Stops Complete while it shows and is empty.
  final bool required;

  /// Recorded once for right and once for left: a last path part, `right` or `left`.
  final bool sides;

  /// One-tap Normal never fills it (chaperone, consent).
  final bool noNormal;

  /// False: left out of the recap.
  final bool recap;

  /// Goes into the EMS handoff summary.
  final bool handoff;

  /// `<note type key>:<path>`: the full note type's field, without any entry part (6.4).
  final String? mapsTo;

  /// The kind, as the definition writes it.
  String get kind;
}

class ChoiceDef extends FieldDef {
  ChoiceDef._(super.c, {required this.many, required this.options, required this.excludes});
  final bool many;
  final List<OptionDef> options;

  /// Pairs of codes that can't be held together.
  final List<(String, String)> excludes;
  @override
  String get kind => 'choice';
}

class TextDef extends FieldDef {
  TextDef._(super.c, {required this.lines, required this.maxLength});

  /// `one` or `many`.
  final String lines;
  final int maxLength;
  @override
  String get kind => 'text';
}

/// A second unit to type in: inches, 2.54 cm each. The answer is stored in the field's own unit.
class AltUnit {
  const AltUnit({required this.unit, required this.perUnit});
  final String unit;
  final num perUnit;
}

class NumberDef extends FieldDef {
  NumberDef._(
    super.c, {
    required this.min,
    required this.max,
    required this.decimals,
    this.unit,
    this.altUnit,
    this.display,
    this.normal,
  });
  final num min;
  final num max;

  /// 0, 1 or 2.
  final int decimals;
  final String? unit;
  final AltUnit? altUnit;

  /// `box`, `stepper` or `outOf`.
  final String? display;

  /// What one-tap Normal fills.
  final num? normal;
  @override
  String get kind => 'number';
}

/// A tick. While it is set, the fields beside it named in [clears] do not count.
class FlagDef extends FieldDef {
  FlagDef._(super.c, {required this.clears});
  final List<String> clears;
  @override
  String get kind => 'flag';
}

class DateDef extends FieldDef {
  DateDef._(super.c, {required this.range});

  /// `past`, `future` or `any`: the picker's bound.
  final String range;
  @override
  String get kind => 'date';
}

class TimeDef extends FieldDef {
  TimeDef._(super.c);
  @override
  String get kind => 'time';
}

/// Weeks and days, stored as days.
class DurationDef extends FieldDef {
  DurationDef._(super.c);
  @override
  String get kind => 'duration';
}

/// Stores nothing itself: its fields add a path part.
class GroupDef extends FieldDef {
  GroupDef._(super.c, {required this.layout, required this.collapsed, required this.fields});

  /// `stack` or `row`.
  final String layout;

  /// Closed until tapped.
  final bool collapsed;
  final List<FieldDef> fields;
  @override
  String get kind => 'group';
}

/// One [cell] for each row. Its rows are either fixed ([rows]) or the options picked in the
/// choose-many at [pickedIn]; exactly one of the two is set.
class GridDef extends FieldDef {
  GridDef._(super.c, {required this.collapsed, required this.cell, this.rows, this.pickedIn});
  final bool collapsed;
  final List<OptionDef>? rows;
  final String? pickedIn;
  final FieldDef cell;
  @override
  String get kind => 'grid';
}

/// A body region, with its side and its surface when the definition asks for them: each the
/// options of a shared list, copied in.
class RegionDef extends FieldDef {
  RegionDef._(super.c, {required this.options, this.side, this.surface});
  final List<OptionDef> options;
  final List<OptionDef>? side;
  final List<OptionDef>? surface;
  @override
  String get kind => 'region';
}

/// One diagnosis from the problem code list: its code and its label.
class ProblemDef extends FieldDef {
  ProblemDef._(super.c);
  @override
  String get kind => 'problem';
}

class PhotoDef extends FieldDef {
  PhotoDef._(super.c, {required this.max});
  final int max;
  @override
  String get kind => 'photo';
}

/// A button. [noteType] is set for `open_note_type` only.
class ActionDef extends FieldDef {
  ActionDef._(super.c, {required this.action, this.noteType});
  final String action;
  final String? noteType;
  @override
  String get kind => 'action';
}

/// The label is guidance; nothing is stored.
class InfoDef extends FieldDef {
  InfoDef._(super.c);
  @override
  String get kind => 'info';
}

class _Common {
  _Common(_Reader r)
    : id = r.string('id'),
      label = r.string('label'),
      help = r.maybeString('help'),
      showWhen = r.maybe('showWhen', Condition._read),
      required = r.flag('required'),
      sides = r.flag('sides'),
      noNormal = r.flag('noNormal'),
      recap = !r.has('recap') || r.boolean('recap'),
      handoff = r.flag('handoff'),
      mapsTo = r.maybeString('mapsTo');
  final String id;
  final String label;
  final String? help;
  final Condition? showWhen;
  final bool required;
  final bool sides;
  final bool noNormal;
  final bool recap;
  final bool handoff;
  final String? mapsTo;
}

T _byCode<T>(List<T> values, String Function(T) code, String wire, String at) =>
    values.firstWhere((v) => code(v) == wire, orElse: () => throw FormatException('$at is not a known value'));

/// Reads one JSON object of a definition, naming the place of anything it cannot read.
class _Reader {
  _Reader(this.json, this.place);
  final Map<String, Object?> json;
  final String place;

  String at(String key) => '$place.$key';
  FormatException fault(String key, String wanted) => FormatException('${at(key)} is not $wanted');

  // Only the object's own keys: a JSON object has nothing else.
  bool has(String key) => json.containsKey(key) && json[key] != null;
  Object? value(String key) => json[key];

  T _typed<T>(String key, String wanted) {
    final v = json[key];
    if (v is T) return v;
    throw fault(key, wanted);
  }

  String string(String key) => _typed<String>(key, 'a string');
  String? maybeString(String key) => has(key) ? string(key) : null;
  bool boolean(String key) => _typed<bool>(key, 'true or false');

  /// A mark the definition writes only as `true`: absent is false.
  bool flag(String key) => has(key) && boolean(key);
  num number(String key) => _typed<num>(key, 'a number');
  int integer(String key) {
    final v = number(key);
    if (v == v.truncate()) return v.toInt();
    throw fault(key, 'a whole number');
  }

  List<String> strings(String key) {
    final list = _typed<List<Object?>>(key, 'a list');
    return [for (final (i, v) in list.indexed) v is String ? v : throw fault('$key[$i]', 'a string')];
  }

  T object<T>(String key, T Function(_Reader) read) =>
      read(_Reader(_typed<Map<String, Object?>>(key, 'an object'), at(key)));
  T? maybe<T>(String key, T Function(_Reader) read) => has(key) ? object(key, read) : null;

  List<T> list<T>(String key, T Function(_Reader) read) {
    final list = _typed<List<Object?>>(key, 'a list');
    return [
      for (final (i, v) in list.indexed)
        v is Map<String, Object?> ? read(_Reader(v, '${at(key)}[$i]')) : throw fault('$key[$i]', 'an object'),
    ];
  }

  /// Pairs of codes; absent is none.
  List<(String, String)> pairs(String key) {
    if (!has(key)) return const [];
    return [
      for (final (i, v) in _typed<List<Object?>>(key, 'a list').indexed)
        if (v case [final String a, final String b]) (a, b) else throw fault('$key[$i]', 'a pair of codes'),
    ];
  }
}
