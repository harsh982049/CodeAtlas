# ADR 008: Use globally content-addressed retained source blobs

- Status: Accepted
- Date: 2026-09-04

## Context

Exact analyzed bytes must remain available after temporary clones are deleted. PostgreSQL and object storage do not share a transaction, while identical files commonly occur across commits and repositories. Snapshot-scoped object keys would duplicate immutable bytes and complicate safe cleanup.

## Decision

MinIO locally and S3-compatible storage in production retain immutable blobs in bucket `codeatlas-source` under:

```text
source/sha256/<first-two-hash-characters>/<full-lowercase-sha256>
```

The SHA-256 is computed over the original bytes read by the analyzer. Snapshot-scoped `files` rows store the content hash and object key; PostgreSQL remains authoritative for membership, metadata, relationships, references, and authorization. Required objects are uploaded or reused and stream-verified before READY publication.

Indexers hold a shared storage-maintenance advisory lock while uploading through creation of relational file references. Orphan reconciliation takes the exclusive lock, considers references from every retained BUILDING, READY, and FAILED snapshot, ignores malformed keys, applies a minimum object-age grace period, and rechecks immediately before an explicitly requested deletion. It defaults to dry-run and aborts when either system is ambiguous or unavailable.

This ADR supersedes only ADR 004's earlier snapshot-scoped object-key layout. ADR 004's source authority, retention, authorization, deletion, external-AI consent, redaction, and security decisions remain in force.

## Consequences

- Identical bytes can be reused across commits, snapshots, and repositories.
- Removing a snapshot never directly deletes a potentially shared object.
- Failed attempts may leave safe immutable orphans until reconciliation.
- Integrity verification adds measurable I/O and must be reported separately.
