import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalAnalyzerInput, typescriptJavaScriptAnalyzer, type UnresolvedRelationship } from "@codeatlas/analyzer";
import { serializeCodeGraph, type StableKey } from "@codeatlas/codegraph";

import { compareActualToGolden, compareSets, type SetMetrics } from "./comparison.js";
import { loadFixtureCorpus } from "./loader.js";
import { materializeGoldenGraph } from "./materialize.js";
import type { GoldenGraph } from "./schema.js";

export interface FixtureAnalyzerBenchmark {
  readonly fixture: string;
  readonly entities: SetMetrics;
  readonly edges: SetMetrics;
  readonly unresolvedRelationships: SetMetrics;
  readonly diagnostics: SetMetrics;
  readonly mismatches: readonly string[];
  readonly elapsedMs: number;
}

export interface AnalyzerBenchmarkResult {
  readonly fixtures: readonly FixtureAnalyzerBenchmark[];
  readonly entities: SetMetrics;
  readonly edges: SetMetrics;
  readonly unresolvedRelationships: SetMetrics;
  readonly diagnostics: SetMetrics;
  readonly perfect: boolean;
}

function sumMetrics(metrics: readonly SetMetrics[]): SetMetrics {
  const truePositive = metrics.reduce((sum, item) => sum + item.truePositive, 0);
  const falsePositive = metrics.reduce((sum, item) => sum + item.falsePositive, 0);
  const falseNegative = metrics.reduce((sum, item) => sum + item.falseNegative, 0);
  const precision = truePositive + falsePositive === 0 ? (falseNegative === 0 ? 1 : 0) : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0 ? 1 : truePositive / (truePositive + falseNegative);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { truePositive, falsePositive, falseNegative, precision, recall, f1 };
}

function unresolvedKey(source: StableKey | null, edgeType: string, targetText: string | null, reason: string): string {
  return `${source ?? "NO_SOURCE"}|${edgeType}|${targetText ?? "NO_TARGET"}|${reason}`;
}

function compareUnresolved(golden: GoldenGraph, actual: readonly UnresolvedRelationship[]): { metrics: SetMetrics; mismatches: readonly string[] } {
  const graph = materializeGoldenGraph(golden);
  const byRef = new Map<string, StableKey>();
  for (const expected of golden.entities) {
    const entity = graph.getEntities().find((candidate) => {
      if (candidate.name !== expected.name) return false;
      if (expected.identity.identityKind === "EXTERNAL_PACKAGE") return candidate.qualifiedName === expected.identity.packageName;
      if (expected.identity.identityKind === "ANONYMOUS") {
        return candidate.filePath === expected.identity.filePath && candidate.kind === "FUNCTION" && candidate.metadata["syntacticRole"] === expected.identity.syntacticRole;
      }
      return candidate.filePath === expected.identity.filePath && candidate.kind === expected.identity.kind && candidate.qualifiedName === expected.identity.qualifiedName;
    });
    if (entity !== undefined) byRef.set(expected.ref, entity.stableKey);
  }
  const expected = new Set(golden.unresolvedRelationships.map((item) => unresolvedKey(item.sourceRef === null ? null : byRef.get(item.sourceRef) ?? null, item.intendedEdgeType, item.targetText, item.reason)));
  const observed = new Set(actual.map((item) => unresolvedKey(item.source, item.intendedEdgeType, item.targetText, item.reason)));
  return {
    metrics: compareSets(expected, observed),
    mismatches: [
      ...[...expected].filter((key) => !observed.has(key)).map((key) => `missing unresolved ${key}`),
      ...[...observed].filter((key) => !expected.has(key)).map((key) => `unexpected unresolved ${key}`),
    ],
  };
}

function graphMismatches(
  expected: ReturnType<typeof materializeGoldenGraph>,
  actual: ReturnType<typeof serializeCodeGraph>,
): readonly string[] {
  const expectedEntities = new Map(expected.getEntities().map((entity) => [entity.stableKey, `${entity.kind} ${entity.filePath ?? "external"} ${entity.qualifiedName}`]));
  const actualEntities = new Map(actual.entities.map((entity) => [entity.stableKey, `${entity.kind} ${entity.filePath ?? "external"} ${entity.qualifiedName}`]));
  const expectedNames = new Map(expected.getEntities().map((entity) => [entity.stableKey, entity.qualifiedName]));
  const actualNames = new Map(actual.entities.map((entity) => [entity.stableKey, entity.qualifiedName]));
  const expectedEdges = new Map(expected.getEdges().map((edge) => [`${edge.edgeType}|${edge.source}|${edge.target}`, `${expectedNames.get(edge.source) ?? edge.source} ${edge.edgeType} ${expectedNames.get(edge.target) ?? edge.target}`]));
  const actualEdges = new Map(actual.edges.map((edge) => [`${edge.edgeType}|${edge.source}|${edge.target}`, `${actualNames.get(edge.source) ?? edge.source} ${edge.edgeType} ${actualNames.get(edge.target) ?? edge.target}`]));
  return [
    ...[...expectedEntities].filter(([key]) => !actualEntities.has(key)).map(([, label]) => `missing entity ${label}`),
    ...[...actualEntities].filter(([key]) => !expectedEntities.has(key)).map(([, label]) => `unexpected entity ${label}`),
    ...[...expectedEdges].filter(([key]) => !actualEdges.has(key)).map(([, label]) => `missing edge ${label}`),
    ...[...actualEdges].filter(([key]) => !expectedEdges.has(key)).map(([, label]) => `unexpected edge ${label}`),
  ];
}

export async function runAnalyzerBenchmark(): Promise<AnalyzerBenchmarkResult> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fixtures = await loadFixtureCorpus(path.join(packageRoot, "fixtures"));
  const results: FixtureAnalyzerBenchmark[] = [];
  for (const fixture of fixtures) {
    const input = await createLocalAnalyzerInput(fixture.directory);
    const actual = await typescriptJavaScriptAnalyzer.analyze(input);
    const serialized = serializeCodeGraph(actual.graph);
    const expectedGraph = materializeGoldenGraph(fixture.golden);
    const comparison = compareActualToGolden(fixture.golden, serialized, { enforceMinimumConfidence: true });
    const unresolved = compareUnresolved(fixture.golden, actual.unresolvedRelationships);
    const expectedDiagnostics = new Set(fixture.golden.expectedDiagnosticCodes);
    const actualDiagnostics = new Set(actual.diagnostics.map((item) => item.code));
    results.push({
      fixture: fixture.manifest.name,
      entities: comparison.entities,
      edges: comparison.edges,
      unresolvedRelationships: unresolved.metrics,
      diagnostics: compareSets(expectedDiagnostics, actualDiagnostics),
      mismatches: [
        ...graphMismatches(expectedGraph, serialized),
        ...unresolved.mismatches,
        ...[...expectedDiagnostics].filter((code) => !actualDiagnostics.has(code)).map((code) => `missing diagnostic ${code}`),
        ...[...actualDiagnostics].filter((code) => !expectedDiagnostics.has(code)).map((code) => `unexpected diagnostic ${code}`),
      ],
      elapsedMs: actual.stats.elapsedMs,
    });
  }
  const entities = sumMetrics(results.map((item) => item.entities));
  const edges = sumMetrics(results.map((item) => item.edges));
  const unresolvedRelationships = sumMetrics(results.map((item) => item.unresolvedRelationships));
  const diagnostics = sumMetrics(results.map((item) => item.diagnostics));
  const perfect = [entities, edges, unresolvedRelationships, diagnostics].every((item) => item.falsePositive === 0 && item.falseNegative === 0);
  return { fixtures: results, entities, edges, unresolvedRelationships, diagnostics, perfect };
}
