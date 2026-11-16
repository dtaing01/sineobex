/**
 * The resolver (docs/design/phase-4/forms.md, 2.1): one note type version file, the modules it
 * includes and the shared lists it names, made into one resolved definition. A resolved definition
 * has no include and no list reference. It is the only shape the validator, the export, the API,
 * the database and the phone ever read.
 *
 * Pure: parsed files in, a definition out. No disk and no network, so the export and the API can
 * both call it. The files must have passed the schema check ('@sineobex/forms/schema'), which this
 * file cannot load (src/index.ts reaches it, and the schema library cannot run in the API's bundle).
 */
import type {
  ChoiceField,
  Condition,
  Field,
  GridField,
  GroupField,
  ListRef,
  Module,
  NoteType,
  Option,
  OptionList,
  Problem,
  RegionField,
  Section,
} from './types.ts';

/** A problem in one of several files: `file` is its path under definitions/. */
export type FileProblem = Problem & { file: string };

/** Where each kind of file lives under definitions/ (2.1). An include and a list reference are looked up by these. */
export const noteTypeFile = (key: string, version: number): string => `note-types/${key}/v${version}.json`;
export const moduleFile = (name: string, version: number): string => `modules/${name}/v${version}.json`;
export const listFile = (name: string): string => `lists/${name}.json`;
/** The shared list a region's `surface` copies in: Anterior and Posterior. */
export const SURFACE_LIST = 'surface';

/** The parsed files of definitions/, each by its path under that folder. */
export type DefinitionFiles = {
  readonly noteTypes: Readonly<Record<string, NoteType>>;
  readonly modules: Readonly<Record<string, Module>>;
  readonly lists: Readonly<Record<string, OptionList>>;
};

export type ResolvedChoiceField = Omit<ChoiceField, 'options'> & { options: Option[] };
/**
 * `side` is no longer the name of a list but that list's options, and `surface` the options of the
 * list named `surface`: the interpreter is handed a definition and no lists, and has to know which
 * sides and surfaces it may store.
 */
export type ResolvedRegionField = Omit<RegionField, 'options' | 'side' | 'surface'> & {
  options: Option[];
  side?: Option[];
  surface?: Option[];
};
export type ResolvedGroupField = Omit<GroupField, 'fields'> & { fields: ResolvedField[] };
export type ResolvedGridField = Omit<GridField, 'rows' | 'cell'> & {
  rows: Option[] | { pickedIn: string };
  cell: ResolvedField;
};
export type ResolvedField =
  | ResolvedChoiceField
  | ResolvedRegionField
  | ResolvedGroupField
  | ResolvedGridField
  | Exclude<Field, ChoiceField | RegionField | GroupField | GridField>;
export type ResolvedSection = Omit<Section, 'fields'> & { fields: ResolvedField[] };
export type ResolvedNoteType = Omit<NoteType, 'sections'> & { sections: ResolvedSection[] };

/**
 * Where a part of the resolved definition was written: `at` is a place in the resolved definition,
 * `file` and `path` the place it was copied from. A problem found in the resolved definition is
 * reported where a person can mend it (`locate`).
 */
export type Origin = { at: string; file: string; path: string };

export type Resolution =
  { ok: true; definition: ResolvedNoteType; origins: Origin[] } | { ok: false; problems: FileProblem[] };

/**
 * Resolves the note type at `file` (its path under definitions/). Every failure names the file and
 * the rule: `resolve.missing_file`, `resolve.misplaced_file` (a file whose content names another
 * key, name or version than its path), `resolve.unknown_module` and `resolve.unknown_list`. All of
 * them are reported, each once; with one or more there is no definition.
 */
export function resolve(file: string, files: DefinitionFiles): Resolution {
  const noteType = files.noteTypes[file];
  if (!noteType)
    return {
      ok: false,
      problems: [
        { file, path: '$', rule: 'resolve.missing_file', message: 'is not among the files handed over' },
      ],
    };
  const run = new Run(file, files);
  const definition = run.noteType(noteType);
  if (run.problems.length > 0) return { ok: false, problems: run.problems };
  // Built with spreads, so the parts the resolver did not touch are still the caller's objects, and
  // a list used twice is one array. The copy makes every part the definition's own: a later change
  // to a file, or to one field's options, cannot reach anything else.
  return { ok: true, definition: copy(definition), origins: run.origins };
}

// Not structuredClone: it keeps one copy of an object that is reached twice, so two fields would
// still share the options of a list.
function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)])) as T;
}

/** The file and the place in it where the resolved definition's `at` was written. */
export function locate(origins: readonly Origin[], at: string): { file: string; path: string } {
  let best: Origin | undefined;
  for (const origin of origins) {
    if (!isUnder(at, origin.at)) continue;
    if (!best || origin.at.length > best.at.length) best = origin;
  }
  if (!best) throw new Error(`no origin covers ${at}: the origins of a resolution always hold "$"`);
  return { file: best.file, path: best.path + at.slice(best.at.length) };
}

// `$.sections[1]` is under `$.sections[1]` and `$`, and not under `$.sections[10]`'s shorter look-alike.
function isUnder(at: string, start: string): boolean {
  if (!at.startsWith(start)) return false;
  const next = at[start.length];
  return next === undefined || next === '.' || next === '[';
}

/** Where a section's parts are, in the resolved definition and in the file that wrote it. */
type Place = { at: string; file: string; path: string };

const step = (place: Place, key: string): Place => ({
  at: `${place.at}${key}`,
  file: place.file,
  path: `${place.path}${key}`,
});

class Run {
  readonly problems: FileProblem[] = [];
  readonly origins: Origin[] = [];
  /** A file used by many fields is checked against its path once. */
  private readonly placed = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly files: DefinitionFiles,
  ) {}

  noteType(noteType: NoteType): ResolvedNoteType {
    const { file } = this;
    this.origins.push({ at: '$', file, path: '$' });
    this.placedAs(file, noteTypeFile(noteType.key, noteType.version), 'key', 'version');

    const sections: ResolvedSection[] = [];
    noteType.sections.forEach((entry, index) => {
      const path = `$.sections[${index}]`;
      if (!('include' in entry)) {
        sections.push(this.section(entry, { at: `$.sections[${sections.length}]`, file, path }));
        return;
      }
      const from = moduleFile(entry.include, entry.version);
      const module = this.files.modules[from];
      if (!module) {
        // The name is wrong when no version of it exists; otherwise the version is.
        const known = Object.keys(this.files.modules).some((f) => f.startsWith(`modules/${entry.include}/`));
        this.problems.push({
          file,
          path: `${path}.${known ? 'version' : 'include'}`,
          rule: 'resolve.unknown_module',
          message: `includes ${from}, which is not among the files`,
        });
        return;
      }
      this.placedAs(from, moduleFile(module.name, module.version), 'name', 'version');
      module.sections.forEach((written, k) => {
        const place: Place = { at: `$.sections[${sections.length}]`, file: from, path: `$.sections[${k}]` };
        const section = this.section(written, place);
        if (entry.showWhen) section.showWhen = this.joined(entry.showWhen, written.showWhen, place, path);
        sections.push(section);
      });
    });
    return { ...noteType, sections };
  }

  /**
   * The condition on an include is added to each section of the module (types.ts, Include). A
   * section with its own condition shows when both hold.
   */
  private joined(
    include: Condition,
    own: Condition | undefined,
    section: Place,
    includePath: string,
  ): Condition {
    const at = `${section.at}.showWhen`;
    const fromInclude = { file: this.file, path: `${includePath}.showWhen` };
    if (!own) {
      this.origins.push({ at, ...fromInclude });
      return include;
    }
    this.origins.push({ at: `${at}.all[0]`, ...fromInclude });
    this.origins.push({ at: `${at}.all[1]`, file: section.file, path: `${section.path}.showWhen` });
    return { all: [include, own] };
  }

  private section(section: Section, place: Place): ResolvedSection {
    this.origins.push(place);
    return {
      ...section,
      fields: section.fields.map((field, i) => this.field(field, step(place, `.fields[${i}]`))),
    };
  }

  private field(field: Field, place: Place): ResolvedField {
    switch (field.kind) {
      case 'choice':
        return { ...field, options: this.options(field.options, step(place, '.options')) };
      case 'region': {
        const { side, surface, ...rest } = field;
        return {
          ...rest,
          options: this.options(field.options, step(place, '.options')),
          ...(side === undefined ? {} : { side: this.list(side, step(place, '.side'), '') }),
          ...(surface ? { surface: this.list(SURFACE_LIST, step(place, '.surface'), '') } : {}),
        };
      }
      case 'group':
        return {
          ...field,
          fields: field.fields.map((child, i) => this.field(child, step(place, `.fields[${i}]`))),
        };
      case 'grid':
        return {
          ...field,
          rows: 'pickedIn' in field.rows ? field.rows : this.options(field.rows, step(place, '.rows')),
          cell: this.field(field.cell, step(place, '.cell')),
        };
      default:
        return field;
    }
  }

  private options(options: Option[] | ListRef, place: Place): Option[] {
    return Array.isArray(options) ? options : this.list(options.list, place, '.list');
  }

  /** A shared list's options, for the field part at `place`; `key` is where in that part the list is named. */
  private list(name: string, place: Place, key: string): Option[] {
    const from = listFile(name);
    const list = this.files.lists[from];
    if (!list) {
      this.problems.push({
        file: place.file,
        path: `${place.path}${key}`,
        rule: 'resolve.unknown_list',
        message: `names the list "${name}", and ${from} is not among the files`,
      });
      return [];
    }
    this.placedAs(from, listFile(list.name), 'name');
    this.origins.push({ at: place.at, file: from, path: '$.options' });
    return list.options;
  }

  /**
   * A file is found by its path, so its path has to be the one its content gives (`says`).
   * Otherwise a module could be included under one name while saying it is another.
   */
  private placedAs(file: string, says: string, nameKey: string, versionKey?: string) {
    if (this.placed.has(file)) return;
    this.placed.add(file);
    if (says === file) return;
    // `<folder>/<name>/v<N>.json`, or `lists/<name>.json`: the name is the second part of both.
    const name = (path: string) => path.split('/')[1]?.replace(/\.json$/, '');
    this.problems.push({
      file,
      path: `$.${versionKey && name(file) === name(says) ? versionKey : nameKey}`,
      rule: 'resolve.misplaced_file',
      message: `says it is ${says}; a file is looked up by the path its content gives`,
    });
  }
}
