# Code graph contract

This document describes the executable graph contract established in Milestone 1 and hardened through the Milestone 3 analyzer. It narrows the [V1 specification](./CODEATLAS_V1_SPEC.md) into framework-independent values that analyzers and persistence adapters must obey.

## Boundary

`LanguageAnalyzer` accepts a repository root, a source revision, an optional persisted analysis-snapshot identity, project hints, and explicit file/file-size/traversal/depth/time limits. It returns an in-memory graph, statistics, diagnostics, unresolved relationships, and analysis telemetry. A persisted snapshot may use only an exact Git revision matching its commit SHA. Local/debug analysis may instead use a deterministic content revision and no persisted snapshot identity. Implementations inspect source without executing it. Milestone 3's concrete behavior is documented in [ANALYZER.md](./ANALYZER.md).

All repository paths stored in contracts are normalized, repository-relative, forward-slash paths. Source ranges are half-open: `[start, end)`. Line and column values are both one-based to preserve the Milestone 1 location contract. The start identifies the first included character; the end identifies the first excluded character. TypeScript zero-based line/column positions are therefore converted by adding one to both values.

`FILE` represents one physical repository source file. Source-level `IMPORTS` and `EXPORTS` normally originate from `FILE`. `MODULE` represents a repository-contained logical project or package boundary discovered from artifacts such as a workspace `package.json`, workspace configuration, or a TypeScript project. A module is not created for every source file. Its logical identity is rooted in the normalized repository-relative project/package root, preferably its repository-contained `package.json`.

## Entity identity

Every entity has two related identity values:

- `canonicalIdentity` is the versioned, canonical JSON representation of the logical identity inputs.
- `stableKey` is a versioned SHA-256 digest of that canonical identity.

For named source entities, logical identity is `file path + entity kind + qualified name`. A callable signature is intentionally excluded. Changing parameters or return types therefore preserves the stable key and changes the declaration fingerprint, allowing a later diff engine to classify the entity as `MODIFIED` rather than remove-plus-add.

Declaration fingerprints represent public/declaration shape. Implementation fingerprints represent normalized bodies where a body exists. Their schemas and prefixes are independent so callers cannot accidentally treat one as the other. Anonymous functions use their lexical parent, syntactic role, and a local structural fingerprint; their identity stability is expected to be lower than a named declaration. External packages use ecosystem plus normalized package root.

TypeScript overloads belong in one callable declaration fingerprint. The TypeScript analyzer emits one logical callable entity for an overload set where practical, not one entity per signature.

## Entities and edges

The entity-kind vocabulary is `REPOSITORY`, `MODULE`, `FILE`, `FUNCTION`, `METHOD`, `CONSTRUCTOR`, `CLASS`, `INTERFACE`, `TYPE_ALIAS`, `ENUM`, `VARIABLE`, `COMPONENT`, `API_ROUTE`, `TEST`, `EXTERNAL_PACKAGE`, and `UNRESOLVED`. It deliberately excludes commits, pull requests, issues, and developers. `CodeEntity` includes analyzer provenance and JSON-safe metadata. Entity `identityStability` describes the stability of matching inputs; it is not edge confidence, impact certainty, answer confidence, or risk severity.

Every `CodeEdge` is a directed occurrence. Its key includes endpoints, edge type, analyzer/resolver provenance, and evidence location, permitting multiple call sites between the same entities. Edges carry:

- a resolver and version;
- analyzer provenance;
- confidence from zero to one;
- a source evidence range where available;
- JSON-safe metadata.

The complete edge-domain rules are:

| Edge | Allowed direction/domain |
| --- | --- |
| `CONTAINS` | repository/module/file/class/interface/enum → non-repository child |
| `IMPORTS` | importing module/file → module/file/external-package/unresolved target; source-level edges normally use files |
| `EXPORTS` | module/file → non-repository code entity; source-level edges normally use files |
| `CALLS` | expression-owning entity or API route → function/method/constructor/component |
| `REFERENCES` | expression-owning entity → non-repository entity, excluding call occurrences |
| `EXTENDS` | class → class or interface → interface |
| `IMPLEMENTS` | class → interface |
| `INSTANTIATES` | expression-owning entity → class |
| `ROUTES_TO` | API route → function/method/constructor/component handler |
| `TESTS` | test → non-repository, non-unresolved code entity |
| `DEPENDS_ON` | module/external package → module/file/external-package/unresolved dependency |
| `POSSIBLE_CALL` | expression-owning entity → a statically bounded callable candidate |

Expression owners currently include module, file, function, method, constructor, class, variable, component, and test. These rules reject clearly impossible relationships while leaving structurally plausible JavaScript patterns representable. `REFERENCES` cannot duplicate an already represented call occurrence. `POSSIBLE_CALL` is reserved for a bounded set of known candidate callees when static dispatch is ambiguous; fully unknown dynamic dispatch belongs in the analyzer's unresolved-relationship output.

The in-memory graph rejects missing endpoints, invalid source/target domains, conflicting duplicate identities, containment cycles, and call/reference duplication. It provides deterministic adjacency queries, bounded forward traversal, bounded reverse traversal, optional edge-type filtering, and paths explaining every reached entity. Serialization sorts identities and occurrences so the same graph has stable JSON independent of insertion order.

## Unresolved evidence and diagnostics

Incomplete resolution is represented explicitly, never silently upgraded to certainty. `UnresolvedRelationship` records the known source (if any), intended edge type, original target text, reason, and evidence. Reasons cover absent dependencies, ambiguity, computed specifiers, dynamic dispatch, malformed source, scope limits, and unsupported syntax.

Diagnostics are separate from unresolved relationships. A syntax error is a diagnostic; a computed import is an unresolved relationship. An analyzer may return a partial graph alongside either. Statistics make discovered, analyzed, and skipped files—as well as graph and error counts—observable.

## External package normalization

Milestone 3 statistics additionally expose analyzed bytes and lines, anonymous entities, and detailed resolution counts. Telemetry records ordered phase durations, CPU usage, and peak process RSS. Limit violations are typed analyzer errors and do not depend on parsing human-readable messages.

The normalizer never reads installed package code. It turns `express` into npm package `express`; `lodash/fp` into package `lodash` plus subpath `fp`; and `@scope/package/subpath` into package `@scope/package` plus subpath `subpath`. Only the package root receives an `EXTERNAL_PACKAGE` entity. The requested specifier and subpath remain available for edge metadata, and package version is nullable because dependencies are not installed.

Node built-ins normalize to an explicit `NODE_BUILTIN` ecosystem: `fs`, `node:fs`, and `node:fs/promises` share package entity `node:fs`, with any subpath retained separately. Relative, absolute, import-map, URL-scheme, and malformed specifiers are not classified as npm package roots by this utility.

## Package ownership

- `packages/shared`: brands, snapshot identities, normalized paths, source locations, JSON-safe values, and distinct confidence/risk value types.
- `packages/codegraph`: identities, fingerprints, entities, directed edge semantics, in-memory storage, traversal, validation, and deterministic serialization.
- `packages/analyzer`: language-neutral contracts plus the in-memory JavaScript/TypeScript Compiler API frontend. Production analyzer code has no dependency on benchmark ground truth.
- `benchmark`: fixture/golden schemas, safe loaders, graph materialization, analyzer execution/comparison metrics, and isolated pinned-repository evaluation.

These contracts are storage-neutral. PostgreSQL snapshot persistence is a later milestone and must adapt to these values rather than adding database concerns to the analyzer.
