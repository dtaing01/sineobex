/**
 * What each person accepts at first sign-in (Business strategy, BAA): the Terms of Use and a
 * confidentiality acknowledgement. The organization's BAA is signed once per team, separately.
 * Bumping a version makes everyone accept again at their next request.
 *
 * PLAN-OPEN: the texts are drafted by counsel ("Draft Terms of Service and standard BAA").
 */
export const REQUIRED_ACKNOWLEDGEMENTS = [
  { kind: 'terms_of_use', version: '2026-10-20' },
  { kind: 'confidentiality', version: '2026-10-20' },
] as const;

export type AcknowledgementKind = (typeof REQUIRED_ACKNOWLEDGEMENTS)[number]['kind'];
