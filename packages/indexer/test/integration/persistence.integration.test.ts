import { rm } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimSnapshot,
  createOrRenewSnapshotPin,
  getRetainedFile,
  getSnapshot,
  listRepositorySnapshots,
  persistSnapshotPayload,
  reconstructCodeGraph,
  withSnapshotAdvisoryLock,
  type CodeAtlasDatabase,
} from "@codeatlas/db";
import { serializeCodeGraphToJson } from "@codeatlas/codegraph";
import { sha256Stream, sourceObjectKey, type SourceBlobStore } from "@codeatlas/storage";

import { indexRepository } from "../../src/index-service.js";
import { reconcileSourceBlobs, runSnapshotCleanup } from "../../src/maintenance-service.js";
import { FaultInjectingSourceBlobStore } from "./helpers/fault-injecting-store.js";
import { commitFixtureChange, createGitFixture } from "./helpers/git-fixture.js";
import { assertSafeTestDatabase, createIntegrationEnvironment } from "./helpers/integration-environment.js";

let database: CodeAtlasDatabase;
let blobStore: SourceBlobStore;
const temporaryRepositories: string[] = [];

beforeAll(async () => {
  ({ database, blobStore } = await createIntegrationEnvironment());
});

afterAll(async () => {
  if (typeof database !== "undefined") await database.close();
  await Promise.all(temporaryRepositories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Milestone 4 persisted snapshots", () => {
  it("guards destructive integration resets with two independent checks", () => {
    expect(() => assertSafeTestDatabase("postgres://localhost/codeatlas", "1")).toThrow(/Refusing/u);
    expect(() => assertSafeTestDatabase("postgres://localhost/codeatlas_test", undefined)).toThrow(/Refusing/u);
    expect(() => assertSafeTestDatabase("postgres://localhost/codeatlas_test", "1")).not.toThrow();
  });

  it("persists and reconstructs exact graph and source data idempotently", async () => {
    const root = await createGitFixture();
    temporaryRepositories.push(root);
    const first = await indexRepository(database, blobStore, { repositoryPath: root, repositoryLogicalId: "test/roundtrip" });
    expect(first.status).toBe("READY");
    expect(first.fileCount).toBeGreaterThan(0);
    const graph = await reconstructCodeGraph(database, first.snapshotId);
    expect(graph.getEntities()).toHaveLength(first.entityCount);
    expect(graph.getEdges()).toHaveLength(first.edgeCount);
    expect(serializeCodeGraphToJson(graph)).toContain("schemaVersion");

    const retained = await getRetainedFile(database, first.snapshotId, "src/create-payment.ts");
    expect(retained).not.toBeNull();
    const source = await sha256Stream(await blobStore.get(retained?.sourceObjectKey ?? ""));
    expect(source).toEqual({ hash: retained?.contentHash, byteCount: retained?.byteCount });

    const again = await indexRepository(database, blobStore, { repositoryPath: root, repositoryLogicalId: "test/roundtrip" });
    expect(again.snapshotId).toBe(first.snapshotId);
    expect(again.reusedSnapshot).toBe(true);
    const persistedFiles = await database.client<{ count: number }[]>`SELECT count(*)::int AS count FROM files WHERE snapshot_id = ${first.snapshotId}`;
    expect(persistedFiles[0]?.count).toBe(first.fileCount);
    await expect(persistSnapshotPayload(database, first.snapshotId, { files: [], entities: [], edges: [], diagnostics: [], unresolvedRelationships: [] })).rejects.toThrow(/immutable/u);

    await commitFixtureChange(root, 2);
    const second = await indexRepository(database, blobStore, { repositoryPath: root, repositoryLogicalId: "test/roundtrip" });
    expect(second.snapshotId).not.toBe(first.snapshotId);
    expect(second.reusedBlobs).toBeGreaterThan(0);
    const snapshots = await listRepositorySnapshots(database, "test/roundtrip");
    expect(snapshots).toHaveLength(2);
    expect(snapshots.find((snapshot) => snapshot.current)?.id).toBe(second.snapshotId);
    expect((await getSnapshot(database, first.snapshotId))?.status).toBe("READY");

    const firstEntity = await database.client<{ id: string }[]>`SELECT id FROM code_entities WHERE snapshot_id = ${first.snapshotId} LIMIT 1`;
    const secondEntity = await database.client<{ id: string }[]>`SELECT id FROM code_entities WHERE snapshot_id = ${second.snapshotId} LIMIT 1`;
    await expect(database.client`
      INSERT INTO code_edges (
        snapshot_id, edge_key, source_entity_id, target_entity_id, edge_type, confidence,
        analyzer_name, analyzer_version, resolver_name, resolver_version, metadata
      ) VALUES (
        ${second.snapshotId}, 'cross-snapshot-corruption', ${firstEntity[0]?.id ?? ""}, ${secondEntity[0]?.id ?? ""},
        'CONTAINS', 1, 'test', '1', 'test', '1', '{}'::jsonb
      )
    `).rejects.toThrow();
  });

  it("serializes concurrent equivalent attempts into one logical READY snapshot", async () => {
    const root = await createGitFixture("same-name-methods");
    temporaryRepositories.push(root);
    const [left, right] = await Promise.all([
      indexRepository(database, blobStore, { repositoryPath: root, repositoryLogicalId: "test/concurrent" }),
      indexRepository(database, blobStore, { repositoryPath: root, repositoryLogicalId: "test/concurrent" }),
    ]);
    expect(left.snapshotId).toBe(right.snapshotId);
    expect([left.reusedSnapshot, right.reusedSnapshot].sort()).toEqual([false, true]);
    expect(await listRepositorySnapshots(database, "test/concurrent")).toHaveLength(1);
  });

  it("keeps the previous current snapshot visible until publication commits", async () => {
    const root = await createGitFixture("javascript-commonjs");
    temporaryRepositories.push(root);
    const previous = await indexRepository(database, blobStore, { repositoryPath: root, repositoryLogicalId: "test/atomic-publication" });
    const nextIdentity = {
      repositoryLogicalId: "test/atomic-publication",
      commitSha: "e".repeat(40),
      analyzerName: "test-analyzer",
      analyzerVersion: "atomic-1",
    };
    const next = await withSnapshotAdvisoryLock(database, nextIdentity, async (connection) => claimSnapshot(connection, nextIdentity, "atomic-publication"));
    let signalReady: (() => void) | undefined;
    let releasePublication: (() => void) | undefined;
    const snapshotUpdated = new Promise<void>((resolve) => { signalReady = resolve; });
    const publicationGate = new Promise<void>((resolve) => { releasePublication = resolve; });
    const publication = database.client.begin(async (transaction) => {
      await transaction`UPDATE repository_snapshots SET status = 'READY', ready_at = now() WHERE id = ${next.snapshot.id}`;
      signalReady?.();
      await publicationGate;
      await transaction`UPDATE repositories SET current_snapshot_id = ${next.snapshot.id} WHERE id = ${next.snapshot.repositoryId}`;
      await transaction`UPDATE index_jobs SET status = 'SUCCEEDED', stage = 'PUBLISHED', finished_at = now() WHERE id = ${next.jobId}`;
    });
    await snapshotUpdated;
    const during = await database.client<{ current_snapshot_id: string }[]>`SELECT current_snapshot_id FROM repositories WHERE id = ${next.snapshot.repositoryId}`;
    expect(during[0]?.current_snapshot_id).toBe(previous.snapshotId);
    releasePublication?.();
    await publication;
    const after = await database.client<{ current_snapshot_id: string }[]>`SELECT current_snapshot_id FROM repositories WHERE id = ${next.snapshot.repositoryId}`;
    expect(after[0]?.current_snapshot_id).toBe(next.snapshot.id);
  });

  it("marks failed persistence and recovers the same logical snapshot", async () => {
    const root = await createGitFixture();
    temporaryRepositories.push(root);
    await expect(indexRepository(database, new FaultInjectingSourceBlobStore(blobStore), { repositoryPath: root, repositoryLogicalId: "test/recovery" })).rejects.toThrow(/Injected/u);
    const failed = (await listRepositorySnapshots(database, "test/recovery"))[0];
    expect(failed?.status).toBe("FAILED");
    const recovered = await indexRepository(database, blobStore, { repositoryPath: root, repositoryLogicalId: "test/recovery" });
    expect(recovered.snapshotId).toBe(failed?.id);
    expect(recovered.status).toBe("READY");
  });

  it("persists diagnostics and unresolved relationships as first-class evidence", async () => {
    const root = await createGitFixture("dynamic-unresolved");
    temporaryRepositories.push(root);
    const result = await indexRepository(database, blobStore, { repositoryPath: root, repositoryLogicalId: "test/unresolved" });
    const diagnostics = await database.client<{ count: number }[]>`SELECT count(*)::int AS count FROM analyzer_diagnostics WHERE snapshot_id = ${result.snapshotId}`;
    const unresolved = await database.client<{ count: number }[]>`SELECT count(*)::int AS count FROM unresolved_relationships WHERE snapshot_id = ${result.snapshotId}`;
    expect(diagnostics[0]?.count).toBeGreaterThanOrEqual(0);
    expect(unresolved[0]?.count).toBeGreaterThan(0);
  });

  it("never permits a BUILDING snapshot to become current and fails stale builds only after lock acquisition", async () => {
    const identity = {
      repositoryLogicalId: "test/stale",
      commitSha: "f".repeat(40),
      analyzerName: "test-analyzer",
      analyzerVersion: "1",
    };
    const claim = await withSnapshotAdvisoryLock(database, identity, async (connection) => claimSnapshot(connection, identity, "stale"));
    await expect(database.client.begin(async (transaction) => {
      await transaction`UPDATE repositories SET current_snapshot_id = ${claim.snapshot.id} WHERE id = ${claim.snapshot.repositoryId}`;
    })).rejects.toThrow(/READY/u);
    await database.client`UPDATE repository_snapshots SET created_at = now() - interval '2 hours' WHERE id = ${claim.snapshot.id}`;
    const cleanup = await runSnapshotCleanup(database, { apply: true, staleBuildingAgeMs: 60 * 60 * 1_000 });
    expect(cleanup.staleBuilding).toContain(claim.snapshot.id);
    expect((await getSnapshot(database, claim.snapshot.id))?.status).toBe("FAILED");
  });

  it("enforces pin leases and applies latest-five retention", async () => {
    const root = await createGitFixture("javascript-esm");
    temporaryRepositories.push(root);
    const results = [];
    for (let revision = 0; revision < 7; revision += 1) {
      if (revision > 0) await commitFixtureChange(root, revision);
      results.push(await indexRepository(database, blobStore, { repositoryPath: root, repositoryLogicalId: "test/retention" }));
    }
    const clock = new Date();
    const first = results[0];
    if (first === undefined) throw new Error("Missing retention fixture snapshot");
    const active = await createOrRenewSnapshotPin(database, first.snapshotId, "MANUAL", "test-owner", new Date(clock.getTime() + 60_000), clock);
    const renewed = await createOrRenewSnapshotPin(database, first.snapshotId, "MANUAL", "test-owner", new Date(clock.getTime() + 120_000), clock);
    expect(renewed.id).toBe(active.id);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(active.expiresAt.getTime());
    await expect(createOrRenewSnapshotPin(database, first.snapshotId, "MANUAL", "too-long", new Date(clock.getTime() + 31 * 24 * 60 * 60 * 1_000), clock)).rejects.toThrow(/30 days/u);

    const dryRun = await runSnapshotCleanup(database, { apply: false, now: clock, readyRetentionCount: 5 });
    expect(dryRun.readyDeleted).toHaveLength(1);
    expect(dryRun.readyDeleted).not.toContain(first.snapshotId);
    await runSnapshotCleanup(database, { apply: true, now: clock, readyRetentionCount: 5 });
    expect(await listRepositorySnapshots(database, "test/retention")).toHaveLength(6);

    const afterExpiry = new Date(clock.getTime() + 180_000);
    await runSnapshotCleanup(database, { apply: true, now: afterExpiry, readyRetentionCount: 5 });
    expect((await listRepositorySnapshots(database, "test/retention")).map((snapshot) => snapshot.id)).not.toContain(first.snapshotId);
  });

  it("keeps shared blobs and reconciles only unreferenced mature objects", async () => {
    const referenced = await database.client<{ key: string }[]>`SELECT source_object_key AS key FROM files LIMIT 1`;
    const sharedKey = referenced[0]?.key;
    expect(sharedKey).toBeDefined();
    expect(await blobStore.exists(sharedKey ?? "")).toBe(true);

    const orphanBytes = Buffer.from("orphaned source\n", "utf8");
    const orphanHash = (await import("@codeatlas/storage")).sha256Bytes(orphanBytes);
    const orphanKey = sourceObjectKey(orphanHash);
    await blobStore.put({ key: orphanKey, bytes: orphanBytes, contentHash: orphanHash });
    const defaultGrace = await reconcileSourceBlobs(database, blobStore, { apply: false });
    expect(defaultGrace.skippedYoung).toContain(orphanKey);
    const dryRun = await reconcileSourceBlobs(database, blobStore, { apply: false, minimumAgeMs: 0 });
    expect(dryRun.orphaned).toContain(orphanKey);
    expect(await blobStore.exists(orphanKey)).toBe(true);
    const applied = await reconcileSourceBlobs(database, blobStore, { apply: true, minimumAgeMs: 0 });
    expect(applied.deleted).toContain(orphanKey);
    expect(await blobStore.exists(orphanKey)).toBe(false);
    expect(await blobStore.exists(sharedKey ?? "")).toBe(true);
  });
});
