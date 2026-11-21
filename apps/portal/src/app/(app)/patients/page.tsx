import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, currentUser } from '@/lib/me';
import { SearchForm } from './SearchForm';

// Never a name: titles land in the history and on screen shares (module 9).
export const metadata: Metadata = { title: 'Patients' };

export default async function PatientsPage() {
  const { team } = await currentUser();
  if (!can(team, 'patients.view')) redirect('/home?denied=1');
  return (
    <>
      <h1 className="px-h1">Patients</h1>
      <p className="px-lede">
        Search by a name, a street name or what they look like, by a full date of birth, or both. Each search
        is logged with the people it shows; what you type is not.
      </p>
      <section aria-label="Search" className="px-panel">
        <SearchForm />
      </section>
    </>
  );
}
