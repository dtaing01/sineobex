'use client';

import { useFormState } from '@/components/ActionForm';

/**
 * The version a preset form was opened at, posted as `baseVersion` (phase 5 design 5.1, 7). A
 * refused form keeps the version it sent, though the page around it is read again after every
 * action: a form refused stale stays stale until the page is reloaded and the person has seen the
 * other version, so what they typed never overwrites it unseen.
 */
export function BaseVersion({ version }: { version: number }) {
  const sent = useFormState().values?.baseVersion;
  return <input type="hidden" name="baseVersion" value={sent ?? String(version)} />;
}
