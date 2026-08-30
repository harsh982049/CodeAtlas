import type { EdgeType, StableKey } from "@codeatlas/codegraph";
import type { SourceLocation } from "@codeatlas/shared";

export type UnresolvedReason =
  | "ABSENT_DEPENDENCY"
  | "AMBIGUOUS_TARGET"
  | "COMPUTED_SPECIFIER"
  | "DYNAMIC_DISPATCH"
  | "MALFORMED_SOURCE"
  | "OUTSIDE_ANALYSIS_SCOPE"
  | "UNSUPPORTED_SYNTAX";

export interface UnresolvedRelationship {
  readonly source: StableKey | null;
  readonly intendedEdgeType: EdgeType;
  readonly targetText: string | null;
  readonly reason: UnresolvedReason;
  readonly evidence: SourceLocation | null;
  readonly detail: string;
}

export function assertUnresolvedRelationship(value: UnresolvedRelationship): void {
  if (value.detail.trim().length === 0) {
    throw new Error("An unresolved relationship requires explanatory detail");
  }
  if (value.targetText !== null && value.targetText.trim().length === 0) {
    throw new Error("Unresolved target text must be null or non-empty");
  }
}
