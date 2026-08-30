import type { Brand } from "./brand.js";

export type EdgeConfidence = Brand<number, "EdgeConfidence">;

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";
export type ImpactCertainty = Brand<ConfidenceLevel, "ImpactCertainty">;
export type AnswerConfidence = Brand<ConfidenceLevel, "AnswerConfidence">;
export type RiskSeverity = Brand<ConfidenceLevel, "RiskSeverity">;

export function createEdgeConfidence(value: number): EdgeConfidence {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("Edge confidence must be a finite number from 0 to 1");
  }
  return value as EdgeConfidence;
}

function assertConfidenceLevel(value: string): asserts value is ConfidenceLevel {
  if (value !== "LOW" && value !== "MEDIUM" && value !== "HIGH") {
    throw new RangeError(`Invalid confidence level: ${value}`);
  }
}

export function createImpactCertainty(value: string): ImpactCertainty {
  assertConfidenceLevel(value);
  return value as ImpactCertainty;
}

export function createAnswerConfidence(value: string): AnswerConfidence {
  assertConfidenceLevel(value);
  return value as AnswerConfidence;
}

export function createRiskSeverity(value: string): RiskSeverity {
  assertConfidenceLevel(value);
  return value as RiskSeverity;
}

