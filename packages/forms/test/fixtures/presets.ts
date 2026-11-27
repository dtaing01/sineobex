import { canonicalJson, sha256Hex } from '../../src/canonical.ts';
import type { Preset } from '../../src/install.ts';
import { resolve } from '../../src/resolve.ts';
import type { DefinitionFiles } from '../../src/resolve.ts';
import { definitionFiles } from './load.ts';

/**
 * The fixture note types of fixtures/definitions as the export would write them to
 * generated/presets.json: resolved, hashed, in key and version order. The installer's tests use
 * these, since the real presets.json holds nothing until the definitions are typed.
 */
export async function fixturePresets(): Promise<Preset[]> {
  const files = definitionFiles() as DefinitionFiles;
  const presets: Preset[] = [];
  for (const file of Object.keys(files.noteTypes).sort()) {
    const resolved = resolve(file, files);
    if (!resolved.ok) throw new Error(`fixture ${file} does not resolve`);
    const { definition } = resolved;
    presets.push({
      key: definition.key,
      version: definition.version,
      hash: await sha256Hex(canonicalJson(definition)),
      definition,
    });
  }
  return presets;
}
