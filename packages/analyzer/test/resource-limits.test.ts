import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AnalysisLimits } from "../src/analyzer-input.js";
import { AnalysisDeadline, scanRepository } from "../src/repository.js";

const temporaryDirectories: string[] = [];
const limits: AnalysisLimits = {
  maxFiles: 10,
  maxFileBytes: 100,
  maxTraversalEntries: 100,
  maxDirectoryDepth: 10,
  timeoutMilliseconds: 10_000,
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "codeatlas-limits-"));
  temporaryDirectories.push(root);
  return root;
}

describe("repository resource limits", () => {
  it("returns deterministic partial discovery for file and traversal limits", async () => {
    const root = await temporaryRoot();
    for (const name of ["a.ts", "b.ts", "c.ts"]) await writeFile(path.join(root, name), "export const value = 1;\n", "utf8");
    const result = await scanRepository(root, { ...limits, maxFiles: 2, maxTraversalEntries: 2 }, new AnalysisDeadline(10_000));
    expect(result.sourceFiles.map((file) => file.relativePath)).toEqual(["a.ts", "b.ts"]);
    expect(result.diagnostics.map((item) => item.code)).toContain("MAX_TRAVERSAL_ENTRIES_EXCEEDED");
  });

  it("skips oversized and deeply nested sources with explicit diagnostics", async () => {
    const root = await temporaryRoot();
    await writeFile(path.join(root, "large.ts"), "x".repeat(101), "utf8");
    await mkdir(path.join(root, "one", "two"), { recursive: true });
    await writeFile(path.join(root, "one", "two", "deep.ts"), "export {};\n", "utf8");
    const result = await scanRepository(root, { ...limits, maxDirectoryDepth: 1 }, new AnalysisDeadline(10_000));
    expect(result.sourceFiles).toHaveLength(0);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["FILE_TOO_LARGE", "MAX_DIRECTORY_DEPTH_EXCEEDED"]));
  });

  it("skips both repository-contained and escaping directory links", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await mkdir(path.join(root, "real"));
    await writeFile(path.join(root, "real", "inside.ts"), "export {};\n", "utf8");
    await writeFile(path.join(outside, "outside.ts"), "export {};\n", "utf8");
    await symlink(path.join(root, "real"), path.join(root, "inside-link"), "junction");
    await symlink(outside, path.join(root, "outside-link"), "junction");
    const result = await scanRepository(root, limits, new AnalysisDeadline(10_000));
    expect(result.sourceFiles.map((file) => file.relativePath)).toEqual(["real/inside.ts"]);
    expect(result.diagnostics.filter((item) => item.code === "SYMLINK_SKIPPED")).toHaveLength(2);
  });

  it("throws a typed stage-specific deadline failure", async () => {
    const root = await temporaryRoot();
    await writeFile(path.join(root, "value.ts"), "export {};\n", "utf8");
    let now = 0;
    const deadline = new AnalysisDeadline(1, () => now++);
    await expect(scanRepository(root, limits, deadline)).rejects.toMatchObject({
      name: "AnalysisLimitError",
      kind: "DEADLINE",
      stage: "repository discovery",
    });
  });
});
