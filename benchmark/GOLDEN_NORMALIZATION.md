# Milestone 2 golden normalization

This record was written before the JavaScript/TypeScript analyzer was implemented. Expected graphs were derived manually from fixture source, `CODEATLAS_V1_SPEC.md`, `CODE_GRAPH_CONTRACT.md`, and the accepted ADRs. Analyzer output was not used to determine expected entities, edges, diagnostics, or unresolved relationships.

The normalized goldens are exhaustive for deterministic Milestone 2 behavior. They are frozen benchmark ground truth after this normalization. Analyzer mismatches must not be corrected by weakening or tuning these files. A newly discovered analyzer bug should normally receive a new minimal fixture with a human-authored golden before its implementation is fixed. Any later semantic correction to an existing golden requires explicit approval.

## Normalization policy

- Every successfully analyzed repository source is a `FILE` entity, including repository-contained declaration files.
- Files contain supported top-level declarations and meaningful exported variables. Classes and interfaces contain their supported members.
- Identifiable arrow/function-expression bindings are callable entities, not duplicate variables.
- Source-level imports and exports originate from `FILE`.
- Logical `MODULE` entities are reserved for workspace packages/projects and contain their owned files.
- Direct, default, CommonJS, named re-export, and star re-export relationships are explicit `EXPORTS` edges.
- `REFERENCES` is limited to meaningful runtime non-call/non-construction uses and statically resolved JSX component uses. Type-only references are intentionally omitted in Milestone 2.
- Calls, construction, heritage, imports, and exports are not duplicated as generic references.
- Dynamic or computed relationships are unresolved evidence, never speculative definitive edges.

## Fixture review

### `typescript-basic`

Missing: the `Payment` interface and its structural property information, the create-payment and barrel files, file containment, direct exports, re-exports, the create-payment import, and the statically resolved gateway call. Added those deterministic entities and edges. Type-only identifier references are intentionally omitted. No relationship is expected to remain unresolved.

### `same-name-methods`

Missing: the main file, its import, file containment, and direct exports. Added those plus the existing deterministic construction and uniquely typed method call. No edge is added to `CashProcessor.process`; name-only matching is forbidden. No relationship is expected to remain unresolved.

### `aliased-imports`

Missing: direct `EXPORTS` edges. Added them while retaining the alias-resolved call to the original `charge` entity. The import alias does not create a fake entity. No relationship is expected to remain unresolved.

### `reexports`

Missing: direct export of `foo` from its declaration file. Added it. Barrel and star re-exports continue to export the original entity rather than flattened copies. No relationship is expected to remain unresolved.

### `inheritance`

Missing: the file entity, file containment, direct exports, and the interface method declaration. Added those with class/interface member containment. The inherited `this.log()` call remains a deterministic call to `BaseGateway.log`. No relationship is expected to remain unresolved.

### `constructors`

Missing: both file entities, the import, file containment, and direct exports. Added them. `new PaymentService()` remains `INSTANTIATES`; it is intentionally not duplicated as `CALLS`. No relationship is expected to remain unresolved.

### `javascript-esm`

Missing: containment of the exported result binding and direct exports. Added them. The literal ESM import and resolved `add()` call remain deterministic. No relationship is expected to remain unresolved.

### `javascript-commonjs`

Missing: containment of the exported result, CommonJS export edges, and explicit exported status for `charge`. Added them. Literal `require()` is an internal `IMPORTS` edge and `charge()` is resolved through the static CommonJS export map. No runtime module loading is expected.

### `tsx-react`

Missing: the repository-contained declaration file entity, its supported interface declaration, and direct component exports. Added them. Probable function/arrow components remain `COMPONENT`; JSX `<Button />` remains a statically resolved `REFERENCES` edge. Intrinsic JSX tags and runtime render-tree claims are intentionally omitted.

### `circular-imports`

Missing: the three identifiable arrow-function bindings, containment, direct exports, and non-call imported binding references. Added them. The import cycle is valid and intentionally preserved; it is not an unresolved condition.

### `monorepo-basic`

Missing: logical workspace modules, module containment/dependency, containment of the exported label, and direct exports. Added `@fixture/web` and `@fixture/shared` modules rooted at their package descriptors. The source-level path-alias import remains `FILE IMPORTS FILE`; the package-level relationship is `MODULE DEPENDS_ON MODULE`.

### `dynamic-unresolved`

Missing: the source file, containment, and direct export. Added them. The computed dynamic import and dynamic `plugin.run()` dispatch remain the two expected unresolved relationships. No graph target is invented.

### `malformed-source`

Missing: the valid file, its containment, and direct export. Added them. The malformed file intentionally produces no trusted file/declaration graph entity, one `TS_PARSE_ERROR`, and one `MALFORMED_SOURCE` unresolved relationship; analysis continues for the valid file.

### `path-aliases`

Added before analyzer implementation to make `baseUrl`/`paths` resolution measurable. The golden requires the path-aliased import to resolve to the internal file and the imported function call to resolve to the original declaration.

### `external-packages`

Added before analyzer implementation to freeze canonical external identities. Bare subpaths collapse to the owning npm package, scoped subpaths preserve the first two package segments, and `node:` built-ins use the `NODE_BUILTIN` ecosystem. No dependency contents are read.

### `no-config`

Added before analyzer implementation to require inferred-project analysis when no TypeScript project configuration exists. Its ESM import and call are resolved entirely from repository-contained JavaScript.

### `callable-bindings`

Added before analyzer implementation to require exported arrow and function-expression bindings to become one `FUNCTION` entity each, named by the binding. The function-expression's internal name does not create a duplicate entity.

### `anonymous-callback`

Added as a bug-driven fixture when implementation review exposed that the required low-stability anonymous identity path was not yet exercised. Its human-authored expectation was committed before the anonymous extractor: the callback identity is derived from the exported result binding, call-argument role, and normalized local structure. No human-friendly fake name, containment edge outside the graph domain, or speculative callback relationship is expected.
