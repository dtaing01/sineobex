'use server';

import type { Schemas } from '@sineobex/contract';
import { api, PortalApiError, unwrap } from '@/lib/api';

export interface AuditState {
  entries?: Schemas['AuditEntry'][];
  nextBeforeId?: string | null;
  error?: string;
  filters?: Record<string, string>;
  chain?: Schemas['ChainCheck'];
}

/** Searches by POST, so the person or patient being looked up never reaches a URL. */
export async function searchAudit(_: AuditState, form: FormData): Promise<AuditState> {
  const filters: Record<string, string> = {};
  for (const k of ['actorUserId', 'actionPrefix', 'from', 'to']) {
    const v = String(form.get(k) ?? '').trim();
    if (v) filters[k] = v;
  }
  const body: Schemas['AuditSearch'] = { limit: 100 };
  if (filters.actorUserId) body.actorUserId = filters.actorUserId;
  if (filters.actionPrefix) body.actionPrefix = filters.actionPrefix;
  // Dates from <input type="date"> are local days in Detroit; send whole-day bounds in UTC.
  if (filters.from) body.from = new Date(`${filters.from}T00:00:00-04:00`).toISOString();
  if (filters.to) body.to = new Date(`${filters.to}T23:59:59-04:00`).toISOString();
  try {
    const page = await unwrap((await api()).POST('/v1/team/audit/search', { body }));
    return { entries: page.entries, nextBeforeId: page.nextBeforeId, filters };
  } catch (err) {
    if (err instanceof PortalApiError) return { error: err.message, filters };
    throw err;
  }
}

export async function verifyChain(state: AuditState): Promise<AuditState> {
  const chain = await unwrap((await api()).POST('/v1/team/audit/verify'));
  return { ...state, chain };
}
