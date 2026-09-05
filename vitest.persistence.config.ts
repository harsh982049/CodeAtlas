import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const environmentPath = path.resolve(".env");
if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    include: ["packages/indexer/test/integration/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
