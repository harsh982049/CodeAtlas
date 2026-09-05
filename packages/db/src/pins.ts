import type { CodeAtlasDatabase } from "./client.js";

export type SnapshotPinType = "MANUAL" | "ACTIVE_DIFF" | "ACTIVE_PR";

export interface SnapshotPinRecord {
  readonly id: string;
  readonly snapshotId: string;
  readonly pinType: SnapshotPinType;
  readonly ownerReference: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

interface PinRow {
  id: string;
  snapshot_id: string;
  pin_type: SnapshotPinType;
  owner_reference: string;
  created_at: Date | string;
  expires_at: Date | string;
}

const maximumLeaseMilliseconds = 30 * 24 * 60 * 60 * 1_000;

export async function createOrRenewSnapshotPin(
  database: CodeAtlasDatabase,
  snapshotId: string,
  pinType: SnapshotPinType,
  ownerReference: string,
  expiresAt: Date,
  now = new Date(),
): Promise<SnapshotPinRecord> {
  const owner = ownerReference.trim();
  if (owner.length === 0) throw new Error("Snapshot pin owner/reference must not be empty");
  const duration = expiresAt.getTime() - now.getTime();
  if (duration <= 0 || duration > maximumLeaseMilliseconds) {
    throw new Error("Snapshot pin expiry must be in the future and no more than 30 days from creation or renewal");
  }
  const rows = await database.client<PinRow[]>`
    INSERT INTO snapshot_pins (snapshot_id, pin_type, owner_reference, created_at, expires_at)
    SELECT id, ${pinType}, ${owner}, ${now.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz
    FROM repository_snapshots WHERE id = ${snapshotId} AND status = 'READY'
    ON CONFLICT (snapshot_id, pin_type, owner_reference)
    DO UPDATE SET created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at
    RETURNING *
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("Only READY snapshots can be pinned");
  return { id: row.id, snapshotId: row.snapshot_id, pinType: row.pin_type, ownerReference: row.owner_reference, createdAt: new Date(row.created_at), expiresAt: new Date(row.expires_at) };
}
