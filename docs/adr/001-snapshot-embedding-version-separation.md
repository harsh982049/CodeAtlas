# ADR 001: Separate analysis snapshots from embedding indexes

- Status: Accepted
- Date: 2026-08-29

## Context

Structural analysis and semantic embedding have different inputs, costs, providers, and release cycles. Treating the embedding version as part of a structural snapshot would require rebuilding an otherwise unchanged code graph whenever an embedding model changes. It would also prevent two embedding models from being evaluated against the same structural evidence.

## Decision

An analysis snapshot is uniquely identified by repository, exact commit SHA, structural analyzer name, and structural analyzer version. The analyzer name and version form a `StructuralAnalyzerIdentity`; neither value is assumed to be globally unique by itself. The snapshot contains snapshot-scoped files, code entities, code edges, chunks, and eagerly indexed local history.

Embedding indexes are separate resources associated with one analysis snapshot. An embedding index records provider, model, version, dimensions, and lifecycle status. The version covers CodeAtlas chunk serialization, preprocessing, and redaction behavior. Vectors are stored in `chunk_embeddings`, keyed by embedding index and semantic code chunk. Each row records the source chunk content hash and the hash of the actual post-redaction provider input so stale or differently prepared vectors cannot be silently reused.

Structural analysis can be published and used without any embedding index. Re-embedding creates a new embedding index or safely completes an existing one; it does not mutate or rebuild the analysis snapshot.

Structural job identity is repository + commit SHA + analyzer name + analyzer version. Embedding job identity is snapshot + provider + model + version.

## Consequences

- Structural results remain reproducible independently of an AI provider.
- Multiple models can be benchmarked over identical chunks and graph data.
- Index selection must be explicit in semantic-query metadata.
- Retention and repository deletion must cascade from the snapshot to its embedding indexes.
- Provider/model migrations require embedding storage capacity but not compiler reanalysis.
