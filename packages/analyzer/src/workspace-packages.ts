import path from "node:path";

import type { AnalyzerDiagnostic } from "./analyzer-diagnostic.js";
import type { RepositoryFile, RepositoryScan } from "./repository.js";

interface PackageJsonData {
  readonly name?: unknown;
  readonly exports?: unknown;
  readonly types?: unknown;
  readonly typings?: unknown;
  readonly source?: unknown;
  readonly module?: unknown;
  readonly main?: unknown;
}

export interface WorkspacePackageDescriptor {
  readonly root: string;
  readonly packageName: string;
  readonly packageFile: RepositoryFile;
  readonly packageJson: PackageJsonData;
}

function key(value: string): string {
  return path.resolve(value).toLowerCase();
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function diagnostic(code: string, message: string): AnalyzerDiagnostic {
  return { code, severity: "WARNING", message, location: null };
}

export function discoverWorkspacePackages(
  repository: RepositoryScan,
  diagnostics: AnalyzerDiagnostic[],
): readonly WorkspacePackageDescriptor[] {
  const discovered: WorkspacePackageDescriptor[] = [];
  const packageFiles = repository.projectFiles.filter((file) => path.basename(file.absolutePath).toLowerCase() === "package.json");
  const nestedPackageFiles = packageFiles.filter((file) => path.dirname(file.absolutePath) !== repository.root);
  for (const packageFile of packageFiles) {
    if (path.dirname(packageFile.absolutePath) === repository.root && nestedPackageFiles.length > 0) continue;
    try {
      const packageJson = JSON.parse(packageFile.text) as PackageJsonData;
      if (typeof packageJson.name !== "string" || packageJson.name.trim().length === 0) continue;
      discovered.push({
        root: path.dirname(packageFile.absolutePath),
        packageName: packageJson.name,
        packageFile,
        packageJson,
      });
    } catch {
      diagnostics.push(diagnostic("PACKAGE_JSON_ERROR", `Could not parse ${packageFile.relativePath}`));
    }
  }
  return discovered.sort((left, right) => right.root.length - left.root.length || left.packageName.localeCompare(right.packageName));
}

function conditionalTarget(value: unknown, conditions: readonly string[]): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const selected = conditionalTarget(candidate, conditions);
      if (selected !== null) return selected;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const values = value as Record<string, unknown>;
  for (const condition of conditions) {
    if (condition in values) {
      const selected = conditionalTarget(values[condition], conditions);
      if (selected !== null) return selected;
    }
  }
  return null;
}

function exportTarget(exportsValue: unknown, subpath: string, conditions: readonly string[]): string | null {
  if (typeof exportsValue === "string" || Array.isArray(exportsValue)) {
    return subpath.length === 0 ? conditionalTarget(exportsValue, conditions) : null;
  }
  if (exportsValue === null || typeof exportsValue !== "object") return null;
  const exportsMap = exportsValue as Record<string, unknown>;
  if (!Object.keys(exportsMap).some((item) => item.startsWith("."))) {
    return subpath.length === 0 ? conditionalTarget(exportsMap, conditions) : null;
  }
  const request = subpath.length === 0 ? "." : `./${subpath}`;
  if (request in exportsMap) return conditionalTarget(exportsMap[request], conditions);
  const wildcardKeys = Object.keys(exportsMap)
    .filter((item) => item.includes("*"))
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  for (const wildcardKey of wildcardKeys) {
    const [prefix = "", suffix = ""] = wildcardKey.split("*", 2);
    if (!request.startsWith(prefix) || !request.endsWith(suffix)) continue;
    const wildcard = request.slice(prefix.length, request.length - suffix.length);
    const selected = conditionalTarget(exportsMap[wildcardKey], conditions);
    if (selected !== null) return selected.replaceAll("*", wildcard);
  }
  return null;
}

function entryTarget(descriptor: WorkspacePackageDescriptor, subpath: string, importKind: "IMPORT" | "REQUIRE"): string | null {
  const conditions = importKind === "REQUIRE"
    ? ["types", "node", "require", "default"]
    : ["types", "node", "import", "default"];
  if (descriptor.packageJson.exports !== undefined) {
    return exportTarget(descriptor.packageJson.exports, subpath, conditions);
  }
  if (subpath.length > 0) return `./${subpath}`;
  for (const field of ["types", "typings", "source", "module", "main"] as const) {
    const value = descriptor.packageJson[field];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return "./src/index";
}

function sourceCandidates(absoluteTarget: string): readonly string[] {
  const extension = path.extname(absoluteTarget).toLowerCase();
  const candidates = [absoluteTarget];
  if (extension === ".js") candidates.push(absoluteTarget.slice(0, -3) + ".ts", absoluteTarget.slice(0, -3) + ".tsx", absoluteTarget.slice(0, -3) + ".d.ts");
  else if (extension === ".mjs") candidates.push(absoluteTarget.slice(0, -4) + ".mts", absoluteTarget.slice(0, -4) + ".d.mts");
  else if (extension === ".cjs") candidates.push(absoluteTarget.slice(0, -4) + ".cts", absoluteTarget.slice(0, -4) + ".d.cts");
  else if (extension.length === 0) {
    for (const candidateExtension of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"]) {
      candidates.push(`${absoluteTarget}${candidateExtension}`);
    }
    for (const candidateName of ["index.ts", "index.tsx", "index.mts", "index.cts", "index.js", "index.jsx"]) {
      candidates.push(path.join(absoluteTarget, candidateName));
    }
  }
  return candidates;
}

function workspaceSourceCandidates(descriptor: WorkspacePackageDescriptor, absoluteTarget: string): readonly string[] {
  const candidates = [...sourceCandidates(absoluteTarget)];
  const relativeTarget = path.relative(descriptor.root, absoluteTarget);
  const [outputDirectory, ...remainingSegments] = relativeTarget.split(path.sep);
  if (["build", "dist", "lib"].includes(outputDirectory?.toLowerCase() ?? "") && remainingSegments.length > 0) {
    candidates.push(...sourceCandidates(path.resolve(descriptor.root, "src", ...remainingSegments)));
  }
  return candidates;
}

export function resolveWorkspacePackageSource(
  descriptor: WorkspacePackageDescriptor,
  specifier: string,
  importKind: "IMPORT" | "REQUIRE",
  repository: RepositoryScan,
): RepositoryFile | null {
  const subpath = specifier === descriptor.packageName ? "" : specifier.slice(descriptor.packageName.length + 1);
  const target = entryTarget(descriptor, subpath, importKind);
  if (target === null || !target.startsWith("./")) return null;
  const absoluteTarget = path.resolve(descriptor.root, target);
  if (!inside(descriptor.root, absoluteTarget)) return null;
  const files = new Map(repository.sourceFiles.map((file) => [key(file.absolutePath), file]));
  for (const candidate of workspaceSourceCandidates(descriptor, absoluteTarget)) {
    const file = files.get(key(candidate));
    if (file !== undefined) return file;
  }
  return null;
}
