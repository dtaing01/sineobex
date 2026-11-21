'use client';

import { useEffect, useRef } from 'react';

/**
 * What an act that comes back as a full load said (?signed=, ?handoff=, ?assign=): a status message
 * that takes focus as the page opens, so a screen reader hears it whatever came back (review finding
 * PX-4). A live region already there at load is not announced, so focus is what says it, as the
 * Assign form's notice does at its note (PAX-3).
 */
export function PageNotice({ tone, text }: { tone: string; text: string }) {
  const notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    notice.current?.focus();
    // On the page's first render only: a later one keeps focus where the person is.
  }, []);
  return (
    <p ref={notice} role="status" tabIndex={-1} className={`px-alert px-alert--${tone}`}>
      {text}
    </p>
  );
}
