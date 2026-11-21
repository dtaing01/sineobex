import { WaitlistLink } from './WaitlistLink';

export function CtaBand({ title = 'Running street medicine? Get on the list.', body }: { title?: string; body?: string }) {
  return (
    <section className="ws-section" aria-labelledby="cta-title">
      <div className="ws-wrap">
        <div className="ws-cta">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 id="cta-title" className="ws-h2">{title}</h2>
            <p>{body ?? "Join the waitlist and we'll reach out when Sineobex is ready for your team."}</p>
          </div>
          <WaitlistLink size="lg" />
        </div>
      </div>
    </section>
  );
}
