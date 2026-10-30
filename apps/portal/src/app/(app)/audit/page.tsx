import type { Metadata } from 'next';
import { AuditSearch } from '@/components/AuditSearch';
import { api, unwrap } from '@/lib/api';

export const metadata: Metadata = { title: 'Audit log' };

export default async function AuditPage() {
  const client = await api();
  const members = await unwrap(client.GET('/v1/team/members')).catch(() => []);
  return (
    <>
      <h1 className="px-h1">Audit log</h1>
      <p className="px-lede">
        Every sign-in, view, change and refusal for this team. Searching is itself logged.
      </p>
      <AuditSearch people={members.map((m) => ({ userId: m.userId, displayName: m.displayName }))} />
    </>
  );
}
