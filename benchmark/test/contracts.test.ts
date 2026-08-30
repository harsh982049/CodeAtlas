import { describe, expect, it } from "vitest";

import { runContractBenchmark } from "../src/index.js";

describe("fixture and golden graph contracts", () => {
  it("loads and validates the entire hand-authored corpus", async () => {
    const result = await runContractBenchmark();
    expect(result.fixtureCount).toBe(18);
    expect(result.entityCount).toBeGreaterThan(result.fixtureCount);
    expect(result.edgeCount).toBeGreaterThan(0);
  });
});
