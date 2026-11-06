// Writes packages/contract/test-vectors/canonical-json.json from the TypeScript implementation.
// The Dart tests read the same file, so both sides must agree on every vector.
import { writeFile } from 'node:fs/promises';
import { vectorsFile } from '../src/sync/canonical-vectors.ts';

await writeFile(
  new URL('../../../packages/contract/test-vectors/canonical-json.json', import.meta.url),
  await vectorsFile(),
);
console.log('canonical vectors written');
