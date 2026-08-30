import { builtinModules, isBuiltin } from "node:module";

import type { ExternalPackageEcosystem } from "./entity-identity.js";

export interface ExternalPackageReference {
  readonly ecosystem: ExternalPackageEcosystem;
  readonly packageName: string;
  readonly subpath: string | null;
  readonly requestedSpecifier: string;
  readonly version: string | null;
}

const builtinRoots = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "").split("/")[0]),
);

function normalizeBuiltin(specifier: string): ExternalPackageReference | null {
  const withoutPrefix = specifier.replace(/^node:/, "");
  if (!isBuiltin(specifier) && !isBuiltin(withoutPrefix)) {
    return null;
  }
  const [root, ...subpathParts] = withoutPrefix.split("/");
  if (root === undefined || !builtinRoots.has(root)) {
    return null;
  }
  return {
    ecosystem: "NODE_BUILTIN",
    packageName: `node:${root}`,
    subpath: subpathParts.length === 0 ? null : subpathParts.join("/"),
    requestedSpecifier: specifier,
    version: null,
  };
}

export function normalizeExternalPackageSpecifier(
  specifier: string,
): ExternalPackageReference | null {
  if (
    specifier.length === 0 ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.includes("\\") ||
    /^[A-Za-z][A-Za-z+.-]*:/.test(specifier) && !specifier.startsWith("node:")
  ) {
    return null;
  }

  const builtin = normalizeBuiltin(specifier);
  if (builtin !== null) {
    return builtin;
  }

  const parts = specifier.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    return null;
  }

  let packageName: string;
  let subpathParts: string[];
  if (specifier.startsWith("@")) {
    if (parts.length < 2 || parts[0] === "@") {
      return null;
    }
    packageName = `${parts[0]}/${parts[1]}`;
    subpathParts = parts.slice(2);
  } else {
    const first = parts[0];
    if (first === undefined) {
      return null;
    }
    packageName = first;
    subpathParts = parts.slice(1);
  }

  return {
    ecosystem: "NPM",
    packageName: packageName.normalize("NFC"),
    subpath: subpathParts.length === 0 ? null : subpathParts.join("/").normalize("NFC"),
    requestedSpecifier: specifier,
    version: null,
  };
}
