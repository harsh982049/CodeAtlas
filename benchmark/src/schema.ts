import type {
  EdgeType,
  EntityKind,
  EvidenceKind,
  ExternalPackageEcosystem,
} from "@codeatlas/codegraph";
import type { UnresolvedReason } from "@codeatlas/analyzer";

export interface FixtureManifest {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly description: string;
  readonly languages: readonly ("JAVASCRIPT" | "TYPESCRIPT" | "TSX")[];
  readonly behaviors: readonly string[];
  readonly intentionallyUnresolvedRelationships: readonly string[];
  readonly projectFiles: readonly string[];
  readonly sourceFiles: readonly string[];
  readonly goldenFile: string;
}

export type GoldenIdentity =
  | {
      readonly identityKind: "NAMED";
      readonly filePath: string;
      readonly kind: EntityKind;
      readonly qualifiedName: string;
    }
  | {
      readonly identityKind: "EXTERNAL_PACKAGE";
      readonly ecosystem: ExternalPackageEcosystem;
      readonly packageName: string;
    };

export interface GoldenEntity {
  readonly ref: string;
  readonly identity: GoldenIdentity;
  readonly name: string;
  readonly exported: boolean;
}

export interface GoldenEvidence {
  readonly filePath: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly kind: EvidenceKind;
}

export interface GoldenEdge {
  readonly edgeType: EdgeType;
  readonly sourceRef: string;
  readonly targetRef: string;
  readonly confidence: number;
  readonly metricTags: readonly ("CALL_RESOLUTION" | "IMPORT_RESOLUTION")[];
  readonly evidence: GoldenEvidence | null;
}

export interface GoldenUnresolvedRelationship {
  readonly sourceRef: string | null;
  readonly intendedEdgeType: EdgeType;
  readonly targetText: string | null;
  readonly reason: UnresolvedReason;
  readonly metricTags: readonly "UNRESOLVED_CALL"[];
  readonly evidence: GoldenEvidence | null;
}

export interface GoldenGraph {
  readonly schemaVersion: 1;
  readonly fixture: string;
  readonly entities: readonly GoldenEntity[];
  readonly edges: readonly GoldenEdge[];
  readonly unresolvedRelationships: readonly GoldenUnresolvedRelationship[];
  readonly expectedDiagnosticCodes: readonly string[];
}
