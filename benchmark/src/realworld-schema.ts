import type { EdgeType, EntityKind } from "@codeatlas/codegraph";
import type { UnresolvedReason } from "@codeatlas/analyzer";

export type RealRepositoryCategory = "TYPESCRIPT" | "JAVASCRIPT_COMMONJS" | "MONOREPO" | "REACT_TSX" | "LARGE_SCALE";

export interface RealRepositoryManifestEntry {
  readonly slug: string;
  readonly owner: string;
  readonly repository: string;
  readonly cloneUrl: string;
  readonly commitSha: string;
  readonly releaseTag: string;
  readonly license: string;
  readonly categories: readonly RealRepositoryCategory[];
  readonly purpose: string;
  readonly sizeEstimate: string;
  readonly assertionsFile: string;
}

export interface RealRepositoryManifest {
  readonly schemaVersion: 1;
  readonly repositories: readonly RealRepositoryManifestEntry[];
}

export interface RealEntitySelector {
  readonly filePath: string | null;
  readonly kind: EntityKind;
  readonly qualifiedName: string;
}

export interface RealAssertionEvidence {
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly contentHash: string;
}

interface RealAssertionBase {
  readonly id: string;
  readonly rationale: string;
  readonly evidence: RealAssertionEvidence;
}

export type RealRepositoryAssertion =
  | (RealAssertionBase & { readonly kind: "ENTITY"; readonly subject: RealEntitySelector })
  | (RealAssertionBase & {
      readonly kind: "EDGE" | "EDGE_ABSENT";
      readonly edgeType: EdgeType;
      readonly source: RealEntitySelector;
      readonly target: RealEntitySelector;
      readonly minimumConfidence: number;
    })
  | (RealAssertionBase & {
      readonly kind: "UNRESOLVED";
      readonly source: RealEntitySelector | null;
      readonly intendedEdgeType: EdgeType;
      readonly targetText: string | null;
      readonly reason: UnresolvedReason;
    });

export interface RealRepositoryAssertions {
  readonly schemaVersion: 1;
  readonly repository: string;
  readonly commitSha: string;
  readonly facts: readonly RealRepositoryAssertion[];
}
