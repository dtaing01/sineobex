'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { searchPatients, type SearchState } from '@/app/actions/patients';
import {
  ActionForm,
  SelectField,
  SubmitButton,
  TextField,
  useFieldId,
  useFormState,
} from '@/components/ActionForm';
import { FlagPill } from '@/components/presets/FlagPill';
import type { ListedFlag } from '@/lib/flags';
import styles from './patients.module.css';

// The form's action runs here and hands the server only the form. Given the server action itself,
// React would send the previous answer (every name on screen) back with each new search.
async function search(_: SearchState, form: FormData): Promise<SearchState> {
  return searchPatients(form);
}

function Results() {
  const state = useFormState() as SearchState;
  const table = useRef<HTMLTableElement>(null);
  const nameId = useFieldId('name');
  // The fields are drawn afresh with each answer, which drops focus to the page: it goes to the
  // results instead, or back to the name when nobody was found (the count is announced either way).
  useEffect(() => {
    if (!state.ok) return;
    if (state.rows?.length) table.current?.focus();
    else document.getElementById(nameId)?.focus();
  }, [state, nameId]);
  const rows = state.rows;
  if (!rows?.length) return null;
  return (
    <table ref={table} tabIndex={-1} className={`px-table ${styles.stack}`}>
      <caption>Search results</caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Also known as</th>
          <th scope="col">Born</th>
          <th scope="col">Usually found</th>
          <th scope="col">Last seen</th>
          <th scope="col">Why it matched</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.patientId}>
            <th scope="row">
              {/* No prefetch: loading a chart logs a view, and nobody has opened it yet. The link's
                  name says whose chart it opens, and starts with what it shows. */}
              <Link
                href={`/patients/${r.patientId}`}
                prefetch={false}
                aria-label={`Open chart: ${r.name}${r.bornSuffix}`}
              >
                {r.name}
              </Link>
              {r.legalName && <span className={styles.meta}>Legal name: {r.legalName}</span>}
              {r.descriptor && <span className={styles.meta}>{r.descriptor}</span>}
            </th>
            <td data-label="Also known as">{r.aliases}</td>
            <td data-label="Born">{r.born}</td>
            <td data-label="Usually found">{r.usualArea}</td>
            <td data-label="Last seen">{r.lastSeen}</td>
            <td data-label="Why it matched">{r.why}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Risk level and Conditions (phase 5 design 7, 8.1; section 11, row 37): fields of the search's own
 * POST form, so neither reaches the address, each flag by its pill's words. Their choices are the
 * flags the API lists for the person (D114), so a flag hidden from them is never offered. They
 * narrow a name or birth search to patients carrying every flag chosen; a flag alone searches
 * nothing, as phase 3's search never browses the list.
 */
function FlagFilters({ flags }: { flags: readonly ListedFlag[] }) {
  const state = useFormState();
  const id = useFieldId('conditions');
  const levels = flags.filter((f) => f.tier === 'primary');
  const conditions = flags.filter((f) => f.tier === 'secondary');
  // The conditions a search was sent with, which the form keeps ticked (actions/patients.ts).
  const ticked = new Set((state.values?.conditions ?? '').split(',').filter(Boolean));
  if (levels.length === 0 && conditions.length === 0) return null;
  return (
    <>
      <p className="sx-help">A risk level or a condition narrows a search by name or date of birth.</p>
      {levels.length > 0 && (
        <SelectField
          name="riskLevel"
          label="Risk level (optional)"
          options={[
            { value: '', label: 'Any risk level' },
            ...levels.map((f) => ({ value: f.flagId, label: `${f.colorName} · ${f.name}` })),
          ]}
        />
      )}
      {conditions.length > 0 && (
        <fieldset className="px-fieldset">
          <legend>Conditions (optional)</legend>
          <p className="sx-help">Only patients with every condition ticked.</p>
          {conditions.map((f) => (
            // Keyed by what was sent, so the ticks drawn afresh with each answer are the ones searched.
            <div key={`${f.flagId}-${ticked.has(f.flagId)}`} className="px-check">
              <input
                id={`${id}-${f.flagId}`}
                type="checkbox"
                name="conditions"
                value={f.flagId}
                defaultChecked={ticked.has(f.flagId)}
              />
              <label htmlFor={`${id}-${f.flagId}`}>
                <FlagPill color={f.color} colorName={f.colorName} name={f.name} />
              </label>
            </div>
          ))}
        </fieldset>
      )}
    </>
  );
}

/**
 * Patient search (design 12.2). The search is a POST and its answer lives only in this form's
 * state: the address stays /patients, so names and birth dates, and the flags a search is narrowed
 * by, never reach the history.
 */
export function SearchForm({ flags = [] }: { flags?: readonly ListedFlag[] }) {
  return (
    <ActionForm id="search" action={search} label="Search patients">
      <TextField
        name="name"
        label="Name, street name or description"
        hint="Part of a name works, and spelling needn’t be exact."
        autoComplete="off"
        maxLength={100}
      />
      <fieldset className="px-fieldset">
        <legend>Date of birth (optional)</legend>
        <p className="sx-help">A year needs a name with it. A full date works on its own.</p>
        <div className={`px-form px-form--inline ${styles.dateParts}`}>
          <TextField name="month" label="Month" inputMode="numeric" autoComplete="off" maxLength={2} />
          <TextField name="day" label="Day" inputMode="numeric" autoComplete="off" maxLength={2} />
          <TextField name="year" label="Year" inputMode="numeric" autoComplete="off" maxLength={4} />
        </div>
      </fieldset>
      <FlagFilters flags={flags} />
      <div className="px-actions">
        <SubmitButton>Search</SubmitButton>
      </div>
      <Results />
    </ActionForm>
  );
}
