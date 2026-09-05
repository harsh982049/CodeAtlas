import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { StableKey } from "@codeatlas/codegraph";

import type { CodeAtlasDatabase } from "./client.js";
import {
  analyzerDiagnostics,
  codeEdges,
  codeEntities,
  files,
  unresolvedRelationships,
} from "./schema.js";
import {
  defaultPersistenceBatchSizes,
  type PersistenceBatchSizes,
  type PersistenceTimings,
  type SnapshotPersistencePayload,
} from "./models.js";
import { requireBuildingSnapshot } from "./snapshot-store.js";

function batches<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Persistence batch sizes must be positive safe integers");
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function insertBatches<T>(values: readonly T[], size: number, insert: (batch: readonly T[]) => Promise<void>): Promise<number> {
  const started = performance.now();
  for (const batch of batches(values, size)) await insert(batch);
  return Math.max(0, Math.round(performance.now() - started));
}

export async function persistSnapshotPayload(
  database: CodeAtlasDatabase,
  snapshotId: string,
  payload: SnapshotPersistencePayload,
  batchSizes: PersistenceBatchSizes = defaultPersistenceBatchSizes,
): Promise<PersistenceTimings> {
  await requireBuildingSnapshot(database, snapshotId);
  const fileIds = new Map<string, string>();
  const fileRows: Array<typeof files.$inferInsert> = payload.files.map((file) => {
    const id = randomUUID();
    if (fileIds.has(file.path)) throw new Error(`Duplicate persisted file path: ${file.path}`);
    fileIds.set(file.path, id);
    return { id, snapshotId, path: file.path, role: file.role, language: file.language, contentHash: file.contentHash, sourceObjectKey: file.sourceObjectKey, byteCount: file.byteCount, lineCount: file.lineCount, metadata: file.metadata };
  });
  const filesMs = await insertBatches(fileRows, batchSizes.files, async (batch) => {
    await database.db.insert(files).values([...batch]);
  });

  const entityIds = new Map<StableKey, string>();
  const entityRows: Array<typeof codeEntities.$inferInsert> = payload.entities.map((entity) => {
    const id = randomUUID();
    if (entityIds.has(entity.stableKey)) throw new Error(`Duplicate stable key: ${entity.stableKey}`);
    entityIds.set(entity.stableKey, id);
    const fileId = entity.filePath === null ? null : fileIds.get(entity.filePath);
    if (entity.filePath !== null && fileId === undefined) throw new Error(`Entity source file was not retained: ${entity.filePath}`);
    return {
      id, snapshotId, fileId: fileId ?? null, stableKey: entity.stableKey, canonicalIdentity: entity.canonicalIdentity,
      entityType: entity.kind, name: entity.name, qualifiedName: entity.qualifiedName,
      startLine: entity.sourceRange?.start.line ?? null, startColumn: entity.sourceRange?.start.column ?? null,
      endLine: entity.sourceRange?.end.line ?? null, endColumn: entity.sourceRange?.end.column ?? null,
      exported: entity.exported, defaultExport: entity.defaultExport,
      declarationFingerprint: entity.declarationFingerprint, implementationFingerprint: entity.implementationFingerprint,
      identityStability: entity.identityStability, analyzerName: entity.analyzer.name, analyzerVersion: entity.analyzer.version,
      metadata: entity.metadata,
    };
  });
  const entitiesMs = await insertBatches(entityRows, batchSizes.entities, async (batch) => {
    await database.db.insert(codeEntities).values([...batch]);
  });

  const seenEdges = new Set<string>();
  const edgeRows: Array<typeof codeEdges.$inferInsert> = payload.edges.map((edge) => {
    if (seenEdges.has(edge.edgeKey)) throw new Error(`Duplicate edge occurrence: ${edge.edgeKey}`);
    seenEdges.add(edge.edgeKey);
    const sourceEntityId = entityIds.get(edge.source);
    const targetEntityId = entityIds.get(edge.target);
    if (sourceEntityId === undefined || targetEntityId === undefined) throw new Error(`Edge endpoint is not persisted: ${edge.edgeKey}`);
    const evidenceFileId = edge.evidence === null ? null : fileIds.get(edge.evidence.filePath);
    if (edge.evidence !== null && evidenceFileId === undefined) throw new Error(`Edge evidence file was not retained: ${edge.evidence.filePath}`);
    return {
      id: randomUUID(), snapshotId, edgeKey: edge.edgeKey, sourceEntityId, targetEntityId,
      edgeType: edge.edgeType, confidence: edge.confidence,
      analyzerName: edge.resolver.analyzer, analyzerVersion: edge.resolver.analyzerVersion,
      resolverName: edge.resolver.resolver, resolverVersion: edge.resolver.resolverVersion,
      evidenceFileId: evidenceFileId ?? null,
      evidenceStartLine: edge.evidence?.start.line ?? null, evidenceStartColumn: edge.evidence?.start.column ?? null,
      evidenceEndLine: edge.evidence?.end.line ?? null, evidenceEndColumn: edge.evidence?.end.column ?? null,
      evidenceKind: edge.evidence?.kind ?? null, metadata: edge.metadata,
    };
  });
  const edgesMs = await insertBatches(edgeRows, batchSizes.edges, async (batch) => {
    await database.db.insert(codeEdges).values([...batch]);
  });

  const diagnosticRows: Array<typeof analyzerDiagnostics.$inferInsert> = payload.diagnostics.map((diagnostic, ordinal) => ({
    id: randomUUID(), snapshotId, ordinal, code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message,
    locationPath: diagnostic.location?.filePath ?? null,
    startLine: diagnostic.location?.start.line ?? null, startColumn: diagnostic.location?.start.column ?? null,
    endLine: diagnostic.location?.end.line ?? null, endColumn: diagnostic.location?.end.column ?? null,
  }));
  const diagnosticsMs = await insertBatches(diagnosticRows, batchSizes.diagnostics, async (batch) => {
    await database.db.insert(analyzerDiagnostics).values([...batch]);
  });

  const unresolvedRows: Array<typeof unresolvedRelationships.$inferInsert> = payload.unresolvedRelationships.map((relationship, ordinal) => {
    const sourceEntityId = relationship.source === null ? null : entityIds.get(relationship.source);
    if (relationship.source !== null && sourceEntityId === undefined) throw new Error(`Unresolved relationship source is not persisted: ${relationship.source}`);
    const evidenceFileId = relationship.evidence === null ? null : fileIds.get(relationship.evidence.filePath);
    if (relationship.evidence !== null && evidenceFileId === undefined) throw new Error(`Unresolved evidence file was not retained: ${relationship.evidence.filePath}`);
    return {
      id: randomUUID(), snapshotId, ordinal, sourceEntityId: sourceEntityId ?? null,
      intendedEdgeType: relationship.intendedEdgeType, targetText: relationship.targetText, reason: relationship.reason,
      evidenceFileId: evidenceFileId ?? null,
      evidenceStartLine: relationship.evidence?.start.line ?? null, evidenceStartColumn: relationship.evidence?.start.column ?? null,
      evidenceEndLine: relationship.evidence?.end.line ?? null, evidenceEndColumn: relationship.evidence?.end.column ?? null,
      detail: relationship.detail,
    };
  });
  const unresolvedRelationshipsMs = await insertBatches(unresolvedRows, batchSizes.unresolvedRelationships, async (batch) => {
    await database.db.insert(unresolvedRelationships).values([...batch]);
  });

  return { filesMs, entitiesMs, edgesMs, diagnosticsMs, unresolvedRelationshipsMs };
}
