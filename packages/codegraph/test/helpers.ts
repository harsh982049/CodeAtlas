import {
  createCodeEdge,
  createNamedEntityIdentity,
  type CodeEdge,
  type CodeEntity,
  type EdgeType,
  type EntityKind,
} from "../src/index.js";
import { normalizeRelativePath } from "@codeatlas/shared";

export function entity(
  qualifiedName: string,
  kind: EntityKind,
  filePath = "src/index.ts",
): CodeEntity {
  const identity = createNamedEntityIdentity({ filePath, kind, qualifiedName });
  return {
    ...identity,
    kind,
    name: qualifiedName.split(".").at(-1) ?? qualifiedName,
    qualifiedName,
    filePath: normalizeRelativePath(filePath),
    sourceRange: null,
    exported: true,
    defaultExport: false,
    declarationFingerprint: null,
    implementationFingerprint: null,
    identityStability: "HIGH",
    analyzer: { name: "test-fixture", version: "1" },
    metadata: {},
  };
}

export function edge(
  source: CodeEntity,
  target: CodeEntity,
  edgeType: EdgeType,
  line = 1,
): CodeEdge {
  return createCodeEdge({
    source: source.stableKey,
    target: target.stableKey,
    edgeType,
    resolver: {
      analyzer: "test-fixture",
      analyzerVersion: "1",
      resolver: "hand-authored",
      resolverVersion: "1",
    },
    confidence: 1,
    evidence: {
      filePath: normalizeRelativePath(source.filePath ?? "src/index.ts"),
      start: { line, column: 1 },
      end: { line, column: 2 },
      kind: "STATIC_RESOLUTION",
    },
    metadata: {},
  });
}
