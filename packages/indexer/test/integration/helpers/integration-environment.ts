import {
  createDatabase,
  runMigrations,
  type CodeAtlasDatabase,
} from "@codeatlas/db";
import {
  S3CompatibleSourceBlobStore,
  sourceStorageConfigFromEnvironment,
  type SourceBlobStore,
} from "@codeatlas/storage";

export function assertSafeTestDatabase(url: string, explicitTestEnvironment: string | undefined): void {
  const databaseName = new URL(url).pathname.replace(/^\//u, "");
  if (explicitTestEnvironment !== "1" || databaseName !== "codeatlas_test") {
    throw new Error("Refusing destructive reset: use database codeatlas_test and CODEATLAS_TEST_ENVIRONMENT=1");
  }
}

export async function createIntegrationEnvironment(): Promise<{ database: CodeAtlasDatabase; blobStore: SourceBlobStore }> {
  const databaseUrl = process.env["CODEATLAS_TEST_DATABASE_URL"];
  if (databaseUrl === undefined) throw new Error("CODEATLAS_TEST_DATABASE_URL is required");
  assertSafeTestDatabase(databaseUrl, process.env["CODEATLAS_TEST_ENVIRONMENT"]);
  const database = createDatabase({ url: databaseUrl, maxConnections: 20 });
  await database.client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await database.client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await database.client.unsafe("CREATE SCHEMA public");
  await runMigrations(database);
  const bucket = process.env["CODEATLAS_TEST_SOURCE_BUCKET"];
  if (bucket === undefined) throw new Error("CODEATLAS_TEST_SOURCE_BUCKET is required");
  const blobStore = new S3CompatibleSourceBlobStore(sourceStorageConfigFromEnvironment({
    ...process.env,
    CODEATLAS_SOURCE_BUCKET: bucket,
  }));
  await blobStore.ensureBucket();
  for await (const object of blobStore.list("")) await blobStore.delete(object.key);
  return { database, blobStore };
}
