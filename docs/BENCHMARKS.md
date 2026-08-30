# Contract fixtures and benchmarks

Milestone 1 established a small, pinned corpus before implementation of the TypeScript analyzer. Milestone 2 normalized and extended that corpus before analyzer code was written. Milestone 3 adds new fixtures without modifying the frozen earlier goldens and adds pinned real-repository assertions. The synthetic corpus lives in `benchmark/fixtures`; every fixture contains source text, a project configuration where relevant, `fixture.json`, and a hand-authored `golden.json`.

The fixture loader reads files as text and JSON only. It never imports fixture modules, runs package scripts, executes repository code, or installs fixture dependencies. This mirrors the V1 analysis security boundary.

## Corpus

The 23 synthetic fixtures isolate high-value behavior:

| Fixture | Contract under test |
| --- | --- |
| `typescript-basic` | Typed imports, containment, constructors, and calls |
| `same-name-methods` | Qualified identity for same-named class methods |
| `aliased-imports` | Alias resolution to the original declaration |
| `reexports` | Barrel imports and exports |
| `inheritance` | `EXTENDS`, `IMPLEMENTS`, and inherited method calls |
| `constructors` | Constructor containment and `INSTANTIATES` |
| `javascript-esm` | JavaScript ESM relationships |
| `javascript-commonjs` | CommonJS require/export relationships |
| `tsx-react` | Probable components and static JSX references |
| `circular-imports` | Cyclic imports without traversal failure |
| `monorepo-basic` | Workspace and paths-based internal resolution |
| `dynamic-unresolved` | Computed imports and dynamic dispatch |
| `malformed-source` | Partial output plus syntax diagnostics |
| `path-aliases` | `baseUrl`/`paths` internal resolution |
| `external-packages` | npm, scoped package, and Node built-in identities |
| `no-config` | Inferred JavaScript project behavior |
| `callable-bindings` | Arrow/function-expression binding identity |
| `anonymous-callback` | Low-stability lexical identity for unbound callbacks |
| `project-references` | Referenced-project ordering and cross-project callable resolution |
| `workspace-package-exports` | Exact/wildcard conditional exports and retained-source mapping |
| `overload-sets` | One logical callable with aggregate declaration/body fingerprints |
| `overlapping-projects` | Explicit multi-project root ownership diagnostics |
| `external-config-extends` | Safe failure for unavailable external config packages |

Golden graphs identify entities through the same logical identity inputs the production analyzer must use. Edge expectations include direction, a minimum resolver-confidence assertion, optional specialized-metric tags, and source evidence. Unresolved expectations and diagnostic codes are asserted separately. Milestone 2 goldens are exhaustive for the analyzer behavior the fixture is intended to support, so unexpected analyzer entities and edges count as false positives. The loader verifies schemas, entity references, declared source paths, evidence file membership, and evidence line bounds; materializing every golden graph also exercises graph domain validation.

The original Milestone 1 goldens were normalized once, manually, before analyzer implementation. The normalization record is [`../benchmark/GOLDEN_NORMALIZATION.md`](../benchmark/GOLDEN_NORMALIZATION.md). Analyzer output was not used to choose expected entities or edges. These normalized files are frozen ground truth: later analyzer failures must be fixed in analyzer code or reproduced with a new human-authored fixture. A semantic correction to an existing golden requires explicit approval.

## Metrics

The comparison library reports exact-set true positives, false positives, false negatives, precision, recall, and F1 independently for entities and edges. Entity comparison uses stable keys. Edge comparison uses type plus logical endpoints, with either:

- `IGNORE`: ignore evidence ranges when matching an expected relationship;
- `LOCATION`: require the evidence location as part of the occurrence identity.

This distinction permits relationship-level evaluation and stricter occurrence-level evaluation without weakening production edge identity. Exact confidence equality is never part of graph identity. Callers can optionally enforce each golden edge's confidence value as a minimum threshold. Empty expected and actual sets score as a perfect match; an empty actual set against non-empty expectations scores zero precision and recall.

Golden edges can be tagged for future call-resolution or import-resolution slices, and unresolved expectations can be tagged for unresolved-call accuracy. The analyzer evaluator reports per-fixture and micro-aggregated entity, edge, unresolved-relationship, and diagnostic results. It exits unsuccessfully on any false positive or false negative in the supported deterministic corpus.

`benchmark:contracts` validates the corpus and golden graph contracts; it does not analyze source. The separate `benchmark:analyzer` command runs the real analyzer and reports entity/edge precision, recall, and F1 against the frozen goldens. Thresholds must reflect supported deterministic behavior rather than hide mismatches.

## Pinned real repositories

Milestone 3 adds exact commits of `microsoft/TypeScript`, `expressjs/express`, `pnpm/pnpm`, and `remix-run/react-router`. The manifest records repository coordinates, full commit SHA, release context, license, category, purpose, size estimate, and the matching assertion file. The 40 assertions are hand-authored facts, not analyzer-generated goldens. Each fact includes a source path, valid line range, and SHA-256 of the complete evidence file; the evaluator rejects stale hashes or selectors that do not identify exactly one entity.

Materialization accepts only the manifest's direct HTTPS GitHub URLs and full SHAs. It uses an isolated Git configuration, disables hooks/prompts and LFS smudging, does not initialize submodules, enables Windows long paths, and verifies `HEAD`, `origin`, and the tracked worktree. Checkouts are cached under `.codeatlas-cache/checkouts/<slug>`; the exact SHA is verified before every analysis. Neither repository code nor repository dependency installation is executed.

Each repository runs in a separate Node process with an outer hard timeout and bounded analyzer limits. The JSON result records host OS/architecture/logical CPU count/memory, Node version, the no-external-dependencies policy, phase/resource telemetry, throughput, graph summary, assertion results, and pass/fail status. This is a cold structural-analysis benchmark; warm query benchmarking starts after persistence/query components exist. The specification's normalized comparison target remains a documented 4 vCPU / 8 GB worker, so results from other hardware must identify that hardware rather than be presented as directly comparable.

## Commands

From the repository root:

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm benchmark:contracts
pnpm benchmark:analyzer
pnpm benchmark:realworld:materialize
pnpm benchmark:realworld
```

The real-repository commands accept repeated `--only <slug>` filters. The runner also accepts `--output <path>` for retained JSON and both commands accept `--cache <path>` and `--manifest <path>` for controlled environments. External dependencies remain uninstalled during every analysis.
