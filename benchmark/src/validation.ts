import {
  edgeDomainRules,
  type EdgeType,
  type EntityKind,
  type EvidenceKind,
} from "@codeatlas/codegraph";

import type {
  FixtureManifest,
  GoldenEdge,
  GoldenEntity,
  GoldenEvidence,
  GoldenGraph,
  GoldenUnresolvedRelationship,
} from "./schema.js";

const entityKinds = new Set<EntityKind>([
  "REPOSITORY", "MODULE", "FILE", "FUNCTION", "METHOD", "CONSTRUCTOR", "CLASS",
  "INTERFACE", "TYPE_ALIAS", "ENUM", "VARIABLE", "COMPONENT", "API_ROUTE", "TEST",
  "EXTERNAL_PACKAGE", "UNRESOLVED",
]);
const edgeTypes = new Set<EdgeType>(Object.keys(edgeDomainRules) as EdgeType[]);
const evidenceKinds = new Set<EvidenceKind>(["STATIC_RESOLUTION", "SYNTAX", "HEURISTIC"]);
const unresolvedReasons = new Set([
  "ABSENT_DEPENDENCY", "AMBIGUOUS_TARGET", "COMPUTED_SPECIFIER", "DYNAMIC_DISPATCH",
  "MALFORMED_SOURCE", "OUTSIDE_ANALYSIS_SCOPE", "UNSUPPORTED_SYNTAX",
]);

interface UnknownRecord {
  readonly [key: string]: unknown;
  readonly schemaVersion?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly languages?: unknown;
  readonly behaviors?: unknown;
  readonly intentionallyUnresolvedRelationships?: unknown;
  readonly projectFiles?: unknown;
  readonly sourceFiles?: unknown;
  readonly goldenFile?: unknown;
  readonly fixture?: unknown;
  readonly entities?: unknown;
  readonly edges?: unknown;
  readonly unresolvedRelationships?: unknown;
  readonly expectedDiagnosticCodes?: unknown;
  readonly ref?: unknown;
  readonly identity?: unknown;
  readonly identityKind?: unknown;
  readonly kind?: unknown;
  readonly filePath?: unknown;
  readonly qualifiedName?: unknown;
  readonly ecosystem?: unknown;
  readonly packageName?: unknown;
  readonly lexicalParentRef?: unknown;
  readonly syntacticRole?: unknown;
  readonly localStructuralText?: unknown;
  readonly exported?: unknown;
  readonly edgeType?: unknown;
  readonly intendedEdgeType?: unknown;
  readonly sourceRef?: unknown;
  readonly targetRef?: unknown;
  readonly targetText?: unknown;
  readonly reason?: unknown;
  readonly confidence?: unknown;
  readonly metricTags?: unknown;
  readonly evidence?: unknown;
  readonly startLine?: unknown;
  readonly startColumn?: unknown;
  readonly endLine?: unknown;
  readonly endColumn?: unknown;
}

function record(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((item, index) => string(item, `${label}[${index}]`));
}

function optionalStrings(value: unknown, label: string): string[] {
  return value === undefined ? [] : strings(value, label);
}

function evidence(value: unknown, label: string): GoldenEvidence | null {
  if (value === null) return null;
  const data = record(value, label);
  const kind = string(data.kind, `${label}.kind`) as EvidenceKind;
  if (!evidenceKinds.has(kind)) throw new TypeError(`${label}.kind is invalid`);
  const numbers = [data.startLine, data.startColumn, data.endLine, data.endColumn];
  if (!numbers.every((item) => Number.isInteger(item) && Number(item) > 0)) {
    throw new TypeError(`${label} positions must be positive integers`);
  }
  return {
    filePath: string(data.filePath, `${label}.filePath`),
    startLine: data.startLine as number,
    startColumn: data.startColumn as number,
    endLine: data.endLine as number,
    endColumn: data.endColumn as number,
    kind,
  };
}

function entity(value: unknown, label: string): GoldenEntity {
  const data = record(value, label);
  const identity = record(data.identity, `${label}.identity`);
  const identityKind = string(identity.identityKind, `${label}.identity.identityKind`);
  let parsedIdentity: GoldenEntity["identity"];
  if (identityKind === "NAMED") {
    const kind = string(identity.kind, `${label}.identity.kind`) as EntityKind;
    if (!entityKinds.has(kind)) throw new TypeError(`${label}.identity.kind is invalid`);
    parsedIdentity = {
      identityKind,
      filePath: string(identity.filePath, `${label}.identity.filePath`),
      kind,
      qualifiedName: string(identity.qualifiedName, `${label}.identity.qualifiedName`),
    };
  } else if (identityKind === "EXTERNAL_PACKAGE") {
    const ecosystem = string(identity.ecosystem, `${label}.identity.ecosystem`);
    if (ecosystem !== "NPM" && ecosystem !== "NODE_BUILTIN") throw new TypeError(`${label}.identity.ecosystem is invalid`);
    parsedIdentity = {
      identityKind,
      ecosystem,
      packageName: string(identity.packageName, `${label}.identity.packageName`),
    };
  } else if (identityKind === "ANONYMOUS") {
    if (identity.kind !== "FUNCTION") throw new TypeError(`${label}.identity.kind must be FUNCTION`);
    parsedIdentity = {
      identityKind,
      filePath: string(identity.filePath, `${label}.identity.filePath`),
      kind: "FUNCTION",
      lexicalParentRef: string(identity.lexicalParentRef, `${label}.identity.lexicalParentRef`),
      syntacticRole: string(identity.syntacticRole, `${label}.identity.syntacticRole`),
      localStructuralText: string(identity.localStructuralText, `${label}.identity.localStructuralText`),
    };
  } else {
    throw new TypeError(`${label}.identity.identityKind is invalid`);
  }
  if (typeof data.exported !== "boolean") throw new TypeError(`${label}.exported must be boolean`);
  return { ref: string(data.ref, `${label}.ref`), identity: parsedIdentity, name: string(data.name, `${label}.name`), exported: data.exported };
}

function edge(value: unknown, label: string): GoldenEdge {
  const data = record(value, label);
  const edgeType = string(data.edgeType, `${label}.edgeType`) as EdgeType;
  if (!edgeTypes.has(edgeType)) throw new TypeError(`${label}.edgeType is invalid`);
  if (typeof data.confidence !== "number" || data.confidence < 0 || data.confidence > 1) throw new TypeError(`${label}.confidence must be between zero and one`);
  const metricTags = optionalStrings(data.metricTags, `${label}.metricTags`);
  if (metricTags.some((tag) => tag !== "CALL_RESOLUTION" && tag !== "IMPORT_RESOLUTION")) throw new TypeError(`${label}.metricTags is invalid`);
  return {
    edgeType,
    sourceRef: string(data.sourceRef, `${label}.sourceRef`),
    targetRef: string(data.targetRef, `${label}.targetRef`),
    confidence: data.confidence,
    metricTags: metricTags as GoldenEdge["metricTags"],
    evidence: evidence(data.evidence, `${label}.evidence`),
  };
}

function unresolved(value: unknown, label: string): GoldenUnresolvedRelationship {
  const data = record(value, label);
  const intendedEdgeType = string(data.intendedEdgeType, `${label}.intendedEdgeType`) as EdgeType;
  const reason = string(data.reason, `${label}.reason`);
  if (!edgeTypes.has(intendedEdgeType) || !unresolvedReasons.has(reason)) throw new TypeError(`${label} has invalid enum values`);
  if (data.sourceRef !== null && typeof data.sourceRef !== "string") throw new TypeError(`${label}.sourceRef is invalid`);
  if (data.targetText !== null && typeof data.targetText !== "string") throw new TypeError(`${label}.targetText is invalid`);
  const metricTags = optionalStrings(data.metricTags, `${label}.metricTags`);
  if (metricTags.some((tag) => tag !== "UNRESOLVED_CALL")) throw new TypeError(`${label}.metricTags is invalid`);
  return {
    sourceRef: data.sourceRef as string | null,
    intendedEdgeType,
    targetText: data.targetText as string | null,
    reason: reason as GoldenUnresolvedRelationship["reason"],
    metricTags: metricTags as GoldenUnresolvedRelationship["metricTags"],
    evidence: evidence(data.evidence, `${label}.evidence`),
  };
}

export function parseFixtureManifest(value: unknown): FixtureManifest {
  const data = record(value, "fixture manifest");
  if (data.schemaVersion !== 1) throw new TypeError("fixture manifest schemaVersion must be 1");
  const languages = strings(data.languages, "fixture manifest.languages");
  if (languages.some((item) => item !== "JAVASCRIPT" && item !== "TYPESCRIPT" && item !== "TSX")) throw new TypeError("fixture manifest contains an invalid language");
  const behaviors = strings(data.behaviors, "fixture manifest.behaviors");
  if (behaviors.length === 0) throw new TypeError("fixture manifest must describe at least one behavior");
  return {
    schemaVersion: 1,
    name: string(data.name, "fixture manifest.name"),
    description: string(data.description, "fixture manifest.description"),
    languages: languages as FixtureManifest["languages"],
    behaviors,
    intentionallyUnresolvedRelationships: strings(data.intentionallyUnresolvedRelationships, "fixture manifest.intentionallyUnresolvedRelationships"),
    projectFiles: strings(data.projectFiles, "fixture manifest.projectFiles"),
    sourceFiles: strings(data.sourceFiles, "fixture manifest.sourceFiles"),
    goldenFile: string(data.goldenFile, "fixture manifest.goldenFile"),
  };
}

export function parseGoldenGraph(value: unknown): GoldenGraph {
  const data = record(value, "golden graph");
  if (data.schemaVersion !== 1) throw new TypeError("golden graph schemaVersion must be 1");
  if (!Array.isArray(data.entities) || !Array.isArray(data.edges) || !Array.isArray(data.unresolvedRelationships)) throw new TypeError("golden graph collections must be arrays");
  const parsed: GoldenGraph = {
    schemaVersion: 1,
    fixture: string(data.fixture, "golden graph.fixture"),
    entities: data.entities.map((item, index) => entity(item, `entities[${index}]`)),
    edges: data.edges.map((item, index) => edge(item, `edges[${index}]`)),
    unresolvedRelationships: data.unresolvedRelationships.map((item, index) => unresolved(item, `unresolvedRelationships[${index}]`)),
    expectedDiagnosticCodes: strings(data.expectedDiagnosticCodes, "golden graph.expectedDiagnosticCodes"),
  };
  const refs = new Set(parsed.entities.map((item) => item.ref));
  if (refs.size !== parsed.entities.length) throw new Error("Golden entity refs must be unique");
  for (const item of parsed.edges) {
    if (!refs.has(item.sourceRef) || !refs.has(item.targetRef)) throw new Error(`Edge references an unknown entity: ${item.sourceRef} -> ${item.targetRef}`);
  }
  for (const item of parsed.entities) {
    if (item.identity.identityKind === "ANONYMOUS" && !refs.has(item.identity.lexicalParentRef)) {
      throw new Error(`Anonymous entity references unknown lexical parent: ${item.identity.lexicalParentRef}`);
    }
  }
  for (const item of parsed.unresolvedRelationships) {
    if (item.sourceRef !== null && !refs.has(item.sourceRef)) throw new Error(`Unresolved relationship references unknown source: ${item.sourceRef}`);
  }
  return parsed;
}
