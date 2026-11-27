import type { Metadata } from 'next';
import {
  FileCheck, Cloud, Smartphone, History, KeyRound, Accessibility, Download, Info, CircleCheck,
} from 'lucide-react';
import { CtaBand } from '@/components/CtaBand';

export const metadata: Metadata = {
  title: 'Security & compliance',
  description:
    'How Sineobex protects patient data on the phone, in the cloud and in exports, and how it meets the accessibility rules public health buyers follow.',
};

const groups = [
  {
    id: 'agreement',
    icon: FileCheck,
    title: 'A business associate agreement, signed once',
    points: [
      'Your organization signs a business associate agreement (BAA) with Sineobex at sign-up, signed by someone with the authority to sign it.',
      'Public and university programs that must use their own paper can, after counsel reviews it.',
      'Each staff member accepts the terms of use and a confidentiality acknowledgement the first time they sign in.',
    ],
  },
  {
    id: 'cloud',
    icon: Cloud,
    title: 'In the cloud',
    points: [
      'Hosted on Amazon Web Services under AWS\'s own BAA.',
      'Staff sign in with multi-factor authentication. Removing someone signs them out on every device at once.',
      'The desktop web app works live against the server and keeps no patient data in the browser.',
    ],
  },
  {
    id: 'phone',
    icon: Smartphone,
    title: 'On the phone',
    points: [
      'Patient data on the phone is encrypted and opens with a PIN or biometrics. Ten wrong PINs destroy the key.',
      'A lost phone can be wiped remotely. Its key is destroyed the next time it connects.',
      'Photos and scanned documents stay inside the app and never reach the camera roll.',
      'The app hides its contents in the app switcher and blocks screenshots on screens with patient data.',
      'Notifications never include names or health details: "2 tasks due today", not a patient\'s name.',
      'If someone\'s access is removed while their phone is offline, what it uploads later waits in a review queue instead of going straight into the chart.',
    ],
  },
  {
    id: 'audit',
    icon: History,
    title: 'An audit trail you can hand to an auditor',
    points: [
      'Sign-ins, chart views, edits, exports and admin changes are written to an append-only audit log.',
      'The log is anchored in write-once storage (S3 Object Lock), so tampering would show.',
      'Admins can search it and export it.',
    ],
  },
  {
    id: 'minimum',
    icon: KeyRound,
    title: 'Minimum necessary, by design',
    points: [
      'Lists show a preferred name, a location and the one current need. Diagnoses and history are a tap deeper.',
      'Roles decide which patients and screens each person sees. Sensitive sections, such as sexual and reproductive health and sensitive exams, need extra permission and never appear on the patient overview.',
      'Patient ID links carry an opaque code and open only a sign-in page.',
      'Exports are limited to admins and billing staff, need a fresh sign-in, carry a watermark and are logged.',
    ],
  },
  {
    id: 'data',
    icon: Download,
    title: 'Your data stays yours',
    points: [
      'Your organization can export its records at any time.',
      'Billing exports go to the health center that bills for your team; grant reports contain counts, never names.',
    ],
  },
];

export default function SecurityPage() {
  return (
    <>
      <section className="ws-pagehead" aria-labelledby="page-title">
        <div className="ws-wrap">
          <p className="ws-eyebrow">Security &amp; compliance</p>
          <h1 id="page-title" className="ws-display" style={{ maxWidth: '14em' }}>Patient trust is the whole job.</h1>
          <p className="ws-lede ws-muted">
            The people you serve have more reason than most to worry about where their information goes. Here is how Sineobex
            protects it, in plain terms, so your compliance officer and your procurement team can check our work.
          </p>
          <nav className="ws-toc" aria-label="On this page">
            {groups.map((g) => <a key={g.id} href={`#${g.id}`}>{g.title}</a>)}
            <a href="#accessibility">Accessibility</a>
          </nav>
        </div>
      </section>

      <section className="ws-section" aria-label="Safeguards">
        <div className="ws-wrap">
          {groups.map(({ id, icon: Icon, title, points }) => (
            <article key={id} id={id} className="ws-module" aria-labelledby={`${id}-title`}>
              <div className="ws-module__head">
                <div className="ws-card__icon"><Icon aria-hidden="true" /></div>
                <h2 id={`${id}-title`} className="ws-h3">{title}</h2>
              </div>
              <ul>{points.map((p) => <li key={p}>{p}</li>)}</ul>
            </article>
          ))}
          <div className="ws-note" style={{ marginTop: 16 }}>
            <Info aria-hidden="true" />
            <p>
              <b>About &ldquo;HIPAA certified&rdquo;.</b> There is no official HIPAA certification for software. A vendor can sign a
              BAA, put the required safeguards in place and show its work, which is what this page does. Sineobex is in development;
              we will publish updates here as safeguards are built and reviewed.
            </p>
          </div>
        </div>
      </section>

      <section id="accessibility" className="ws-section ws-section--surface" aria-labelledby="a11y-title">
        <div className="ws-wrap ws-split">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <p className="ws-eyebrow"><Accessibility className="sx-icon" aria-hidden="true" /> Accessibility</p>
            <h2 id="a11y-title" className="ws-h2">Accessible to your staff, and ready for public buyers.</h2>
            <p className="ws-lede ws-muted">
              Under ADA Title II and the HHS Section 504 rule, health departments and HHS-funded clinics are responsible for the
              accessibility of the apps they use. We design Sineobex so that answer is easy.
            </p>
          </div>
          <ul className="ws-checks">
            <li><CircleCheck aria-hidden="true" /><span><b>WCAG 2.2 Level AA</b> is the target for every screen, on iOS, Android and the desktop web app.</span></li>
            <li><CircleCheck aria-hidden="true" /><span><b>A High contrast theme</b> with every text pair at 7:1 or better, alongside Day and Night run.</span></li>
            <li><CircleCheck aria-hidden="true" /><span><b>Large text without breaking.</b> Screens reflow up to 200% text size.</span></li>
            <li><CircleCheck aria-hidden="true" /><span><b>Screen readers</b> get a name and role for every control, with VoiceOver and TalkBack in mind.</span></li>
            <li><CircleCheck aria-hidden="true" /><span><b>Ready for translation.</b> Every word in the app is built to be translated, for language access under ACA Section 1557.</span></li>
            <li><CircleCheck aria-hidden="true" /><span><b>An accessibility conformance report</b> is being prepared for procurement reviews.</span></li>
          </ul>
        </div>
      </section>

      <section className="ws-section ws-section--tight" aria-labelledby="site-title">
        <div className="ws-wrap" style={{ maxWidth: 860 }}>
          <div className="ws-note ws-note--warn">
            <Info aria-hidden="true" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 id="site-title" className="ws-h4">This website collects no patient information.</h2>
              <p>The waitlist form is for information about your team. Please don&apos;t include anything about patients in it.</p>
            </div>
          </div>
        </div>
      </section>

      <CtaBand title="Questions from your compliance team?" body="Join the waitlist and tell us what your review needs. We'll answer it before you commit to anything." />
    </>
  );
}
