import type { z } from '@hono/zod-openapi';
import { idLinkHandshake } from '../../patients/id-links.ts';
import { rejected, when, type EntityRules } from '../records.ts';
import { IdLinkCreate, valueParents } from './values.ts';

/**
 * Street Medicine ID links made on a phone (phase 3 design 10.4). The phone uses this one path,
 * online or not; the create is the handshake (patients/id-links.ts), which stores the link with
 * its final status, retires what it replaces, and writes its own audit events. A link that lost to
 * a newer card is accepted as retired, not rejected: the server stored it, and the worker can't fix
 * it. A link for a merged patient is a stale reference naming the survivor.
 */

type Value = z.infer<typeof IdLinkCreate>;

interface LinkRow {
  id: string;
  teamId: string;
  patientId: string;
  status: string;
  reason: string;
  replacesLinkId: string | null;
  effectiveAt: Date;
  madeOffline: boolean;
  issuedBy: string;
  receivedAt: Date;
}

export const idLinkRules: EntityRules<Value> = {
  entity: 'id_link',
  auditPrefix: 'id_link',
  permission: () => 'patients.edit',
  takesTeamLock: () => true,
  create: IdLinkCreate,
  parents: (v) => valueParents('id_link', 'create', undefined, v),
  parentsOfSet: () => [],

  async applyCreate(ctx, v) {
    const c = ctx.change;
    const result = await idLinkHandshake(
      ctx.tx,
      ctx.audit,
      {
        linkId: c.recordId,
        patientId: v.patientId,
        token: v.token,
        replacesLinkId: v.replacesLinkId,
        reason: v.reason,
        // Device time, corrected: a conflict between two phones goes to the newer card.
        effectiveAt: when(c),
        clockVerified: c.clockVerified,
        // The phone's path, decided by device time, whether or not it had signal.
        madeOffline: true,
        issuedBy: ctx.actor.authorId,
        deviceId: ctx.actor.deviceId,
        changeId: c.changeId,
      },
      'sync',
    );
    switch (result.status) {
      case 'accepted':
        return {
          status: 'accepted',
          serverVersion: 1,
          details: {
            linkOutcome: result.linkOutcome,
            activeLinkId: result.activeLinkId,
            retiredLinkIds: result.retiredLinkIds,
          },
        };
      case 'rejected':
        return rejected(result.reason, {
          problem: result.problem,
          ...(result.survivorId ? { survivorId: result.survivorId } : {}),
        });
      case 'link_changed':
        // Online issue only; the sync mode decides a stale card by effective time instead.
        throw new Error('the ID link handshake answered link_changed in sync mode');
    }
  },

  fieldClass: () => null,
  fieldSchema: () => null,

  async load(tx, id) {
    // Never the token: a snapshot is not where a card's link is copied from (design 10.2).
    const rows = await tx<LinkRow[]>`
      select id, team_id, patient_id, status, reason, replaces_link_id, effective_at, made_offline, issued_by,
             received_at
      from sineobex.patient_id_links where id = ${id}`;
    const r = rows[0];
    if (!r) return null;
    return {
      entity: 'id_link',
      id: r.id,
      teamId: r.teamId,
      status: r.status,
      authorUserId: r.issuedBy,
      version: 1,
      patientId: r.patientId,
      fieldVersions: {},
      fieldMeta: {},
      values: {},
      attributes: {
        patientId: r.patientId,
        reason: r.reason,
        replacesLinkId: r.replacesLinkId,
        effectiveAt: r.effectiveAt.toISOString(),
        madeOffline: r.madeOffline,
      },
      internal: {},
      createdAt: r.receivedAt,
      updatedAt: r.receivedAt,
    };
  },

  write: () => Promise.reject(new Error('an ID link is changed only by the handshake')),
};
