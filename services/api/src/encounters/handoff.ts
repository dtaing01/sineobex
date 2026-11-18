import {
  handoffLines,
  NoteReading,
  type Answers,
  type HandoffLine,
  type ResolvedNoteType,
} from '@sineobex/forms';
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { TeamScope } from '../auth/context.ts';
import { ApiError, forbidden, notFound } from '../lib/errors.ts';
import { SENSITIVE_CODE_RANGES } from '../patients/generated/sensitive-codes.ts';
import { loadEncounter } from '../sync/entities/encounter.ts';
import { noteRules, noteTypeOf } from '../sync/entities/note.ts';
import { byDefinition, DefinitionError } from '../sync/records.ts';
import { noteAsRead, type NoteRead } from './read.ts';
import { noteIsEmpty } from './rules.ts';

/**
 * The EMS handoff as a PDF (lifecycle 5.7): the summary the phone shows the medic full-screen
 * (9.8), built here from the same lines.
 *
 * PLAN-OPEN: where does the EMS handoff PDF come from (lifecycle 12.1 #12)? The portal, through
 * this route: a file made on the phone would have to leave through a share sheet, which the PRD
 * rules out (PRD main 413). The phone shows the summary full-screen only.
 *
 * Each note goes through visibleAnswers for the reader (noteAsRead, as the visit read does) before
 * handoffLines reads it, with phase 3's sensitive list, so no treatment record, sensitive exam or
 * sensitive diagnosis reaches EMS for any reader, and no reader is handed a note they may not open.
 *
 * A file leaves our control, so the PRD's rule for exports holds (PRD main 602): a recent sign-in
 * (the route asks for it), every page stamped with who exported it and when, no caching and a file
 * name that names no patient. The patient's name, age and allergies are not in it: they are the
 * chart's, and the summary is its lines alone (forms 10.1 #6).
 */

/** The file's name: the same for every visit, so it names no patient (10.2). */
export const HANDOFF_FILE_NAME = 'ems-handoff.pdf';

/** The Red flags and disposition note, added by itself to a Medical visit (forms 6.2). */
const isRedFlags = (type: ResolvedNoteType | undefined) => type?.auto === 'medical';

/**
 * Whether a note offers the handoff: a `show_handoff` action of it shows, as the form offers
 * **Show handoff** once EMS is activated (9.8). Read from the answers the reader may see.
 */
export function offersHandoff(type: ResolvedNoteType, answers: Answers): boolean {
  const reading = new NoteReading(type, answers);
  return reading.model.nodes.some(
    (node) =>
      node.field.kind === 'action' &&
      node.field.action === 'show_handoff' &&
      (node.section.section.repeat
        ? reading.entries(node.section).some((entry) => reading.fieldCounts(node, null, entry))
        : reading.fieldCounts(node, null, null)),
  );
}

const noHandoff = () =>
  new ApiError(404, 'no_handoff', 'This visit has no EMS handoff: EMS was not activated in it.');

/**
 * GET /v1/encounters/{encounterId}/ems-handoff.
 *
 * PLAN-OPEN: who may export the EMS handoff as a PDF (lifecycle 12.1 #18)? PRD main 413 lets a
 * clinician; PRD main 602 keeps exports to Admin and Billing/Data. Default: whoever may read the
 * visit's Red flags note, with a fresh sign-in, a stamp of who and when, and an audit event.
 *
 * A reader who may not is refused (403 cannot_see_red_flags) and the refusal is logged with its
 * name. A visit with no Red flags note, or whose Red flags note the reader reads offers no
 * handoff, is 404 no_handoff.
 *
 * The export is logged as one `ems_handoff.exported` on the visit, with its patient and the notes
 * it read (`noteIds`): the name the phone's `ems_handoff.shown` has, on the same entity (10.1). The
 * file is made inside the transaction, so an event is written only for a file that was made.
 */
export async function exportHandoff(
  scope: TeamScope,
  encounterId: string,
  route: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const outcome = await scope.tx(async (tx, audit) => {
    const visit = await loadEncounter(tx, encounterId, false);
    if (!visit || visit.teamId !== scope.team.teamId) throw notFound('encounter');

    const rows = await tx<{ id: string }[]>`
      select id from sineobex.encounter_notes
      where team_id = ${visit.teamId} and encounter_id = ${visit.id} order by created_at, id`;
    let hasRedFlags = false;
    const flags: (NoteRead & { type: ResolvedNoteType })[] = [];
    const reads: (NoteRead & { type: ResolvedNoteType })[] = [];
    for (const { id } of rows) {
      const note = await noteRules.load(tx, id, false);
      if (!note) continue;
      // Whether it is the Red flags note is asked of the note, not of what the reader may see.
      let redFlags = false;
      try {
        redFlags = isRedFlags(await noteTypeOf(tx, note));
      } catch (err) {
        if (!(err instanceof DefinitionError)) throw err;
      }
      hasRedFlags ||= redFlags;
      const read = await noteAsRead(tx, scope, note);
      // A phase 2 note with no version has no definition for handoffLines to read.
      if (!read || read.type === undefined) continue;
      const typed = read as NoteRead & { type: ResolvedNoteType };
      if (redFlags) flags.push(typed);
      // An empty draft counts as not there (3.1), as on the visit read.
      if (read.note.status === 'draft' && noteIsEmpty(read.answers)) continue;
      reads.push(typed);
    }

    if (!hasRedFlags) throw noHandoff();
    if (flags.length === 0) {
      // Logged in this transaction, which writes nothing else.
      await audit({
        action: 'access.denied',
        entity: 'encounter',
        entityId: visit.id,
        patientId: visit.patientId,
        details: { reason: 'cannot_see_red_flags', route },
      });
      return { refused: true as const };
    }
    if (!flags.some((r) => byDefinition(() => offersHandoff(r.type, r.seen)))) throw noHandoff();

    const lines = byDefinition(() =>
      handoffLines(
        reads.map((r) => r.type),
        reads.map((r) => r.seen),
        SENSITIVE_CODE_RANGES,
      ),
    );
    await audit({
      action: 'ems_handoff.exported',
      entity: 'encounter',
      entityId: visit.id,
      patientId: visit.patientId,
      details: { noteIds: reads.map((r) => r.note.id), source: scope.meta.deviceId ? 'phone' : 'portal' },
    });
    const pdf = await handoffPdf({
      titles: reads.map((r) => r.type.title),
      lines,
      startedAt: visit.attributes.startedAt as string,
      clockVerified: visit.attributes.clockVerified as boolean,
      exportedBy: scope.principal.displayName,
      exportedAt: scope.deps.now(),
    });
    return { pdf };
  });
  if ('refused' in outcome)
    throw forbidden(
      'Only someone who may read the visit’s Red flags note may export its handoff.',
      'cannot_see_red_flags',
    );
  return outcome.pdf;
}

// ------------------------------------------------------------------------------------------------
// The file
// ------------------------------------------------------------------------------------------------

export interface HandoffPdfInput {
  /** Each note's title, by its place in the lists handoffLines was given. */
  titles: readonly string[];
  lines: readonly HandoffLine[];
  /** The visit's start, an ISO time. */
  startedAt: string;
  clockVerified: boolean;
  /** Who exported it and when: stamped on every page (PRD main 602). */
  exportedBy: string;
  exportedAt: Date;
}

// A4, in points.
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 50;
const FOOTER_Y = 30;
const BOTTOM = 60;
const SIZE = { title: 18, heading: 13, note: 11, text: 10, stamp: 8 };
const LEADING = 1.35;

/** A time as the stamp writes it: the server knows no time zone of the reader's, so UTC. */
const utc = (at: Date | string) => {
  const iso = typeof at === 'string' ? new Date(at).toISOString() : at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
};

/**
 * The handoff as a PDF: a title, the visit's start, the field lines under each note's title, then
 * the recap lines under each note's title (handoffLines' order), every page stamped at its foot.
 * The standard Helvetica needs no font file and no native code, so it builds in every runtime the
 * API runs in; a character it has no glyph for is drawn as a question mark rather than failing the
 * export. The metadata hold a fixed title and the export's time, nothing of the patient.
 */
export async function handoffPdf(input: HandoffPdfInput): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle('EMS handoff');
  doc.setProducer('Sineobex');
  doc.setCreator('Sineobex');
  doc.setCreationDate(input.exportedAt);
  doc.setModificationDate(input.exportedAt);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const drawable = new Set(regular.getCharacterSet());
  const clean = (text: string) =>
    Array.from(text, (ch) => (drawable.has(ch.codePointAt(0)!) ? ch : '?')).join('');

  const width = PAGE.width - 2 * MARGIN;
  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const write = (text: string, font: PDFFont, size: number, indent = 0, before = 0) => {
    for (const [i, line] of wrap(text, font, size, width - indent, clean).entries()) {
      const gap = i === 0 ? before : 0;
      // A new page starts at its top margin, with no gap above its first line.
      if (y - gap - size * LEADING < BOTTOM) {
        page = doc.addPage([PAGE.width, PAGE.height]);
        y = PAGE.height - MARGIN;
      } else y -= gap;
      y -= size;
      page.drawText(line, { x: MARGIN + indent, y, size, font });
      y -= size * (LEADING - 1);
    }
  };

  write('EMS handoff', bold, SIZE.title);
  write(
    `Visit started ${utc(input.startedAt)}${input.clockVerified ? '' : ' (phone clock, not verified)'}`,
    regular,
    SIZE.text,
    0,
    4,
  );

  const part = (kind: HandoffLine['kind'], heading: string | null) => {
    const lines = input.lines.filter((l) => l.kind === kind);
    if (lines.length === 0) return;
    if (heading) write(heading, bold, SIZE.heading, 0, 12);
    let note = -1;
    for (const line of lines) {
      if (line.note !== note) {
        note = line.note;
        write(input.titles[note] ?? '', bold, SIZE.note, 0, 8);
      }
      write(`${line.label}: ${line.value}`, regular, SIZE.text, 12);
    }
  };
  part('field', null);
  part('recap', 'Recap');
  if (input.lines.length === 0) write('Nothing to hand over.', regular, SIZE.text, 0, 8);

  const stamp = `Exported by ${input.exportedBy} on ${utc(input.exportedAt)}`;
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const count = `Page ${i + 1} of ${pages.length}`;
    p.drawText(clean(stamp), { x: MARGIN, y: FOOTER_Y, size: SIZE.stamp, font: regular });
    p.drawText(count, {
      x: PAGE.width - MARGIN - regular.widthOfTextAtSize(count, SIZE.stamp),
      y: FOOTER_Y,
      size: SIZE.stamp,
      font: regular,
    });
  });
  return new Uint8Array(await doc.save());
}

/**
 * The lines [text] takes at [size] in [width]: broken at its own line breaks, then between words,
 * and inside a word too long for a line. Each paragraph is cleaned of what the font cannot draw
 * before it is measured.
 */
function wrap(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
  clean: (s: string) => string,
): string[] {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  const out: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/).map(clean)) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line === '' ? word : `${line} ${word}`;
      if (fits(next)) {
        line = next;
        continue;
      }
      if (line !== '') out.push(line);
      line = word;
      while (!fits(line)) {
        let cut = line.length - 1;
        while (cut > 1 && !fits(line.slice(0, cut))) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}
