import { runContractBenchmark } from "./contract-runner.js";

const result = await runContractBenchmark();
process.stdout.write(`Contract benchmark passed: ${result.fixtureCount} fixtures, ${result.entityCount} entities, ${result.edgeCount} edges, ${result.unresolvedRelationshipCount} unresolved relationships.\n`);
