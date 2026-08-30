import type {
  AnalysisSnapshotIdentity,
  NormalizedRelativePath,
} from "@codeatlas/shared";

export interface AnalysisLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly timeoutMilliseconds: number;
}

export interface AnalyzerInput {
  readonly snapshot: AnalysisSnapshotIdentity;
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
}
