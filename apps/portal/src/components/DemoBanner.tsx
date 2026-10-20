import { FlaskConical } from 'lucide-react';

export const DEMO_MESSAGE = 'Demo data only. Never enter a real patient.';

export function DemoBanner() {
  return (
    // A labelled region, so it is a landmark screen-reader users can jump to and nothing on the
    // page sits outside a landmark.
    <section className="px-demo" aria-label="Demo environment">
      <FlaskConical className="sx-icon" aria-hidden="true" />
      <p>{DEMO_MESSAGE}</p>
    </section>
  );
}
