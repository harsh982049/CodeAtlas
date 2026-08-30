import { writeFile } from "node:fs/promises";
import path from "node:path";

import { serializeCodeGraph } from "@codeatlas/codegraph";

import { createLocalAnalyzerInput } from "./local-input.js";
import { summarizeCodeGraph } from "./graph-summary.js";
import { typescriptJavaScriptAnalyzer } from "./typescript-javascript-analyzer.js";

interface CliOptions {
  readonly repository: string;
  readonly output: string | null;
}

function usage(): never {
  process.stderr.write("Usage: pnpm codeatlas analyze <repository> [--output <file>]\n");
  process.exitCode = 2;
  throw new Error("Invalid command line");
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  if (arguments_[0] !== "analyze" || arguments_[1] === undefined) usage();
  let output: string | null = null;
  for (let index = 2; index < arguments_.length; index += 1) {
    if (arguments_[index] !== "--output" || arguments_[index + 1] === undefined) usage();
    output = arguments_[index + 1] ?? null;
    index += 1;
  }
  return { repository: arguments_[1], output };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const input = await createLocalAnalyzerInput(options.repository);
  const result = await typescriptJavaScriptAnalyzer.analyze(input);
  const serializedGraph = serializeCodeGraph(result.graph);
  const graphSummary = summarizeCodeGraph(result.graph, result.diagnostics, result.unresolvedRelationships);
  const document = {
    schemaVersion: 1,
    revision: input.revision,
    analyzer: { name: typescriptJavaScriptAnalyzer.name, version: typescriptJavaScriptAnalyzer.version },
    entities: serializedGraph.entities,
    edges: serializedGraph.edges,
    stats: result.stats,
    diagnostics: result.diagnostics,
    unresolvedRelationships: result.unresolvedRelationships,
    telemetry: result.telemetry,
    graphSummary,
  };
  const json = `${JSON.stringify(document, null, 2)}\n`;
  const summary = [
    "CodeAtlas Analyzer",
    `Repository              ${path.resolve(options.repository)}`,
    `Files discovered        ${result.stats.filesDiscovered}`,
    `Files analyzed          ${result.stats.filesAnalyzed}`,
    `Files skipped           ${result.stats.filesSkipped}`,
    `Files failed            ${result.stats.filesFailed}`,
    `Analyzed LOC            ${result.stats.sourceLinesAnalyzed}`,
    `Entities                ${result.stats.entitiesExtracted}`,
    `Edges                   ${result.stats.edgesCreated}`,
    `Modules                 ${graphSummary.moduleCount}`,
    `Connected components    ${graphSummary.connectedComponentCount}`,
    `Largest component       ${graphSummary.largestConnectedComponent}`,
    `Isolated entities       ${graphSummary.isolatedEntityCount}`,
    `Anonymous entities      ${result.stats.anonymousEntitiesExtracted}`,
    `Resolved calls          ${result.stats.callsResolved}`,
    `Unresolved calls        ${result.stats.callsUnresolved}`,
    `Internal imports        ${result.stats.internalImports}`,
    `External imports        ${result.stats.externalImports}`,
    `Diagnostics             ${result.diagnostics.length}`,
    `Unresolved relations    ${result.unresolvedRelationships.length}`,
    `Elapsed                 ${result.stats.elapsedMs} ms`,
    `Peak RSS                ${(result.telemetry.peakRssBytes / 1024 / 1024).toFixed(1)} MiB`,
  ].join("\n");
  process.stdout.write(`${summary}\n`);
  if (options.output !== null) {
    const outputPath = path.resolve(options.output);
    await writeFile(outputPath, json, "utf8");
    process.stdout.write(`Graph export             ${outputPath}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
