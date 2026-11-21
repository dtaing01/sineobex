import type { Metadata } from 'next';
import { Plus, ShieldAlert } from 'lucide-react';
import { WaitlistLink } from '@/components/WaitlistLink';

export const metadata: Metadata = {
  title: 'Join the waitlist',
  description: 'Tell us about your street medicine or outreach team and we will reach out when Sineobex is ready for you.',
};

const faqs = [
  {
    q: 'Is Sineobex available now?',
    a: ['Not yet. Sineobex is in development with a Detroit street medicine team. The waitlist is how we decide who to talk to next.'],
  },
  {
    q: 'Who should join?',
    a: [
      'Anyone who runs or supports care outside a clinic: street medicine leads, medical directors, outreach coordinators, student-run clinic boards and health department program staff.',
      'If you are a volunteer, join too, and tell us who leads your team.',
    ],
  },
  {
    q: 'What happens after I join?',
    a: [
      'We read every response. When Sineobex can support a team like yours, we will contact you to learn how your runs work today.',
      'Joining does not commit you to anything.',
    ],
  },
  {
    q: 'Does it work outside Detroit?',
    a: ['Yes, it is built for any city. Detroit is where we are building it first, so Michigan teams may hear from us sooner.'],
  },
  {
    q: 'Can our own IT or compliance team review it first?',
    a: ['Yes. Say so in the form. Our security and accessibility details are on the Security & compliance page, and we will answer what it doesn\'t cover.'],
  },
];

export default function WaitlistPage() {
  return (
    <>
      <section className="ws-pagehead" aria-labelledby="page-title">
        <div className="ws-wrap">
          <p className="ws-eyebrow">Join the waitlist</p>
          <h1 id="page-title" className="ws-display" style={{ maxWidth: '13em' }}>Tell us about your team.</h1>
          <p className="ws-lede ws-muted">
            Sineobex isn&apos;t open to new teams yet. Join the waitlist and we&apos;ll reach out when it&apos;s ready for yours.
          </p>
        </div>
      </section>

      <section className="ws-section" aria-label="How to join">
        <div className="ws-wrap ws-join">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 className="ws-h2">How it works</h2>
              <ol className="ws-ol ws-lede">
                <li>Open the waitlist form in Google Forms and tell us about your team.</li>
                <li>We read every response and group teams by how they work.</li>
                <li>When Sineobex is ready for a team like yours, we contact you to talk it through.</li>
              </ol>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 className="ws-h2">Questions</h2>
              <div className="ws-faq">
                {faqs.map(({ q, a }) => (
                  <details key={q}>
                    <summary>{q}<Plus className="sx-icon" aria-hidden="true" /></summary>
                    <div>{a.map((t) => <p key={t}>{t}</p>)}</div>
                  </details>
                ))}
              </div>
            </div>
          </div>

          <section className="ws-join__panel" aria-labelledby="join-title">
            <p className="sx-label">Waitlist</p>
            <h2 id="join-title" className="ws-h3">Join the waitlist</h2>
            <p className="ws-muted">The form opens in Google Forms in a new tab.</p>
            <WaitlistLink size="lg" className="sx-btn--lg" label="Open the waitlist form" />
            <div className="sx-alert sx-alert--passive" role="note">
              <ShieldAlert className="sx-icon" aria-hidden="true" />
              <p className="sx-alert__title">No patient information, please</p>
              <p className="sx-alert__body">Tell us about your team, not your patients. Don&apos;t include names, conditions or anything else about the people you serve.</p>
            </div>
          </section>
        </div>
      </section>
    </>
  );
}
