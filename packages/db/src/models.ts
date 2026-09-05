import type { CodeEdge, CodeEntity, EdgeType, StableKey } from "@codeatlas/codegraph";
import type { JsonObject, SourceLocation } from "@codeatlas/shared";

export interface StructuralSnapshotIdentityValue {
  readonly repositoryLogicalId: string;
  readonly commitSha: string;
  readonly analyzerName: string;
  readonly analyzerVersion: string;
}

export interface PersistedFileInput {
  readonly path: string;
  readonly role: "SOURCE" | "PROJECT_CONFIGURATION";
  readonly language: string;
  readonly contentHash: string;
  readonly sourceObjectKey: string;
  readonly byteCount: number;
  readonly lineCount: number;
  readonly metadata: JsonObject;
}

export interface DiagnosticInput {
  readonly code: string;
  readonly severity: "INFO" | "WARNING" | "ERROR";
  readonly message: string;
  readonly location: SourceLocation | null;
}

export interface UnresolvedRelationshipInput {
  readonly source: StableKey | null;
  readonly intendedEdgeType: EdgeType;
  readonly targetText: string | null;
  readonly reason:
    | "ABSENT_DEPENDENCY"
    | "AMBIGUOUS_TARGET"
    | "COMPUTED_SPECIFIER"
    | "DYNAMIC_DISPATCH"
    | "MALFORMED_SOURCE"
    | "OUTSIDE_ANALYSIS_SCOPE"
    | "UNSUPPORTED_SYNTAX";
  readonly evidence: SourceLocation | null;
  readonly detail: string;
}

export interface SnapshotPersistencePayload {
  readonly files: readonly PersistedFileInput[];
  readonly entities: readonly CodeEntity[];
  readonly edges: readonly CodeEdge[];
  readonly diagnostics: readonly DiagnosticInput[];
  readonly unresolvedRelationships: readonly UnresolvedRelationshipInput[];
}

export interface PersistenceBatchSizes {
  readonly files: number;
  readonly entities: number;
  readonly edges: number;
  readonly diagnostics: number;
  readonly unresolvedRelationships: number;
}

export const defaultPersistenceBatchSizes: PersistenceBatchSizes = {
  files: 500,
  entities: 500,
  edges: 1_000,
  diagnostics: 500,
  unresolvedRelationships: 500,
};

export interface PersistenceTimings {
  readonly filesMs: number;
  readonly entitiesMs: number;
  readonly edgesMs: number;
  readonly diagnosticsMs: number;
  readonly unresolvedRelationshipsMs: number;
}
