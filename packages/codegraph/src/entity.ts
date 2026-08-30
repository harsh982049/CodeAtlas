import type {
  Brand,
  JsonObject,
  NormalizedRelativePath,
  SourceLocation,
} from "@codeatlas/shared";
import { assertJsonObject, assertSourceLocation } from "@codeatlas/shared";

import type {
  DeclarationFingerprint,
  ImplementationFingerprint,
} from "./fingerprint.js";

export type EntityKind =
  | "REPOSITORY"
  | "MODULE"
  | "FILE"
  | "FUNCTION"
  | "METHOD"
  | "CONSTRUCTOR"
  | "CLASS"
  | "INTERFACE"
  | "TYPE_ALIAS"
  | "ENUM"
  | "VARIABLE"
  | "COMPONENT"
  | "API_ROUTE"
  | "TEST"
  | "EXTERNAL_PACKAGE"
  | "UNRESOLVED";

export type IdentityStability = "HIGH" | "MEDIUM" | "LOW";
export type StableKey = Brand<string, "StableKey">;
export type CanonicalEntityIdentity = Brand<string, "CanonicalEntityIdentity">;

export interface AnalyzerProvenance {
  readonly name: string;
  readonly version: string;
}

export interface CodeEntity {
  readonly stableKey: StableKey;
  readonly canonicalIdentity: CanonicalEntityIdentity;
  readonly kind: EntityKind;
  readonly name: string;
  readonly qualifiedName: string;
  readonly filePath: NormalizedRelativePath | null;
  readonly sourceRange: SourceLocation | null;
  readonly exported: boolean;
  readonly defaultExport: boolean;
  readonly declarationFingerprint: DeclarationFingerprint | null;
  readonly implementationFingerprint: ImplementationFingerprint | null;
  readonly identityStability: IdentityStability;
  readonly analyzer: AnalyzerProvenance;
  readonly metadata: Readonly<JsonObject>;
}

export function assertCodeEntity(entity: CodeEntity): void {
  if (entity.name.trim().length === 0 || entity.qualifiedName.trim().length === 0) {
    throw new Error("Entity name and qualified name must not be empty");
  }
  if (entity.analyzer.name.trim().length === 0 || entity.analyzer.version.trim().length === 0) {
    throw new Error("Entity analyzer provenance must be complete");
  }
  if (entity.defaultExport && !entity.exported) {
    throw new Error("A default export must also be exported");
  }
  if (entity.sourceRange !== null) {
    assertSourceLocation(entity.sourceRange);
    if (entity.filePath === null || entity.sourceRange.filePath !== entity.filePath) {
      throw new Error("Entity range must belong to the entity file");
    }
  }
  if (entity.kind === "EXTERNAL_PACKAGE" && entity.sourceRange !== null) {
    throw new Error("External packages cannot have repository source ranges");
  }
  if (!entity.stableKey.startsWith("sk:v1:sha256:")) {
    throw new Error("Invalid stable key format");
  }
  if (entity.declarationFingerprint !== null && !entity.declarationFingerprint.startsWith("df:v1:sha256:")) {
    throw new Error("Invalid declaration fingerprint format");
  }
  if (entity.implementationFingerprint !== null && !entity.implementationFingerprint.startsWith("if:v1:sha256:")) {
    throw new Error("Invalid implementation fingerprint format");
  }
  assertJsonObject(entity.metadata);
}

