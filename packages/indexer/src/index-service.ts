import { performance } from "node:perf_hooks";

import {
  defaultAnalysisLimits,
  summarizeCodeGraph,
  typescriptJavaScriptAnalyzer,
  createGitSourceRevision,
  type AnalyzerInput,
  type AnalyzerResult,
  type SourceArtifact,
} from "@codeatlas/analyzer";
import { serializeCodeGraphToJson } from "@codeatlas/codegraph";
import {
  acquireSharedStorageMaintenanceLock,
  claimSnapshot,
  defaultPersistenceBatchSizes,
  failSnapshot,
  persistSnapshotPayload,
  publishSnapshot,
  reconstructBuildingCodeGraphForVerification,
  releaseSharedStorageMaintenanceLock,
  updateJobStage,
  withSnapshotAdvisoryLock,
  type CodeAtlasDatabase,
  type PersistenceBatchSizes,
  type PersistenceTimings,
  type SnapshotPersistencePayload,
  type StructuralSnapshotIdentityValue,
} from "@codeatlas/db";
import {
  createRepositoryIdentifier,
  createStructuralAnalyzerIdentity,
  type JsonObject,
} from "@codeatlas/shared";
import {
  sha256Bytes,
  sha256Stream,
  sourceObjectKey,
  type SourceBlobStore,
} from "@codeatlas/storage";

import { assertGitRepositoryUnchanged, inspectCleanGitRepository } from "./git-repository.js";

export interface IndexRepositoryOptions {
  readonly repositoryPath: string;
  readonly repositoryLogicalId: string;
  readonly batchSizes?: PersistenceBatchSizes;
  readonly sourceConcurrency?: number;
}

export interface IndexTimings extends PersistenceTimings {
  readonly analysisMs: number;
  readonly sourceUploadMs: number;
  readonly sourceVerificationMs: number;
  readonly graphReloadMs: number;
  readonly publicationMs: number;
  readonly totalMs: number;
}

export interface IndexRepositoryResult {
  readonly snapshotId: string;
  readonly status: "READY";
  readonly reusedSnapshot: boolean;
  readonly repositoryLogicalId: string;
  readonly commitSha: string;
  readonly analyzerName: string;
  readonly analyzerVersion: string;
  readonly fileCount: number;
  readonly entityCount: number;
  readonly edgeCount: number;
  readonly uploadedBlobs: number;
  readonly reusedBlobs: number;
  readonly timings: IndexTimings;
}

function jsonObject(value: unknown): JsonObject {
  const serialized = JSON.stringify(value);
  const parsed: unknown = JSON.parse(serialized);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Expected JSON object metadata");
  return parsed as JsonObject;
}

async function mapConcurrent<T, R>(values: readonly T[], concurrency: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) throw new Error("Source concurrency must be a positive safe integer");
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await operation(value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function uniqueArtifactsByHash(artifacts: readonly SourceArtifact[]): readonly SourceArtifact[] {
  const byHash = new Map<string, SourceArtifact>();
  for (const artifact of artifacts) {
    if (sha256Bytes(artifact.bytes) !== artifact.contentHash || artifact.byteCount !== artifact.bytes.byteLength) {
      throw new Error(`Analyzer source artifact integrity failed: ${artifact.path}`);
    }
    const prior = byHash.get(artifact.contentHash);
    if (prior !== undefined && !bytesEqual(prior.bytes, artifact.bytes)) {
      throw new Error(`SHA-256 collision detected between retained source artifacts: ${prior.path} and ${artifact.path}`);
    }
    byHash.set(artifact.contentHash, artifact);
  }
  return [...byHash.values()].sort((left, right) => left.contentHash.localeCompare(right.contentHash));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function persistencePayload(result: AnalyzerResult): SnapshotPersistencePayload {
  return {
    files: result.sourceArtifacts.map((artifact) => ({
      path: artifact.path,
      role: artifact.role,
      language: artifact.format,
      contentHash: artifact.contentHash,
      sourceObjectKey: sourceObjectKey(artifact.contentHash),
      byteCount: artifact.byteCount,
      lineCount: artifact.lineCount,
      metadata: {},
    })),
    entities: result.graph.getEntities(),
    edges: result.graph.getEdges(),
    diagnostics: result.diagnostics,
    unresolvedRelationships: result.unresolvedRelationships,
  };
}

function emptyTimings(totalMs: number): IndexTimings {
  return { analysisMs: 0, sourceUploadMs: 0, sourceVerificationMs: 0, filesMs: 0, entitiesMs: 0, edgesMs: 0, diagnosticsMs: 0, unresolvedRelationshipsMs: 0, graphReloadMs: 0, publicationMs: 0, totalMs };
}

export async function indexRepository(
  database: CodeAtlasDatabase,
  blobStore: SourceBlobStore,
  options: IndexRepositoryOptions,
): Promise<IndexRepositoryResult> {
  const totalStarted = performance.now();
  const gitRepository = await inspectCleanGitRepository(options.repositoryPath);
  const repositoryId = createRepositoryIdentifier(options.repositoryLogicalId);
  const analyzerIdentity = createStructuralAnalyzerIdentity(typescriptJavaScriptAnalyzer.name, typescriptJavaScriptAnalyzer.version);
  const identity: StructuralSnapshotIdentityValue = {
    repositoryLogicalId: repositoryId,
    commitSha: gitRepository.commitSha,
    analyzerName: analyzerIdentity.name,
    analyzerVersion: analyzerIdentity.version,
  };
  return withSnapshotAdvisoryLock(database, identity, async (connection) => {
    const claim = await claimSnapshot(connection, identity, gitRepository.name);
    if (claim.reused) {
      return {
        snapshotId: claim.snapshot.id, status: "READY", reusedSnapshot: true,
        repositoryLogicalId: repositoryId, commitSha: gitRepository.commitSha,
        analyzerName: analyzerIdentity.name, analyzerVersion: analyzerIdentity.version,
        fileCount: claim.snapshot.fileCount, entityCount: claim.snapshot.entityCount, edgeCount: claim.snapshot.edgeCount,
        uploadedBlobs: 0, reusedBlobs: 0,
        timings: emptyTimings(Math.max(0, Math.round(performance.now() - totalStarted))),
      };
    }
    let stage = "ANALYSIS";
    try {
      await updateJobStage(database, claim.jobId, stage);
      const input: AnalyzerInput = {
        snapshot: { repositoryId, commitSha: gitRepository.commitSha, analyzer: analyzerIdentity },
        revision: createGitSourceRevision(gitRepository.commitSha),
        repositoryRoot: gitRepository.root,
        projectHints: [],
        limits: defaultAnalysisLimits,
      };
      const analysisStarted = performance.now();
      let result: AnalyzerResult | null = await typescriptJavaScriptAnalyzer.analyze(input);
      const analysisMs = Math.max(0, Math.round(performance.now() - analysisStarted));
      await assertGitRepositoryUnchanged(gitRepository);
      const originalGraphJson = serializeCodeGraphToJson(result.graph);
      const graphSummary = summarizeCodeGraph(result.graph, result.diagnostics, result.unresolvedRelationships);
      const stats = result.stats;
      const telemetry = result.telemetry;
      const payload = persistencePayload(result);
      let uniqueArtifacts: readonly SourceArtifact[] | null = uniqueArtifactsByHash(result.sourceArtifacts);

      stage = "SOURCE_STORAGE";
      await updateJobStage(database, claim.jobId, stage);
      await blobStore.ensureBucket();
      await acquireSharedStorageMaintenanceLock(connection);
      let uploadedBlobs = 0;
      let reusedBlobs = 0;
      let persistenceTimings: PersistenceTimings;
      let sourceUploadMs: number;
      let sourceVerificationMs: number;
      try {
        const artifactsForStorage = uniqueArtifacts;
        const sourceUploadStarted = performance.now();
        const putResults = await mapConcurrent(artifactsForStorage, options.sourceConcurrency ?? 8, async (artifact) => blobStore.put({
          key: sourceObjectKey(artifact.contentHash),
          bytes: artifact.bytes,
          contentHash: artifact.contentHash,
        }));
        sourceUploadMs = Math.max(0, Math.round(performance.now() - sourceUploadStarted));
        uploadedBlobs = putResults.filter((value) => value === "UPLOADED").length;
        reusedBlobs = putResults.filter((value) => value === "REUSED").length;

        const sourceVerificationStarted = performance.now();
        await mapConcurrent(artifactsForStorage, options.sourceConcurrency ?? 8, async (artifact) => {
          const verified = await sha256Stream(await blobStore.get(sourceObjectKey(artifact.contentHash)));
          if (verified.hash !== artifact.contentHash || verified.byteCount !== artifact.byteCount) {
            throw new Error(`Retained source verification failed: ${artifact.path}`);
          }
        });
        sourceVerificationMs = Math.max(0, Math.round(performance.now() - sourceVerificationStarted));

        stage = "STRUCTURAL_PERSISTENCE";
        await updateJobStage(database, claim.jobId, stage);
        persistenceTimings = await persistSnapshotPayload(database, claim.snapshot.id, payload, options.batchSizes ?? defaultPersistenceBatchSizes);
      } finally {
        await releaseSharedStorageMaintenanceLock(connection);
      }
      uniqueArtifacts = null;
      result = null;
      void uniqueArtifacts;
      void result;

      stage = "GRAPH_VERIFICATION";
      await updateJobStage(database, claim.jobId, stage);
      const graphReloadStarted = performance.now();
      const reconstructed = await reconstructBuildingCodeGraphForVerification(database, claim.snapshot.id);
      if (serializeCodeGraphToJson(reconstructed) !== originalGraphJson) throw new Error("Persisted graph is not canonically equivalent to analyzer output");
      const graphReloadMs = Math.max(0, Math.round(performance.now() - graphReloadStarted));

      stage = "PUBLICATION";
      await updateJobStage(database, claim.jobId, stage);
      const publicationStarted = performance.now();
      await publishSnapshot(database, claim.snapshot.id, claim.jobId, {
        fileCount: payload.files.length,
        entityCount: payload.entities.length,
        edgeCount: payload.edges.length,
        diagnosticCount: payload.diagnostics.length,
        unresolvedCount: payload.unresolvedRelationships.length,
        analysisStats: jsonObject(stats),
        analysisTelemetry: jsonObject(telemetry),
        graphSummary: jsonObject(graphSummary),
      });
      const publicationMs = Math.max(0, Math.round(performance.now() - publicationStarted));
      return {
        snapshotId: claim.snapshot.id, status: "READY", reusedSnapshot: false,
        repositoryLogicalId: repositoryId, commitSha: gitRepository.commitSha,
        analyzerName: analyzerIdentity.name, analyzerVersion: analyzerIdentity.version,
        fileCount: payload.files.length, entityCount: payload.entities.length, edgeCount: payload.edges.length,
        uploadedBlobs, reusedBlobs,
        timings: {
          analysisMs, sourceUploadMs, sourceVerificationMs, ...persistenceTimings,
          graphReloadMs, publicationMs, totalMs: Math.max(0, Math.round(performance.now() - totalStarted)),
        },
      };
    } catch (error) {
      const summary = error instanceof Error ? error.message : "Unknown indexing failure";
      try {
        await failSnapshot(database, claim.snapshot.id, claim.jobId, stage, "INDEX_FAILED", summary);
      } catch {
        // A later stale-BUILDING maintenance pass handles database outages during failure recording.
      }
      throw error;
    }
  });
}
