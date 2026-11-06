import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Loading a patient page logs a view, so a prefetch would log one nobody made: every Link to a
// patient page turns prefetching off.
const APP = join(__dirname, '..', 'app');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('links to patient pages', () => {
  it('never prefetch', () => {
    const offenders: string[] = [];
    for (const file of sources(APP)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/<Link\b[^>]*?href=\{`\/patients\/[^>]*>/gs)) {
        if (!match[0].includes('prefetch={false}')) offenders.push(`${file}: ${match[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
