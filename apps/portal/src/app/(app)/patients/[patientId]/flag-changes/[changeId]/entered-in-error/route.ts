import type { NextRequest, NextResponse } from 'next/server';

/**
 * Mark a flag change entered in error, posted by the Flags panel (phase 5 design 7, 8.1): `{reason}`.
 * A retry after a dropped answer finds the mark made (409 `already_marked`) and is answered done.
 *
 * Written ahead of its code (card P5-tests): it throws until card P5-portal-panel builds it.
 * route.test.ts says what it must answer.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string; changeId: string }> },
): Promise<NextResponse> {
  void request;
  void params;
  throw new Error('P5-portal-panel');
}
