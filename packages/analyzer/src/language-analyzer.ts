import type { AnalyzerInput } from "./analyzer-input.js";
import type { AnalyzerResult } from "./analyzer-result.js";

/** A language frontend. Implementations must inspect source without executing it. */
export interface LanguageAnalyzer {
  readonly name: string;
  readonly version: string;
  supports(input: AnalyzerInput): boolean | Promise<boolean>;
  analyze(input: AnalyzerInput): Promise<AnalyzerResult>;
}
