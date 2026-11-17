/**
 * The form definition format (docs/design/phase-4/forms.md, section 2): the three kinds of file
 * under definitions/, as written by hand. schema/definition.schema.json says the same thing as a
 * JSON Schema. Neither is generated from the other; test/schema.test.ts reads both and fails when
 * one has a key, a kind or a value the other lacks.
 *
 * Answers are a flat map from a path to a value. A path has one to four parts: the section's id,
 * the entry's id in a repeating section, then the field's id and what its kind adds (2.3).
 */

/** A note type key, a module's name and a shared list's name. The API's NoteTypeKey (sync/records.ts). */
export const KEY = /^[a-z][a-z0-9_]{1,60}$/;
/** One part of an answer path: a section's id or a field's id. One part of the API's DATA_PATH. */
export const PATH_PART = /^[a-z][a-zA-Z0-9_]{0,60}$/;
/** An option's code. Narrower than a path part, so a code can be one (a grid's row, a region). */
export const OPTION_CODE = /^[a-z][a-z0-9_]{0,40}$/;

/** The limits of 2.4. The schema holds the first two; the third needs the resolved definition. */
export const MAX_TEXT_LENGTH = 4000;
export const MAX_REPEAT = 20;
/**
 * The longest duration, in days, and the most a duration's `max` may be: a hundred years. Without
 * one a duration could be a number the phone cannot hold exactly, taken here and refused there.
 */
export const MAX_DURATION_DAYS = 36_525;
export const MAX_DEFINITION_BYTES = 256 * 1024;

/** definitions/note-types/<key>/v<N>.json: one note type, one version. Never edited once released. */
export type NoteType = {
  key: string;
  version: number;
  title: string;
  /** Which encounters offer it. Offered for Medical only: a Medical note type. */
  kinds: ('medical' | 'non_medical')[];
  /** Its timeline filter. The visit read and the chart need one for every note (lifecycle 5.2). */
  group: 'clinical' | 'psych' | 'social' | 'outreach' | 'harm_reduction' | 'wound';
  /** 'sensitive': needs patients.view_sensitive to read. */
  sensitivity: 'none' | 'sensitive';
  /** The Quick encounter. */
  quick?: true;
  /** Added by itself with the first Medical note of an encounter (6.2). */
  auto?: 'medical';
  sections: (Section | Include)[];
  /** The labels this version rewords on purpose (2.6). Not part of the resolved definition. */
  renames?: Rename[];
};

/**
 * A label reworded on purpose, declared in the version that rewords it (2.6). `path` is an answer
 * path of this version, the entry's part of a repeating section left out; `code` is an option code
 * there, or left out when the entry declares a change of the field's own label. For a row of a grid
 * `path` is the grid's own path; for a field or an option in a cell, the path of each row. A field's
 * own label is named at its own path: without a side, and without a region's or a problem's part.
 */
export type Rename = { path: string; code?: string; from: string; to: string };

/**
 * definitions/modules/<name>/v<N>.json: a block of sections a note type includes. The design names
 * the file and the include that points at it but not the file's own keys; the recipe gives `name`
 * and `version`. A module holds sections only: nothing in the specification needs a module inside
 * a module, and the resolver stays one pass.
 */
export type Module = {
  name: string;
  version: number;
  sections: Section[];
};

/**
 * definitions/lists/<name>.json: an option list used in more than one place ("one master list per
 * field"). It has no version: once released, the lock holds its content (4.2).
 */
export type OptionList = {
  name: string;
  options: Option[];
};

/** A module's sections, in place. `showWhen` is added to each of them. */
export type Include = { include: string; version: number; showWhen?: Condition };

export type Section = {
  /** The first part of every path in it. */
  id: string;
  title: string;
  showWhen?: Condition;
  /** Needs patients.view_sensitive_exams to read. */
  sensitiveExam?: true;
  /** Substance use treatment: needs a clinical credential to read. */
  treatmentRecord?: true;
  /** Shown to, and changed by, a credential with this capability only. */
  needs?: 'orderMedications';
  /** Offers one-tap Normal. */
  normal?: true;
  /** Entries are added one at a time. `itemTitle` is "Wound {n}". */
  repeat?: { max: number; itemTitle: string };
  fields: Field[];
  /** The piece under definitions/spec/ it was transcribed from. */
  spec?: string;
};

/** What a field of any kind may carry. */
export type Common = {
  /** One path part. */
  id: string;
  /** May be a full question. */
  label: string;
  help?: string;
  showWhen?: Condition;
  /** Stops Complete while it is visible and empty. */
  required?: true;
  /** Recorded once for right and once for left: a last path part, `right` or `left`. */
  sides?: true;
  /** One-tap Normal never fills it (chaperone, consent). */
  noNormal?: true;
  /** Left out of the recap. */
  recap?: false;
  /** Goes into the EMS handoff summary. */
  handoff?: true;
  /** "<note type key>:<path>": the full module's field, without any entry part (6.4). */
  mapsTo?: string;
};

/** A shared list, by name, in place of an option array. The resolver copies the list in. */
export type ListRef = { list: string };

export type ChoiceField = Common & {
  kind: 'choice';
  many: boolean;
  options: Option[] | ListRef;
  /** Pairs of codes that can't be held together. */
  excludes?: [string, string][];
};

export type TextField = Common & { kind: 'text'; lines: 'one' | 'many'; maxLength: number };

export type NumberField = Common & {
  kind: 'number';
  min: number;
  max: number;
  decimals: 0 | 1 | 2;
  unit?: string;
  /** A second unit to type in: inches, 2.54 cm each. The answer is stored in `unit`. */
  altUnit?: { unit: string; perUnit: number };
  display?: 'box' | 'stepper' | 'outOf';
  /** What one-tap Normal fills: inside min and max, at the field's decimals (strength 5 of 5). */
  normal?: number;
};

/** A tick. While it is set, the sibling fields in `clears` do not count and are disabled. */
export type FlagField = Common & { kind: 'flag'; clears?: string[] };

export type DateField = Common & { kind: 'date'; range: 'past' | 'future' | 'any' };

export type TimeField = Common & { kind: 'time' };

/**
 * Weeks and days, stored as days. `max`: the most it takes, in whole days, 1 to 36,525; without one
 * a hundred years (MAX_DURATION_DAYS).
 */
export type DurationField = Common & { kind: 'duration'; max?: number };

/** Stores nothing itself: its children add a path part. `collapsed`: closed until tapped. */
export type GroupField = Common & {
  kind: 'group';
  layout: 'stack' | 'row';
  collapsed?: true;
  fields: Field[];
};

/**
 * One cell per row. `pickedIn`: the rows are the options picked in the choose-many field at that
 * path. `collapsed`: closed until tapped, as a group can be; it changes no path.
 */
export type GridField = Common & {
  kind: 'grid';
  collapsed?: true;
  rows: Option[] | ListRef | { pickedIn: string };
  cell: Field;
};

/**
 * A body region. `side` names the shared list its side comes from (`side` has Bilateral, `side_rl`
 * does not, Skin's has Midline). `surface` asks for Anterior or Posterior: the shared list named
 * `surface`.
 */
export type RegionField = Common & {
  kind: 'region';
  options: Option[] | ListRef;
  side?: string;
  surface?: true;
};

/** One diagnosis from the problem code list: its code and label. */
export type ProblemField = Common & { kind: 'problem' };

/** Phase 8; shown as a placeholder until then. */
export type PhotoField = Common & { kind: 'photo'; max: number };

/**
 * A button. The design writes `noteType` as optional on every action; only `open_note_type` can
 * use it and it cannot work without it, so the two are tied here and in the schema.
 */
export type ActionField = Common &
  (
    | { kind: 'action'; action: 'show_handoff' | 'add_referral' }
    | { kind: 'action'; action: 'open_note_type'; noteType: string }
  );

/** The label is guidance; nothing is stored. */
export type InfoField = Common & { kind: 'info' };

export type Field =
  | ChoiceField
  | TextField
  | NumberField
  | FlagField
  | DateField
  | TimeField
  | DurationField
  | GroupField
  | GridField
  | RegionField
  | ProblemField
  | PhotoField
  | ActionField
  | InfoField;

/** The fourteen kinds. A new kind is the only change to a form that needs code. */
export type FieldKind = Field['kind'];

export type Option = {
  /** Stable; never reused for a new meaning. */
  code: string;
  /** Exactly as the field specification writes it. */
  label: string;
  /** Picking it clears the others (None, Normal, No). */
  exclusive?: true;
  /** Needs a short text, stored beside the answer. */
  other?: true;
  /** Set by one-tap Normal. */
  normal?: true;
  /** "Unable to assess": neither normal nor abnormal. */
  unable?: true;
  /** A design-system icon name. */
  icon?: string;
  /** A note type key to suggest on the summary screen. */
  suggests?: string;
  /** In the exam picker: a system whose name is itself sensitive (6.6). */
  sensitiveExam?: true;
};

/**
 * `field` is a path inside the same note type. Inside a repeating section it may be written
 * relative to the entry, starting with `./`; inside the cell of a grid, `./` means the row.
 */
export type Condition =
  | { field: string; is: string | string[] }
  | { field: string; filled: true }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

/** What every check of a definition reports: where in the file, which rule, and what is wrong. */
export type Problem = { path: string; rule: string; message: string };
