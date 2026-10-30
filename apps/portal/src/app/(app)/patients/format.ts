import type { Schemas } from '@sineobex/contract';
import { birthViewReadBack } from '@/lib/dob';
import { LIVING_SITUATION, PROBLEM_STATUS, quarantineValue, syncFieldLabel } from '@/lib/labels';

/**
 * Patient values as the portal's screens say them (phase 3 design 11.1, 12.2). Pure functions of
 * what the API returned: a screen never asks for more than it shows.
 */

type LegalName = { given: string | null; family: string | null };

export function legalNameText(name: LegalName | null | undefined): string | null {
  if (!name) return null;
  const text = [name.given, name.family].filter((p) => p !== null && p !== '').join(' ');
  return text || null;
}

/** What a person is called on a screen: the name they go by, else a legal name, else what they look like. */
export function displayName(parts: {
  preferredName?: string | null;
  legalName?: LegalName | null;
  visualDescriptor?: string | null;
}): string {
  return (
    parts.preferredName || legalNameText(parts.legalName) || parts.visualDescriptor || 'No name recorded'
  );
}

/** "1946", "about 1985": the year a link's name says ("Open chart: Del, born 1946"). */
export function bornYear(birth: Schemas['BirthView'] | null | undefined): string | null {
  if (!birth) return null;
  const year = birth.precision === 'day' && birth.date ? birth.date.slice(0, 4) : birth.year;
  if (year === undefined) return null;
  return birth.precision === 'estimated' ? `about ${year}` : String(year);
}

/** A calendar date (YYYY-MM-DD) as "Oct 3, 2026". The date is the same everywhere, so no time zone moves it. */
export function formatDay(date: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** A moment as the day it fell on where the team works. */
export function formatDayOf(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/Detroit' }).format(
    new Date(iso),
  );
}

export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export const ALLERGY_SCREEN: Record<Schemas['AllergyScreen'], string> = {
  not_asked: 'Not asked yet',
  none_known: 'No known allergies',
};

export const ID_CARD_CHOICE: Record<string, string> = {
  not_asked: 'Not asked yet',
  wants: 'Wants a card',
  declined: 'Declined a card',
};

export const ALLERGY_CATEGORY: Record<Schemas['AllergyCategory'], string> = {
  drug: 'Medicine',
  food: 'Food',
  environment: 'Environment',
  other: 'Other',
  unknown: 'Not known',
};

export const ALLERGY_SEVERITY: Record<Schemas['AllergySeverity'], string> = {
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
  unknown: 'Not known',
};

export const CONSENT_KIND: Record<Schemas['ConsentView']['kind'], string> = {
  care_and_record: 'Care and record keeping',
  privacy_notice: 'Privacy notice',
};

export const CONSENT_DECISION: Record<Schemas['ConsentView']['decision'], string> = {
  given: 'Given',
  unable: 'Unable to consent yet',
  acknowledged: 'Acknowledged',
  declined: 'Declined',
  not_offered: 'Not offered',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * One recorded value of a chart field in words: "Library steps", "March 7, 1946 · age 80",
 * "Unsheltered (street or outdoors)". Blank values say so.
 */
export function fieldValueText(field: string, value: unknown, today: string): string {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  switch (field) {
    case 'legalName':
      return (isRecord(value) && legalNameText(value as LegalName)) || 'Not recorded';
    case 'birth':
      return isRecord(value)
        ? birthViewReadBack(value as Schemas['BirthView'], today)
        : quarantineValue(value);
    case 'livingSituation': {
      if (!isRecord(value) || typeof value.kind !== 'string') break;
      const kind = LIVING_SITUATION[value.kind as keyof typeof LIVING_SITUATION] ?? value.kind;
      return typeof value.other === 'string' && value.other ? `${kind}: ${value.other}` : kind;
    }
    case 'preferredLanguage':
      return typeof value === 'string' ? languageName(value) : quarantineValue(value);
    case 'allergyScreen':
      return ALLERGY_SCREEN[value as Schemas['AllergyScreen']] ?? quarantineValue(value);
    case 'idCardChoice':
      return ID_CARD_CHOICE[value as string] ?? quarantineValue(value);
    case 'status':
      if (isRecord(value) && typeof value.status === 'string')
        return PROBLEM_STATUS[value.status as Schemas['ProblemStatus']] ?? value.status;
      break;
    case 'removal':
    case 'enteredInError':
      if (isRecord(value) && typeof value.reason === 'string') return `Yes: ${value.reason}`;
      break;
  }
  return quarantineValue(value);
}

/** What a history entry changed: "Usually found", "Problem status", "Street name removed". */
export function historyFieldLabel(entity: string, field: string): string {
  if (entity === 'problem' && field === 'status') return 'Problem status';
  if (entity === 'problem' && field === 'enteredInError') return 'Problem entered in error';
  if (entity === 'patient_alias' && field === 'removal') return 'Street name removed';
  if (entity === 'patient_allergy' && field === 'enteredInError') return 'Allergy entered in error';
  return syncFieldLabel(field);
}

const HOW: Record<Schemas['HistoryKind'], string> = {
  created: 'Registered',
  set: 'Edited',
  filled_blank: 'Filled in',
  replaced_after_review: 'Replaced after comparing',
  kept_both: 'Kept for review',
  confirmed: 'Confirmed',
  redirected: 'Edited on a merged record',
  corrected: 'Admin correction',
  review_decided: 'Review decision',
  merge_fill: 'Filled in by a merge',
  merge_undone: 'Merge undone',
  cleared_by_allergy: 'Cleared when an allergy was added',
  entered_in_error: 'Entered in error',
};

/**
 * How a value was recorded: "Edited on a phone", "Admin correction". A change synced from a phone
 * carries the time it was made there; decisions made online (corrections, reviews, merges) don't,
 * and their kind already says where they came from.
 */
// PLAN-OPEN: "phone, offline" (design 11.7). A history entry says when the phone made the change
// but not whether it had signal, so the portal says "on a phone" for both until the API reports it.
export function historyHow(entry: Pick<Schemas['FieldHistoryEntry'], 'kind' | 'deviceTime'>): string {
  const how = HOW[entry.kind] ?? entry.kind;
  return entry.deviceTime ? `${how} on a phone` : how;
}
