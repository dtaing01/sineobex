import type { Metadata } from 'next';
import { MapPin, CloudCheck, HeartHandshake, Hand } from 'lucide-react';
import { CtaBand } from '@/components/CtaBand';

export const metadata: Metadata = {
  title: 'About',
  description: 'Sineobex is being built in Detroit with the street medicine clinicians who will use it.',
};

const principles = [
  {
    icon: Hand,
    title: 'Field first',
    body: 'If it doesn\'t work standing on a sidewalk with one gloved hand and no signal, it doesn\'t ship.',
  },
  {
    icon: CloudCheck,
    title: 'Saved means confirmed',
    body: 'We never tell a clinician a note is saved until the server has every field of it. Losing a note is worse than waiting for one.',
  },
  {
    icon: HeartHandshake,
    title: 'Person-first records',
    body: 'Patients can request their records, and records follow them into other systems. The words in Sineobex are factual and respectful: "unsheltered", not "homeless guy".',
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="ws-pagehead" aria-labelledby="page-title">
        <div className="ws-wrap">
          <p className="ws-eyebrow"><MapPin className="sx-icon" aria-hidden="true" /> Detroit, Michigan</p>
          <h1 id="page-title" className="ws-display" style={{ maxWidth: '13em' }}>Built with the people who do the work.</h1>
          <p className="ws-lede ws-muted">
            Sineobex is being built in Detroit alongside a street medicine team, screen by screen, starting from the paper and
            Google Forms they chart with on runs today.
          </p>
        </div>
      </section>

      <section className="ws-section" aria-labelledby="mission-title">
        <div className="ws-wrap ws-split">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <p className="ws-eyebrow">Why we exist</p>
            <h2 id="mission-title" className="ws-h2">Care on the street deserves a real medical record.</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} className="ws-lede">
            <p>
              Street medicine teams see people the rest of the health system misses. Their records are often the only continuous
              history a patient has, yet they live in notebooks, spreadsheets and tools built for clinics with front desks.
            </p>
            <p>
              Sineobex gives these teams a record that matches how they work: routes instead of appointments, shared supply bags
              instead of a stockroom, and phones that may not see signal until the van gets back.
            </p>
            <p>We are starting in Detroit, with Michigan&apos;s billing rules first, and building for any city with a team on foot.</p>
          </div>
        </div>
      </section>

      <section className="ws-section ws-section--surface" aria-labelledby="principles-title">
        <div className="ws-wrap">
          <div className="ws-section-head">
            <p className="ws-eyebrow">How we build</p>
            <h2 id="principles-title" className="ws-h2">What we won&apos;t compromise on.</h2>
          </div>
          <div className="ws-grid ws-grid--3">
            {principles.map(({ icon: Icon, title, body }) => (
              <article key={title} className="ws-card">
                <div className="ws-card__icon"><Icon aria-hidden="true" /></div>
                <h3 className="ws-h3">{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <CtaBand title="Want to help shape it?" body="If your team does street or outreach medicine, join the waitlist. We learn the most from the teams who use it." />
    </>
  );
}
