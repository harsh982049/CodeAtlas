export type AnalysisLimitKind = "DEADLINE" | "TRAVERSAL_ENTRIES" | "DIRECTORY_DEPTH";

export class AnalysisLimitError extends Error {
  readonly kind: AnalysisLimitKind;
  readonly stage: string;

  constructor(kind: AnalysisLimitKind, stage: string, message: string) {
    super(message);
    this.name = "AnalysisLimitError";
    this.kind = kind;
    this.stage = stage;
  }
}
