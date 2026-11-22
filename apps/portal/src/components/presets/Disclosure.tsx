'use client';

import { useState, type ReactNode } from 'react';
import styles from './presets.module.css';

/**
 * A button that shows a form below it, for an act a list offers on each of its presets (Remove,
 * Restore), so a list is not a list of reason boxes. The form is drawn only while it is open: a
 * closed <details> keeps its buttons styled but never finishes their transitions, which leaves the
 * theme checks waiting on them for good.
 */
export function Disclosure({
  id,
  label,
  name,
  children,
}: {
  /** The ID the open form's region takes. */
  id: string;
  label: string;
  /** What it acts on, read after the label by a screen reader: "Remove Demo: Rainy night". */
  name: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.disclosure}>
      <button
        type="button"
        className="sx-btn sx-btn--secondary"
        aria-expanded={open}
        {...(open ? { 'aria-controls': id } : {})}
        onClick={() => setOpen((now) => !now)}
      >
        {label}
        <span className="sr-only"> {name}</span>
      </button>
      {open && <div id={id}>{children}</div>}
    </div>
  );
}
