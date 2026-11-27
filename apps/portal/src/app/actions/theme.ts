'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';

/** Stores the viewer's theme. A display preference, never patient data. */
export async function setTheme(form: FormData): Promise<void> {
  const choice = parseTheme(String(form.get('theme') ?? ''));
  const jar = await cookies();
  jar.set(THEME_COOKIE, choice, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect('/');
}
