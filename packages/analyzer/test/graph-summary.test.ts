import { createCodeEdge, createNamedEntityIdentity, InMemoryCodeGraph, type CodeEntity } from "@codeatlas/codegraph";
import { normalizeRelativePath } from "@codeatlas/shared";
import { describe, expect, it } from "vitest";

import { summarizeCodeGraph } from "../src/graph-summary.js";

function entity(filePath: "src/a.ts" | "src/b.ts", kind: "FILE" | "FUNCTION", name: string): CodeEntity {
  const normalizedFilePath = normalizeRelativePath(filePath);
  const identity = createNamedEntityIdentity({ filePath: normalizedFilePath, kind, qualifiedName: name });
  return {
    ...identity,
    kind,
    name,
    qualifiedName: name,
    filePath: normalizedFilePath,
    sourceRange: null,
    exported: false,
    defaultExport: false,
    declarationFingerprint: null,
    implementationFingerprint: null,
    identityStability: "HIGH",
    analyzer: { name: "test", version: "1" },
    metadata: {},
  };
}

describe("graph summary", () => {
  it("reports deterministic connectivity and top-degree entities", () => {
    const graph = new InMemoryCodeGraph();
    const file = entity("src/a.ts", "FILE", "src/a.ts");
    const callable = entity("src/a.ts", "FUNCTION", "run");
    const isolated = entity("src/b.ts", "FILE", "src/b.ts");
    for (const item of [file, callable, isolated]) graph.addEntity(item);
    graph.addEdge(createCodeEdge({ source: file.stableKey, target: callable.stableKey, edgeType: "CONTAINS", resolver: { analyzer: "test", analyzerVersion: "1", resolver: "test", resolverVersion: "1" }, confidence: 1, evidence: null, metadata: {} }));
    const summary = summarizeCodeGraph(graph);
    expect(summary.entitiesByKind).toEqual({ FILE: 2, FUNCTION: 1 });
    expect(summary.connectedComponentCount).toBe(2);
    expect(summary.largestConnectedComponent).toBe(2);
    expect(summary.isolatedEntityCount).toBe(1);
    expect(summary.topConnectedEntities[0]?.stableKey).toBe(file.stableKey);
  });
});
