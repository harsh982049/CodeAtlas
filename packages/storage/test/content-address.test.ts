import { describe, expect, it } from "vitest";

import {
  contentHashFromSourceObjectKey,
  sha256Bytes,
  sha256Stream,
  sourceObjectKey,
} from "../src/index.js";

describe("content-addressed source storage", () => {
  it("derives and parses the authoritative key format", () => {
    const hash = sha256Bytes(Buffer.from("source\n", "utf8"));
    const key = sourceObjectKey(hash);
    expect(key).toBe(`source/sha256/${hash.slice(0, 2)}/${hash}`);
    expect(contentHashFromSourceObjectKey(key)).toBe(hash);
    expect(contentHashFromSourceObjectKey(`source/sha256/ff/${hash}`)).toBeNull();
  });

  it("hashes streamed bytes without concatenating them", async () => {
    async function* chunks(): AsyncIterable<Uint8Array> {
      yield Buffer.from("source", "utf8");
      yield Buffer.from("\n", "utf8");
    }
    await expect(sha256Stream(chunks())).resolves.toEqual({
      hash: sha256Bytes(Buffer.from("source\n", "utf8")),
      byteCount: 7,
    });
  });
});
