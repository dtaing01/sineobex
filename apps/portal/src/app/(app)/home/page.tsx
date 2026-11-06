import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can, currentUser } from '@/lib/me';

export const metadata: Metadata = { title: 'Home' };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const { me, team } = await currentUser();
  if (!team) redirect(me.isOwner ? '/owner' : '/select-team');
  return (
    <>
      {denied && (
        <p role="alert" className="px-alert px-alert--error">
          Your role doesn’t allow that screen. The attempt was logged.
        </p>
      )}
      <h1 className="px-h1">{team.teamName}</h1>
      <p className="px-lede">
        You are signed in as {team.roleName}
        {team.credential !== 'none' ? ` (${team.credential.toUpperCase()})` : ''}.
      </p>
      <ul className="px-cards">
        {can(team, 'team.manage_users') && (
          <li className="px-card">
            <h2>
              <Link href="/team/members">Team members</Link>
            </h2>
            <p>Invite staff, change roles and credentials, remove access.</p>
          </li>
        )}
        {can(team, 'team.view_audit') && (
          <li className="px-card">
            <h2>
              <Link href="/audit">Audit log</Link>
            </h2>
            <p>Who opened or changed what, and when.</p>
          </li>
        )}
      </ul>
    </>
  );
}
