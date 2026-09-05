import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { DatabaseConfig } from "./config.js";
import * as schema from "./schema.js";

export function createDatabase(config: DatabaseConfig) {
  const client = postgres(config.url, { max: config.maxConnections ?? 10 });
  return {
    client,
    db: drizzle(client, { schema }),
    close: async (): Promise<void> => client.end(),
  };
}

export type CodeAtlasDatabase = ReturnType<typeof createDatabase>;
