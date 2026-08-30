import { describe, expect, it } from "vitest";

import {
  createAnswerConfidence,
  createCommitSha,
  createEdgeConfidence,
  createImpactCertainty,
  createAnalyzerVersion,
  createEmbeddingModelId,
  createEmbeddingProviderId,
  createEmbeddingVersion,
  createRepositoryIdentifier,
  createRiskSeverity,
  normalizeRelativePath,
  toRepositoryRelativePath,
} from "../src/index.js";

describe("shared value contracts", () => {
  it("normalizes repository-relative paths without allowing escapes", () => {
    expect(normalizeRelativePath("src\\payments/./service.ts")).toBe("src/payments/service.ts");
    expect(toRepositoryRelativePath("C:\\repo", "C:\\repo\\src\\index.ts")).toBe("src/index.ts");
    expect(() => normalizeRelativePath("../secret.txt")).toThrow();
    expect(() => normalizeRelativePath("C:\\repo\\index.ts")).toThrow();
  });

  it("keeps edge, impact, answer, and risk confidence concepts distinct", () => {
    expect(createEdgeConfidence(0.75)).toBe(0.75);
    expect(createImpactCertainty("MEDIUM")).toBe("MEDIUM");
    expect(createAnswerConfidence("HIGH")).toBe("HIGH");
    expect(createRiskSeverity("LOW")).toBe("LOW");
    expect(() => createEdgeConfidence(101)).toThrow();
  });

  it("accepts only full hexadecimal commit identifiers", () => {
    expect(createCommitSha("A".repeat(40))).toBe("a".repeat(40));
    expect(() => createCommitSha("deadbeef")).toThrow();
  });

  it("keeps embedding identity separate from structural snapshot identity", () => {
    const snapshot = {
      repositoryId: createRepositoryIdentifier("github:acme/payments"),
      commitSha: createCommitSha("b".repeat(40)),
      analyzerVersion: createAnalyzerVersion("js-ts-v1"),
    };
    const embeddingIndex = {
      snapshot,
      provider: createEmbeddingProviderId("openai"),
      model: createEmbeddingModelId("text-embedding"),
      embeddingVersion: createEmbeddingVersion("2026-01"),
    };

    expect(Object.keys(snapshot)).not.toContain("model");
    expect(embeddingIndex.snapshot).toBe(snapshot);
  });
});
