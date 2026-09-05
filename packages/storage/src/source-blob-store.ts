export interface SourceBlobStat {
  readonly key: string;
  readonly byteCount: number;
  readonly lastModified: Date | null;
  readonly contentHash: string | null;
}

export interface SourceBlobListItem {
  readonly key: string;
  readonly byteCount: number;
  readonly lastModified: Date | null;
}

export type SourceBlobPutResult = "UPLOADED" | "REUSED";

export interface PutSourceBlobInput {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly contentHash: string;
}

export interface SourceBlobStore {
  ensureBucket(): Promise<void>;
  put(input: PutSourceBlobInput): Promise<SourceBlobPutResult>;
  get(key: string): Promise<AsyncIterable<Uint8Array>>;
  stat(key: string): Promise<SourceBlobStat | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix: string): AsyncIterable<SourceBlobListItem>;
}
