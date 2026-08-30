import { createHash } from "node:crypto";

import type { Brand, CommitSha, NormalizedRelativePath } from "@codeatlas/shared";
import { createCommitSha } from "@codeatlas/shared";

export type ContentRevisionHash = Brand<string, "ContentRevisionHash">;

export type SourceRevision =
  | { readonly kind: "GIT"; readonly sha: CommitSha }
  | { readonly kind: "CONTENT"; readonly sha256: ContentRevisionHash };

export interface RevisionFile {
  readonly path: NormalizedRelativePath;
  readonly contentHash: string;
}

export function createGitSourceRevision(value: string): SourceRevision {
  return { kind: "GIT", sha: createCommitSha(value) };
}

export function createContentSourceRevision(files: readonly RevisionFile[]): SourceRevision {
  const canonical = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}\0${file.contentHash}\n`)
    .join("");
  return {
    kind: "CONTENT",
    sha256: createHash("sha256").update(canonical, "utf8").digest("hex") as ContentRevisionHash,
  };
}
