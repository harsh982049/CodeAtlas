import { createHash } from "node:crypto";

const sha256Pattern = /^[0-9a-f]{64}$/u;
const keyPattern = /^source\/sha256\/([0-9a-f]{2})\/([0-9a-f]{64})$/u;

export function sourceObjectKey(contentHash: string): string {
  if (!sha256Pattern.test(contentHash)) {
    throw new Error("Content hash must be a lowercase SHA-256 value");
  }
  return `source/sha256/${contentHash.slice(0, 2)}/${contentHash}`;
}

export function contentHashFromSourceObjectKey(key: string): string | null {
  const match = keyPattern.exec(key);
  if (match === null || match[1] !== match[2]?.slice(0, 2)) return null;
  return match[2] ?? null;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256Stream(stream: AsyncIterable<Uint8Array>): Promise<{ hash: string; byteCount: number }> {
  const digest = createHash("sha256");
  let byteCount = 0;
  for await (const chunk of stream) {
    digest.update(chunk);
    byteCount += chunk.byteLength;
  }
  return { hash: digest.digest("hex"), byteCount };
}
