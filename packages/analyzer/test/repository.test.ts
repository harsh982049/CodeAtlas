import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AnalysisDeadline, scanRepository } from "../src/repository.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("safe repository discovery", () => {
  it("ignores dependencies and observes obvious generated-source skips", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codeatlas-repository-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "src", "main.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(root, "src", "bundle.min.js"), "var x=1;", "utf8");
    await writeFile(path.join(root, "node_modules", "ignored.ts"), "export const ignored = true;\n", "utf8");

    const result = await scanRepository(root, { maxFiles: 10, maxFileBytes: 1_000_000, timeoutMilliseconds: 10_000 }, new AnalysisDeadline(10_000));
    expect(result.sourceFiles.map((file) => file.relativePath)).toEqual(["src/main.ts"]);
    expect(result.filesSkipped).toBe(1);
    expect(result.diagnostics.map((item) => item.code)).toContain("GENERATED_SOURCE_SKIPPED");
  });
});
