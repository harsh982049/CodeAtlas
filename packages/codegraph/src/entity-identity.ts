import type { NormalizedRelativePath } from "@codeatlas/shared";
import { normalizeRelativePath, toRepositoryRelativePath } from "@codeatlas/shared";

import type { EntityKind, CanonicalEntityIdentity, StableKey } from "./entity.js";
import type { LocalStructuralFingerprint } from "./fingerprint.js";
import { canonicalSerialize, sha256Hex } from "./fingerprint.js";

export interface EntityIdentity {
  readonly canonicalIdentity: CanonicalEntityIdentity;
  readonly stableKey: StableKey;
}

function identityFromParts(parts: readonly string[]): EntityIdentity {
  const canonicalIdentity = canonicalSerialize(parts) as CanonicalEntityIdentity;
  const stableKey = `sk:v1:sha256:${sha256Hex(canonicalIdentity)}` as StableKey;
  return { canonicalIdentity, stableKey };
}

export interface NamedEntityIdentityInput {
  readonly repositoryRoot?: string;
  readonly filePath: string;
  readonly kind: EntityKind;
  readonly qualifiedName: string;
}

export function createNamedEntityIdentity(input: NamedEntityIdentityInput): EntityIdentity {
  const qualifiedName = input.qualifiedName.trim().normalize("NFC");
  if (qualifiedName.length === 0) {
    throw new Error("Qualified name must not be empty");
  }
  const filePath = input.repositoryRoot === undefined
    ? normalizeRelativePath(input.filePath)
    : toRepositoryRelativePath(input.repositoryRoot, input.filePath);

  return identityFromParts([
    "codeatlas-entity-identity-v1",
    filePath,
    input.kind,
    qualifiedName,
  ]);
}

export function createRepositoryEntityIdentity(repositoryId: string): EntityIdentity {
  const normalized = repositoryId.trim().normalize("NFC");
  if (normalized.length === 0) {
    throw new Error("Repository identity must not be empty");
  }
  return identityFromParts(["codeatlas-repository-identity-v1", "REPOSITORY", normalized]);
}

export type ExternalPackageEcosystem = "NPM" | "NODE_BUILTIN";

export function createExternalPackageEntityIdentity(
  ecosystem: ExternalPackageEcosystem,
  packageName: string,
): EntityIdentity {
  const normalized = packageName.trim().normalize("NFC");
  if (normalized.length === 0) {
    throw new Error("External package name must not be empty");
  }
  return identityFromParts([
    "codeatlas-external-package-identity-v1",
    "EXTERNAL_PACKAGE",
    ecosystem,
    normalized,
  ]);
}

export interface AnonymousEntityIdentityInput {
  readonly filePath: NormalizedRelativePath;
  readonly kind: "FUNCTION";
  readonly lexicalParent: StableKey;
  readonly syntacticRole: string;
  readonly localStructuralFingerprint: LocalStructuralFingerprint;
}

export function createAnonymousEntityIdentity(
  input: AnonymousEntityIdentityInput,
): EntityIdentity {
  const role = input.syntacticRole.trim().normalize("NFC");
  if (role.length === 0) {
    throw new Error("Anonymous entity syntactic role must not be empty");
  }
  return identityFromParts([
    "codeatlas-anonymous-identity-v1",
    input.filePath,
    input.kind,
    input.lexicalParent,
    role,
    input.localStructuralFingerprint,
  ]);
}

