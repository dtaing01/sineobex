import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { beginEnrollment, finishEnrollment } from '@/app/actions/auth';
import { ActionForm, SubmitButton, TextField } from '@/components/ActionForm';
import { AuthFrame } from '@/components/AuthFrame';
import { getSession } from '@/lib/api';

export const metadata: Metadata = { title: 'Set up your authenticator' };

export default async function EnrollPage() {
  const session = await getSession();
  if (!session.pending) redirect('/sign-in');
  const enrollment = session.pending.enrollment;
  return (
    <AuthFrame
      title="Set up your authenticator"
      lede="Sineobex needs a second step at every sign-in. Use an authenticator app you already have; Sineobex never sends codes by text message."
    >
      {!enrollment ? (
        <form action={beginEnrollment} className="px-form">
          <button type="submit" className="sx-btn sx-btn--primary">
            Start setup
          </button>
        </form>
      ) : (
        <>
          <ol className="px-steps">
            <li>In your authenticator app, add an account and scan this code.</li>
            <li>Then enter the 6-digit code the app shows.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the identity provider */}
          <img
            src={enrollment.qrImage}
            alt="QR code for adding Sineobex to your authenticator app"
            width={180}
            height={180}
            className="px-qr"
          />
          <p>
            Can’t scan? Enter this key instead: <code className="sx-data">{enrollment.secret}</code>
          </p>
          <ActionForm id="enroll" action={finishEnrollment} label="Confirm authenticator">
            <TextField
              name="code"
              label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
            <SubmitButton>Finish setup</SubmitButton>
          </ActionForm>
        </>
      )}
    </AuthFrame>
  );
}
