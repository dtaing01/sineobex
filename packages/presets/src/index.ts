// What the API, the seed and the scripts import. The API is bundled for an edge runtime, as it is
// with '@sineobex/forms', so nothing reachable from here may load a Node-only module or code the
// bundle would not hold otherwise: this package's own files and data, the forms package's index,
// whose own import-path test holds what it reaches, and zod, which the API's routes already
// bundle. Never '@sineobex/forms/schema', which loads the JSON Schema library
// (test/import-path.test.ts holds this).
// The body of each kind (phase 5 design 4.4).
export * from './schemas.ts';
// When a problem is due a status check (5.3).
export * from './problem-check.ts';
// What a body's schema cannot hold: the team's other presets and its note types (4.4).
export * from './validate.ts';
// What each act on a preset does and refuses, and what is fixed at creation (5.1).
export * from './rules.ts';
// What a note suggests, and what a bundle applies (5.3).
export * from './supplies.ts';
// The platform's presets, and the installer that gives them to a team (4.6, 5.2): the API and the
// seed hand it their own transaction.
export * from './install.ts';
