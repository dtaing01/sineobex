import { CloudCheck, CloudOff, House, Calendar, Plus, Users, BookOpen, MapPin, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/*
  Decorative product previews built from Sineobex Field components (sx- classes).
  They are pictures, not controls: nothing inside is focusable, and screen readers
  get the figure caption instead of the contents.
*/

function Phone({ label, caption, children }: { label: string; caption: string; children: ReactNode }) {
  return (
    <figure style={{ margin: 0 }}>
      <div className="ws-phone sx" role="img" aria-label={label}>
        <div className="ws-phone__screen" aria-hidden="true">{children}</div>
      </div>
      <figcaption className="ws-phone__caption">{caption}</figcaption>
    </figure>
  );
}

function TabBar() {
  return (
    <div className="sx-tabbar">
      <span className="sx-tab is-current"><House className="sx-icon" />Home</span>
      <span className="sx-tab"><Calendar className="sx-icon" />Schedule</span>
      <span className="sx-start"><Plus className="sx-icon" /></span>
      <span className="sx-tab"><Users className="sx-icon" />Patients</span>
      <span className="sx-tab"><BookOpen className="sx-icon" />Resources</span>
    </div>
  );
}

export function RunPreview() {
  return (
    <Phone
      label="Sineobex phone app showing a team route in progress: three stops, priority flags, and a banner confirming every note is synced."
      caption="Product preview with sample data."
    >
      <div className="ws-phone__top">
        <span className="sx-label" style={{ color: 'var(--ink)' }}>Run in progress</span>
        <span className="sx-pill sx-pill--info">Lead: you</span>
      </div>
      <div className="ws-phone__body">
        <div className="sx-sync sx-sync--synced"><CloudCheck className="sx-icon" /><span><strong>Synced</strong> · server confirmed 10:42 AM</span></div>
        <div className="sx-card">
          <div className="sx-card__head">
            <span style={{ fontWeight: 700 }}>Cass Park loop</span>
            <span className="sx-data sx-muted" style={{ fontSize: 15 }}>1–4 PM</span>
          </div>
          <div style={{ padding: '0 16px 8px' }}>
            <div className="sx-stop">
              <span className="sx-stop__num sx-stop__num--done">1</span>
              <div><p style={{ margin: 0, fontWeight: 700 }}>Marcus T.</p><p className="sx-rowitem__meta">Wound recheck · Seen</p></div>
              <span className="sx-pill sx-pill--critical">Red · High</span>
            </div>
            <div className="sx-stop">
              <span className="sx-stop__num sx-stop__num--now">2</span>
              <div><p style={{ margin: 0, fontWeight: 700 }}>Sarah J.</p><p className="sx-rowitem__meta">BP check · Confirmed</p></div>
              <span className="sx-pill sx-pill--warning">Yellow · Due</span>
            </div>
            <div className="sx-stop">
              <span className="sx-stop__num">3</span>
              <div><p style={{ margin: 0, fontWeight: 700 }}>Open stop</p><p className="sx-rowitem__meta"><MapPin className="sx-icon" style={{ width: 14, height: 14, verticalAlign: '-2px' }} /> Brush Park</p></div>
              <ChevronRight className="sx-icon sx-chev" />
            </div>
          </div>
        </div>
        <div className="sx-card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="sx-label">Route bags</span>
          <div className="sx-row">
            <span className="sx-pill sx-pill--good">Wound bag · covered</span>
            <span className="sx-pill sx-pill--warning">Hygiene bag · 2 short</span>
          </div>
        </div>
      </div>
      <TabBar />
    </Phone>
  );
}

export function EncounterPreview() {
  return (
    <Phone
      label="Sineobex encounter screen charted offline: wound type, drainage and red-flag questions answered with large tap targets, saved on the phone until the server confirms."
      caption="Encounter screen, charted with no signal. Sample data."
    >
      <div className="ws-phone__top">
        <span className="sx-label" style={{ color: 'var(--ink)' }}>Wound care · Marcus T.</span>
        <span className="sx-pill sx-pill--critical">Allergy: Penicillin</span>
      </div>
      <div className="ws-phone__body">
        <div className="sx-sync sx-sync--offline"><CloudOff className="sx-icon" /><span><strong>Offline.</strong> Saved on this phone until the server confirms.</span></div>
        <div className="sx-section" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="sx-field">
            <span className="sx-label">Wound type</span>
            <div className="sx-row">
              <span className="sx-chip is-on">Venous ulcer</span><span className="sx-chip">Pressure</span><span className="sx-chip">Abscess</span>
            </div>
          </div>
          <div className="sx-field">
            <span className="sx-label">Size · cm</span>
            <div className="sx-row"><span className="sx-data" style={{ fontSize: 18 }}>4 × 2 × 0.5 cm</span></div>
          </div>
          <div className="sx-field">
            <span className="sx-label">Drainage</span>
            <div className="sx-row"><span className="sx-chip">None</span><span className="sx-chip is-on">Small</span><span className="sx-chip">Large</span></div>
          </div>
        </div>
        <div className="sx-section" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="sx-label" style={{ color: 'var(--ink)' }}>Red flags: emergency evaluation?</span>
          <div className="sx-row"><span className="sx-chip is-on">No</span><span className="sx-chip">Uncertain</span><span className="sx-chip is-alarm">Yes</span></div>
        </div>
        <span className="sx-btn sx-btn--primary sx-btn--lg">Review summary</span>
      </div>
    </Phone>
  );
}
