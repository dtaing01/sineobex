import type { Metadata } from 'next';
import { acknowledge } from '@/app/actions/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { AuthFrame } from '@/components/AuthFrame';
import { CheckboxField } from '@/components/CheckboxField';

export const metadata: Metadata = { title: 'Before you start' };

export default function AcknowledgePage() {
  return (
    <AuthFrame
      title="Before you start"
      lede="Everyone accepts these once. Your organization signs its business associate agreement separately."
    >
      {/* PLAN-OPEN: final wording comes from counsel ("Draft Terms of Service and standard BAA"). */}
      <section aria-labelledby="terms-heading" className="px-doc">
        <h2 id="terms-heading">Terms of Use</h2>
        <p>
          Sineobex is provided to your team for documenting care. Use it only for your team’s work, keep your
          sign-in to yourself, and report a lost phone to your Program Admin straight away.
        </p>
      </section>
      <section aria-labelledby="conf-heading" className="px-doc">
        <h2 id="conf-heading">Confidentiality</h2>
        <p>
          Patient information is confidential. Open only the records you need for the care you are giving,
          never copy patient details into other apps, and know that every view and change is logged.
        </p>
      </section>
      <ActionForm id="ack" action={acknowledge} label="Accept">
        <CheckboxField name="terms_of_use" label="I accept the Terms of Use" />
        <CheckboxField
          name="confidentiality"
          label="I understand and will follow the confidentiality rules"
        />
        <SubmitButton>Continue</SubmitButton>
      </ActionForm>
    </AuthFrame>
  );
}
