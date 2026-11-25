import type { NoteTypeEdit, NoteTypeField, NoteTypeOption, NoteTypeSection } from '@/lib/presets';
import { ID_TAKEN } from '@/lib/refusals';

/**
 * What the note type editor holds until Publish (phase 5 design 5.4, 8.1): each change the person
 * made, in order, as the operation the API applies and the words the editor shows it in. Nothing
 * here decides whether a change may be made (D114): the API applies the operations in order and
 * refuses one by its index. These only show what is held, where it is held.
 */
export interface HeldOp {
  /** The editor's own number for it, never sent: an Undo and a refusal find it by this. */
  id: number;
  op: NoteTypeEdit;
  /** The change in words: "Rename “Pain” to “Pain now”". */
  said: string;
}

/** An id an element can take for a path (`wound.treatment.dressing`): letters, digits, _ and -. */
export const domId = (path: string) => path.replace(/[^A-Za-z0-9_-]/g, '-');

/** “words”, in the curly quotes the copy uses. */
export const quoted = (words: string) => `“${words}”`;

/** Whether a held change is this operation. */
const is = (h: HeldOp, op: string) => h.op.op === op;

/** A value a held operation carries, by its name in the operation. */
export const valueOf = (h: HeldOp, name: string): unknown => (h.op as Record<string, unknown>)[name];

/** The title the note type will have once the held changes are published, or null when none renames it. */
export function heldTitle(held: readonly HeldOp[]): string | null {
  const last = held.filter((h) => is(h, 'rename_type')).at(-1);
  return last ? String(valueOf(last, 'title')) : null;
}

/** The held rename of a field or a section by its path or id, if any. */
export function heldRename(held: readonly HeldOp[], path: string): HeldOp | undefined {
  return held.find((h) => is(h, 'rename_label') && valueOf(h, 'path') === path);
}

/** The held hide of a field or a section by its path or id, if any. */
export function heldHide(held: readonly HeldOp[], path: string): HeldOp | undefined {
  return held.find(
    (h) => is(h, 'set_hidden') && valueOf(h, 'path') === path && valueOf(h, 'hidden') === true,
  );
}

/**
 * `held` with `next` in the place of the held op `old` (a second rename of one part replaces the
 * first where it stands, so what follows it still names what it did), or at the end.
 */
export function replaceOrAdd(held: readonly HeldOp[], old: HeldOp | undefined, next: HeldOp): HeldOp[] {
  return old ? held.map((h) => (h.id === old.id ? next : h)) : [...held, next];
}

/** An option as the editor shows it once the held changes are made. */
export interface ShownOption {
  code: string;
  label: string;
  /** The held rename of it, if any. */
  renamed?: HeldOp;
}

/**
 * The options of one choice field as they will be once the held changes for it are published: the
 * live ones in their order, each with its held rename; the ones held to be retired; and the ones
 * held to be added, which have no code until the API makes one. A move is shown where it puts the
 * option: just before the option it names, or at the end (5.4's `move_option`).
 */
export function shownOptions(
  options: readonly NoteTypeOption[],
  held: readonly HeldOp[],
  path: string,
): { live: ShownOption[]; retired: { option: NoteTypeOption; op: HeldOp }[]; added: HeldOp[] } {
  let order = options.map((o) => o.code);
  const retired: { option: NoteTypeOption; op: HeldOp }[] = [];
  const added: HeldOp[] = [];
  for (const h of held) {
    const op = h.op as Record<string, unknown>;
    if (op.path !== path) continue;
    if (is(h, 'move_option')) {
      const code = String(op.code);
      if (!order.includes(code)) continue;
      order = order.filter((c) => c !== code);
      const at = op.before === null ? order.length : order.indexOf(String(op.before));
      order.splice(at < 0 ? order.length : at, 0, code);
    } else if (is(h, 'retire_option')) {
      const option = options.find((o) => o.code === op.code);
      order = order.filter((c) => c !== op.code);
      if (option) retired.push({ option, op: h });
    } else if (is(h, 'add_option')) added.push(h);
  }
  const live = order.map((code) => {
    const option = options.find((o) => o.code === code)!;
    const renamed = held.find(
      (h) => is(h, 'rename_option') && valueOf(h, 'path') === path && valueOf(h, 'code') === code,
    );
    return { code, label: option.label, ...(renamed ? { renamed } : {}) };
  });
  return { live, retired, added };
}

/** A field's kind in words, as the editor lists it. */
const KINDS: Readonly<Record<string, string>> = {
  text: 'Text',
  number: 'Number',
  flag: 'Tick box',
  date: 'Date',
  time: 'Time',
  duration: 'Length of time',
  group: 'Group of fields',
  grid: 'Table',
  region: 'Body region',
  problem: 'Diagnosis',
  photo: 'Photo',
  action: 'Button',
  info: 'Guidance',
};

export function kindOf(field: NoteTypeField): string {
  if (field.kind === 'choice') return field.many === true ? 'Choice, several answers' : 'Choice, one answer';
  return KINDS[field.kind] ?? field.kind;
}

/** The new field an add holds, in words: "Text", "Choice, one answer". */
export function newFieldKind(field: { kind: string; many?: unknown }): string {
  return kindOf(field as NoteTypeField);
}

/**
 * What a Publish's answer is, from the response alone: a redirect the browser was not let follow
 * (`opaqueredirect`, so the session ended on the way, and the page goes to sign-in), the route
 * handler's own JSON answer, or anything else (a gateway's error page, the handler's 500 when the API
 * can't be reached), which can't say whether the version went live: the editor keeps what it holds
 * and says so, as for a dropped connection.
 */
export function answerKind(response: {
  type: string;
  contentType: string | null;
}): 'session_ended' | 'answer' | 'unknown' {
  if (response.type === 'opaqueredirect') return 'session_ended';
  return response.contentType?.includes('json') ? 'answer' : 'unknown';
}

/**
 * The words for a copy refused id_taken (design 5.4, rule 3): of a section the version opened holds,
 * that it has it already; else that it held it, or a part of it, before.
 */
export function copyTakenWords(sections: readonly Pick<NoteTypeSection, 'id'>[], sectionId: unknown): string {
  return sections.some((s) => s.id === sectionId) ? ID_TAKEN.now : ID_TAKEN.before;
}
