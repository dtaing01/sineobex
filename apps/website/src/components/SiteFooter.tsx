import Link from 'next/link';
import { SITE } from '@/lib/site';

export function SiteFooter() {
  return (
    <footer className="ws-footer">
      <div className="ws-wrap">
        <div className="ws-footer__grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="ws-brand" style={{ minHeight: 0 }}>Sineobex</p>
            <p className="ws-muted" style={{ maxWidth: '34em' }}>
              The field-first medical record for street medicine. Being built in Detroit with the clinicians who do the work.
            </p>
          </div>
          <nav aria-label="Footer">
            <p className="sx-label" style={{ marginBottom: 8 }}>Site</p>
            <ul>
              <li><Link href="/">Home</Link></li>
              <li><Link href="/product/">Product</Link></li>
              <li><Link href="/security/">Security &amp; compliance</Link></li>
              <li><Link href="/about/">About</Link></li>
            </ul>
          </nav>
          <div>
            <p className="sx-label" style={{ marginBottom: 8 }}>Get in touch</p>
            <ul>
              <li><Link href="/waitlist/">Join the waitlist</Link></li>
              <li>
                <a href={SITE.waitlistUrl} target="_blank" rel="noopener noreferrer">
                  Waitlist form<span className="sr-only"> (opens Google Forms in a new tab)</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="ws-footer__legal">
          <p>© {new Date().getFullYear()} Sineobex. Sineobex is in development and not yet available for patient care.</p>
          <p>Made in Detroit.</p>
        </div>
      </div>
    </footer>
  );
}
