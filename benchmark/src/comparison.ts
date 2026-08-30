import type { SerializedCodeGraph } from "@codeatlas/codegraph";

import { materializeGoldenGraph } from "./materialize.js";
import type { GoldenGraph } from "./schema.js";

export type EvidenceComparisonMode = "IGNORE" | "LOCATION";

export interface SetMetrics {
  readonly truePositive: number;
  readonly falsePositive: number;
  readonly falseNegative: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export interface GraphComparison {
  readonly entities: SetMetrics;
  readonly edges: SetMetrics;
}

export interface GoldenComparisonOptions {
  readonly evidenceMode?: EvidenceComparisonMode;
  readonly enforceMinimumConfidence?: boolean;
}

export function compareSets(expected: ReadonlySet<string>, actual: ReadonlySet<string>): SetMetrics {
  const truePositive = [...actual].filter((key) => expected.has(key)).length;
  const falsePositive = actual.size - truePositive;
  const falseNegative = expected.size - truePositive;
  const precision = actual.size === 0 ? (expected.size === 0 ? 1 : 0) : truePositive / actual.size;
  const recall = expected.size === 0 ? 1 : truePositive / expected.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { truePositive, falsePositive, falseNegative, precision, recall, f1 };
}

function edgeKey(edge: SerializedCodeGraph["edges"][number], mode: EvidenceComparisonMode): string {
  const base = `${edge.edgeType}|${edge.source}|${edge.target}`;
  if (mode === "IGNORE" || edge.evidence === null) return base;
  const evidence = edge.evidence;
  return `${base}|${evidence.filePath}:${evidence.start.line}:${evidence.start.column}-${evidence.end.line}:${evidence.end.column}`;
}

export function compareSerializedGraphs(
  expected: SerializedCodeGraph,
  actual: SerializedCodeGraph,
  evidenceMode: EvidenceComparisonMode = "IGNORE",
): GraphComparison {
  return {
    entities: compareSets(
      new Set(expected.entities.map((entity) => entity.stableKey)),
      new Set(actual.entities.map((entity) => entity.stableKey)),
    ),
    edges: compareSets(
      new Set(expected.edges.map((edge) => edgeKey(edge, evidenceMode))),
      new Set(actual.edges.map((edge) => edgeKey(edge, evidenceMode))),
    ),
  };
}

/**
 * Compares analyzer output with a hand-authored golden graph. Golden `confidence`
 * values are minimum assertions when enforcement is enabled, never exact matches.
 */
export function compareActualToGolden(
  golden: GoldenGraph,
  actual: SerializedCodeGraph,
  options: GoldenComparisonOptions = {},
): GraphComparison {
  const evidenceMode = options.evidenceMode ?? "IGNORE";
  const expected = materializeGoldenGraph(golden);
  const expectedSerialized: SerializedCodeGraph = {
    schemaVersion: 1,
    entities: expected.getEntities(),
    edges: expected.getEdges(),
  };
  if (options.enforceMinimumConfidence !== true) {
    return compareSerializedGraphs(expectedSerialized, actual, evidenceMode);
  }

  const minimumByEdge = new Map<string, number>();
  for (const edge of expectedSerialized.edges) {
    const key = edgeKey(edge, evidenceMode);
    minimumByEdge.set(key, Math.max(minimumByEdge.get(key) ?? 0, edge.confidence));
  }
  const qualifiedActual = {
    ...actual,
    edges: actual.edges.filter((edge) => {
      const minimum = minimumByEdge.get(edgeKey(edge, evidenceMode));
      return minimum === undefined || edge.confidence >= minimum;
    }),
  } satisfies SerializedCodeGraph;
  return compareSerializedGraphs(expectedSerialized, qualifiedActual, evidenceMode);
}
