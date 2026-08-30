# Contract fixtures and benchmarks

Milestone 1 establishes a small, pinned corpus before implementing the TypeScript analyzer. The corpus lives in `benchmark/fixtures`; every fixture contains source text, a project configuration where relevant, `fixture.json`, and a hand-authored `golden.json`.

The fixture loader reads files as text and JSON only. It never imports fixture modules, runs package scripts, executes repository code, or installs fixture dependencies. This mirrors the V1 analysis security boundary.

## Corpus

The initial 13 fixtures isolate high-value behavior:

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

Golden graphs identify entities through the same logical identity inputs the production analyzer must use. Edge expectations include direction, a minimum resolver-confidence assertion, optional specialized-metric tags, and source evidence. Unresolved expectations and diagnostic codes are asserted separately. The loader verifies schemas, entity references, declared source paths, evidence file membership, and evidence line bounds; materializing every golden graph also exercises graph domain validation.

## Metrics

The comparison library reports exact-set true positives, false positives, false negatives, precision, recall, and F1 independently for entities and edges. Entity comparison uses stable keys. Edge comparison uses type plus logical endpoints, with either:

- `IGNORE`: ignore evidence ranges when matching an expected relationship;
- `LOCATION`: require the evidence location as part of the occurrence identity.

This distinction permits relationship-level evaluation and stricter occurrence-level evaluation without weakening production edge identity. Exact confidence equality is never part of graph identity. Callers can optionally enforce each golden edge's confidence value as a minimum threshold. Empty expected and actual sets score as a perfect match; an empty actual set against non-empty expectations scores zero precision and recall.

Golden edges can be tagged for future call-resolution or import-resolution slices, and unresolved expectations can be tagged for unresolved-call accuracy. The base evaluator intentionally reports only overall entity and edge metrics until analyzer output exists.

Milestone 1's `benchmark:contracts` command validates the corpus and golden graph contracts. It does **not** report analyzer accuracy because the analyzer is intentionally not implemented yet. Milestone 2 will run analyzer output against these same goldens and publish entity/edge precision, recall, and F1. Thresholds should be introduced only after observing baseline results rather than choosing arbitrary passing scores.

## Commands

From the repository root:

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm benchmark:contracts
```

The full benchmark program described by the V1 specification will later add pinned real-repository commits and separate cold-index versus warm-query measurements on documented 4 vCPU / 8 GB workers. External dependencies remain uninstalled during those analyses.
