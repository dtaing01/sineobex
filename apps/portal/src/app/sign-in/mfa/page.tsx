import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { verifyCode } from '@/app/actions/auth';
import { ActionForm, SubmitButton, TextField } from '@/components/ActionForm';
import { AuthFrame } from '@/components/AuthFrame';
import { getSession } from '@/lib/api';

export const metadata: Metadata = { title: 'Authenticator code' };

export default async function MfaPage() {
  const session = await getSession();
  if (!session.pending?.factorId) redirect(session.pending ? '/sign-in/mfa/enroll' : '/sign-in');
  return (
    <AuthFrame
      title="Enter your code"
      lede="Open your authenticator app (for example Microsoft Authenticator, Google Authenticator or Duo Mobile) and enter the 6-digit code for Sineobex."
    >
      <ActionForm id="mfa" action={verifyCode} label="Authenticator code">
        <TextField
          name="code"
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
        />
        <SubmitButton>Sign in</SubmitButton>
      </ActionForm>
    </AuthFrame>
  );
}
