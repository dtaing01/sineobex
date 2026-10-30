import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { correctIdentity } from '@/app/actions/patients';
import { ActionForm, ChoiceField, SubmitButton, TextField } from '@/components/ActionForm';
import { BirthField } from '@/components/BirthField';
import { teamToday } from '@/lib/dob';
import { can, currentUser } from '@/lib/me';
import { loadChart } from '../../chart';
import { fieldValueText } from '../../format';

export const metadata: Metadata = { title: 'Correct identity' };

/** Why the value changes: a mistake, or the patient's own request (HIPAA §164.526), granted or not. */
function WhyFields() {
  return (
    <>
      <ChoiceField
        name="why"
        legend="Why is it changing?"
        options={[
          { value: 'mistake', label: 'Correcting a mistake on the chart' },
          {
            value: 'amend',
            label: 'The patient asked for this change',
            hint: 'A request to amend their record. The chart changes.',
          },
          {
            value: 'decline',
            label: 'The patient asked, and the request is declined',
            hint: 'Recorded with what they asked for. The chart stays as it is.',
          },
        ]}
      />
      <TextField
        name="reason"
        label="Reason"
        hint="Logged with the decision, and kept with the chart."
        required
        autoComplete="off"
        maxLength={500}
      />
    </>
  );
}

/**
 * Identity corrections (design 11.6, 12.2): legal name and date of birth, for
 * patients.correct_identity, behind a fresh sign-in (the profile's link goes through /reauth, and
 * the API refuses a stale one, which sends the person there too).
 */
export default async function CorrectPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const [chart, { team }] = await Promise.all([loadChart(patientId), currentUser()]);
  if (!can(team, 'patients.correct_identity')) redirect('/home?denied=1');
  const id = chart.canonicalId;
  const today = teamToday();
  const legal = chart.patient.fields.legalName;
  const birth = chart.patient.fields.birth;
  const legalValue = legal?.value as { given: string | null; family: string | null } | null | undefined;

  return (
    <>
      <h1 className="px-h1">Correct identity</h1>
      <p className="px-lede">
        Correct a legal name or date of birth, or record a patient’s request to change one that you decline.
        Each needs a reason; the old value stays in the chart’s history.
      </p>
      <p>
        {/* No prefetch: loading the chart logs a view. */}
        <Link href={`/patients/${id}`} prefetch={false}>
          Back to the chart
        </Link>
      </p>

      <section aria-labelledby="legal-heading" className="px-panel">
        <h2 id="legal-heading" className="px-h2">
          Legal name
        </h2>
        <p>
          On the chart now: <strong>{fieldValueText('legalName', legal?.value, today)}</strong>
        </p>
        <ActionForm id="legal" action={correctIdentity} label="Correct the legal name">
          <input type="hidden" name="patientId" value={id} />
          <input type="hidden" name="field" value="legalName" />
          {/* The version this page showed: a change since then is refused, never overwritten. */}
          <input type="hidden" name="baseVersion" value={legal?.version ?? 0} />
          <p className="sx-help">As the patient gives it. One part is enough.</p>
          <TextField
            name="given"
            label="Given name"
            autoComplete="off"
            maxLength={80}
            defaultValue={legalValue?.given ?? ''}
          />
          <TextField
            name="family"
            label="Family name"
            autoComplete="off"
            maxLength={80}
            defaultValue={legalValue?.family ?? ''}
          />
          <WhyFields />
          <div className="px-actions">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="birth-heading" className="px-panel">
        <h2 id="birth-heading" className="px-h2">
          Date of birth
        </h2>
        <p>
          On the chart now: <strong>{fieldValueText('birth', birth?.value, today)}</strong>
        </p>
        <ActionForm id="birth" action={correctIdentity} label="Correct the date of birth">
          <input type="hidden" name="patientId" value={id} />
          <input type="hidden" name="field" value="birth" />
          <input type="hidden" name="baseVersion" value={birth?.version ?? 0} />
          <BirthField>
            <WhyFields />
          </BirthField>
        </ActionForm>
      </section>
    </>
  );
}
