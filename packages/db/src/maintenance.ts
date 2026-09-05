import type { ReservedSql } from "postgres";

import type { CodeAtlasDatabase } from "./client.js";
import type { StructuralSnapshotIdentityValue } from "./models.js";
import { snapshotLockIdentity, withReservedTransaction } from "./snapshot-store.js";

export interface SnapshotCleanupOptions {
  readonly apply: boolean;
  readonly now?: Date;
  readonly staleBuildingAgeMs?: number;
  readonly failedMinimumAgeMs?: number;
  readonly readyRetentionCount?: number;
}

export interface SnapshotCleanupResult {
  readonly staleBuilding: readonly string[];
  readonly failedDeleted: readonly string[];
  readonly readyDeleted: readonly string[];
  readonly skippedLocked: readonly string[];
}

interface StaleRow {
  id: string;
  logical_id: string;
  commit_sha: string;
  analyzer_name: string;
  analyzer_version: string;
}

async function tryFailStaleBuilding(database: CodeAtlasDatabase, row: StaleRow): Promise<boolean> {
  const identity: StructuralSnapshotIdentityValue = {
    repositoryLogicalId: row.logical_id,
    commitSha: row.commit_sha,
    analyzerName: row.analyzer_name,
    analyzerVersion: row.analyzer_version,
  };
  const connection = await database.client.reserve();
  try {
    const acquiredRows = await connection<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(hashtextextended(${snapshotLockIdentity(identity)}, 0)) AS acquired`;
    if (acquiredRows[0]?.acquired !== true) return false;
    try {
      await withReservedTransaction(connection, async (transaction) => {
        await transaction`UPDATE repository_snapshots SET status = 'FAILED', failed_at = now(), failure_stage = 'STALE_BUILDING_CLEANUP', failure_code = 'STALE_BUILDING', failure_summary = 'Index owner disappeared before publication.' WHERE id = ${row.id} AND status = 'BUILDING'`;
        await transaction`UPDATE index_jobs SET status = 'FAILED', stage = 'STALE_BUILDING_CLEANUP', failure_code = 'STALE_BUILDING', failure_summary = 'Index owner disappeared before publication.', finished_at = now() WHERE snapshot_id = ${row.id} AND status = 'RUNNING'`;
      });
      return true;
    } finally {
      await connection`SELECT pg_advisory_unlock(hashtextextended(${snapshotLockIdentity(identity)}, 0))`;
    }
  } finally {
    connection.release();
  }
}

function positiveDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}

export async function cleanupSnapshots(database: CodeAtlasDatabase, options: SnapshotCleanupOptions): Promise<SnapshotCleanupResult> {
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - positiveDuration(options.staleBuildingAgeMs ?? 60 * 60 * 1_000, "staleBuildingAgeMs"));
  const failedBefore = new Date(now.getTime() - positiveDuration(options.failedMinimumAgeMs ?? 7 * 24 * 60 * 60 * 1_000, "failedMinimumAgeMs"));
  const retain = options.readyRetentionCount ?? 5;
  if (!Number.isSafeInteger(retain) || retain < 1) throw new Error("readyRetentionCount must be a positive safe integer");
  const stale = await database.client<StaleRow[]>`
    SELECT s.id, r.logical_id, s.commit_sha, s.analyzer_name, s.analyzer_version
    FROM repository_snapshots s JOIN repositories r ON r.id = s.repository_id
    WHERE s.status = 'BUILDING' AND s.created_at < ${staleBefore.toISOString()}::timestamptz
    ORDER BY s.created_at
  `;
  const failedRows = await database.client<{ id: string }[]>`
    SELECT s.id FROM repository_snapshots s JOIN repositories r ON r.id = s.repository_id
    WHERE s.status = 'FAILED' AND s.failed_at < ${failedBefore.toISOString()}::timestamptz
      AND r.current_snapshot_id IS DISTINCT FROM s.id
      AND NOT EXISTS (SELECT 1 FROM snapshot_pins p WHERE p.snapshot_id = s.id AND p.expires_at > ${now.toISOString()}::timestamptz)
    ORDER BY s.failed_at
  `;
  const readyRows = await database.client<{ id: string }[]>`
    WITH ranked AS (
      SELECT s.id, s.repository_id,
             row_number() OVER (PARTITION BY s.repository_id ORDER BY s.ready_at DESC, s.id DESC) AS position
      FROM repository_snapshots s WHERE s.status = 'READY'
    )
    SELECT ranked.id FROM ranked JOIN repositories r ON r.id = ranked.repository_id
    WHERE ranked.position > ${retain}
      AND r.current_snapshot_id IS DISTINCT FROM ranked.id
      AND NOT EXISTS (SELECT 1 FROM snapshot_pins p WHERE p.snapshot_id = ranked.id AND p.expires_at > ${now.toISOString()}::timestamptz)
    ORDER BY ranked.repository_id, ranked.position DESC
  `;
  const staleBuilding = stale.map((row) => row.id);
  const failedDeleted = failedRows.map((row) => row.id);
  const readyDeleted = readyRows.map((row) => row.id);
  const skippedLocked: string[] = [];
  if (options.apply) {
    for (const row of stale) if (!await tryFailStaleBuilding(database, row)) skippedLocked.push(row.id);
    if (failedDeleted.length > 0) await database.client`DELETE FROM repository_snapshots WHERE id = ANY(${database.client.array(failedDeleted)}::uuid[])`;
    if (readyDeleted.length > 0) await database.client`DELETE FROM repository_snapshots WHERE id = ANY(${database.client.array(readyDeleted)}::uuid[])`;
  }
  return { staleBuilding, failedDeleted, readyDeleted, skippedLocked };
}

export async function withExclusiveStorageMaintenanceLock<T>(database: CodeAtlasDatabase, operation: (connection: ReservedSql<Record<string, never>>) => Promise<T>): Promise<T> {
  const connection = await database.client.reserve();
  try {
    await connection`SELECT pg_advisory_lock(hashtextextended('codeatlas-source-maintenance-v1', 0))`;
    return await operation(connection);
  } finally {
    try {
      await connection`SELECT pg_advisory_unlock(hashtextextended('codeatlas-source-maintenance-v1', 0))`;
    } finally {
      connection.release();
    }
  }
}

export async function isSourceObjectReferenced(database: CodeAtlasDatabase, key: string): Promise<boolean> {
  const rows = await database.client<{ referenced: boolean }[]>`SELECT EXISTS(SELECT 1 FROM files WHERE source_object_key = ${key}) AS referenced`;
  return rows[0]?.referenced === true;
}
