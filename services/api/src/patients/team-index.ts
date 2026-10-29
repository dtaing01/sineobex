import type { TeamScope } from '../auth/context.ts';
import { groupRedirects } from './charts.ts';
import { birthFromRow, duplicateHints } from './projection.ts';
import type { IndexEntryValue, TeamIndexInput, TeamIndexPageValue } from './schemas.ts';

/**
 * The projection every eligible role gets in phase 3 (design 6.1). Phase 5 adds `idx1+sens` for
 * sensitive secondary flags; a role change that changes the key forces a new download.
 */
export const INDEX_PROJECTION = 'idx1';

/** Street names an entry lists: the group's, then the preferred names of records merged into it. */
export const INDEX_ALIASES = 20;

// PLAN-OPEN: index timing and lifetime (design 14.1, #22): pages of 500 (100-1000), 7 days on the
// phone, refreshed after syncs and every 15 minutes. The page size is the request's.

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * POST /v1/patients/index (phase 3 design 6.1, 6.2): the team search index for a phone, keyset-paged.
 * `have` equal to the current version answers `unchanged`; the first page carries the team's
 * complete redirect list. The route has already checked mayHoldTeamIndex. Each page is audited as
 * `patient.index_downloaded {version, after, next, count}` (D33); `unchanged` writes nothing.
 *
 * An entry holds only the PRD's list plus bookkeeping: never a legal name or anything derived from
 * one (D40), living situation, language, consents, problems, notes, tokens or history.
 */
export async function teamIndexPage(scope: TeamScope, input: TeamIndexInput): Promise<TeamIndexPageValue> {
  return scope.tx(async (tx, audit) => {
    const [counter] = await tx<{ version: string }[]>`
      select version::text from sineobex.team_index_versions where team_id = sineobex.current_team_id()`;
    const version = `${counter?.version ?? '0'}.${INDEX_PROJECTION}`;
    const generatedAt = scope.deps.now().toISOString();
    const base = { version, projection: INDEX_PROJECTION, generatedAt };
    if (input.after === undefined && input.have === version)
      return { ...base, status: 'unchanged', entries: [], next: null, redirects: [] };

    const rows = await tx<
      {
        id: string;
        preferredName: string | null;
        visualDescriptor: string | null;
        birthPrecision: string | null;
        birthDate: string | null;
        birthYear: number | null;
        usualArea: string | null;
        allergyScreen: 'not_asked' | 'none_known';
        fieldVersions: Record<string, number>;
        lastSeenAt: Date | null;
        aliases: { id: string; alias: string }[];
        mergedNames: string[];
        allergies: IndexEntryValue['allergies'];
        idLinks: { id: string; effectiveAt: string }[];
        reviews: string[];
      }[]
    >`
      select p.id, p.preferred_name, p.visual_descriptor, p.birth_precision,
             to_char(p.birth_date, 'YYYY-MM-DD') as birth_date, p.birth_year, p.usual_area, p.allergy_screen,
             p.field_versions,
             (select max(g.last_seen_at) from sineobex.patients g
              where g.team_id = p.team_id and g.canonical_id = p.id) as last_seen_at,
             coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'alias', a.alias) order by a.created_at, a.id)
                       from sineobex.patient_aliases a
                       join sineobex.patients g on g.team_id = a.team_id and g.id = a.patient_id
                       where a.team_id = p.team_id and g.canonical_id = p.id and a.status = 'active'),
                      '[]') as aliases,
             array(select g.preferred_name
                   from sineobex.patients g
                   left join sineobex.patient_merges m
                     on m.team_id = g.team_id and m.merged_id = g.id and m.undone_at is null
                   where g.team_id = p.team_id and g.canonical_id = p.id and g.id <> p.id
                     and g.preferred_name is not null
                   order by m.merged_at, g.id) as merged_names,
             coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'substance', a.substance,
                                                           'category', a.category, 'severity', a.severity)
                                        order by a.recorded_at, a.id)
                       from sineobex.patient_allergies a
                       join sineobex.patients g on g.team_id = a.team_id and g.id = a.patient_id
                       where a.team_id = p.team_id and g.canonical_id = p.id and a.status = 'active'),
                      '[]') as allergies,
             coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'effectiveAt',
                                          to_char(l.effective_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                                        order by l.effective_at, l.id)
                       from sineobex.patient_id_links l
                       join sineobex.patients g on g.team_id = l.team_id and g.id = l.patient_id
                       where l.team_id = p.team_id and g.canonical_id = p.id and l.status = 'active'),
                      '[]') as id_links,
             array(select distinct r.field from sineobex.field_reviews r
                   join sineobex.patients g on g.team_id = r.team_id and g.id = r.patient_id
                   where r.team_id = p.team_id and g.canonical_id = p.id and r.status = 'open'
                   order by r.field) as reviews
      from sineobex.patients p
      where p.team_id = sineobex.current_team_id() and p.status = 'active'
        ${input.after === undefined ? tx`` : tx`and p.id > ${input.after}::uuid`}
      order by p.id
      limit ${input.limit + 1}`;
    const page = rows.slice(0, input.limit);
    const hints = await duplicateHints(
      tx,
      page.map((r) => r.id),
    );
    const entries: IndexEntryValue[] = page.map((r) => {
      // A merged record's preferred name finds the survivor offline, but it is no street name record:
      // no ID, so a phone can't send a removal the server could never apply.
      const aliases: IndexEntryValue['aliases'] = r.aliases.map((a) => ({ ...a, kind: 'alias' }));
      for (const name of r.mergedNames) {
        if (name !== r.preferredName && !aliases.some((a) => a.alias === name))
          aliases.push({ id: null, alias: name, kind: 'merged_name' });
      }
      return {
        patientId: r.id,
        preferredName: r.preferredName,
        aliases: aliases.slice(0, INDEX_ALIASES),
        visualDescriptor: r.visualDescriptor,
        birth: birthFromRow(r),
        usualArea: r.usualArea,
        lastSeenOn: r.lastSeenAt ? isoDay(r.lastSeenAt) : null,
        allergyScreen: r.allergyScreen,
        allergies: r.allergies,
        idLinks: r.idLinks,
        duplicate: hints.get(r.id) ?? null,
        reviews: r.reviews,
        versions: {
          preferredName: r.fieldVersions.preferredName ?? 0,
          visualDescriptor: r.fieldVersions.visualDescriptor ?? 0,
          usualArea: r.fieldVersions.usualArea ?? 0,
          allergyScreen: r.fieldVersions.allergyScreen ?? 0,
        },
      };
    });
    const next = rows.length > input.limit ? page[page.length - 1]!.id : null;
    // The first page's list is the team's complete one, which the phone's swap treats as the truth.
    const redirects = input.after === undefined ? await groupRedirects(tx, null) : [];
    await audit({
      action: 'patient.index_downloaded',
      patientId: null,
      details: { version, after: input.after ?? null, next, count: entries.length },
    });
    return { ...base, status: 'page', entries, next, redirects };
  });
}
