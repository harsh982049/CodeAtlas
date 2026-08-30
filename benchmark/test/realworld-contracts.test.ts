import { describe, expect, it } from "vitest";

import { parseRealRepositoryAssertions, parseRealRepositoryManifest } from "../src/realworld-validation.js";

const commitSha = "a".repeat(40);

function manifest() {
  return {
    schemaVersion: 1,
    repositories: [{
      slug: "example",
      owner: "owner",
      repository: "repository",
      cloneUrl: "https://github.com/owner/repository.git",
      commitSha,
      releaseTag: "v1.0.0",
      license: "MIT",
      categories: ["TYPESCRIPT"],
      purpose: "Exercise the real-repository contract.",
      sizeEstimate: "Small",
      assertionsFile: "assertions/example.json",
    }],
  };
}

function assertions() {
  return {
    schemaVersion: 1,
    repository: "owner/repository",
    commitSha,
    facts: [{
      id: "entry-file",
      kind: "ENTITY",
      rationale: "The entry file must exist.",
      evidence: { filePath: "src/index.ts", startLine: 1, endLine: 1, contentHash: "b".repeat(64) },
      subject: { filePath: "src/index.ts", kind: "FILE", qualifiedName: "src/index.ts" },
    }],
  };
}

describe("real-repository benchmark contracts", () => {
  it("accepts exact pinned repository metadata and evidence-backed facts", () => {
    expect(parseRealRepositoryManifest(manifest()).repositories[0]?.commitSha).toBe(commitSha);
    expect(parseRealRepositoryAssertions(assertions()).facts).toHaveLength(1);
  });

  it("rejects mutable or mismatched repository coordinates", () => {
    expect(() => parseRealRepositoryManifest({
      ...manifest(),
      repositories: [{ ...manifest().repositories[0], commitSha: "main" }],
    })).toThrow(/full Git SHA/u);
    expect(() => parseRealRepositoryManifest({
      ...manifest(),
      repositories: [{ ...manifest().repositories[0], cloneUrl: "https://example.com/archive.git" }],
    })).toThrow(/direct declared GitHub repository URL/u);
  });

  it("requires source evidence and unique assertion IDs", () => {
    const withoutEvidence = assertions();
    withoutEvidence.facts[0]!.evidence = null as never;
    expect(() => parseRealRepositoryAssertions(withoutEvidence)).toThrow(/evidence is required/u);
    const duplicate = assertions();
    duplicate.facts.push({ ...duplicate.facts[0]! });
    expect(() => parseRealRepositoryAssertions(duplicate)).toThrow(/unique/u);
  });
});
