import type { Metadata } from 'next';
import Link from 'next/link';
import { inviteMember } from '@/app/actions/team';
import { ActionForm, SelectField, SubmitButton, TextField } from '@/components/ActionForm';
import { CredentialFields } from '@/components/CredentialFields';
import { api, unwrap } from '@/lib/api';
import { CREDENTIAL_LABELS, formatDateTime } from '@/lib/labels';
import { can, currentUser } from '@/lib/me';

export const metadata: Metadata = { title: 'Team members' };

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ removed?: string }> }) {
  const { removed } = await searchParams;
  const { me, team } = await currentUser();
  const client = await api();
  const [members, roles] = await Promise.all([
    unwrap(client.GET('/v1/team/members')),
    unwrap(client.GET('/v1/team/roles')),
  ]);
  const manage = can(team, 'team.manage_users');
  const assignable = roles.filter((r) => !r.archived && (me.isOwner || r.key !== 'program_admin'));
  const active = members.filter((m) => m.status === 'active');
  const former = members.filter((m) => m.status === 'removed');

  return (
    <>
      <h1 className="px-h1">Team members</h1>
      {removed && (
        <p role="status" className="px-alert px-alert--ok">
          Access removed. Their sessions stopped working at once.
        </p>
      )}
      <section aria-labelledby="active-heading" className="px-panel">
        <h2 id="active-heading" className="px-h2">
          Active ({active.length})
        </h2>
        <table className="px-table">
          <caption className="sr-only">Active team members</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Credential</th>
              <th scope="col">Invited</th>
            </tr>
          </thead>
          <tbody>
            {active.map((m) => (
              <tr key={m.membershipId}>
                <th scope="row">
                  {manage ? (
                    <Link href={`/team/members/${m.membershipId}`}>{m.displayName}</Link>
                  ) : (
                    m.displayName
                  )}
                </th>
                <td>{m.role.name}</td>
                <td>{CREDENTIAL_LABELS[m.credential]}</td>
                <td>{formatDateTime(m.invitedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {manage && (
        <section aria-labelledby="invite-heading" className="px-panel">
          <h2 id="invite-heading" className="px-h2">
            Invite someone
          </h2>
          <p className="sx-help">
            They get an email to set a password, then set up an authenticator app at first sign-in.
          </p>
          <ActionForm id="invite" action={inviteMember} label="Invite someone">
            <TextField name="displayName" label="Name" autoComplete="off" required />
            <TextField name="email" label="Email" type="email" autoComplete="off" required />
            <SelectField
              name="roleId"
              label="Role"
              options={assignable.map((r) => ({ value: r.id, label: r.name }))}
              defaultValue={assignable.find((r) => r.key === 'healthcare_staff')?.id}
              hint="Program Admins are appointed by platform owners."
            />
            <CredentialFields />
            <SubmitButton>Send invitation</SubmitButton>
          </ActionForm>
        </section>
      )}

      {former.length > 0 && (
        <section aria-labelledby="former-heading" className="px-panel">
          <h2 id="former-heading" className="px-h2">
            Removed ({former.length})
          </h2>
          <ul className="px-list">
            {former.map((m) => (
              <li key={m.membershipId}>
                {manage ? (
                  <Link href={`/team/members/${m.membershipId}`}>{m.displayName}</Link>
                ) : (
                  m.displayName
                )}{' '}
                · removed {m.removedAt ? formatDateTime(m.removedAt) : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
