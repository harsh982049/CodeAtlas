# ADR 004: Retain source in object storage and require consent for external AI

- Status: Accepted
- Date: 2026-08-29

## Context

Temporary clones must be deleted after indexing, but source viewing and citation validation require the exact indexed content. Private source and historical text may also contain secrets or prompt-injection content. Structural CodeAtlas features must not depend on disclosure to an external AI provider.

## Decision

PostgreSQL is authoritative for metadata, authorization, index state, entities, relationships, and history metadata. MinIO locally and S3 in production are authoritative for retained exact source bytes. Each snapshot-scoped `files` record stores the object key and content hash.

ADR 008 supersedes only the earlier snapshot-scoped object-key layout: immutable blobs are globally content-addressed and can be shared across repositories and snapshots. Snapshot membership, authorization, retention references, and source metadata remain authoritative in PostgreSQL.

The authorized source API verifies user → GitHub App installation → repository access, retrieves the object, validates its hash, and returns only authorized content. Browser clients never receive object-store credentials. Source retention follows snapshot retention, and repository deletion removes or schedules removal of all retained blobs.

Temporary clones are deleted on both successful and failed indexing jobs. Repository code is never executed and dependencies are never installed.

Secret redaction runs before source-derived text is sent to either an external embedding provider or an external generation provider. Repository source, comments, documentation, commits, PRs, issues, and reviews are untrusted evidence and never instructions.

Private repositories require explicit per-repository opt-in before source-derived text is sent to an external provider. Without consent or an external provider, structural analysis, graph exploration, lexical search, local Git intelligence, and structural impact analysis continue to function.

## Consequences

- Object storage is mandatory in local and production deployments.
- Cleanup must be durable, retryable, reference-aware, and auditable across database and object storage boundaries.
- Redaction lowers disclosure risk but cannot guarantee discovery of every secret; this remains a documented limitation.
- Semantic search and generated explanations may be unavailable for a private repository that has not opted in.
- Consent, provider purpose, and revocation require durable metadata and authorization tests.
