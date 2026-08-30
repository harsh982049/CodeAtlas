import ts from "typescript";

import { normalizeRelativePath } from "@codeatlas/shared";
import { describe, expect, it } from "vitest";

import { createContentSourceRevision } from "../src/index.js";
import { nodeLocation } from "../src/source-locations.js";

describe("local analyzer contracts", () => {
  it("creates a machine-independent content revision in normalized path order", () => {
    const first = createContentSourceRevision([
      { path: normalizeRelativePath("src/z.ts"), contentHash: "bbb" },
      { path: normalizeRelativePath("src/a.ts"), contentHash: "aaa" },
    ]);
    const second = createContentSourceRevision([
      { path: normalizeRelativePath("src/a.ts"), contentHash: "aaa" },
      { path: normalizeRelativePath("src/z.ts"), contentHash: "bbb" },
    ]);
    expect(first).toEqual(second);
    expect(first.kind).toBe("CONTENT");
  });

  it("converts TypeScript half-open offsets to one-based line and columns", () => {
    const source = ts.createSourceFile("src/example.ts", "const x = 1;\n", ts.ScriptTarget.Latest, true);
    const statement = source.statements[0];
    expect(statement).toBeDefined();
    expect(nodeLocation(normalizeRelativePath("src/example.ts"), source, statement as ts.Statement)).toEqual({
      filePath: "src/example.ts",
      start: { line: 1, column: 1 },
      end: { line: 1, column: 13 },
    });
  });
});
