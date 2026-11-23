import type { ReactNode } from 'react';
import styles from './presets.module.css';

/**
 * Where a table of the preset pages sits (a history, an update's review): its words stay whole, and
 * where it is wider than the page at 320 px, it scrolls sideways in a group of its own, which WCAG
 * 1.4.10 allows a data table. The group takes focus, so a keyboard can scroll it, and a screen
 * reader names it by the table's caption, `caption` being the caption's ID.
 */
export function ScrollTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a group that scrolls must take focus, or a keyboard can't scroll it (WCAG 2.1.1; axe's scrollable-region-focusable)
    <div role="group" aria-labelledby={caption} tabIndex={0} className={styles.scroll}>
      {children}
    </div>
  );
}
