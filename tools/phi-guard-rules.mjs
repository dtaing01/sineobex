// Rules for tools/phi-guard.mjs. Kept separate so tests can import them without scanning the repo.

/** Fixture and seed locations: anything here must be obviously made up. */
export const FIXTURE_GLOBS = [
  /^db\/seed\//,
  /\/test\//,
  /\/e2e\//,
  /^apps\/mobile\/test\//,
  /^tools\/test\//,
];

const SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;
// NANP numbers. 555-0100 through 555-0199 are reserved for fiction and allowed.
const PHONE = /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g;
const FICTIONAL_PHONE = /555[-. ]01\d\d$/;
const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const RESERVED_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net)|invalid|test|localhost|sineobex\.invalid)$/i;
// Medicaid and Medicare IDs in Michigan look like 10 digits or the MBI format; fixtures use "TEST-" IDs.
const MBI =
  /\b[1-9][A-CEGHJ-NP-RT-Y][0-9A-CEGHJ-NP-RT-Y]\d[A-CEGHJ-NP-RT-Y][0-9A-CEGHJ-NP-RT-Y]\d[A-CEGHJ-NP-RT-Y]{2}\d{2}\b/g;

export function scanFixture(path, text) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const at = `${path}:${i + 1}`;
    if (line.includes('phi-guard: allow')) return;
    for (const m of line.matchAll(SSN))
      findings.push(`${at}: looks like a Social Security number (${m[0].slice(0, 3)}-…)`);
    for (const m of line.matchAll(PHONE)) {
      if (!FICTIONAL_PHONE.test(m[0]))
        findings.push(`${at}: phone number outside the fictional 555-01xx range`);
    }
    for (const m of line.matchAll(EMAIL)) {
      if (!RESERVED_EMAIL_DOMAINS.test(m[1]))
        findings.push(`${at}: email at a real domain (${m[1]}); use example.com`);
    }
    for (const _ of line.matchAll(MBI)) findings.push(`${at}: looks like a Medicare Beneficiary Identifier`);
  });
  return findings;
}

/** Architecture rules from the Build plan, checked on source files. */
export function scanSource(path, text) {
  const findings = [];
  // "The phone and the portal talk only to our API, never to Supabase tables directly."
  if (
    /^apps\/portal\/src\//.test(path) &&
    /from ['"]@supabase\/supabase-js['"]/.test(text) &&
    !/\/auth\//.test(path)
  ) {
    findings.push(`${path}: the portal may use Supabase only for sign-in (src/lib/auth/), never for data`);
  }
  if (path === 'apps/mobile/pubspec.yaml' && /^\s*supabase(_flutter)?:/m.test(text)) {
    findings.push(`${path}: the phone talks only to the Sineobex API; sign-in goes through the OIDC adapter`);
  }
  // Device logs end up in bug reports and on other apps' screens; nothing in lib/ may write to them.
  if (/^apps\/mobile\/lib\//.test(path) && !/\/generated\//.test(path)) {
    text.split('\n').forEach((line, i) => {
      if (/\b(debugPrint|print)\s*\(/.test(line) || /\bdeveloper\.log\s*\(/.test(line)) {
        findings.push(`${path}:${i + 1}: no printing or logging from the app; use the redacting logger`);
      }
    });
  }
  return findings;
}
