import { describe, expect, it } from "vitest";

import { normalizeExternalPackageSpecifier } from "../src/index.js";

describe("external package normalization", () => {
  it("collapses package subpaths while preserving scoped names", () => {
    expect(normalizeExternalPackageSpecifier("express")).toMatchObject({
      ecosystem: "NPM",
      packageName: "express",
      subpath: null,
    });
    expect(normalizeExternalPackageSpecifier("lodash/fp")).toMatchObject({
      ecosystem: "NPM",
      packageName: "lodash",
    });
    expect(normalizeExternalPackageSpecifier("@scope/pkg/internal")).toMatchObject({
      ecosystem: "NPM",
      packageName: "@scope/pkg",
    });
    expect(normalizeExternalPackageSpecifier("@scope/pkg")).toMatchObject({
      ecosystem: "NPM",
      packageName: "@scope/pkg",
      subpath: null,
    });
  });

  it("normalizes Node built-ins", () => {
    expect(normalizeExternalPackageSpecifier("node:fs/promises")).toMatchObject({
      ecosystem: "NODE_BUILTIN",
      packageName: "node:fs",
    });
    expect(normalizeExternalPackageSpecifier("fs")).toMatchObject({ ecosystem: "NODE_BUILTIN", packageName: "node:fs" });
    expect(normalizeExternalPackageSpecifier("path")).toMatchObject({ ecosystem: "NODE_BUILTIN", packageName: "node:path" });
  });
});
