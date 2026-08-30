import { execFile } from "node:child_process";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RealRepositoryManifestEntry } from "./realworld-schema.js";
import { defaultRealRepositoryCacheRoot, loadRealRepositoryManifest } from "./realworld-loader.js";

export interface MaterializedRepository {
  readonly slug: string;
  readonly checkoutPath: string;
  readonly commitSha: string;
  readonly reused: boolean;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function runGit(arguments_: readonly string[], cwd: string, environment: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", arguments_, { cwd, env: environment, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`git ${arguments_.join(" ")} failed in ${cwd}: ${stderr.trim() || error.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function verifyCheckout(repository: RealRepositoryManifestEntry, checkoutPath: string, environment: NodeJS.ProcessEnv): Promise<void> {
  const head = await runGit(["rev-parse", "HEAD"], checkoutPath, environment);
  if (head.toLowerCase() !== repository.commitSha) throw new Error(`${repository.slug}: expected HEAD ${repository.commitSha}, found ${head}`);
  const remote = await runGit(["remote", "get-url", "origin"], checkoutPath, environment);
  if (remote !== repository.cloneUrl) throw new Error(`${repository.slug}: expected origin ${repository.cloneUrl}, found ${remote}`);
  const status = await runGit(["status", "--porcelain", "--untracked-files=no"], checkoutPath, environment);
  if (status.length > 0) throw new Error(`${repository.slug}: cached checkout contains tracked modifications`);
}

export async function materializeRealRepositories(options: {
  readonly manifestPath?: string;
  readonly cacheRoot?: string;
  readonly only?: ReadonlySet<string>;
} = {}): Promise<readonly MaterializedRepository[]> {
  const manifest = await loadRealRepositoryManifest(options.manifestPath);
  const cacheRoot = path.resolve(options.cacheRoot ?? defaultRealRepositoryCacheRoot());
  const emptyGlobalConfig = path.join(cacheRoot, ".empty-gitconfig");
  const emptyHooks = path.join(cacheRoot, ".empty-hooks");
  await mkdir(emptyHooks, { recursive: true });
  await writeFile(emptyGlobalConfig, "", { encoding: "utf8", flag: "a" });
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyGlobalConfig,
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  const results: MaterializedRepository[] = [];
  for (const repository of manifest.repositories) {
    if (options.only !== undefined && !options.only.has(repository.slug)) continue;
    const checkoutPath = path.resolve(cacheRoot, repository.slug);
    if (!inside(cacheRoot, checkoutPath)) throw new Error(`${repository.slug}: unsafe checkout path`);
    if (await exists(path.join(checkoutPath, ".git"))) {
      await runGit(["config", "--local", "core.longpaths", "true"], checkoutPath, environment);
      await verifyCheckout(repository, checkoutPath, environment);
      results.push({ slug: repository.slug, checkoutPath, commitSha: repository.commitSha, reused: true });
      continue;
    }
    if (await exists(checkoutPath) && (await readdir(checkoutPath)).length > 0) {
      throw new Error(`${repository.slug}: cache target exists and is not an initialized checkout: ${checkoutPath}`);
    }
    await mkdir(checkoutPath, { recursive: true });
    await runGit(["init"], checkoutPath, environment);
    await runGit(["config", "--local", "core.hooksPath", emptyHooks], checkoutPath, environment);
    await runGit(["config", "--local", "core.longpaths", "true"], checkoutPath, environment);
    await runGit(["remote", "add", "origin", repository.cloneUrl], checkoutPath, environment);
    await runGit(["fetch", "--depth=1", "--filter=blob:none", "--no-tags", "origin", repository.commitSha], checkoutPath, environment);
    await runGit(["-c", `core.hooksPath=${emptyHooks}`, "-c", "filter.lfs.smudge=", "-c", "filter.lfs.required=false", "checkout", "--detach", "FETCH_HEAD"], checkoutPath, environment);
    await verifyCheckout(repository, checkoutPath, environment);
    results.push({ slug: repository.slug, checkoutPath, commitSha: repository.commitSha, reused: false });
  }
  if (options.only !== undefined) {
    const found = new Set(results.map((item) => item.slug));
    const missing = [...options.only].filter((slug) => !found.has(slug));
    if (missing.length > 0) throw new Error(`Unknown real-repository slug(s): ${missing.join(", ")}`);
  }
  return results;
}
