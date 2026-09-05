import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { contentHashFromSourceObjectKey } from "./content-address.js";
import type { SourceStorageConfig } from "./config.js";
import type {
  PutSourceBlobInput,
  SourceBlobListItem,
  SourceBlobPutResult,
  SourceBlobStat,
  SourceBlobStore,
} from "./source-blob-store.js";

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return undefined;
  const metadata = error.$metadata;
  if (typeof metadata !== "object" || metadata === null || !("httpStatusCode" in metadata)) return undefined;
  return typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : undefined;
}

export class S3CompatibleSourceBlobStore implements SourceBlobStore {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(config: SourceStorageConfig) {
    this.#bucket = config.bucket;
    this.#client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: this.#bucket }));
      return;
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
    }
    try {
      await this.#client.send(new CreateBucketCommand({ Bucket: this.#bucket }));
    } catch (error) {
      if (statusCode(error) !== 409) throw error;
    }
  }

  async put(input: PutSourceBlobInput): Promise<SourceBlobPutResult> {
    const keyHash = contentHashFromSourceObjectKey(input.key);
    if (keyHash === null || keyHash !== input.contentHash) {
      throw new Error("Source object key does not match the supplied content hash");
    }
    const existing = await this.stat(input.key);
    if (existing !== null) {
      if (existing.byteCount !== input.bytes.byteLength || existing.contentHash !== input.contentHash) {
        throw new Error(`Existing source object failed immutable metadata verification: ${input.key}`);
      }
      return "REUSED";
    }
    await this.#client.send(new PutObjectCommand({
      Bucket: this.#bucket,
      Key: input.key,
      Body: input.bytes,
      ContentLength: input.bytes.byteLength,
      ContentType: "application/octet-stream",
      Metadata: { sha256: input.contentHash },
    }));
    return "UPLOADED";
  }

  async get(key: string): Promise<AsyncIterable<Uint8Array>> {
    const output = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
    const body = output.Body;
    if (body === undefined || !(Symbol.asyncIterator in body)) {
      throw new Error(`Source object has no streaming body: ${key}`);
    }
    return body as AsyncIterable<Uint8Array>;
  }

  async stat(key: string): Promise<SourceBlobStat | null> {
    try {
      const output = await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
      return {
        key,
        byteCount: output.ContentLength ?? 0,
        lastModified: output.LastModified ?? null,
        contentHash: output.Metadata?.["sha256"] ?? null,
      };
    } catch (error) {
      if (statusCode(error) === 404) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }

  async *list(prefix: string): AsyncIterable<SourceBlobListItem> {
    let continuationToken: string | undefined;
    do {
      const output = await this.#client.send(new ListObjectsV2Command({
        Bucket: this.#bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      for (const item of output.Contents ?? []) {
        if (item.Key === undefined) continue;
        yield { key: item.Key, byteCount: item.Size ?? 0, lastModified: item.LastModified ?? null };
      }
      continuationToken = output.IsTruncated ? output.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
  }
}
