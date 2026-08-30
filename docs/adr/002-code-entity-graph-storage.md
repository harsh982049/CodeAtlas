# ADR 002: Store a generic code-entity graph in PostgreSQL

- Status: Accepted
- Date: 2026-08-29

## Context

The V1 graph contains more than compiler symbols: modules, files, routes, tests, React components, external packages, and unresolved structural targets also participate. A `symbol_edges` table whose endpoints must both be symbols cannot represent these relationships consistently. Historical artifacts have a different lifecycle and should not be forced into the structural graph.

## Decision

Store structural nodes as snapshot-scoped `code_entities` and relationships as `code_edges` in PostgreSQL.

The authoritative edge directions are:

```text
CONTAINS       container → child
IMPORTS        importing module → imported module/package
EXPORTS        module → exported entity
CALLS          caller → callee
REFERENCES     referrer → referenced entity, excluding CALLS sites
EXTENDS        child → parent
IMPLEMENTS     class → interface
INSTANTIATES   creator → class
ROUTES_TO      route → handler
TESTS          test → tested subject
DEPENDS_ON     module/package → dependency
POSSIBLE_CALL  caller → possible callee
```

Every edge records analyzer/resolver provenance, edge confidence from 0 to 1, and an evidence location where available. Code cannot silently turn an unresolved relationship into a definitive edge.

Commits, pull requests, issues, and developers are not code entities in V1. They use dedicated relational tables and joins such as entity-to-commit, commit-to-PR, and PR-to-issue associations. File co-change also remains relational historical data rather than a structural graph edge.

PostgreSQL adjacency queries and bounded recursive CTEs are the V1 graph implementation. A specialized graph database requires a later benchmark-backed ADR.

## Consequences

- Graph traversal can cross structural entity kinds without nullable endpoint families.
- Edge-domain validation is required so semantically invalid relationships cannot be persisted.
- Historical and structural retention can evolve independently.
- Impact algorithms must explicitly define direction and allowed entity-level transitions for every traversed edge.
