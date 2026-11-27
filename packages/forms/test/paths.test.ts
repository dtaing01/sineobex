import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolve, type ResolvedNoteType } from '../src/resolve.ts';
import { pathModel } from '../src/paths.ts';
import { pathsOf } from '../src/paths.ts';
import { definitionFiles } from './fixtures/load.ts';

// The validator and the version rules read the paths a definition stores at (design 2.3) from one
// model, src/paths.ts: one refuses what the server would not take, the other compares what a path
// means from version to version. The list the version rules read is the model's, path for path.

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a fixture is read as plain JSON */
type Loose = any;
const fixture = (name: string): Loose =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

/** Every note type among the fixtures, resolved. */
function fixtures(): Record<string, ResolvedNoteType> {
  const found: Record<string, ResolvedNoteType> = {};
  const add = (name: string, file: string, files: Loose) => {
    const result = resolve(file, files);
    if (!result.ok) throw new Error(`${name} did not resolve: ${JSON.stringify(result.problems)}`);
    found[name] = result.definition;
  };
  for (const tree of ['definitions', 'example']) {
    const files = definitionFiles(tree);
    for (const file of Object.keys(files.noteTypes)) add(`${tree}/${file}`, file, files);
  }
  // The two files of the schema's tests, with the lists of the fixture tree. The second names
  // modules that are in no tree: its own sections are what is read here.
  const { lists } = definitionFiles();
  const one = (name: string, change: (file: Loose) => void = () => {}) => {
    const file = fixture(name);
    change(file);
    const at = `note-types/${file.key}/v${file.version}.json`;
    add(name, at, { noteTypes: { [at]: file }, modules: {}, lists });
  };
  one('design-example');
  one('every-kind', (file) => (file.sections = file.sections.filter((s: Loose) => !('include' in s))));
  return found;
}

const HOLDS: Record<string, string> = {
  'one code': 'codes, one',
  'a list of codes': 'codes, many',
  text: 'text',
  'a number': 'number',
  'a tick': 'flag',
  'a date': 'date',
  'a time': 'time',
  'a duration': 'duration',
  'a problem code': 'problemCode',
  'a problem label': 'problemLabel',
};

describe('the two lists of a definition’s paths', () => {
  const all = fixtures();

  it('are read from five note types', () => {
    expect(Object.keys(all).sort()).toEqual([
      'definitions/note-types/checks_demo/v1.json',
      'definitions/note-types/full_demo/v1.json',
      'design-example',
      'every-kind',
      'example/note-types/harm_reduction_example/v1.json',
    ]);
  });

  for (const [name, definition] of Object.entries(all))
    it(`agree path for path: ${name}`, () => {
      const line = (p: { path: string; holds: string }) => `${p.path}: ${p.holds}`;
      const forVersions = pathsOf(definition)
        // The version rules also hold a grid's rows, at the grid's own path, where no answer is.
        .filter((p) => p.holds !== 'the rows of a grid')
        .map((p) => line({ path: p.path, holds: HOLDS[p.holds]! }));
      const forValidator = [...pathModel(definition).leaves.values()].map((leaf) =>
        line({
          path: leaf.key,
          holds:
            leaf.holds.type === 'codes' ? (leaf.holds.many ? 'codes, many' : 'codes, one') : leaf.holds.type,
        }),
      );
      expect(forValidator.length).toBeGreaterThan(1);
      expect(forVersions.sort()).toEqual(forValidator.sort());
    });
});
