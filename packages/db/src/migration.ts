import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { CodeAtlasDatabase } from "./client.js";

export async function runMigrations(database: CodeAtlasDatabase): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  await migrate(database.db, { migrationsFolder });
}
