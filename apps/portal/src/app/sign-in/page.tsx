import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <>
      <header className="px-top">
        <Link href="/" className="px-brand">
          Sineobex
        </Link>
      </header>
      <main id="main" tabIndex={-1} className="px-main">
        <div className="px-panel px-narrow">
          <h1 className="px-h1">Sign in</h1>
          <p className="px-lede">
            Use your team account. You will be asked for a code from your authenticator app.
          </p>
        </div>
      </main>
    </>
  );
}
