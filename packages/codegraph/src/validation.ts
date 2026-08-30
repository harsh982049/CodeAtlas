import type { EdgeKey, EdgeType } from "./edge.js";
import type { StableKey } from "./entity.js";

export type GraphValidationCode =
  | "INVALID_ENTITY"
  | "INVALID_EDGE"
  | "CONTAINMENT_CYCLE"
  | "CALL_REFERENCE_DUPLICATION";

export interface GraphValidationDiagnostic {
  readonly code: GraphValidationCode;
  readonly message: string;
  readonly entity: StableKey | null;
  readonly edge: EdgeKey | null;
}

export interface GraphValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly GraphValidationDiagnostic[];
}

export interface TraversalOptions {
  readonly maxDepth: number;
  readonly edgeTypes?: ReadonlySet<EdgeType>;
}

