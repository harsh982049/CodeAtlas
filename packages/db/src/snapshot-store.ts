import type { ReservedSql } from "postgres";

import type { JsonObject } from "@codeatlas/shared";

import type { CodeAtlasDatabase } from "./client.js";
import type { StructuralSnapshotIdentityValue } from "./models.js";

export interface SnapshotRecord {
  readonly id: string;
  readonly repositoryId: string;
  readonly commitSha: string;
  readonly analyzerName: string;
  readonly analyzerVersion: string;
  readonly status: "BUILDING" | "READY" | "FAILED";
  readonly createdAt: Date;
  readonly readyAt: Date | null;
  readonly failedAt: Date | null;
  readonly fileCount: number;
  readonly entityCount: number;
  readonly edgeCount: number;
  readonly diagnosticCount: number;
  readonly unresolvedCount: number;
}

export interface SnapshotClaim {
  readonly snapshot: SnapshotRecord;
  readonly jobId: string;
  readonly reused: boolean;
}

export interface SnapshotPublicationMetadata {
  readonly fileCount: number;
  readonly entityCount: number;
  readonly edgeCount: number;
  readonly diagnosticCount: number;
  readonly unresolvedCount: number;
  readonly analysisStats: JsonObject;
  readonly analysisTelemetry: JsonObject;
  readonly graphSummary: JsonObject;
}

interface SnapshotRow {
  id: string;
  repository_id: string;
  commit_sha: string;
  analyzer_name: string;
  analyzer_version: string;
  status: "BUILDING" | "READY" | "FAILED";
  created_at: Date | string;
  ready_at: Date | string | null;
  failed_at: Date | string | null;
  file_count: number;
  entity_count: number;
  edge_count: number;
  diagnostic_count: number;
  unresolved_count: number;
}

function snapshotRecord(row: SnapshotRow): SnapshotRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    commitSha: row.commit_sha,
    analyzerName: row.analyzer_name,
    analyzerVersion: row.analyzer_version,
    status: row.status,
    createdAt: new Date(row.created_at),
    readyAt: row.ready_at === null ? null : new Date(row.ready_at),
    failedAt: row.failed_at === null ? null : new Date(row.failed_at),
    fileCount: row.file_count,
    entityCount: row.entity_count,
    edgeCount: row.edge_count,
    diagnosticCount: row.diagnostic_count,
    unresolvedCount: row.unresolved_count,
  };
}

export function snapshotLockIdentity(identity: StructuralSnapshotIdentityValue): string {
  return ["codeatlas-structural-snapshot-v1", identity.repositoryLogicalId, identity.commitSha, identity.analyzerName, identity.analyzerVersion].join("\u001f");
}

export async function withSnapshotAdvisoryLock<T>(
  database: CodeAtlasDatabase,
  identity: StructuralSnapshotIdentityValue,
  operation: (connection: ReservedSql<Record<string, never>>) => Promise<T>,
): Promise<T> {
  const connection = await database.client.reserve();
  try {
    await connection`SELECT pg_advisory_lock(hashtextextended(${snapshotLockIdentity(identity)}, 0))`;
    return await operation(connection);
  } finally {
    try {
      await connection`SELECT pg_advisory_unlock(hashtextextended(${snapshotLockIdentity(identity)}, 0))`;
    } finally {
      connection.release();
    }
  }
}

export async function acquireSharedStorageMaintenanceLock(connection: ReservedSql<Record<string, never>>): Promise<void> {
  await connection`SELECT pg_advisory_lock_shared(hashtextextended('codeatlas-source-maintenance-v1', 0))`;
}

export async function releaseSharedStorageMaintenanceLock(connection: ReservedSql<Record<string, never>>): Promise<void> {
  await connection`SELECT pg_advisory_unlock_shared(hashtextextended('codeatlas-source-maintenance-v1', 0))`;
}

export async function withReservedTransaction<T>(
  connection: ReservedSql<Record<string, never>>,
  operation: (transaction: ReservedSql<Record<string, never>>) => Promise<T>,
): Promise<T> {
  await connection`BEGIN`;
  try {
    const result = await operation(connection);
    await connection`COMMIT`;
    return result;
  } catch (error) {
    await connection`ROLLBACK`;
    throw error;
  }
}

export async function claimSnapshot(
  connection: ReservedSql<Record<string, never>>,
  identity: StructuralSnapshotIdentityValue,
  repositoryName: string,
): Promise<SnapshotClaim> {
  return withReservedTransaction(connection, async (transaction) => {
    const repositoryRows = await transaction<{ id: string }[]>`
      INSERT INTO repositories (logical_id, name)
      VALUES (${identity.repositoryLogicalId}, ${repositoryName})
      ON CONFLICT (logical_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
      RETURNING id
    `;
    const repository = repositoryRows[0];
    if (repository === undefined) throw new Error("Repository upsert returned no row");
    const existingRows = await transaction<SnapshotRow[]>`
      SELECT * FROM repository_snapshots
      WHERE repository_id = ${repository.id}
        AND commit_sha = ${identity.commitSha}
        AND analyzer_name = ${identity.analyzerName}
        AND analyzer_version = ${identity.analyzerVersion}
      FOR UPDATE
    `;
    let snapshot = existingRows[0];
    if (snapshot?.status === "READY") {
      const jobs = await transaction<{ id: string }[]>`
        INSERT INTO index_jobs (repository_id, snapshot_id, commit_sha, analyzer_name, analyzer_version, status, stage, reused_existing, finished_at)
        VALUES (${repository.id}, ${snapshot.id}, ${identity.commitSha}, ${identity.analyzerName}, ${identity.analyzerVersion}, 'SUCCEEDED', 'REUSED_READY', true, now())
        RETURNING id
      `;
      const job = jobs[0];
      if (job === undefined) throw new Error("Reused job creation returned no row");
      return { snapshot: snapshotRecord(snapshot), jobId: job.id, reused: true };
    }
    if (snapshot?.status === "BUILDING") {
      throw new Error("Logical snapshot is already BUILDING; it must become stale and FAILED before retry");
    }
    if (snapshot?.status === "FAILED") {
      await transaction`DELETE FROM code_edges WHERE snapshot_id = ${snapshot.id}`;
      await transaction`DELETE FROM unresolved_relationships WHERE snapshot_id = ${snapshot.id}`;
      await transaction`DELETE FROM analyzer_diagnostics WHERE snapshot_id = ${snapshot.id}`;
      await transaction`DELETE FROM code_entities WHERE snapshot_id = ${snapshot.id}`;
      await transaction`DELETE FROM files WHERE snapshot_id = ${snapshot.id}`;
      const recovered = await transaction<SnapshotRow[]>`
        UPDATE repository_snapshots
        SET status = 'BUILDING', ready_at = NULL, failed_at = NULL,
            failure_stage = NULL, failure_code = NULL, failure_summary = NULL,
            file_count = 0, entity_count = 0, edge_count = 0,
            diagnostic_count = 0, unresolved_count = 0,
            analysis_stats = NULL, analysis_telemetry = NULL, graph_summary = NULL
        WHERE id = ${snapshot.id} AND status = 'FAILED'
        RETURNING *
      `;
      snapshot = recovered[0];
    }
    if (snapshot === undefined) {
      const created = await transaction<SnapshotRow[]>`
        INSERT INTO repository_snapshots (repository_id, commit_sha, analyzer_name, analyzer_version)
        VALUES (${repository.id}, ${identity.commitSha}, ${identity.analyzerName}, ${identity.analyzerVersion})
        RETURNING *
      `;
      snapshot = created[0];
    }
    if (snapshot === undefined) throw new Error("Snapshot claim returned no row");
    const jobs = await transaction<{ id: string }[]>`
      INSERT INTO index_jobs (repository_id, snapshot_id, commit_sha, analyzer_name, analyzer_version)
      VALUES (${repository.id}, ${snapshot.id}, ${identity.commitSha}, ${identity.analyzerName}, ${identity.analyzerVersion})
      RETURNING id
    `;
    const job = jobs[0];
    if (job === undefined) throw new Error("Index job creation returned no row");
    return { snapshot: snapshotRecord(snapshot), jobId: job.id, reused: false };
  });
}

export async function updateJobStage(database: CodeAtlasDatabase, jobId: string, stage: string): Promise<void> {
  await database.client`UPDATE index_jobs SET stage = ${stage} WHERE id = ${jobId} AND status = 'RUNNING'`;
}

function sanitizeFailure(value: string): string {
  return value.replaceAll(/(?:postgres(?:ql)?|https?|s3):\/\/\S+/giu, "[redacted-url]").slice(0, 500);
}

export async function failSnapshot(
  database: CodeAtlasDatabase,
  snapshotId: string,
  jobId: string,
  stage: string,
  code: string,
  summary: string,
): Promise<void> {
  const safeSummary = sanitizeFailure(summary);
  await database.client.begin(async (transaction) => {
    await transaction`
      UPDATE repository_snapshots
      SET status = 'FAILED', failed_at = now(), ready_at = NULL,
          failure_stage = ${stage}, failure_code = ${code}, failure_summary = ${safeSummary}
      WHERE id = ${snapshotId} AND status = 'BUILDING'
    `;
    await transaction`
      UPDATE index_jobs
      SET status = 'FAILED', stage = ${stage}, failure_code = ${code}, failure_summary = ${safeSummary}, finished_at = now()
      WHERE id = ${jobId} AND status = 'RUNNING'
    `;
  });
}

export async function publishSnapshot(
  database: CodeAtlasDatabase,
  snapshotId: string,
  jobId: string,
  metadata: SnapshotPublicationMetadata,
): Promise<void> {
  await database.client.begin(async (transaction) => {
    const snapshots = await transaction<{ repository_id: string; status: string }[]>`
      SELECT repository_id, status FROM repository_snapshots WHERE id = ${snapshotId} FOR UPDATE
    `;
    const snapshot = snapshots[0];
    if (snapshot === undefined) throw new Error("Snapshot does not exist");
    if (snapshot.status !== "BUILDING") throw new Error(`Only BUILDING snapshots can be published; found ${snapshot.status}`);
    await transaction`SELECT id FROM repositories WHERE id = ${snapshot.repository_id} FOR UPDATE`;
    const counts = await transaction<{ file_count: number; entity_count: number; edge_count: number; diagnostic_count: number; unresolved_count: number }[]>`
      SELECT
        (SELECT count(*)::int FROM files WHERE snapshot_id = ${snapshotId}) AS file_count,
        (SELECT count(*)::int FROM code_entities WHERE snapshot_id = ${snapshotId}) AS entity_count,
        (SELECT count(*)::int FROM code_edges WHERE snapshot_id = ${snapshotId}) AS edge_count,
        (SELECT count(*)::int FROM analyzer_diagnostics WHERE snapshot_id = ${snapshotId}) AS diagnostic_count,
        (SELECT count(*)::int FROM unresolved_relationships WHERE snapshot_id = ${snapshotId}) AS unresolved_count
    `;
    const actual = counts[0];
    if (actual === undefined || actual.file_count !== metadata.fileCount || actual.entity_count !== metadata.entityCount || actual.edge_count !== metadata.edgeCount || actual.diagnostic_count !== metadata.diagnosticCount || actual.unresolved_count !== metadata.unresolvedCount) {
      throw new Error("Persisted snapshot counts do not match publication metadata");
    }
    await transaction`
      UPDATE repository_snapshots SET
        status = 'READY', ready_at = now(), failed_at = NULL,
        file_count = ${metadata.fileCount}, entity_count = ${metadata.entityCount}, edge_count = ${metadata.edgeCount},
        diagnostic_count = ${metadata.diagnosticCount}, unresolved_count = ${metadata.unresolvedCount},
        analysis_stats = ${JSON.stringify(metadata.analysisStats)}::jsonb,
        analysis_telemetry = ${JSON.stringify(metadata.analysisTelemetry)}::jsonb,
        graph_summary = ${JSON.stringify(metadata.graphSummary)}::jsonb
      WHERE id = ${snapshotId}
    `;
    await transaction`UPDATE repositories SET current_snapshot_id = ${snapshotId}, updated_at = now() WHERE id = ${snapshot.repository_id}`;
    await transaction`UPDATE index_jobs SET status = 'SUCCEEDED', stage = 'PUBLISHED', finished_at = now() WHERE id = ${jobId} AND status = 'RUNNING'`;
  });
}

export async function requireBuildingSnapshot(database: CodeAtlasDatabase, snapshotId: string): Promise<void> {
  const rows = await database.client<{ status: string }[]>`SELECT status FROM repository_snapshots WHERE id = ${snapshotId}`;
  const row = rows[0];
  if (row === undefined) throw new Error("Snapshot does not exist");
  if (row.status !== "BUILDING") throw new Error(`Snapshot structural data is immutable unless BUILDING; found ${row.status}`);
}

export async function getSnapshot(database: CodeAtlasDatabase, snapshotId: string): Promise<SnapshotRecord | null> {
  const rows = await database.client<SnapshotRow[]>`SELECT * FROM repository_snapshots WHERE id = ${snapshotId}`;
  return rows[0] === undefined ? null : snapshotRecord(rows[0]);
}

export async function listRepositorySnapshots(database: CodeAtlasDatabase, logicalId: string): Promise<readonly (SnapshotRecord & { current: boolean })[]> {
  const rows = await database.client<(SnapshotRow & { current: boolean })[]>`
    SELECT s.*, r.current_snapshot_id = s.id AS current
    FROM repositories r JOIN repository_snapshots s ON s.repository_id = r.id
    WHERE r.logical_id = ${logicalId}
    ORDER BY s.created_at DESC
  `;
  return rows.map((row) => ({ ...snapshotRecord(row), current: row.current }));
}
