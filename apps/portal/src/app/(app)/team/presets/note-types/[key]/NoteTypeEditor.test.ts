import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NoteTypeDefinition, NoteTypeRow } from '@/lib/presets';
import { ID_TAKEN, liveAfterDrop } from '@/lib/refusals';
import {
  answerKind,
  copyTakenWords,
  heldHide,
  heldRename,
  heldTitle,
  replaceOrAdd,
  shownOptions,
  type HeldOp,
} from './held';
import { NoteTypeEditor } from './NoteTypeEditor';

// The note type editor as the page first draws it, and what it holds (phase 5 design 5.4, 8.1).
// The editor's presses are the end-to-end tests' (e2e/note-types.spec.ts): here, what the first
// render shows, and the pure parts that say what is held. Every name is made up.

const definition: NoteTypeDefinition = {
  key: 't_00000000000d',
  version: 3,
  title: 'Demo: Evening round',
  kinds: ['non_medical'],
  group: 'outreach',
  sensitivity: 'none',
  sections: [
    {
      id: 'needs',
      title: 'Demo: Needs',
      fields: [
        {
          id: 'given',
          kind: 'choice',
          label: 'Demo: Given',
          many: true,
          options: [
            { code: 'socks', label: 'Demo: Socks' },
            { code: 'food', label: 'Demo: Food' },
            { code: 'none', label: 'Demo: None', exclusive: true },
          ],
        },
        { id: 'notes', kind: 'text', label: 'Demo: Notes' },
      ],
    },
    { id: 'consent', title: 'Demo: Consent', needs: 'orderMedications', fields: [] },
  ],
};

const row: NoteTypeRow = {
  key: definition.key,
  title: definition.title,
  state: 'active',
  version: 3,
  customized: true,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: {},
  definition,
  protected: {
    whole: false,
    sections: ['consent'],
    fields: [],
    options: [{ path: 'needs.given', code: 'none' }],
  },
};

const draw = () =>
  renderToStaticMarkup(
    createElement(NoteTypeEditor, {
      row,
      titles: {},
      sources: [
        { key: 'outreach', title: 'Demo: Outreach', sections: [{ id: 'outreach', title: 'Demo: Contact' }] },
      ],
    }),
  );

const held = (id: number, op: Record<string, unknown>): HeldOp => ({
  id,
  op: op as HeldOp['op'],
  said: `change ${id}`,
});

describe('the note type editor, as first drawn', () => {
  it('names each section by its heading, with Rename and Hide, and 8.1’s sentence where it is protected', () => {
    const html = draw();
    expect(html).toContain('<h2 id="section-needs" class="px-h2">Demo: Needs</h2>');
    expect(html).toContain('<h2 id="section-consent" class="px-h2">Demo: Consent</h2>');
    const consent = html.slice(html.indexOf('id="section-consent"'));
    expect(consent).toContain('This part can’t be changed.');
    expect(consent).not.toMatch(/>Rename</);
    const needs = html.slice(html.indexOf('id="section-needs"'), html.indexOf('id="section-consent"'));
    expect(needs).toMatch(/>Rename<span class="sr-only"> the section “Demo: Needs”<\/span>/);
    expect(needs).toMatch(/>Hide<span class="sr-only"> the section “Demo: Needs”<\/span>/);
    // Fields wait behind a button, so a long note type reads as its sections.
    expect(needs).toContain('aria-expanded="false"');
    expect(needs).toContain('Show its fields (2)');
  });

  it('holds nothing yet, says the version it opened, and asks a reason to publish', () => {
    const html = draw();
    expect(html).toContain('Changes to publish (0)');
    expect(html).toContain('Version you’re editing');
    const reason = /<input id="publish-reason"[^>]*>/.exec(html)?.[0] ?? '';
    expect(reason).toMatch(/name="reason"/);
    expect(reason).toMatch(/autocomplete="off"/i);
    expect(html).toContain('Don’t put patient names here.');
    expect(html).toContain('Notes already started stay on the version they began on.');
    expect(html).toMatch(/>Publish</);
  });

  it('offers Rename on the title of every note type: the API answers where it can’t be changed', () => {
    const html = draw();
    const title = html.slice(html.indexOf('id="note-type-title"'), html.indexOf('id="held-heading"'));
    expect(title).toContain('Demo: Evening round');
    expect(title).toMatch(/>Rename<span class="sr-only"> the note type<\/span>/);
  });
});

describe('what the editor holds', () => {
  it('reads the held title, a part’s held rename and its held hide', () => {
    const list = [
      held(1, { op: 'rename_type', title: 'Demo: First' }),
      held(2, { op: 'rename_label', path: 'needs.notes', label: 'Demo: Said' }),
      held(3, { op: 'set_hidden', path: 'needs', hidden: true }),
      held(4, { op: 'rename_type', title: 'Demo: Second' }),
    ];
    expect(heldTitle(list)).toBe('Demo: Second');
    expect(heldTitle([])).toBeNull();
    expect(heldRename(list, 'needs.notes')?.id).toBe(2);
    expect(heldRename(list, 'needs')).toBeUndefined();
    expect(heldHide(list, 'needs')?.id).toBe(3);
    expect(heldHide(list, 'needs.notes')).toBeUndefined();
  });

  it('puts a second change of one part where the first stood, so what follows still names it', () => {
    const list = [
      held(1, { op: 'rename_label', path: 'a.b', label: 'x' }),
      held(2, { op: 'set_hidden', path: 'a.b', hidden: true }),
    ];
    const next = held(3, { op: 'rename_label', path: 'a.b', label: 'y' });
    expect(replaceOrAdd(list, list[0], next).map((h) => h.id)).toEqual([3, 2]);
    expect(replaceOrAdd(list, undefined, next).map((h) => h.id)).toEqual([1, 2, 3]);
  });

  it('shows a choice’s answers as the held moves, retires, renames and adds leave them', () => {
    const options = definition.sections[0]!.fields[0]!.options!;
    // Each move puts its answer just before the one it names, or at the end (5.4's move_option).
    const list = [
      held(1, { op: 'move_option', path: 'needs.given', code: 'none', before: 'socks' }),
      held(2, { op: 'rename_option', path: 'needs.given', code: 'socks', label: 'Demo: Wool socks' }),
      held(3, { op: 'add_option', path: 'needs.given', label: 'Demo: Blanket' }),
      held(4, { op: 'move_option', path: 'needs.given', code: 'food', before: 'socks' }),
      held(5, { op: 'move_option', path: 'other.field', code: 'socks', before: null }),
    ];
    expect(
      shownOptions(options, list, 'needs.given').live.map((o) => [o.code, o.renamed?.id ?? null]),
    ).toEqual([
      ['none', null],
      ['food', null],
      ['socks', 2],
    ]);
    const moved = [...list, held(6, { op: 'move_option', path: 'needs.given', code: 'none', before: null })];
    expect(shownOptions(options, moved, 'needs.given').live.map((o) => o.code)).toEqual([
      'food',
      'socks',
      'none',
    ]);
    const shown = shownOptions(
      options,
      [...list, held(7, { op: 'retire_option', path: 'needs.given', code: 'none' })],
      'needs.given',
    );
    expect(shown.live.map((o) => o.code)).toEqual(['food', 'socks']);
    expect(shown.retired.map((r) => [r.option.code, r.op.id])).toEqual([['none', 7]]);
    expect(shown.added.map((h) => h.id)).toEqual([3]);
  });
});

describe('the changes to publish', () => {
  it('are numbered, as a refusal names “Change 3”: each stays a list item, its parts in a column inside it (B-11)', () => {
    const css = readFileSync(new URL('./editor.module.css', import.meta.url), 'utf8');
    const rule = (selector: string) =>
      new RegExp(`(^|\\n)\\.${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[2] ?? '';
    expect(rule('heldList')).toMatch(/list-style:\s*decimal/);
    expect(rule('heldList')).not.toMatch(/display:/);
    expect(css).not.toMatch(/\.heldList\s*>\s*li\s*\{[^}]*display:/);
  });
});

describe('the editor’s buttons', () => {
  it('name what a press does, Hide or Show again, and none is a toggle whose state its name contradicts (B-4)', () => {
    const html = draw();
    expect(html).toContain('Hide<span class="sr-only"> the section “Demo: Needs”</span>');
    expect(html).not.toContain('aria-pressed');
  });
});

describe('what the editor makes of a Publish’s answer', () => {
  it('reloads only for a redirect it was not let follow, and keeps what it holds for any answer not its own (B-15)', () => {
    expect(answerKind({ type: 'opaqueredirect', contentType: null })).toBe('session_ended');
    expect(answerKind({ type: 'basic', contentType: 'application/json' })).toBe('answer');
    // A gateway's error page, and the route handler's 500 when the API can't be reached.
    expect(answerKind({ type: 'basic', contentType: 'text/html; charset=utf-8' })).toBe('unknown');
    expect(answerKind({ type: 'basic', contentType: null })).toBe('unknown');
  });

  it('says a copy refused id_taken as one the note type has now, or held before, and asks for nothing it can’t do (B-3)', () => {
    const sections = definition.sections;
    expect(copyTakenWords(sections, 'needs')).toBe(ID_TAKEN.now);
    expect(copyTakenWords(sections, 'water')).toBe(ID_TAKEN.before);
    expect(ID_TAKEN.now).toBe('This note type already has this section, so it can’t be copied in again.');
    expect(ID_TAKEN.before).toBe(
      'This note type has held this section, or parts of it, before, so it can’t be copied in again.',
    );
    for (const words of Object.values(ID_TAKEN)) expect(words).not.toMatch(/Show the old one again/);
  });

  it('says the version now live after a Publish whose answer was lost, which may be its own (B-2)', () => {
    expect(liveAfterDrop(4)).toBe(
      'Version 4 is live now. It may be the Publish whose answer was lost on the way, or someone else’s. Load it to see which before you publish again.',
    );
  });
});
