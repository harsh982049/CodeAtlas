import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import type { NormalizedRelativePath } from "@codeatlas/shared";
import { normalizeRelativePath } from "@codeatlas/shared";

import type { AnalysisLimits } from "./analyzer-input.js";
import type { AnalyzerDiagnostic } from "./analyzer-diagnostic.js";
import { AnalysisLimitError } from "./analysis-error.js";
import type { SourceArtifactFormat, SourceArtifactRole } from "./source-artifact.js";

const ignoredDirectories = new Set([
  ".git", ".hg", ".svn", ".next", ".turbo", "build", "coverage", "dist",
  "node_modules", "out", "target", "vendor",
]);
const ignoredRelativeDirectories = new Set(["tests/baselines"]);
const sourcePattern = /(?:\.d)?\.(?:[cm]?[jt]sx?)$/iu;
const projectNames = new Set(["package.json", "pnpm-workspace.yaml", "tsconfig.json", "jsconfig.json"]);

export interface RepositoryFile {
  readonly absolutePath: string;
  readonly relativePath: NormalizedRelativePath;
  readonly role: SourceArtifactRole;
  readonly format: SourceArtifactFormat;
  readonly bytes: Buffer;
  readonly text: string;
  readonly contentHash: string;
}

export interface RepositoryScan {
  readonly root: string;
  readonly sourceFiles: readonly RepositoryFile[];
  readonly projectFiles: readonly RepositoryFile[];
  readonly filesDiscovered: number;
  readonly filesSkipped: number;
  readonly traversalEntries: number;
  readonly diagnostics: readonly AnalyzerDiagnostic[];
}

export class AnalysisDeadline {
  readonly #expiresAt: number;
  readonly #now: () => number;

  constructor(timeoutMilliseconds: number, now: () => number = Date.now) {
    this.#now = now;
    this.#expiresAt = now() + timeoutMilliseconds;
  }

  check(stage: string): void {
    if (this.#now() > this.#expiresAt) {
      throw new AnalysisLimitError("DEADLINE", stage, `Analysis deadline exceeded during ${stage}`);
    }
  }
}

function isProjectFile(relative: string): boolean {
  const name = path.basename(relative).toLowerCase();
  return projectNames.has(name) || /^tsconfig\..+\.json$/u.test(name) || /^jsconfig\..+\.json$/u.test(name);
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceFormat(relativePath: string): SourceArtifactFormat {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".tsx")) return "TYPESCRIPT_JSX";
  if (lower.endsWith(".jsx")) return "JAVASCRIPT_JSX";
  if (/(?:\.d)?\.(?:ts|mts|cts)$/u.test(lower)) return "TYPESCRIPT";
  return "JAVASCRIPT";
}

function projectFormat(relativePath: string): SourceArtifactFormat {
  return relativePath.toLowerCase().endsWith(".yaml") ? "YAML" : "JSON";
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
  let traversalEntries = 0;
  let traversalLimitReached = false;

  async function walk(directory: string, depth: number): Promise<void> {
    deadline.check("repository discovery");
    if (depth > limits.maxDirectoryDepth) {
      const relativeDirectory = path.relative(root, directory).replaceAll("\\", "/") || ".";
      diagnostics.push(locationless("MAX_DIRECTORY_DEPTH_EXCEEDED", `Skipped ${relativeDirectory}; maxDirectoryDepth is ${limits.maxDirectoryDepth}`));
      return;
    }
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      deadline.check("repository discovery");
      traversalEntries += 1;
      if (traversalEntries > limits.maxTraversalEntries) {
        diagnostics.push(locationless("MAX_TRAVERSAL_ENTRIES_EXCEEDED", `Stopped discovery; maxTraversalEntries is ${limits.maxTraversalEntries}`));
        traversalLimitReached = true;
        break;
      }
      if (entry.isDirectory() && ignoredDirectories.has(entry.name.toLowerCase())) continue;
      const absolutePath = path.join(directory, entry.name);
      const relativeText = path.relative(root, absolutePath).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        diagnostics.push(locationless("SYMLINK_SKIPPED", `Skipped symbolic link ${relativeText}`));
        continue;
      }
      if (entry.isDirectory()) {
        if (ignoredRelativeDirectories.has(relativeText.toLowerCase())) {
          diagnostics.push(locationless("GENERATED_DIRECTORY_SKIPPED", `Skipped recognized generated-source directory ${relativeText}`));
          continue;
        }
        await walk(absolutePath, depth + 1);
        if (traversalLimitReached) break;
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
      const bytes = await readFile(absolutePath);
      const text = bytes.toString("utf8");
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
        role: sourceCandidate ? "SOURCE" : "PROJECT_CONFIGURATION",
        format: sourceCandidate ? sourceFormat(relativeText) : projectFormat(relativeText),
        bytes,
        text,
        contentHash: hash(bytes),
      };
      if (sourceCandidate) sourceFiles.push(file);
      else projectFiles.push(file);
    }
  }

  await walk(root, 0);
  return { root, sourceFiles, projectFiles, filesDiscovered, filesSkipped, traversalEntries, diagnostics };
}
