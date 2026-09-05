export interface DatabaseConfig {
  readonly url: string;
  readonly maxConnections?: number;
}

export function databaseConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const url = environment["CODEATLAS_DATABASE_URL"]?.trim();
  if (url === undefined || url.length === 0) {
    throw new Error("CODEATLAS_DATABASE_URL is required");
  }
  return { url };
}
