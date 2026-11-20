import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssignForm } from './AssignForm';

// Assign's block as the visit page first draws it (lifecycle 5.5, 9.12). An end-to-end test can't
// draw an empty list on the seeded team: its Program Admin is an attending who reads everything, so
// they may take any note, and only a platform owner outside the team could change that (review
// finding PAX-6).
const NOTE = '5eed2100-0000-4000-8000-000000000001';
const VISIT = '5eed2000-0000-4000-8000-000000000001';

describe('Assign with nobody on the team who may take the note', () => {
  it('says so, says why from the note’s type, and offers no picker and no button', () => {
    const html = renderToStaticMarkup(
      createElement(AssignForm, { encounterId: VISIT, noteId: NOTE, options: [] }),
    );
    expect(html).toContain('<h3 class="px-h3">Assign this note</h3>');
    expect(html).toContain(
      'Nobody on the team may take this note now. It needs an active clinician with the same or a higher credential, whose role can see everything a note of its type can hold.',
    );
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
  });
});
