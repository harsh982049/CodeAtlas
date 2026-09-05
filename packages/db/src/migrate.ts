import { existsSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createDatabase } from "./client.js";
import { databaseConfigFromEnvironment } from "./config.js";
import { runMigrations } from "./migration.js";

const localEnvironment = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(localEnvironment)) process.loadEnvFile(localEnvironment);

const database = createDatabase(databaseConfigFromEnvironment());
try {
  await runMigrations(database);
  process.stdout.write("CodeAtlas database migrations applied.\n");
} finally {
  await database.close();
}
