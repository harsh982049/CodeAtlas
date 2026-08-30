import type { CodeEdge, EdgeType } from "./edge.js";
import type { CodeEntity, EntityKind } from "./entity.js";

const containers = new Set<EntityKind>([
  "REPOSITORY",
  "MODULE",
  "FILE",
  "CLASS",
  "INTERFACE",
  "ENUM",
]);

const callables = new Set<EntityKind>([
  "FUNCTION",
  "METHOD",
  "CONSTRUCTOR",
  "COMPONENT",
]);

const expressionOwners = new Set<EntityKind>([
  "MODULE",
  "FILE",
  "FUNCTION",
  "METHOD",
  "CONSTRUCTOR",
  "CLASS",
  "VARIABLE",
  "COMPONENT",
  "TEST",
]);

const moduleLike = new Set<EntityKind>(["MODULE", "FILE"]);
const dependencyTargets = new Set<EntityKind>([
  "MODULE",
  "FILE",
  "EXTERNAL_PACKAGE",
  "UNRESOLVED",
]);

export interface EdgeDomainRule {
  readonly description: string;
  readonly allows: (source: CodeEntity, target: CodeEntity) => boolean;
}

export const edgeDomainRules: Readonly<Record<EdgeType, EdgeDomainRule>> = {
  CONTAINS: {
    description: "container → child",
    allows: (source, target) => containers.has(source.kind) && target.kind !== "REPOSITORY",
  },
  IMPORTS: {
    description: "importing module/file → imported module/file/package",
    allows: (source, target) => moduleLike.has(source.kind) && dependencyTargets.has(target.kind),
  },
  EXPORTS: {
    description: "module/file → exported entity",
    allows: (source, target) => moduleLike.has(source.kind) && target.kind !== "REPOSITORY",
  },
  CALLS: {
    description: "caller → callee",
    allows: (source, target) =>
      (expressionOwners.has(source.kind) || source.kind === "API_ROUTE") && callables.has(target.kind),
  },
  REFERENCES: {
    description: "referrer → referenced entity",
    allows: (source, target) => expressionOwners.has(source.kind) && target.kind !== "REPOSITORY",
  },
  EXTENDS: {
    description: "child → parent",
    allows: (source, target) =>
      (source.kind === "CLASS" && target.kind === "CLASS") ||
      (source.kind === "INTERFACE" && target.kind === "INTERFACE"),
  },
  IMPLEMENTS: {
    description: "class → interface",
    allows: (source, target) => source.kind === "CLASS" && target.kind === "INTERFACE",
  },
  INSTANTIATES: {
    description: "expression owner → class",
    allows: (source, target) => expressionOwners.has(source.kind) && target.kind === "CLASS",
  },
  ROUTES_TO: {
    description: "API route → handler",
    allows: (source, target) => source.kind === "API_ROUTE" && callables.has(target.kind),
  },
  TESTS: {
    description: "test → tested subject",
    allows: (source, target) =>
      source.kind === "TEST" && target.kind !== "REPOSITORY" && target.kind !== "UNRESOLVED",
  },
  DEPENDS_ON: {
    description: "module/package → dependency",
    allows: (source, target) =>
      (source.kind === "MODULE" || source.kind === "EXTERNAL_PACKAGE") &&
      dependencyTargets.has(target.kind),
  },
  POSSIBLE_CALL: {
    description: "caller → possible known callee",
    allows: (source, target) => expressionOwners.has(source.kind) && callables.has(target.kind),
  },
};

export function assertEdgeDomain(
  edge: CodeEdge,
  source: CodeEntity,
  target: CodeEntity,
): void {
  if (!edgeDomainRules[edge.edgeType].allows(source, target)) {
    throw new Error(
      `${edge.edgeType} requires ${edgeDomainRules[edge.edgeType].description}; received ${source.kind} → ${target.kind}`,
    );
  }

  if (
    edge.source === edge.target &&
    (edge.edgeType === "CONTAINS" ||
      edge.edgeType === "EXTENDS" ||
      edge.edgeType === "IMPLEMENTS" ||
      edge.edgeType === "INSTANTIATES")
  ) {
    throw new Error(`${edge.edgeType} does not allow a self-edge`);
  }
}

