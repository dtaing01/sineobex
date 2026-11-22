// What the API, the seed and the scripts import. The API is bundled for an edge runtime, as it is
// with '@sineobex/forms', so nothing reachable from here may load a Node-only module or code the
// bundle would not hold otherwise: this package's own files and data, the forms package's index,
// whose own import-path test holds what it reaches, and zod, which the API's routes already
// bundle. Never '@sineobex/forms/schema', which loads the JSON Schema library
// (test/import-path.test.ts holds this).
// The body of each kind (phase 5 design 4.4).
export * from './schemas.ts';
