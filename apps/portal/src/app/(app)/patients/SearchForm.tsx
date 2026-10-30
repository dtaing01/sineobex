'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { searchPatients, type SearchState } from '@/app/actions/patients';
import { ActionForm, SubmitButton, TextField, useFieldId, useFormState } from '@/components/ActionForm';
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
                  name says whose chart it opens; its visible part is the name. */}
              <Link href={`/patients/${r.patientId}`} prefetch={false}>
                <span className="sr-only">Open chart: </span>
                {r.name}
                <span className="sr-only">{r.bornSuffix}</span>
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
 * Patient search (design 12.2). The search is a POST and its answer lives only in this form's
 * state: the address stays /patients, so names and birth dates never reach the history.
 */
export function SearchForm() {
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
        <div className="px-form px-form--inline">
          <TextField name="month" label="Month" inputMode="numeric" autoComplete="off" maxLength={2} />
          <TextField name="day" label="Day" inputMode="numeric" autoComplete="off" maxLength={2} />
          <TextField name="year" label="Year" inputMode="numeric" autoComplete="off" maxLength={4} />
        </div>
      </fieldset>
      <div className="px-actions">
        <SubmitButton>Search</SubmitButton>
      </div>
      <Results />
    </ActionForm>
  );
}
