import { materializeRealRepositories } from "./realworld-materializer.js";

interface Options {
  readonly manifestPath?: string;
  readonly cacheRoot?: string;
  readonly only?: ReadonlySet<string>;
}

function parse(arguments_: readonly string[]): Options {
  let manifestPath: string | undefined;
  let cacheRoot: string | undefined;
  const only = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if ((argument === "--manifest" || argument === "--cache" || argument === "--only") && value === undefined) throw new Error(`${argument} requires a value`);
    if (argument === "--manifest") manifestPath = value;
    else if (argument === "--cache") cacheRoot = value;
    else if (argument === "--only" && value !== undefined) only.add(value);
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }
  return {
    ...(manifestPath === undefined ? {} : { manifestPath }),
    ...(cacheRoot === undefined ? {} : { cacheRoot }),
    ...(only.size === 0 ? {} : { only }),
  };
}

const results = await materializeRealRepositories(parse(process.argv.slice(2)));
for (const result of results) process.stdout.write(`${result.reused ? "verified" : "materialized"} ${result.slug} ${result.commitSha} ${result.checkoutPath}\n`);
