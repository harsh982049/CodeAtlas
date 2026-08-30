import type { CodeEdge } from "./edge.js";
import type { CodeEntity } from "./entity.js";
import type { ReadonlyCodeGraph } from "./graph.js";
import { canonicalSerialize } from "./fingerprint.js";

export interface SerializedCodeGraph {
  readonly schemaVersion: 1;
  readonly entities: readonly CodeEntity[];
  readonly edges: readonly CodeEdge[];
}

export function serializeCodeGraph(graph: ReadonlyCodeGraph): SerializedCodeGraph {
  return {
    schemaVersion: 1,
    entities: [...graph.getEntities()].sort((left, right) =>
      left.stableKey.localeCompare(right.stableKey),
    ),
    edges: [...graph.getEdges()].sort((left, right) => left.edgeKey.localeCompare(right.edgeKey)),
  };
}

export function serializeCodeGraphToJson(graph: ReadonlyCodeGraph): string {
  return `${canonicalSerialize(serializeCodeGraph(graph))}\n`;
}

