import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="ws-pagehead" style={{ borderBottom: 0 }}>
      <div className="ws-wrap">
        <p className="ws-eyebrow">Page not found</p>
        <h1 className="ws-display">This stop isn&apos;t on the route.</h1>
        <p className="ws-lede ws-muted">The page may have moved. Head back to the start.</p>
        <div className="ws-actions"><Link href="/" className="sx-btn sx-btn--primary ws-btn-lg">Go to the home page</Link></div>
      </div>
    </section>
  );
}
