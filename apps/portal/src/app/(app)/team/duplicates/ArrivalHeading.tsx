'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A confirmation heading that takes focus when the page opens on it, after a decision redirected
 * here (design 12.2: "focus moves to the confirmation heading"), so a screen reader reads the
 * outcome and the next step first.
 */
export function ArrivalHeading({ id, children }: { id: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <h2 id={id} ref={heading} tabIndex={-1} className="px-h2">
      {children}
    </h2>
  );
}
