import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handoffLines } from '../../src/interp/handoff.ts';
import type { ResolvedNoteType } from '../../src/resolve.ts';

// What the vectors cannot say: a case gives one list of notes, each with its definition, so it can
// never pass the two lists of different lengths.

const vectors = JSON.parse(
  readFileSync(new URL('../../../contract/test-vectors/forms-conformance.json', import.meta.url), 'utf8'),
) as { definitions: Record<string, ResolvedNoteType> };
const ems = vectors.definitions.ems!;

describe('handoffLines', () => {
  it('refuses a definition without its note, rather than pairing the wrong ones', () => {
    expect(() => handoffLines([ems, ems], [{ 'ems.called': '14:05' }], [])).toThrow(
      /2 definitions for 1 notes/,
    );
  });
});
