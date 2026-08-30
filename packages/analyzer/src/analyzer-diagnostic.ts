import type { SourceLocation } from "@codeatlas/shared";

export type AnalyzerDiagnosticSeverity = "INFO" | "WARNING" | "ERROR";

export interface AnalyzerDiagnostic {
  readonly code: string;
  readonly severity: AnalyzerDiagnosticSeverity;
  readonly message: string;
  readonly location: SourceLocation | null;
}

export function assertAnalyzerDiagnostic(diagnostic: AnalyzerDiagnostic): void {
  if (diagnostic.code.trim().length === 0 || diagnostic.message.trim().length === 0) {
    throw new Error("Analyzer diagnostics require a code and message");
  }
}
