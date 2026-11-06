import { describe, expect, it } from 'vitest';
import { scanFixture, scanSource } from '../phi-guard-rules.mjs';

describe('fixture scan', () => {
  it('flags identifiers that look real', () => {
    const text = [
      "ssn: '123-45-6789'", // phi-guard: allow — the guard's own positive cases
      "phone: '(313) 867-5309'", // phi-guard: allow — the guard's own positive cases
      "email: 'marcus@gmail.com'", // phi-guard: allow — the guard's own positive cases
      "mbi: '1EG4TE5MK73'", // phi-guard: allow — the guard's own positive cases
    ].join('\n');
    expect(scanFixture('db/seed/x.ts', text)).toHaveLength(4);
  });

  it('allows the reserved fictional forms', () => {
    const text = [
      "phone: '313-555-0142'",
      "email: 'brooke@example.com'",
      "x: 'staff@clinic.test'",
      "ssn: '000-12-3456'",
    ].join('\n');
    expect(scanFixture('db/seed/x.ts', text)).toEqual([]);
  });

  it('honours an explicit allow comment', () => {
    expect(scanFixture('db/seed/x.ts', "id: '123-45-6789' // phi-guard: allow — format test only")).toEqual(
      [],
    );
  });
});

describe('source rules', () => {
  it('keeps Supabase data access out of the portal', () => {
    const imp = "import { createClient } from '@supabase/supabase-js';";
    expect(scanSource('apps/portal/src/app/page.tsx', imp)).toHaveLength(1);
    expect(scanSource('apps/portal/src/lib/auth/supabase.ts', imp)).toEqual([]);
  });

  it('keeps Supabase out of the phone', () => {
    expect(scanSource('apps/mobile/pubspec.yaml', 'dependencies:\n  supabase_flutter: 2.0.0')).toHaveLength(
      1,
    );
  });

  it('forbids printing from the app', () => {
    expect(scanSource('apps/mobile/lib/a.dart', "debugPrint('x');")).toHaveLength(1);
    expect(scanSource('apps/mobile/lib/api/generated/api.dart', "print('x');")).toEqual([]);
  });
});
