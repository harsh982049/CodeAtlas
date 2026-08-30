import { writeFile } from "node:fs/promises";
import path from "node:path";

import { runRealWorldBenchmark } from "./realworld-runner.js";

interface Options {
  readonly manifestPath?: string;
  readonly cacheRoot?: string;
  readonly only?: ReadonlySet<string>;
  readonly output?: string;
}

function parse(arguments_: readonly string[]): Options {
  let manifestPath: string | undefined;
  let cacheRoot: string | undefined;
  let output: string | undefined;
  const only = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (value === undefined) throw new Error(`${argument} requires a value`);
    if (argument === "--manifest") manifestPath = value;
    else if (argument === "--cache") cacheRoot = value;
    else if (argument === "--output") output = value;
    else if (argument === "--only") only.add(value);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return {
    ...(manifestPath === undefined ? {} : { manifestPath }),
    ...(cacheRoot === undefined ? {} : { cacheRoot }),
    ...(output === undefined ? {} : { output }),
    ...(only.size === 0 ? {} : { only }),
  };
}

const options = parse(process.argv.slice(2));
const result = await runRealWorldBenchmark(options);
for (const item of result.repositories) {
  const repository = item as {
    slug: string;
    passed: boolean;
    stats: { filesAnalyzed: number; sourceLinesAnalyzed: number; entitiesExtracted: number; edgesCreated: number; elapsedMs: number };
    telemetry: { peakRssBytes: number };
    assertionResults: readonly { passed: boolean }[];
  };
  process.stdout.write(`${repository.passed ? "PASS" : "FAIL"} ${repository.slug} files=${repository.stats.filesAnalyzed} loc=${repository.stats.sourceLinesAnalyzed} entities=${repository.stats.entitiesExtracted} edges=${repository.stats.edgesCreated} elapsed=${repository.stats.elapsedMs}ms peakRSS=${(repository.telemetry.peakRssBytes / 1024 / 1024).toFixed(1)}MiB assertions=${repository.assertionResults.filter((assertion) => assertion.passed).length}/${repository.assertionResults.length}\n`);
}
if (options.output !== undefined) {
  const outputPath = path.resolve(options.output);
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`Result ${outputPath}\n`);
}
if (!result.passed) process.exitCode = 1;
