import type {
  Brand,
  EdgeConfidence,
  JsonObject,
  SourceLocation,
} from "@codeatlas/shared";
import {
  assertJsonObject,
  assertSourceLocation,
  createEdgeConfidence,
} from "@codeatlas/shared";

import type { StableKey } from "./entity.js";
import { canonicalSerialize, sha256Hex } from "./fingerprint.js";

export type EdgeType =
  | "CONTAINS"
  | "IMPORTS"
  | "EXPORTS"
  | "CALLS"
  | "REFERENCES"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "INSTANTIATES"
  | "ROUTES_TO"
  | "TESTS"
  | "DEPENDS_ON"
  | "POSSIBLE_CALL";

export type EvidenceKind = "STATIC_RESOLUTION" | "SYNTAX" | "HEURISTIC";
export type EdgeKey = Brand<string, "EdgeKey">;

export interface EdgeEvidence extends SourceLocation {
  readonly kind: EvidenceKind;
}

export interface ResolverProvenance {
  readonly analyzer: string;
  readonly analyzerVersion: string;
  readonly resolver: string;
  readonly resolverVersion: string;
}

export interface CodeEdge {
  readonly edgeKey: EdgeKey;
  readonly source: StableKey;
  readonly target: StableKey;
  readonly edgeType: EdgeType;
  readonly resolver: ResolverProvenance;
  readonly confidence: EdgeConfidence;
  readonly evidence: EdgeEvidence | null;
  readonly metadata: Readonly<JsonObject>;
}

export interface CreateCodeEdgeInput extends Omit<CodeEdge, "edgeKey" | "confidence"> {
  readonly confidence: number | EdgeConfidence;
}

function evidenceIdentity(evidence: EdgeEvidence | null): readonly (number | string)[] {
  if (evidence === null) {
    return ["NO_EVIDENCE"];
  }
  return [
    evidence.filePath,
    evidence.start.line,
    evidence.start.column,
    evidence.end.line,
    evidence.end.column,
    evidence.kind,
  ];
}

export function createEdgeKey(input: Omit<CodeEdge, "edgeKey" | "confidence" | "metadata">): EdgeKey {
  const canonical = canonicalSerialize([
    "codeatlas-edge-occurrence-v1",
    input.source,
    input.target,
    input.edgeType,
    input.resolver.analyzer,
    input.resolver.analyzerVersion,
    input.resolver.resolver,
    input.resolver.resolverVersion,
    ...evidenceIdentity(input.evidence),
  ]);
  return `ek:v1:sha256:${sha256Hex(canonical)}` as EdgeKey;
}

export function createCodeEdge(input: CreateCodeEdgeInput): CodeEdge {
  const confidence = createEdgeConfidence(input.confidence);
  const edgeKey = createEdgeKey(input);
  const edge: CodeEdge = { ...input, confidence, edgeKey };
  assertCodeEdge(edge);
  return edge;
}

export function assertCodeEdge(edge: CodeEdge): void {
  createEdgeConfidence(edge.confidence);
  if (!edge.edgeKey.startsWith("ek:v1:sha256:")) {
    throw new Error("Invalid edge key format");
  }
  for (const value of Object.values(edge.resolver)) {
    if (value.trim().length === 0) {
      throw new Error("Edge resolver provenance must be complete");
    }
  }
  if (edge.evidence !== null) {
    assertSourceLocation(edge.evidence);
  }
  assertJsonObject(edge.metadata);
  if (createEdgeKey(edge) !== edge.edgeKey) {
    throw new Error("Edge key does not match edge occurrence identity");
  }
}

