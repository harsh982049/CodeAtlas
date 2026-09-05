import type { NormalizedRelativePath } from "@codeatlas/shared";

export type SourceArtifactRole = "SOURCE" | "PROJECT_CONFIGURATION";

export type SourceArtifactFormat =
  | "TYPESCRIPT"
  | "TYPESCRIPT_JSX"
  | "JAVASCRIPT"
  | "JAVASCRIPT_JSX"
  | "JSON"
  | "YAML";

export interface SourceArtifact {
  readonly path: NormalizedRelativePath;
  readonly role: SourceArtifactRole;
  readonly format: SourceArtifactFormat;
  readonly bytes: Uint8Array;
  readonly contentHash: string;
  readonly byteCount: number;
  readonly lineCount: number;
}

export function assertSourceArtifact(artifact: SourceArtifact): void {
  if (!/^[0-9a-f]{64}$/u.test(artifact.contentHash)) {
    throw new Error("Source artifact content hash must be lowercase SHA-256");
  }
  if (artifact.bytes.byteLength !== artifact.byteCount) {
    throw new Error("Source artifact byte count does not match its exact bytes");
  }
  if (!Number.isSafeInteger(artifact.lineCount) || artifact.lineCount < 0) {
    throw new RangeError("Source artifact line count must be a non-negative safe integer");
  }
}
