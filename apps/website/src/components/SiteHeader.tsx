'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { NAV, SITE } from '@/lib/site';
import { WaitlistLink } from './WaitlistLink';

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = (href: string) => (pathname === href || pathname === href.replace(/\/$/, '') ? 'page' : undefined);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="ws-header">
      <div className="ws-wrap">
        <div className="ws-header__bar">
          <Link href="/" className="ws-brand" aria-label="Sineobex home">Sineobex</Link>
          <nav className="ws-nav" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={current(n.href)}>{n.label}</Link>
            ))}
          </nav>
          <a href={SITE.portalUrl} className="sx-btn sx-btn--secondary ws-header__login">
            Log in
          </a>
          <WaitlistLink className="ws-header__cta" />
          <button
            type="button"
            className="sx-btn sx-btn--secondary ws-menu-btn"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="sx-icon" aria-hidden="true" /> : <Menu className="sx-icon" aria-hidden="true" />}
            Menu
          </button>
        </div>
        {open && (
          <nav id="mobile-nav" className="ws-mobile-nav" aria-label="Main">
            <ul>
              <li><Link href="/" aria-current={current('/')}>Home</Link></li>
              {NAV.map((n) => (
                <li key={n.href}><Link href={n.href} aria-current={current(n.href)}>{n.label}</Link></li>
              ))}
            </ul>
            <a href={SITE.portalUrl} className="sx-btn sx-btn--secondary sx-btn--lg">
              Log in
            </a>
            <WaitlistLink size="lg" className="sx-btn--lg" />
          </nav>
        )}
      </div>
    </header>
  );
}
