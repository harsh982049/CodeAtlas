import { InMemoryCodeGraph } from "@codeatlas/codegraph";
import {
  createAnalyzerVersion,
  createCommitSha,
  createRepositoryIdentifier,
} from "@codeatlas/shared";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  assertAnalysisStats,
  assertAnalyzerInput,
  type AnalyzerInput,
  type AnalyzerResult,
  type LanguageAnalyzer,
} from "../src/index.js";

const input: AnalyzerInput = {
  snapshot: {
    repositoryId: createRepositoryIdentifier("fixture/typescript-basic"),
    commitSha: createCommitSha("a".repeat(40)),
    analyzerVersion: createAnalyzerVersion("contracts-v1"),
  },
  repositoryRoot: "/fixtures/typescript-basic",
  projectHints: [],
  limits: { maxFiles: 100, maxFileBytes: 1_000_000, timeoutMilliseconds: 30_000 },
};

describe("analyzer contracts", () => {
  it("accepts a bounded, snapshot-specific analyzer input", () => {
    expect(() => assertAnalyzerInput(input)).not.toThrow();
    expect(() => assertAnalyzerInput({ ...input, limits: { ...input.limits, maxFiles: 0 } })).toThrow();
  });

  it("rejects internally inconsistent statistics", () => {
    expect(() => assertAnalysisStats({
      filesDiscovered: 1,
      filesAnalyzed: 1,
      filesSkipped: 1,
      filesFailed: 0,
      entitiesExtracted: 0,
      edgesCreated: 0,
      callsResolved: 0,
      callsUnresolved: 0,
      internalImports: 0,
      externalImports: 0,
      elapsedMs: 0,
    })).toThrow();
  });

  it("defines an asynchronous, language-neutral boundary", async () => {
    const result: AnalyzerResult = {
      graph: new InMemoryCodeGraph(),
      stats: {
        filesDiscovered: 0,
        filesAnalyzed: 0,
        filesSkipped: 0,
        filesFailed: 0,
        entitiesExtracted: 0,
        edgesCreated: 0,
        callsResolved: 0,
        callsUnresolved: 0,
        internalImports: 0,
        externalImports: 0,
        elapsedMs: 0,
      },
      diagnostics: [],
      unresolvedRelationships: [],
    };
    const analyzer: LanguageAnalyzer = {
      name: "contract-double",
      version: "1",
      supports: () => true,
      analyze: async () => result,
    };

    expect(await analyzer.analyze(input)).toBe(result);
    expectTypeOf(analyzer.analyze).returns.toEqualTypeOf<Promise<AnalyzerResult>>();
  });
});
