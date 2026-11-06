'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Warns before the 15-minute idle sign-out and lets the person stay signed in (WCAG 2.2.1 Timing
 * Adjustable). Uses a native modal <dialog>, which traps focus and is announced by screen readers.
 */
export function IdleWarning({
  idleMinutes,
  warningSeconds,
  stayAction,
}: {
  idleMinutes: number;
  warningSeconds: number;
  stayAction: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [remaining, setRemaining] = useState(warningSeconds);
  const [deadline, setDeadline] = useState(() => Date.now() + idleMinutes * 60_000);

  useEffect(() => {
    const tick = window.setInterval(() => {
      const left = Math.round((deadline - Date.now()) / 1000);
      if (left <= 0) {
        // A full page load, not a client-side push: it throws away everything the page held in
        // memory, including any patient details still rendered.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign('/sign-in?ended=idle');
        return;
      }
      if (left <= warningSeconds && !dialog.current?.open) dialog.current?.showModal();
      setRemaining(left);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [deadline, warningSeconds]);

  async function stay() {
    await stayAction();
    dialog.current?.close();
    setDeadline(Date.now() + idleMinutes * 60_000);
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return (
    <dialog ref={dialog} className="px-dialog" aria-labelledby="idle-title" aria-describedby="idle-body">
      <h2 id="idle-title">Still there?</h2>
      <p id="idle-body">
        To protect patient privacy you’ll be signed out in{' '}
        <span className="sx-data">
          {minutes}:{String(seconds).padStart(2, '0')}
        </span>
        .
      </p>
      <div className="px-actions">
        <button type="button" className="sx-btn sx-btn--primary" onClick={stay}>
          Stay signed in
        </button>
        <a className="sx-btn sx-btn--secondary" href="/sign-in?ended=signed_out">
          Sign out now
        </a>
      </div>
    </dialog>
  );
}
