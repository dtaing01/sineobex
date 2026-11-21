import type { Metadata } from 'next';
import { queueRows, SignatureQueue } from '../cosign/SignatureQueue';

export const metadata: Metadata = { title: 'Attestation queue' };

/**
 * The attestation queue (lifecycle 5.4, 9.14): visits with a signed note waiting for an attending.
 * The API needs `encounters.chart` and a credential that attests, and logs the patients shown.
 */
export default async function AttestationQueuePage() {
  return <SignatureQueue act="attest" rows={await queueRows('attest')} />;
}
