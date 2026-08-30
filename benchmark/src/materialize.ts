import {
  createCodeEdge,
  createExternalPackageEntityIdentity,
  createNamedEntityIdentity,
  InMemoryCodeGraph,
  type CodeEntity,
} from "@codeatlas/codegraph";
import { normalizeRelativePath } from "@codeatlas/shared";

import type { GoldenEntity, GoldenGraph } from "./schema.js";

function materializeEntity(golden: GoldenEntity): CodeEntity {
  if (golden.identity.identityKind === "EXTERNAL_PACKAGE") {
    const identity = createExternalPackageEntityIdentity(golden.identity.ecosystem, golden.identity.packageName);
    return {
      ...identity,
      kind: "EXTERNAL_PACKAGE",
      name: golden.name,
      qualifiedName: golden.identity.packageName,
      filePath: null,
      sourceRange: null,
      exported: golden.exported,
      defaultExport: false,
      declarationFingerprint: null,
      implementationFingerprint: null,
      identityStability: "HIGH",
      analyzer: { name: "golden-fixture", version: "1" },
      metadata: { ecosystem: golden.identity.ecosystem },
    };
  }
  const identity = createNamedEntityIdentity(golden.identity);
  return {
    ...identity,
    kind: golden.identity.kind,
    name: golden.name,
    qualifiedName: golden.identity.qualifiedName,
    filePath: normalizeRelativePath(golden.identity.filePath),
    sourceRange: null,
    exported: golden.exported,
    defaultExport: false,
    declarationFingerprint: null,
    implementationFingerprint: null,
    identityStability: "HIGH",
    analyzer: { name: "golden-fixture", version: "1" },
    metadata: {},
  };
}

export function materializeGoldenGraph(golden: GoldenGraph): InMemoryCodeGraph {
  const graph = new InMemoryCodeGraph();
  const byRef = new Map<string, CodeEntity>();
  for (const expected of golden.entities) {
    const entity = materializeEntity(expected);
    graph.addEntity(entity);
    byRef.set(expected.ref, entity);
  }
  for (const expected of golden.edges) {
    const source = byRef.get(expected.sourceRef);
    const target = byRef.get(expected.targetRef);
    if (source === undefined || target === undefined) throw new Error("Golden edge endpoint is missing");
    const evidence = expected.evidence === null ? null : {
      filePath: normalizeRelativePath(expected.evidence.filePath),
      start: { line: expected.evidence.startLine, column: expected.evidence.startColumn },
      end: { line: expected.evidence.endLine, column: expected.evidence.endColumn },
      kind: expected.evidence.kind,
    };
    graph.addEdge(createCodeEdge({
      source: source.stableKey,
      target: target.stableKey,
      edgeType: expected.edgeType,
      resolver: { analyzer: "golden-fixture", analyzerVersion: "1", resolver: "hand-authored", resolverVersion: "1" },
      confidence: expected.confidence,
      evidence,
      metadata: {},
    }));
  }
  return graph;
}
