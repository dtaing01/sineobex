import { describe, expect, it } from 'vitest';
import { checkFile } from '../src/schema.ts';
import {
  listFile,
  locate,
  moduleFile,
  noteTypeFile,
  resolve,
  type Origin,
  type Resolution,
  type ResolvedNoteType,
} from '../src/resolve.ts';
import { definitionFiles, type LooseFiles } from './fixtures/load.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- the resolved definition is walked as plain JSON, and failing files are valid ones broken on purpose */

const CHECKS = 'note-types/checks_demo/v1.json';
const FULL = 'note-types/full_demo/v1.json';
const EXAM = 'modules/demo_exam/v1.json';

function resolved(
  files: LooseFiles = definitionFiles(),
  file = CHECKS,
): {
  definition: ResolvedNoteType;
  origins: Origin[];
} {
  const result = resolve(file, files);
  if (!result.ok) throw new Error(`did not resolve: ${JSON.stringify(result.problems)}`);
  return result;
}

type Expected = [file: string, path: string, rule: string];
const sorted = (list: Expected[]) => list.map((p) => p.join('  ')).sort();
function failures(result: Resolution): string[] {
  if (result.ok) return [];
  return sorted(result.problems.map((p): Expected => [p.file, p.path, p.rule]));
}

/** One change to the fixture tree, and every failure it should give. */
function broken(name: string, change: (files: LooseFiles) => void, ...problems: Expected[]) {
  it(name, () => {
    const files = definitionFiles();
    change(files);
    const result = resolve(CHECKS, files);
    expect(result.ok).toBe(false);
    expect(failures(result)).toEqual(sorted(problems));
    if (!result.ok) for (const p of result.problems) expect(p.message.length, p.rule).toBeGreaterThan(10);
  });
}

const sectionIds = (definition: ResolvedNoteType) => definition.sections.map((s) => s.id);
const section = (definition: ResolvedNoteType, id: string): any =>
  definition.sections.find((s) => s.id === id);
const field = (definition: ResolvedNoteType, sectionId: string, id: string): any =>
  section(definition, sectionId).fields.find((f: any) => f.id === id);

describe('the fixture tree', () => {
  // The resolver takes files that passed the schema. So must the files these tests start from.
  it('is made of files that fit the schema', () => {
    const files = definitionFiles();
    for (const [file, content] of Object.entries(files.noteTypes))
      expect(checkFile('noteType', content), file).toEqual([]);
    for (const [file, content] of Object.entries(files.modules))
      expect(checkFile('module', content), file).toEqual([]);
    for (const [file, content] of Object.entries(files.lists))
      expect(checkFile('list', content), file).toEqual([]);
  });

  it('names each file as the folder layout of design 2.1 does', () => {
    expect(noteTypeFile('checks_demo', 1)).toBe(CHECKS);
    expect(moduleFile('demo_exam', 1)).toBe(EXAM);
    expect(listFile('side')).toBe('lists/side.json');
  });
});

describe('a resolved definition', () => {
  it('has no include and no list reference left anywhere', () => {
    for (const file of [CHECKS, FULL]) {
      const { definition } = resolved(definitionFiles(), file);
      const left: string[] = [];
      const walk = (value: any, at: string) => {
        if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${at}[${i}]`));
        if (value === null || typeof value !== 'object') return;
        if ('include' in value || 'list' in value) left.push(at);
        for (const [key, child] of Object.entries(value)) walk(child, `${at}.${key}`);
      };
      walk(definition, '$');
      expect(left, file).toEqual([]);
    }
  });

  it('keeps the note type’s own keys, and every section and field it wrote itself', () => {
    const files = definitionFiles();
    const { definition } = resolved(files, FULL);
    const written = files.noteTypes[FULL];
    expect({ ...definition, sections: null }).toEqual({ ...written, sections: null });
    expect(definition.sections[0]).toEqual(written.sections[0]);
    expect(field(definition, 'wounds', 'type')).toEqual(written.sections[1].fields[1]);
  });

  it('has a module’s sections where the include stood, in the module’s order', () => {
    expect(sectionIds(resolved().definition)).toEqual(['visit', 'eyes', 'ears', 'findings', 'status']);
  });

  it('takes the version of the module the include names', () => {
    const files = definitionFiles();
    files.noteTypes[CHECKS].sections[1].version = 2;
    const { definition } = resolved(files);
    expect(sectionIds(definition)).toEqual(['visit', 'eyes', 'findings', 'status']);
    expect(section(definition, 'eyes').title).toBe('Eyes (second version)');
  });

  it('can hold one module twice only as far as the validator lets it: the resolver copies both', () => {
    const files = definitionFiles();
    files.noteTypes[CHECKS].sections.push({ include: 'demo_exam', version: 2 });
    expect(sectionIds(resolved(files).definition)).toEqual([
      'visit',
      'eyes',
      'ears',
      'findings',
      'status',
      'eyes',
    ]);
  });
});

describe('the condition on an include', () => {
  const include = { field: 'visit.concern', is: 'yes' };

  it('becomes the condition of a section that has none', () => {
    expect(section(resolved().definition, 'ears').showWhen).toEqual(include);
  });

  it('is joined with a section’s own condition, and both must hold', () => {
    expect(section(resolved().definition, 'eyes').showWhen).toEqual({
      all: [include, { field: 'visit.systems', is: 'eyes' }],
    });
  });

  it('when there is none, leaves each section’s condition as the module wrote it', () => {
    const files = definitionFiles();
    delete files.noteTypes[CHECKS].sections[1].showWhen;
    const { definition } = resolved(files);
    expect(section(definition, 'eyes').showWhen).toEqual({ field: 'visit.systems', is: 'eyes' });
    expect('showWhen' in section(definition, 'ears')).toBe(false);
  });

  it('does not reach the fields: a field keeps its own condition', () => {
    expect(field(resolved().definition, 'eyes', 'notes').showWhen).toEqual({
      field: 'eyes.pupils',
      is: ['zero', 'one'],
    });
  });
});

describe('a shared list', () => {
  const files = definitionFiles();
  const scale = files.lists['lists/demo_scale.json'].options;
  const yesNo = files.lists['lists/demo_yes_no.json'].options;
  const { definition } = resolved();

  it('is copied in as the options of a choice, in a note type and in a module', () => {
    expect(field(definition, 'visit', 'concern').options).toEqual(yesNo);
    expect(field(definition, 'eyes', 'pupils').options).toEqual(scale);
  });

  it('is copied in as the rows of a grid and as the options of its cell', () => {
    const pulses = field(definition, 'findings', 'pulses');
    expect(pulses.rows).toEqual(files.lists['lists/demo_sites.json'].options);
    expect(pulses.cell.options).toEqual(scale);
  });

  it('is copied in inside the group that is a grid’s cell', () => {
    expect(field(definition, 'status', 'each').cell.fields[0].options).toEqual(yesNo);
  });

  it('is copied in as the options of a region', () => {
    expect(field(definition, 'findings', 'where').options).toEqual(
      files.lists['lists/demo_regions.json'].options,
    );
  });

  // A region's `side` is the name of a list (2.3). The interpreter gets no lists, so the options
  // themselves stand in the resolved definition.
  it('is copied in as the sides of a region, from the list the region names', () => {
    expect(field(definition, 'findings', 'where').side).toEqual(files.lists['lists/side_rl.json'].options);
    const full = resolved(definitionFiles(), FULL).definition;
    expect(field(full, 'wounds', 'where').side).toEqual(files.lists['lists/side.json'].options);
    expect(field(full, 'wounds', 'where').surface).toEqual(files.lists['lists/surface.json'].options);
  });

  it('is copied in as the sides of a region from any list the region names, Skin’s Midline among them', () => {
    const files = definitionFiles();
    files.lists['lists/side_rlm.json'] = {
      name: 'side_rlm',
      options: [
        { code: 'right', label: 'Right' },
        { code: 'left', label: 'Left' },
        { code: 'midline', label: 'Midline' },
      ],
    };
    files.noteTypes[CHECKS].sections[2].fields[0].side = 'side_rlm';
    const { definition } = resolved(files);
    expect(field(definition, 'findings', 'where').side).toEqual(files.lists['lists/side_rlm.json'].options);
  });

  it('copies the list named surface into a region that asks for one, and nothing into one that does not', () => {
    expect(field(definition, 'findings', 'where').surface).toEqual([
      { code: 'anterior', label: 'Anterior' },
      { code: 'posterior', label: 'Posterior' },
    ]);
    const files = definitionFiles();
    delete files.noteTypes[CHECKS].sections[2].fields[0].surface;
    expect('surface' in field(resolved(files).definition, 'findings', 'where')).toBe(false);
  });

  it('leaves options written in place, and rows picked in another field, as they are', () => {
    expect(field(definition, 'findings', 'type').options).toEqual([
      { code: 'cut', label: 'Cut' },
      { code: 'burn', label: 'Burn' },
    ]);
    expect(field(definition, 'status', 'each').rows).toEqual({ pickedIn: 'visit.systems' });
  });

  it('is copied once for each field that uses it: the copies share nothing', () => {
    const first = field(definition, 'visit', 'concern').options;
    const second = field(definition, 'status', 'each').cell.fields[0].options;
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });
});

describe('resolving', () => {
  it('changes nothing in the files it is handed, and shares nothing with them', () => {
    const files = definitionFiles();
    const before = JSON.stringify(files);
    const { definition } = resolved(files);
    for (const s of definition.sections as any[]) {
      s.title = 'changed';
      for (const f of s.fields) {
        f.label = 'changed';
        if (Array.isArray(f.options)) f.options[0].label = 'changed';
        if (f.showWhen) f.showWhen.field = 'changed';
      }
    }
    expect(JSON.stringify(files)).toBe(before);
  });

  it('gives the same definition every time', () => {
    expect(JSON.stringify(resolved().definition)).toBe(JSON.stringify(resolved().definition));
  });

  it('needs only the files the note type uses', () => {
    const files = definitionFiles();
    const used = ['demo_scale', 'demo_sites', 'demo_regions', 'demo_yes_no', 'side_rl', 'surface'].map(
      listFile,
    );
    for (const file of Object.keys(files.lists)) if (!used.includes(file)) delete files.lists[file];
    delete files.modules['modules/demo_exam/v2.json'];
    delete files.noteTypes[FULL];
    expect(resolved(files).definition).toEqual(resolved().definition);
    // And it does need each of those.
    for (const file of used) {
      const fewer = structuredClone(files);
      delete fewer.lists[file];
      expect(resolve(CHECKS, fewer).ok, file).toBe(false);
    }
  });
});

describe('what cannot be resolved names the file and the rule', () => {
  const VISIT = '$.sections[0]';
  const FINDINGS = '$.sections[2]';
  const STATUS = '$.sections[3]';

  it('a note type file that was not handed over', () => {
    const result = resolve('note-types/missing_demo/v1.json', definitionFiles());
    expect(failures(result)).toEqual(
      sorted([['note-types/missing_demo/v1.json', '$', 'resolve.missing_file']]),
    );
  });

  broken(
    'an include of a module that does not exist',
    (f) => (f.noteTypes[CHECKS].sections[1].include = 'demo_missing'),
    [CHECKS, '$.sections[1].include', 'resolve.unknown_module'],
  );
  broken(
    'an include of a version the module does not have',
    (f) => (f.noteTypes[CHECKS].sections[1].version = 3),
    [CHECKS, '$.sections[1].version', 'resolve.unknown_module'],
  );

  broken(
    'a list that does not exist, as the options of a choice',
    (f) => (f.noteTypes[CHECKS].sections[0].fields[1].options = { list: 'demo_missing' }),
    [CHECKS, `${VISIT}.fields[1].options.list`, 'resolve.unknown_list'],
  );
  broken(
    'a list that does not exist, in a module: the module’s file is named',
    (f) => (f.modules[EXAM].sections[0].fields[0].options = { list: 'demo_missing' }),
    [EXAM, '$.sections[0].fields[0].options.list', 'resolve.unknown_list'],
  );
  broken(
    'a list that does not exist, as the rows of a grid',
    (f) => (f.noteTypes[CHECKS].sections[2].fields[4].rows = { list: 'demo_missing' }),
    [CHECKS, `${FINDINGS}.fields[4].rows.list`, 'resolve.unknown_list'],
  );
  broken(
    'a list that does not exist, in the cell of a grid',
    (f) => (f.noteTypes[CHECKS].sections[2].fields[4].cell.options = { list: 'demo_missing' }),
    [CHECKS, `${FINDINGS}.fields[4].cell.options.list`, 'resolve.unknown_list'],
  );
  broken(
    'a list that does not exist, in a group inside the cell of a grid',
    (f) => (f.noteTypes[CHECKS].sections[3].fields[0].cell.fields[0].options = { list: 'demo_missing' }),
    [CHECKS, `${STATUS}.fields[0].cell.fields[0].options.list`, 'resolve.unknown_list'],
  );
  broken(
    'a list that does not exist, as the options of a region',
    (f) => (f.noteTypes[CHECKS].sections[2].fields[0].options = { list: 'demo_missing' }),
    [CHECKS, `${FINDINGS}.fields[0].options.list`, 'resolve.unknown_list'],
  );
  broken('a region whose side list does not exist', (f) => delete f.lists['lists/side_rl.json'], [
    CHECKS,
    `${FINDINGS}.fields[0].side`,
    'resolve.unknown_list',
  ]);
  broken(
    'a region that asks for a surface when the surface list does not exist',
    (f) => delete f.lists['lists/surface.json'],
    [CHECKS, `${FINDINGS}.fields[0].surface`, 'resolve.unknown_list'],
  );

  broken('a module file whose name is not its folder’s', (f) => (f.modules[EXAM].name = 'demo_other'), [
    EXAM,
    '$.name',
    'resolve.misplaced_file',
  ]);
  broken('a module file whose version is not its file’s', (f) => (f.modules[EXAM].version = 2), [
    EXAM,
    '$.version',
    'resolve.misplaced_file',
  ]);
  broken(
    'a list file whose name is not its file’s',
    (f) => (f.lists['lists/demo_scale.json'].name = 'demo_other'),
    ['lists/demo_scale.json', '$.name', 'resolve.misplaced_file'],
  );
  broken('a note type file whose key is not its folder’s', (f) => (f.noteTypes[CHECKS].key = 'other_demo'), [
    CHECKS,
    '$.key',
    'resolve.misplaced_file',
  ]);
  broken('a note type file whose version is not its file’s', (f) => (f.noteTypes[CHECKS].version = 2), [
    CHECKS,
    '$.version',
    'resolve.misplaced_file',
  ]);

  // A list used by five fields that is misplaced is one fault, not five.
  broken(
    'every failure at once, each one time',
    (f) => {
      f.noteTypes[CHECKS].sections[1].include = 'demo_missing';
      f.noteTypes[CHECKS].sections[0].fields[1].options = { list: 'demo_missing' };
      f.lists['lists/demo_scale.json'].name = 'demo_other';
    },
    [CHECKS, '$.sections[1].include', 'resolve.unknown_module'],
    [CHECKS, `${VISIT}.fields[1].options.list`, 'resolve.unknown_list'],
    ['lists/demo_scale.json', '$.name', 'resolve.misplaced_file'],
  );
});

describe('where a place in the resolved definition was written', () => {
  const { definition, origins } = resolved();
  const index = (id: string) => sectionIds(definition).indexOf(id);

  it('the note type’s own keys and sections: its file, with the section’s place in that file', () => {
    expect(locate(origins, '$.title')).toEqual({ file: CHECKS, path: '$.title' });
    expect(locate(origins, '$.sections[0].fields[2].showWhen')).toEqual({
      file: CHECKS,
      path: '$.sections[0].fields[2].showWhen',
    });
    // After the include, a section's number in the resolved definition is not its number in the file.
    expect(index('findings')).toBe(3);
    expect(locate(origins, '$.sections[3].fields[3].showWhen')).toEqual({
      file: CHECKS,
      path: '$.sections[2].fields[3].showWhen',
    });
    expect(locate(origins, '$.sections[4]')).toEqual({ file: CHECKS, path: '$.sections[3]' });
  });

  it('a module’s section: the module’s file', () => {
    expect(locate(origins, `$.sections[${index('ears')}].fields[0].options[1]`)).toEqual({
      file: EXAM,
      path: '$.sections[1].fields[0].options[1]',
    });
    expect(locate(origins, '$.sections[1].title')).toEqual({ file: EXAM, path: '$.sections[0].title' });
  });

  it('options copied from a list: the list’s file', () => {
    expect(locate(origins, '$.sections[0].fields[1].options[1].code')).toEqual({
      file: 'lists/demo_yes_no.json',
      path: '$.options[1].code',
    });
    expect(locate(origins, '$.sections[1].fields[0].options')).toEqual({
      file: 'lists/demo_scale.json',
      path: '$.options',
    });
    expect(locate(origins, '$.sections[3].fields[4].rows[0]')).toEqual({
      file: 'lists/demo_sites.json',
      path: '$.options[0]',
    });
    expect(locate(origins, '$.sections[3].fields[4].cell.options[2]')).toEqual({
      file: 'lists/demo_scale.json',
      path: '$.options[2]',
    });
    expect(locate(origins, '$.sections[3].fields[0].side[0]')).toEqual({
      file: 'lists/side_rl.json',
      path: '$.options[0]',
    });
    // The field that names the list is still in its own file.
    expect(locate(origins, '$.sections[0].fields[1]')).toEqual({
      file: CHECKS,
      path: '$.sections[0].fields[1]',
    });
    expect(locate(origins, '$.sections[0].fields[1].optional')).toEqual({
      file: CHECKS,
      path: '$.sections[0].fields[1].optional',
    });
  });

  it('a condition that came from an include: the note type’s file, at the include', () => {
    // On a section with no condition of its own, the whole condition is the include's.
    expect(locate(origins, `$.sections[${index('ears')}].showWhen.field`)).toEqual({
      file: CHECKS,
      path: '$.sections[1].showWhen.field',
    });
    // Joined with the section's own: the first half is the include's, the second the module's.
    expect(locate(origins, '$.sections[1].showWhen.all[0].is')).toEqual({
      file: CHECKS,
      path: '$.sections[1].showWhen.is',
    });
    expect(locate(origins, '$.sections[1].showWhen.all[1].field')).toEqual({
      file: EXAM,
      path: '$.sections[0].showWhen.field',
    });
  });

  it('takes whole steps: section 10 is not inside section 1, nor `sides` inside `side`', () => {
    const some: Origin[] = [
      { at: '$', file: CHECKS, path: '$' },
      { at: '$.sections[1]', file: EXAM, path: '$.sections[0]' },
      { at: '$.sections[2].fields[0].side', file: 'lists/side.json', path: '$.options' },
    ];
    expect(locate(some, '$.sections[10].title')).toEqual({ file: CHECKS, path: '$.sections[10].title' });
    expect(locate(some, '$.sections[2].fields[0].sides')).toEqual({
      file: CHECKS,
      path: '$.sections[2].fields[0].sides',
    });
    expect(locate(some, '$.sections[2].fields[0].side[1]')).toEqual({
      file: 'lists/side.json',
      path: '$.options[1]',
    });
  });

  it('with no origins, a place is in the file named', () => {
    expect(locate([{ at: '$', file: FULL, path: '$' }], '$.sections[1]')).toEqual({
      file: FULL,
      path: '$.sections[1]',
    });
  });
});
