import type { Metadata } from 'next';
import Link from 'next/link';
import { changeCredential, changeRole, removeMember } from '@/app/actions/team';
import { ActionForm, SelectField, SubmitButton, TextField } from '@/components/ActionForm';
import { CredentialFields } from '@/components/CredentialFields';
import { api, unwrap } from '@/lib/api';
import { CREDENTIAL_LABELS, formatDateTime } from '@/lib/labels';
import { currentUser } from '@/lib/me';

export const metadata: Metadata = { title: 'Team member' };

const KIND_LABELS: Record<string, string> = {
  invited: 'Invited',
  restored: 'Re-invited',
  role: 'Role changed',
  credential: 'Credential changed',
  removed: 'Removed',
};

export default async function MemberPage({ params }: { params: Promise<{ membershipId: string }> }) {
  const { membershipId } = await params;
  const { me } = await currentUser();
  const client = await api();
  const [member, roles, history] = await Promise.all([
    unwrap(client.GET('/v1/team/members/{membershipId}', { params: { path: { membershipId } } })),
    unwrap(client.GET('/v1/team/roles')),
    unwrap(client.GET('/v1/team/members/{membershipId}/history', { params: { path: { membershipId } } })),
  ]);
  const adminLocked = member.role.key === 'program_admin' && !me.isOwner;
  const assignable = roles.filter((r) => !r.archived && (me.isOwner || r.key !== 'program_admin'));

  return (
    <>
      <p>
        <Link href="/team/members">← Team members</Link>
      </p>
      <h1 className="px-h1">{member.displayName}</h1>
      <dl className="px-facts">
        <div>
          <dt>Email</dt>
          <dd>{member.email}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{member.role.name}</dd>
        </div>
        <div>
          <dt>Credential</dt>
          <dd>{CREDENTIAL_LABELS[member.credential]}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{member.status === 'active' ? 'Active' : 'Removed'}</dd>
        </div>
      </dl>

      {member.status === 'active' && adminLocked && (
        <p className="px-alert px-alert--info">Only platform owners can change or remove a Program Admin.</p>
      )}

      {member.status === 'active' && !adminLocked && (
        <>
          <section aria-labelledby="role-heading" className="px-panel">
            <h2 id="role-heading" className="px-h2">
              Change role
            </h2>
            <ActionForm id="role" action={changeRole} label="Change role">
              <input type="hidden" name="membershipId" value={member.membershipId} />
              <SelectField
                name="roleId"
                label="New role"
                defaultValue={member.role.id}
                options={assignable.map((r) => ({ value: r.id, label: r.name }))}
              />
              <TextField name="reason" label="Reason" hint="Logged with the change." required />
              <SubmitButton>Change role</SubmitButton>
            </ActionForm>
          </section>

          <section aria-labelledby="cred-heading" className="px-panel">
            <h2 id="cred-heading" className="px-h2">
              Change credential
            </h2>
            <p className="sx-help">
              Moving up takes effect only once the new credential’s fields are filled in. Moving down removes
              permissions at once. Notes already signed keep the credential they were signed under.
            </p>
            <ActionForm id="cred" action={changeCredential} label="Change credential">
              <input type="hidden" name="membershipId" value={member.membershipId} />
              <CredentialFields
                defaultCredential={member.credential}
                defaults={member.credentialFields as Record<string, string>}
              />
              <TextField name="reason" label="Reason" hint="Logged with the change." required />
              <SubmitButton>Save credential</SubmitButton>
            </ActionForm>
          </section>

          <section aria-labelledby="remove-heading" className="px-panel">
            <h2 id="remove-heading" className="px-h2">
              Remove from team
            </h2>
            <p className="sx-help">
              Their sign-in stops working immediately. Records on their phone that never synced go to your
              quarantine queue for review.
            </p>
            <ActionForm id="remove" action={removeMember} label="Remove from team">
              <input type="hidden" name="membershipId" value={member.membershipId} />
              <TextField name="reason" label="Reason" required />
              <SubmitButton variant="danger">Remove access</SubmitButton>
            </ActionForm>
          </section>
        </>
      )}

      <section aria-labelledby="history-heading" className="px-panel">
        <h2 id="history-heading" className="px-h2">
          History
        </h2>
        <table className="px-table">
          <caption className="sr-only">Changes to this person’s access, newest first</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Change</th>
              <th scope="col">By</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {history.map((c) => (
              <tr key={c.id}>
                <td>{formatDateTime(c.changedAt)}</td>
                <td>{KIND_LABELS[c.kind] ?? c.kind}</td>
                <td>{c.changedBy.displayName}</td>
                <td>{c.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
