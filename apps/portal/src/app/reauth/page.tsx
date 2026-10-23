import type { Metadata } from 'next';
import { reauthenticate } from '@/app/actions/auth';
import { ActionForm, SubmitButton, TextField } from '@/components/ActionForm';
import { AuthFrame } from '@/components/AuthFrame';
import { safeNext } from '@/lib/api';

export const metadata: Metadata = { title: 'Confirm it’s you' };

export default async function ReauthPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthFrame
      title="Confirm it’s you"
      lede="Changing staff access and running exports need a fresh code from your authenticator app."
    >
      <ActionForm id="reauth" action={reauthenticate} label="Confirm with authenticator code">
        <input type="hidden" name="next" value={safeNext(next)} />
        <TextField
          name="code"
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
        />
        <SubmitButton>Continue</SubmitButton>
      </ActionForm>
    </AuthFrame>
  );
}
