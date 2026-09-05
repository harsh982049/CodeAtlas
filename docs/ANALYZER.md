# JavaScript/TypeScript analyzer

Milestone 3 hardened the read-only, in-memory JavaScript/TypeScript frontend in `packages/analyzer`; Milestone 4 extends its result with exact, storage-neutral source artifacts. It produces the graph contract defined in [CODE_GRAPH_CONTRACT.md](./CODE_GRAPH_CONTRACT.md) and has no database, network, benchmark-ground-truth, object-storage, or application dependency.

## Security and repository discovery

The analyzer reads source and project metadata as text. It never imports repository modules, executes repository code, runs lifecycle scripts, or installs dependencies. Discovery skips symlinks, NUL-containing source, explicit `.min.js` variants, conservatively detected extremely long generated/minified files, and common dependency, VCS, coverage, and build-output directories. Explicit file-count, file-size, traversal-entry, directory-depth, and elapsed-time limits bound cooperative work. Limit failures use typed codes rather than message parsing. The compiler host exposes retained repository files plus TypeScript's own standard-library declarations; it does not expose repository `node_modules` or ambient `@types` packages.

Deadlines are checked during repository discovery, project construction boundaries, source iteration, entity extraction, and relationship traversal. TypeScript `Program` construction is synchronous and cannot be interrupted safely inside the process, so the library deadline is cooperative. The pinned-repository benchmark runs each analysis in an isolated child process with a hard outer timeout. Results include phase timings, user/system CPU time, analyzed bytes/lines, anonymous-entity counts, and the process high-water RSS measurement.

## Projects and resolution

Every repository-contained `tsconfig*.json` and `jsconfig*.json` is parsed with the TypeScript configuration API. Project references are ordered deterministically, cycles and missing targets are diagnosed, and files that are explicit roots of multiple configured projects receive an overlap diagnostic. A file uses the closest configured program that owns it; uncovered files receive an inferred program with JavaScript and JSX enabled. Repository-contained `extends`, `baseUrl`, and `paths` are honored without loading external configuration packages. The analyzer does not run `npm install`.

Relationship resolution uses `TypeChecker` symbols and aliases, declaration locations, TypeScript module resolution, and conservative repository-contained fallbacks. It resolves ESM imports, direct exports, fixed-point named/star re-exports, literal CommonJS `require` including direct property selection, `module.exports`, `exports.name`, calls, construction, class/interface heritage, runtime references, and static JSX component references. Legal heritage targets outside the V1 edge domains become explicit unresolved evidence instead of invalid graph edges. Bare dependencies become canonical `EXTERNAL_PACKAGE` entities; missing package contents are not analyzed.

Named nested workspace packages become `MODULE` entities. Exact and wildcard `exports` entries select `types`, `node`, `import`, `require`, and `default` conditions deterministically. When a package publishes generated `lib`, `dist`, or `build` paths that are absent from the retained checkout, the resolver can map the entry back to a corresponding `src` TypeScript file. A found workspace package whose declared entry cannot be mapped remains `OUTSIDE_ANALYSIS_SCOPE`; it is not silently converted to a third-party package.

## Entity extraction

Every successfully parsed repository source becomes a `FILE`. Supported declarations include named functions, identifiable arrow/function-expression bindings, classes, methods, constructors, interfaces and interface methods, type aliases, enums, meaningful exported variables, probable function/arrow React components, logical workspace packages, and external packages.

`MODULE` is a logical workspace package/project rooted in its repository-contained package descriptor; it is not a synonym for a source file. Source `IMPORTS` and `EXPORTS` originate from `FILE`. Workspace modules contain owned files and gain cross-package `DEPENDS_ON` edges.

Conservative JSX-producing PascalCase function and arrow declarations use `COMPONENT` with heuristic provenance. A probable React class component remains `CLASS` with React metadata, so its methods retain ordinary `CLASS CONTAINS METHOD` semantics. This is not a complete runtime render graph.

Stable identity excludes callable signatures. Declaration and implementation token streams are fingerprinted separately, ignoring comments and formatting trivia. Same-symbol function, method, and constructor overload declarations reuse one logical callable identity, aggregate the declaration surface, and fingerprint the single implementation body where present. Unbound callbacks use a lower-stability identity derived from lexical parent, syntactic role/occurrence, and normalized local structure; CodeAtlas does not invent a named stable key for them.

## Evidence, revisions, and partial results

Source locations are half-open `[start, end)`. TypeScript's zero-based offset-to-line/column conversion adds one to both line and column, preserving CodeAtlas's one-based line and one-based column contract. Every emitted edge includes analyzer/resolver provenance, confidence, and source evidence when available.

Production `AnalysisSnapshotIdentity` is repository + exact Git commit SHA + structural analyzer name + structural analyzer version. `SourceRevision` is separate: local analysis uses a real `GIT` HEAD when it can read one safely, otherwise a `CONTENT` SHA-256 over sorted normalized relative paths and their content hashes. Content revisions contain no absolute paths, timestamps, or machine data and never masquerade as commit SHAs. Persistence accepts only an exact matching Git revision; CONTENT revisions remain debug/analyzer-only.

Discovery reads accepted files once as raw bytes. SHA-256 is calculated over those original bytes and the same buffer is decoded for compiler analysis. `AnalyzerResult.sourceArtifacts` returns normalized path, `SOURCE` or `PROJECT_CONFIGURATION` role, format, exact bytes, content hash, byte count, and line count. Material configuration files discovered for analysis—such as TypeScript/JavaScript project configs, package descriptors, and workspace configs—are retained alongside source files. These values contain no PostgreSQL, MinIO, S3, bucket, or object-key concepts. Ordinary graph serialization deliberately excludes bytes.

The Milestone 4 indexer deduplicates equal-hash artifacts without copying buffers and releases its result/artifact references after source and structural persistence. Memory regression was measured with identical analyzer code and pinned inputs before and after the artifact extension. On this development host, pnpm increased from 1,625.5 MiB to 1,667.7 MiB peak RSS (+42.2 MiB, +2.6%); TypeScript increased from 1,453.7 MiB to 1,559.6 MiB (+105.9 MiB, +7.3%). Entity, edge, file, line, and assertion results were unchanged. The increase was bounded enough that a disk spool was not introduced; future larger-repository measurements may still justify one.

A malformed file emits `TS_PARSE_ERROR` and `MALFORMED_SOURCE`, contributes no trusted entities, and does not prevent valid files from producing a graph. Computed imports and unresolved dynamic dispatch produce first-class unresolved relationships instead of speculative edges. Diagnostics, unresolved relationships, and counters are returned beside partial graph output.

The CLI emits the graph statistics and telemetry plus a deterministic summary: entity and edge counts by kind, connected components, isolated entities, highest-degree entities, diagnostic counts, and unresolved counts. This summary is diagnostic output, not a replacement for the graph or a persistence schema.

## Current limits

- No external dependency contents or repository ambient types are loaded, so resolution is intentionally reduced without `node_modules`.
- Workspace discovery currently uses nested named `package.json` files; the workspace-glob files themselves are not a full package-manager implementation.
- Generic dynamic dispatch, computed imports, decorators, mixins, framework routes, test-subject inference, and runtime React behavior remain conservative or unresolved.
- Conditional package exports are a conservative source resolver, not a complete Node/package-manager runtime implementation; generated layouts without a deterministic retained-source mapping remain unresolved.
- Explicit project-root overlap is diagnosed, while shared transitive dependencies are expected and are not treated as ownership conflicts.
- Analysis remains in-memory and storage-neutral even though Milestone 4 can persist its result through separate database, storage, and indexer packages.
