import Link from 'next/link';
import {
  WifiOff, QrCode, Backpack, FileCheck, Route, ClipboardList, CloudCheck, CalendarCheck,
  Bandage, Siren, Lock, CircleCheck, Hand, History, GraduationCap, Landmark, Stethoscope, ArrowRight,
} from 'lucide-react';
import { RunPreview } from '@/components/PhonePreviews';
import { WaitlistLink } from '@/components/WaitlistLink';
import { CtaBand } from '@/components/CtaBand';

const problems = [
  {
    icon: WifiOff,
    problem: 'No signal under the overpass',
    title: 'Charts offline, deletes nothing early',
    body: 'Every note is kept encrypted on the phone and sent when there is signal. It only shows as saved once the server confirms it received every field.',
  },
  {
    icon: QrCode,
    problem: 'One person, three charts',
    title: 'Find the right patient fast',
    body: 'Search by name, nickname or area, even with typos and offline. A printable ID link opens the right chart, and likely duplicates go to a review queue instead of being merged by guesswork.',
  },
  {
    icon: Backpack,
    problem: 'Supplies run out mid-route',
    title: 'Bag check before you leave',
    body: "When a route is confirmed, Sineobex compares what its patients need with what's in the route's bags and lists what's short. Supplies come out of the bags automatically when a note is signed.",
  },
  {
    icon: FileCheck,
    problem: "Notes that can't be billed",
    title: 'Records your partners can use',
    body: 'Signed Medical encounters carry diagnosis and procedure codes and the rendering clinician, ready to export to the health center that bills for the team. Grant reports export as counts, with no names.',
  },
];

const steps = [
  { icon: Route, title: 'Plan the route', body: 'Logistics picks the team, the route lead, the bags and the patients, ranked by priority flag and due follow-ups.' },
  { icon: ClipboardList, title: 'Confirm and go', body: 'The lead confirms on their phone. The route locks, the bag check runs, and every change after that goes through the lead.' },
  { icon: Bandage, title: 'Chart at the stop', body: 'Tap, don\'t type: big answer chips for wound care, vitals and social needs. A quick encounter covers the short visits.' },
  { icon: CalendarCheck, title: 'Sync and follow up', body: 'Notes sync when there is signal. Follow-up dates land on a board that Logistics uses to plan the next route.' },
];

const audiences = [
  { icon: Stethoscope, title: 'Street medicine teams', body: 'Physicians, residents, nurses, students and outreach workers charting together on foot or from a van.' },
  { icon: GraduationCap, title: 'Student-run and free clinics', body: 'Rotating volunteer rosters, with roles that decide what each person sees and credentials that decide who can order and sign.' },
  { icon: Landmark, title: 'Health departments and FQHC outreach', body: 'Programs that need audit trails, accessible software and records that hand off cleanly to the clinic that bills.' },
];

export default function Home() {
  return (
    <>
      <section className="ws-hero" aria-labelledby="hero-title">
        <div className="ws-wrap ws-hero__grid">
          <div className="ws-hero__copy">
            <p className="ws-eyebrow">For street medicine and outreach teams</p>
            <h1 id="hero-title" className="ws-display">The medical record that works where your patients are.</h1>
            <p className="ws-lede">
              Sineobex is a medical record built for care on sidewalks, in encampments and under bridges. It charts with a gloved
              thumb, works with no signal, and never calls a note saved until the server has it.
            </p>
            <div className="ws-actions">
              <WaitlistLink size="lg" />
              <Link href="/product/" className="sx-btn sx-btn--secondary ws-btn-lg">
                See how it works <ArrowRight className="sx-icon" aria-hidden="true" />
              </Link>
            </div>
            <p className="ws-status">
              <CircleCheck className="sx-icon" aria-hidden="true" />
              In development with a Detroit street medicine team.
            </p>
          </div>
          <RunPreview />
        </div>
      </section>

      <section className="ws-section ws-section--surface" aria-labelledby="why-title">
        <div className="ws-wrap">
          <div className="ws-section-head">
            <p className="ws-eyebrow">Why Sineobex</p>
            <h2 id="why-title" className="ws-h2">Clipboards and office software weren&apos;t built for the street.</h2>
            <p className="ws-lede">
              Field teams chart on paper, retype it at a desk and still lose track of who they saw. Clinic records assume a desk, a
              signal and a patient with an address. Sineobex assumes none of them.
            </p>
          </div>
          <div className="ws-grid ws-grid--2">
            {problems.map(({ icon: Icon, problem, title, body }) => (
              <article key={title} className="ws-card">
                <div className="ws-card__icon"><Icon aria-hidden="true" /></div>
                <div className="ws-pair">
                  <p className="ws-pair__problem">{problem}</p>
                  <h3 className="ws-h3">{title}</h3>
                </div>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="ws-section" aria-labelledby="run-title">
        <div className="ws-wrap">
          <div className="ws-section-head">
            <p className="ws-eyebrow">How a run works</p>
            <h2 id="run-title" className="ws-h2">From route plan to signed note.</h2>
          </div>
          <ol className="ws-steps">
            {steps.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="ws-step">
                <span className="ws-step__num" aria-hidden="true">{i + 1}</span>
                <h3 className="ws-h4" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Icon className="sx-icon" aria-hidden="true" style={{ color: 'var(--accent)' }} />{title}
                </h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
          <div className="ws-actions" style={{ marginTop: 32 }}>
            <Link href="/product/" className="sx-btn sx-btn--secondary">Explore every feature <ArrowRight className="sx-icon" aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <section className="ws-section ws-section--surface" aria-labelledby="field-title">
        <div className="ws-wrap ws-split">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <p className="ws-eyebrow"><Hand className="sx-icon" aria-hidden="true" /> Built for the field</p>
            <h2 id="field-title" className="ws-h2">Readable in July sun. Tappable in January gloves.</h2>
            <p className="ws-lede ws-muted">
              Every screen is designed for one hand, at arm&apos;s length, in bad light. The same choices make it work for staff with
              low vision or limited dexterity.
            </p>
            <ul className="ws-checks">
              <li><CircleCheck aria-hidden="true" /><span><b>Big targets.</b> Every control is at least 48 pixels, twice the accessibility minimum.</span></li>
              <li><CircleCheck aria-hidden="true" /><span><b>A typeface made for legibility.</b> Atkinson Hyperlegible keeps I, l and 1 apart, and 0 and O.</span></li>
              <li><CircleCheck aria-hidden="true" /><span><b>Day, Night run and High contrast themes.</b> Night run for dusk outreach; High contrast for direct sun.</span></li>
              <li><CircleCheck aria-hidden="true" /><span><b>Words, not just colours.</b> A red flag says &ldquo;Red · High&rdquo;, so colour is never the only signal.</span></li>
            </ul>
          </div>
          <div className="ws-themes" role="img" aria-label="The same answer chips shown in the Day, Night run and High contrast themes.">
            {[['day', 'Day'], ['night', 'Night run'], ['contrast', 'High contrast']].map(([id, name]) => (
              <div key={id} data-theme={id} className="ws-theme sx" aria-hidden="true">
                <span className="sx-label">{name}</span>
                <span className="sx-chip" style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700 }}>✓ Ongoing</span>
                <span className="sx-chip">Resolved</span>
                <span className="sx-pill sx-pill--critical" style={{ alignSelf: 'flex-start' }}>Red · High</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ws-section" aria-labelledby="who-title">
        <div className="ws-wrap">
          <div className="ws-section-head">
            <p className="ws-eyebrow">Who it&apos;s for</p>
            <h2 id="who-title" className="ws-h2">Teams that bring care to people, not the other way round.</h2>
          </div>
          <div className="ws-grid ws-grid--3">
            {audiences.map(({ icon: Icon, title, body }) => (
              <article key={title} className="ws-card">
                <div className="ws-card__icon"><Icon aria-hidden="true" /></div>
                <h3 className="ws-h3">{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="ws-section ws-section--surface" aria-labelledby="trust-title">
        <div className="ws-wrap ws-split ws-split--flip">
          <div className="ws-grid" style={{ gap: 12 }}>
            {[
              [Lock, 'Encrypted on the phone, locked by PIN or biometrics, remotely wipeable'],
              [CloudCheck, 'Hosted on AWS under a business associate agreement'],
              [Siren, 'A red-flag answer opens the EMS questions and a handoff for the medic'],
              [History, 'An append-only audit log of who saw and changed what'],
            ].map(([Icon, text]) => {
              const I = Icon as typeof Lock;
              return (
                <div key={text as string} className="sx-card" style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 12, padding: '16px 20px', alignItems: 'start' }}>
                  <I className="sx-icon" aria-hidden="true" style={{ color: 'var(--accent)', marginTop: 2 }} />
                  <span>{text as string}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <p className="ws-eyebrow">Security and compliance</p>
            <h2 id="trust-title" className="ws-h2">Designed around HIPAA from day one.</h2>
            <p className="ws-lede ws-muted">
              Patient data never lands in a camera roll, a lock-screen notification or a texting app. Procurement teams get straight
              answers about safeguards and accessibility.
            </p>
            <div className="ws-actions">
              <Link href="/security/" className="sx-btn sx-btn--secondary">Read about security <ArrowRight className="sx-icon" aria-hidden="true" /></Link>
            </div>
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
