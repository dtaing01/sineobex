import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CI runs the packages' tests by an explicit filter list, in the local script and in the workflow,
// so a package left off both lists is never tested and nothing says so (phase 5 design 2.1). Every
// package under packages/ that has tests is on both.

const repo = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, repo), 'utf8');

/** The packages named by the command on the line after the one that holds `marker`, or on it. */
function filtered(text, marker, offset) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.includes(marker));
  expect(at, marker).toBeGreaterThanOrEqual(0);
  return [...lines[at + offset].matchAll(/--filter (\S+)/g)].map((m) => m[1]);
}

const tested = readdirSync(new URL('packages/', repo))
  .filter((dir) => existsSync(new URL(`packages/${dir}/package.json`, repo)))
  .map((dir) => JSON.parse(read(`packages/${dir}/package.json`)))
  .filter((pkg) => pkg.scripts?.test)
  .map((pkg) => pkg.name);

describe('the unit test step', () => {
  it('knows the packages it is held to', () => {
    expect(tested).toEqual(
      expect.arrayContaining(['@sineobex/contract', '@sineobex/forms', '@sineobex/presets']),
    );
  });

  it('runs every package under packages/ that has tests, locally', () => {
    expect(filtered(read('tools/ci-local.sh'), 'step "Unit tests"', 0)).toEqual(
      expect.arrayContaining(tested),
    );
  });

  it('runs every package under packages/ that has tests, in the workflow', () => {
    expect(filtered(read('.github/workflows/ci.yml'), 'name: Unit tests', 1)).toEqual(
      expect.arrayContaining(tested),
    );
  });
});
