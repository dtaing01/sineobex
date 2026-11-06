'use server';

import type { Schemas } from '@sineobex/contract';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bornYear, displayName, formatDay, legalNameText } from '@/app/(app)/patients/format';
import { api, PortalApiError, unwrap } from '@/lib/api';
import { birthViewReadBack, parseBirth, teamToday, type BirthMode } from '@/lib/dob';
import { formValues, type ActionState } from '@/lib/forms';
import { ID_LINK_REASON, matchReasons } from '@/lib/labels';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(err: unknown, values: Record<string, string>): ActionState {
  if (!(err instanceof PortalApiError)) throw err;
  const fieldErrors: Record<string, string> = {};
  for (const f of (err.details?.fields ?? []) as { path: string }[]) {
    if (f.path.endsWith('reason')) fieldErrors.reason = 'Give a reason of at least 3 characters.';
    if (f.path === 'value.given' || f.path === 'value.family' || f.path === 'value')
      fieldErrors.given = 'Each part of the name is 1 to 80 characters.';
  }
  return { error: err.message, fieldErrors, values };
}

// ------------------------------------------------------------------------------------------------
// Search (design 12.2): a POST, so names and birth dates never reach the address bar or history
// ------------------------------------------------------------------------------------------------

/** One result as the table shows it, and nothing more: the browser gets only what is on screen. */
export interface SearchRow {
  patientId: string;
  name: string;
  legalName: string | null;
  descriptor: string | null;
  /** ", born 1946": the link reads "Open chart: Del, born 1946". */
  bornSuffix: string;
  aliases: string;
  born: string;
  usualArea: string;
  lastSeen: string;
  why: string;
}

export interface SearchState extends ActionState {
  rows?: SearchRow[];
}

const BAND: Record<Schemas['MatchBand'], string> = {
  likely: 'Likely',
  possible: 'Possible',
  weak: 'Weak match',
};

// The API's default. Past it the screen asks for more letters or a birth year, never a next page.
const SEARCH_LIMIT = 20;

function searchRow(hit: Schemas['PatientHit'], today: string): SearchRow {
  const s = hit.summary;
  const name = displayName(s);
  const legal = legalNameText(s.legalName);
  const year = bornYear(s.birth);
  return {
    patientId: hit.patientId,
    name,
    legalName: legal && legal !== name ? legal : null,
    descriptor: s.visualDescriptor && s.visualDescriptor !== name ? s.visualDescriptor : null,
    bornSuffix: year ? `, born ${year}` : '',
    aliases: s.aliases?.length ? s.aliases.join(', ') : 'None',
    born: s.birth ? birthViewReadBack(s.birth, today) : 'Not recorded',
    usualArea: s.usualArea || 'Not recorded',
    lastSeen: s.lastSeenOn ? formatDay(s.lastSeenOn) : 'Not recorded',
    why: `${BAND[hit.band]}: ${matchReasons(hit.reasons)}`,
  };
}

const whole = (text: string) => (/^\d+$/.test(text) ? Number(text) : Number.NaN);

/**
 * Finds patients by a name, street name or description, a birth date, or both. Called by the
 * search form with the form only, so earlier results never travel back to the server.
 */
export async function searchPatients(form: FormData): Promise<SearchState> {
  const values = formValues(form, 'name', 'month', 'day', 'year');
  const name = (values.name ?? '').trim();
  const monthText = (values.month ?? '').trim();
  const dayText = (values.day ?? '').trim();
  const yearText = (values.year ?? '').trim();
  const fieldErrors: Record<string, string> = {};
  const today = teamToday();
  const thisYear = Number(today.slice(0, 4));
  const year = whole(yearText);
  const month = whole(monthText);
  const day = whole(dayText);
  if (yearText && (yearText.length !== 4 || year < 1900 || year > thisYear))
    fieldErrors.year = 'Type the year with 4 digits, for example 1946.';
  if (monthText && !(month >= 1 && month <= 12)) fieldErrors.month = 'The month is a number from 1 to 12.';
  if (dayText && !(day >= 1 && day <= 31)) fieldErrors.day = 'The day is a number from 1 to 31.';
  if (!fieldErrors.month && !fieldErrors.day && !fieldErrors.year) {
    if (dayText && !monthText) fieldErrors.month = 'Add the month, or leave the day out.';
    else if (monthText && !yearText) fieldErrors.year = 'Add the year, or leave the month out.';
    else if (dayText && new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day)
      fieldErrors.day = 'That month doesn’t have that many days.';
  }
  const fullDate = !!(yearText && monthText && dayText);
  if (!name && !fullDate && Object.keys(fieldErrors).length === 0) {
    // A year or a month alone never browses the list (design 3.1).
    fieldErrors.name = yearText
      ? 'Add a name with the birth year, or give the full date of birth.'
      : 'Type a name, street name or description, or a full date of birth.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Check the search.', fieldErrors, values };
  }
  try {
    const result = await unwrap(
      (await api()).POST('/v1/patients/search', {
        body: {
          ...(name ? { name } : {}),
          ...(yearText
            ? { birth: { year, ...(monthText ? { month } : {}), ...(dayText ? { day } : {}) } }
            : {}),
          limit: SEARCH_LIMIT,
          surface: 'portal',
        },
      }),
    );
    const count = result.hits.length;
    const message =
      count === 0
        ? 'No one found. Try part of a name, a street name, or the full date of birth.'
        : `${count} ${count === 1 ? 'person' : 'people'} found` +
          (result.truncated ? '. More matched than these: add more letters or a birth year.' : '.');
    return { ok: true, message, values, rows: result.hits.map((h) => searchRow(h, today)) };
  } catch (err) {
    return failure(err, values);
  }
}

// ------------------------------------------------------------------------------------------------
// ID cards (design 10.3, 10.4, 12.2)
// ------------------------------------------------------------------------------------------------

/** An active card's link, shown only after Show link (a logged read) or right after it was made. */
export interface ShownLink {
  id: string;
  url: string;
  effectiveAt: string;
}

const shown = (state: Schemas['IdLinkState']): ShownLink[] =>
  state.active.flatMap((l) => (l.url ? [{ id: l.id, url: l.url, effectiveAt: l.effectiveAt }] : []));

/**
 * Show link: reads the active cards' links through the route that logs each one shown
 * (`id_link.viewed`). The chart itself never hands them to the browser.
 */
export async function showIdLinks(patientId: string): Promise<{ links?: ShownLink[]; error?: string }> {
  if (!UUID.test(patientId)) return { error: 'That chart was not found.' };
  try {
    const state = await unwrap(
      (await api()).GET('/v1/patients/{patientId}/id-link', { params: { path: { patientId } } }),
    );
    return { links: shown(state) };
  } catch (err) {
    if (!(err instanceof PortalApiError)) throw err;
    return { error: err.message };
  }
}

export interface IssueState extends ActionState {
  /** The cards changed under the person: the page has re-read them. */
  changed?: boolean;
}

/**
 * Make a new card: the API makes the token and retires every active card of the patient. When
 * someone else made a card since the page loaded, the API answers link_changed without any link;
 * the page re-reads the cards and the person decides again.
 */
export async function issueIdCard(form: FormData): Promise<{ state: IssueState; links?: ShownLink[] }> {
  const values = formValues(form, 'patientId', 'linkId', 'replacesLinkId', 'reason');
  const { patientId = '', linkId = '', replacesLinkId = '' } = values;
  const reason = values.reason as Schemas['IdLinkReason'] | undefined;
  if (!reason || !(reason in ID_LINK_REASON)) {
    return {
      state: {
        error: 'Choose why a new card is needed.',
        fieldErrors: { reason: 'Choose a reason.' },
        values,
      },
    };
  }
  if (!UUID.test(patientId) || !UUID.test(linkId) || (replacesLinkId && !UUID.test(replacesLinkId))) {
    return { state: { error: 'Reload the page and try again.', values } };
  }
  try {
    const state = await unwrap(
      (await api()).POST('/v1/patients/{patientId}/id-link', {
        params: { path: { patientId } },
        body: { linkId, replacesLinkId: replacesLinkId || null, reason },
      }),
    );
    revalidatePath(`/patients/${patientId}`);
    const count = state.history.filter((l) => l.replacedBy === linkId).length;
    return {
      state: {
        ok: true,
        message:
          count === 0
            ? 'Card made. Copy its link to print the card.'
            : `New card made. The old ${count === 1 ? 'card no longer opens' : 'cards no longer open'} the chart.`,
      },
      links: shown(state).filter((l) => l.id === linkId),
    };
  } catch (err) {
    if (err instanceof PortalApiError && err.code === 'link_changed') {
      revalidatePath(`/patients/${patientId}`);
      return {
        state: {
          error:
            'Someone made a new card for this patient since you opened the page. The cards below are ' +
            'the current ones: check them before making another.',
          changed: true,
        },
      };
    }
    return { state: failure(err, values) };
  }
}

// ------------------------------------------------------------------------------------------------
// Identity corrections (design 11.6): legal name and birth date, admin only, with a reason
// ------------------------------------------------------------------------------------------------

export interface CorrectionState extends ActionState {
  /** The birth date read back for the person to confirm before it is saved. */
  readBack?: string;
}

const WHY = {
  // Staff found the chart wrong. (Not `error`: a radio's ID is `<field>-<value>`, and
  // `<field>-error` is the field's error message.)
  mistake: { outcome: 'corrected', requestedByPatient: false },
  // A HIPAA §164.526 amendment request, accepted.
  amend: { outcome: 'corrected', requestedByPatient: true },
  // The same request, declined: recorded with the value asked for, the chart unchanged.
  decline: { outcome: 'declined', requestedByPatient: true },
} as const;

export async function correctIdentity(_: ActionState, form: FormData): Promise<CorrectionState> {
  const values = formValues(
    form,
    'patientId',
    'field',
    'baseVersion',
    'why',
    'reason',
    'given',
    'family',
    'birthText',
    'birthMode',
    'step',
  );
  const { patientId = '', field } = values;
  const fieldErrors: Record<string, string> = {};
  if (!UUID.test(patientId) || (field !== 'legalName' && field !== 'birth'))
    return { error: 'Reload the page and try again.', values };
  const why = WHY[values.why as keyof typeof WHY];
  if (!why) fieldErrors.why = 'Choose why the change is made.';
  if ((values.reason ?? '').trim().length < 3) fieldErrors.reason = 'Give a reason of at least 3 characters.';

  let value: Schemas['IdentityCorrection']['value'] | null = null;
  let readBack: string | undefined;
  if (field === 'legalName') {
    const given = (values.given ?? '').trim();
    const family = (values.family ?? '').trim();
    if (!given && !family) fieldErrors.given = 'Type the given name, the family name, or both.';
    value = { given: given || null, family: family || null };
  } else {
    const mode: BirthMode = values.birthMode === 'age' ? 'age' : 'date';
    const parsed = parseBirth(values.birthText ?? '', mode, teamToday());
    if (parsed.ok) {
      value = parsed.birth;
      readBack = parsed.readBack;
    } else {
      fieldErrors.birthText = parsed.message;
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Some answers need another look.', fieldErrors, values };
  }
  // A birth date is read back in words before it is saved (design 12.2), every time.
  if (field === 'birth' && values.step !== 'save') return { values, readBack };

  try {
    await unwrap(
      (await api()).POST('/v1/patients/{patientId}/corrections', {
        params: { path: { patientId } },
        body: {
          field,
          value: value!,
          baseVersion: Number(values.baseVersion ?? 0),
          reason: (values.reason ?? '').trim(),
          ...why,
        },
      }),
    );
  } catch (err) {
    if (err instanceof PortalApiError && err.code === 'field_changed') {
      revalidatePath(`/patients/${patientId}/correct`);
      return {
        error:
          'Someone changed this since you opened the page. Check the value now on the chart, then save again.',
        values,
      };
    }
    if (err instanceof PortalApiError && err.code === 'birth_in_future')
      return { error: err.message, fieldErrors: { birthText: err.message }, values };
    return failure(err, values);
  }
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}?corrected=${why!.outcome === 'declined' ? 'declined' : field}`);
}
