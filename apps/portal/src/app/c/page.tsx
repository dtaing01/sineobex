import type { Metadata } from 'next';
import { AuthFrame } from '@/components/AuthFrame';

// Only the product's name: the tab, the history and anyone looking over a shoulder learn nothing.
export const metadata: Metadata = { title: { absolute: 'Sineobex' } };

// PLAN-OPEN: the languages patient-facing text is translated into (ACA §1557; Brooke and Mercy).
// English only until then; anyone who finds a card may read this page.
const TEXT = {
  en: {
    title: 'This is a Street Medicine ID card',
    lede: 'Staff: sign in to open the chart.',
    action: 'Sign in',
  },
} as const;

/**
 * Where an ID card's QR code leads: `{ID_LINK_BASE_URL}/c#<token>` (phase 3 design 10.3). The
 * token rides in the fragment, which browsers never send to a server, so it can't reach a log, a
 * URL query or a Referer header. The page is public (src/proxy.ts) and the same for everyone: no
 * team name, which can itself disclose care, and no patient data.
 *
 * Phase 3 neither reads nor sends the fragment, signed in or not. Opening the chart from a card is
 * phase 9, which hands the token to `POST /v1/id-links/resolve` in a request body.
 */
export default function IdCardPage() {
  const text = TEXT.en;
  return (
    <AuthFrame title={text.title} lede={text.lede}>
      <p>
        {/* /home rather than /sign-in: the proxy sends anyone signed out to the sign-in page, and
            someone already signed in goes straight to their team. A plain link, so nothing is
            prefetched or routed in the browser. */}
        <a className="sx-btn sx-btn--secondary" href="/home">
          {text.action}
        </a>
      </p>
    </AuthFrame>
  );
}
