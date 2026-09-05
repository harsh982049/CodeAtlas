# CodeAtlas

CodeAtlas turns JavaScript and TypeScript repositories into a typed, explainable structural code graph. The repository is at **Milestone 4 — immutable persisted snapshots**: exact analyzer output can be stored in PostgreSQL, exact source bytes can be retained in MinIO, and a fully verified snapshot is atomically published for readers.

PostgreSQL is authoritative for snapshot metadata and lifecycle, files, entities, edges, evidence, diagnostics, unresolved relationships, jobs, pins, and the current READY pointer. MinIO is authoritative for exact retained source blobs. See [PERSISTENCE.md](./docs/PERSISTENCE.md) for the design and [ANALYZER.md](./docs/ANALYZER.md) for the compiler frontend.

CodeAtlas never executes indexed source code, never runs repository scripts, and never installs indexed-repository dependencies. Milestone 4 makes no external AI, embedding, or LLM calls. Persistent snapshots require an exact clean Git revision; the standalone analyzer may also inspect non-Git directories under a deterministic content revision.

## Prerequisites and setup

- Node.js 22.13.0 or newer
- pnpm 11.24.0
- Docker with Compose
- Git

From the repository root:

```powershell
pnpm install
Copy-Item .env.example .env
docker compose up -d
pnpm db:migrate
```

The example environment uses PostgreSQL at port `55432` and MinIO's S3 endpoint at `59000`. `.env`, database state, object blobs, benchmark checkouts, and generated output are ignored by Git. Migrations are explicit; startup never pushes schema automatically.

## Analyze without persistence

The developer analyzer needs no Docker, PostgreSQL, or MinIO and accepts Git or non-Git directories:

```powershell
pnpm codeatlas analyze .\benchmark\fixtures\typescript-basic
pnpm codeatlas analyze .\benchmark\fixtures\typescript-basic --output .\.codeatlas-output\graph.json
```

## Persist and inspect a snapshot

Index a clean Git repository at its exact HEAD. The logical ID is caller-owned, globally unique within this CodeAtlas database, and intentionally contains no machine path:

```powershell
pnpm codeatlas index D:\Projects\my-app --repository-id local/my-app
```

Use the returned snapshot ID with the inspection and reconstruction commands:

```powershell
pnpm codeatlas snapshots local/my-app
pnpm codeatlas snapshot show <snapshot-id>
pnpm codeatlas graph export <snapshot-id> --output .\.codeatlas-output\persisted-graph.json
```

Re-indexing the same logical repository, commit SHA, analyzer name, and analyzer version reuses the READY snapshot. A changed exact HEAD produces a distinct snapshot and atomically advances the current pointer after complete source and graph verification.

Maintenance is explicit and dry-run-first:

```powershell
pnpm codeatlas maintenance snapshots --dry-run
pnpm codeatlas maintenance blobs --dry-run
```

`--apply` performs the reported eligible cleanup. Snapshot retention keeps the latest five READY snapshots per repository, the current snapshot, and snapshots with active expiring pins. Blob reconciliation has a 24-hour grace period and preserves objects referenced by any retained BUILDING, READY, or FAILED snapshot.

## Test Milestone 4

With the Docker services healthy and `.env` present:

```powershell
pnpm test:persistence
```

The reset helper has two independent guards: the database must be named `codeatlas_test`, and `CODEATLAS_TEST_ENVIRONMENT` must equal `1`. The integration suite uses real PostgreSQL and MinIO and covers lifecycle/publication, idempotency/concurrency, canonical graph and exact-byte round trips, integrity constraints, diagnostics/unresolved rows, pins/retention, and blob reconciliation.

Run the full local quality gates:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm benchmark:contracts
pnpm benchmark:analyzer
```

These Milestones 1–3 commands remain independent of PostgreSQL and MinIO.

## Benchmarks

Run persistence against a non-trivial clean Git checkout with a fresh logical ID (a previously published identity is intentionally rejected as a benchmark sample):

```powershell
pnpm benchmark:persistence D:\Projects\express --repository-id benchmark/express-run-1
```

The report excludes analyzer time from persistence totals and separates upload, source verification, each relational insertion phase, publication, graph reload, and files/entities/edges throughput.

Run the synthetic analyzer benchmarks:

```powershell
pnpm benchmark:contracts
pnpm benchmark:analyzer
```

Pinned real-repository analysis is opt-in and installs no external repository dependencies:

```powershell
pnpm benchmark:realworld:materialize
pnpm benchmark:realworld
```

Use `--only express`, `--only typescript`, `--only pnpm`, or `--only react-router` to narrow the real-repository commands.

## Repository layout

```text
packages/shared/       Cross-package identities, locations, confidence, and JSON contracts
packages/codegraph/    Entities, edges, fingerprints, graph validation, and serialization
packages/analyzer/     Safe TypeScript/JavaScript discovery, analysis, artifacts, and revisions
packages/db/           Drizzle schema/migration, lifecycle, batched persistence, and retention
packages/storage/      Provider-neutral blobs, S3-compatible adapter, keys, and stream hashing
packages/indexer/      Exact-Git orchestration, atomic publication, CLI, and reconciliation
benchmark/             Frozen fixture contracts, pinned repositories, and benchmark runners
docs/                  Product specification, architecture, implementation contracts, and ADRs
infra/                 Local PostgreSQL initialization
```

## Current scope and next step

Milestone 4 has no product API/UI, GitHub authorization, semantic retrieval, embeddings, LLM generation, history, impact analysis, diff analysis, or incremental indexing. It does not claim complete dynamic dispatch, runtime React rendering, installed dependency internals, or framework route/test inference.

The next milestone is a thin Symbol/Graph Explorer over READY snapshots: repository/snapshot browsing, search and filters, neighbor traversal, graph reconstruction, and authorized retained-source viewing. Semantic and AI features remain later milestones.
