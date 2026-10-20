import { z } from '@hono/zod-openapi';
import { Reason, Uuid } from '../routes/schemas.ts';

/** Wire format for module 9's change log, receipts, devices and quarantine. */

const DateTime = z.string().datetime({ offset: true });
const Hash = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .openapi({ description: 'SHA-256 of the canonical JSON of the value, lowercase hex' });
const Base64Url = (bytes: number) =>
  z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((bytes * 4) / 3)}}$`));

export const ChangeEntity = z.enum(['encounter', 'encounter_note', 'audit']).openapi('ChangeEntity');
export const RecordEntity = z.enum(['encounter', 'encounter_note']).openapi('RecordEntity');
export type RecordEntityName = z.infer<typeof RecordEntity>;

export const SyncChange = z
  .object({
    changeId: Uuid,
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).openapi({ description: 'Per-device sequence' }),
    entity: ChangeEntity,
    recordId: Uuid,
    op: z.enum(['create', 'set', 'append']),
    field: z.string().min(1).max(200).optional(),
    value: z.unknown().openapi({ description: 'Required; null is a value' }),
    valueHash: Hash,
    baseVersion: z
      .number()
      .int()
      .min(0)
      .default(0)
      .openapi({ description: 'The field version the user saw' }),
    follows: Uuid.optional().openapi({
      description: 'An earlier change from this device to the same field that this one builds on',
    }),
    supersedes: Uuid.optional().openapi({ description: 'A rejected change this one fixes' }),
    conflictOf: Uuid.optional().openapi({ description: 'The conflicted change this one resolves' }),
    resolution: z.enum(['replace', 'keep_server']).optional(),
    deviceTime: DateTime,
    correctedTime: DateTime.optional().openapi({
      description: 'Device time corrected by the last measured offset',
    }),
    clockVerified: z.boolean().default(false),
  })
  .openapi('SyncChange');
export type SyncChangeInput = z.infer<typeof SyncChange>;

export const RejectReason = z
  .enum(['validation', 'signing_rule', 'stale_reference', 'permission', 'record_locked', 'hash_mismatch'])
  .openapi('RejectReason');
export type RejectReasonName = z.infer<typeof RejectReason>;

export const FieldState = z
  .object({
    value: z.unknown(),
    version: z.number().int(),
    changedBy: Uuid.nullable(),
    changedAt: DateTime.nullable(),
  })
  .openapi('FieldState');
export type FieldStateValue = z.infer<typeof FieldState>;

export const SyncResult = z
  .object({
    changeId: Uuid,
    status: z.enum(['accepted', 'rejected', 'conflict']),
    serverVersion: z.number().int().optional(),
    hash: Hash.optional().openapi({
      description: 'The server’s hash of what it stored; purge only on a match',
    }),
    reason: RejectReason.optional(),
    message: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    server: FieldState.optional().openapi({ description: 'On conflict: the value the server holds' }),
    quarantined: z.boolean().optional(),
  })
  .openapi('SyncResult');
export type SyncResultValue = z.infer<typeof SyncResult>;

export const DeviceStatus = z.enum(['active', 'wipe_requested', 'wiped']).openapi('DeviceStatus');

export const SyncPush = z
  .object({
    deviceId: Uuid,
    clock: z.object({ deviceTime: DateTime }),
    unsynced: z.object({
      counts: z.record(z.string().regex(/^[a-z_]{1,30}$/), z.number().int().min(0)),
      oldest: DateTime.optional(),
    }),
    changes: z.array(SyncChange).max(100),
  })
  .openapi('SyncPush');

export const SyncPushResult = z
  .object({
    serverTime: DateTime,
    results: z.array(SyncResult).openapi({
      description: 'In the order processed. Changes without a result were not processed; send them again.',
    }),
    device: z.object({ status: DeviceStatus }),
    clock: z.object({ offsetMs: z.number().int(), flagged: z.boolean() }),
  })
  .openapi('SyncPushResult');

export const RecordRef = z.object({ entity: RecordEntity, id: Uuid }).openapi('RecordRef');

export const RecordSnapshot = z
  .object({
    entity: RecordEntity,
    id: Uuid,
    version: z.number().int(),
    status: z.string(),
    authorUserId: Uuid,
    createdAt: DateTime,
    updatedAt: DateTime,
    attributes: z.record(z.string(), z.unknown()).openapi({ description: 'Set at creation, never changed' }),
    fields: z.record(z.string(), FieldState),
  })
  .openapi('RecordSnapshot');
export type RecordSnapshotValue = z.infer<typeof RecordSnapshot>;

export const FetchRecords = z.object({ records: z.array(RecordRef).min(1).max(50) }).openapi('FetchRecords');
export const FetchRecordsResult = z
  .object({ records: z.array(RecordSnapshot), missing: z.array(RecordRef) })
  .openapi('FetchRecordsResult');

export const RegisterDevice = z
  .object({
    deviceId: Uuid,
    platform: z.enum(['ios', 'android', 'other']),
    appVersion: z.string().trim().min(1).max(40),
    publicKey: Base64Url(32).openapi({ description: 'Ed25519 public key, raw bytes, unpadded base64url' }),
  })
  .openapi('RegisterDevice');

export const Device = z.object({ id: Uuid, status: DeviceStatus, registeredAt: DateTime }).openapi('Device');

const Signature = Base64Url(64).openapi({
  description: 'Ed25519 signature of the canonical JSON of `payload`, unpadded base64url',
});

export const SignedStatus = z
  .object({
    payload: z.object({ purpose: z.literal('status'), deviceId: Uuid, sentAt: DateTime }),
    signature: Signature,
  })
  .openapi('SignedStatus');

export const SignedQuarantine = z
  .object({
    payload: z.object({
      purpose: z.literal('quarantine'),
      deviceId: Uuid,
      changes: z.array(SyncChange).min(1).max(100),
    }),
    signature: Signature,
  })
  .openapi('SignedQuarantine');

export const SignedWiped = z
  .object({
    payload: z.object({ purpose: z.literal('wiped'), deviceId: Uuid, wipedAt: DateTime }),
    signature: Signature,
  })
  .openapi('SignedWiped');

export const DeviceStatusResult = z
  .object({
    status: DeviceStatus,
    access: z.enum(['active', 'removed']).openapi({
      description: 'removed: the user lost access to the team; upload unsynced work to quarantine, then wipe',
    }),
    serverTime: DateTime,
  })
  .openapi('DeviceStatusResult');

export const QuarantineReceipt = z
  .object({
    results: z.array(
      z.object({
        changeId: Uuid,
        status: z.enum(['quarantined', 'rejected']),
        hash: Hash.optional(),
        reason: RejectReason.optional(),
      }),
    ),
  })
  .openapi('QuarantineReceipt');

const UserRef = z.object({ userId: Uuid, displayName: z.string() }).openapi('UserRef');

export const TeamDevice = z
  .object({
    id: Uuid,
    user: UserRef,
    platform: z.string(),
    appVersion: z.string(),
    status: DeviceStatus,
    registeredAt: DateTime,
    lastSeenAt: DateTime.nullable(),
    lastSyncAt: DateTime.nullable(),
    clockOffsetMs: z.number().int().nullable(),
    clockFlagged: z.boolean(),
    unsyncedCounts: z.record(z.string(), z.number().int()),
    oldestUnsyncedAt: DateTime.nullable(),
    openRejections: z.number().int(),
    wipeRequestedAt: DateTime.nullable(),
    wipedAt: DateTime.nullable(),
  })
  .openapi('TeamDevice');

export const WipeDevice = z.object({ reason: Reason }).openapi('WipeDevice');

export const QuarantineItem = z
  .object({
    id: Uuid,
    user: UserRef,
    deviceId: Uuid,
    changeId: Uuid,
    entity: z.string(),
    recordId: Uuid,
    op: z.string(),
    field: z.string().nullable(),
    value: z.unknown(),
    deviceTime: DateTime,
    reason: z.enum(['access_removed', 'permission']),
    status: z.enum(['pending', 'accepted', 'rejected']),
    receivedAt: DateTime,
    decidedAt: DateTime.nullable(),
    decidedBy: UserRef.nullable(),
    decisionReason: z.string().nullable(),
  })
  .openapi('QuarantineItem');

export const DecideQuarantine = z
  .object({ decision: z.enum(['accept', 'reject']), reason: Reason })
  .openapi('DecideQuarantine');

export const Notice = z
  .object({
    id: Uuid,
    kind: z.string(),
    entity: z.string().nullable(),
    recordId: Uuid.nullable(),
    createdAt: DateTime,
    readAt: DateTime.nullable(),
  })
  .openapi('Notice');
