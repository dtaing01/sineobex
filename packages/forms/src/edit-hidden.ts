/**
 * What a team's note type no longer shows (phase 5 design 5.4's Show again, 8.1): each section and
 * field an earlier version had and the current one lacks, at any depth, and each answer a choice
 * field had in an earlier version and lacks now (retired, or gone with its field), each in the words
 * of the newest version that had it. The editor offers Show again for a part `set_hidden` with
 * `hidden: false` would copy back now (`showAgain`), worked out by that operation itself, so the
 * rule stays its; a part inside a hidden one comes back with it. A section or a field carries itself
 * as that version held it (`part`), so the pages can name what is inside it: a mapping on a field of
 * a hidden section, or a grid's row picked from an answer since retired (8.1's warning rows).
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import { applyNoteTypeEdit } from './edit.ts';
import type { ResolvedField, ResolvedNoteType, ResolvedSection } from './resolve.ts';

export type HiddenPart =
  | { kind: 'section'; path: string; words: string; showAgain: boolean; part: ResolvedSection }
  | { kind: 'field'; path: string; words: string; showAgain: boolean; part: ResolvedField }
  | { kind: 'option'; path: string; code: string; words: string };

type Found =
  | { kind: 'section'; path: string; words: string; part: ResolvedSection }
  | { kind: 'field'; path: string; words: string; part: ResolvedField }
  | { kind: 'option'; path: string; code: string; words: string };

/** A part's place in a definition, unique among its parts: a path holds no space. */
const placeOf = (p: Found) => (p.kind === 'option' ? `${p.path} ${p.code}` : `${p.kind} ${p.path}`);

/**
 * The sections, the fields at every depth a path names (a grid's cell has none) and the answers of
 * each choice field, in the order the definition writes them.
 */
function partsOf(definition: ResolvedNoteType): Found[] {
  const found: Found[] = [];
  const walk = (fields: readonly ResolvedField[], within: string) => {
    for (const field of fields) {
      const path = `${within}.${field.id}`;
      found.push({ kind: 'field', path, words: field.label, part: field });
      if (field.kind === 'choice')
        for (const option of field.options)
          found.push({ kind: 'option', path, code: option.code, words: option.label });
      if (field.kind === 'group') walk(field.fields, path);
    }
  };
  for (const section of definition.sections) {
    found.push({ kind: 'section', path: section.id, words: section.title, part: section });
    walk(section.fields, section.id);
  }
  return found;
}

/**
 * The parts `versions` (oldest first, the current one last) held before and the current one lacks,
 * newest first: each as the newest version that had it held it.
 */
export function hiddenParts(versions: readonly ResolvedNoteType[]): HiddenPart[] {
  const current = versions.at(-1);
  if (!current) return [];
  const now = new Set(partsOf(current).map(placeOf));
  const found = new Map<string, Found>();
  for (const version of versions.slice(0, -1).reverse())
    for (const part of partsOf(version)) {
      const place = placeOf(part);
      if (!now.has(place) && !found.has(place)) found.set(place, part);
    }
  // Read by the operation itself: what it would copy back, and from where (edit.ts's show).
  const context = { versions, team: {}, platform: {} };
  return [...found.values()].map((part) => {
    if (part.kind === 'option') return part;
    const step = applyNoteTypeEdit(current, { op: 'set_hidden', path: part.path, hidden: false }, context);
    return { ...part, showAgain: step.ok && step.definition !== current };
  });
}
