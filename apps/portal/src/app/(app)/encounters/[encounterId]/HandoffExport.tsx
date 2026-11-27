'use client';

import type { FormEvent } from 'react';

/** The browser's time zone (America/Detroit), or '' when it gives none. */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/**
 * Export EMS handoff (PDF) (lifecycle 5.7, 9.11). A plain form posted to the visit's export route,
 * which answers with the file under the name the API gives it, so the page stays as it is: a
 * server action would refresh it, reading the visit again. The browser's time zone goes with it,
 * filled in as the form is sent, so the file's times are where the reader is; without the page's
 * script it is empty, and the file's times are in UTC, labelled UTC.
 */
export function HandoffExport({ encounterId }: { encounterId: string }) {
  function withTimeZone(event: FormEvent<HTMLFormElement>) {
    const field = event.currentTarget.elements.namedItem('timeZone');
    if (field instanceof HTMLInputElement) field.value = browserTimeZone();
  }
  return (
    <form
      method="post"
      action={`/encounters/${encounterId}/ems-handoff`}
      onSubmit={withTimeZone}
      className="px-actions"
    >
      <input type="hidden" name="timeZone" defaultValue="" />
      <button type="submit" className="sx-btn sx-btn--primary">
        Export EMS handoff (PDF)
      </button>
    </form>
  );
}
