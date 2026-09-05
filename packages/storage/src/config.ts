export interface SourceStorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

export function sourceStorageConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env): SourceStorageConfig {
  return {
    endpoint: required(environment, "CODEATLAS_SOURCE_ENDPOINT"),
    region: required(environment, "CODEATLAS_SOURCE_REGION"),
    bucket: required(environment, "CODEATLAS_SOURCE_BUCKET"),
    accessKeyId: required(environment, "CODEATLAS_SOURCE_ACCESS_KEY"),
    secretAccessKey: required(environment, "CODEATLAS_SOURCE_SECRET_KEY"),
    forcePathStyle: environment["CODEATLAS_SOURCE_FORCE_PATH_STYLE"] !== "false",
  };
}
