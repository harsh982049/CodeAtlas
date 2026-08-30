import path from "node:path";
import { readFile } from "node:fs/promises";

import type { NormalizedRelativePath } from "@codeatlas/shared";

import type { AnalysisLimits, AnalyzerInput } from "./analyzer-input.js";
import { AnalysisDeadline, scanRepository } from "./repository.js";
import { createContentSourceRevision, createGitSourceRevision, type SourceRevision } from "./source-revision.js";

export const defaultAnalysisLimits: AnalysisLimits = {
  maxFiles: 10_000,
  maxFileBytes: 2_000_000,
  maxTraversalEntries: 100_000,
  maxDirectoryDepth: 100,
  timeoutMilliseconds: 120_000,
};

async function gitHeadRevision(root: string): Promise<SourceRevision | null> {
  try {
    const head = (await readFile(path.join(root, ".git", "HEAD"), "utf8")).trim();
    if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(head)) return createGitSourceRevision(head);
    if (!head.startsWith("ref: ")) return null;
    const reference = head.slice(5);
    if (reference.includes("..") || path.isAbsolute(reference)) return null;
    const sha = (await readFile(path.join(root, ".git", ...reference.split("/")), "utf8")).trim();
    return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(sha) ? createGitSourceRevision(sha) : null;
  } catch {
    return null;
  }
}

export async function createLocalAnalyzerInput(
  repositoryRoot: string,
  limits: AnalysisLimits = defaultAnalysisLimits,
): Promise<AnalyzerInput> {
  const root = path.resolve(repositoryRoot);
  const scan = await scanRepository(root, limits, new AnalysisDeadline(limits.timeoutMilliseconds));
  const revisionFiles = [...scan.sourceFiles, ...scan.projectFiles].map((file) => ({
    path: file.relativePath,
    contentHash: file.contentHash,
  }));
  const revision = await gitHeadRevision(root) ?? createContentSourceRevision(revisionFiles);
  const projectHints = scan.projectFiles
    .filter((file) => /(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$/u.test(file.relativePath))
    .map((file) => file.relativePath as NormalizedRelativePath);
  return {
    snapshot: null,
    revision,
    repositoryRoot: root,
    projectHints,
    limits,
  };
}
