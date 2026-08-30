import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadFixtureCorpus } from "./loader.js";
import { materializeGoldenGraph } from "./materialize.js";

export interface ContractBenchmarkResult {
  readonly fixtureCount: number;
  readonly entityCount: number;
  readonly edgeCount: number;
  readonly unresolvedRelationshipCount: number;
}

export async function runContractBenchmark(): Promise<ContractBenchmarkResult> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fixtures = await loadFixtureCorpus(path.join(packageRoot, "fixtures"));
  let entityCount = 0;
  let edgeCount = 0;
  let unresolvedRelationshipCount = 0;
  for (const fixture of fixtures) {
    const graph = materializeGoldenGraph(fixture.golden);
    const validation = graph.validate();
    if (!validation.valid) throw new Error(`${fixture.manifest.name}: ${validation.diagnostics.map((item) => item.message).join("; ")}`);
    entityCount += graph.getEntities().length;
    edgeCount += graph.getEdges().length;
    unresolvedRelationshipCount += fixture.golden.unresolvedRelationships.length;
  }
  if (fixtures.length === 0) throw new Error("Fixture corpus is empty");
  return { fixtureCount: fixtures.length, entityCount, edgeCount, unresolvedRelationshipCount };
}
