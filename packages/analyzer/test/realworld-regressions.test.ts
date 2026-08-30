import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createContentSourceRevision,
  defaultAnalysisLimits,
  typescriptJavaScriptAnalyzer,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function analyze(files: Readonly<Record<string, string>>) {
  const root = await mkdtemp(path.join(tmpdir(), "codeatlas-realworld-regression-"));
  temporaryDirectories.push(root);
  for (const [relativePath, text] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, text, "utf8");
  }
  return typescriptJavaScriptAnalyzer.analyze({
    snapshot: null,
    revision: createContentSourceRevision([]),
    repositoryRoot: root,
    projectHints: [],
    limits: defaultAnalysisLimits,
  });
}

describe("real-repository regression behavior", () => {
  it("resolves a literal require beneath a property access", async () => {
    const result = await analyze({
      "jsconfig.json": JSON.stringify({ compilerOptions: { allowJs: true, checkJs: true }, include: ["src"] }),
      "src/main.js": "const method = require('./utils').method;\nmethod();\n",
      "src/utils.js": "exports.method = function method() {};\n",
    });
    const source = result.graph.getEntities().find((entity) => entity.filePath === "src/main.js" && entity.kind === "FILE");
    const target = result.graph.getEntities().find((entity) => entity.filePath === "src/utils.js" && entity.kind === "FILE");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    expect(result.graph.outgoingByType(source!.stableKey, "IMPORTS").some((edge) => edge.target === target!.stableKey)).toBe(true);
  });

  it("records heritage targets outside the V1 edge domain instead of creating an invalid graph", async () => {
    const result = await analyze({
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
      "src/main.ts": "type Contract = { run(): void };\nclass Runner implements Contract { run(): void {} }\n",
    });
    expect(result.graph.validate().valid).toBe(true);
    expect(result.unresolvedRelationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ intendedEdgeType: "IMPLEMENTS", targetText: "Contract", reason: "UNSUPPORTED_SYNTAX" }),
    ]));
  });

  it("traverses deeply nested compiler input without using the JavaScript call stack", async () => {
    const expression = Array.from({ length: 1_000 }, () => "value").join(" + ");
    const result = await analyze({ "src/deep.js": `const value = 1;\nmodule.exports = ${expression};\n` });
    expect(result.stats.filesAnalyzed).toBe(1);
    expect(result.graph.validate().valid).toBe(true);
  });
});
