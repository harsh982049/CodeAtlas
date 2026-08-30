# ADR 005: Separate confidence concepts and use categorical V1 impact risk

- Status: Accepted
- Date: 2026-08-29

## Context

Analyzer certainty, blast-radius completeness, answer evidence, and potential change consequence describe different things. A single “confidence” or unexplained numeric “risk score” would mislead users and make evaluation difficult.

## Decision

Use four separate concepts:

- Edge confidence: a 0–1 analyzer estimate for one structural relationship.
- Impact certainty: confidence in the completeness and correctness of a derived blast radius.
- Answer confidence: sufficiency of evidence for generated claims.
- Risk severity: `LOW`, `MEDIUM`, or `HIGH` potential consequence of a change.

V1 impact analysis reports categorical ratings for structural reach, public/API exposure, historical coupling, test gap, churn, and analysis uncertainty. Overall risk severity follows a versioned deterministic decision table and displays every triggering fact. It is not produced by an LLM.

Impact traversal is edge-specific, normally reverse from dependency to consumer, and defaults to at most three graph hops. Every included impact result retains a path to the changed entity with directions, edge confidence, provenance, and available evidence locations. Historical coupling is supplemental relational evidence, not a graph hop.

Numeric aggregate risk scoring may be introduced only after benchmark results calibrate the dimensions and a subsequent ADR defines the formula.

## Consequences

- APIs and UI must use distinct field names and explanations for all four concepts.
- Low impact certainty can prompt caution without being presented as high consequence by definition.
- Edge weights may rank and prune paths but cannot masquerade as a calibrated risk score.
- Impact benchmarks must evaluate path correctness and completeness in addition to severity usefulness.
