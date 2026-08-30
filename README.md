# CodeAtlas

CodeAtlas is intended to turn a JavaScript/TypeScript repository into an accurate, typed, and explainable structural code graph. The repository is currently at **Milestone 1: contracts, golden fixtures, and benchmark foundation**.

There is no web application, API server, database, or repository-analysis CLI yet. Milestone 1 is run through its validation and test commands. Its purpose is to define what the future analyzer must produce before implementing that analyzer.

For the complete product design, read [the V1 specification](./docs/CODEATLAS_V1_SPEC.md). The shorter architecture entry point is [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## What Milestone 1 implements

- Stable logical entity identities that exclude declaration signatures.
- Separate declaration and implementation fingerprints.
- Typed code entities and directed structural edges.
- Edge provenance, evidence locations, and numeric analyzer confidence.
- In-memory graph insertion, validation, adjacency queries, bounded traversal, and deterministic serialization.
- Contracts for analyzer input, results, statistics, diagnostics, and unresolved relationships.
- Separate structural snapshot and embedding-index identity types.
- npm, scoped-package, and Node built-in specifier normalization.
- Thirteen small JavaScript/TypeScript fixture repositories.
- Hand-authored golden graphs describing the expected entities and relationships.
- Precision, recall, and F1 comparison utilities for future analyzer output.

The detailed graph rules are in [docs/CODE_GRAPH_CONTRACT.md](./docs/CODE_GRAPH_CONTRACT.md). Fixture and scoring methodology are in [docs/BENCHMARKS.md](./docs/BENCHMARKS.md).

## Prerequisites

- Node.js 22.13.0 or newer.
- pnpm 11.24.0. The intended pnpm version is recorded in `package.json`.

If pnpm is not already available, a recent Node installation can activate the declared version through Corepack:

```bash
corepack enable
corepack install
```

## Install

From the repository root:

```bash
pnpm install
```

Dependencies are pinned in `package.json` and `pnpm-lock.yaml`. This command installs CodeAtlas development dependencies only. Do not run installation commands inside `benchmark/fixtures`; fixture repositories are untrusted test data and are never executed.

## Run the Milestone 1 checks

Run the complete test suite:

```bash
pnpm test
```

Run static type checking:

```bash
pnpm typecheck
```

Run linting:

```bash
pnpm lint
```

Validate all fixture manifests and golden graphs, exercise graph validation, and test the graph-comparison metrics:

```bash
pnpm benchmark:contracts
```

For a full local acceptance pass, run all four commands. A passing `benchmark:contracts` result means the benchmark contracts are internally valid; it is **not** a claim about analyzer accuracy because no source analyzer exists yet.

## Where to look

```text
packages/shared/       Shared value types, paths, locations, and confidence vocabulary
packages/codegraph/    Entity, edge, identity, fingerprint, graph, and serialization logic
packages/analyzer/     Language-neutral analyzer interfaces only
benchmark/fixtures/    Tiny source repositories and their golden graphs
benchmark/src/         Fixture validation, materialization, and comparison utilities
benchmark/test/        Controlled benchmark contract tests
docs/                  Specification, architecture, ADRs, and contract documentation
```

Useful starting points:

- `packages/codegraph/src/entity.ts` — canonical entity model.
- `packages/codegraph/src/edge.ts` — canonical edge model and occurrence identity.
- `packages/codegraph/src/graph.ts` — in-memory graph behavior.
- `packages/analyzer/src/language-analyzer.ts` — boundary the next analyzer must implement.
- `benchmark/fixtures/typescript-basic/golden.json` — an example expected graph.
- `benchmark/src/comparison.ts` — entity/edge precision, recall, and F1 evaluation.

## What is intentionally unavailable

There is currently no `pnpm dev` command and no command such as:

```text
codeatlas analyze <repository>
```

Those would imply application and analyzer functionality outside Milestone 1. PostgreSQL, object storage, queues, GitHub integration, embeddings, LLM features, impact analysis, and UI code are also intentionally absent.

## Recommended next steps

The next milestone should implement the first in-memory JavaScript/TypeScript analyzer against the contracts and goldens already present:

1. Discover repository-contained `tsconfig.json` and `jsconfig.json` projects and source files without installing dependencies or executing repository code.
2. Construct TypeScript `Program` instances and use the TypeScript Compiler API and `TypeChecker` to extract named entities, declaration/implementation fingerprint inputs, imports, exports, containment, inheritance, construction, references, and statically resolved calls.
3. Emit diagnostics and first-class unresolved relationships instead of inventing edges for dynamic or ambiguous code.
4. Run analyzer output against the 13 golden fixtures and report entity/edge precision, recall, and F1. Add focused fixtures for every discovered bug.
5. Harden JavaScript, CommonJS, re-export, monorepo, malformed-source, and TSX behavior until the benchmark is credible.

Only after the in-memory analyzer produces useful benchmark results should CodeAtlas proceed to PostgreSQL-backed immutable snapshots, followed by a thin graph explorer. Semantic retrieval, grounded Q&A, Git intelligence, impact analysis, diffs, incremental indexing, and full GitHub/deployment work come later in the roadmap.
