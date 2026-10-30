import type { Schemas } from '@sineobex/contract';
import {
  ALLERGY_SCREEN,
  displayName,
  fieldValueText,
  formatDayOf,
  legalNameText,
} from '@/app/(app)/patients/format';
import styles from '@/app/(app)/patients/patients.module.css';

type Chart = Schemas['PatientChart'];

/** A field of the chart's patient record, as recorded. */
export function chartValue(chart: Chart, field: string): unknown {
  return chart.patient.fields[field]?.value ?? null;
}

/**
 * Who this chart is about, and what nobody should miss: the name they go by, a legal name and
 * birth date to confirm it's them, severe allergies, a possible duplicate, and when the record
 * asked for was merged into this one. The page title stays "Patient": names go in the page only.
 */
export function PatientHeader({ chart, today }: { chart: Chart; today: string }) {
  const preferredName = chartValue(chart, 'preferredName') as string | null;
  const legalName = chartValue(chart, 'legalName') as { given: string | null; family: string | null } | null;
  const visualDescriptor = chartValue(chart, 'visualDescriptor') as string | null;
  const birth = chartValue(chart, 'birth');
  const name = displayName({ preferredName, legalName, visualDescriptor });
  const legal = legalNameText(legalName);
  const allergies = chart.allergies.filter((a) => a.status === 'active');
  const severe = allergies.filter((a) => a.attributes.severity === 'severe');
  const screen = chartValue(chart, 'allergyScreen') as Schemas['AllergyScreen'] | null;
  const merged = chart.redirectedFrom
    ? chart.mergedFrom.find((m) => m.patientId === chart.redirectedFrom)
    : undefined;

  return (
    <div className="px-form">
      {chart.redirectedFrom && (
        <p className="px-alert px-alert--info">
          The record you opened was merged into this chart
          {merged ? ` on ${formatDayOf(merged.mergedAt)}` : ''}. Its details are shown here with this chart’s,
          and its ID card opens this chart.
        </p>
      )}
      <h1 className="px-h1">{name}</h1>
      <p>
        {legal && legal !== name && <span className={styles.meta}>Legal name: {legal}</span>}
        <span className={styles.meta}>
          {birth ? `Born ${fieldValueText('birth', birth, today)}` : 'Date of birth not recorded'}
        </span>
        {visualDescriptor && visualDescriptor !== name && (
          <span className={styles.meta}>{visualDescriptor}</span>
        )}
      </p>
      {severe.length > 0 ? (
        <p className="px-alert px-alert--error">
          Severe allergy: {severe.map((a) => String(a.attributes.substance)).join(', ')}
        </p>
      ) : (
        <p className="px-warn">
          {allergies.length > 0
            ? `Allergies: ${allergies.map((a) => String(a.attributes.substance)).join(', ')}`
            : screen === 'none_known'
              ? ALLERGY_SCREEN.none_known
              : 'Allergies not asked yet'}
        </p>
      )}
      {chart.duplicate && (
        <p className="px-alert px-alert--info">
          This chart may be the same person as another one; a reviewer is checking.
          {chart.duplicate.note ? ` Note: ${chart.duplicate.note}` : ''}
        </p>
      )}
    </div>
  );
}
