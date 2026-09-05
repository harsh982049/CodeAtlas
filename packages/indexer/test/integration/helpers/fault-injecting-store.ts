import type {
  PutSourceBlobInput,
  SourceBlobListItem,
  SourceBlobPutResult,
  SourceBlobStat,
  SourceBlobStore,
} from "@codeatlas/storage";

export class FaultInjectingSourceBlobStore implements SourceBlobStore {
  readonly #delegate: SourceBlobStore;
  #failed = false;

  constructor(delegate: SourceBlobStore) {
    this.#delegate = delegate;
  }

  ensureBucket(): Promise<void> { return this.#delegate.ensureBucket(); }
  get(key: string): Promise<AsyncIterable<Uint8Array>> { return this.#delegate.get(key); }
  stat(key: string): Promise<SourceBlobStat | null> { return this.#delegate.stat(key); }
  exists(key: string): Promise<boolean> { return this.#delegate.exists(key); }
  delete(key: string): Promise<void> { return this.#delegate.delete(key); }
  list(prefix: string): AsyncIterable<SourceBlobListItem> { return this.#delegate.list(prefix); }

  async put(input: PutSourceBlobInput): Promise<SourceBlobPutResult> {
    if (!this.#failed) {
      this.#failed = true;
      throw new Error("Injected source-storage failure");
    }
    return this.#delegate.put(input);
  }
}
