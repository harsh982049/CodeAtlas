import path from "node:path";

import type { Brand } from "./brand.js";

export type NormalizedRelativePath = Brand<string, "NormalizedRelativePath">;

function assertNoEscapingSegments(segments: readonly string[]): void {
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Path must remain within the repository root");
  }
}

export function normalizeRelativePath(input: string): NormalizedRelativePath {
  if (input.includes("\0")) {
    throw new Error("Path must not contain NUL bytes");
  }

  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input)) {
    throw new Error("Expected a repository-relative path");
  }

  const segments = input
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

  assertNoEscapingSegments(segments);

  if (segments.length === 0) {
    throw new Error("Repository-relative path must not be empty");
  }

  const normalized = segments.join("/").normalize("NFC");
  if (/^[A-Za-z]:/.test(normalized)) {
    throw new Error("Repository-relative path must not contain a drive prefix");
  }

  return normalized as NormalizedRelativePath;
}

export function toRepositoryRelativePath(
  repositoryRoot: string,
  filePath: string,
): NormalizedRelativePath {
  const rootIsWindows = path.win32.isAbsolute(repositoryRoot);
  const fileIsWindows = path.win32.isAbsolute(filePath);
  const rootIsPosix = path.posix.isAbsolute(repositoryRoot);
  const fileIsPosix = path.posix.isAbsolute(filePath);

  if (!fileIsWindows && !fileIsPosix) {
    return normalizeRelativePath(filePath);
  }

  if (rootIsWindows !== fileIsWindows || rootIsPosix !== fileIsPosix) {
    throw new Error("Repository root and file path use incompatible path styles");
  }

  const relative = rootIsWindows
    ? path.win32.relative(repositoryRoot, filePath)
    : path.posix.relative(repositoryRoot, filePath);

  return normalizeRelativePath(relative);
}

