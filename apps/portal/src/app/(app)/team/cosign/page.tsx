import type { Metadata } from 'next';
import { queueRows, SignatureQueue } from './SignatureQueue';

export const metadata: Metadata = { title: 'Co-sign queue' };

/**
 * The co-sign queue (lifecycle 5.4, 9.14): visits with a Medical note waiting for a co-signer. The
 * API needs `encounters.chart` and a credential that signs, and logs the patients shown.
 */
export default async function CosignQueuePage() {
  return <SignatureQueue act="cosign" rows={await queueRows('cosign')} />;
}
