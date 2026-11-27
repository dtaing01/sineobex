// Regenerates the contract from the API's route definitions:
//   packages/contract/openapi.json            the spec (source of truth for both clients)
//   packages/contract/src/generated/api.ts    TypeScript types for the portal
//   apps/mobile/lib/api/generated/api.dart    Dart client for the phone
// CI runs this and fails if any of the three changed, so neither app can drift from the server.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import { buildOpenApiDocument, createApp, loadConfig, silentLogger, type Database } from '@sineobex/api';
import { generateDart, type OpenApiDocument } from './dart.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

const unusedDb: Database = {
  tx: () => Promise.reject(new Error('no database while generating the contract')),
  ping: () => Promise.reject(new Error('no database while generating the contract')),
  close: () => Promise.resolve(),
};

const app = createApp({
  config: loadConfig({
    APP_ENV: 'local',
    DATABASE_URL: 'postgres://unused',
    OIDC_ISSUER: 'https://idp.example.invalid',
    OIDC_AUDIENCE: 'contract',
    OIDC_JWKS_URL: 'https://idp.example.invalid/jwks',
    MFA_MODE: 'none',
    IDENTITY_ADMIN: 'memory',
  }),
  db: unusedDb,
  verifier: { verify: () => Promise.reject(new Error('unused')) },
  identityAdmin: {
    inviteOrFind: () => Promise.reject(new Error('unused')),
    disable: () => Promise.reject(new Error('unused')),
    enable: () => Promise.reject(new Error('unused')),
  },
  log: silentLogger,
  now: () => new Date(0),
});

const doc = sortKeys(buildOpenApiDocument(app)) as OpenApiDocument;
const specJson = `${JSON.stringify(doc, null, 2)}\n`;

const specPath = resolve(root, 'packages/contract/openapi.json');
await writeFile(specPath, specJson);

const ast = await openapiTS(JSON.parse(specJson) as Parameters<typeof openapiTS>[0], {
  alphabetize: true,
});
const tsPath = resolve(root, 'packages/contract/src/generated/api.ts');
await mkdir(dirname(tsPath), { recursive: true });
await writeFile(
  tsPath,
  `// GENERATED FILE. Do not edit by hand. Regenerate with \`pnpm contract:generate\`.\n${astToString(ast)}`,
);

const dartPath = resolve(root, 'apps/mobile/lib/api/generated/api.dart');
await mkdir(dirname(dartPath), { recursive: true });
await writeFile(dartPath, generateDart(doc));

console.log(
  'contract regenerated: openapi.json, src/generated/api.ts, apps/mobile/lib/api/generated/api.dart',
);
