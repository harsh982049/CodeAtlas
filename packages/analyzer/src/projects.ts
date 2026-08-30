import path from "node:path";
import { performance } from "node:perf_hooks";

import ts from "typescript";

import type { NormalizedRelativePath } from "@codeatlas/shared";

import type { AnalyzerDiagnostic } from "./analyzer-diagnostic.js";
import type { AnalysisDeadline, RepositoryFile, RepositoryScan } from "./repository.js";

export interface AnalysisProgram {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly options: ts.CompilerOptions;
  readonly configPath: string | null;
  readonly rootFileNames: ReadonlySet<string>;
}

export interface ProgramBuildResult {
  readonly programs: readonly AnalysisProgram[];
  readonly diagnostics: readonly AnalyzerDiagnostic[];
  readonly configurationParsingMs: number;
  readonly programConstructionMs: number;
}

interface ParsedProject {
  readonly config: RepositoryFile;
  readonly parsed: ts.ParsedCommandLine;
  readonly explicitFileSet: boolean;
}

function key(value: string): string {
  return path.resolve(value).toLowerCase();
}

function scriptKind(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function compilerHost(
  options: ts.CompilerOptions,
  repository: RepositoryScan,
): ts.CompilerHost {
  const base = ts.createCompilerHost(options, true);
  const repositoryFiles = new Map<string, RepositoryFile>([
    ...repository.sourceFiles,
    ...repository.projectFiles,
  ].map((file) => [key(file.absolutePath), file]));
  const defaultLibraryDirectory = path.dirname(ts.getDefaultLibFilePath(options));

  function allowed(fileName: string): boolean {
    const resolved = path.resolve(fileName);
    return repositoryFiles.has(key(resolved)) || (
      resolved.startsWith(`${defaultLibraryDirectory}${path.sep}`) && !resolved.includes(`${path.sep}node_modules${path.sep}@types${path.sep}`)
    );
  }

  return {
    ...base,
    fileExists: (fileName) => allowed(fileName) && (repositoryFiles.has(key(fileName)) || base.fileExists(fileName)),
    readFile: (fileName) => repositoryFiles.get(key(fileName))?.text ?? (allowed(fileName) ? base.readFile(fileName) : undefined),
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      const repositoryFile = repositoryFiles.get(key(fileName));
      if (repositoryFile !== undefined) {
        return ts.createSourceFile(fileName, repositoryFile.text, languageVersion, true, scriptKind(fileName));
      }
      return allowed(fileName) ? base.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) : undefined;
    },
    realpath: (fileName) => repositoryFiles.get(key(fileName))?.absolutePath ?? fileName,
  };
}

function forcedOptions(options: ts.CompilerOptions): ts.CompilerOptions {
  return {
    ...options,
    allowJs: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    typeRoots: [],
  };
}

function inferredOptions(): ts.CompilerOptions {
  return forcedOptions({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    checkJs: false,
  });
}

function configHost(repository: RepositoryScan): ts.ParseConfigHost {
  const sources = repository.sourceFiles.map((file) => file.absolutePath);
  const projects = new Map(repository.projectFiles.map((file) => [key(file.absolutePath), file.text]));
  return {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists: (fileName) => projects.has(key(fileName)),
    readFile: (fileName) => projects.get(key(fileName)),
    readDirectory: (rootDir, extensions) => sources.filter((fileName) => {
      const relative = path.relative(rootDir, fileName);
      return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative) &&
        (extensions === undefined || extensions.some((extension) => fileName.endsWith(extension)));
    }),
  };
}

export function buildPrograms(
  repository: RepositoryScan,
  deadline: AnalysisDeadline,
  projectHints: readonly NormalizedRelativePath[] = [],
): ProgramBuildResult {
  const parsingStarted = performance.now();
  const diagnostics: AnalyzerDiagnostic[] = [];
  const programs: AnalysisProgram[] = [];
  const hintSet = new Set(projectHints);
  const configFiles = repository.projectFiles
    .filter((file) => /(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$/u.test(file.relativePath))
    .sort((left, right) => Number(hintSet.has(right.relativePath)) - Number(hintSet.has(left.relativePath)) || left.relativePath.localeCompare(right.relativePath));
  for (const hint of projectHints) {
    if (!configFiles.some((file) => file.relativePath === hint)) {
      diagnostics.push({ code: "PROJECT_HINT_NOT_FOUND", severity: "WARNING", message: `Project hint was not discovered: ${hint}`, location: null });
    }
  }
  const host = configHost(repository);
  const parsedProjects: ParsedProject[] = [];

  for (const config of configFiles) {
    deadline.check("TypeScript configuration parsing");
    const read = ts.readConfigFile(config.absolutePath, (fileName) => {
      const match = repository.projectFiles.find((file) => key(file.absolutePath) === key(fileName));
      return match?.text;
    });
    if (read.error !== undefined) {
      diagnostics.push({ code: "TSCONFIG_ERROR", severity: "WARNING", message: ts.flattenDiagnosticMessageText(read.error.messageText, "\n"), location: null });
      continue;
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, host, path.dirname(config.absolutePath), undefined, config.absolutePath);
    for (const error of parsed.errors) {
      diagnostics.push({ code: "TSCONFIG_ERROR", severity: "WARNING", message: ts.flattenDiagnosticMessageText(error.messageText, "\n"), location: null });
    }
    const rawConfig = read.config as { files?: unknown; include?: unknown };
    parsedProjects.push({ config, parsed, explicitFileSet: rawConfig.files !== undefined || rawConfig.include !== undefined });
  }

  const configurationParsingMs = Math.max(0, Math.round(performance.now() - parsingStarted));
  const byConfig = new Map(parsedProjects.map((project) => [key(project.config.absolutePath), project]));
  const ordered: ParsedProject[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function referencedConfigPath(referencePath: string): string {
    return /\.json$/iu.test(referencePath) ? referencePath : path.join(referencePath, "tsconfig.json");
  }

  function visitProject(project: ParsedProject): void {
    const projectKey = key(project.config.absolutePath);
    if (visited.has(projectKey)) return;
    if (visiting.has(projectKey)) {
      diagnostics.push({ code: "PROJECT_REFERENCE_CYCLE", severity: "WARNING", message: `Project-reference cycle includes ${project.config.relativePath}`, location: null });
      return;
    }
    visiting.add(projectKey);
    for (const reference of project.parsed.projectReferences ?? []) {
      const referencePath = referencedConfigPath(reference.path);
      const referenced = byConfig.get(key(referencePath));
      if (referenced === undefined) {
        diagnostics.push({ code: "PROJECT_REFERENCE_NOT_FOUND", severity: "WARNING", message: `${project.config.relativePath} references unavailable project ${path.relative(repository.root, referencePath).replaceAll("\\", "/")}`, location: null });
      } else {
        visitProject(referenced);
      }
    }
    visiting.delete(projectKey);
    visited.add(projectKey);
    ordered.push(project);
  }

  for (const project of parsedProjects) visitProject(project);

  const constructionStarted = performance.now();
  const included = new Set<string>();
  const sourceOwners = new Map<string, { readonly configPath: string; readonly explicitRoot: boolean }>();
  for (const project of ordered) {
    deadline.check("TypeScript project construction");
    const rootNames = project.parsed.fileNames.filter((fileName) => repository.sourceFiles.some((file) => key(file.absolutePath) === key(fileName)));
    if (rootNames.length === 0) continue;
    const rootNameKeys = new Set(rootNames.map(key));
    const options = forcedOptions(project.parsed.options);
    const program = ts.createProgram({
      rootNames,
      options,
      ...(project.parsed.projectReferences === undefined ? {} : { projectReferences: project.parsed.projectReferences }),
      host: compilerHost(options, repository),
    });
    programs.push({ program, checker: program.getTypeChecker(), options, configPath: project.config.absolutePath, rootFileNames: new Set(rootNames.map(key)) });
    for (const sourceFile of program.getSourceFiles()) {
      const sourceKey = key(sourceFile.fileName);
      if (!repository.sourceFiles.some((file) => key(file.absolutePath) === sourceKey)) continue;
      included.add(sourceKey);
      const previousOwner = sourceOwners.get(sourceKey);
      const explicitRoot = project.explicitFileSet && rootNameKeys.has(sourceKey);
      if (previousOwner !== undefined && previousOwner.configPath !== project.config.relativePath && previousOwner.explicitRoot && explicitRoot) {
        diagnostics.push({ code: "SOURCE_IN_MULTIPLE_PROJECTS", severity: "INFO", message: `${path.relative(repository.root, sourceFile.fileName).replaceAll("\\", "/")} belongs to both ${previousOwner.configPath} and ${project.config.relativePath}; the first deterministic semantic context is used`, location: null });
      } else if (previousOwner === undefined || (!previousOwner.explicitRoot && explicitRoot)) {
        sourceOwners.set(sourceKey, { configPath: project.config.relativePath, explicitRoot });
      }
    }
  }

  const uncovered = repository.sourceFiles.filter((file) => !included.has(key(file.absolutePath))).map((file) => file.absolutePath);
  if (programs.length === 0 || uncovered.length > 0) {
    deadline.check("inferred TypeScript project construction");
    const options = inferredOptions();
    const rootNames = programs.length === 0 ? repository.sourceFiles.map((file) => file.absolutePath) : uncovered;
    if (rootNames.length > 0) {
      const program = ts.createProgram({ rootNames, options, host: compilerHost(options, repository) });
      programs.push({ program, checker: program.getTypeChecker(), options, configPath: null, rootFileNames: new Set(rootNames.map(key)) });
    }
  }
  return {
    programs,
    diagnostics,
    configurationParsingMs,
    programConstructionMs: Math.max(0, Math.round(performance.now() - constructionStarted)),
  };
}
