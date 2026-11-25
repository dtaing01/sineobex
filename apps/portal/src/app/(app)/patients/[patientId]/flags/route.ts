import type { NextRequest, NextResponse } from 'next/server';

/**
 * Set or clear a flag, posted by the Flags panel (phase 5 design 7, 8.1): `{id, flagId, action,
 * reason}`, the id made once for the form by the page, so a retry after a dropped answer is never a
 * second change (D115). A route handler, as phase 4's acts that keep what the person sees.
 *
 * Written ahead of its code (card P5-tests): it throws until card P5-portal-panel builds it.
 * route.test.ts says what it must answer.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string }> },
): Promise<NextResponse> {
  void request;
  void params;
  throw new Error('P5-portal-panel');
}
