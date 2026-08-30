import { createEdgeConfidence } from "@codeatlas/shared";
import { serializeCodeGraph } from "@codeatlas/codegraph";
import { describe, expect, it } from "vitest";

import {
  compareActualToGolden,
  compareSets,
  materializeGoldenGraph,
  type GoldenGraph,
} from "../src/index.js";

describe("benchmark comparison", () => {
  it("computes precision, recall, and F1 from exact set membership", () => {
    expect(compareSets(new Set(["a", "b"]), new Set(["b", "c"]))).toEqual({
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 1,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
    });
  });

  it("treats two empty sets as a perfect match", () => {
    expect(compareSets(new Set(), new Set())).toMatchObject({ precision: 1, recall: 1, f1: 1 });
  });

  it("supports minimum confidence assertions without exact confidence matching", () => {
    const golden: GoldenGraph = {
      schemaVersion: 1,
      fixture: "controlled",
      entities: [
        { ref: "caller", identity: { identityKind: "NAMED", filePath: "src/a.ts", kind: "FUNCTION", qualifiedName: "caller" }, name: "caller", exported: true },
        { ref: "callee", identity: { identityKind: "NAMED", filePath: "src/b.ts", kind: "FUNCTION", qualifiedName: "callee" }, name: "callee", exported: true },
      ],
      edges: [{ edgeType: "CALLS", sourceRef: "caller", targetRef: "callee", confidence: 0.9, metricTags: ["CALL_RESOLUTION"], evidence: null }],
      unresolvedRelationships: [],
      expectedDiagnosticCodes: [],
    };
    const serialized = serializeCodeGraph(materializeGoldenGraph(golden));
    const lowConfidenceActual = {
      ...serialized,
      edges: serialized.edges.map((edge) => ({ ...edge, confidence: createEdgeConfidence(0.8) })),
    };

    expect(compareActualToGolden(golden, lowConfidenceActual).edges.recall).toBe(1);
    expect(compareActualToGolden(golden, lowConfidenceActual, { enforceMinimumConfidence: true }).edges.recall).toBe(0);
  });
});
