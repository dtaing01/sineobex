import type { Metadata } from 'next';
import { createRole } from '@/app/actions/team';
import { ActionForm, SubmitButton, TextField } from '@/components/ActionForm';
import { PermissionPicker } from '@/components/PermissionPicker';
import { api, unwrap } from '@/lib/api';

export const metadata: Metadata = { title: 'Roles' };

export default async function RolesPage() {
  const client = await api();
  const [roles, catalog] = await Promise.all([
    unwrap(client.GET('/v1/team/roles')),
    unwrap(client.GET('/v1/permissions')),
  ]);
  const describe = new Map(catalog.map((p) => [p.key, p.description]));
  return (
    <>
      <h1 className="px-h1">Roles</h1>
      <p className="px-lede">
        A role decides which screens and patients someone can reach. Clinical acts also depend on their
        credential.
      </p>
      {roles
        .filter((r) => !r.archived)
        .map((r) => (
          <section key={r.id} aria-labelledby={`role-${r.id}`} className="px-panel">
            <h2 id={`role-${r.id}`} className="px-h2">
              {r.name}{' '}
              {r.isStandard ? (
                <span className="sx-pill sx-pill--neutral">Standard</span>
              ) : (
                <span className="sx-pill sx-pill--info">Custom</span>
              )}
            </h2>
            {r.description && <p>{r.description}</p>}
            <p className="sx-help">
              {r.memberCount} {r.memberCount === 1 ? 'person' : 'people'}
            </p>
            <ul className="px-list">
              {r.permissions.map((p) => (
                <li key={p}>{describe.get(p) ?? p}</li>
              ))}
            </ul>
          </section>
        ))}
      <section aria-labelledby="new-role" className="px-panel">
        <h2 id="new-role" className="px-h2">
          New custom role
        </h2>
        <p className="sx-help">
          Combine existing permissions. Program Admin permissions stay with Program Admins.
        </p>
        <ActionForm id="newrole" action={createRole} label="New custom role">
          <TextField name="name" label="Name" required />
          <TextField name="description" label="What this role is for" />
          <PermissionPicker catalog={catalog} />
          <SubmitButton>Create role</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
