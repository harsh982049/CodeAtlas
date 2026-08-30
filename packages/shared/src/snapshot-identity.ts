import type { Brand } from "./brand.js";

export type RepositoryIdentifier = Brand<string, "RepositoryIdentifier">;
export type CommitSha = Brand<string, "CommitSha">;
export type AnalyzerVersion = Brand<string, "AnalyzerVersion">;
export type EmbeddingProviderId = Brand<string, "EmbeddingProviderId">;
export type EmbeddingModelId = Brand<string, "EmbeddingModelId">;
export type EmbeddingVersion = Brand<string, "EmbeddingVersion">;

export interface AnalysisSnapshotIdentity {
  readonly repositoryId: RepositoryIdentifier;
  readonly commitSha: CommitSha;
  readonly analyzerVersion: AnalyzerVersion;
}

export interface EmbeddingIndexIdentity {
  readonly snapshot: AnalysisSnapshotIdentity;
  readonly provider: EmbeddingProviderId;
  readonly model: EmbeddingModelId;
  readonly embeddingVersion: EmbeddingVersion;
}

function nonEmpty<TName extends string>(value: string, label: string): Brand<string, TName> {
  const normalized = value.trim().normalize("NFC");
  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return normalized as Brand<string, TName>;
}

export function createRepositoryIdentifier(value: string): RepositoryIdentifier {
  return nonEmpty<"RepositoryIdentifier">(value, "Repository identifier");
}

export function createCommitSha(value: string): CommitSha {
  const normalized = value.toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(normalized)) {
    throw new Error("Commit SHA must be a 40- or 64-character hexadecimal value");
  }
  return normalized as CommitSha;
}

export function createAnalyzerVersion(value: string): AnalyzerVersion {
  return nonEmpty<"AnalyzerVersion">(value, "Analyzer version");
}

export function createEmbeddingProviderId(value: string): EmbeddingProviderId {
  return nonEmpty<"EmbeddingProviderId">(value, "Embedding provider");
}

export function createEmbeddingModelId(value: string): EmbeddingModelId {
  return nonEmpty<"EmbeddingModelId">(value, "Embedding model");
}

export function createEmbeddingVersion(value: string): EmbeddingVersion {
  return nonEmpty<"EmbeddingVersion">(value, "Embedding version");
}

