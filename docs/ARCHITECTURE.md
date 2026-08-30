# CodeAtlas V1 Architecture

This document is the architecture entry point required by `AGENTS.md`. The complete product and engineering contract is in [`CODEATLAS_V1_SPEC.md`](./CODEATLAS_V1_SPEC.md); accepted decisions and their consequences are in [`adr/`](./adr/).

The executable Milestone 1 boundaries are documented in [`CODE_GRAPH_CONTRACT.md`](./CODE_GRAPH_CONTRACT.md), and the fixture/golden evaluation method is documented in [`BENCHMARKS.md`](./BENCHMARKS.md).

## System shape

```text
Browser
  → Next.js web
  → Fastify API
      → PostgreSQL metadata/index/relationships
      → MinIO or S3 retained source blobs
      → Redis/BullMQ indexing jobs
          → isolated worker clone
          → TypeScript Compiler API + Git
```

The worker never executes repository code or installs dependencies. It publishes immutable analysis snapshots atomically. Query, exploration, history, and impact features consume only `READY` snapshots.

## Intelligence layers

- Structural intelligence comes from snapshot-scoped `code_entities` and `code_edges` with resolver provenance, evidence, and edge confidence.
- Semantic intelligence comes from semantic `code_chunks` and separate, replaceable embedding indexes.
- Historical intelligence comes from relational Git/GitHub records, eager file-level history, and lazy cached symbol/PR/issue archaeology.
- The LLM explains retrieved evidence. Structural analysis and graph exploration work without external AI.

## Authoritative decisions

- [ADR 001: Separate analysis snapshots from embedding indexes](./adr/001-snapshot-embedding-version-separation.md)
- [ADR 002: Store a generic code-entity graph in PostgreSQL](./adr/002-code-entity-graph-storage.md)
- [ADR 003: Separate logical symbol identity from declaration and implementation changes](./adr/003-symbol-identity-cross-snapshot-matching.md)
- [ADR 004: Retain source in object storage and require consent for external AI](./adr/004-source-retention-external-ai-privacy.md)
- [ADR 005: Separate confidence concepts and use categorical V1 impact risk](./adr/005-confidence-impact-semantics.md)
- [ADR 006: Use bounded fingerprint-aware incremental invalidation](./adr/006-incremental-invalidation.md)

If this overview conflicts with the specification or an accepted ADR, the accepted ADR governs its decision and the specification must be updated to match it.
