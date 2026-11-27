import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ListedFlag } from '@/lib/flags';
import { SearchForm } from './SearchForm';

// The patient search's Risk level and Conditions (phase 5 design 7, 8.1; section 11, row 37; card
// P5-portal-filters), written ahead of their code: fields of the search's own POST form, so neither
// reaches the address, their choices the flags the API lists for the person (D114). Every value is
// made up.
vi.mock('@/app/actions/patients', () => ({ searchPatients: async () => ({}) }));

const flags: ListedFlag[] = [
  {
    flagId: '30f60000-0000-4000-8000-000000000001',
    name: 'Demo: High',
    tier: 'primary',
    color: 'red',
    colorName: 'Red',
    rank: 10,
  },
  {
    flagId: '30f60000-0000-4000-8000-000000000002',
    name: 'Demo: Medium',
    tier: 'primary',
    color: 'yellow',
    colorName: 'Yellow',
    rank: 20,
  },
  {
    flagId: '30f60000-0000-4000-8000-000000000011',
    name: 'Demo: Frost risk',
    tier: 'secondary',
    color: 'blue',
    colorName: 'Blue',
    rank: 10,
  },
  {
    flagId: '30f60000-0000-4000-8000-000000000012',
    name: 'Demo: Wet feet',
    tier: 'secondary',
    color: 'teal',
    colorName: 'Teal',
    rank: 20,
  },
];

const draw = (listed: readonly ListedFlag[]) =>
  renderToStaticMarkup(createElement(SearchForm, { flags: listed }));

describe('the search’s flag fields', () => {
  it('are fields of the search’s own form: Risk level, one or any, and Conditions, several', () => {
    const html = draw(flags);
    const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    expect(form).toContain('Risk level');
    expect(form).toContain('Conditions');
    const select = /<select[^>]*name="riskLevel"[^>]*>(.*?)<\/select>/s.exec(form);
    expect(select).not.toBeNull();
    expect(select![1]).toMatch(/<option value=""[^>]*>/);
    expect(select![1]).toContain(`value="${flags[0]!.flagId}"`);
    expect(select![1]).toContain('Red · Demo: High');
    expect(select![1]).toContain('Yellow · Demo: Medium');
    expect(select![1]).not.toContain('Demo: Frost risk');
    const inputs = [...form.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
    for (const f of flags.slice(2)) {
      const attrs = ['type="checkbox"', 'name="conditions"', `value="${f.flagId}"`];
      expect(
        inputs.some((i) => attrs.every((a) => i.includes(a))),
        f.name,
      ).toBe(true);
    }
    expect(form).toContain('Blue · Demo: Frost risk');
    expect(form).toContain('Teal · Demo: Wet feet');
  });

  it('are not drawn where the person may see no flag', () => {
    const html = draw([]);
    expect(html).not.toContain('name="riskLevel"');
    expect(html).not.toContain('name="conditions"');
    // The rest of the search is as it was.
    expect(html).toContain('name="name"');
    expect(draw(flags)).toContain('name="riskLevel"');
  });
});
