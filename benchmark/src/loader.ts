import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { FixtureManifest, GoldenGraph } from "./schema.js";
import { parseFixtureManifest, parseGoldenGraph } from "./validation.js";

export interface LoadedFixture {
  readonly directory: string;
  readonly manifest: FixtureManifest;
  readonly golden: GoldenGraph;
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function loadFixture(directory: string): Promise<LoadedFixture> {
  const manifest = parseFixtureManifest(await json(path.join(directory, "fixture.json")));
  const goldenPath = path.resolve(directory, manifest.goldenFile);
  if (!inside(directory, goldenPath)) throw new Error("Golden path must remain inside its fixture");
  const golden = parseGoldenGraph(await json(goldenPath));
  if (golden.fixture !== manifest.name) throw new Error("Fixture and golden names must match");
  const referenced = [...manifest.projectFiles, ...manifest.sourceFiles];
  for (const relative of referenced) {
    const filePath = path.resolve(directory, relative);
    if (!inside(directory, filePath) || !(await stat(filePath)).isFile()) throw new Error(`Fixture file is missing or unsafe: ${relative}`);
  }
  const sourceSet = new Set(manifest.sourceFiles);
  const projectSet = new Set(manifest.projectFiles);
  for (const entity of golden.entities) {
    if (entity.identity.identityKind === "EXTERNAL_PACKAGE") continue;
    const isLogicalModule = entity.identity.kind === "MODULE";
    if (!sourceSet.has(entity.identity.filePath) && !(isLogicalModule && projectSet.has(entity.identity.filePath))) {
      throw new Error(`Golden entity points outside declared fixture files: ${entity.ref}`);
    }
  }
  for (const edge of golden.edges) {
    if (edge.evidence !== null) await validateEvidence(directory, sourceSet, edge.evidence.filePath, edge.evidence.endLine);
  }
  for (const unresolved of golden.unresolvedRelationships) {
    if (unresolved.evidence !== null) await validateEvidence(directory, sourceSet, unresolved.evidence.filePath, unresolved.evidence.endLine);
  }
  return { directory, manifest, golden };
}

async function validateEvidence(directory: string, sourceSet: ReadonlySet<string>, file: string, endLine: number): Promise<void> {
  if (!sourceSet.has(file)) throw new Error(`Evidence file is not declared as source: ${file}`);
  const lineCount = (await readFile(path.join(directory, file), "utf8")).split(/\r?\n/u).length;
  if (endLine > lineCount) throw new Error(`Evidence line ${endLine} exceeds ${file} line count ${lineCount}`);
}

export async function loadFixtureCorpus(fixturesRoot: string): Promise<readonly LoadedFixture[]> {
  const entries = await readdir(fixturesRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(fixturesRoot, entry.name)).sort();
  return Promise.all(directories.map(loadFixture));
}
