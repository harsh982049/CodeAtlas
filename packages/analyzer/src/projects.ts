import path from "node:path";

import ts from "typescript";

import type { NormalizedRelativePath } from "@codeatlas/shared";

import type { AnalyzerDiagnostic } from "./analyzer-diagnostic.js";
import type { AnalysisDeadline, RepositoryFile, RepositoryScan } from "./repository.js";

export interface AnalysisProgram {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly options: ts.CompilerOptions;
  readonly configPath: string | null;
}

export interface ProgramBuildResult {
  readonly programs: readonly AnalysisProgram[];
  readonly diagnostics: readonly AnalyzerDiagnostic[];
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
  const included = new Set<string>();
  const host = configHost(repository);

  for (const config of configFiles) {
    deadline.check("TypeScript project construction");
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
    const rootNames = parsed.fileNames.filter((fileName) => repository.sourceFiles.some((file) => key(file.absolutePath) === key(fileName)));
    if (rootNames.length === 0) continue;
    const options = forcedOptions(parsed.options);
    const program = ts.createProgram({ rootNames, options, host: compilerHost(options, repository) });
    programs.push({ program, checker: program.getTypeChecker(), options, configPath: config.absolutePath });
    for (const fileName of rootNames) included.add(key(fileName));
  }

  const uncovered = repository.sourceFiles.filter((file) => !included.has(key(file.absolutePath))).map((file) => file.absolutePath);
  if (programs.length === 0 || uncovered.length > 0) {
    deadline.check("inferred TypeScript project construction");
    const options = inferredOptions();
    const rootNames = programs.length === 0 ? repository.sourceFiles.map((file) => file.absolutePath) : uncovered;
    if (rootNames.length > 0) {
      const program = ts.createProgram({ rootNames, options, host: compilerHost(options, repository) });
      programs.push({ program, checker: program.getTypeChecker(), options, configPath: null });
    }
  }
  return { programs, diagnostics };
}
