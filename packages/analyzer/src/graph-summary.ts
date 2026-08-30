import type { CodeEntity, EdgeType, EntityKind, ReadonlyCodeGraph, StableKey } from "@codeatlas/codegraph";

import type { AnalyzerDiagnostic } from "./analyzer-diagnostic.js";
import type { UnresolvedRelationship } from "./unresolved-relationship.js";

export interface ConnectedEntitySummary {
  readonly stableKey: StableKey;
  readonly kind: EntityKind;
  readonly qualifiedName: string;
  readonly filePath: string | null;
  readonly incoming: number;
  readonly outgoing: number;
  readonly degree: number;
  readonly uniqueNeighbors: number;
}

export interface GraphSummary {
  readonly entitiesByKind: Readonly<Record<string, number>>;
  readonly edgesByType: Readonly<Record<string, number>>;
  readonly moduleCount: number;
  readonly externalPackageCount: number;
  readonly isolatedEntityCount: number;
  readonly connectedComponentCount: number;
  readonly largestConnectedComponent: number;
  readonly unresolvedByReason: Readonly<Record<string, number>>;
  readonly diagnosticsByCode: Readonly<Record<string, number>>;
  readonly topConnectedEntities: readonly ConnectedEntitySummary[];
}

function increment(values: Record<string, number>, key: string): void {
  values[key] = (values[key] ?? 0) + 1;
}

function sortedRecord(values: Record<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}

export function summarizeCodeGraph(
  graph: ReadonlyCodeGraph,
  diagnostics: readonly AnalyzerDiagnostic[] = [],
  unresolved: readonly UnresolvedRelationship[] = [],
  topCount = 10,
): GraphSummary {
  if (!Number.isSafeInteger(topCount) || topCount < 0) throw new RangeError("topCount must be a non-negative safe integer");
  const entities = graph.getEntities();
  const edges = graph.getEdges();
  const entitiesByKind: Record<string, number> = {};
  const edgesByType: Record<string, number> = {};
  const unresolvedByReason: Record<string, number> = {};
  const diagnosticsByCode: Record<string, number> = {};
  const neighbors = new Map<StableKey, Set<StableKey>>(entities.map((entity) => [entity.stableKey, new Set<StableKey>()]));
  const incoming = new Map<StableKey, number>();
  const outgoing = new Map<StableKey, number>();

  for (const entity of entities) increment(entitiesByKind, entity.kind);
  for (const edge of edges) {
    increment(edgesByType, edge.edgeType satisfies EdgeType);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  }
  for (const item of unresolved) increment(unresolvedByReason, item.reason);
  for (const item of diagnostics) increment(diagnosticsByCode, item.code);

  let connectedComponentCount = 0;
  let largestConnectedComponent = 0;
  const visited = new Set<StableKey>();
  for (const entity of entities) {
    if (visited.has(entity.stableKey)) continue;
    connectedComponentCount += 1;
    let componentSize = 0;
    const queue: StableKey[] = [entity.stableKey];
    visited.add(entity.stableKey);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!;
      componentSize += 1;
      for (const neighbor of neighbors.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    largestConnectedComponent = Math.max(largestConnectedComponent, componentSize);
  }

  function connected(entity: CodeEntity): ConnectedEntitySummary {
    const incomingCount = incoming.get(entity.stableKey) ?? 0;
    const outgoingCount = outgoing.get(entity.stableKey) ?? 0;
    return {
      stableKey: entity.stableKey,
      kind: entity.kind,
      qualifiedName: entity.qualifiedName,
      filePath: entity.filePath,
      incoming: incomingCount,
      outgoing: outgoingCount,
      degree: incomingCount + outgoingCount,
      uniqueNeighbors: neighbors.get(entity.stableKey)?.size ?? 0,
    };
  }

  return {
    entitiesByKind: sortedRecord(entitiesByKind),
    edgesByType: sortedRecord(edgesByType),
    moduleCount: entitiesByKind["MODULE"] ?? 0,
    externalPackageCount: entitiesByKind["EXTERNAL_PACKAGE"] ?? 0,
    isolatedEntityCount: entities.filter((entity) => (neighbors.get(entity.stableKey)?.size ?? 0) === 0).length,
    connectedComponentCount,
    largestConnectedComponent,
    unresolvedByReason: sortedRecord(unresolvedByReason),
    diagnosticsByCode: sortedRecord(diagnosticsByCode),
    topConnectedEntities: entities.map(connected).sort((left, right) =>
      right.degree - left.degree || right.uniqueNeighbors - left.uniqueNeighbors || left.stableKey.localeCompare(right.stableKey),
    ).slice(0, topCount),
  };
}
