import 'server-only';
import type { Schemas } from '@sineobex/contract';
import { notFound } from 'next/navigation';
import { api, PortalApiError, unwrap } from '@/lib/api';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A patient's chart as the person's role may see it (the API projects it, design 4.3), or the
 * not-found page. Reading it logs a view; a merged ID answers the chart it was merged into.
 */
export async function loadChart(patientId: string): Promise<Schemas['PatientChart']> {
  if (!UUID.test(patientId)) notFound();
  try {
    return await unwrap((await api()).GET('/v1/patients/{patientId}', { params: { path: { patientId } } }));
  } catch (err) {
    if (err instanceof PortalApiError && err.status === 404) notFound();
    throw err;
  }
}
