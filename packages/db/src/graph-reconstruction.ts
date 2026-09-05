import { and, asc, eq } from "drizzle-orm";

import {
  InMemoryCodeGraph,
  assertCodeEntity,
  createCodeEdge,
  type CanonicalEntityIdentity,
  type CodeEntity,
  type DeclarationFingerprint,
  type EdgeKey,
  type ImplementationFingerprint,
  type StableKey,
} from "@codeatlas/codegraph";
import { normalizeRelativePath } from "@codeatlas/shared";

import type { CodeAtlasDatabase } from "./client.js";
import { codeEdges, codeEntities, files, repositorySnapshots } from "./schema.js";

export interface RetainedFileRecord {
  readonly id: string;
  readonly snapshotId: string;
  readonly path: string;
  readonly contentHash: string;
  readonly sourceObjectKey: string;
  readonly byteCount: number;
  readonly lineCount: number;
}

async function reconstructSnapshotGraph(
  database: CodeAtlasDatabase,
  snapshotId: string,
  requiredStatus: "BUILDING" | "READY",
): Promise<InMemoryCodeGraph> {
  const snapshot = await database.db.query.repositorySnapshots.findFirst({
    where: and(eq(repositorySnapshots.id, snapshotId), eq(repositorySnapshots.status, requiredStatus)),
    columns: { status: true },
  });
  if (snapshot === undefined) {
    throw new Error(requiredStatus === "READY" ? "Only READY snapshots are query-visible" : "Snapshot is not BUILDING");
  }
  const fileRows = await database.db.select().from(files).where(eq(files.snapshotId, snapshotId)).orderBy(asc(files.path));
  const filePaths = new Map(fileRows.map((file) => [file.id, normalizeRelativePath(file.path)]));
  const entityRows = await database.db.select().from(codeEntities).where(eq(codeEntities.snapshotId, snapshotId)).orderBy(asc(codeEntities.stableKey));
  const stableKeys = new Map<string, StableKey>();
  const graph = new InMemoryCodeGraph();
  for (const row of entityRows) {
    const filePath = row.fileId === null ? null : filePaths.get(row.fileId);
    if (row.fileId !== null && filePath === undefined) throw new Error(`Entity file reference is missing: ${row.id}`);
    const sourceRange = row.startLine === null ? null : {
      filePath: filePath ?? (() => { throw new Error(`Entity range has no file: ${row.id}`); })(),
      start: { line: row.startLine, column: row.startColumn ?? 0 },
      end: { line: row.endLine ?? 0, column: row.endColumn ?? 0 },
    };
    const entity: CodeEntity = {
      stableKey: row.stableKey as StableKey,
      canonicalIdentity: row.canonicalIdentity as CanonicalEntityIdentity,
      kind: row.entityType,
      name: row.name,
      qualifiedName: row.qualifiedName,
      filePath: filePath ?? null,
      sourceRange,
      exported: row.exported,
      defaultExport: row.defaultExport,
      declarationFingerprint: row.declarationFingerprint as DeclarationFingerprint | null,
      implementationFingerprint: row.implementationFingerprint as ImplementationFingerprint | null,
      identityStability: row.identityStability,
      analyzer: { name: row.analyzerName, version: row.analyzerVersion },
      metadata: row.metadata,
    };
    assertCodeEntity(entity);
    graph.addEntity(entity);
    stableKeys.set(row.id, entity.stableKey);
  }
  const edgeRows = await database.db.select().from(codeEdges).where(eq(codeEdges.snapshotId, snapshotId)).orderBy(asc(codeEdges.edgeKey));
  for (const row of edgeRows) {
    const source = stableKeys.get(row.sourceEntityId);
    const target = stableKeys.get(row.targetEntityId);
    if (source === undefined || target === undefined) throw new Error(`Edge endpoint reference is missing: ${row.id}`);
    const evidencePath = row.evidenceFileId === null ? null : filePaths.get(row.evidenceFileId);
    if (evidencePath === undefined) throw new Error(`Edge evidence reference is missing: ${row.id}`);
    const edge = createCodeEdge({
      source,
      target,
      edgeType: row.edgeType,
      confidence: row.confidence,
      resolver: {
        analyzer: row.analyzerName,
        analyzerVersion: row.analyzerVersion,
        resolver: row.resolverName,
        resolverVersion: row.resolverVersion,
      },
      evidence: evidencePath === null ? null : {
        filePath: evidencePath,
        start: { line: row.evidenceStartLine ?? 0, column: row.evidenceStartColumn ?? 0 },
        end: { line: row.evidenceEndLine ?? 0, column: row.evidenceEndColumn ?? 0 },
        kind: row.evidenceKind ?? (() => { throw new Error(`Edge evidence kind is missing: ${row.id}`); })(),
      },
      metadata: row.metadata,
    });
    if (edge.edgeKey !== row.edgeKey as EdgeKey) throw new Error(`Persisted edge occurrence key does not match reconstructed edge: ${row.id}`);
    graph.addEdge(edge);
  }
  const validation = graph.validate();
  if (!validation.valid) throw new Error(`Reconstructed graph is invalid: ${validation.diagnostics.map((item) => item.message).join("; ")}`);
  return graph;
}

export async function reconstructCodeGraph(database: CodeAtlasDatabase, snapshotId: string): Promise<InMemoryCodeGraph> {
  return reconstructSnapshotGraph(database, snapshotId, "READY");
}

/** Indexer-only verification boundary; ordinary readers must use reconstructCodeGraph. */
export async function reconstructBuildingCodeGraphForVerification(
  database: CodeAtlasDatabase,
  snapshotId: string,
): Promise<InMemoryCodeGraph> {
  return reconstructSnapshotGraph(database, snapshotId, "BUILDING");
}

export async function getRetainedFile(database: CodeAtlasDatabase, snapshotId: string, path: string): Promise<RetainedFileRecord | null> {
  const normalized = normalizeRelativePath(path);
  const rows = await database.db.select({
    id: files.id,
    snapshotId: files.snapshotId,
    path: files.path,
    contentHash: files.contentHash,
    sourceObjectKey: files.sourceObjectKey,
    byteCount: files.byteCount,
    lineCount: files.lineCount,
  }).from(files).innerJoin(repositorySnapshots, eq(repositorySnapshots.id, files.snapshotId)).where(and(
    eq(files.snapshotId, snapshotId),
    eq(files.path, normalized),
    eq(repositorySnapshots.status, "READY"),
  ));
  return rows[0] ?? null;
}

export async function referencedSourceObjectKeys(database: CodeAtlasDatabase): Promise<ReadonlySet<string>> {
  const rows = await database.db.selectDistinct({ key: files.sourceObjectKey }).from(files);
  return new Set(rows.map((row) => row.key));
}
