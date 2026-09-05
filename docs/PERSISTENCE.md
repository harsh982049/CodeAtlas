# Immutable snapshot persistence

Milestone 4 persists analyzer output as immutable structural snapshots. PostgreSQL owns metadata, lifecycle, graph relationships, evidence, and source references. MinIO locally, or an S3-compatible provider in production, owns the exact retained source bytes. The analyzer remains storage-neutral and can still run without either service.

## Package boundaries

- `packages/db` defines the Drizzle schema, committed migration, database client, lifecycle operations, bounded graph persistence, reconstruction, pin leases, and retention primitives.
- `packages/storage` defines the provider-neutral source-blob interface, content-address helpers, stream hashing, and the S3-compatible implementation.
- `packages/indexer` validates an exact Git checkout and orchestrates analysis, storage, persistence, verification, publication, maintenance, and the persistence CLI.
- `packages/analyzer` returns a graph plus storage-neutral `SourceArtifact` values. It does not import PostgreSQL, Drizzle, S3, or MinIO concepts.

No schema is pushed at application startup. `pnpm db:migrate` applies the committed numbered migration explicitly.

## Relational model

Milestone 4 deliberately creates only nine tables:

| Table | Responsibility |
| --- | --- |
| `repositories` | Unique caller-supplied `logical_id` and the current READY snapshot pointer |
| `repository_snapshots` | Logical structural result, identity, lifecycle, counts, analyzer statistics, and failure summary |
| `files` | Snapshot membership, normalized path, exact content hash, object key, role, format, and byte/line counts |
| `code_entities` | Stable identity, kind, location, fingerprints, analyzer provenance, and metadata |
| `code_edges` | Typed endpoints, occurrence key, confidence, resolver provenance, evidence, and metadata |
| `analyzer_diagnostics` | Ordered, first-class diagnostics and optional locations |
| `unresolved_relationships` | Ordered unresolved evidence, reason, intended edge, and optional source entity |
| `index_jobs` | Append-only attempt history and stage/failure status |
| `snapshot_pins` | Expiring `MANUAL`, `ACTIVE_DIFF`, or `ACTIVE_PR` retention leases |

The logical structural identity is:

```text
repository_id + commit_sha + analyzer_name + analyzer_version
```

It controls the unique constraint, snapshot lookup, advisory-lock key, retry ownership, and job matching. Analyzer name plus version is a `StructuralAnalyzerIdentity`; it is unrelated to a future embedding provider/model/version identity.

Within a snapshot, file paths, entity stable keys, and edge occurrence keys are unique. Composite foreign keys require an entity's file and every edge endpoint/evidence file to belong to the edge's snapshot. Unresolved source entities and evidence files obey the same rule. A deferred same-repository foreign key plus constraint trigger ensures `repositories.current_snapshot_id` belongs to that repository and is READY.

## Source artifact and object contract

Repository discovery reads each accepted source or material project-configuration file once as exact bytes. The analyzer hashes those bytes, decodes the same buffer for compiler analysis, and returns:

```text
path, role, format, bytes, contentHash, byteCount, lineCount
```

`PROJECT_CONFIGURATION` artifacts include discovered `tsconfig.json`, `jsconfig.json`, `package.json`, and relevant workspace configuration when those files materially participate in discovery. Source bytes are not serialized into graph/debug JSON. The indexer deduplicates artifacts by hash without copying their buffers, uploads and verifies them, then releases its byte-array references before graph reconstruction/publication.

The fixed local bucket is `codeatlas-source`; the object key is:

```text
source/sha256/<first-two-hash-characters>/<full-lowercase-sha256>
```

The hash is over original bytes, never decoded or re-encoded text. Objects are immutable and globally reusable across repositories, commits, and snapshots. A `files` row remains snapshot-scoped and points to the shared object. Before publication, every required object is stream-read and its SHA-256 and byte count are checked against the file record.

## Exact Git boundary

Persistent local indexing requires an explicit logical repository ID and a clean Git checkout. The indexer uses read-only Git commands to verify the top-level repository, exact `HEAD`, and empty porcelain status before analysis, then verifies the same HEAD and clean status afterward. It never stores an absolute path or machine-derived path hash.

The debug-only `codeatlas analyze` command may analyze a non-Git directory under a deterministic `CONTENT` revision. A CONTENT revision can never be persisted as a repository snapshot.

## Lifecycle, attempts, and transactions

A snapshot is a logical result; an `index_jobs` row is an attempt to create or reuse it. Allowed transitions are:

```text
BUILDING -> READY
BUILDING -> FAILED
FAILED   -> BUILDING  (controlled retry of the same identity)
```

READY is terminal and application-level immutable. Normal graph persistence checks that the target is BUILDING. Database-role protection against arbitrary privileged SQL is deferred to security hardening; retention is allowed to delete an entire unprotected READY snapshot.

The indexer holds a PostgreSQL session advisory lock for the full logical attempt. Work is divided as follows:

1. A short claim transaction creates/finds the repository and snapshot and creates a job attempt.
2. Analysis and object upload run without a long relational transaction.
3. Files, entities, edges, diagnostics, and unresolved relationships are committed in configurable bounded batches while the snapshot remains BUILDING.
4. Objects are hash-verified and the graph is reconstructed into the existing `InMemoryCodeGraph`, validated, and compared with the analyzer's deterministic serialization.
5. One publication transaction locks snapshot/repository state, rechecks all counts, changes BUILDING to READY, changes the current pointer, and marks the job SUCCEEDED.

Readers use READY-only reconstruction and source lookup. They can therefore observe the previous READY snapshot or the newly published READY snapshot, never a partially persisted graph. Publication failure leaves the previous current pointer unchanged.

A FAILED snapshot may return to BUILDING only under the same logical advisory lock. Its partial structural children and failure fields are cleared and a new job attempt is inserted. READY rows are never reset. Maintenance may first mark an abandoned BUILDING attempt FAILED only after its stale threshold passes and the identity lock can be acquired.

Equivalent concurrent attempts serialize at PostgreSQL. The winner publishes one logical snapshot; the waiter then sees READY, creates a successful reuse job, and returns the existing result. The unique constraint is still authoritative if an advisory-lock hash collision or client bug occurs.

## Batch persistence and reconstruction

Parameterized multi-row inserts default to 500 files, 500 entities, 1,000 edges, 500 diagnostics, and 500 unresolved relationships per batch. The sizes are configurable. Inserts do not use `ON CONFLICT DO NOTHING`; duplicate paths, stable keys, or edge occurrence keys are correctness failures. COPY is deferred until measurements demonstrate a need.

Reconstruction loads READY rows in deterministic order, recreates the exact accepted `CodeEntity` and `CodeEdge` contracts, validates the graph, and compares its canonical serializer output to the pre-persistence graph. Fingerprints, metadata, confidence, resolver provenance, occurrence keys, and evidence locations survive the round trip. Diagnostics and unresolved relationships are stored as rows rather than collapsed into counts.

## Retention, pins, and blob reconciliation

Explicit snapshot maintenance defaults to retaining, per repository, the latest five READY snapshots, the current snapshot, and every snapshot protected by an unexpired pin. FAILED deletion has a configurable minimum age. A pin is unique by snapshot + type + owner/reference, always expires, is limited to 30 days from creation or renewal, and can be renewed. Expired pins provide no protection. Milestone 4 reserves ACTIVE_DIFF and ACTIVE_PR semantics but implements no diff/PR workflow.

Deleting a snapshot never directly deletes a source object because another snapshot may reference the same hash. Blob reconciliation is a separate dry-run-first operation. Index uploads hold a shared storage-maintenance advisory lock; reconciliation holds the exclusive lock. It considers references from BUILDING, READY, and FAILED snapshots, inspects only valid content-address keys, defaults to a 24-hour object-age grace period, and rechecks the relational reference immediately before deletion. Ambiguous or unavailable PostgreSQL/object-storage state aborts the operation.

## Failure behavior and known limits

- PostgreSQL and object storage do not participate in a distributed transaction. A failed attempt may leave an immutable unreferenced object, which conservative reconciliation later identifies.
- Failure summaries are bounded and URL-like credential-bearing values are redacted. Full production secret management and database-role separation remain future security work.
- The indexer currently runs in-process and synchronously. Redis/BullMQ and isolated remote workers are not part of Milestone 4.
- MinIO is the tested local provider. S3-compatible production deployment, IAM, TLS, and lifecycle configuration are not deployed here.
- Retention and reconciliation are explicit CLI operations, not daemons.
- Source retrieval through an authorized product API arrives with the explorer/API milestone; the persistence layer supplies the exact file reference and provider-neutral stream.
- Structural analysis still has reduced third-party resolution without repository `node_modules`; repository code is never executed and its dependencies are never installed.

The atomic lifecycle decision is [ADR 007](./adr/007-atomic-snapshot-publication-and-index-ownership.md); global blob semantics and conservative cleanup are [ADR 008](./adr/008-content-addressed-source-storage-and-reconciliation.md).
