# ADR 003: Separate logical symbol identity from declaration and implementation changes

- Status: Accepted
- Date: 2026-08-29

## Context

Line numbers are unstable, while including a signature in identity makes a signature change look like deletion plus addition. Diff analysis needs to recognize a logical entity and independently describe changes to its public declaration and implementation.

## Decision

Each symbol-like code entity has a logical `stable_key` derived from repository-relative file path, entity kind, qualified name, and deterministic lexical context where needed. It excludes line numbers and signatures.

Store separately:

- `declaration_fingerprint`: normalized signature, modifiers, exports, overload declarations, and other public declaration surface.
- `implementation_fingerprint`: normalized body or other meaningful implementation content, when one exists.

A matching stable key with either changed fingerprint is `MODIFIED`; the diff record identifies declaration, implementation, or both. Git rename detection is applied to file paths before cross-snapshot stable-key matching.

Where practical, a TypeScript overload set and its implementation form one logical callable entity with an aggregate declaration fingerprint.

Symbol renames or arbitrary refactors that cannot be matched deterministically may remain `REMOVED` plus `ADDED` in V1. Anonymous callbacks use lexical parent, syntactic role, and a local fingerprint and carry lower identity stability.

## Consequences

- Signature changes retain logical identity and can receive public-surface risk treatment.
- Moved files can retain entity identity when Git rename detection succeeds.
- The matching algorithm must consume exact base/head snapshots and the Git rename map.
- V1 does not promise perfect lineage through renames, moves without Git similarity, function splits, or merges.
