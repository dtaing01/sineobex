import Link from 'next/link';
import { signOut, stayActive } from '@/app/actions/auth';
import { IdleWarning } from '@/components/IdleWarning';
import { NavLink } from '@/components/NavLink';
import { can, currentUser } from '@/lib/me';
import { IDLE_MINUTES, IDLE_WARNING_SECONDS } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, team } = await currentUser();
  const nav = [
    { href: '/home', label: 'Home', show: !!team },
    // Patients (phase 3 design 12.2): existing permissions only (D37), the same rules the API checks.
    { href: '/patients', label: 'Patients', show: can(team, 'patients.view') },
    {
      href: '/team/reviews',
      label: 'Reviews',
      show: can(team, 'patients.edit') || can(team, 'patients.correct_identity'),
    },
    { href: '/team/duplicates', label: 'Duplicates', show: can(team, 'patients.review_duplicates') },
    {
      href: '/team/merges',
      label: 'Merges',
      show: can(team, 'patients.review_duplicates') || can(team, 'patients.correct_identity'),
    },
    {
      href: '/team/problem-reversals',
      label: 'Problem reversals',
      show: can(team, 'patients.reverse_resolved'),
    },
    {
      href: '/team/members',
      label: 'Team members',
      show: can(team, 'team.manage_users') || can(team, 'routes.manage'),
    },
    { href: '/team/roles', label: 'Roles', show: can(team, 'team.manage_users') },
    { href: '/team/devices', label: 'Phones', show: can(team, 'devices.manage') },
    { href: '/team/quarantine', label: 'Quarantine', show: can(team, 'quarantine.review') },
    { href: '/audit', label: 'Audit log', show: can(team, 'team.view_audit') },
    { href: '/owner', label: 'Owner console', show: me.isOwner },
  ].filter((n) => n.show);

  return (
    <>
      <header className="px-top">
        <Link href="/home" className="px-brand">
          Sineobex
        </Link>
        <div className="px-who">
          <span>
            {me.user.displayName}
            {team ? ` · ${team.teamName}` : ''}
          </span>
          {me.teams.length > 1 && <Link href="/select-team">Switch team</Link>}
          <form action={signOut}>
            <button type="submit" className="sx-btn sx-btn--secondary">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="px-layout">
        <nav aria-label="Portal" className="px-nav">
          <ul>
            {nav.map((n) => (
              <li key={n.href}>
                <NavLink href={n.href}>{n.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" tabIndex={-1} className="px-main">
          {children}
        </main>
      </div>
      <IdleWarning idleMinutes={IDLE_MINUTES} warningSeconds={IDLE_WARNING_SECONDS} stayAction={stayActive} />
    </>
  );
}
