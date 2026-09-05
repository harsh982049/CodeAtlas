import {
  cleanupSnapshots,
  isSourceObjectReferenced,
  withExclusiveStorageMaintenanceLock,
  type CodeAtlasDatabase,
  type SnapshotCleanupOptions,
  type SnapshotCleanupResult,
} from "@codeatlas/db";
import {
  contentHashFromSourceObjectKey,
  type SourceBlobStore,
} from "@codeatlas/storage";

export interface BlobReconciliationOptions {
  readonly apply: boolean;
  readonly now?: Date;
  readonly minimumAgeMs?: number;
}

export interface BlobReconciliationResult {
  readonly orphaned: readonly string[];
  readonly deleted: readonly string[];
  readonly skippedYoung: readonly string[];
  readonly skippedMalformed: readonly string[];
}

export async function runSnapshotCleanup(database: CodeAtlasDatabase, options: SnapshotCleanupOptions): Promise<SnapshotCleanupResult> {
  return cleanupSnapshots(database, options);
}

export async function reconcileSourceBlobs(
  database: CodeAtlasDatabase,
  blobStore: SourceBlobStore,
  options: BlobReconciliationOptions,
): Promise<BlobReconciliationResult> {
  const now = options.now ?? new Date();
  const minimumAgeMs = options.minimumAgeMs ?? 24 * 60 * 60 * 1_000;
  if (!Number.isSafeInteger(minimumAgeMs) || minimumAgeMs < 0) throw new Error("minimumAgeMs must be a non-negative safe integer");
  await blobStore.ensureBucket();
  return withExclusiveStorageMaintenanceLock(database, async () => {
    const orphaned: string[] = [];
    const deleted: string[] = [];
    const skippedYoung: string[] = [];
    const skippedMalformed: string[] = [];
    for await (const object of blobStore.list("source/sha256/")) {
      if (contentHashFromSourceObjectKey(object.key) === null) {
        skippedMalformed.push(object.key);
        continue;
      }
      if (object.lastModified === null || now.getTime() - object.lastModified.getTime() < minimumAgeMs) {
        skippedYoung.push(object.key);
        continue;
      }
      if (await isSourceObjectReferenced(database, object.key)) continue;
      orphaned.push(object.key);
      if (!options.apply) continue;
      if (await isSourceObjectReferenced(database, object.key)) continue;
      const stat = await blobStore.stat(object.key);
      if (stat === null || stat.lastModified === null || now.getTime() - stat.lastModified.getTime() < minimumAgeMs) continue;
      await blobStore.delete(object.key);
      deleted.push(object.key);
    }
    return { orphaned, deleted, skippedYoung, skippedMalformed };
  });
}
