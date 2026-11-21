import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/atkinson-hyperlegible-mono/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './globals.css';
import { DemoBanner } from '@/components/DemoBanner';
import { isDemo } from '@/lib/env';
import { dataTheme, parseTheme, THEME_COOKIE } from '@/lib/theme';

// Titles never name a patient (module 9: no PHI in page titles or browser history).
export const metadata: Metadata = {
  title: { default: 'Sineobex portal', template: '%s · Sineobex' },
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={dataTheme(theme)}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {isDemo() && <DemoBanner />}
        {children}
      </body>
    </html>
  );
}
