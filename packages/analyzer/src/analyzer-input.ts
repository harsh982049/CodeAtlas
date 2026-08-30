import type {
  AnalysisSnapshotIdentity,
  NormalizedRelativePath,
} from "@codeatlas/shared";

import type { SourceRevision } from "./source-revision.js";

export interface AnalysisLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTraversalEntries: number;
  readonly maxDirectoryDepth: number;
  readonly timeoutMilliseconds: number;
}

export interface AnalyzerInput {
  readonly snapshot: AnalysisSnapshotIdentity | null;
  readonly revision: SourceRevision;
  readonly repositoryRoot: string;
  readonly projectHints: readonly NormalizedRelativePath[];
  readonly limits: AnalysisLimits;
}

export function assertAnalyzerInput(input: AnalyzerInput): void {
  if (input.repositoryRoot.trim().length === 0) {
    throw new Error("Repository root must not be empty");
  }
  for (const [label, value] of Object.entries(input.limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${label} must be a positive safe integer`);
    }
  }
  if (input.snapshot !== null) {
    if (input.revision.kind !== "GIT" || input.snapshot.commitSha !== input.revision.sha) {
      throw new Error("A persisted snapshot requires a matching exact Git revision");
    }
  }
}
