import { afterEach, describe, expect, it } from 'vitest';
import { isDemo, portalEnv } from './env';

describe('portal environment', () => {
  const original = process.env.PORTAL_ENV;
  afterEach(() => {
    process.env.PORTAL_ENV = original;
  });

  it('treats local, test and preview as demo deployments', () => {
    expect(isDemo('preview')).toBe(true);
    expect(isDemo('pilot')).toBe(false);
    expect(isDemo('production')).toBe(false);
  });

  it('rejects an unknown environment instead of guessing', () => {
    process.env.PORTAL_ENV = 'prod';
    expect(() => portalEnv()).toThrow(/not a known environment/);
  });
});
