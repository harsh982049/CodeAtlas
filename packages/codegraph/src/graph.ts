import type { JsonValue } from "@codeatlas/shared";

import { assertEdgeDomain } from "./edge-domains.js";
import type { CodeEdge, EdgeKey, EdgeType } from "./edge.js";
import { assertCodeEdge } from "./edge.js";
import type { CodeEntity, StableKey } from "./entity.js";
import { assertCodeEntity } from "./entity.js";
import { canonicalSerialize } from "./fingerprint.js";
import type {
  GraphValidationDiagnostic,
  GraphValidationResult,
  TraversalOptions,
} from "./validation.js";

export interface AddResult {
  readonly added: boolean;
}

export interface TraversalStep {
  readonly entity: CodeEntity;
  readonly depth: number;
  readonly path: readonly CodeEdge[];
}

export interface ReadonlyCodeGraph {
  getEntity(stableKey: StableKey): CodeEntity | undefined;
  hasEntity(stableKey: StableKey): boolean;
  getEntities(): readonly CodeEntity[];
  getEdges(): readonly CodeEdge[];
  outgoing(stableKey: StableKey): readonly CodeEdge[];
  incoming(stableKey: StableKey): readonly CodeEdge[];
  outgoingByType(stableKey: StableKey, edgeType: EdgeType): readonly CodeEdge[];
  incomingByType(stableKey: StableKey, edgeType: EdgeType): readonly CodeEdge[];
  boundedForwardTraversal(start: StableKey, options: TraversalOptions): readonly TraversalStep[];
  boundedReverseTraversal(start: StableKey, options: TraversalOptions): readonly TraversalStep[];
  validate(): GraphValidationResult;
}

function sortedEdges(edges: Iterable<CodeEdge>): CodeEdge[] {
  return [...edges].sort((left, right) => left.edgeKey.localeCompare(right.edgeKey));
}

function equivalent(left: unknown, right: unknown): boolean {
  return canonicalSerialize(left as JsonValue) === canonicalSerialize(right as JsonValue);
}

export class InMemoryCodeGraph implements ReadonlyCodeGraph {
  readonly #entities = new Map<StableKey, CodeEntity>();
  readonly #edges = new Map<EdgeKey, CodeEdge>();
  readonly #outgoing = new Map<StableKey, Set<EdgeKey>>();
  readonly #incoming = new Map<StableKey, Set<EdgeKey>>();

  addEntity(entity: CodeEntity): AddResult {
    assertCodeEntity(entity);
    const existing = this.#entities.get(entity.stableKey);
    if (existing !== undefined) {
      if (!equivalent(existing, entity)) {
        throw new Error(`Conflicting entity for stable key ${entity.stableKey}`);
      }
      return { added: false };
    }
    this.#entities.set(entity.stableKey, entity);
    return { added: true };
  }

  getEntity(stableKey: StableKey): CodeEntity | undefined {
    return this.#entities.get(stableKey);
  }

  hasEntity(stableKey: StableKey): boolean {
    return this.#entities.has(stableKey);
  }

  getEntities(): readonly CodeEntity[] {
    return [...this.#entities.values()].sort((left, right) =>
      left.stableKey.localeCompare(right.stableKey),
    );
  }

  addEdge(edge: CodeEdge): AddResult {
    assertCodeEdge(edge);
    const source = this.#entities.get(edge.source);
    const target = this.#entities.get(edge.target);
    if (source === undefined || target === undefined) {
      throw new Error("Both edge endpoints must exist before adding an edge");
    }
    assertEdgeDomain(edge, source, target);

    const existing = this.#edges.get(edge.edgeKey);
    if (existing !== undefined) {
      if (!equivalent(existing, edge)) {
        throw new Error(`Conflicting edge occurrence ${edge.edgeKey}`);
      }
      return { added: false };
    }

    this.#edges.set(edge.edgeKey, edge);
    this.#indexEdge(this.#outgoing, edge.source, edge.edgeKey);
    this.#indexEdge(this.#incoming, edge.target, edge.edgeKey);

    if (edge.edgeType === "CONTAINS" && this.#hasContainmentPath(edge.target, edge.source)) {
      this.#removeEdge(edge);
      throw new Error("CONTAINS edge would create a containment cycle");
    }

    if (edge.edgeType === "REFERENCES" && this.#duplicatesCall(edge)) {
      this.#removeEdge(edge);
      throw new Error("REFERENCES must not duplicate a CALLS occurrence");
    }
    if (edge.edgeType === "CALLS" && this.#duplicatesReference(edge)) {
      this.#removeEdge(edge);
      throw new Error("CALLS conflicts with an existing REFERENCES occurrence");
    }

    return { added: true };
  }

  getEdges(): readonly CodeEdge[] {
    return sortedEdges(this.#edges.values());
  }

  outgoing(stableKey: StableKey): readonly CodeEdge[] {
    return this.#edgesFor(this.#outgoing.get(stableKey));
  }

  incoming(stableKey: StableKey): readonly CodeEdge[] {
    return this.#edgesFor(this.#incoming.get(stableKey));
  }

  outgoingByType(stableKey: StableKey, edgeType: EdgeType): readonly CodeEdge[] {
    return this.outgoing(stableKey).filter((edge) => edge.edgeType === edgeType);
  }

  incomingByType(stableKey: StableKey, edgeType: EdgeType): readonly CodeEdge[] {
    return this.incoming(stableKey).filter((edge) => edge.edgeType === edgeType);
  }

  boundedForwardTraversal(
    start: StableKey,
    options: TraversalOptions,
  ): readonly TraversalStep[] {
    return this.#traverse(start, options, "FORWARD");
  }

  boundedReverseTraversal(
    start: StableKey,
    options: TraversalOptions,
  ): readonly TraversalStep[] {
    return this.#traverse(start, options, "REVERSE");
  }

  validate(): GraphValidationResult {
    const diagnostics: GraphValidationDiagnostic[] = [];
    for (const entity of this.#entities.values()) {
      try {
        assertCodeEntity(entity);
      } catch (error) {
        diagnostics.push({
          code: "INVALID_ENTITY",
          message: error instanceof Error ? error.message : String(error),
          entity: entity.stableKey,
          edge: null,
        });
      }
    }
    for (const edge of this.#edges.values()) {
      try {
        assertCodeEdge(edge);
        const source = this.#entities.get(edge.source);
        const target = this.#entities.get(edge.target);
        if (source === undefined || target === undefined) {
          throw new Error("Edge endpoint is missing");
        }
        assertEdgeDomain(edge, source, target);
      } catch (error) {
        diagnostics.push({
          code: "INVALID_EDGE",
          message: error instanceof Error ? error.message : String(error),
          entity: null,
          edge: edge.edgeKey,
        });
      }
    }
    return { valid: diagnostics.length === 0, diagnostics };
  }

  #indexEdge(index: Map<StableKey, Set<EdgeKey>>, key: StableKey, edgeKey: EdgeKey): void {
    const values = index.get(key) ?? new Set<EdgeKey>();
    values.add(edgeKey);
    index.set(key, values);
  }

  #edgesFor(keys: ReadonlySet<EdgeKey> | undefined): readonly CodeEdge[] {
    if (keys === undefined) {
      return [];
    }
    return sortedEdges([...keys].map((key) => this.#edges.get(key)).filter((edge) => edge !== undefined));
  }

  #removeEdge(edge: CodeEdge): void {
    this.#edges.delete(edge.edgeKey);
    this.#outgoing.get(edge.source)?.delete(edge.edgeKey);
    this.#incoming.get(edge.target)?.delete(edge.edgeKey);
  }

  #sameOccurrence(left: CodeEdge, right: CodeEdge): boolean {
    return (
      left.source === right.source &&
      left.target === right.target &&
      canonicalSerialize(left.evidence) === canonicalSerialize(right.evidence)
    );
  }

  #duplicatesCall(reference: CodeEdge): boolean {
    return this.outgoingByType(reference.source, "CALLS").some((call) =>
      this.#sameOccurrence(call, reference),
    );
  }

  #duplicatesReference(call: CodeEdge): boolean {
    return this.outgoingByType(call.source, "REFERENCES").some((reference) =>
      this.#sameOccurrence(call, reference),
    );
  }

  #hasContainmentPath(start: StableKey, target: StableKey): boolean {
    const queue: StableKey[] = [start];
    const visited = new Set<StableKey>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || visited.has(current)) {
        continue;
      }
      if (current === target) {
        return true;
      }
      visited.add(current);
      for (const edge of this.outgoingByType(current, "CONTAINS")) {
        queue.push(edge.target);
      }
    }
    return false;
  }

  #traverse(
    start: StableKey,
    options: TraversalOptions,
    direction: "FORWARD" | "REVERSE",
  ): readonly TraversalStep[] {
    if (!Number.isInteger(options.maxDepth) || options.maxDepth < 0) {
      throw new RangeError("Traversal depth must be a non-negative integer");
    }
    if (!this.#entities.has(start)) {
      throw new Error(`Traversal start entity does not exist: ${start}`);
    }

    const results: TraversalStep[] = [];
    const visited = new Set<StableKey>([start]);
    const queue: Array<{ key: StableKey; depth: number; path: readonly CodeEdge[] }> = [
      { key: start, depth: 0, path: [] },
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || current.depth >= options.maxDepth) {
        continue;
      }
      const edges = direction === "FORWARD" ? this.outgoing(current.key) : this.incoming(current.key);
      for (const edge of edges) {
        if (options.edgeTypes !== undefined && !options.edgeTypes.has(edge.edgeType)) {
          continue;
        }
        const next = direction === "FORWARD" ? edge.target : edge.source;
        if (visited.has(next)) {
          continue;
        }
        const entity = this.#entities.get(next);
        if (entity === undefined) {
          continue;
        }
        visited.add(next);
        const step: TraversalStep = {
          entity,
          depth: current.depth + 1,
          path: [...current.path, edge],
        };
        results.push(step);
        queue.push({ key: next, depth: step.depth, path: step.path });
      }
    }

    return results;
  }
}

