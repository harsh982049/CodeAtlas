import { createHash } from "node:crypto";

import type { Brand, JsonValue } from "@codeatlas/shared";
import { isJsonValue } from "@codeatlas/shared";

export type DeclarationFingerprint = Brand<string, "DeclarationFingerprint">;
export type ImplementationFingerprint = Brand<string, "ImplementationFingerprint">;
export type LocalStructuralFingerprint = Brand<string, "LocalStructuralFingerprint">;

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const object = value as Readonly<Record<string, JsonValue>>;
  const fields = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key] as JsonValue)}`);
  return `{${fields.join(",")}}`;
}

export function canonicalSerialize(value: unknown): string {
  if (!isJsonValue(value)) {
    throw new TypeError("Canonical serialization accepts only JSON-safe values");
  }
  return canonicalize(value);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface TypeParameterShape {
  readonly name: string;
  readonly constraint: string | null;
  readonly defaultType: string | null;
}

export interface ParameterShape {
  readonly name: string;
  readonly type: string | null;
  readonly optional: boolean;
  readonly rest: boolean;
  readonly readonly: boolean;
}

export interface HeritageShape {
  readonly relation: "EXTENDS" | "IMPLEMENTS";
  readonly target: string;
  readonly typeArguments: readonly string[];
}

export interface CallableDeclarationShape {
  readonly typeParameters: readonly TypeParameterShape[];
  readonly parameters: readonly ParameterShape[];
  readonly returnType: string | null;
}

export interface DeclarationFingerprintInput {
  readonly schemaVersion: 1;
  readonly kind: string;
  readonly exported: boolean;
  readonly defaultExport: boolean;
  readonly visibility: "PUBLIC" | "PROTECTED" | "PRIVATE" | "PACKAGE" | null;
  readonly modifiers: readonly string[];
  readonly typeParameters: readonly TypeParameterShape[];
  readonly parameters: readonly ParameterShape[];
  readonly returnType: string | null;
  readonly heritage: readonly HeritageShape[];
  readonly overloads: readonly CallableDeclarationShape[];
  readonly normalizedDeclarationText: string | null;
}

function normalizeText(value: string): string {
  return value.normalize("NFC").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function normalizeNullableText(value: string | null): string | null {
  return value === null ? null : normalizeText(value);
}

export function createDeclarationFingerprint(
  input: DeclarationFingerprintInput,
): DeclarationFingerprint {
  if (input.schemaVersion !== 1) {
    throw new Error("Unsupported declaration fingerprint schema version");
  }
  if (input.defaultExport && !input.exported) {
    throw new Error("A default export must also be exported");
  }

  const normalized: JsonValue = {
    schemaVersion: input.schemaVersion,
    kind: input.kind,
    exported: input.exported,
    defaultExport: input.defaultExport,
    visibility: input.visibility,
    modifiers: [...input.modifiers].map(normalizeText).sort(),
    typeParameters: input.typeParameters.map((item) => ({
      name: normalizeText(item.name),
      constraint: normalizeNullableText(item.constraint),
      defaultType: normalizeNullableText(item.defaultType),
    })),
    parameters: input.parameters.map((item) => ({
      name: normalizeText(item.name),
      type: normalizeNullableText(item.type),
      optional: item.optional,
      rest: item.rest,
      readonly: item.readonly,
    })),
    returnType: normalizeNullableText(input.returnType),
    heritage: input.heritage.map((item) => ({
      relation: item.relation,
      target: normalizeText(item.target),
      typeArguments: item.typeArguments.map(normalizeText),
    })),
    overloads: input.overloads.map((overload) => ({
      typeParameters: overload.typeParameters.map((item) => ({
        name: normalizeText(item.name),
        constraint: normalizeNullableText(item.constraint),
        defaultType: normalizeNullableText(item.defaultType),
      })),
      parameters: overload.parameters.map((item) => ({
        name: normalizeText(item.name),
        type: normalizeNullableText(item.type),
        optional: item.optional,
        rest: item.rest,
        readonly: item.readonly,
      })),
      returnType: normalizeNullableText(overload.returnType),
    })),
    normalizedDeclarationText: normalizeNullableText(input.normalizedDeclarationText),
  };

  return `df:v1:sha256:${sha256Hex(canonicalSerialize(normalized))}` as DeclarationFingerprint;
}

export interface ImplementationFingerprintInput {
  readonly schemaVersion: 1;
  readonly kind: string;
  readonly normalizationVersion: string;
  readonly normalizedBody: string;
}

export function createImplementationFingerprint(
  input: ImplementationFingerprintInput,
): ImplementationFingerprint {
  if (input.schemaVersion !== 1) {
    throw new Error("Unsupported implementation fingerprint schema version");
  }
  if (input.normalizationVersion.trim().length === 0) {
    throw new Error("Implementation normalization version must not be empty");
  }

  const normalized: JsonValue = {
    schemaVersion: input.schemaVersion,
    kind: input.kind,
    normalizationVersion: input.normalizationVersion.normalize("NFC"),
    normalizedBody: normalizeText(input.normalizedBody),
  };

  return `if:v1:sha256:${sha256Hex(canonicalSerialize(normalized))}` as ImplementationFingerprint;
}

export function createLocalStructuralFingerprint(value: string): LocalStructuralFingerprint {
  return `lf:v1:sha256:${sha256Hex(normalizeText(value))}` as LocalStructuralFingerprint;
}
