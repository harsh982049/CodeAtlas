import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AnalyzerResult } from "@codeatlas/analyzer";
import type { CodeEntity } from "@codeatlas/codegraph";

import type { RealEntitySelector, RealRepositoryAssertion, RealRepositoryAssertions } from "./realworld-schema.js";

export interface RealAssertionResult {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function entityFor(result: AnalyzerResult, selector: RealEntitySelector): CodeEntity {
  const matches = result.graph.getEntities().filter((entity) =>
    entity.filePath === selector.filePath && entity.kind === selector.kind && entity.qualifiedName === selector.qualifiedName,
  );
  if (matches.length !== 1) throw new Error(`selector ${selector.kind} ${selector.filePath ?? "external"} ${selector.qualifiedName} matched ${matches.length} entities`);
  return matches[0] as CodeEntity;
}

async function verifyEvidence(repositoryRoot: string, assertion: RealRepositoryAssertion): Promise<void> {
  const filePath = path.resolve(repositoryRoot, assertion.evidence.filePath);
  if (!inside(repositoryRoot, filePath)) throw new Error("evidence file escapes the checkout");
  const text = await readFile(filePath, "utf8");
  const contentHash = createHash("sha256").update(text, "utf8").digest("hex");
  if (contentHash !== assertion.evidence.contentHash) throw new Error(`evidence content hash changed for ${assertion.evidence.filePath}`);
  const lineCount = text.length === 0 ? 0 : text.split(/\r?\n/u).length;
  if (assertion.evidence.endLine > lineCount) throw new Error(`evidence line range exceeds ${assertion.evidence.filePath}`);
}

function evaluateFact(result: AnalyzerResult, assertion: RealRepositoryAssertion): void {
  if (assertion.kind === "ENTITY") {
    entityFor(result, assertion.subject);
    return;
  }
  if (assertion.kind === "EDGE" || assertion.kind === "EDGE_ABSENT") {
    const source = entityFor(result, assertion.source);
    const target = entityFor(result, assertion.target);
    const matches = result.graph.outgoingByType(source.stableKey, assertion.edgeType)
      .filter((edge) => edge.target === target.stableKey && edge.confidence >= assertion.minimumConfidence);
    if (assertion.kind === "EDGE" && matches.length === 0) throw new Error(`expected ${assertion.edgeType} edge is absent`);
    if (assertion.kind === "EDGE_ABSENT" && matches.length > 0) throw new Error(`forbidden ${assertion.edgeType} edge is present`);
    return;
  }
  if (assertion.kind !== "UNRESOLVED") throw new Error("unsupported real-repository assertion kind");
  const source = assertion.source === null ? null : entityFor(result, assertion.source);
  const match = result.unresolvedRelationships.some((item) =>
    item.source === source?.stableKey && item.intendedEdgeType === assertion.intendedEdgeType &&
    item.targetText === assertion.targetText && item.reason === assertion.reason,
  );
  if (!match) throw new Error("expected unresolved relationship is absent");
}

export async function evaluateRealRepositoryAssertions(
  repositoryRoot: string,
  assertions: RealRepositoryAssertions,
  result: AnalyzerResult,
): Promise<readonly RealAssertionResult[]> {
  const evaluated: RealAssertionResult[] = [];
  for (const assertion of assertions.facts) {
    try {
      await verifyEvidence(repositoryRoot, assertion);
      evaluateFact(result, assertion);
      evaluated.push({ id: assertion.id, passed: true, message: "passed" });
    } catch (error) {
      evaluated.push({ id: assertion.id, passed: false, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return evaluated;
}
