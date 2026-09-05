# ADR 007: Publish snapshots atomically under database-owned index attempts

- Status: Accepted
- Date: 2026-09-04

## Context

Analysis, object upload, and hundreds of thousands of relational inserts cannot safely or efficiently share one transaction. Concurrent attempts for the same structural identity must not publish duplicate graphs, readers must never observe a partial current snapshot, and failed attempts must remain retryable without weakening logical snapshot uniqueness.

## Decision

Structural snapshot identity is repository + exact commit SHA + structural analyzer name + structural analyzer version. A PostgreSQL session advisory lock derived from that identity owns an indexing attempt; the unique database constraint remains authoritative.

The claim transaction creates or finds the repository and logical snapshot and creates an `index_jobs` attempt. Analysis, source storage, and bounded structural inserts occur while the snapshot is `BUILDING`, outside one long database transaction. Required blobs and the reconstructed graph are verified before publication. Snapshot rows represent logical results; `index_jobs` rows represent individual attempts, including a successful no-op attempt that reuses an existing READY result.

Publication is one transaction that locks the repository and snapshot, verifies the snapshot is complete and `BUILDING`, changes it to `READY`, updates `repositories.current_snapshot_id`, and completes the job. Readers therefore observe either the prior READY snapshot or the new READY snapshot.

Allowed lifecycle transitions are `BUILDING → READY`, `BUILDING → FAILED`, and controlled `FAILED → BUILDING`. The retry transition is permitted only for the same logical identity while its advisory lock is held, after partial child rows are cleared, failure fields are reset, and a new job attempt is created. A stale BUILDING snapshot must first be failed by maintenance after its age threshold and only when that identity's advisory lock can be acquired. READY is terminal and structurally immutable through normal persistence APIs.

## Consequences

- Snapshot rows represent logical structural results; job rows preserve attempt history.
- A process crash releases its advisory lock. Explicit maintenance can fail stale BUILDING rows only after acquiring that lock.
- Partial BUILDING rows may be committed in bounded batches but are never current or reader-visible.
- Failure never disturbs the previously published current snapshot.
- Privileged direct SQL is outside Milestone 4 immutability enforcement; database-role hardening is deferred.
