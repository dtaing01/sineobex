import type { Schemas } from '@sineobex/contract';
import { fieldValueText, historyFieldLabel, historyHow } from '@/app/(app)/patients/format';
import styles from '@/app/(app)/patients/patients.module.css';
import { formatDateTime } from '@/lib/labels';

/**
 * Every recorded value of a chart's fields, old and new, with who, when and how (design 11.7,
 * 12.2). A row header names the field; below 640 px each row stacks, naming its columns.
 */
export function FieldHistory({
  entries,
  patientId,
  today,
  caption,
}: {
  entries: Schemas['FieldHistoryEntry'][];
  /** The chart's own record: entries on any other were made on a record merged into it. */
  patientId: string;
  today: string;
  caption: string;
}) {
  return (
    <table className={`px-table ${styles.stack}`}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Old value</th>
          <th scope="col">New value</th>
          <th scope="col">Who</th>
          <th scope="col">When</th>
          <th scope="col">How</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <th scope="row">
              {historyFieldLabel(e.entity, e.field)}
              {e.entity === 'patient' && e.recordId !== patientId && (
                <span className={styles.meta}>On a record merged into this chart</span>
              )}
            </th>
            <td data-label="Old value">{fieldValueText(e.field, e.previousValue, today)}</td>
            <td data-label="New value">{fieldValueText(e.field, e.value, today)}</td>
            <td data-label="Who">
              {e.changedBy.displayName}
              {/* An admin's own correction is approved by its author: said once. */}
              {e.approvedBy && e.approvedBy.userId !== e.changedBy.userId && (
                <span className={styles.meta}>Approved by {e.approvedBy.displayName}</span>
              )}
            </td>
            <td data-label="When">{formatDateTime(e.deviceTime ?? e.recordedAt)}</td>
            <td data-label="How">{historyHow(e)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
