import ts from "typescript";

import {
  createDeclarationFingerprint,
  createImplementationFingerprint,
  type DeclarationFingerprint,
  type ImplementationFingerprint,
} from "@codeatlas/codegraph";

export function normalizedStructuralText(text: string, languageVariant: ts.LanguageVariant): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, languageVariant, text);
  const tokens: string[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    tokens.push(scanner.getTokenText());
  }
  return tokens.join(" ").normalize("NFC");
}

function bodyOf(node: ts.Node): ts.Node | null {
  if (
    ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
    ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) return node.body ?? null;
  if (ts.isVariableDeclaration(node) && node.initializer !== undefined) return node.initializer;
  return null;
}

function memberDeclarationText(member: ts.ClassElement, sourceFile: ts.SourceFile): string {
  if (
    ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)
  ) {
    return sourceFile.text.slice(member.getStart(sourceFile), member.body?.getStart(sourceFile) ?? member.getEnd());
  }
  if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) {
    return sourceFile.text.slice(member.getStart(sourceFile), member.initializer.getStart(sourceFile));
  }
  return member.getText(sourceFile);
}

function declarationText(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    const firstMember = node.members[0];
    const headerEnd = firstMember?.getStart(sourceFile) ?? node.getEnd() - 1;
    return `${sourceFile.text.slice(node.getStart(sourceFile), headerEnd)}${node.members.map((member) => memberDeclarationText(member, sourceFile)).join(";")}}`;
  }
  const body = bodyOf(node);
  const declarationEnd = body === null ? node.getEnd() : body.getStart(sourceFile);
  return sourceFile.text.slice(node.getStart(sourceFile), declarationEnd);
}

function implementationText(node: ts.Node, sourceFile: ts.SourceFile): string | null {
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    const implementations = node.members.flatMap((member) => {
      if (
        ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)
      ) return member.body === undefined ? [] : [member.body.getText(sourceFile)];
      if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) return [member.initializer.getText(sourceFile)];
      return [];
    });
    return implementations.length === 0 ? null : implementations.join(";");
  }
  const body = bodyOf(node);
  return body?.getText(sourceFile) ?? null;
}

export function fingerprintsFor(
  node: ts.Node,
  kind: string,
  exported: boolean,
  defaultExport: boolean,
): { declaration: DeclarationFingerprint; implementation: ImplementationFingerprint | null } {
  const sourceFile = node.getSourceFile();
  const implementationMaterial = implementationText(node, sourceFile);
  const declaration = createDeclarationFingerprint({
    schemaVersion: 1,
    kind,
    exported,
    defaultExport,
    visibility: null,
    modifiers: [],
    typeParameters: [],
    parameters: [],
    returnType: null,
    heritage: [],
    overloads: [],
    normalizedDeclarationText: normalizedStructuralText(declarationText(node, sourceFile), sourceFile.languageVariant),
  });
  const implementation = implementationMaterial === null
    ? null
    : createImplementationFingerprint({
      schemaVersion: 1,
      kind,
      normalizationVersion: "typescript-token-v1",
      normalizedBody: normalizedStructuralText(implementationMaterial, sourceFile.languageVariant),
    });
  return { declaration, implementation };
}
