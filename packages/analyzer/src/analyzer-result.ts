import type { InMemoryCodeGraph } from "@codeatlas/codegraph";

import type { AnalysisStats } from "./analysis-stats.js";
import type { AnalyzerDiagnostic } from "./analyzer-diagnostic.js";
import type { AnalysisTelemetry } from "./analysis-telemetry.js";
import type { UnresolvedRelationship } from "./unresolved-relationship.js";
import type { SourceArtifact } from "./source-artifact.js";

export interface AnalyzerResult {
  readonly graph: InMemoryCodeGraph;
  readonly stats: AnalysisStats;
  readonly diagnostics: readonly AnalyzerDiagnostic[];
  readonly unresolvedRelationships: readonly UnresolvedRelationship[];
  readonly sourceArtifacts: readonly SourceArtifact[];
  readonly telemetry: AnalysisTelemetry;
}
