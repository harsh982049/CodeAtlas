import { describe, expect, it } from "vitest";

import { InMemoryCodeGraph } from "../src/index.js";
import { edge, entity } from "./helpers.js";

describe("in-memory code graph", () => {
  it("enforces edge direction domains and endpoint existence", () => {
    const graph = new InMemoryCodeGraph();
    const file = entity("src/index.ts", "FILE");
    const fn = entity("run", "FUNCTION");
    graph.addEntity(file);
    graph.addEntity(fn);
    expect(() => graph.addEdge(edge(file, fn, "CONTAINS"))).not.toThrow();
    expect(() => graph.addEdge(edge(fn, file, "CONTAINS", 2))).toThrow();
  });

  it("rejects containment cycles", () => {
    const graph = new InMemoryCodeGraph();
    const outer = entity("outer", "MODULE", "src/outer.ts");
    const inner = entity("inner", "MODULE", "src/inner.ts");
    graph.addEntity(outer);
    graph.addEntity(inner);
    graph.addEdge(edge(outer, inner, "CONTAINS"));
    expect(() => graph.addEdge(edge(inner, outer, "CONTAINS"))).toThrow(/cycle/);
  });

  it("does not duplicate a call occurrence as a generic reference", () => {
    const graph = new InMemoryCodeGraph();
    const caller = entity("caller", "FUNCTION");
    const callee = entity("callee", "FUNCTION");
    graph.addEntity(caller);
    graph.addEntity(callee);
    graph.addEdge(edge(caller, callee, "CALLS"));
    expect(() => graph.addEdge(edge(caller, callee, "REFERENCES"))).toThrow(/duplicate|conflicts/);
  });

  it("deduplicates an exact occurrence but preserves distinct call sites", () => {
    const graph = new InMemoryCodeGraph();
    const caller = entity("caller", "FUNCTION");
    const callee = entity("callee", "FUNCTION");
    graph.addEntity(caller);
    graph.addEntity(callee);
    const firstSite = edge(caller, callee, "CALLS", 1);
    const secondSite = edge(caller, callee, "CALLS", 2);
    expect(graph.addEdge(firstSite)).toEqual({ added: true });
    expect(graph.addEdge(firstSite)).toEqual({ added: false });
    expect(graph.addEdge(secondSite)).toEqual({ added: true });
    expect(graph.getEdges()).toHaveLength(2);
  });

  it("traverses forward and reverse with edge filters and bounded paths", () => {
    const graph = new InMemoryCodeGraph();
    const first = entity("first", "FUNCTION", "src/first.ts");
    const second = entity("second", "FUNCTION", "src/second.ts");
    const third = entity("third", "FUNCTION", "src/third.ts");
    for (const item of [first, second, third]) graph.addEntity(item);
    graph.addEdge(edge(first, second, "CALLS"));
    graph.addEdge(edge(second, third, "CALLS"));

    const forward = graph.boundedForwardTraversal(first.stableKey, {
      maxDepth: 2,
      edgeTypes: new Set(["CALLS"]),
    });
    const reverse = graph.boundedReverseTraversal(third.stableKey, {
      maxDepth: 1,
      edgeTypes: new Set(["CALLS"]),
    });
    expect(forward.map((step) => [step.entity.name, step.depth, step.path.length])).toEqual([
      ["second", 1, 1],
      ["third", 2, 2],
    ]);
    expect(reverse.map((step) => step.entity.name)).toEqual(["second"]);
  });

  it("terminates traversal across a non-containment cycle", () => {
    const graph = new InMemoryCodeGraph();
    const a = entity("a", "FILE", "src/a.ts");
    const b = entity("b", "FILE", "src/b.ts");
    const c = entity("c", "FILE", "src/c.ts");
    for (const item of [a, b, c]) graph.addEntity(item);
    graph.addEdge(edge(a, b, "IMPORTS"));
    graph.addEdge(edge(b, c, "IMPORTS"));
    graph.addEdge(edge(c, a, "IMPORTS"));

    expect(graph.boundedForwardTraversal(a.stableKey, { maxDepth: 10 })).toHaveLength(2);
  });
});
