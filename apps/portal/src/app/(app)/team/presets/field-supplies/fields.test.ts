import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AnswerTest, NoteTypeDefinition } from '@/lib/presets';
import { answerChoices, choiceOf, describeAnswer, placeAt, placesOf, type Holds } from './fields';

// Where a field supply mapping may fire, as the page reads it from a note type's definition (phase 5
// design 4.4, 8.1): each field and grid cell by the path a mapping writes, in the note type's words,
// and the answers the forms offer there. Every name below is made up; the last cases read the
// released note types and Sineobex's own mappings, which the page must name and offer as they are.

const repo = (path: string) => new URL(`../../../../../../../../${path}`, import.meta.url);

const options = (...codes: string[]) => codes.map((code) => ({ code, label: `Demo: ${code}` }));

const DEFINITION: NoteTypeDefinition = {
  key: 't_000000000001',
  version: 3,
  title: 'Demo: Street care',
  kinds: ['medical'],
  group: 'clinical',
  sensitivity: 'none',
  sections: [
    {
      id: 'care',
      title: 'Demo: Care',
      repeat: { label: 'Demo: Wound' },
      fields: [
        { id: 'given', kind: 'choice', label: 'Demo: Given', many: true, options: options('gauze', 'tape') },
        { id: 'kind', kind: 'choice', label: 'Demo: Kind', many: false, options: options('small', 'large') },
        {
          id: 'size',
          kind: 'group',
          label: 'Demo: Size',
          fields: [
            { id: 'length', kind: 'number', label: 'Demo: Length', unit: 'cm' },
            { id: 'unable', kind: 'flag', label: 'Demo: Unable to measure' },
          ],
        },
        { id: 'where', kind: 'region', label: 'Demo: Where', options: options('arm') },
        { id: 'pulse', kind: 'choice', label: 'Demo: Pulse', sides: true, options: options('normal') },
        { id: 'notes', kind: 'text', label: 'Demo: Notes' },
        { id: 'photos', kind: 'photo', label: 'Demo: Photos' },
        { id: 'at', kind: 'time', label: 'Demo: At' },
      ],
    },
    {
      id: 'shots',
      title: 'Demo: Shots',
      fields: [
        {
          id: 'offered',
          kind: 'choice',
          label: 'Demo: Offered',
          many: true,
          options: options('flu', 'tdap'),
        },
        {
          id: 'status',
          kind: 'grid',
          label: 'Demo: Status',
          rows: { pickedIn: 'shots.offered' },
          cell: {
            id: 'is',
            kind: 'choice',
            label: 'Demo: Is',
            many: false,
            options: options('given', 'declined'),
          },
        },
        {
          id: 'lots',
          kind: 'grid',
          label: 'Demo: Lots',
          rows: options('left_arm'),
          cell: {
            id: 'lot',
            kind: 'group',
            label: 'Demo: Lot',
            fields: [
              { id: 'number', kind: 'text', label: 'Demo: Lot number' },
              { id: 'doses', kind: 'number', label: 'Demo: Doses' },
            ],
          },
        },
        {
          id: 'reflexes',
          kind: 'grid',
          label: 'Demo: Reflexes',
          sides: true,
          rows: options('knee'),
          cell: { id: 'grade', kind: 'choice', label: 'Demo: Grade', many: false, options: options('two') },
        },
      ],
    },
  ],
};

describe('where a mapping may fire', () => {
  it('names each field and grid cell by the path a mapping writes, in the order the note shows them', () => {
    expect(placesOf(DEFINITION).map((p) => [p.path, p.section, p.label, p.holds?.type ?? null])).toEqual([
      ['care.given', 'Demo: Care', 'Demo: Given', 'choice'],
      ['care.kind', 'Demo: Care', 'Demo: Kind', 'choice'],
      ['care.size.length', 'Demo: Care', 'Demo: Size: Demo: Length', 'number'],
      ['care.size.unable', 'Demo: Care', 'Demo: Size: Demo: Unable to measure', 'tick'],
      // A region, a field with sides, a photo and a time hold no one answer a mapping fires on.
      ['care.where', 'Demo: Care', 'Demo: Where', null],
      ['care.pulse', 'Demo: Care', 'Demo: Pulse', null],
      ['care.notes', 'Demo: Care', 'Demo: Notes', 'any'],
      ['care.photos', 'Demo: Care', 'Demo: Photos', null],
      ['care.at', 'Demo: Care', 'Demo: At', null],
      ['shots.offered', 'Demo: Shots', 'Demo: Offered', 'choice'],
      // A grid's rows picked in another field are that field's options; a cell has no part of its own.
      ['shots.status.flu', 'Demo: Shots', 'Demo: Status: Demo: flu', 'choice'],
      ['shots.status.tdap', 'Demo: Shots', 'Demo: Status: Demo: tdap', 'choice'],
      // A group cell's fields, each in the row.
      ['shots.lots.left_arm.number', 'Demo: Shots', 'Demo: Lots: Demo: left_arm: Demo: Lot number', 'any'],
      ['shots.lots.left_arm.doses', 'Demo: Shots', 'Demo: Lots: Demo: left_arm: Demo: Doses', 'number'],
      // A grid with sides holds each cell's answer by side.
      ['shots.reflexes.knee', 'Demo: Shots', 'Demo: Reflexes: Demo: knee', null],
    ]);
  });

  it('finds a mapping’s path, and none for a field the version no longer has', () => {
    expect(placeAt(DEFINITION, 'shots.status.flu')?.holds).toEqual({
      type: 'choice',
      many: false,
      options: options('given', 'declined'),
    });
    expect(placeAt(DEFINITION, 'care.size.length')?.holds).toEqual({ type: 'number', unit: 'cm' });
    for (const gone of ['care.pads', 'shots.status.hpv', 'care.size', 'shots.status', 'nowhere.given'])
      expect(placeAt(DEFINITION, gone), gone).toBeNull();
  });
});

describe('the answer a mapping fires on', () => {
  const holds = (path: string) => placeAt(DEFINITION, path)!.holds;
  const offered = (path: string, current?: AnswerTest) =>
    answerChoices(holds(path), current).map((c) => [c.kind, c.value, c.label]);

  it('offers any answer, then a choose-one’s options as the answer and a choose-many’s as among others', () => {
    expect(offered('care.kind')).toEqual([
      ['answered', '', 'Any answer'],
      ['equals', 'small', 'Demo: small'],
      ['equals', 'large', 'Demo: large'],
    ]);
    expect(offered('care.given')).toEqual([
      ['answered', '', 'Any answer'],
      ['includes', 'gauze', 'Demo: gauze'],
      ['includes', 'tape', 'Demo: tape'],
    ]);
  });

  it('offers a tick as ticked, and a number, a text and the like as any answer', () => {
    expect(offered('care.size.unable')).toEqual([['answered', '', 'Ticked']]);
    expect(offered('care.size.length')).toEqual([['answered', '', 'Any answer']]);
    expect(offered('care.notes')).toEqual([['answered', '', 'Any answer']]);
  });

  it('keeps the answer a mapping holds when it is none of those, so a save that leaves it alone keeps it', () => {
    expect(offered('care.given', { equals: 'gauze' }).at(-1)).toEqual([
      'equals',
      'gauze',
      'Only “Demo: gauze”',
    ]);
    expect(offered('care.kind', { includes: 'small' }).at(-1)).toEqual(['includes', 'small', 'Demo: small']);
    expect(offered('care.given', { includes: 'film' }).at(-1)).toEqual(['includes', 'film', 'film']);
    expect(offered('care.size.length', { equals: 4.5 }).at(-1)).toEqual(['equals', '4.5', 'Is 4.5 cm']);
    // A tick stores true alone: ticked either way is its one answer, as the mapping holds it.
    expect(offered('care.size.unable', { equals: true })).toEqual([['equals', 'true', 'Ticked']]);
    // One the form offers is not offered twice.
    expect(offered('care.given', { includes: 'tape' })).toHaveLength(3);
  });

  it('says each answer as the page’s facts show it', () => {
    const say = (when: AnswerTest, h: Holds | null) => describeAnswer(when, h);
    expect(say({ answered: true }, holds('care.given'))).toBe('Any answer');
    expect(say({ answered: true }, holds('care.size.unable'))).toBe('Ticked');
    expect(say({ includes: 'gauze' }, holds('care.given'))).toBe('Demo: gauze');
    expect(say({ equals: 'large' }, holds('care.kind'))).toBe('Demo: large');
    expect(say({ equals: true }, null)).toBe('Ticked');
    expect(say({ equals: 12 }, null)).toBe('Is 12');
    expect(choiceOf({ equals: 12 })).toEqual({ kind: 'equals', value: '12' });
    expect(choiceOf({ answered: true })).toEqual({ kind: 'answered', value: '' });
  });
});

describe('Sineobex’s own mappings, on the released note types', () => {
  type Released = { key: string; definition: NoteTypeDefinition };
  type Platform = {
    kind: string;
    body: { name: string; noteTypeKey: string; path?: string; when?: AnswerTest };
  };
  const released = JSON.parse(
    readFileSync(repo('packages/forms/generated/presets.json'), 'utf8'),
  ) as Released[];
  const platform = JSON.parse(
    readFileSync(repo('packages/presets/data/platform.json'), 'utf8'),
  ) as Platform[];
  const maps = platform.filter((p) => p.kind === 'field_supply_map');
  const definitionOf = (key: string) => released.find((r) => r.key === key)!.definition;

  it('are each found at a field the page offers, with their own answer among the ones it offers there', () => {
    expect(maps.length).toBeGreaterThan(0);
    for (const { body } of maps) {
      const place = placeAt(definitionOf(body.noteTypeKey), body.path!);
      expect(place?.holds, body.name).not.toBeNull();
      const now = choiceOf(body.when!);
      expect(
        answerChoices(place!.holds).some((c) => c.kind === now.kind && c.value === now.value),
        body.name,
      ).toBe(true);
    }
  });

  it('are offered on every released note type with a field, and no path is offered twice', () => {
    for (const { key, definition } of released) {
      const paths = placesOf(definition).map((p) => p.path);
      expect(new Set(paths).size, key).toBe(paths.length);
      expect(paths.length, key).toBeGreaterThan(0);
    }
  });
});
