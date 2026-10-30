import type { Metadata } from 'next';
import {
  Users, QrCode, Route, Bandage, Backpack, RefreshCw, Send, Monitor, Info,
} from 'lucide-react';
import { EncounterPreview } from '@/components/PhonePreviews';
import { WaitlistLink } from '@/components/WaitlistLink';
import { CtaBand } from '@/components/CtaBand';

export const metadata: Metadata = {
  title: 'Product',
  description:
    'Routes, patient identity, tap-first charting, shared supply bags, offline sync and a desktop for admins: everything a street medicine team needs in one record.',
};

const modules = [
  {
    id: 'teams',
    icon: Users,
    title: 'Teams, roles and credentials',
    summary: 'Volunteers rotate. Permissions shouldn\'t have to be rebuilt every semester.',
    points: [
      'A role decides which screens and patients a person sees: healthcare staff, logistics, billing and data, or a custom preset such as community health worker.',
      'A credential decides clinical acts. Only people who can order see orders; only people who can sign can sign.',
      'Notes by residents and nurse practitioners wait for an attending physician\'s attestation. Care is never held up, only the billing export.',
    ],
  },
  {
    id: 'patients',
    icon: QrCode,
    title: 'Patients and identity',
    summary: 'Find the right person without an address, an ID card or a spelled-out name.',
    points: [
      'Intake records consent, a preferred name and street aliases, and a short "looks like" description. Photos are taken inside the app.',
      'Search by name, alias or area tolerates typos and works offline for the patients on your route.',
      'Likely duplicates go to a review queue. A person decides whether to merge, and every decision is logged.',
      'Each patient gets an ID link your team can print on a card with the tools you already use. It opens a sign-in page, never patient details, and a lost card is replaced by regenerating the link, even offline.',
    ],
  },
  {
    id: 'routes',
    icon: Route,
    title: 'Priority, routes and runs',
    summary: 'Plan who to see, with what, and keep everyone on the same route.',
    points: [
      'Your team defines its priority levels. Each shows as a coloured pill with a word ("Red · High"), and lists sort by it.',
      'A route goes to a team of one to three with a route lead, plus the shared bags it takes and the patients it should see.',
      'The lead confirms on their phone. That locks the route and runs the bag check; after that, Logistics sends the lead change requests to add, drop or move a stop.',
      'Pre-visit calls and texts are logged on each stop (Confirmed, No response, Declined, Rescheduled), and each stop ends as Seen, Declined or Could not locate.',
      'A follow-ups board groups upcoming follow-ups by due date so the next route plans itself around them.',
    ],
  },
  {
    id: 'charting',
    icon: Bandage,
    title: 'Charting at the stop',
    summary: 'Tap, don\'t type. Short visits get a short form.',
    points: [
      'Every encounter starts with Medical or Non-Medical, which decides the forms, supplies and signing rules. A Non-Medical visit can switch to Medical without re-entering anything.',
      'A full encounter covers general care with a focused exam, wound care, harm reduction, behavioral health, sexual and reproductive health and social needs. A quick encounter fits a short street visit on one screen.',
      'The focused exam lets you pick only the systems you examined and mark each normal with one tap, then change what was abnormal.',
      'Wound care records type, size in cm or inches, drainage and dressing, with up to five photos stored only inside the app.',
      'Answering yes to red flags opens the EMS questions and a handoff summary you can show the medic full screen or export as a PDF, with no copy or share option.',
      'Sensitive sections are hidden from roles that don\'t need them and never appear on the patient overview.',
      'The summary is an automatic recap of what you tapped plus your own assessment. Signing locks the note; later changes become addenda.',
    ],
  },
  {
    id: 'supplies',
    icon: Backpack,
    title: 'Orders, bundles and supply bags',
    summary: 'Know what you have before you leave, and what you used when you\'re back.',
    points: [
      'Bundles add a whole order set in one tap, such as basic wound care. Your admins edit the presets or add their own.',
      'Allergy conflicts are a hard stop. An alternative is offered first, and any override is logged with its reason.',
      'Supplies live in shared bags. Each bag goes on one route a day, and restock reminders fire when a bag drops below its minimum.',
      'Signing a note takes what was used out of the route\'s bags, and every restock and correction is logged with a reason.',
    ],
  },
  {
    id: 'offline',
    icon: RefreshCw,
    title: 'Offline sync you can trust',
    summary: 'Saved means the server confirmed it. Nothing less.',
    points: [
      'Everything you chart is kept encrypted on the phone until the server confirms each change, field by field. Only then is the phone copy cleared.',
      'The sync screen shows what is still waiting, by category. Logging out with unsynced items shows the progress and never throws work away.',
      'If the server rejects an item, it comes back to you with the reason so you can fix it and resend.',
      'If the phone\'s clock is more than five minutes off, charting pauses until it is fixed, because medication times have to be right.',
    ],
  },
  {
    id: 'followups',
    icon: Send,
    title: 'Follow-ups and referrals',
    summary: 'Close the loop instead of hoping someone remembers.',
    points: [
      'The clinician sets the follow-up date at the visit, and it lands on their task list and on the follow-ups board.',
      'Referrals are tracked from offered to completed.',
      'A medication that needs delivering becomes a task for the next run.',
    ],
  },
  {
    id: 'desktop',
    icon: Monitor,
    title: 'The desktop for coordinators and admins',
    summary: 'Plan routes, manage people and answer auditors from a browser.',
    points: [
      'Route board, follow-ups board, users and roles, priority flags, bundles and note types.',
      'Devices and sync status, with remote wipe for a lost phone.',
      'The audit log, searchable and exportable.',
      'A billing export of signed Medical encounters with diagnosis and procedure codes, for the health center that bills for your team, and grant reports with counts only.',
      'Exports need a fresh sign-in, carry a watermark and are logged.',
    ],
  },
];

export default function ProductPage() {
  return (
    <>
      <section className="ws-pagehead" aria-labelledby="page-title">
        <div className="ws-wrap"><div className="ws-split">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <p className="ws-eyebrow">Product</p>
            <h1 id="page-title" className="ws-display">One record, from route plan to signed note.</h1>
            <p className="ws-lede ws-muted">
              Sineobex is a phone app for the field and a desktop web app for coordinators, sharing one record. Here is what each
              part does.
            </p>
            <nav aria-label="On this page">
              <div className="ws-toc">
                {modules.map((m) => <a key={m.id} href={`#${m.id}`}>{m.title}</a>)}
              </div>
            </nav>
          </div>
          <EncounterPreview />
        </div></div>
      </section>

      <section className="ws-section" aria-label="Features">
        <div className="ws-wrap">
          {modules.map(({ id, icon: Icon, title, summary, points }) => (
            <article key={id} id={id} className="ws-module" aria-labelledby={`${id}-title`}>
              <div className="ws-module__head">
                <div className="ws-card__icon"><Icon aria-hidden="true" /></div>
                <h2 id={`${id}-title`} className="ws-h3">{title}</h2>
                <p className="ws-muted">{summary}</p>
              </div>
              <ul>
                {points.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="ws-section ws-section--surface" aria-labelledby="later-title">
        <div className="ws-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 860 }}>
          <p className="ws-eyebrow">Later</p>
          <h2 id="later-title" className="ws-h2">On the roadmap, not in the first release.</h2>
          <div className="ws-roadmap">
            {['Dictation on the phone', 'Labelled AI summaries a clinician must accept', 'A shared resource directory', 'Location-based alerts'].map((r) => (
              <span key={r} className="sx-pill sx-pill--neutral" style={{ fontSize: 16, padding: '6px 12px' }}>{r}</span>
            ))}
          </div>
          <div className="ws-note">
            <Info aria-hidden="true" />
            <p>Sineobex is in development and not yet available for patient care. Features may change before release.</p>
          </div>
          <div className="ws-actions"><WaitlistLink /></div>
        </div>
      </section>

      <CtaBand title="Want this on your next run?" />
    </>
  );
}
