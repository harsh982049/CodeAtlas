import { describe, expect, it } from "vitest";

import { InMemoryCodeGraph, serializeCodeGraphToJson } from "../src/index.js";
import { edge, entity } from "./helpers.js";

describe("graph serialization", () => {
  it("is deterministic regardless of insertion order", () => {
    const file = entity("src/index.ts", "FILE");
    const fn = entity("run", "FUNCTION");
    const contains = edge(file, fn, "CONTAINS");
    const left = new InMemoryCodeGraph();
    const right = new InMemoryCodeGraph();
    left.addEntity(file);
    left.addEntity(fn);
    right.addEntity(fn);
    right.addEntity(file);
    left.addEdge(contains);
    right.addEdge(contains);

    expect(serializeCodeGraphToJson(left)).toBe(serializeCodeGraphToJson(right));
  });
});
