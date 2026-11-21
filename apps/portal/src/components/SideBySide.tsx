import type { Schemas } from '@sineobex/contract';
import { birthViewReadBack } from '@/lib/dob';
import { LIVING_SITUATION, PROBLEM_STATUS, syncFieldLabel } from '@/lib/labels';
import styles from './SideBySide.module.css';

type Detail = Schemas['DuplicatePairDetail'];
type Side = Schemas['PairSide'];
type Summary = Schemas['PatientSummary'];

/** Below 640 px a table with this class becomes stacked blocks; each cell needs a `data-label`. */
export const STACKED_TABLE = `px-table ${styles.stacked}`;

const TEAM_DAY = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/Detroit' });
const CALENDAR_DAY = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

/** "Oct 3, 2026", from a timestamp (in the team's time zone) or a calendar date. */
export function formatDay(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? CALENDAR_DAY.format(new Date(`${iso}T00:00:00Z`))
    : TEAM_DAY.format(new Date(iso));
}

/** The name a record goes by in a list: preferred, else legal, else the description. */
export function recordName(s: Summary): string {
  if (s.preferredName) return s.preferredName;
  const legal = s.legalName ? [s.legalName.given, s.legalName.family].filter(Boolean).join(' ') : '';
  return legal || s.visualDescriptor || 'No name recorded';
}

/** "born 1962", "born around 1980"; a list shows the year only. */
export function bornIn(s: Summary): string {
  const year = s.birth?.year ?? (s.birth?.date ? Number(s.birth.date.slice(0, 4)) : undefined);
  if (year === undefined) return 'birth not recorded';
  return s.birth?.precision === 'estimated' ? `born around ${year}` : `born ${year}`;
}

/** "Jon, born 1962": how the duplicates, merges and reversal screens name a record. */
export function who(s: Summary): string {
  return `${recordName(s)}, ${bornIn(s)}`;
}

/** When the record was made on the phone (seeded and older rows: when the server stored it). */
export function madeAt(side: Side): string {
  const registered = side.chart.patient.attributes.registeredAt;
  return typeof registered === 'string' ? registered : side.chart.patient.createdAt;
}

const HOW: Record<Side['createdHow'], string> = {
  phone_offline: ' on a phone, offline',
  phone: ' on a phone',
  unknown: '',
};

/** "made Oct 3, 2026 by Jordan Lee on a phone, offline" */
export function provenance(side: Side): string {
  return `made ${formatDay(madeAt(side))} by ${side.createdBy.displayName}${HOW[side.createdHow]}`;
}

const lines = (v: unknown): string[] => (typeof v === 'string' && v.trim() ? [v] : []);

let languages: Intl.DisplayNames | null = null;
function languageName(tag: string): string {
  try {
    languages ??= new Intl.DisplayNames(['en'], { type: 'language' });
    return languages.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

const ENCOUNTER_KIND: Record<string, string> = { medical: 'Medical visit', non_medical: 'Non-medical visit' };

/** Each patient field as lines of text; an empty list is a blank field. */
const FIELD_TEXT: Record<string, (v: unknown, today: string) => string[]> = {
  preferredName: lines,
  legalName: (v) => {
    const n = v as { given: string | null; family: string | null } | null;
    return lines(n ? [n.given, n.family].filter(Boolean).join(' ') : null);
  },
  birth: (v, today) => (v ? [birthViewReadBack(v as Schemas['BirthView'], today)] : []),
  visualDescriptor: lines,
  usualArea: lines,
  livingSituation: (v) => {
    const l = v as { kind: keyof typeof LIVING_SITUATION; other?: string } | null;
    if (!l) return [];
    return [l.other ? `${LIVING_SITUATION[l.kind]}: ${l.other}` : LIVING_SITUATION[l.kind]];
  },
  preferredLanguage: (v) => (typeof v === 'string' && v ? [languageName(v)] : []),
};

function fieldText(side: Side, field: string, today: string): string[] {
  return FIELD_TEXT[field]!(side.chart.patient.fields[field]?.value ?? null, today);
}

function aliases(side: Side): string[] {
  return side.chart.aliases
    .filter((a) => a.status === 'active')
    .map((a) => String(a.attributes.alias))
    .sort((x, y) => x.localeCompare(y));
}

function allergies(side: Side): string[] {
  const active = side.chart.allergies.filter((a) => a.status === 'active');
  if (active.length > 0) {
    return active.map((a) => {
      const severity = a.attributes.severity;
      const what = String(a.attributes.substance);
      return typeof severity === 'string' && severity !== 'unknown' ? `${what} (${severity})` : what;
    });
  }
  return side.chart.patient.fields.allergyScreen?.value === 'none_known' ? ['No known allergies'] : [];
}

function problems(side: Side): string[] | null {
  if (!side.chart.problems) return null;
  return side.chart.problems
    .filter((p) => !p.attributes.mergedInto && !p.fields.enteredInError?.value)
    .map((p) => {
      const status = (p.fields.status?.value as { status?: Schemas['ProblemStatus'] } | null)?.status;
      return `${String(p.attributes.title)}${status ? ` (${PROBLEM_STATUS[status]})` : ''}`;
    });
}

function idCards(side: Side): string[] {
  if (side.chart.idLinks.length > 0) {
    return side.chart.idLinks.map(
      (l) => `Card made ${formatDay(l.effectiveAt)}${l.madeOffline ? ' on a phone, offline' : ''}`,
    );
  }
  const choice = side.chart.patient.fields.idCardChoice?.value;
  if (choice === 'wants') return ['No card yet; wants one'];
  if (choice === 'declined') return ['Declined a card'];
  return [];
}

interface Row {
  label: string;
  a: string[];
  b: string[];
  /** Shown for a blank side. */
  blank: string;
  /** The server's comparison, for the fields a merge reconciles. */
  same?: boolean;
}

/** Every row of the pair page, in the order of design 8.3. */
function rows(detail: Detail, today: string): Row[] {
  const { a, b } = detail;
  const compared = new Map(detail.compared.map((c) => [c.field, c.same]));
  const field = (name: string): Row | null => {
    const shown = name in a.chart.patient.fields || name in b.chart.patient.fields;
    return shown
      ? {
          label: syncFieldLabel(name),
          a: fieldText(a, name, today),
          b: fieldText(b, name, today),
          blank: 'Not recorded',
          same: compared.get(name),
        }
      : null;
  };
  const problemsA = problems(a);
  const problemsB = problems(b);
  const lastSeen = (s: Summary) => (s.lastSeenOn ? [formatDay(s.lastSeenOn)] : []);
  const encounters = (s: Side) =>
    s.recentEncounters.map((e) => `${formatDay(e.startedAt)} · ${ENCOUNTER_KIND[e.kind] ?? e.kind}`);
  return [
    // Photos arrive in phase 8.
    { label: 'Photo', a: [], b: [], blank: 'No photo yet' },
    field('preferredName'),
    field('legalName'),
    { label: 'Also known as', a: aliases(a), b: aliases(b), blank: 'None recorded' },
    field('birth'),
    field('visualDescriptor'),
    field('usualArea'),
    field('livingSituation'),
    field('preferredLanguage'),
    { label: 'Allergies', a: allergies(a), b: allergies(b), blank: 'Not asked yet' },
    problemsA && problemsB ? { label: 'Problems', a: problemsA, b: problemsB, blank: 'None listed' } : null,
    { label: 'ID card', a: idCards(a), b: idCards(b), blank: 'No card' },
    {
      label: 'Last seen',
      a: lastSeen(detail.pair.a.summary),
      b: lastSeen(detail.pair.b.summary),
      blank: 'Not recorded',
    },
    {
      label: 'Recent encounters',
      a: encounters(a),
      b: encounters(b),
      blank: 'No encounters yet',
    },
  ].filter((r): r is Row => r !== null);
}

const normalized = (xs: string[]) =>
  xs
    .map((x) => x.trim().toLowerCase())
    .sort()
    .join('\n');

/** Same or Differs, in words (WCAG 1.4.1: never colour or an icon alone). */
function comparison(row: Row): string {
  if (row.a.length === 0 && row.b.length === 0) return 'Both blank';
  const same = row.same ?? normalized(row.a) === normalized(row.b);
  return same ? 'Same' : 'Differs';
}

function Cell({ values, blank, label }: { values: string[]; blank: string; label: string }) {
  return (
    <td data-label={label}>
      {values.length === 0 ? (
        blank
      ) : values.length === 1 ? (
        values[0]
      ) : (
        <ul className={styles.lines}>
          {values.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      )}
    </td>
  );
}

/**
 * Both records of a possible duplicate, field by field (design 8.3, 12.2): a captioned table with
 * a row header per field and Same or Differs in words in its own column. The values come from the
 * charts as the reviewer's role may see them.
 */
export function SideBySide({ detail, today }: { detail: Detail; today: string }) {
  return (
    <>
      <ul className={`px-list ${styles.provenance}`}>
        <li>Record A was {provenance(detail.a)}.</li>
        <li>Record B was {provenance(detail.b)}.</li>
      </ul>
      <table className={STACKED_TABLE}>
        <caption>Two records that may be the same person</caption>
        <thead>
          <tr>
            <th scope="col">Detail</th>
            <th scope="col">Record A, {provenance(detail.a)}</th>
            <th scope="col">Record B, {provenance(detail.b)}</th>
            <th scope="col">Same or different</th>
          </tr>
        </thead>
        <tbody>
          {rows(detail, today).map((row) => {
            const compared = comparison(row);
            return (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <Cell values={row.a} blank={row.blank} label="Record A" />
                <Cell values={row.b} blank={row.blank} label="Record B" />
                <td data-label="Compared">{compared === 'Differs' ? <strong>Differs</strong> : compared}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/**
 * What a merge keeping `kept` would do, in the confirmation's words (design 8.4, 12.2): differing
 * fields open reviews, blanks are filled, and every ID card keeps opening the kept chart (D39).
 */
export function mergeConsequences(detail: Detail, keptId: string): string[] {
  const keptIsA = keptId === detail.pair.a.patientId;
  const kept = keptIsA ? detail.a : detail.b;
  const other = keptIsA ? detail.b : detail.a;
  const value = (s: Side, f: string) => s.chart.patient.fields[f]?.value;
  const blank = (v: unknown) => v === null || v === undefined || v === '' || v === 'not_asked';
  const reviews: string[] = [];
  const fills: string[] = [];
  for (const { field, same } of detail.compared) {
    if (same || !(field in kept.chart.patient.fields || field in other.chart.patient.fields)) continue;
    const k = value(kept, field);
    const o = value(other, field);
    if (blank(o)) continue;
    (blank(k) ? fills : reviews).push(syncFieldLabel(field));
  }
  const out: string[] = [];
  out.push(
    reviews.length === 0
      ? 'No field differs, so no review opens.'
      : `${reviews.length} ${reviews.length === 1 ? 'field differs and opens a review' : 'fields differ and open reviews'} on the kept chart (${reviews.join(', ')}). Nothing is overwritten.`,
  );
  if (fills.length > 0) {
    out.push(`Blank on the kept chart, so filled from the other record: ${fills.join(', ')}.`);
  }
  out.push(
    'The other record’s ID will point to the kept chart; its street names, allergies, problems and encounters show there.',
  );
  const cards = kept.chart.idLinks.length + other.chart.idLinks.length;
  if (kept.chart.idLinks.length > 0 && other.chart.idLinks.length > 0) {
    out.push('Both ID cards keep opening the kept chart until a new card is made.');
  } else if (cards > 0) {
    out.push('The ID card keeps opening the kept chart.');
  }
  return out;
}
