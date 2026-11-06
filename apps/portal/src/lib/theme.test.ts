import { describe, expect, it } from 'vitest';
import { dataTheme, parseTheme } from './theme';

describe('theme choice', () => {
  it('accepts only known themes and falls back to following the system', () => {
    expect(parseTheme('night')).toBe('night');
    expect(parseTheme('"><script>')).toBe('system');
    expect(parseTheme(undefined)).toBe('system');
  });

  it('leaves data-theme unset when following the system', () => {
    expect(dataTheme('system')).toBeUndefined();
    expect(dataTheme('contrast')).toBe('contrast');
  });
});
