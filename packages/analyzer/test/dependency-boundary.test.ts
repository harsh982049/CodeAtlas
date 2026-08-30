import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("analyzer dependency boundary", () => {
  it("does not import benchmark or golden-ground-truth code", async () => {
    const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
    const files = (await readdir(sourceRoot)).filter((file) => file.endsWith(".ts"));
    const contents = await Promise.all(files.map((file) => readFile(path.join(sourceRoot, file), "utf8")));
    expect(contents.join("\n")).not.toMatch(/(?:from|import\()\s*["'][^"']*(?:benchmark|golden)/u);
  });
});
