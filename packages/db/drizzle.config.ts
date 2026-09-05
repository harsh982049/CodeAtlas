import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env["CODEATLAS_DATABASE_URL"] ?? "postgres://codeatlas:codeatlas-local-dev@localhost:55432/codeatlas",
  },
  strict: true,
  verbose: true,
});
