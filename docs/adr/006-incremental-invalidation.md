# ADR 006: Use bounded fingerprint-aware incremental invalidation

- Status: Accepted
- Date: 2026-08-29

## Context

Reanalyzing only textually changed files can leave stale semantic relationships when an exported type or signature changes. Reanalyzing every repository for every commit defeats the purpose of incremental indexing. V1 needs a bounded rule with a correctness-preserving fallback.

## Decision

Every commit produces a new immutable analysis snapshot, even when its data is built incrementally. Readers see it only after atomic publication.

An implementation-only change, determined by unchanged declaration fingerprint and changed implementation fingerprint, reanalyzes the changed file. A declaration or public-surface change invalidates the changed file plus reverse internal module dependents.

Reverse invalidation is bounded to two module hops and the smaller of 500 files or 20 percent of repository files. If discovering the invalidation set would exceed either limit, the job falls back to full structural analysis.

Git rename detection is applied before cross-snapshot entity matching. Unchanged validated data may be copied forward or content-address reused, but all rows remain logically owned by the new snapshot. Changed chunks are re-embedded for the selected embedding index by content hash; embedding work does not change structural job identity.

## Consequences

- Declaration fingerprints must be reliable because they select the incremental path.
- Full-analysis fallback is expected behavior, not a failure.
- Metrics must record invalidation reason, visited module hops, candidate file count, and fallback frequency.
- Snapshot publication and retries must remain idempotent even when unchanged data is reused.
- The two-hop/500-file/20-percent thresholds are initial V1 policy and may be revised only with benchmark evidence.
