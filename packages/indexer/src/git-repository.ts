import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createCommitSha, type CommitSha } from "@codeatlas/shared";

const execFileAsync = promisify(execFile);

export interface CleanGitRepository {
  readonly root: string;
  readonly commitSha: CommitSha;
  readonly name: string;
}

async function git(repositoryPath: string, ...arguments_: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", repositoryPath, ...arguments_], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return result.stdout.trim();
}

export async function inspectCleanGitRepository(repositoryPath: string): Promise<CleanGitRepository> {
  const requested = await realpath(path.resolve(repositoryPath));
  let root: string;
  try {
    root = await realpath(await git(requested, "rev-parse", "--show-toplevel"));
  } catch {
    throw new Error("Persistent indexing requires a readable Git repository with an exact HEAD");
  }
  const commitSha = createCommitSha(await git(root, "rev-parse", "--verify", "HEAD"));
  const status = await git(root, "status", "--porcelain=v1", "--untracked-files=all");
  if (status.length > 0) throw new Error("Persistent indexing requires a clean Git working tree, including no untracked files");
  return { root, commitSha, name: path.basename(root) };
}

export async function assertGitRepositoryUnchanged(before: CleanGitRepository): Promise<void> {
  const after = await inspectCleanGitRepository(before.root);
  if (after.root.toLowerCase() !== before.root.toLowerCase() || after.commitSha !== before.commitSha) {
    throw new Error("Git repository HEAD changed during analysis");
  }
}
