# Contract fixtures and benchmarks

Milestone 1 established a small, pinned corpus before implementation of the TypeScript analyzer. Milestone 2 normalized and extended that corpus before analyzer code was written. The corpus lives in `benchmark/fixtures`; every fixture contains source text, a project configuration where relevant, `fixture.json`, and a hand-authored `golden.json`.

The fixture loader reads files as text and JSON only. It never imports fixture modules, runs package scripts, executes repository code, or installs fixture dependencies. This mirrors the V1 analysis security boundary.

## Corpus

The 18 Milestone 2 fixtures isolate high-value behavior:

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

Golden graphs identify entities through the same logical identity inputs the production analyzer must use. Edge expectations include direction, a minimum resolver-confidence assertion, optional specialized-metric tags, and source evidence. Unresolved expectations and diagnostic codes are asserted separately. Milestone 2 goldens are exhaustive for the analyzer behavior the fixture is intended to support, so unexpected analyzer entities and edges count as false positives. The loader verifies schemas, entity references, declared source paths, evidence file membership, and evidence line bounds; materializing every golden graph also exercises graph domain validation.

The original Milestone 1 goldens were normalized once, manually, before analyzer implementation. The normalization record is [`../benchmark/GOLDEN_NORMALIZATION.md`](../benchmark/GOLDEN_NORMALIZATION.md). Analyzer output was not used to choose expected entities or edges. These normalized files are frozen ground truth: later analyzer failures must be fixed in analyzer code or reproduced with a new human-authored fixture. A semantic correction to an existing golden requires explicit approval.

## Metrics

The comparison library reports exact-set true positives, false positives, false negatives, precision, recall, and F1 independently for entities and edges. Entity comparison uses stable keys. Edge comparison uses type plus logical endpoints, with either:

- `IGNORE`: ignore evidence ranges when matching an expected relationship;
- `LOCATION`: require the evidence location as part of the occurrence identity.

This distinction permits relationship-level evaluation and stricter occurrence-level evaluation without weakening production edge identity. Exact confidence equality is never part of graph identity. Callers can optionally enforce each golden edge's confidence value as a minimum threshold. Empty expected and actual sets score as a perfect match; an empty actual set against non-empty expectations scores zero precision and recall.

Golden edges can be tagged for future call-resolution or import-resolution slices, and unresolved expectations can be tagged for unresolved-call accuracy. The analyzer evaluator reports per-fixture and micro-aggregated entity, edge, unresolved-relationship, and diagnostic results. It exits unsuccessfully on any false positive or false negative in the supported deterministic corpus.

`benchmark:contracts` validates the corpus and golden graph contracts; it does not analyze source. Milestone 2's separate `benchmark:analyzer` command runs the real analyzer and reports entity/edge precision, recall, and F1 against the frozen goldens. Thresholds must reflect supported deterministic behavior rather than hide mismatches.

## Commands

From the repository root:

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm benchmark:contracts
pnpm benchmark:analyzer
```

The full benchmark program described by the V1 specification will later add pinned real-repository commits and separate cold-index versus warm-query measurements on documented 4 vCPU / 8 GB workers. External dependencies remain uninstalled during those analyses.
