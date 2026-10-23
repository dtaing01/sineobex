import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { appointAdmin, createTeam, setTeamStatus } from '@/app/actions/owner';
import { ActionForm, SubmitButton, TextField } from '@/components/ActionForm';
import { api, unwrap } from '@/lib/api';
import { currentUser } from '@/lib/me';

export const metadata: Metadata = { title: 'Owner console' };

export default async function OwnerPage() {
  const { me } = await currentUser();
  if (!me.isOwner) redirect('/home');
  const teams = await unwrap((await api({ team: false })).GET('/v1/owner/teams'));
  return (
    <>
      <h1 className="px-h1">Owner console</h1>
      <p className="px-lede">
        Create teams and appoint their Program Admins. Program Admins manage their own staff.
      </p>
      {teams.map((t) => (
        <section key={t.id} aria-labelledby={`team-${t.id}`} className="px-panel">
          <h2 id={`team-${t.id}`} className="px-h2">
            {t.name}{' '}
            {t.status === 'suspended' && <span className="sx-pill sx-pill--critical">Suspended</span>}
          </h2>
          <p className="sx-help">{t.activeMembers} active members</p>
          <h3 className="px-h3">Program Admins</h3>
          {t.programAdmins.length === 0 ? (
            <p>None yet.</p>
          ) : (
            <ul className="px-list">
              {t.programAdmins.map((a) => (
                <li key={a.membershipId}>
                  {a.displayName} ({a.email})
                </li>
              ))}
            </ul>
          )}
          <ActionForm
            id={`appoint-${t.id}`}
            action={appointAdmin}
            label={`Appoint a Program Admin for ${t.name}`}
          >
            <input type="hidden" name="teamId" value={t.id} />
            <TextField name="displayName" label="Name" required />
            <TextField name="email" label="Email" type="email" required />
            <SubmitButton variant="secondary">Appoint Program Admin</SubmitButton>
          </ActionForm>
          <ActionForm
            id={`status-${t.id}`}
            action={setTeamStatus}
            label={`${t.status === 'active' ? 'Suspend' : 'Reinstate'} ${t.name}`}
          >
            <input type="hidden" name="teamId" value={t.id} />
            <input type="hidden" name="status" value={t.status === 'active' ? 'suspended' : 'active'} />
            <TextField name="reason" label="Reason" required />
            <SubmitButton variant={t.status === 'active' ? 'danger' : 'secondary'}>
              {t.status === 'active' ? 'Suspend team' : 'Reinstate team'}
            </SubmitButton>
          </ActionForm>
        </section>
      ))}
      <section aria-labelledby="new-team" className="px-panel">
        <h2 id="new-team" className="px-h2">
          New team
        </h2>
        <ActionForm id="newteam" action={createTeam} label="Create a team">
          <TextField name="name" label="Team name" required />
          <SubmitButton>Create team</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
