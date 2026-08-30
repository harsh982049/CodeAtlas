import path from "node:path";

import ts from "typescript";

import {
  createCodeEdge,
  createAnonymousEntityIdentity,
  createExternalPackageEntityIdentity,
  createLocalStructuralFingerprint,
  createNamedEntityIdentity,
  InMemoryCodeGraph,
  normalizeExternalPackageSpecifier,
  type CodeEntity,
  type EdgeEvidence,
  type EdgeType,
  type EntityKind,
} from "@codeatlas/codegraph";
import type { JsonObject, NormalizedRelativePath } from "@codeatlas/shared";

import type { AnalysisStats } from "./analysis-stats.js";
import type { AnalyzerDiagnostic } from "./analyzer-diagnostic.js";
import type { AnalyzerInput } from "./analyzer-input.js";
import { assertAnalyzerInput } from "./analyzer-input.js";
import type { AnalyzerResult } from "./analyzer-result.js";
import { fingerprintsFor, normalizedStructuralText } from "./fingerprints.js";
import type { LanguageAnalyzer } from "./language-analyzer.js";
import { buildPrograms, type AnalysisProgram } from "./projects.js";
import { AnalysisDeadline, scanRepository, type RepositoryFile, type RepositoryScan } from "./repository.js";
import { nodeEvidence, nodeLocation } from "./source-locations.js";
import type { UnresolvedRelationship } from "./unresolved-relationship.js";

const ANALYZER_NAME = "codeatlas-typescript-javascript";
const ANALYZER_VERSION = "0.2.0";
const RESOLVER = {
  analyzer: ANALYZER_NAME,
  analyzerVersion: ANALYZER_VERSION,
  resolver: "typescript-compiler-api",
  resolverVersion: ts.version,
} as const;

interface MutableStats {
  filesDiscovered: number;
  filesAnalyzed: number;
  filesSkipped: number;
  filesFailed: number;
  callsResolved: number;
  callsUnresolved: number;
  internalImports: number;
  externalImports: number;
}

interface SourceContext {
  readonly file: RepositoryFile;
  readonly sourceFile: ts.SourceFile;
  readonly analysisProgram: AnalysisProgram;
}

interface WorkspaceModule {
  readonly root: string;
  readonly packageName: string;
  readonly packageFile: RepositoryFile;
  readonly entity: CodeEntity;
}

function absoluteKey(value: string): string {
  return path.resolve(value).toLowerCase();
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function isDirectExport(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function isDefaultExport(node: ts.Node): boolean {
  return isDirectExport(node) && hasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

function fileName(relativePath: NormalizedRelativePath): string {
  return path.posix.basename(relativePath);
}

function entityLocator(filePath: NormalizedRelativePath, kind: EntityKind, qualifiedName: string): string {
  return `${filePath}|${kind}|${qualifiedName}`;
}

function packageIdentity(specifier: string): { ecosystem: "NPM" | "NODE_BUILTIN"; packageName: string } {
  const normalized = normalizeExternalPackageSpecifier(specifier);
  if (normalized === null) throw new Error(`Invalid external package specifier: ${specifier}`);
  return { ecosystem: normalized.ecosystem, packageName: normalized.packageName };
}

function isPascalCase(value: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/u.test(value);
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  function visit(current: ts.Node): void {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function callableKind(name: string, node: ts.Node): "FUNCTION" | "COMPONENT" {
  return isPascalCase(name) && containsJsx(node) ? "COMPONENT" : "FUNCTION";
}

function commonJsExportNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression) && node.left.expression.text === "exports") {
        names.add(node.left.name.text);
      }
      if (
        ts.isPropertyAccessExpression(node.left) && node.left.expression.getText(sourceFile) === "module" &&
        node.left.name.text === "exports" && ts.isObjectLiteralExpression(node.right)
      ) {
        for (const property of node.right.properties) {
          if (ts.isShorthandPropertyAssignment(property)) names.add(property.name.text);
          else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) names.add(property.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

function entireFileEvidence(context: SourceContext): EdgeEvidence {
  return nodeEvidence(context.file.relativePath, context.sourceFile, context.sourceFile, "SYNTAX");
}

class ExtractionContext {
  readonly graph = new InMemoryCodeGraph();
  readonly diagnostics: AnalyzerDiagnostic[];
  readonly unresolvedRelationships: UnresolvedRelationship[] = [];
  readonly stats: MutableStats;
  readonly #repository: RepositoryScan;
  readonly #deadline: AnalysisDeadline;
  readonly #sourceByAbsolute = new Map<string, SourceContext>();
  readonly #sourceByRelative = new Map<NormalizedRelativePath, SourceContext>();
  readonly #entitiesByLocator = new Map<string, CodeEntity>();
  readonly #nodeEntities = new WeakMap<ts.Node, CodeEntity>();
  readonly #fileEntities = new Map<NormalizedRelativePath, CodeEntity>();
  readonly #externalEntities = new Map<string, CodeEntity>();
  readonly #commonJsBindings = new Map<string, CodeEntity>();
  readonly #workspaceModules: WorkspaceModule[] = [];

  constructor(repository: RepositoryScan, programs: readonly AnalysisProgram[], deadline: AnalysisDeadline, diagnostics: AnalyzerDiagnostic[]) {
    this.#repository = repository;
    this.#deadline = deadline;
    this.diagnostics = diagnostics;
    this.stats = {
      filesDiscovered: repository.filesDiscovered,
      filesAnalyzed: 0,
      filesSkipped: repository.filesSkipped,
      filesFailed: 0,
      callsResolved: 0,
      callsUnresolved: 0,
      internalImports: 0,
      externalImports: 0,
    };
    const repositoryByAbsolute = new Map(repository.sourceFiles.map((file) => [absoluteKey(file.absolutePath), file]));
    for (const analysisProgram of programs) {
      for (const sourceFile of analysisProgram.program.getSourceFiles()) {
        const file = repositoryByAbsolute.get(absoluteKey(sourceFile.fileName));
        if (file === undefined || this.#sourceByRelative.has(file.relativePath)) continue;
        const context = { file, sourceFile, analysisProgram };
        this.#sourceByAbsolute.set(absoluteKey(file.absolutePath), context);
        this.#sourceByRelative.set(file.relativePath, context);
      }
    }
  }

  run(): void {
    this.#discoverWorkspaceModules();
    const valid: SourceContext[] = [];
    for (const file of this.#repository.sourceFiles) {
      this.#deadline.check("syntax validation");
      const context = this.#sourceByRelative.get(file.relativePath);
      if (context === undefined) {
        this.stats.filesFailed += 1;
        this.diagnostics.push({ code: "SOURCE_NOT_IN_PROGRAM", severity: "ERROR", message: `No TypeScript program accepted ${file.relativePath}`, location: null });
        continue;
      }
      const syntactic = context.analysisProgram.program.getSyntacticDiagnostics(context.sourceFile);
      if (syntactic.length > 0) {
        this.#recordMalformed(context, syntactic);
        continue;
      }
      valid.push(context);
      this.stats.filesAnalyzed += 1;
      this.#extractEntities(context);
    }
    this.#connectModulesToFiles(valid);
    for (const context of valid) {
      this.#deadline.check("relationship extraction");
      this.#extractRelationships(context);
    }
  }

  result(elapsedMs: number): AnalyzerResult {
    const validation = this.graph.validate();
    if (!validation.valid) throw new Error(`Analyzer produced an invalid graph: ${validation.diagnostics.map((item) => item.message).join("; ")}`);
    const stats: AnalysisStats = {
      ...this.stats,
      entitiesExtracted: this.graph.getEntities().length,
      edgesCreated: this.graph.getEdges().length,
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
    };
    return { graph: this.graph, stats, diagnostics: this.diagnostics, unresolvedRelationships: this.unresolvedRelationships };
  }

  #recordMalformed(context: SourceContext, diagnostics: readonly ts.Diagnostic[]): void {
    this.stats.filesFailed += 1;
    const first = diagnostics[0];
    let location = null;
    if (first?.start !== undefined) {
      const start = context.sourceFile.getLineAndCharacterOfPosition(first.start);
      location = {
        filePath: context.file.relativePath,
        start: { line: start.line + 1, column: start.character + 1 },
        end: { line: start.line + 1, column: start.character + Math.max(1, first.length ?? 1) + 1 },
      };
    }
    this.diagnostics.push({
      code: "TS_PARSE_ERROR",
      severity: "ERROR",
      message: diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("; "),
      location,
    });
    const targetText = /function\s+([A-Za-z_$][\w$]*)/u.exec(context.file.text)?.[1] ?? fileName(context.file.relativePath);
    this.unresolvedRelationships.push({
      source: null,
      intendedEdgeType: "CONTAINS",
      targetText,
      reason: "MALFORMED_SOURCE",
      evidence: nodeLocation(context.file.relativePath, context.sourceFile, context.sourceFile),
      detail: "The source file contains syntax errors, so CodeAtlas did not trust partial declarations from it.",
    });
  }

  #discoverWorkspaceModules(): void {
    for (const project of this.#repository.projectFiles) {
      if (path.basename(project.absolutePath).toLowerCase() !== "package.json" || path.dirname(project.absolutePath) === this.#repository.root) continue;
      try {
        const parsed = JSON.parse(project.text) as { name?: unknown };
        if (typeof parsed.name !== "string" || parsed.name.trim().length === 0) continue;
        const entity = this.#addNamedEntity(project.relativePath, "MODULE", parsed.name, parsed.name, false, false, null, { packageRoot: path.posix.dirname(project.relativePath) });
        this.#workspaceModules.push({ root: path.dirname(project.absolutePath), packageName: parsed.name, packageFile: project, entity });
      } catch {
        this.diagnostics.push({ code: "PACKAGE_JSON_ERROR", severity: "WARNING", message: `Could not parse ${project.relativePath}`, location: null });
      }
    }
    this.#workspaceModules.sort((left, right) => right.root.length - left.root.length);
  }

  #extractEntities(context: SourceContext): void {
    const commonJsExports = commonJsExportNames(context.sourceFile);
    const fileEntity = this.#addNamedEntity(context.file.relativePath, "FILE", context.file.relativePath, fileName(context.file.relativePath), false, false, context.sourceFile);
    this.#fileEntities.set(context.file.relativePath, fileEntity);

    const visitTopLevel = (node: ts.Node, namespacePrefix = ""): void => {
      if (ts.isModuleDeclaration(node) && node.body !== undefined) {
        const prefix = `${namespacePrefix}${node.name.getText(context.sourceFile).replaceAll(/["']/gu, "")}.`;
        if (ts.isModuleBlock(node.body)) for (const statement of node.body.statements) visitTopLevel(statement, prefix);
        else visitTopLevel(node.body, prefix);
        return;
      }
      if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
        const name = node.name.text;
        const kind = callableKind(name, node);
        this.#addDeclaration(context, node, kind, `${namespacePrefix}${name}`, name, isDirectExport(node) || commonJsExports.has(name), isDefaultExport(node), fileEntity, kind === "COMPONENT" ? { react: { probableComponent: true, form: "function" } } : {});
        return;
      }
      if (ts.isClassDeclaration(node) && node.name !== undefined) {
        const name = node.name.text;
        const classEntity = this.#addDeclaration(context, node, "CLASS", `${namespacePrefix}${name}`, name, isDirectExport(node) || commonJsExports.has(name), isDefaultExport(node), fileEntity, containsJsx(node) ? { react: { probableComponent: true, form: "class" } } : {});
        for (const member of node.members) {
          if (ts.isConstructorDeclaration(member)) this.#addDeclaration(context, member, "CONSTRUCTOR", `${namespacePrefix}${name}.constructor`, "constructor", false, false, classEntity, { static: false });
          else if (ts.isMethodDeclaration(member) && member.name !== undefined) {
            const memberName = member.name.getText(context.sourceFile).replaceAll(/["']/gu, "");
            this.#addDeclaration(context, member, "METHOD", `${namespacePrefix}${name}.${memberName}`, memberName, false, false, classEntity, { static: hasModifier(member, ts.SyntaxKind.StaticKeyword) });
          }
        }
        return;
      }
      if (ts.isInterfaceDeclaration(node)) {
        const name = node.name.text;
        const interfaceEntity = this.#addDeclaration(context, node, "INTERFACE", `${namespacePrefix}${name}`, name, isDirectExport(node), false, fileEntity);
        for (const member of node.members) {
          if (ts.isMethodSignature(member)) {
            const memberName = member.name.getText(context.sourceFile).replaceAll(/["']/gu, "");
            this.#addDeclaration(context, member, "METHOD", `${namespacePrefix}${name}.${memberName}`, memberName, false, false, interfaceEntity);
          }
        }
        return;
      }
      if (ts.isTypeAliasDeclaration(node)) {
        this.#addDeclaration(context, node, "TYPE_ALIAS", `${namespacePrefix}${node.name.text}`, node.name.text, isDirectExport(node), false, fileEntity);
        return;
      }
      if (ts.isEnumDeclaration(node)) {
        this.#addDeclaration(context, node, "ENUM", `${namespacePrefix}${node.name.text}`, node.name.text, isDirectExport(node), false, fileEntity);
        return;
      }
      if (ts.isVariableStatement(node)) {
        const exportedStatement = isDirectExport(node);
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
          const name = declaration.name.text;
          const exported = exportedStatement || commonJsExports.has(name);
          if (!exported && !ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer)) continue;
          const kind = ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)
            ? callableKind(name, declaration.initializer)
            : "VARIABLE";
          const entity = this.#addDeclaration(context, declaration, kind, `${namespacePrefix}${name}`, name, exported, isDefaultExport(node), fileEntity, kind === "COMPONENT" ? { react: { probableComponent: true, form: "arrow-or-expression" } } : {});
          this.#nodeEntities.set(declaration.initializer, entity);
        }
        return;
      }
      if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const left = node.expression.left;
        if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression) && left.expression.text === "exports") {
          const name = left.name.text;
          const kind = ts.isArrowFunction(node.expression.right) || ts.isFunctionExpression(node.expression.right) ? callableKind(name, node.expression.right) : "VARIABLE";
          const entity = this.#addDeclaration(context, node.expression, kind, `${namespacePrefix}${name}`, name, true, false, fileEntity);
          this.#nodeEntities.set(node.expression.right, entity);
        }
      }
    };
    for (const statement of context.sourceFile.statements) visitTopLevel(statement);
    this.#extractAnonymousEntities(context);
  }

  #extractAnonymousEntities(context: SourceContext): void {
    const occurrences = new Map<string, number>();
    const visit = (node: ts.Node): void => {
      if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !ts.isVariableDeclaration(node.parent)) {
        const lexicalParent = this.#owner(node);
        if (lexicalParent !== undefined) {
          const baseRole = ts.isCallExpression(node.parent)
            ? `CALL_ARGUMENT:${node.parent.arguments.indexOf(node)}`
            : "ANONYMOUS_FUNCTION";
          const occurrenceKey = `${lexicalParent.stableKey}|${baseRole}`;
          const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
          occurrences.set(occurrenceKey, occurrence);
          const syntacticRole = `${baseRole}#${occurrence}`;
          const structuralText = normalizedStructuralText(node.getText(context.sourceFile), context.sourceFile.languageVariant);
          const identity = createAnonymousEntityIdentity({
            filePath: context.file.relativePath,
            kind: "FUNCTION",
            lexicalParent: lexicalParent.stableKey,
            syntacticRole,
            localStructuralFingerprint: createLocalStructuralFingerprint(structuralText),
          });
          const fingerprints = fingerprintsFor(node, "FUNCTION", false, false);
          const entity: CodeEntity = {
            ...identity,
            kind: "FUNCTION",
            name: "<anonymous>",
            qualifiedName: `${lexicalParent.qualifiedName}.<anonymous:${syntacticRole}>`,
            filePath: context.file.relativePath,
            sourceRange: nodeLocation(context.file.relativePath, context.sourceFile, node),
            exported: false,
            defaultExport: false,
            declarationFingerprint: fingerprints.declaration,
            implementationFingerprint: fingerprints.implementation,
            identityStability: "LOW",
            analyzer: { name: ANALYZER_NAME, version: ANALYZER_VERSION },
            metadata: { lexicalParent: lexicalParent.stableKey, syntacticRole },
          };
          this.graph.addEntity(entity);
          this.#nodeEntities.set(node, entity);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(context.sourceFile);
  }

  #addDeclaration(
    context: SourceContext,
    node: ts.Node,
    kind: EntityKind,
    qualifiedName: string,
    name: string,
    exported: boolean,
    defaultExport: boolean,
    container: CodeEntity,
    metadata: JsonObject = {},
  ): CodeEntity {
    const entity = this.#addNamedEntity(context.file.relativePath, kind, qualifiedName, name, exported, defaultExport, node, metadata);
    this.#nodeEntities.set(node, entity);
    const confidence = kind === "COMPONENT" ? (ts.isVariableDeclaration(node) ? 0.9 : 0.95) : 1;
    this.#addEdge(container, entity, "CONTAINS", confidence, nodeEvidence(context.file.relativePath, context.sourceFile, node, kind === "COMPONENT" ? "HEURISTIC" : "SYNTAX"));
    if (exported && container.kind === "FILE" && this.#isDirectExportOccurrence(node)) {
      this.#addEdge(container, entity, "EXPORTS", 1, nodeEvidence(context.file.relativePath, context.sourceFile, node, "SYNTAX"));
    }
    return entity;
  }

  #isDirectExportOccurrence(node: ts.Node): boolean {
    if (isDirectExport(node)) return true;
    if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent)) {
      return isDirectExport(node.parent.parent);
    }
    return ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) && node.left.expression.text === "exports";
  }

  #addNamedEntity(
    filePath: NormalizedRelativePath,
    kind: EntityKind,
    qualifiedName: string,
    name: string,
    exported: boolean,
    defaultExport: boolean,
    node: ts.Node | null,
    metadata: JsonObject = {},
  ): CodeEntity {
    const locator = entityLocator(filePath, kind, qualifiedName);
    const existing = this.#entitiesByLocator.get(locator);
    if (existing !== undefined) return existing;
    const identity = createNamedEntityIdentity({ filePath, kind, qualifiedName });
    const fingerprints = node === null ? null : fingerprintsFor(node, kind, exported, defaultExport);
    const entity: CodeEntity = {
      ...identity,
      kind,
      name,
      qualifiedName,
      filePath,
      sourceRange: node === null ? null : nodeLocation(filePath, node.getSourceFile(), node),
      exported,
      defaultExport,
      declarationFingerprint: fingerprints?.declaration ?? null,
      implementationFingerprint: fingerprints?.implementation ?? null,
      identityStability: "HIGH",
      analyzer: { name: ANALYZER_NAME, version: ANALYZER_VERSION },
      metadata,
    };
    this.graph.addEntity(entity);
    this.#entitiesByLocator.set(locator, entity);
    return entity;
  }

  #externalEntity(specifier: string): CodeEntity {
    const identityParts = packageIdentity(specifier);
    const cacheKey = `${identityParts.ecosystem}|${identityParts.packageName}`;
    const existing = this.#externalEntities.get(cacheKey);
    if (existing !== undefined) return existing;
    const identity = createExternalPackageEntityIdentity(identityParts.ecosystem, identityParts.packageName);
    const entity: CodeEntity = {
      ...identity,
      kind: "EXTERNAL_PACKAGE",
      name: identityParts.packageName,
      qualifiedName: identityParts.packageName,
      filePath: null,
      sourceRange: null,
      exported: false,
      defaultExport: false,
      declarationFingerprint: null,
      implementationFingerprint: null,
      identityStability: "HIGH",
      analyzer: { name: ANALYZER_NAME, version: ANALYZER_VERSION },
      metadata: { ecosystem: identityParts.ecosystem },
    };
    this.graph.addEntity(entity);
    this.#externalEntities.set(cacheKey, entity);
    return entity;
  }

  #connectModulesToFiles(contexts: readonly SourceContext[]): void {
    for (const context of contexts) {
      const module = this.#owningModule(context.file.absolutePath);
      const file = this.#fileEntities.get(context.file.relativePath);
      if (module !== undefined && file !== undefined) this.#addEdge(module.entity, file, "CONTAINS", 1, entireFileEvidence(context));
    }
  }

  #owningModule(filePathValue: string): WorkspaceModule | undefined {
    return this.#workspaceModules.find((module) => {
      const relative = path.relative(module.root, filePathValue);
      return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
  }

  #extractRelationships(context: SourceContext): void {
    const fileEntity = this.#fileEntities.get(context.file.relativePath);
    if (fileEntity === undefined) return;
    this.#extractImportsAndExports(context, fileEntity);
    const visit = (node: ts.Node): void => {
      this.#deadline.check("AST traversal");
      if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) this.#extractHeritage(context, node);
      if (ts.isNewExpression(node)) this.#extractInstantiation(context, node);
      else if (ts.isCallExpression(node)) this.#extractCall(context, node);
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) this.#extractJsxReference(context, node);
      else if (ts.isIdentifier(node)) this.#extractIdentifierReference(context, node);
      ts.forEachChild(node, visit);
    };
    visit(context.sourceFile);
  }

  #extractImportsAndExports(context: SourceContext, fileEntity: CodeEntity): void {
    for (const statement of context.sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = this.#resolveImport(context, statement.moduleSpecifier.text, statement);
        this.#recordImport(context, fileEntity, target, statement, statement.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(statement)) {
        let targetFile: CodeEntity | null = null;
        if (statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
          const target = this.#resolveImport(context, statement.moduleSpecifier.text, statement);
          this.#recordImport(context, fileEntity, target, statement, statement.moduleSpecifier.text);
          targetFile = target?.kind === "FILE" ? target : null;
        }
        if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            const target = this.#resolveSymbolEntity(context.analysisProgram.checker, element.name) ??
              (element.propertyName === undefined ? null : this.#resolveSymbolEntity(context.analysisProgram.checker, element.propertyName));
            if (target !== null) this.#addEdge(fileEntity, target, "EXPORTS", 1, nodeEvidence(context.file.relativePath, context.sourceFile, statement, "STATIC_RESOLUTION"));
          }
        } else if (targetFile !== null) {
          const reexported = this.graph.outgoingByType(targetFile.stableKey, "EXPORTS")
            .map((edge) => this.graph.getEntity(edge.target))
            .filter((entity) => entity !== undefined);
          const targets = reexported.length > 0 ? reexported : this.#topLevelExportsFromFile(targetFile.filePath);
          for (const target of targets) {
            this.#addEdge(fileEntity, target, "EXPORTS", 1, nodeEvidence(context.file.relativePath, context.sourceFile, statement, "STATIC_RESOLUTION"));
          }
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const initializer = declaration.initializer;
          if (initializer === undefined || !ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression) || initializer.expression.text !== "require") continue;
          const argument = initializer.arguments[0];
          if (argument === undefined || !ts.isStringLiteral(argument)) continue;
          const target = this.#resolveImport(context, argument.text, statement);
          this.#recordImport(context, fileEntity, target, statement, argument.text);
          if (target?.kind === "FILE" && ts.isObjectBindingPattern(declaration.name)) {
            for (const element of declaration.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const importedName = element.propertyName?.getText(context.sourceFile) ?? element.name.text;
              const entity = this.#topLevelExportsFromFile(target.filePath).find((item) => item.name === importedName);
              if (entity !== undefined) this.#commonJsBindings.set(`${context.file.relativePath}|${element.name.text}`, entity);
            }
          }
        }
      } else if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
        this.#extractCommonJsExport(context, fileEntity, statement.expression);
      }
    }
  }

  #extractCommonJsExport(context: SourceContext, fileEntity: CodeEntity, expression: ts.BinaryExpression): void {
    if (expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    if (ts.isPropertyAccessExpression(expression.left) && ts.isIdentifier(expression.left.expression) && expression.left.expression.text === "exports") {
      const target = this.#entitiesByLocator.get(entityLocator(context.file.relativePath, "VARIABLE", expression.left.name.text)) ??
        this.#entitiesByLocator.get(entityLocator(context.file.relativePath, "FUNCTION", expression.left.name.text));
      if (target !== undefined) this.#addEdge(fileEntity, target, "EXPORTS", 1, nodeEvidence(context.file.relativePath, context.sourceFile, expression, "SYNTAX"));
      return;
    }
    if (expression.left.getText(context.sourceFile) !== "module.exports" || !ts.isObjectLiteralExpression(expression.right)) return;
    for (const property of expression.right.properties) {
      const name = ts.isShorthandPropertyAssignment(property) ? property.name.text : ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) ? property.name.text : null;
      if (name === null) continue;
      const target = this.#findAnyTopLevel(context.file.relativePath, name);
      if (target !== undefined) this.#addEdge(fileEntity, target, "EXPORTS", 1, nodeEvidence(context.file.relativePath, context.sourceFile, expression, "SYNTAX"));
    }
  }

  #recordImport(context: SourceContext, source: CodeEntity, target: CodeEntity | null, node: ts.Node, specifier: string): void {
    if (target === null) return;
    const external = target.kind === "EXTERNAL_PACKAGE" ? normalizeExternalPackageSpecifier(specifier) : null;
    const metadata: JsonObject = external === null
      ? { requestedSpecifier: specifier }
      : {
        requestedSpecifier: external.requestedSpecifier,
        subpath: external.subpath,
        builtIn: external.ecosystem === "NODE_BUILTIN",
      };
    this.#addEdge(source, target, "IMPORTS", 1, nodeEvidence(context.file.relativePath, context.sourceFile, node, target.kind === "EXTERNAL_PACKAGE" ? "SYNTAX" : "STATIC_RESOLUTION"), metadata);
    if (target.kind === "EXTERNAL_PACKAGE") this.stats.externalImports += 1;
    else this.stats.internalImports += 1;
    if (target.kind === "FILE") {
      const sourceModule = this.#owningModule(context.file.absolutePath);
      const targetContext = target.filePath === null ? undefined : this.#sourceByRelative.get(target.filePath);
      const targetModule = targetContext === undefined ? undefined : this.#owningModule(targetContext.file.absolutePath);
      if (sourceModule !== undefined && targetModule !== undefined && sourceModule.entity.stableKey !== targetModule.entity.stableKey) {
        this.#addEdge(sourceModule.entity, targetModule.entity, "DEPENDS_ON", 1, nodeEvidence(context.file.relativePath, context.sourceFile, node, "STATIC_RESOLUTION"));
      }
    }
  }

  #resolveImport(context: SourceContext, specifier: string, node: ts.Node): CodeEntity | null {
    const workspace = this.#workspaceModules.find((item) => item.packageName === specifier || specifier.startsWith(`${item.packageName}/`));
    if (workspace !== undefined) {
      const candidates = this.#repository.sourceFiles.filter((file) => this.#owningModule(file.absolutePath)?.entity.stableKey === workspace.entity.stableKey);
      const preferred = candidates.find((file) => /\/src\/index\.[cm]?[jt]sx?$/iu.test(file.absolutePath)) ?? candidates[0];
      return preferred === undefined ? workspace.entity : this.#fileEntities.get(preferred.relativePath) ?? null;
    }
    const resolutionHost: ts.ModuleResolutionHost = {
      fileExists: (fileNameValue) => this.#sourceByAbsolute.has(absoluteKey(fileNameValue)),
      readFile: (fileNameValue) => this.#sourceByAbsolute.get(absoluteKey(fileNameValue))?.file.text,
      realpath: (fileNameValue) => fileNameValue,
    };
    const resolved = ts.resolveModuleName(specifier, context.sourceFile.fileName, context.analysisProgram.options, resolutionHost).resolvedModule;
    if (resolved !== undefined) {
      const targetContext = this.#sourceByAbsolute.get(absoluteKey(resolved.resolvedFileName));
      if (targetContext !== undefined) return this.#fileEntities.get(targetContext.file.relativePath) ?? null;
    }
    if (specifier.startsWith(".")) {
      const base = path.resolve(path.dirname(context.file.absolutePath), specifier);
      const candidates = [base, base.replace(/\.js$/iu, ".ts"), base.replace(/\.js$/iu, ".tsx"), `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.js")];
      for (const candidate of candidates) {
        const targetContext = this.#sourceByAbsolute.get(absoluteKey(candidate));
        if (targetContext !== undefined) return this.#fileEntities.get(targetContext.file.relativePath) ?? null;
      }
      this.unresolvedRelationships.push({ source: this.#owner(node)?.stableKey ?? null, intendedEdgeType: "IMPORTS", targetText: specifier, reason: "OUTSIDE_ANALYSIS_SCOPE", evidence: nodeLocation(context.file.relativePath, context.sourceFile, node), detail: "The relative module could not be resolved to a retained repository source file." });
      return null;
    }
    if (normalizeExternalPackageSpecifier(specifier) !== null) return this.#externalEntity(specifier);
    this.unresolvedRelationships.push({ source: this.#owner(node)?.stableKey ?? null, intendedEdgeType: "IMPORTS", targetText: specifier, reason: "UNSUPPORTED_SYNTAX", evidence: nodeLocation(context.file.relativePath, context.sourceFile, node), detail: "The module specifier is not a supported relative, workspace, npm, or Node built-in specifier." });
    return null;
  }

  #extractHeritage(context: SourceContext, node: ts.ClassDeclaration | ts.InterfaceDeclaration): void {
    const source = this.#nodeEntities.get(node);
    if (source === undefined) return;
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types) {
        const target = this.#resolveSymbolEntity(context.analysisProgram.checker, type.expression);
        if (target === null) continue;
        const edgeType: EdgeType = clause.token === ts.SyntaxKind.ExtendsKeyword ? "EXTENDS" : "IMPLEMENTS";
        this.#addEdge(source, target, edgeType, 1, nodeEvidence(context.file.relativePath, context.sourceFile, type.expression, "STATIC_RESOLUTION"));
      }
    }
  }

  #extractInstantiation(context: SourceContext, node: ts.NewExpression): void {
    const source = this.#owner(node);
    const target = this.#resolveSymbolEntity(context.analysisProgram.checker, node.expression);
    if (source !== undefined && target?.kind === "CLASS") this.#addEdge(source, target, "INSTANTIATES", 1, nodeEvidence(context.file.relativePath, context.sourceFile, node, "STATIC_RESOLUTION"));
  }

  #extractCall(context: SourceContext, node: ts.CallExpression): void {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && !ts.isStringLiteral(argument)) {
        const text = ts.isTemplateExpression(argument)
          ? argument.head.text + argument.templateSpans.map((span) => `\${${span.expression.getText(context.sourceFile)}}${span.literal.text}`).join("")
          : argument.getText(context.sourceFile);
        this.unresolvedRelationships.push({ source: this.#owner(node)?.stableKey ?? null, intendedEdgeType: "IMPORTS", targetText: text, reason: "COMPUTED_SPECIFIER", evidence: nodeLocation(context.file.relativePath, context.sourceFile, node), detail: "Dynamic import specifier is computed at runtime." });
      }
      return;
    }
    if (ts.isIdentifier(node.expression) && node.expression.text === "require") return;
    const source = this.#owner(node);
    if (source === undefined) return;
    let target = this.#resolveSymbolEntity(context.analysisProgram.checker, node.expression);
    if (target === null && ts.isIdentifier(node.expression)) target = this.#commonJsBindings.get(`${context.file.relativePath}|${node.expression.text}`) ?? null;
    if (target !== null && ["FUNCTION", "METHOD", "CONSTRUCTOR", "COMPONENT"].includes(target.kind)) {
      this.#addEdge(source, target, "CALLS", 1, nodeEvidence(context.file.relativePath, context.sourceFile, node, "STATIC_RESOLUTION"));
      this.stats.callsResolved += 1;
    } else if (ts.isPropertyAccessExpression(node.expression)) {
      this.unresolvedRelationships.push({ source: source.stableKey, intendedEdgeType: "POSSIBLE_CALL", targetText: node.expression.getText(context.sourceFile), reason: "DYNAMIC_DISPATCH", evidence: nodeLocation(context.file.relativePath, context.sourceFile, node), detail: "The TypeScript checker could not identify one repository-contained callable target." });
      this.stats.callsUnresolved += 1;
    }
  }

  #extractJsxReference(context: SourceContext, node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): void {
    if (!ts.isIdentifier(node.tagName) || !isPascalCase(node.tagName.text)) return;
    const source = this.#owner(node);
    const target = this.#resolveSymbolEntity(context.analysisProgram.checker, node.tagName);
    if (source !== undefined && target !== null) this.#addEdge(source, target, "REFERENCES", 1, nodeEvidence(context.file.relativePath, context.sourceFile, node.tagName, "STATIC_RESOLUTION"));
  }

  #extractIdentifierReference(context: SourceContext, node: ts.Identifier): void {
    if (this.#skipReference(node)) return;
    const source = this.#owner(node);
    const target = this.#resolveSymbolEntity(context.analysisProgram.checker, node);
    if (source === undefined || target === null || source.stableKey === target.stableKey) return;
    if (target.kind === "EXTERNAL_PACKAGE") return;
    this.#addEdge(source, target, "REFERENCES", 1, nodeEvidence(context.file.relativePath, context.sourceFile, node, "STATIC_RESOLUTION"));
  }

  #skipReference(node: ts.Identifier): boolean {
    let current: ts.Node = node;
    while (current.parent !== undefined) {
      const parent = current.parent;
      if (ts.isImportDeclaration(parent) || ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isExportDeclaration(parent) || ts.isExportSpecifier(parent)) return true;
      if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === current) return true;
      if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) && parent.tagName === current) return true;
      if ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === current) return true;
      if (ts.isPropertyAccessExpression(parent) && parent.name === current) return true;
      if (ts.isTypeNode(parent)) return true;
      if (ts.isStatement(parent) || ts.isSourceFile(parent)) break;
      current = parent;
    }
    return false;
  }

  #resolveSymbolEntity(checker: ts.TypeChecker, node: ts.Node): CodeEntity | null {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol === undefined && ts.isPropertyAccessExpression(node)) symbol = checker.getSymbolAtLocation(node.name);
    if (symbol === undefined) return null;
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      try { symbol = checker.getAliasedSymbol(symbol); } catch { return null; }
    }
    for (const declaration of symbol.declarations ?? []) {
      const entity = this.#entityForDeclaration(declaration);
      if (entity !== undefined) return entity;
    }
    return null;
  }

  #entityForDeclaration(declaration: ts.Declaration): CodeEntity | undefined {
    const direct = this.#nodeEntities.get(declaration);
    if (direct !== undefined) return direct;
    const sourceContext = this.#sourceByAbsolute.get(absoluteKey(declaration.getSourceFile().fileName));
    if (sourceContext === undefined) return undefined;
    const filePath = sourceContext.file.relativePath;
    if (ts.isFunctionDeclaration(declaration) && declaration.name !== undefined) return this.#findCallable(filePath, declaration.name.text);
    if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) return this.#findAnyTopLevel(filePath, declaration.name.text);
    if (ts.isClassDeclaration(declaration) && declaration.name !== undefined) return this.#entitiesByLocator.get(entityLocator(filePath, "CLASS", declaration.name.text));
    if (ts.isInterfaceDeclaration(declaration)) return this.#entitiesByLocator.get(entityLocator(filePath, "INTERFACE", declaration.name.text)) ?? [...this.#entitiesByLocator.values()].find((item) => item.filePath === filePath && item.kind === "INTERFACE" && item.name === declaration.name.text);
    if (ts.isTypeAliasDeclaration(declaration)) return this.#entitiesByLocator.get(entityLocator(filePath, "TYPE_ALIAS", declaration.name.text));
    if (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration)) {
      const parentName = (ts.isClassDeclaration(declaration.parent) || ts.isInterfaceDeclaration(declaration.parent))
        ? declaration.parent.name?.getText(declaration.getSourceFile())
        : undefined;
      const name = declaration.name.getText(declaration.getSourceFile()).replaceAll(/["']/gu, "");
      if (parentName !== undefined) return this.#entitiesByLocator.get(entityLocator(filePath, "METHOD", `${parentName}.${name}`));
    }
    if (ts.isConstructorDeclaration(declaration)) {
      const parentName = declaration.parent.name?.getText(declaration.getSourceFile());
      if (parentName !== undefined) return this.#entitiesByLocator.get(entityLocator(filePath, "CONSTRUCTOR", `${parentName}.constructor`));
    }
    return undefined;
  }

  #findCallable(filePathValue: NormalizedRelativePath, name: string): CodeEntity | undefined {
    return this.#entitiesByLocator.get(entityLocator(filePathValue, "FUNCTION", name)) ?? this.#entitiesByLocator.get(entityLocator(filePathValue, "COMPONENT", name));
  }

  #findAnyTopLevel(filePathValue: NormalizedRelativePath, name: string): CodeEntity | undefined {
    return this.#findCallable(filePathValue, name) ?? this.#entitiesByLocator.get(entityLocator(filePathValue, "VARIABLE", name)) ?? this.#entitiesByLocator.get(entityLocator(filePathValue, "CLASS", name)) ?? this.#entitiesByLocator.get(entityLocator(filePathValue, "INTERFACE", name));
  }

  #topLevelExportsFromFile(filePathValue: NormalizedRelativePath | null): readonly CodeEntity[] {
    if (filePathValue === null) return [];
    return [...this.#entitiesByLocator.values()].filter((entity) => entity.filePath === filePathValue && entity.exported && !entity.qualifiedName.includes("."));
  }

  #owner(node: ts.Node): CodeEntity | undefined {
    let current: ts.Node | undefined = node;
    while (current !== undefined) {
      const mapped = this.#nodeEntities.get(current);
      if (mapped !== undefined) return mapped;
      current = current.parent;
    }
    const context = this.#sourceByAbsolute.get(absoluteKey(node.getSourceFile().fileName));
    return context === undefined ? undefined : this.#fileEntities.get(context.file.relativePath);
  }

  #addEdge(
    source: CodeEntity,
    target: CodeEntity,
    edgeType: EdgeType,
    confidence: number,
    evidence: EdgeEvidence | null,
    metadata: JsonObject = {},
  ): void {
    this.graph.addEdge(createCodeEdge({ source: source.stableKey, target: target.stableKey, edgeType, resolver: RESOLVER, confidence, evidence, metadata }));
  }
}

export class TypeScriptJavaScriptAnalyzer implements LanguageAnalyzer {
  readonly name = ANALYZER_NAME;
  readonly version = ANALYZER_VERSION;

  supports(): boolean {
    return true;
  }

  async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
    assertAnalyzerInput(input);
    const started = performance.now();
    const deadline = new AnalysisDeadline(input.limits.timeoutMilliseconds);
    const repository = await scanRepository(input.repositoryRoot, input.limits, deadline);
    const built = buildPrograms(repository, deadline, input.projectHints);
    const context = new ExtractionContext(repository, built.programs, deadline, [...repository.diagnostics, ...built.diagnostics]);
    context.run();
    return context.result(performance.now() - started);
  }
}

export const typescriptJavaScriptAnalyzer = new TypeScriptJavaScriptAnalyzer();
