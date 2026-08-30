import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RealRepositoryAssertions, RealRepositoryManifest, RealRepositoryManifestEntry } from "./realworld-schema.js";
import { parseRealRepositoryAssertions, parseRealRepositoryManifest } from "./realworld-validation.js";

export interface LoadedRealRepository {
  readonly manifest: RealRepositoryManifestEntry;
  readonly assertions: RealRepositoryAssertions;
}

export function benchmarkPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function defaultRealRepositoryManifestPath(): string {
  return path.join(benchmarkPackageRoot(), "realworld", "repositories.json");
}

export function defaultRealRepositoryCacheRoot(): string {
  return path.resolve(benchmarkPackageRoot(), "..", ".codeatlas-cache", "checkouts");
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export async function loadRealRepositoryManifest(manifestPath = defaultRealRepositoryManifestPath()): Promise<RealRepositoryManifest> {
  return parseRealRepositoryManifest(await json(path.resolve(manifestPath)));
}

export async function loadRealRepositories(manifestPath = defaultRealRepositoryManifestPath()): Promise<readonly LoadedRealRepository[]> {
  const absoluteManifest = path.resolve(manifestPath);
  const directory = path.dirname(absoluteManifest);
  const manifest = await loadRealRepositoryManifest(absoluteManifest);
  const loaded: LoadedRealRepository[] = [];
  for (const repository of manifest.repositories) {
    const assertionsPath = path.resolve(directory, repository.assertionsFile);
    if (!inside(directory, assertionsPath)) throw new Error(`${repository.slug}: assertionsFile escapes the realworld manifest directory`);
    const assertions = parseRealRepositoryAssertions(await json(assertionsPath));
    if (assertions.repository !== `${repository.owner}/${repository.repository}` || assertions.commitSha !== repository.commitSha) {
      throw new Error(`${repository.slug}: assertions do not match the repository and commit manifest`);
    }
    loaded.push({ manifest: repository, assertions });
  }
  return loaded;
}

export async function verifiedCheckoutPath(repository: RealRepositoryManifestEntry, cacheRoot = defaultRealRepositoryCacheRoot()): Promise<string> {
  const root = path.resolve(cacheRoot);
  const candidate = path.resolve(root, repository.slug);
  if (!inside(root, candidate)) throw new Error(`${repository.slug}: checkout path escapes the real-repository cache`);
  return realpath(candidate);
}
