# JavaScript/TypeScript analyzer

Milestone 2 implements a read-only, in-memory JavaScript/TypeScript frontend in `packages/analyzer`. It produces the graph contract defined in [CODE_GRAPH_CONTRACT.md](./CODE_GRAPH_CONTRACT.md) and has no database, network, benchmark-ground-truth, or application dependency.

## Security and repository discovery

The analyzer reads source and project metadata as text. It never imports repository modules, executes repository code, runs lifecycle scripts, or installs dependencies. Discovery skips symlinks, NUL-containing source, explicit `.min.js` variants, conservatively detected extremely long generated/minified files, and common dependency, VCS, coverage, and build-output directories. Explicit file-count, file-size, and elapsed-time limits bound cooperative work. The compiler host exposes retained repository files plus TypeScript's own standard-library declarations; it does not expose repository `node_modules` or ambient `@types` packages.

Deadlines are checked during repository discovery, project construction boundaries, source iteration, entity extraction, and relationship traversal. TypeScript `Program` construction is synchronous and cannot be interrupted safely inside the process, so Milestone 2 is cooperative rather than a hard CPU limit. A later isolated worker/process boundary must enforce hard termination.

## Projects and resolution

Every repository-contained `tsconfig*.json` and `jsconfig*.json` is parsed with the TypeScript configuration API. Configured root files receive a `Program`; uncovered files receive an inferred program with JavaScript and JSX enabled. `extends`, `baseUrl`, and `paths` can resolve only through retained project/config/source files. The analyzer does not run `npm install`.

Relationship resolution uses `TypeChecker` symbols and aliases, declaration locations, TypeScript module resolution, and conservative repository-contained fallbacks. It resolves ESM imports, direct exports, named and star re-exports, literal CommonJS `require`, `module.exports`, `exports.name`, calls, construction, class/interface heritage, runtime references, and static JSX component references. Bare dependencies become canonical `EXTERNAL_PACKAGE` entities; missing package contents are not analyzed.

## Entity extraction

Every successfully parsed repository source becomes a `FILE`. Supported declarations include named functions, identifiable arrow/function-expression bindings, classes, methods, constructors, interfaces and interface methods, type aliases, enums, meaningful exported variables, probable function/arrow React components, logical workspace packages, and external packages.

`MODULE` is a logical workspace package/project rooted in its repository-contained package descriptor; it is not a synonym for a source file. Source `IMPORTS` and `EXPORTS` originate from `FILE`. Workspace modules contain owned files and gain cross-package `DEPENDS_ON` edges.

Conservative JSX-producing PascalCase function and arrow declarations use `COMPONENT` with heuristic provenance. A probable React class component remains `CLASS` with React metadata, so its methods retain ordinary `CLASS CONTAINS METHOD` semantics. This is not a complete runtime render graph.

Stable identity excludes callable signatures. Declaration and implementation token streams are fingerprinted separately, ignoring comments and formatting trivia. Overload declarations reuse one logical callable identity where practical. Unbound callbacks use a lower-stability identity derived from lexical parent, syntactic role/occurrence, and normalized local structure; CodeAtlas does not invent a named stable key for them.

## Evidence, revisions, and partial results

Source locations are half-open `[start, end)`. TypeScript's zero-based offset-to-line/column conversion adds one to both line and column, preserving CodeAtlas's one-based line and one-based column contract. Every emitted edge includes analyzer/resolver provenance, confidence, and source evidence when available.

Production `AnalysisSnapshotIdentity` remains repository + exact Git commit SHA + analyzer version. `SourceRevision` is separate: local analysis uses a real `GIT` HEAD when it can read one safely, otherwise a `CONTENT` SHA-256 over sorted normalized relative paths and their content hashes. Content revisions contain no absolute paths, timestamps, or machine data and never masquerade as commit SHAs.

A malformed file emits `TS_PARSE_ERROR` and `MALFORMED_SOURCE`, contributes no trusted entities, and does not prevent valid files from producing a graph. Computed imports and unresolved dynamic dispatch produce first-class unresolved relationships instead of speculative edges. Diagnostics, unresolved relationships, and counters are returned beside partial graph output.

## Current limits

- No external dependency contents or repository ambient types are loaded, so resolution is intentionally reduced without `node_modules`.
- Workspace discovery currently uses nested named `package.json` files; the workspace-glob files themselves are not a full package-manager implementation.
- Generic dynamic dispatch, computed imports, decorators, mixins, framework routes, test-subject inference, and runtime React behavior remain conservative or unresolved.
- Anonymous callback occurrence stability and complete overload fingerprint aggregation need further hardening on larger real repositories.
- Module/re-export traversal is designed for the fixture corpus; broader project-reference and conditional-exports coverage belongs in graph hardening.
