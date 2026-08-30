import { runAnalyzerBenchmark } from "./analyzer-runner.js";

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

const result = await runAnalyzerBenchmark();
for (const fixture of result.fixtures) {
  process.stdout.write(
    `${fixture.fixture.padEnd(22)} entities F1 ${percent(fixture.entities.f1)}  edges F1 ${percent(fixture.edges.f1)}  unresolved F1 ${percent(fixture.unresolvedRelationships.f1)}  ${fixture.elapsedMs}ms\n`,
  );
  for (const mismatch of fixture.mismatches) process.stdout.write(`  - ${mismatch}\n`);
}
process.stdout.write(`Aggregate entities: precision ${percent(result.entities.precision)}, recall ${percent(result.entities.recall)}, F1 ${percent(result.entities.f1)}\n`);
process.stdout.write(`Aggregate edges: precision ${percent(result.edges.precision)}, recall ${percent(result.edges.recall)}, F1 ${percent(result.edges.f1)}\n`);
process.stdout.write(`Aggregate unresolved: precision ${percent(result.unresolvedRelationships.precision)}, recall ${percent(result.unresolvedRelationships.recall)}, F1 ${percent(result.unresolvedRelationships.f1)}\n`);
process.stdout.write(`Aggregate diagnostics: precision ${percent(result.diagnostics.precision)}, recall ${percent(result.diagnostics.recall)}, F1 ${percent(result.diagnostics.f1)}\n`);
if (!result.perfect) process.exitCode = 1;
