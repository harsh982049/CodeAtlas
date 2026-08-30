export interface AnalysisStats {
  readonly filesDiscovered: number;
  readonly filesAnalyzed: number;
  readonly filesSkipped: number;
  readonly filesFailed: number;
  readonly sourceBytesAnalyzed: number;
  readonly sourceLinesAnalyzed: number;
  readonly entitiesExtracted: number;
  readonly anonymousEntitiesExtracted: number;
  readonly edgesCreated: number;
  readonly callsResolved: number;
  readonly callsUnresolved: number;
  readonly internalImports: number;
  readonly externalImports: number;
  readonly elapsedMs: number;
}

export function assertAnalysisStats(stats: AnalysisStats): void {
  for (const [label, value] of Object.entries(stats)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${label} must be a non-negative safe integer`);
    }
  }
  if (stats.filesAnalyzed + stats.filesSkipped + stats.filesFailed > stats.filesDiscovered) {
    throw new Error("Analyzed, skipped, and failed files cannot exceed discovered files");
  }
}
