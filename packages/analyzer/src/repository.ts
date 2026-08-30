import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import type { NormalizedRelativePath } from "@codeatlas/shared";
import { normalizeRelativePath } from "@codeatlas/shared";

import type { AnalysisLimits } from "./analyzer-input.js";
import type { AnalyzerDiagnostic } from "./analyzer-diagnostic.js";

const ignoredDirectories = new Set([
  ".git", ".hg", ".svn", ".next", ".turbo", "build", "coverage", "dist",
  "node_modules", "out", "target", "vendor",
]);
const sourcePattern = /(?:\.d)?\.(?:[cm]?[jt]sx?)$/iu;
const projectNames = new Set(["package.json", "pnpm-workspace.yaml", "tsconfig.json", "jsconfig.json"]);

export interface RepositoryFile {
  readonly absolutePath: string;
  readonly relativePath: NormalizedRelativePath;
  readonly text: string;
  readonly contentHash: string;
}

export interface RepositoryScan {
  readonly root: string;
  readonly sourceFiles: readonly RepositoryFile[];
  readonly projectFiles: readonly RepositoryFile[];
  readonly filesDiscovered: number;
  readonly filesSkipped: number;
  readonly diagnostics: readonly AnalyzerDiagnostic[];
}

export class AnalysisDeadline {
  readonly #expiresAt: number;

  constructor(timeoutMilliseconds: number) {
    this.#expiresAt = Date.now() + timeoutMilliseconds;
  }

  check(stage: string): void {
    if (Date.now() > this.#expiresAt) throw new Error(`Analysis deadline exceeded during ${stage}`);
  }
}

function isProjectFile(relative: string): boolean {
  const name = path.basename(relative).toLowerCase();
  return projectNames.has(name) || /^tsconfig\..+\.json$/u.test(name) || /^jsconfig\..+\.json$/u.test(name);
}

function hash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function skipReason(relativePath: string, text: string): { code: string; message: string } | null {
  if (/\.min\.[cm]?js$/iu.test(relativePath)) {
    return { code: "GENERATED_SOURCE_SKIPPED", message: `Skipped obvious minified source ${relativePath}` };
  }
  if (text.includes("\0")) {
    return { code: "BINARY_SOURCE_SKIPPED", message: `Skipped source containing NUL bytes ${relativePath}` };
  }
  const lines = text.split(/\r?\n/u);
  if (text.length > 100_000 && lines.length <= 5 && lines.some((line) => line.length > 50_000)) {
    return { code: "GENERATED_SOURCE_SKIPPED", message: `Skipped likely generated/minified source ${relativePath}` };
  }
  return null;
}

function locationless(code: string, message: string): AnalyzerDiagnostic {
  return { code, severity: "WARNING", message, location: null };
}

export async function scanRepository(
  repositoryRoot: string,
  limits: AnalysisLimits,
  deadline: AnalysisDeadline,
): Promise<RepositoryScan> {
  const root = await realpath(path.resolve(repositoryRoot));
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory()) throw new Error("Repository root must be a directory");

  const sourceFiles: RepositoryFile[] = [];
  const projectFiles: RepositoryFile[] = [];
  const diagnostics: AnalyzerDiagnostic[] = [];
  let filesDiscovered = 0;
  let filesSkipped = 0;
  let sourceCandidates = 0;

  async function walk(directory: string): Promise<void> {
    deadline.check("repository discovery");
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      deadline.check("repository discovery");
      if (entry.isDirectory() && ignoredDirectories.has(entry.name.toLowerCase())) continue;
      const absolutePath = path.join(directory, entry.name);
      const relativeText = path.relative(root, absolutePath).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        diagnostics.push(locationless("SYMLINK_SKIPPED", `Skipped symbolic link ${relativeText}`));
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      const sourceCandidate = sourcePattern.test(entry.name);
      if (!entry.isFile() || (!sourceCandidate && !isProjectFile(relativeText))) continue;
      if (sourceCandidate) {
        filesDiscovered += 1;
        if (sourceCandidates >= limits.maxFiles) {
          filesSkipped += 1;
          diagnostics.push(locationless("MAX_FILES_EXCEEDED", `Skipped ${relativeText}; maxFiles is ${limits.maxFiles}`));
          continue;
        }
        sourceCandidates += 1;
      }
      const info = await lstat(absolutePath);
      if (info.size > limits.maxFileBytes) {
        if (sourceCandidate) filesSkipped += 1;
        diagnostics.push(locationless("FILE_TOO_LARGE", `Skipped ${relativeText}; file exceeds ${limits.maxFileBytes} bytes`));
        continue;
      }
      const text = await readFile(absolutePath, "utf8");
      if (sourceCandidate) {
        const reason = skipReason(relativeText, text);
        if (reason !== null) {
          filesSkipped += 1;
          diagnostics.push(locationless(reason.code, reason.message));
          continue;
        }
      }
      const file: RepositoryFile = {
        absolutePath,
        relativePath: normalizeRelativePath(relativeText),
        text,
        contentHash: hash(text),
      };
      if (sourceCandidate) sourceFiles.push(file);
      else projectFiles.push(file);
    }
  }

  await walk(root);
  return { root, sourceFiles, projectFiles, filesDiscovered, filesSkipped, diagnostics };
}
