import { execFile } from "node:child_process";
import { cpus, platform, release, totalmem } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultRealRepositoryCacheRoot, defaultRealRepositoryManifestPath, loadRealRepositories } from "./realworld-loader.js";

export interface RealWorldBenchmarkResult {
  readonly schemaVersion: 1;
  readonly benchmarkKind: "COLD_STRUCTURAL_ANALYSIS";
  readonly measuredAt: string;
  readonly host: {
    readonly platform: string;
    readonly release: string;
    readonly architecture: string;
    readonly logicalCpuCount: number;
    readonly totalMemoryBytes: number;
    readonly nodeVersion: string;
  };
  readonly externalDependenciesInstalled: false;
  readonly repositories: readonly unknown[];
  readonly passed: boolean;
}

function runWorker(arguments_: readonly string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, arguments_, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 16 * 60 * 1000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(stderr.trim() || stdout.trim() || error.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as unknown);
      } catch (parseError) {
        reject(new Error(`Real-repository worker returned invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
      }
    });
  });
}

export async function runRealWorldBenchmark(options: {
  readonly manifestPath?: string;
  readonly cacheRoot?: string;
  readonly only?: ReadonlySet<string>;
} = {}): Promise<RealWorldBenchmarkResult> {
  const manifestPath = path.resolve(options.manifestPath ?? defaultRealRepositoryManifestPath());
  const cacheRoot = path.resolve(options.cacheRoot ?? defaultRealRepositoryCacheRoot());
  const repositories = await loadRealRepositories(manifestPath);
  const workerPath = fileURLToPath(new URL("./realworld-worker.ts", import.meta.url));
  const results: unknown[] = [];
  for (const repository of repositories) {
    if (options.only !== undefined && !options.only.has(repository.manifest.slug)) continue;
    results.push(await runWorker(["--import", "tsx", workerPath, "--manifest", manifestPath, "--cache", cacheRoot, "--slug", repository.manifest.slug]));
  }
  if (options.only !== undefined && results.length !== options.only.size) throw new Error("One or more requested real-repository slugs are unknown");
  const passed = results.every((item) => item !== null && typeof item === "object" && (item as { passed?: unknown }).passed === true);
  return {
    schemaVersion: 1,
    benchmarkKind: "COLD_STRUCTURAL_ANALYSIS",
    measuredAt: new Date().toISOString(),
    host: {
      platform: platform(),
      release: release(),
      architecture: process.arch,
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      nodeVersion: process.version,
    },
    externalDependenciesInstalled: false,
    repositories: results,
    passed,
  };
}
