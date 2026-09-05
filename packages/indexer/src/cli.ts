import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  createLocalAnalyzerInput,
  summarizeCodeGraph,
  typescriptJavaScriptAnalyzer,
} from "@codeatlas/analyzer";
import { serializeCodeGraph, serializeCodeGraphToJson } from "@codeatlas/codegraph";
import {
  createDatabase,
  databaseConfigFromEnvironment,
  getSnapshot,
  listRepositorySnapshots,
  reconstructCodeGraph,
} from "@codeatlas/db";
import {
  S3CompatibleSourceBlobStore,
  sourceStorageConfigFromEnvironment,
} from "@codeatlas/storage";

import { indexRepository } from "./index-service.js";
import { reconcileSourceBlobs, runSnapshotCleanup } from "./maintenance-service.js";

function usage(): never {
  process.stderr.write([
    "Usage:",
    "  pnpm codeatlas analyze <path> [--output <file>]",
    "  pnpm codeatlas index <git-path> --repository-id <logical-id>",
    "  pnpm codeatlas snapshots <logical-id>",
    "  pnpm codeatlas snapshot show <snapshot-id>",
    "  pnpm codeatlas graph export <snapshot-id> --output <file>",
    "  pnpm codeatlas maintenance snapshots (--dry-run|--apply)",
    "  pnpm codeatlas maintenance blobs (--dry-run|--apply)",
  ].join("\n") + "\n");
  process.exitCode = 2;
  throw new Error("Invalid command line");
}

function option(arguments_: readonly string[], name: string): string | null {
  const index = arguments_.indexOf(name);
  if (index < 0) return null;
  return arguments_[index + 1] ?? usage();
}

function loadEnvironment(): void {
  const environmentPath = path.resolve(".env");
  if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);
}

async function analyze(arguments_: readonly string[]): Promise<void> {
  const repository = arguments_[0] ?? usage();
  const output = option(arguments_, "--output");
  const input = await createLocalAnalyzerInput(repository);
  const result = await typescriptJavaScriptAnalyzer.analyze(input);
  const serializedGraph = serializeCodeGraph(result.graph);
  const graphSummary = summarizeCodeGraph(result.graph, result.diagnostics, result.unresolvedRelationships);
  const document = {
    schemaVersion: 1,
    revision: input.revision,
    analyzer: { name: typescriptJavaScriptAnalyzer.name, version: typescriptJavaScriptAnalyzer.version },
    entities: serializedGraph.entities,
    edges: serializedGraph.edges,
    stats: result.stats,
    diagnostics: result.diagnostics,
    unresolvedRelationships: result.unresolvedRelationships,
    telemetry: result.telemetry,
    graphSummary,
  };
  process.stdout.write([
    "CodeAtlas Analyzer",
    `Repository              ${path.resolve(repository)}`,
    `Files analyzed          ${result.stats.filesAnalyzed}`,
    `Entities                ${result.stats.entitiesExtracted}`,
    `Edges                   ${result.stats.edgesCreated}`,
    `Elapsed                 ${result.stats.elapsedMs} ms`,
    `Peak RSS                ${(result.telemetry.peakRssBytes / 1024 / 1024).toFixed(1)} MiB`,
  ].join("\n") + "\n");
  if (output !== null) {
    const outputPath = path.resolve(output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    process.stdout.write(`Graph export             ${outputPath}\n`);
  }
}

async function withDatabase<T>(operation: (database: ReturnType<typeof createDatabase>) => Promise<T>): Promise<T> {
  loadEnvironment();
  const database = createDatabase(databaseConfigFromEnvironment());
  try {
    return await operation(database);
  } finally {
    await database.close();
  }
}

async function index(arguments_: readonly string[]): Promise<void> {
  const repositoryPath = arguments_[0] ?? usage();
  const repositoryLogicalId = option(arguments_, "--repository-id") ?? usage();
  await withDatabase(async (database) => {
    const blobStore = new S3CompatibleSourceBlobStore(sourceStorageConfigFromEnvironment());
    const result = await indexRepository(database, blobStore, { repositoryPath, repositoryLogicalId });
    process.stdout.write([
      "CodeAtlas Index",
      "",
      `Repository       ${result.repositoryLogicalId}`,
      `Commit           ${result.commitSha}`,
      `Analyzer         ${result.analyzerName}@${result.analyzerVersion}`,
      `Snapshot         ${result.snapshotId}`,
      `Status           ${result.status}${result.reusedSnapshot ? " (reused)" : ""}`,
      `Files            ${result.fileCount}`,
      `Entities         ${result.entityCount}`,
      `Edges            ${result.edgeCount}`,
      `Blobs uploaded   ${result.uploadedBlobs}`,
      `Blobs reused     ${result.reusedBlobs}`,
      `Analysis         ${result.timings.analysisMs} ms`,
      `Persistence      ${result.timings.filesMs + result.timings.entitiesMs + result.timings.edgesMs + result.timings.diagnosticsMs + result.timings.unresolvedRelationshipsMs} ms`,
      `Total            ${result.timings.totalMs} ms`,
      "Current snapshot promoted ✓",
    ].join("\n") + "\n");
  });
}

async function snapshots(arguments_: readonly string[]): Promise<void> {
  const logicalId = arguments_[0] ?? usage();
  await withDatabase(async (database) => {
    const records = await listRepositorySnapshots(database, logicalId);
    if (records.length === 0) {
      process.stdout.write(`No snapshots found for ${logicalId}.\n`);
      return;
    }
    for (const record of records) {
      process.stdout.write(`${record.current ? "*" : " "} ${record.id} ${record.status} ${record.commitSha} ${record.analyzerName}@${record.analyzerVersion} files=${record.fileCount} entities=${record.entityCount} edges=${record.edgeCount}\n`);
    }
  });
}

async function snapshot(arguments_: readonly string[]): Promise<void> {
  if (arguments_[0] !== "show") usage();
  const snapshotId = arguments_[1] ?? usage();
  await withDatabase(async (database) => {
    const record = await getSnapshot(database, snapshotId);
    if (record === null) throw new Error(`Snapshot not found: ${snapshotId}`);
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  });
}

async function graph(arguments_: readonly string[]): Promise<void> {
  if (arguments_[0] !== "export") usage();
  const snapshotId = arguments_[1] ?? usage();
  const output = option(arguments_, "--output") ?? usage();
  await withDatabase(async (database) => {
    const reconstructed = await reconstructCodeGraph(database, snapshotId);
    const outputPath = path.resolve(output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serializeCodeGraphToJson(reconstructed), "utf8");
    process.stdout.write(`Persisted graph exported to ${outputPath}\n`);
  });
}

async function maintenance(arguments_: readonly string[]): Promise<void> {
  const target = arguments_[0] ?? usage();
  const apply = arguments_.includes("--apply");
  if (!apply && !arguments_.includes("--dry-run")) usage();
  await withDatabase(async (database) => {
    if (target === "snapshots") {
      const result = await runSnapshotCleanup(database, { apply });
      process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }, null, 2)}\n`);
      return;
    }
    if (target === "blobs") {
      const blobStore = new S3CompatibleSourceBlobStore(sourceStorageConfigFromEnvironment());
      const result = await reconcileSourceBlobs(database, blobStore, { apply });
      process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }, null, 2)}\n`);
      return;
    }
    usage();
  });
}

async function main(): Promise<void> {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command === "analyze") return analyze(arguments_);
  if (command === "index") return index(arguments_);
  if (command === "snapshots") return snapshots(arguments_);
  if (command === "snapshot") return snapshot(arguments_);
  if (command === "graph") return graph(arguments_);
  if (command === "maintenance") return maintenance(arguments_);
  usage();
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.message !== "Invalid command line") process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
