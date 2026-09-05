import { execFile } from "node:child_process";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(root: string, ...arguments_: string[]): Promise<void> {
  await execFileAsync("git", ["-C", root, ...arguments_], {
    windowsHide: true,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  });
}

export async function createGitFixture(name = "typescript-basic"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "codeatlas-persistence-fixture-"));
  await cp(path.resolve("benchmark", "fixtures", name), root, { recursive: true });
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.name", "CodeAtlas Integration Test");
  await git(root, "config", "user.email", "codeatlas-test@example.invalid");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");
  return root;
}

export async function commitFixtureChange(root: string, revision: number): Promise<void> {
  await writeFile(path.join(root, "revision.ts"), `export const revision = ${revision};\n`, "utf8");
  await git(root, "add", "revision.ts");
  await git(root, "commit", "-m", `revision ${revision}`);
}
