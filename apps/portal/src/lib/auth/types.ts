/**
 * The portal's one sign-in interface (Build plan: "Sign-in hides behind one interface that accepts
 * any OIDC token"). Supabase Auth in the preview, Amazon Cognito in production, a local dev
 * provider for development and end-to-end tests. Tokens never reach the browser: they live in the
 * sealed, httpOnly session cookie and are used only by the portal's server.
 */
export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export type SignInResult =
  | { status: 'signed_in'; tokens: Tokens }
  | { status: 'mfa_challenge'; tokens: Tokens; factorId: string }
  | { status: 'mfa_enroll'; tokens: Tokens };

export interface Enrollment {
  factorId: string;
  /** An image data URL of the QR code to scan with an authenticator app. */
  qrImage: string;
  /** The same secret as text, for people who can't scan. */
  secret: string;
}

export type AuthErrorCode = 'invalid_credentials' | 'invalid_code' | 'session_expired' | 'unavailable';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthProvider {
  readonly kind: 'supabase' | 'dev';
  signIn(email: string, password: string): Promise<SignInResult>;
  startEnrollment(tokens: Tokens): Promise<Enrollment>;
  /** Proves the authenticator code and returns MFA-level (aal2) tokens. */
  verifyMfa(tokens: Tokens, factorId: string, code: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  signOut(tokens: Tokens): Promise<void>;
}
