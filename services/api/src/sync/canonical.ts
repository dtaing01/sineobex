/**
 * Canonical JSON for hashing synced values (module 9: "A SHA-256 hash of the value").
 *
 * The phone and the server must produce byte-identical text for the same value, or receipts
 * never match and nothing is ever purged. Rules (mirrored in apps/mobile/lib/sync/canonical_json.dart,
 * pinned by packages/contract/test-vectors/canonical-json.json):
 *  - object keys sorted by UTF-16 code units, recursively; no whitespace
 *  - numbers: integers without a decimal point; non-integers in shortest round-trip form;
 *    -0 becomes 0; NaN and Infinity are rejected
 *  - strings: JSON escapes for quote, backslash and control characters below U+0020 only
 *    (\b \f \n \r \t, others as \u00XX lowercase); everything else, including non-ASCII, raw
 *  - undefined values in objects are dropped; null stays
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonical JSON cannot encode NaN or Infinity');
      return Object.is(value, -0) ? '0' : String(value);
    case 'string':
      return quote(value);
    case 'object': {
      if (Array.isArray(value))
        return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${quote(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    default:
      throw new Error(`canonical JSON cannot encode ${typeof value}`);
  }
}

const SHORT: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

function quote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (SHORT[ch] !== undefined) out += SHORT[ch];
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function valueHash(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
