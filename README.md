# CodeAtlas

CodeAtlas turns JavaScript and TypeScript repositories into a typed, explainable structural code graph. The repository is at **Milestone 3: code graph hardening**. It discovers multi-project repositories, parses source with the TypeScript Compiler API, resolves deterministic relationships with `TypeChecker`, and measures output against synthetic goldens plus evidence-backed facts at pinned real-repository commits.

The product design is in [docs/CODEATLAS_V1_SPEC.md](./docs/CODEATLAS_V1_SPEC.md). See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the system overview, [docs/CODE_GRAPH_CONTRACT.md](./docs/CODE_GRAPH_CONTRACT.md) for graph semantics, [docs/ANALYZER.md](./docs/ANALYZER.md) for the analyzer architecture and implementation, and [docs/BENCHMARKS.md](./docs/BENCHMARKS.md) for evaluation.

## Implemented

- Safe, bounded repository and TypeScript/JavaScript project discovery with typed limit failures, traversal/depth bounds, phase timings, CPU usage, and peak process RSS.
- Configured and inferred TypeScript `Program` construction, project-reference ordering, overlap diagnostics, and repository-contained `extends` handling without loading repository dependencies.
- `FILE`, workspace `MODULE`, function/component, class/member, interface, type, enum, variable, and external-package entities.
- `CONTAINS`, `IMPORTS`, `EXPORTS`, `CALLS`, `REFERENCES`, `EXTENDS`, `IMPLEMENTS`, `INSTANTIATES`, and workspace `DEPENDS_ON` edges.
- ESM aliases and fixed-point star re-exports, static CommonJS patterns, path aliases, workspace package exports, TSX component heuristics, syntax-error recovery, and explicit unresolved dynamic evidence.
- Stable keys plus separate declaration and implementation fingerprints.
- Deterministic local source revisions, edge evidence/confidence/provenance, graph validation, and JSON export.
- Logical TypeScript overload sets with aggregate declaration fingerprints and one meaningful implementation fingerprint.
- Deterministic graph summaries covering entity/edge distributions, connected components, isolated entities, degree leaders, diagnostics, and unresolved relationships.
- Twenty-three synthetic fixtures plus 40 hand-authored facts over pinned TypeScript, Express, pnpm, and React Router commits.

Analyzed repository code is never executed. CodeAtlas does not run repository scripts and does not install repository dependencies. Missing `node_modules` intentionally reduces third-party type resolution; imports still become external-package entities.

## Prerequisites and install

- Node.js 22.13.0 or newer.
- pnpm 11.24.0 (declared in `package.json`).

From the repository root:

```bash
pnpm install
```

This installs CodeAtlas development dependencies only. Never install dependencies inside benchmark fixtures.

## Analyze a repository

Print a developer-friendly analysis summary:

```bash
pnpm codeatlas analyze ./benchmark/fixtures/typescript-basic
```

Export the revision, deterministic entity/edge arrays, statistics, diagnostics, and unresolved relationships as JSON:

```bash
pnpm codeatlas analyze ./benchmark/fixtures/typescript-basic --output graph.json
```

The same command accepts an absolute or relative path to another local JavaScript/TypeScript repository. A Git repository uses its readable exact HEAD as the debug source revision; another directory receives a deterministic content revision.

## Validate Milestone 3

Run all quality gates individually:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm benchmark:contracts
pnpm benchmark:analyzer
```

`benchmark:contracts` validates fixture manifests, frozen golden graphs, evidence bounds, and graph domains without running the analyzer. `benchmark:analyzer` analyzes every fixture and compares actual entities, edges, unresolved relationships, and diagnostics against those goldens, reporting per-fixture and aggregate precision, recall, and F1.

The real-repository suite is opt-in because it clones pinned public commits and takes longer. Materialization uses Git only; it skips LFS content and submodules, disables hooks and prompts, installs no external dependencies, and verifies the exact SHA, remote, and clean worktree:

```bash
pnpm benchmark:realworld:materialize
pnpm benchmark:realworld
```

Use `--only express` (or `typescript`, `pnpm`, `react-router`) with either command for one repository. Use `pnpm benchmark:realworld -- --output result.json` to retain the cold-analysis metrics, hardware description, resource limits, graph summary, and per-fact results. Cached checkouts live under `.codeatlas-cache/checkouts` and are ignored by Git and ESLint.

## Repository layout

```text
packages/shared/       Paths, locations, snapshot identities, confidence, and JSON contracts
packages/codegraph/    Entities, edges, identities, fingerprints, graph storage, and serialization
packages/analyzer/     Compiler frontend, safe discovery, resolution, CLI, diagnostics, and revisions
benchmark/fixtures/    Small source repositories and frozen human-authored golden graphs
benchmark/realworld/   Pinned public repositories and evidence-backed assertion contracts
benchmark/src/         Contract validation and analyzer benchmark evaluator
docs/                  Specification, architecture, analyzer/graph contracts, benchmarks, and ADRs
```

## Current limitations and next step

Milestone 3 remains in-memory and structural. It has no database, API, UI, GitHub integration, semantic retrieval, LLM, impact analysis, or incremental indexing. It does not claim complete dynamic JavaScript dispatch, runtime React rendering, installed dependency internals, or framework route/test inference. Repository time limits are cooperative inside the analyzer; the real-world harness adds a hard worker-process timeout.

The next milestone is PostgreSQL immutable snapshot persistence: snapshot lifecycle and atomic publication, files/entities/edges/chunks, source-blob references, idempotent jobs, retention, and `current_snapshot_id` promotion only for `READY` snapshots.
