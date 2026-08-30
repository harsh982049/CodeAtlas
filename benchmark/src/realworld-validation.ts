import { edgeDomainRules, type EdgeType, type EntityKind } from "@codeatlas/codegraph";
import type { UnresolvedReason } from "@codeatlas/analyzer";

import type {
  RealAssertionEvidence,
  RealEntitySelector,
  RealRepositoryAssertion,
  RealRepositoryAssertions,
  RealRepositoryCategory,
  RealRepositoryManifest,
  RealRepositoryManifestEntry,
} from "./realworld-schema.js";

interface UnknownRecord extends Record<string, unknown> {
  readonly schemaVersion?: unknown;
  readonly repositories?: unknown;
  readonly slug?: unknown;
  readonly owner?: unknown;
  readonly repository?: unknown;
  readonly cloneUrl?: unknown;
  readonly commitSha?: unknown;
  readonly releaseTag?: unknown;
  readonly license?: unknown;
  readonly categories?: unknown;
  readonly purpose?: unknown;
  readonly sizeEstimate?: unknown;
  readonly assertionsFile?: unknown;
  readonly facts?: unknown;
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly rationale?: unknown;
  readonly evidence?: unknown;
  readonly subject?: unknown;
  readonly source?: unknown;
  readonly target?: unknown;
  readonly edgeType?: unknown;
  readonly minimumConfidence?: unknown;
  readonly intendedEdgeType?: unknown;
  readonly targetText?: unknown;
  readonly reason?: unknown;
  readonly filePath?: unknown;
  readonly qualifiedName?: unknown;
  readonly startLine?: unknown;
  readonly endLine?: unknown;
  readonly contentHash?: unknown;
}

const categories = new Set<RealRepositoryCategory>(["TYPESCRIPT", "JAVASCRIPT_COMMONJS", "MONOREPO", "REACT_TSX", "LARGE_SCALE"]);
const entityKinds = new Set<EntityKind>(["REPOSITORY", "MODULE", "FILE", "FUNCTION", "METHOD", "CONSTRUCTOR", "CLASS", "INTERFACE", "TYPE_ALIAS", "ENUM", "VARIABLE", "COMPONENT", "API_ROUTE", "TEST", "EXTERNAL_PACKAGE", "UNRESOLVED"]);
const edgeTypes = new Set<EdgeType>(Object.keys(edgeDomainRules) as EdgeType[]);
const unresolvedReasons = new Set(["ABSENT_DEPENDENCY", "AMBIGUOUS_TARGET", "COMPUTED_SPECIFIER", "DYNAMIC_DISPATCH", "MALFORMED_SOURCE", "OUTSIDE_ANALYSIS_SCOPE", "UNSUPPORTED_SYNTAX"]);

function record(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function sha(value: unknown, label: string): string {
  const parsed = nonEmpty(value, label).toLowerCase();
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(parsed)) throw new TypeError(`${label} must be a full Git SHA`);
  return parsed;
}

function selector(value: unknown, label: string): RealEntitySelector {
  const data = record(value, label);
  exactKeys(data, ["filePath", "kind", "qualifiedName"], label);
  if (data.filePath !== null && typeof data.filePath !== "string") throw new TypeError(`${label}.filePath must be a string or null`);
  const kind = nonEmpty(data.kind, `${label}.kind`) as EntityKind;
  if (!entityKinds.has(kind)) throw new TypeError(`${label}.kind is invalid`);
  return { filePath: data.filePath as string | null, kind, qualifiedName: nonEmpty(data.qualifiedName, `${label}.qualifiedName`) };
}

function evidence(value: unknown, label: string): RealAssertionEvidence {
  if (value === null) throw new TypeError(`${label} is required`);
  const data = record(value, label);
  exactKeys(data, ["filePath", "startLine", "endLine", "contentHash"], label);
  if (!Number.isSafeInteger(data.startLine) || Number(data.startLine) < 1 || !Number.isSafeInteger(data.endLine) || Number(data.endLine) < Number(data.startLine)) {
    throw new TypeError(`${label} line bounds are invalid`);
  }
  const contentHash = nonEmpty(data.contentHash, `${label}.contentHash`).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(contentHash)) throw new TypeError(`${label}.contentHash must be SHA-256`);
  return { filePath: nonEmpty(data.filePath, `${label}.filePath`), startLine: data.startLine as number, endLine: data.endLine as number, contentHash };
}

function assertion(value: unknown, label: string): RealRepositoryAssertion {
  const data = record(value, label);
  const kind = nonEmpty(data.kind, `${label}.kind`);
  const base = { id: nonEmpty(data.id, `${label}.id`), rationale: nonEmpty(data.rationale, `${label}.rationale`), evidence: evidence(data.evidence, `${label}.evidence`) };
  if (kind === "ENTITY") {
    exactKeys(data, ["id", "kind", "rationale", "evidence", "subject"], label);
    return { ...base, kind, subject: selector(data.subject, `${label}.subject`) };
  }
  if (kind === "EDGE" || kind === "EDGE_ABSENT") {
    exactKeys(data, ["id", "kind", "rationale", "evidence", "edgeType", "source", "target", "minimumConfidence"], label);
    const edgeType = nonEmpty(data.edgeType, `${label}.edgeType`) as EdgeType;
    if (!edgeTypes.has(edgeType)) throw new TypeError(`${label}.edgeType is invalid`);
    if (typeof data.minimumConfidence !== "number" || data.minimumConfidence < 0 || data.minimumConfidence > 1) throw new TypeError(`${label}.minimumConfidence is invalid`);
    return { ...base, kind, edgeType, source: selector(data.source, `${label}.source`), target: selector(data.target, `${label}.target`), minimumConfidence: data.minimumConfidence };
  }
  if (kind === "UNRESOLVED") {
    exactKeys(data, ["id", "kind", "rationale", "evidence", "source", "intendedEdgeType", "targetText", "reason"], label);
    const intendedEdgeType = nonEmpty(data.intendedEdgeType, `${label}.intendedEdgeType`) as EdgeType;
    const reason = nonEmpty(data.reason, `${label}.reason`);
    if (!edgeTypes.has(intendedEdgeType) || !unresolvedReasons.has(reason)) throw new TypeError(`${label} contains an invalid enum`);
    if (data.targetText !== null && typeof data.targetText !== "string") throw new TypeError(`${label}.targetText is invalid`);
    return { ...base, kind, source: data.source === null ? null : selector(data.source, `${label}.source`), intendedEdgeType, targetText: data.targetText as string | null, reason: reason as UnresolvedReason };
  }
  throw new TypeError(`${label}.kind is invalid`);
}

function repository(value: unknown, label: string): RealRepositoryManifestEntry {
  const data = record(value, label);
  exactKeys(data, ["slug", "owner", "repository", "cloneUrl", "commitSha", "releaseTag", "license", "categories", "purpose", "sizeEstimate", "assertionsFile"], label);
  if (!Array.isArray(data.categories) || data.categories.length === 0) throw new TypeError(`${label}.categories must be a non-empty array`);
  const parsedCategories = data.categories.map((item, index) => nonEmpty(item, `${label}.categories[${index}]`) as RealRepositoryCategory);
  if (parsedCategories.some((item) => !categories.has(item))) throw new TypeError(`${label}.categories contains an invalid value`);
  const owner = nonEmpty(data.owner, `${label}.owner`);
  const repositoryName = nonEmpty(data.repository, `${label}.repository`);
  const cloneUrl = nonEmpty(data.cloneUrl, `${label}.cloneUrl`);
  if (cloneUrl !== `https://github.com/${owner}/${repositoryName}.git`) throw new TypeError(`${label}.cloneUrl must be the direct declared GitHub repository URL`);
  return {
    slug: nonEmpty(data.slug, `${label}.slug`), owner, repository: repositoryName, cloneUrl,
    commitSha: sha(data.commitSha, `${label}.commitSha`), releaseTag: nonEmpty(data.releaseTag, `${label}.releaseTag`),
    license: nonEmpty(data.license, `${label}.license`), categories: parsedCategories,
    purpose: nonEmpty(data.purpose, `${label}.purpose`), sizeEstimate: nonEmpty(data.sizeEstimate, `${label}.sizeEstimate`),
    assertionsFile: nonEmpty(data.assertionsFile, `${label}.assertionsFile`),
  };
}

export function parseRealRepositoryManifest(value: unknown): RealRepositoryManifest {
  const data = record(value, "real repository manifest");
  exactKeys(data, ["schemaVersion", "repositories"], "real repository manifest");
  if (data.schemaVersion !== 1 || !Array.isArray(data.repositories) || data.repositories.length === 0) throw new TypeError("real repository manifest is invalid");
  const repositories = data.repositories.map((item, index) => repository(item, `repositories[${index}]`));
  if (new Set(repositories.map((item) => item.slug)).size !== repositories.length) throw new TypeError("repository slugs must be unique");
  return { schemaVersion: 1, repositories };
}

export function parseRealRepositoryAssertions(value: unknown): RealRepositoryAssertions {
  const data = record(value, "real repository assertions");
  exactKeys(data, ["schemaVersion", "repository", "commitSha", "facts"], "real repository assertions");
  if (data.schemaVersion !== 1 || !Array.isArray(data.facts) || data.facts.length === 0) throw new TypeError("real repository assertions must contain facts");
  const facts = data.facts.map((item, index) => assertion(item, `facts[${index}]`));
  if (new Set(facts.map((item) => item.id)).size !== facts.length) throw new TypeError("real assertion IDs must be unique");
  return { schemaVersion: 1, repository: nonEmpty(data.repository, "real repository assertions.repository"), commitSha: sha(data.commitSha, "real repository assertions.commitSha"), facts };
}
