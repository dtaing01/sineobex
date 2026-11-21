import type { Metadata } from 'next';
import { selectTeam } from '@/app/actions/auth';
import { AuthFrame } from '@/components/AuthFrame';
import { api, unwrap } from '@/lib/api';

export const metadata: Metadata = { title: 'Choose a team' };

const PROBLEMS: Record<string, string> = {
  not_a_member: 'You are no longer on that team.',
  team_suspended: 'That team is suspended. Contact Sineobex support.',
  team_required: 'Choose the team you are working with.',
};

export default async function SelectTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>;
}) {
  const { problem } = await searchParams;
  const me = await unwrap((await api({ team: false })).GET('/v1/me'));
  return (
    <AuthFrame title="Choose a team" lede={`Signed in as ${me.user.displayName}.`}>
      {problem && PROBLEMS[problem] && (
        <p role="alert" className="px-alert px-alert--error">
          {PROBLEMS[problem]}
        </p>
      )}
      {me.teams.length === 0 ? (
        <p>You are not on any team yet. Ask your Program Admin to invite you.</p>
      ) : (
        <ul className="px-choices">
          {me.teams.map((t) => (
            <li key={t.teamId}>
              <form action={selectTeam}>
                <input type="hidden" name="teamId" value={t.teamId} />
                <button
                  type="submit"
                  className="sx-btn sx-btn--secondary px-choice"
                  disabled={t.teamStatus !== 'active'}
                >
                  <span className="px-choice__title">{t.teamName}</span>
                  <span className="px-choice__meta">
                    {t.roleName}
                    {t.teamStatus !== 'active' ? ' · suspended' : ''}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {me.isOwner && (
        <p>
          <a href="/owner">Open the owner console</a>
        </p>
      )}
    </AuthFrame>
  );
}
