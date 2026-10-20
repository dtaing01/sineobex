// Bundles the API for its two runtimes. Workspace packages are inlined; npm dependencies are inlined
// too, so the Edge Function needs no import map and the container needs no node_modules.
import { build } from 'esbuild';

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2023',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'info',
  // Some dependencies use require() for Node built-ins; give the ESM bundle a require to call.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
};

await build({
  ...common,
  entryPoints: ['src/entry/node.ts'],
  outfile: 'dist/node.js',
  platform: 'node',
});

await build({
  ...common,
  entryPoints: ['src/entry/edge.ts'],
  outfile: 'supabase/functions/api/bundle.js',
  platform: 'node',
  // Deno resolves node: built-ins natively.
  external: ['node:*'],
});
