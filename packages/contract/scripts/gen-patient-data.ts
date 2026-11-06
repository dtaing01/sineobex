// Generates the patient data modules from packages/contract/data (phase 3 design 5.1, 9.5):
//   services/api/src/patients/generated/{nicknames,weak-tokens,sensitive-codes}.ts
//   apps/mobile/lib/patients/generated/{nicknames,weak_tokens,sensitive_codes}.dart
//   apps/mobile/assets/problem_codes.json
// `pnpm contract:generate` runs it after the contract; test/patient-data.test.ts fails if a
// committed output differs from what the data files give, the way the contract drift check does.
// The TypeScript is formatted with the repository's Prettier settings; the Dart is written the way
// `dart format` leaves it, because the contract job has no Flutter.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import prettier from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const data = (name: string) => resolve(root, 'packages/contract/data', name);

/** A normalized search token: what sineobex.normalize_name leaves of one word. */
const TOKEN = /^[a-z0-9]+$/;
/** The shape the API checks a problem code against (sync/entities/values.ts, 0010). */
const ICD10CM_CODE = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;
// PLAN-OPEN: the problem code list (phase 3 design 14.1, #5), for Brooke and Mercy to review.
const CODE_GROUPS = [
  'wounds',
  'injuries',
  'burns',
  'exposure',
  'bites',
  'skin',
  'parasites',
  'foot',
  'infections',
  'sexual_health',
  'respiratory',
  'cardiovascular',
  'endocrine',
  'blood',
  'gastro',
  'kidney',
  'neuro',
  'musculoskeletal',
  'mental_health',
  'substance_use',
  'overdose',
  'pregnancy',
  'eye_ear_dental',
  'symptoms',
  'screening',
  'social',
];

/** Lines that aren't blank or `#` comments. */
const dataLines = (text: string) => text.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));

/** RFC 4180 fields of one line: commas, and double quotes around fields that hold them. */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  if (quoted) throw new Error(`Unclosed quote: ${line}`);
  out.push(field);
  return out;
}

function nicknameGroups(text: string, file: string): string[][] {
  return dataLines(text).map((line) => {
    const group = line.split(',');
    for (const t of group) if (!TOKEN.test(t)) throw new Error(`${file}: "${t}" is not a normalized token`);
    if (group.length < 2) throw new Error(`${file}: "${line}" has no nickname`);
    if (new Set(group).size !== group.length) throw new Error(`${file}: "${line}" repeats a name`);
    return group;
  });
}

interface Code {
  code: string;
  title: string;
  group: string;
  sensitive: boolean;
}
interface Range {
  from: string;
  to: string;
  label: string;
}

/** Whether a code falls in a range: its first `from.length` characters sort between from and to. */
export const inRange = (code: string, r: { from: string; to: string }) => {
  const head = code.slice(0, r.from.length);
  return head >= r.from && head <= r.to;
};

function ranges(text: string): Range[] {
  const [header, ...rows] = dataLines(text);
  if (header !== 'from,to,label') throw new Error('sensitive-code-ranges.csv: unexpected header');
  return rows.map((row) => {
    const [from, to, label] = csvFields(row) as [string, string, string];
    if (from.length !== to.length || from > to || !/^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/.test(from)) {
      throw new Error(`sensitive-code-ranges.csv: bad range ${row}`);
    }
    return { from, to, label };
  });
}

function codes(text: string, sensitive: Range[]): Code[] {
  const [header, ...rows] = dataLines(text);
  if (header !== 'code,title,group') throw new Error('icd10cm-curated.csv: unexpected header');
  const seen = new Set<string>();
  return rows.map((row) => {
    const fields = csvFields(row);
    const [code, title, group] = fields as [string, string, string];
    if (fields.length !== 3) throw new Error(`icd10cm-curated.csv: ${row}`);
    if (!ICD10CM_CODE.test(code)) throw new Error(`icd10cm-curated.csv: bad code ${code}`);
    if (seen.has(code)) throw new Error(`icd10cm-curated.csv: ${code} twice`);
    seen.add(code);
    if (title.trim() !== title || title.length < 1 || title.length > 300) {
      throw new Error(`icd10cm-curated.csv: bad title for ${code}`);
    }
    if (!CODE_GROUPS.includes(group)) throw new Error(`icd10cm-curated.csv: unknown group ${group}`);
    return { code, title, group, sensitive: sensitive.some((r) => inRange(code, r)) };
  });
}

const TS_HEADER = (sources: string) =>
  `// GENERATED FILE. Do not edit by hand.\n// Source: ${sources}.\n` +
  '// Regenerate with `pnpm contract:generate`; a contract test fails if this file is out of date.\n';

const DART_HEADER = TS_HEADER;

const dartString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}'`;

/** A const list, one element per line: how dart format lays out a list that doesn't fit one line. */
function dartList(doc: string, decl: string, type: string, items: string[]): string {
  return `${doc}const ${decl} = <${type}>[\n${items.map((i) => `  ${i},\n`).join('')}];\n`;
}

export async function buildPatientData(): Promise<Record<string, string>> {
  const upstream = nicknameGroups(await readFile(data('nicknames.csv'), 'utf8'), 'nicknames.csv');
  const local = nicknameGroups(await readFile(data('nicknames-local.csv'), 'utf8'), 'nicknames-local.csv');
  const groups = [...upstream, ...local].map((g) => g.join(' '));
  const weak = dataLines(await readFile(data('weak-tokens.txt'), 'utf8')).map((t) => {
    if (!TOKEN.test(t)) throw new Error(`weak-tokens.txt: "${t}" is not a normalized token`);
    return t;
  });
  const sensitive = ranges(await readFile(data('sensitive-code-ranges.csv'), 'utf8'));
  const problemCodes = codes(await readFile(data('icd10cm-curated.csv'), 'utf8'), sensitive);

  const nickDoc = [
    'Groups of equivalent given-name tokens (nicknames, diminutives, transliterations), normalized and',
    'space-separated. Two tokens are nicknames of each other when they share a group.',
    'PLAN-OPEN: nickname data (phase 3 design 14.1, #3): the upstream list plus a reviewed local supplement.',
  ];
  const weakDoc = [
    'Name words dropped before scoring unless nothing else is left ("Big Mike" finds "Mike").',
  ];
  const rangeDoc = [
    'Problem codes sensitive by default: a code is in a range when its first `from.length` characters',
    'sort between `from` and `to`.',
    'PLAN-OPEN: which codes are sensitive (phase 3 design 14.1, #6), with counsel; 42 CFR Part 2 may widen it.',
  ];
  const tsDoc = (lines: string[]) =>
    lines.length === 1 ? `/** ${lines[0]} */\n` : `/**\n${lines.map((l) => ` * ${l}\n`).join('')} */\n`;
  const dartDoc = (lines: string[]) => lines.map((l) => `/// ${l}\n`).join('');

  const prettierConfig = (await prettier.resolveConfig(resolve(root, 'services/api/src/index.ts'))) ?? {};
  const ts = (source: string) => prettier.format(source, { ...prettierConfig, parser: 'typescript' });

  const out: Record<string, string> = {};
  out['services/api/src/patients/generated/nicknames.ts'] = await ts(
    `${TS_HEADER('packages/contract/data/nicknames.csv and nicknames-local.csv')}\n${tsDoc(nickDoc)}` +
      `export const NICKNAME_GROUPS: readonly string[] = ${JSON.stringify(groups)};\n`,
  );
  out['services/api/src/patients/generated/weak-tokens.ts'] = await ts(
    `${TS_HEADER('packages/contract/data/weak-tokens.txt')}\n${tsDoc(weakDoc)}` +
      `export const WEAK_TOKENS: readonly string[] = ${JSON.stringify(weak)};\n`,
  );
  out['services/api/src/patients/generated/sensitive-codes.ts'] = await ts(
    `${TS_HEADER('packages/contract/data/sensitive-code-ranges.csv')}\n${tsDoc(rangeDoc)}` +
      `export const SENSITIVE_CODE_RANGES: readonly { from: string; to: string }[] = ${JSON.stringify(
        sensitive.map(({ from, to }) => ({ from, to })),
      )};\n`,
  );

  out['apps/mobile/lib/patients/generated/nicknames.dart'] =
    `${DART_HEADER('packages/contract/data/nicknames.csv and nicknames-local.csv')}\n` +
    dartList(dartDoc(nickDoc), 'nicknameGroups', 'String', groups.map(dartString));
  out['apps/mobile/lib/patients/generated/weak_tokens.dart'] =
    `${DART_HEADER('packages/contract/data/weak-tokens.txt')}\n` +
    dartList(dartDoc(weakDoc), 'weakTokens', 'String', weak.map(dartString));
  out['apps/mobile/lib/patients/generated/sensitive_codes.dart'] =
    `${DART_HEADER('packages/contract/data/sensitive-code-ranges.csv')}\n` +
    dartList(
      dartDoc(rangeDoc),
      'sensitiveCodeRanges',
      '({String from, String to})',
      sensitive.map((r) => `(from: ${dartString(r.from)}, to: ${dartString(r.to)})`),
    );
  out['apps/mobile/assets/problem_codes.json'] = `${JSON.stringify(
    {
      note:
        'GENERATED from packages/contract/data/icd10cm-curated.csv and sensitive-code-ranges.csv by ' +
        '`pnpm contract:generate`. ICD-10-CM (CDC/NCHS, public domain), April 1, 2026 release; official long titles.',
      system: 'icd10cm',
      codes: problemCodes,
    },
    null,
    1,
  )}\n`;
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = await buildPatientData();
  for (const [path, content] of Object.entries(files)) {
    const full = resolve(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  console.log(`patient data regenerated: ${Object.keys(files).length} files`);
}
