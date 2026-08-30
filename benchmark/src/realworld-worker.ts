import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  createGitSourceRevision,
  summarizeCodeGraph,
  typescriptJavaScriptAnalyzer,
  type AnalyzerInput,
} from "@codeatlas/analyzer";

import { evaluateRealRepositoryAssertions } from "./realworld-assertions.js";
import { defaultRealRepositoryCacheRoot, loadRealRepositories, verifiedCheckoutPath } from "./realworld-loader.js";

const executeFile = promisify(execFile);

interface Options {
  readonly manifestPath?: string;
  readonly cacheRoot?: string;
  readonly slug: string;
}

function parse(arguments_: readonly string[]): Options {
  let manifestPath: string | undefined;
  let cacheRoot: string | undefined;
  let slug: string | undefined;
  for (let index = 0; index < arguments_.length; index += 2) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (value === undefined) throw new Error(`${argument} requires a value`);
    if (argument === "--manifest") manifestPath = value;
    else if (argument === "--cache") cacheRoot = value;
    else if (argument === "--slug") slug = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (slug === undefined) throw new Error("--slug is required");
  return { slug, ...(manifestPath === undefined ? {} : { manifestPath }), ...(cacheRoot === undefined ? {} : { cacheRoot }) };
}

async function git(arguments_: readonly string[], cwd: string): Promise<string> {
  const result = await executeFile("git", arguments_, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}

const options = parse(process.argv.slice(2));
const loaded = await loadRealRepositories(options.manifestPath);
const repository = loaded.find((item) => item.manifest.slug === options.slug);
if (repository === undefined) throw new Error(`Unknown real-repository slug: ${options.slug}`);
const checkout = await verifiedCheckoutPath(repository.manifest, options.cacheRoot ?? defaultRealRepositoryCacheRoot());
const head = (await git(["rev-parse", "HEAD"], checkout)).toLowerCase();
const remote = await git(["remote", "get-url", "origin"], checkout);
const status = await git(["status", "--porcelain", "--untracked-files=no"], checkout);
if (head !== repository.manifest.commitSha || remote !== repository.manifest.cloneUrl || status.length > 0) {
  throw new Error(`${repository.manifest.slug}: checkout verification failed; run pnpm benchmark:realworld:materialize`);
}

const input: AnalyzerInput = {
  snapshot: null,
  revision: createGitSourceRevision(repository.manifest.commitSha),
  repositoryRoot: checkout,
  projectHints: [],
  limits: {
    maxFiles: 10_000,
    maxFileBytes: 2_000_000,
    maxTraversalEntries: 250_000,
    maxDirectoryDepth: 100,
    timeoutMilliseconds: 15 * 60 * 1000,
  },
};
const result = await typescriptJavaScriptAnalyzer.analyze(input);
const assertions = await evaluateRealRepositoryAssertions(checkout, repository.assertions, result);
const summary = summarizeCodeGraph(result.graph, result.diagnostics, result.unresolvedRelationships, 20);
const elapsedSeconds = result.stats.elapsedMs / 1000;
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  repository: `${repository.manifest.owner}/${repository.manifest.repository}`,
  slug: repository.manifest.slug,
  commitSha: repository.manifest.commitSha,
  analyzer: { name: typescriptJavaScriptAnalyzer.name, version: typescriptJavaScriptAnalyzer.version },
  dependencyPolicy: "EXTERNAL_DEPENDENCIES_NOT_INSTALLED",
  limits: input.limits,
  stats: result.stats,
  telemetry: result.telemetry,
  throughput: {
    filesPerSecond: elapsedSeconds === 0 ? 0 : result.stats.filesAnalyzed / elapsedSeconds,
    linesPerSecond: elapsedSeconds === 0 ? 0 : result.stats.sourceLinesAnalyzed / elapsedSeconds,
  },
  graphSummary: summary,
  assertionResults: assertions,
  passed: assertions.every((item) => item.passed),
})}\n`);
