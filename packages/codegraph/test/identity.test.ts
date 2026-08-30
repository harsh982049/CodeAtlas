import { describe, expect, it } from "vitest";

import {
  createDeclarationFingerprint,
  createImplementationFingerprint,
  createNamedEntityIdentity,
} from "../src/index.js";

const declarationBase = {
  schemaVersion: 1 as const,
  kind: "FUNCTION",
  exported: true,
  defaultExport: false,
  visibility: "PUBLIC" as const,
  modifiers: ["export"],
  typeParameters: [],
  parameters: [{ name: "id", type: "string", optional: false, rest: false, readonly: false }],
  returnType: "Promise<Payment>",
  heritage: [],
  overloads: [],
  normalizedDeclarationText: null,
};

describe("entity identity and fingerprints", () => {
  it("keeps callable identity stable when its signature changes", () => {
    const before = createNamedEntityIdentity({
      filePath: "src/payments.ts",
      kind: "FUNCTION",
      qualifiedName: "createPayment",
    });
    const after = createNamedEntityIdentity({
      filePath: "src/payments.ts",
      kind: "FUNCTION",
      qualifiedName: "createPayment",
    });
    const oldDeclaration = createDeclarationFingerprint(declarationBase);
    const newDeclaration = createDeclarationFingerprint({
      ...declarationBase,
      parameters: [...declarationBase.parameters, {
        name: "currency",
        type: "string",
        optional: false,
        rest: false,
        readonly: false,
      }],
    });

    expect(after.stableKey).toBe(before.stableKey);
    expect(newDeclaration).not.toBe(oldDeclaration);
  });

  it("normalizes separators and excludes machine-specific repository roots", () => {
    const windows = createNamedEntityIdentity({
      repositoryRoot: "C:\\work\\repo",
      filePath: "C:\\work\\repo\\src\\payments.ts",
      kind: "FUNCTION",
      qualifiedName: "charge",
    });
    const otherMachine = createNamedEntityIdentity({
      repositoryRoot: "/srv/repo",
      filePath: "/srv/repo/src/payments.ts",
      kind: "FUNCTION",
      qualifiedName: "charge",
    });
    const renamed = createNamedEntityIdentity({
      filePath: "src/payments.ts",
      kind: "FUNCTION",
      qualifiedName: "collectPayment",
    });

    expect(windows.stableKey).toBe(otherMachine.stableKey);
    expect(renamed.stableKey).not.toBe(windows.stableKey);
  });

  it("distinguishes declaration and implementation changes", () => {
    const declaration = createDeclarationFingerprint(declarationBase);
    const bodyA = createImplementationFingerprint({
      schemaVersion: 1,
      kind: "FUNCTION",
      normalizationVersion: "tokens-v1",
      normalizedBody: "return gateway.charge(id);",
    });
    const bodyB = createImplementationFingerprint({
      schemaVersion: 1,
      kind: "FUNCTION",
      normalizationVersion: "tokens-v1",
      normalizedBody: "return gateway.refund(id);",
    });

    expect(declaration).toMatch(/^df:v1:sha256:/);
    expect(bodyA).not.toBe(bodyB);
  });
});
