import type { Metadata } from 'next';
import { signIn } from '@/app/actions/auth';
import { ActionForm, SubmitButton, TextField } from '@/components/ActionForm';
import { AuthFrame } from '@/components/AuthFrame';

export const metadata: Metadata = { title: 'Sign in' };

const ENDED: Record<string, string> = {
  idle: 'You were signed out after 15 minutes without activity, to protect patient privacy.',
  too_old: 'Your session reached its daily limit. Sign in again.',
  expired: 'Your session ended. Sign in again.',
  signed_out: 'You have signed out.',
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ ended?: string }> }) {
  const { ended } = await searchParams;
  const notice = ended ? ENDED[ended] : undefined;
  return (
    <AuthFrame
      title="Sign in"
      lede="Use your team account. Next you will enter a code from your authenticator app."
    >
      {notice && (
        <p role="status" className="px-alert px-alert--info">
          {notice}
        </p>
      )}
      <ActionForm id="signin" action={signIn} label="Sign in">
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
        />
        <TextField
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
        />
        <SubmitButton>Continue</SubmitButton>
      </ActionForm>
    </AuthFrame>
  );
}
