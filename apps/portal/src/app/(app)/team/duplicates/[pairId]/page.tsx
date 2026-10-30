import type { Schemas } from '@sineobex/contract';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDay, madeAt, mergeConsequences, recordName, SideBySide, who } from '@/components/SideBySide';
import { api, PortalApiError, unwrap } from '@/lib/api';
import { teamToday } from '@/lib/dob';
import { formatDateTime, matchReasons } from '@/lib/labels';
import { BAND, PAIR_STATUS, SOURCE } from '../pairs';
import { DecisionForm, type PairRecord } from './DecisionForm';

export const metadata: Metadata = { title: 'Compare records' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DECISION: Record<Schemas['DuplicateDecisionView']['decision'], string> = {
  merge: 'Merged',
  keep_separate: 'Kept separate',
  not_sure: 'Not sure',
  undo_merge: 'Merge undone',
  flagged_by_staff: 'Reported as the same person',
};

export default async function ComparePage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  if (!UUID.test(pairId)) notFound();
  let detail: Schemas['DuplicatePairDetail'];
  try {
    detail = await unwrap(
      (await api()).GET('/v1/team/duplicates/{pairId}', { params: { path: { pairId } } }),
    );
  } catch (err) {
    if (err instanceof PortalApiError && err.status === 404) notFound();
    throw err;
  }
  const { pair, a, b } = detail;
  const aIsOlder = Date.parse(madeAt(a)) <= Date.parse(madeAt(b));
  const record = (side: 'a' | 'b'): PairRecord => {
    const p = pair[side];
    const s = detail[side];
    return {
      id: p.patientId,
      label: `Record ${side.toUpperCase()}: ${who(p.summary)}, made ${formatDay(madeAt(s))}`,
      older: side === 'a' ? aIsOlder : !aIsOlder,
      consequences: mergeConsequences(detail, p.patientId),
    };
  };
  const newer = aIsOlder ? b : a;
  const open = pair.status === 'open' || pair.status === 'not_sure';

  return (
    <>
      <p>
        <Link href="/team/duplicates">← Duplicates</Link>
      </p>
      <h1 className="px-h1">Compare records</h1>
      <p className="px-lede">
        {BAND[pair.band]}. Flagged {formatDay(pair.firstFlaggedAt)},{' '}
        {pair.sources.map((s) => SOURCE[s]).join('; ')}. {PAIR_STATUS[pair.status]}.
      </p>
      <section aria-labelledby="matched" className="px-doc">
        <h2 id="matched" className="px-h2">
          Why they were flagged
        </h2>
        <p>
          {pair.reasons.length > 0
            ? matchReasons(pair.reasons)
            : 'Reported by staff; the names didn’t match.'}
        </p>
        {pair.creatorDismissed && (
          <p>
            {newer.createdBy.displayName} saw this match when making the newer record and said it was someone
            else.
          </p>
        )}
        {pair.note && <p>Note for field staff: {pair.note}</p>}
      </section>
      <SideBySide detail={detail} today={teamToday()} />
      <p>
        Full charts:{' '}
        <Link href={`/patients/${pair.a.patientId}`}>Record A, {recordName(pair.a.summary)}</Link>
        {' · '}
        <Link href={`/patients/${pair.b.patientId}`}>Record B, {recordName(pair.b.summary)}</Link>
      </p>
      <section aria-labelledby="decisions" className="px-doc">
        <h2 id="decisions" className="px-h2">
          Decisions so far
        </h2>
        {detail.decisions.length === 0 ? (
          <p>None yet.</p>
        ) : (
          <ol className="px-list">
            {detail.decisions.map((d) => (
              <li key={d.id}>
                <strong>{DECISION[d.decision]}</strong>, {formatDateTime(d.decidedAt)} by{' '}
                {d.decidedBy.displayName}: {d.comment}
              </li>
            ))}
          </ol>
        )}
      </section>
      {open ? (
        <section aria-labelledby="decide-heading" className="px-panel">
          <h2 id="decide-heading" className="px-h2">
            Decide
          </h2>
          <DecisionForm
            pairId={pair.id}
            versions={{ a: a.version, b: b.version }}
            records={[record('a'), record('b')]}
          />
        </section>
      ) : (
        <p className="px-panel">This pair is decided: {PAIR_STATUS[pair.status]}.</p>
      )}
    </>
  );
}
