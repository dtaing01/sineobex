import {
  handoffLines,
  NoteReading,
  type Answers,
  type HandoffLine,
  type ResolvedNoteType,
} from '@sineobex/forms';
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { ApiError, forbidden, notFound } from '../lib/errors.ts';
import { loadChart } from '../patients/charts.ts';
import type { BirthValue } from '../patients/matching.ts';
import { ageYears } from '../patients/projection.ts';
import { SENSITIVE_CODE_RANGES } from '../patients/generated/sensitive-codes.ts';
import { loadEncounter } from '../sync/entities/encounter.ts';
import { noteRules, noteTypeOf } from '../sync/entities/note.ts';
import { byDefinition, DefinitionError, type StoredRecord } from '../sync/records.ts';
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
 * name that names no patient.
 *
 * PLAN-OPEN: what of the patient does the handoff's header carry (forms 10.1 #6; for the clinical
 * team and counsel, to be added to lifecycle 12.1)? Their preferred name, their age in years and
 * their allergies, from the chart as the reader may see it, as the summary EMS is shown does; never
 * the legal name or the birth date.
 *
 * Each note that holds something is in it, drafts too, each marked with its state: a draft, complete,
 * signed, or attested.
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

/**
 * Whether the runtime knows [zone] as an IANA time zone. The portal sends the reader's; the server
 * prints the file's times in it.
 */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
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
  timeZone?: string,
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
    const exportedAt = scope.deps.now();
    const zone = timeZone ?? null;
    const pdf = await handoffPdf({
      patient: visit.patientId
        ? await patientHeader(tx, scope, visit.patientId, dayIn(exportedAt, zone))
        : null,
      notes: reads.map((r) => ({ title: r.type.title, state: stateOf(r.note) })),
      lines,
      startedAt: visit.attributes.startedAt as string,
      clockVerified: visit.attributes.clockVerified as boolean,
      exportedBy: scope.principal.displayName,
      exportedAt,
      timeZone: zone,
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

/** A note's state as the file marks it. */
export type HandoffNoteState = 'draft' | 'complete' | 'signed' | 'attested';

function stateOf(note: StoredRecord): HandoffNoteState {
  if (note.status === 'draft') return 'draft';
  if (note.status === 'completed') return 'complete';
  return note.attributes.attestation === 'attested' ? 'attested' : 'signed';
}

/** Who the handoff is about, as its header says: never the legal name or the birth date. */
export interface HandoffPatient {
  /** Null when the chart holds none. */
  preferredName: string | null;
  /** "Age 52", "Age about 46", or "Age not recorded". */
  age: string;
  /** "Allergies: Demo: latex (severe), Demo: peanuts", "No known allergies" or "Allergies not asked yet". */
  allergies: string;
}

/**
 * The header's patient from their chart as the reader may see it (loadChart: the merged group's,
 * projected for the reader), worked out on [today] in the reader's time zone. The export's event is
 * the read: it names the patient.
 */
async function patientHeader(tx: Tx, scope: TeamScope, patientId: string, today: string) {
  const chart = await loadChart(tx, scope, patientId, { linkUrls: false });
  if (!chart) return null;
  const field = (name: string) => chart.patient.fields[name]?.value;
  const birth = (field('birth') ?? null) as BirthValue | null;
  const years = ageYears(birth, today);
  const allergies = chart.allergies
    .filter((a) => a.status !== 'entered_in_error')
    .map((a) => ({
      substance: a.attributes.substance as string,
      severe: a.attributes.severity === 'severe',
    }));
  // As the phone's allergy badge words it (display.dart): severe first, and the badge's three states.
  const listed = [...allergies.filter((a) => a.severe), ...allergies.filter((a) => !a.severe)];
  return {
    preferredName: (field('preferredName') as string | null | undefined) ?? null,
    age:
      years === null
        ? 'Age not recorded'
        : birth?.precision === 'day'
          ? `Age ${years}`
          : `Age about ${years}`,
    allergies:
      listed.length > 0
        ? `${listed.length === 1 ? 'Allergy' : 'Allergies'}: ${listed
            .map((a) => (a.severe ? `${a.substance} (severe)` : a.substance))
            .join(', ')}`
        : field('allergyScreen') === 'none_known'
          ? 'No known allergies'
          : 'Allergies not asked yet',
  };
}

// ------------------------------------------------------------------------------------------------
// The file
// ------------------------------------------------------------------------------------------------

export interface HandoffPdfInput {
  /** Who it is about; null for a visit with no patient. */
  patient: HandoffPatient | null;
  /** Each note's title and state, by its place in the lists handoffLines was given. */
  notes: readonly { title: string; state: HandoffNoteState }[];
  lines: readonly HandoffLine[];
  /** The visit's start, an ISO time. */
  startedAt: string;
  clockVerified: boolean;
  /** Who exported it and when: stamped on every page (PRD main 602). */
  exportedBy: string;
  exportedAt: Date;
  /** The reader's IANA time zone, which the file's times are printed in; UTC when null. */
  timeZone: string | null;
}

// A4, in points.
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 50;
const FOOTER_Y = 30;
const BOTTOM = 60;
const SIZE = { title: 18, heading: 13, note: 11, text: 10, stamp: 8 };
const LEADING = 1.35;

// PLAN-OPEN: the time zone of the handoff's times (to be added to lifecycle 12.1). The reader's, as
// the portal sends it; without one, UTC. A team's own time zone can come with routes (phase 7).

/** [at]'s date and time in [zone], or in UTC; the zone named after it, so the file says which. */
function zoned(at: Date | string, zone: string | null): { day: string; time: string; label: string } {
  const d = typeof at === 'string' ? new Date(at) : at;
  if (zone === null) {
    const iso = d.toISOString();
    return { day: iso.slice(0, 10), time: iso.slice(11, 16), label: 'UTC' };
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    label: zone,
  };
}

/** A time as the file writes it: "2026-10-20 10:40 America/Detroit", or "… UTC". */
const stamped = (at: Date | string, zone: string | null) => {
  const z = zoned(at, zone);
  return `${z.day} ${z.time} ${z.label}`;
};

/** Today's date where the reader is, for the patient's age. */
const dayIn = (at: Date, zone: string | null) => zoned(at, zone).day;

const STATE_LABEL: Record<HandoffNoteState, string> = {
  draft: 'draft',
  complete: 'complete',
  signed: 'signed',
  attested: 'signed and attested',
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
  if (input.patient) {
    write(input.patient.preferredName ?? 'No preferred name recorded', bold, SIZE.heading, 0, 4);
    write(input.patient.age, regular, SIZE.text);
    write(input.patient.allergies, regular, SIZE.text);
  } else write('No patient recorded for this visit', bold, SIZE.heading, 0, 4);
  write(
    `Visit started ${stamped(input.startedAt, input.timeZone)}${input.clockVerified ? '' : ' (phone clock, not verified)'}`,
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
        const n = input.notes[note];
        write(n ? `${n.title} (${STATE_LABEL[n.state]})` : '', bold, SIZE.note, 0, 8);
      }
      write(`${line.label}: ${line.value}`, regular, SIZE.text, 12);
    }
  };
  part('field', null);
  part('recap', 'Recap');
  if (input.lines.length === 0) write('Nothing to hand over.', regular, SIZE.text, 0, 8);

  const stamp = `Exported by ${input.exportedBy} on ${stamped(input.exportedAt, input.timeZone)}`;
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
