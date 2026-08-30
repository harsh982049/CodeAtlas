import ts from "typescript";

import { describe, expect, it } from "vitest";

import { fingerprintsFor, fingerprintsForDeclarations } from "../src/fingerprints.js";

function firstClass(text: string): ts.ClassDeclaration {
  const source = ts.createSourceFile("example.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = source.statements.find(ts.isClassDeclaration);
  if (declaration === undefined) throw new Error("Expected a class declaration");
  return declaration;
}

describe("analyzer fingerprints", () => {
  it("separates class public shape from method implementation", () => {
    const original = fingerprintsFor(firstClass("export class Box { value(): number { return 1; } }"), "CLASS", true, false);
    const bodyChange = fingerprintsFor(firstClass("export class Box { value(): number { return 2; } }"), "CLASS", true, false);
    const signatureChange = fingerprintsFor(firstClass("export class Box { value(): string { return '2'; } }"), "CLASS", true, false);
    expect(bodyChange.declaration).toBe(original.declaration);
    expect(bodyChange.implementation).not.toBe(original.implementation);
    expect(signatureChange.declaration).not.toBe(original.declaration);
  });

  it("ignores callable whitespace and comments", () => {
    const compact = ts.createSourceFile("a.ts", "export function f(a:number){return a+1;}", ts.ScriptTarget.Latest, true).statements[0];
    const formatted = ts.createSourceFile("b.ts", "export function f(a: number) { /* note */ return a + 1; }", ts.ScriptTarget.Latest, true).statements[0];
    expect(compact).toBeDefined();
    expect(formatted).toBeDefined();
    expect(fingerprintsFor(compact as ts.Statement, "FUNCTION", true, false)).toEqual(
      fingerprintsFor(formatted as ts.Statement, "FUNCTION", true, false),
    );
  });

  it("aggregates overload declarations separately from the implementation body", () => {
    const source = ts.createSourceFile("overloads.ts", [
      "export function parse(value: string): string;",
      "export function parse(value: number): number;",
      "export function parse(value: string | number) { return value; }",
    ].join("\n"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declarations = source.statements.filter(ts.isFunctionDeclaration);
    const original = fingerprintsForDeclarations(declarations, "FUNCTION", true, false);
    const changedBodySource = ts.createSourceFile("overloads.ts", [
      "export function parse(value: string): string;",
      "export function parse(value: number): number;",
      "export function parse(value: string | number) { return String(value); }",
    ].join("\n"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const changedBody = fingerprintsForDeclarations(changedBodySource.statements.filter(ts.isFunctionDeclaration), "FUNCTION", true, false);
    expect(changedBody.declaration).toBe(original.declaration);
    expect(changedBody.implementation).not.toBe(original.implementation);
  });
});
