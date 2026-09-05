import { existsSync } from "node:fs";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createDatabase, databaseConfigFromEnvironment, defaultPersistenceBatchSizes } from "@codeatlas/db";
import { indexRepository } from "@codeatlas/indexer";
import { S3CompatibleSourceBlobStore, sourceStorageConfigFromEnvironment } from "@codeatlas/storage";

function usage(): never {
  throw new Error("Usage: pnpm benchmark:persistence <git-repository-path> --repository-id <logical-id>");
}

const arguments_ = process.argv.slice(2);
const repositoryPath = arguments_[0] ?? usage();
const repositoryIdIndex = arguments_.indexOf("--repository-id");
const repositoryLogicalId = repositoryIdIndex < 0 ? usage() : arguments_[repositoryIdIndex + 1] ?? usage();
const environmentPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

const database = createDatabase(databaseConfigFromEnvironment());
try {
  const versionRows = await database.client<{ server_version: string }[]>`SHOW server_version`;
  const result = await indexRepository(database, new S3CompatibleSourceBlobStore(sourceStorageConfigFromEnvironment()), {
    repositoryPath,
    repositoryLogicalId,
    batchSizes: defaultPersistenceBatchSizes,
  });
  if (result.reusedSnapshot) throw new Error("Persistence benchmark requires a new logical snapshot; choose a fresh repository ID or commit");
  const persistenceMs = result.timings.sourceUploadMs + result.timings.sourceVerificationMs + result.timings.filesMs + result.timings.entitiesMs + result.timings.edgesMs + result.timings.diagnosticsMs + result.timings.unresolvedRelationshipsMs + result.timings.graphReloadMs + result.timings.publicationMs;
  const perSecond = (count: number, milliseconds: number): number => milliseconds === 0 ? count : Math.round(count / (milliseconds / 1_000));
  const report = {
    repository: repositoryLogicalId,
    commitSha: result.commitSha,
    snapshotId: result.snapshotId,
    environment: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      cpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      postgres: versionRows[0]?.server_version ?? "unknown",
      batchSizes: defaultPersistenceBatchSizes,
    },
    counts: { files: result.fileCount, entities: result.entityCount, edges: result.edgeCount, uploadedBlobs: result.uploadedBlobs, reusedBlobs: result.reusedBlobs },
    timingsMs: {
      sourceUpload: result.timings.sourceUploadMs,
      sourceVerification: result.timings.sourceVerificationMs,
      files: result.timings.filesMs,
      entities: result.timings.entitiesMs,
      edges: result.timings.edgesMs,
      diagnostics: result.timings.diagnosticsMs,
      unresolvedRelationships: result.timings.unresolvedRelationshipsMs,
      publication: result.timings.publicationMs,
      graphReload: result.timings.graphReloadMs,
      persistenceTotalExcludingAnalysis: persistenceMs,
      analyzerExcluded: result.timings.analysisMs,
    },
    throughputPerSecond: {
      files: perSecond(result.fileCount, result.timings.filesMs),
      entities: perSecond(result.entityCount, result.timings.entitiesMs),
      edges: perSecond(result.edgeCount, result.timings.edgesMs),
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await database.close();
}
