import Link from 'next/link';
import { cookies } from 'next/headers';
import { ThemePicker } from '@/components/ThemePicker';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';

export default async function HomePage() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
      <header className="px-top">
        <Link href="/" className="px-brand">
          Sineobex
        </Link>
        <ThemePicker current={theme} />
      </header>
      <main id="main" tabIndex={-1} className="px-main">
        <h1 className="px-h1">Portal</h1>
        <p className="px-lede">Route planning, team setup, exports and audit for street medicine teams.</p>
        <p>
          <Link href="/sign-in" className="sx-btn sx-btn--primary">
            Sign in
          </Link>
        </p>
      </main>
    </>
  );
}
