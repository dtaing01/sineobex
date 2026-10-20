import Link from 'next/link';
import type { ReactNode } from 'react';

/** Frame for the screens before someone is fully signed in. */
export function AuthFrame({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="px-top">
        <Link href="/sign-in" className="px-brand">
          Sineobex
        </Link>
      </header>
      <main id="main" tabIndex={-1} className="px-main">
        <div className="px-panel px-narrow">
          <h1 className="px-h1">{title}</h1>
          {lede && <p className="px-lede">{lede}</p>}
          {children}
        </div>
      </main>
    </>
  );
}
