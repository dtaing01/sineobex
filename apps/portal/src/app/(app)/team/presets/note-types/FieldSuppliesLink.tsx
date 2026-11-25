'use client';

import Link from 'next/link';
import { useFormState } from '@/components/ActionForm';
import { namesFieldSupplies } from '@/lib/refusals';

/**
 * Under a refusal that asks the admin to remove field supply mappings (a note type they name can't
 * be removed, and an update that would hide what they read can't be taken in place), the way to
 * them: a mapping's note type can't be changed, so its own page is where it is removed (review B-8).
 */
export function FieldSuppliesLink() {
  const { error } = useFormState();
  if (!namesFieldSupplies(error)) return null;
  return (
    <p>
      <Link href="/team/presets/field-supplies">Go to Field supplies</Link>
    </p>
  );
}
