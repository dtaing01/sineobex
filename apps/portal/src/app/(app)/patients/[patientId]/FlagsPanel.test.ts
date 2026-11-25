import type { Schemas } from '@sineobex/contract';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FlagChoice } from '@/lib/flags';
import { FlagsPanel, type FlagsPanelProps } from './FlagsPanel';

// The patient page's Flags panel as it first draws (phase 5 design 8.1; card P5-portal-panel),
// written ahead of its code: it fails until that card lands. The history as the API worked it out
// for the reader (D114: a change entered in error keeps its reasons only for its author and Program
// Admins, so a row without them is drawn without them); Entered in error only on the changes the
// person may mark; the form. Every value is made up.
const PATIENT = '5eed0000-0000-4000-8000-0000000000f3';
const HIGH = '30f40000-0000-4000-8000-000000000001';
const FROST = '30f40000-0000-4000-8000-000000000011';
const HEAT = '30f40000-0000-4000-8000-000000000012';
const SET = 'cf100000-0000-4000-8000-000000000001';
const MINE = 'cf100000-0000-4000-8000-000000000002';
const MARKED = 'cf100000-0000-4000-8000-000000000003';
const FORM_ID = 'cf100000-0000-4000-8000-0000000000ff';

type Row = Schemas['FlagHistoryRow'];
const row = (changeId: string, over: Partial<Row>): Row => ({
  changeId,
  flagId: HIGH,
  name: 'Demo: High',
  tier: 'primary',
  action: 'set',
  effectiveAt: '2026-10-20T15:00:00.000Z',
  authorName: 'Demo Blair',
  reason: 'Demo: left hospital this week',
  enteredInError: null,
  ...over,
});

const choice = (
  flagId: string,
  name: string,
  tier: 'primary' | 'secondary',
  over: Partial<FlagChoice> = {},
): FlagChoice => ({
  flagId,
  name,
  tier,
  color: 'red',
  colorName: 'Red',
  clearOnly: false,
  carried: false,
  ...over,
});

const props = (over: Partial<FlagsPanelProps> = {}): FlagsPanelProps => ({
  patientId: PATIENT,
  flags: {
    primary: {
      flagId: HIGH,
      name: 'Demo: High',
      tier: 'primary',
      color: 'red',
      colorName: 'Red',
      rank: 10,
      archived: false,
    },
    secondary: [],
    history: [
      row(SET, {}),
      row(MINE, {
        flagId: FROST,
        name: 'Demo: Frost risk',
        tier: 'secondary',
        authorName: 'Demo Alex',
        reason: 'Demo: sleeps by the river',
      }),
      // Entered in error, read by someone who neither made it nor manages the team's people: no reasons.
      row(MARKED, {
        action: 'clear',
        authorName: 'Demo Casey',
        reason: undefined,
        enteredInError: { byName: 'Demo Casey', at: '2026-10-21T16:00:00.000Z' },
      }),
    ],
  },
  choices: [
    choice(HIGH, 'Demo: High', 'primary', { carried: true }),
    choice(FROST, 'Demo: Frost risk', 'secondary', { color: 'blue', colorName: 'Blue' }),
    choice(HEAT, 'Demo: Heat risk', 'secondary', {
      color: 'orange',
      colorName: 'Orange',
      clearOnly: true,
      carried: true,
    }),
  ],
  markable: [MINE],
  canEdit: true,
  changeId: FORM_ID,
  ...over,
});

const draw = (over: Partial<FlagsPanelProps> = {}) =>
  renderToStaticMarkup(createElement(FlagsPanel, props(over)));

/** Whether [html] holds an opening <[tag]> with every one of [attrs], in any order. */
const hasTag = (html: string, tag: string, attrs: string[]) =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].some((m) => attrs.every((a) => m[0].includes(a)));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the Flags panel’s history', () => {
  it('lists each change: the flag, set or cleared, who, when and why', () => {
    const t = text(draw());
    for (const words of [
      'Demo: High',
      'Demo Blair',
      'Demo: left hospital this week',
      'Demo: Frost risk',
      'Demo Alex',
      'Demo: sleeps by the river',
    ]) {
      expect(t).toContain(words);
    }
    expect(t).toMatch(/Set\b/);
    expect(t).toMatch(/Cleared\b/);
  });

  it('says a change was entered in error, by whom and when, and draws no reason the API kept back', () => {
    const t = text(draw());
    expect(t).toContain('Entered in error');
    expect(t).toContain('Demo Casey');
    // The mark's own reason, where the API sent one, to the author or a Program Admin.
    const withReason = text(
      draw({
        flags: {
          ...props().flags,
          history: [
            row(MARKED, {
              enteredInError: {
                byName: 'Demo Casey',
                at: '2026-10-21T16:00:00.000Z',
                reason: 'Demo: wrong patient',
              },
            }),
          ],
        },
      }),
    );
    expect(withReason).toContain('Demo: wrong patient');
  });

  it('offers Entered in error only on the changes the person may mark', () => {
    const html = draw();
    // Its button, a form's or a plain one; the history's own words for a change marked are not one.
    const buttons = (h: string) =>
      h.match(/<button[^>]*>(?:(?!<\/button>).)*Entered in error(?:(?!<\/button>).)*<\/button>/gs) ?? [];
    expect(buttons(html)).toHaveLength(1);
    expect(buttons(draw({ markable: [] }))).toHaveLength(0);
  });
});

describe('the Flags panel’s form', () => {
  it('offers each choice by its pill’s words, a removed flag only to clear, a private reason, and Save', () => {
    const html = draw();
    expect(html).toContain('<form');
    expect(hasTag(html, 'select', ['name="flagId"'])).toBe(true);
    for (const words of ['Red · Demo: High', 'Blue · Demo: Frost risk', 'Orange · Demo: Heat risk']) {
      expect(html).toContain(words);
    }
    expect(text(html)).toContain('No longer on the team’s list');
    expect(hasTag(html, 'input', ['type="radio"', 'name="action"', 'value="set"'])).toBe(true);
    expect(hasTag(html, 'input', ['type="radio"', 'name="action"', 'value="clear"'])).toBe(true);
    // React writes the attribute as autoComplete, which HTML reads in any case.
    expect(hasTag(html, 'textarea', ['name="reason"', 'autoComplete="off"', 'required=""'])).toBe(true);
    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*>(?:(?!<\/button>).)*Save(?:(?!<\/button>).)*<\/button>/s,
    );
    // The change's ID lives with the form, never in the address.
    expect(html).not.toContain(`?${FORM_ID}`);
  });

  it('offers no form, and no Entered in error, without patients.edit', () => {
    const html = draw({ canEdit: false, markable: [] });
    expect(html).not.toContain('<form');
    expect(text(html)).toContain('Demo: High');
  });
});
