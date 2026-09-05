import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalAnalyzerInput, typescriptJavaScriptAnalyzer } from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("analyzer source artifacts", () => {
  it("retains exact source and configuration bytes without including them in graph serialization", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codeatlas-source-artifacts-"));
    temporaryDirectories.push(root);
    const sourceBytes = Buffer.from([0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20, 0x7b, 0x7d, 0x3b, 0x0d, 0x0a]);
    await writeFile(path.join(root, "index.ts"), sourceBytes);
    await writeFile(path.join(root, "tsconfig.json"), "{\"compilerOptions\":{}}\n", "utf8");

    const result = await typescriptJavaScriptAnalyzer.analyze(await createLocalAnalyzerInput(root));
    const source = result.sourceArtifacts.find((artifact) => artifact.path === "index.ts");
    const configuration = result.sourceArtifacts.find((artifact) => artifact.path === "tsconfig.json");

    expect(source?.bytes).toEqual(sourceBytes);
    expect(source?.contentHash).toBe(createHash("sha256").update(sourceBytes).digest("hex"));
    expect(source?.role).toBe("SOURCE");
    expect(configuration?.role).toBe("PROJECT_CONFIGURATION");
    expect(JSON.stringify({ entities: result.graph.getEntities(), edges: result.graph.getEdges() })).not.toContain("sourceArtifacts");
  });
});
